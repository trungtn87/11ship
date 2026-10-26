import { SystemBankAccountRepository } from '../wallet/system-bank-account-repository';
import { ShopEntitlements } from '../shop-entitlements/shop-entitlements';
import { OutboxWriter } from '../outbox/outbox-writer';
import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AdminSystemActor } from '../admin-provisioning/admin-system-actor';
import { SessionLookup } from '../admin-auth/admin-session-repository';
import { AuditWriter } from '../audit/audit-writer';
import { AuthPrincipal } from '../auth/auth-principal';
import { UserRepository } from '../auth/user-repository';
import { ClientSessionAuthority } from '../client-auth/client-session-authority';
import { AppError } from '../common/app-errors';
import { FinanceAccessParticipant } from '../finance-access/finance-access-participant';
import { FinancePermissionKey, FINANCE_PERMISSION_READ, FINANCE_PERMISSION_TOPUP_RECORD, SHOP_PAYMENT_READ, SHOP_PAYMENT_RECORD, SHOP_ENTITLEMENT_MANAGE } from '../finance-access/finance-access-constants';
import { IdempotencyExecutor, JsonObject } from '../idempotency/idempotency-executor';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { ShopRepository } from '../shop/shop-repository';
import { DriverRepository } from '../driver/driver-repository';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { ConfirmBody, RejectBody } from '../admin-topups/admin-topup-validation';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { setBusinessLockTimeout } from '../admin-provisioning/admin-provisioning-locks';
import { BusinessFinanceRepository, FinanceRow, financeView } from './finance-repository';

export type FinanceIdentity = { kind:'admin'; known:SessionLookup } | { kind:'client'; principal:AuthPrincipal };
type FinanceActor={userId:string;role:string;kinds:string[]};
type Key=string|readonly string[]|undefined;
@Injectable()
export class BusinessFinanceService {
  constructor(private readonly tx:TransactionManager,private readonly executor:IdempotencyExecutor,
    private readonly actor:AdminSystemActor,private readonly access:FinanceAccessParticipant,
    private readonly authority:ClientSessionAuthority,private readonly users:UserRepository,
    private readonly shops:ShopRepository,private readonly accounts:SystemBankAccountRepository,private readonly drivers:DriverRepository,
    private readonly repo:BusinessFinanceRepository,private readonly audit:AuditWriter,
    private readonly entitlements:ShopEntitlements,private readonly outbox:OutboxWriter,
    @Inject(APP_CONFIG) private readonly config:AppConfig) {}
  async admin(token:string|undefined,csrf?:unknown,write=false):Promise<FinanceIdentity> {
    return {kind:'admin',known:await this.actor.precheck(token,{required:write,header:csrf})};
  }
  async authorize(c:TransactionContext,who:FinanceIdentity,permission:FinancePermissionKey|null=null):Promise<FinanceActor> {
    await setBusinessLockTimeout(c,this.config.idempotency.businessLockTimeoutMs);
    if(who.kind==='admin') {
      const locked=await this.actor.lock(c,who.known,{user:'read',factor:'read'});
      const now=await freshClockMs(c);
      if(permission)await this.access.require(c,locked,permission,now);
      const kinds:string[]=[];
      if(await this.access.has(c,locked,FINANCE_PERMISSION_READ,now))kinds.push('TOPUP');
      if(await this.access.has(c,locked,SHOP_PAYMENT_READ,now))kinds.push('SHOP_PAYMENT');
      if(!permission&&kinds.length===0)throw new AppError('ADMIN_FORBIDDEN');
      return {userId:who.known.userId,role:locked.checked.membership.adminRole,kinds};
    }
    const a=await this.authority.lock(c,who.principal,'share');
    if(a.app==='SHIP'&&a.storedActiveRole==='DRIVER'&&await this.users.hasRole(c,a.userId,'DRIVER')) {
      const d=await this.drivers.findByUserId(c,a.userId);
      if(d!==undefined&&d.status!=='CLOSED')return {userId:a.userId,role:'SHIPPER',kinds:['TOPUP']};
    }
    if(a.app==='FOOD'&&a.storedActiveRole==='SHOP'&&await this.users.hasRole(c,a.userId,'SHOP')) {
      if(await this.shops.findOwnedShop(c,a.userId))return {userId:a.userId,role:'SHOP',kinds:['SHOP_PAYMENT']};
    }
    throw new AppError('ROLE_NOT_AVAILABLE');
  }
  async room(c:TransactionContext,who:FinanceIdentity,id:string,lock=false):Promise<FinanceRow> {
    const a=await this.authorize(c,who);
    const row=await this.repo.find(c,id,lock);
    const userId=who.kind==='admin'?who.known.userId:who.principal.userId;
    if(!row||(who.kind==='client'&&row.owner_user_id!==userId)||!a.kinds.includes(row.kind))throw new AppError('BUSINESS_REQUEST_NOT_FOUND');
    return row;
  }
  list(who:FinanceIdentity,state:string|null,before:string|null):Promise<JsonObject> {
    return this.tx.withTransaction(async c=>{const a=await this.authorize(c,who);return this.repo.list(c,a.userId,who.kind==='admin',state,before,a.kinds);});
  }
  read(who:FinanceIdentity,id:string,before:string|null):Promise<JsonObject> {
    return this.tx.withTransaction(async c=>{await this.authorize(c,who);const row=await this.room(c,who,id);const canRecord=await this.canHandle(c,who,row.kind);
      const canManage=who.kind==='admin'&&row.kind==='SHOP_PAYMENT'&&await this.has(c,who,SHOP_ENTITLEMENT_MANAGE);
      return {request:await this.repo.namedView(c,row),messages:await this.repo.messages(c,id,before),capabilities:{can_send:row.state==='PENDING'&&(who.kind==='client'||canRecord),can_record:canRecord,can_manage_entitlement:canManage},entitlement:row.shop_id?await this.entitlements.view(c,row.shop_id):null};});
  }
  notifications(who:FinanceIdentity,before:string|null):Promise<JsonObject> {
    return this.tx.withTransaction(async c=>{const a=await this.authorize(c,who);return this.repo.notifications(c,a.userId,who.kind==='admin',before,a.kinds);});
  }
  send(who:FinanceIdentity,id:string,body:string,key:Key,requestId:string):Promise<JsonObject> {
    return this.command(who,'message',{request_id:id,body},key,requestId,async(c,a)=>{
      const row=await this.room(c,who,id,true);
      if(!await this.canHandle(c,who,row.kind))throw new AppError('ADMIN_FORBIDDEN');
      if(row.state!=='PENDING')throw new AppError('BUSINESS_REQUEST_CLOSED');
      // One sender-wide mutex, not one quota per room. Replays never consume the allowance.
      await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,['finance-message|'+a.userId]);
      const limit=(await this.entitlements.policy(c)).messages_per_minute;
      const n=Number((await c.query<{n:string}>(`SELECT count(*)::text AS n FROM app.business_finance_messages WHERE sender_user_id=$1 AND event_kind='MESSAGE' AND created_at>clock_timestamp()-interval '1 minute'`,[a.userId])).rows[0]!.n);
      if(n>=limit)throw new AppError('BUSINESS_CHAT_RATE_LIMITED');
      return {sequence:await this.repo.message(c,id,a.userId,a.role,body)};
    });
  }
  seen(who:FinanceIdentity,id:string,seq:string,key:Key,requestId:string):Promise<JsonObject> {
    return this.command(who,'seen',{request_id:id,sequence:seq},key,requestId,async(c,a)=>{
      await this.room(c,who,id);await this.repo.seen(c,a.userId,id,seq);return {ok:true};
    },false);
  }
  createShop(who:FinanceIdentity,amount:number,note:string,key:Key,requestId:string):Promise<JsonObject> {
    return this.command(who,'shop_payment.create',{amount_vnd:amount,note},key,requestId,async(c,a)=>{
      if(who.kind!=='client'||a.role!=='SHOP')throw new AppError('ROLE_NOT_AVAILABLE');
      const shop=await this.shops.findOwnedShop(c,a.userId);
      if(!shop)throw new AppError('SHOP_NOT_FOUND');
      const id=randomUUID();
      await c.query(`INSERT INTO app.business_finance_requests(request_id,kind,owner_user_id,shop_id,amount_requested_vnd,state)
        VALUES($1,'SHOP_PAYMENT',$2,$3,$4,'PENDING')`,[id,a.userId,shop.shopId,String(amount)]);
      await this.repo.message(c,id,a.userId,'SHOP',note,'CREATED');
      return financeView((await this.repo.find(c,id))!);
    });
  }
  resolveShop(who:FinanceIdentity,id:string,command:'confirm'|'reject',body:ConfirmBody|RejectBody,key:Key,requestId:string):Promise<JsonObject> {
    const confirm='actualAmountVnd' in body?body:undefined;
    const logical:JsonObject={request_id:id,expected_version:body.expectedVersion,...(confirm?{actual_amount_vnd:confirm.actualAmountVnd,bank_id:confirm.bankId,system_account_id:confirm.systemAccountId,canonical_transaction_id:confirm.canonicalTransactionId,received_at:confirm.receivedAtIso}:{reason_code:(body as RejectBody).reasonCode})};
    return this.command(who,`shop_payment.${command}`,logical,key,requestId,async(c,a)=>{
      if(who.kind!=='admin')throw new AppError('ADMIN_FORBIDDEN');
      const row=await this.room(c,who,id,true);
      if(row.kind!=='SHOP_PAYMENT')throw new AppError('BUSINESS_REQUEST_NOT_FOUND');
      if(row.state!=='PENDING'||Number(row.version)!==body.expectedVersion)throw new AppError('VERSION_CONFLICT');
      if(confirm){
        if(confirm.receivedAtMs>await freshClockMs(c)+300000)throw new AppError('ADMIN_INPUT_INVALID');
        const account=await this.accounts.lockForUpdate(c,confirm.systemAccountId);
        if(!account?.canReceive||account.bankId!==confirm.bankId)throw new AppError('TOPUP_ACCOUNT_NOT_RECEIVING');
        const receipt=await c.query(`INSERT INTO app.business_bank_receipts(bank_id,system_account_id,canonical_transaction_id,source_kind,source_id,amount_vnd,received_at)
          VALUES($1,$2,$3,'SHOP_PAYMENT',$4,$5,$6) ON CONFLICT DO NOTHING`,[confirm.bankId,confirm.systemAccountId,confirm.canonicalTransactionId,id,String(confirm.actualAmountVnd),confirm.receivedAtIso]);
        if(receipt.rowCount!==1)throw new AppError('BANK_TRANSACTION_ALREADY_RECORDED');
      }
      await c.query(`UPDATE app.business_finance_requests SET state=$2,actual_amount_vnd=$3,version=version+1,resolved_at=clock_timestamp(),resolved_by=$4 WHERE request_id=$1`,[id,command==='confirm'?'CONFIRMED':'REJECTED',confirm?String(confirm.actualAmountVnd):null,a.userId]);
      if(!confirm)await this.repo.message(c,id,a.userId,a.role,`Lý do từ chối: ${reasonText((body as RejectBody).reasonCode)}`,'CREATED');
      await this.repo.publish(c,id);
      return financeView((await this.repo.find(c,id))!);
    },true,SHOP_PAYMENT_RECORD);
  }
  async has(c:TransactionContext,who:FinanceIdentity,permission:FinancePermissionKey):Promise<boolean> {
    if(who.kind!=='admin')return false;
    const locked=await this.actor.lock(c,who.known,{user:'read',factor:'read'});
    return this.access.has(c,locked,permission,await freshClockMs(c));
  }
  private async canHandle(c:TransactionContext,who:FinanceIdentity,kind:string):Promise<boolean> {
    return who.kind==='client'||this.has(c,who,kind==='SHOP_PAYMENT'?SHOP_PAYMENT_RECORD:FINANCE_PERMISSION_TOPUP_RECORD);
  }
  receivingAccounts(who:FinanceIdentity):Promise<JsonObject> {
    return this.tx.withTransaction(async c=>{
      await this.authorize(c,who);
      return {accounts:(await this.accounts.list(c)).filter(a=>a.canReceive).map(a=>({account_id:a.accountId,bank_id:a.bankId,account_number:a.accountNumber,account_holder:a.accountHolder,can_receive:true}))};
    });
  }
  reportTransfer(who:FinanceIdentity,id:string,key:Key,requestId:string):Promise<JsonObject> {
    return this.command(who,'report_transfer',{request_id:id},key,requestId,async(c)=>{
      if(who.kind!=='client')throw new AppError('ADMIN_FORBIDDEN');
      const row=await this.room(c,who,id,true);
      if(row.state!=='PENDING')throw new AppError('BUSINESS_REQUEST_CLOSED');
      if(!row.reported_at){
        await c.query(`UPDATE app.business_finance_requests SET reported_at=clock_timestamp() WHERE request_id=$1`,[id]);
        await this.event(c,id,'Người nộp báo đã chuyển khoản. Chưa xác nhận tiền thực nhận.');
      }
      return financeView((await this.repo.find(c,id))!);
    });
  }
  policy(who:FinanceIdentity):Promise<JsonObject> {
    return this.tx.withTransaction(async c=>{await this.authorize(c,who);const p=await this.entitlements.policy(c);return {...p,version:Number(p.version)};});
  }
  changePolicy(who:FinanceIdentity,visibleLimit:number,messagesPerMinute:number,expectedVersion:number,reason:string,key:Key,requestId:string):Promise<JsonObject> {
    return this.command(who,'policy',{visible_limit:visibleLimit,messages_per_minute:messagesPerMinute,expected_version:expectedVersion,reason},key,requestId,async(c,a)=>{
      if(a.role!=='SYSTEM')throw new AppError('ADMIN_FORBIDDEN');
      const p=(await c.query<{version:string}>(`UPDATE app.shop_finance_policy SET visible_limit=$1,messages_per_minute=$2,version=version+1 WHERE singleton AND version=$3 RETURNING version::text`,[visibleLimit,messagesPerMinute,expectedVersion])).rows[0];
      if(!p)throw new AppError('VERSION_CONFLICT');
      await this.audit.append(c,{requestId,actorType:'SYSTEM',actorId:a.userId,action:'shop.finance.policy.v1',resourceType:'shop_finance_policy',resourceId:'global',resourceVersion:Number(p.version),outcome:'SUCCESS',metadata:{visible_limit:visibleLimit,messages_per_minute:messagesPerMinute,reason}});
      return {visible_limit:visibleLimit,messages_per_minute:messagesPerMinute,version:Number(p.version)};
    },false,SHOP_ENTITLEMENT_MANAGE);
  }
  entitlement(who:FinanceIdentity,shopId:string):Promise<JsonObject> {
    return this.tx.withTransaction(async c=>{await this.authorize(c,who,SHOP_ENTITLEMENT_MANAGE);if(who.kind!=='admin')throw new AppError('ADMIN_FORBIDDEN');return this.entitlements.view(c,shopId);});
  }
  changeEntitlement(who:FinanceIdentity,shopId:string,action:'GRANT'|'REVOKE',reason:string,expectedVersion:string,paymentId:string|null,key:Key,requestId:string):Promise<JsonObject> {
    return this.command(who,'entitlement',{shop_id:shopId,action,reason,expected_version:expectedVersion,payment_request_id:paymentId},key,requestId,async(c,a)=>{
      if(who.kind!=='admin')throw new AppError('ADMIN_FORBIDDEN');
      if(!await this.shops.lockShopForUpdate(c,shopId))throw new AppError('SHOP_NOT_FOUND');
      const current=await this.entitlements.view(c,shopId);
      if(current.version!==expectedVersion||current.expanded===(action==='GRANT'))throw new AppError('VERSION_CONFLICT');
      if(paymentId){
        const row=await this.repo.find(c,paymentId,true);
        if(action!=='GRANT'||row?.shop_id!==shopId||row.kind!=='SHOP_PAYMENT'||row.state!=='CONFIRMED')throw new AppError('ADMIN_INPUT_INVALID');
        if((await c.query(`SELECT 1 FROM app.shop_entitlement_grants WHERE payment_request_id=$1`,[paymentId])).rowCount)throw new AppError('VERSION_CONFLICT');
      }
      await c.query(`INSERT INTO app.shop_entitlement_grants(grant_id,shop_id,entitlement,action,reason,actor_user_id,payment_request_id,created_at) VALUES($1,$2,'MENU_EXPANDED',$3,$4,$5,$6,clock_timestamp())`,[randomUUID(),shopId,action,reason,a.userId,paymentId]);
      const result=await this.entitlements.view(c,shopId);
      // Entitlement events may be appended to a closed room; human chat remains closed.
      const rooms=(await c.query<{request_id:string}>(`SELECT request_id FROM app.business_finance_requests WHERE shop_id=$1 ORDER BY created_at DESC LIMIT 1`,[shopId])).rows;
      if(rooms[0])await this.event(c,rooms[0].request_id,action==='GRANT'?'Quản trị đã cấp quyền mở rộng thực đơn.':'Quản trị đã thu hồi quyền mở rộng thực đơn. Các món hiện có được giữ nguyên.');
      if(rooms[0])await this.repo.publish(c,rooms[0].request_id);
      await this.audit.append(c,{requestId,actorType:a.role==='SYSTEM'?'SYSTEM':'ADMIN',actorId:a.userId,action:'shop.entitlement.'+action.toLowerCase()+'.v1',resourceType:'shop_entitlement',resourceId:shopId,resourceVersion:Number(result.version),outcome:'SUCCESS',metadata:{reason,payment_request_id:paymentId}});
      await this.outbox.append(c,{eventType:'shop.entitlement.changed.v1',eventSchemaVersion:1,resourceType:'shop_entitlement',resourceId:shopId,resourceVersion:Number(result.version),payload:{shop_id:shopId,action,version:result.version}});
      return result;
    },false,SHOP_ENTITLEMENT_MANAGE);
  }
  private async event(c:TransactionContext,id:string,body:string):Promise<void> {
    await c.query(`INSERT INTO app.business_finance_messages(request_id,sender_role,body,event_kind) VALUES($1,'SYSTEM_EVENT',$2,'STATE')`,[id,body]);
  }
  async command(who:FinanceIdentity,operation:string,logical:JsonObject,key:Key,requestId:string,apply:(c:TransactionContext,a:FinanceActor)=>Promise<JsonObject>,audited=true,permission:FinancePermissionKey|null=null):Promise<JsonObject> {
    const userId=who.kind==='admin'?who.known.userId:who.principal.userId;
    const outcome=await this.executor.execute({scopeType:who.kind==='admin'?'admin_user':'user',scopeId:userId,operationId:`business.finance.${operation}.v1`,idempotencyKey:key,logicalRequest:logical,
      replay:{kind:'sensitive',authorize:async(c,guard)=>{if(guard.user_id!==userId)throw new AppError('ADMIN_FORBIDDEN');const replayActor=await this.authorize(c,who,permission);
        if(operation==='policy'&&replayActor.role!=='SYSTEM')throw new AppError('ADMIN_FORBIDDEN');
        if(typeof logical.request_id==='string'){
          const row=await this.room(c,who,logical.request_id);
          if(operation==='message'&&!await this.canHandle(c,who,row.kind))throw new AppError('ADMIN_FORBIDDEN');
          if(operation==='report_transfer'&&who.kind!=='client')throw new AppError('ADMIN_FORBIDDEN');
        }
        return true;}}},async c=>{
        const a=await this.authorize(c,who,permission);const result=await apply(c,a);
        if(audited)await this.audit.append(c,{requestId,actorType:a.role==='SYSTEM'||a.role==='ADMIN'?a.role:'USER',actorId:userId,action:`business.finance.${operation}.v1`,resourceType:'business_finance_request',resourceId:String(logical.request_id??result.request_id),resourceVersion:Number(result.version??1),outcome:'SUCCESS',metadata:{operation}});
        return {status:200,replayGuard:{user_id:userId},payload:result};
      });
    return outcome.payload as JsonObject;
  }
}
function reasonText(code:string):string {
  return ({NOT_RECEIVED:'Chưa nhận được tiền',AMOUNT_MISMATCH:'Số tiền chưa khớp',DUPLICATE_REQUEST:'Yêu cầu trùng',INVALID_REQUEST:'Thông tin chưa hợp lệ',OTHER:'Cần trao đổi thêm'} as Record<string,string>)[code]??'Cần trao đổi thêm';
}
