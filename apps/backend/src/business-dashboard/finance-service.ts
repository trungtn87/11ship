import { SystemBankAccountRepository } from '../wallet/system-bank-account-repository';
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
import { FinancePermissionKey, FINANCE_PERMISSION_READ, FINANCE_PERMISSION_TOPUP_RECORD } from '../finance-access/finance-access-constants';
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
type Key=string|readonly string[]|undefined;
@Injectable()
export class BusinessFinanceService {
  constructor(private readonly tx:TransactionManager,private readonly executor:IdempotencyExecutor,
    private readonly actor:AdminSystemActor,private readonly access:FinanceAccessParticipant,
    private readonly authority:ClientSessionAuthority,private readonly users:UserRepository,
    private readonly shops:ShopRepository,private readonly accounts:SystemBankAccountRepository,private readonly drivers:DriverRepository,
    private readonly repo:BusinessFinanceRepository,private readonly audit:AuditWriter,
    @Inject(APP_CONFIG) private readonly config:AppConfig) {}
  async admin(token:string|undefined,csrf?:unknown,write=false):Promise<FinanceIdentity> {
    return {kind:'admin',known:await this.actor.precheck(token,{required:write,header:csrf})};
  }
  async authorize(c:TransactionContext,who:FinanceIdentity,permission:FinancePermissionKey=FINANCE_PERMISSION_READ):Promise<{userId:string;role:string}> {
    await setBusinessLockTimeout(c,this.config.idempotency.businessLockTimeoutMs);
    if(who.kind==='admin') {
      const locked=await this.actor.lock(c,who.known,{user:'read',factor:'read'});
      await this.access.require(c,locked,permission,await freshClockMs(c));
      return {userId:who.known.userId,role:locked.checked.membership.adminRole};
    }
    const a=await this.authority.lock(c,who.principal,'share');
    if(a.app==='SHIP'&&a.storedActiveRole==='DRIVER'&&await this.users.hasRole(c,a.userId,'DRIVER')) {
      const d=await this.drivers.findByUserId(c,a.userId);
      if(d!==undefined&&d.status!=='CLOSED')return {userId:a.userId,role:'SHIPPER'};
    }
    if(a.app==='FOOD'&&a.storedActiveRole==='SHOP'&&await this.users.hasRole(c,a.userId,'SHOP')) {
      if(await this.shops.findOwnedShop(c,a.userId))return {userId:a.userId,role:'SHOP'};
    }
    throw new AppError('ROLE_NOT_AVAILABLE');
  }
  async room(c:TransactionContext,who:FinanceIdentity,id:string,lock=false):Promise<FinanceRow> {
    const row=await this.repo.find(c,id,lock);
    const userId=who.kind==='admin'?who.known.userId:who.principal.userId;
    if(!row||(who.kind==='client'&&row.owner_user_id!==userId))throw new AppError('BUSINESS_REQUEST_NOT_FOUND');
    return row;
  }
  list(who:FinanceIdentity,state:string|null,before:string|null):Promise<JsonObject> {
    return this.tx.withTransaction(async c=>{const a=await this.authorize(c,who);return this.repo.list(c,a.userId,who.kind==='admin',state,before);});
  }
  read(who:FinanceIdentity,id:string,before:string|null):Promise<JsonObject> {
    return this.tx.withTransaction(async c=>{await this.authorize(c,who);const row=await this.room(c,who,id);return {request:financeView(row),messages:await this.repo.messages(c,id,before)};});
  }
  notifications(who:FinanceIdentity,before:string|null):Promise<JsonObject> {
    return this.tx.withTransaction(async c=>{const a=await this.authorize(c,who);return this.repo.notifications(c,a.userId,who.kind==='admin',before);});
  }
  send(who:FinanceIdentity,id:string,body:string,key:Key,requestId:string):Promise<JsonObject> {
    return this.command(who,'message',{request_id:id,body},key,requestId,async(c,a)=>{
      const row=await this.room(c,who,id,true);
      if(row.state!=='PENDING')throw new AppError('BUSINESS_REQUEST_CLOSED');
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
      await this.repo.message(c,id,a.userId,'SHOP',note);
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
      if(!confirm)await this.repo.message(c,id,a.userId,a.role,`Lý do từ chối: ${reasonText((body as RejectBody).reasonCode)}`);
      return financeView((await this.repo.find(c,id))!);
    },true,FINANCE_PERMISSION_TOPUP_RECORD);
  }
  async command(who:FinanceIdentity,operation:string,logical:JsonObject,key:Key,requestId:string,apply:(c:TransactionContext,a:{userId:string;role:string})=>Promise<JsonObject>,audited=true,permission:FinancePermissionKey=FINANCE_PERMISSION_READ):Promise<JsonObject> {
    const userId=who.kind==='admin'?who.known.userId:who.principal.userId;
    const outcome=await this.executor.execute({scopeType:who.kind==='admin'?'admin_user':'user',scopeId:userId,operationId:`business.finance.${operation}.v1`,idempotencyKey:key,logicalRequest:logical,
      replay:{kind:'sensitive',authorize:async(c,guard)=>{if(guard.user_id!==userId)throw new AppError('ADMIN_FORBIDDEN');await this.authorize(c,who,permission);return true;}}},async c=>{
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
