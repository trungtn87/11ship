import { NotificationEventService } from '../../apps/backend/src/notifications/notification-event-service';
import { OutboxPublishEvent } from '../../apps/backend/src/outbox/outbox-publisher';
import { randomInt, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { AdminApp, adminData, adminErrorCode, startAdminApp } from './support/admin-fixtures';
import { AuthApp, dataOf, PASSWORD, startAuthApp } from './support/auth-fixtures';
import { systemSession, SystemSession } from './support/provisioning-fixtures';
import { activatedAdmin, changeGrant, getAs, permission, postAs, purgeDeliveriesOfShops, seedDelivery, systemLoginOf } from './support/m12-fixtures';
import { createShopOwner, ShopOwner } from './support/shop-management-fixtures';
import { newShipper, PRIVACY, TERMS } from './support/m10-fixtures';
import { BusinessPushService } from '../../apps/backend/src/business-dashboard/business-push-service';
import { BUSINESS_DOWN_SQL } from './support/business-migration-sql';
import { eventually } from './support/async-helpers';

describe('Business Dashboard — real money requests, chat, rights and reports',()=>{
  let admin:AdminApp;let app:AuthApp;let system:SystemSession;let shop:ShopOwner;let other:ShopOwner;let accountId:string;
  const bankTransaction='BIZ-'+randomUUID();
  beforeAll(async()=>{
    const clientAuth={termsVersion:TERMS,privacyVersion:PRIVACY};
    app=await startAuthApp({}, {configOverride:{clientAuth}});
    admin=await startAdminApp({activationDisabledTest:true,configOverride:{clientAuth}});system=await systemSession(admin);
    shop=await clientShop();other=await clientShop();
    accountId=randomUUID();await admin.pool.query(`INSERT INTO app.system_owned_bank_accounts(system_account_id,bank_id,account_number,account_holder,can_receive,created_at,updated_at) VALUES($1,'VCB',$2,'TEST BUSINESS',true,now(),now())`,[accountId,String(randomInt(1_000_000_000,9_000_000_000))]);
  });
  afterAll(async()=>{
    try{
      await purgeDeliveriesOfShops(app.pool,[shop.shopId,other.shopId]);await app.close();await admin.close();
    }finally{
      // The shared fixture pool is closed above. The suite's receiving account is removed by the following guarded test-only connection.
      const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();
      try{await c.query('BEGIN');await c.query('ALTER TABLE app.system_owned_bank_accounts DISABLE TRIGGER USER');await c.query('DELETE FROM app.system_owned_bank_accounts WHERE system_account_id=$1',[accountId]);await c.query('ALTER TABLE app.system_owned_bank_accounts ENABLE TRIGGER USER');await c.query('COMMIT');}finally{await c.end();}
    }
  });
  async function clientShop():Promise<ShopOwner>{
    const owner=await createShopOwner(app);
    const login=await app.call('POST','/client-auth/login',{headers:{'idempotency-key':randomUUID()},body:{phone:owner.user.phone.local,password:PASSWORD,device:{device_id:'business-test',platform:'WEB',app:'FOOD'}}});
    expect(login.status).toBe(200);const token=String(dataOf(login).access_token);
    const selected=await app.call('POST','/client-auth/context',{bearer:token,headers:{'idempotency-key':randomUUID()},body:{context:'SHOP_OWNER'}});
    expect(selected.status).toBe(200);return {...owner,token};
  }
  const client=(who:ShopOwner,method:'GET'|'POST',path:string,body?:unknown,key=randomUUID())=>admin.call(method,'/finance/me'+path,{basePath:'/v1',headers:{authorization:'Bearer '+who.token,'idempotency-key':key},...(body===undefined?{}:{body})});
  const create=async()=>{
    const r=await client(shop,'POST','/shop-payments',{amount_vnd:29000,note:'Đã chuyển khoản, nhờ kiểm tra'});expect(r.status).toBe(201);return String(adminData(r).request_id);
  };
  const confirmation=(version=1)=>({expected_version:version,actual_amount_vnd:29000,bank_id:'VCB',system_owned_account_id:accountId,canonical_transaction_id:bankTransaction,received_at:new Date().toISOString()});
  it('keeps the new entitlement trigger inventory explicit alongside the older migration inventory',async()=>{
    const triggers=await admin.pool.query<{tgname:string}>(`SELECT tgname FROM pg_trigger WHERE tgrelid='app.shop_entitlement_grants'::regclass AND NOT tgisinternal ORDER BY tgname`);
    expect(triggers.rows.map(r=>r.tgname)).toEqual(['shop_entitlement_grants_guard','shop_entitlement_grants_immutable','shop_entitlement_grants_no_truncate']);
  });
  it('locks before checking financial history during rollback, preserving a concurrent committed request',async()=>{
    const id=randomUUID();const writer=await admin.pool.connect();const migrator=await admin.pool.connect();
    try{
      await writer.query('BEGIN');
      await writer.query(`INSERT INTO app.business_finance_requests(request_id,kind,owner_user_id,shop_id,amount_requested_vnd,state) VALUES($1,'SHOP_PAYMENT',$2,$3,29000,'PENDING')`,[id,shop.userId,shop.shopId]);
      await migrator.query('BEGIN');
      const migrating=migrator.query(BUSINESS_DOWN_SQL).then(()=>undefined,(error:unknown)=>error);
      await eventually(async()=>Number((await admin.pool.query(`SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted AND relation='app.business_finance_requests'::regclass`)).rows[0].n)>0,'rollback waits behind the uncommitted finance request');
      await writer.query('COMMIT');
      expect(String(await migrating)).toContain('BUSINESS_FINANCE_DOWN_REFUSED');
    }finally{
      await writer.query('ROLLBACK').catch(()=>undefined);await migrator.query('ROLLBACK').catch(()=>undefined);
      writer.release();migrator.release();
    }
    expect((await admin.pool.query('SELECT 1 FROM app.business_finance_requests WHERE request_id=$1',[id])).rowCount).toBe(1);
  });
  it('uses existing administration sessions and denies missing or unrelated finance rights',async()=>{
    expect((await getAs(admin,undefined,'/business/requests')).status).toBe(401);
    const viewer=await activatedAdmin(admin,system,[permission('SHOP')],'Business reader');
    expect((await getAs(admin,viewer.login,'/business/requests')).status).toBe(403);
    expect((await changeGrant(admin,system,'grant',viewer.userId,'wallet.read',0)).status).toBe(200);
    expect((await getAs(admin,viewer.login,'/business/requests')).status).toBe(200);
    const request=await create();
    expect((await postAs(admin,viewer.login,`/business/requests/${request}/confirm`,confirmation())).status).toBe(403);
    expect((await changeGrant(admin,system,'revoke',viewer.userId,'wallet.read',1)).status).toBe(200);
    expect((await getAs(admin,viewer.login,'/business/requests')).status).toBe(403);
  });
  it('separates shop read, handling, report, receipt and entitlement permissions, including replays',async()=>{
    const viewer=await activatedAdmin(admin,system,[permission('SHOP')],'Shop finance reader');
    await changeGrant(admin,system,'grant',viewer.userId,'shop.payment.read',0);
    const id=await create();const url='/business/requests/'+id;
    expect((await getAs(admin,viewer.login,url)).status).toBe(200);
    const key=randomUUID();const body={body:'Trao đổi từ admin'};
    expect((await postAs(admin,viewer.login,url+'/messages',body,key)).status).toBe(403);
    await changeGrant(admin,system,'grant',viewer.userId,'shop.payment.record',0);
    expect((await postAs(admin,viewer.login,url+'/messages',body,key)).status).toBe(200);
    expect((await postAs(admin,viewer.login,'/business/shops/'+shop.shopId+'/entitlement',{action:'GRANT',reason:'Không có quyền',expected_version:'0'})).status).toBe(403);
    await changeGrant(admin,system,'revoke',viewer.userId,'shop.payment.record',1);
    expect((await postAs(admin,viewer.login,url+'/messages',body,key)).status).toBe(403);
    const reportKey=randomUUID();
    const [report,retry]=await Promise.all([client(shop,'POST',`/requests/${id}/report-transfer`,{},reportKey),client(shop,'POST',`/requests/${id}/report-transfer`,{},reportKey)]);
    expect(report.status).toBe(200);expect(retry.status).toBe(200);
    const read=adminData(await client(shop,'GET','/requests/'+id));
    expect(read.request).toMatchObject({state:'PENDING',actual_amount_vnd:null,version:1});
    expect((read.request as {reported_at:unknown}).reported_at).not.toBeNull();
    expect(read.entitlement).toMatchObject({expanded:false,version:'0'});
    expect(read.capabilities).toMatchObject({can_send:true,can_record:false,can_manage_entitlement:false});
    expect((await admin.pool.query(`SELECT count(*)::int n FROM app.business_bank_receipts WHERE source_id=$1`,[id])).rows[0].n).toBe(0);
    expect((await admin.pool.query(`SELECT count(*)::int n FROM app.business_finance_messages WHERE request_id=$1 AND body LIKE 'Người nộp báo%'`,[id])).rows[0].n).toBe(1);
    const confirmed=await postAs(admin,systemLoginOf(system),url+'/confirm',{...confirmation(),canonical_transaction_id:'ENT-'+randomUUID()});
    expect(confirmed.status).toBe(200);
    expect(adminData(await client(shop,'GET','/requests/'+id)).entitlement).toMatchObject({expanded:false});
    const grantUrl='/business/shops/'+shop.shopId+'/entitlement';
    const grantBody={action:'GRANT',reason:'Đã kiểm tra, cấp quyền thủ công',expected_version:'0',payment_request_id:id};
    const grantKey=randomUUID();
    const grant=await postAs(admin,systemLoginOf(system),grantUrl,grantBody,grantKey);expect(grant.status).toBe(200);
    const replay=await postAs(admin,systemLoginOf(system),grantUrl,grantBody,grantKey);expect(replay.status).toBe(200);expect(adminData(replay)).toEqual(adminData(grant));
    expect((await client(shop,'POST',`/requests/${id}/messages`,{body:'Không mở lại chat'})).status).toBe(409);
    const version=String(adminData(grant).version);
    expect((await postAs(admin,systemLoginOf(system),grantUrl,{action:'REVOKE',reason:'Thu hồi có lý do',expected_version:version})).status).toBe(200);
    const after=adminData(await getAs(admin,systemLoginOf(system),grantUrl));expect(after.expanded).toBe(false);
    expect((after.history as unknown[]).length).toBe(2);
    expect((await postAs(admin,systemLoginOf(system),grantUrl,{...grantBody,expected_version:after.version})).status).toBe(409);
  });
  it('enforces sender-wide configured chat rate while idempotent retries cost no new message',async()=>{
    const otherId=String(adminData(await client(other,'POST','/shop-payments',{amount_vnd:100,note:'Thử giới hạn'})).request_id);
    const policy=adminData(await getAs(admin,systemLoginOf(system),'/business/policy'));
    const changed=await postAs(admin,systemLoginOf(system),'/business/policy',{visible_limit:policy.visible_limit,messages_per_minute:1,expected_version:policy.version,reason:'Kiểm tra giới hạn gửi'});expect(changed.status).toBe(200);
    try{
      const key=randomUUID();const body={body:'Tin nhắn đầu tiên'};
      expect((await client(other,'POST',`/requests/${otherId}/messages`,body,key)).status).toBe(200);
      expect((await client(other,'POST',`/requests/${otherId}/messages`,body,key)).status).toBe(200);
      expect(adminErrorCode(await client(other,'POST',`/requests/${otherId}/messages`,{body:'Vượt giới hạn'}))).toBe('BUSINESS_CHAT_RATE_LIMITED');
      expect((await client(other,'GET','/requests/'+otherId)).status).toBe(200);
    }finally{expect((await postAs(admin,systemLoginOf(system),'/business/policy',{visible_limit:policy.visible_limit,messages_per_minute:policy.messages_per_minute,expected_version:adminData(changed).version,reason:'Khôi phục sau test'})).status).toBe(200);}
  });
  it('makes one shop request per intent, enforces ownership, and never provisions money or activates a shop',async()=>{
    const key=randomUUID();const body={amount_vnd:29000,note:'Báo đã thanh toán'};
    const first=await client(shop,'POST','/shop-payments',body,key);const second=await client(shop,'POST','/shop-payments',body,key);
    expect(first.status).toBe(201);expect(adminData(second).request_id).toBe(adminData(first).request_id);
    const id=String(adminData(first).request_id);
    expect((await client(other,'GET','/requests/'+id)).status).toBe(404);
    expect((await client(other,'POST',`/requests/${id}/messages`,{body:'Không phải hồ sơ của tôi'})).status).toBe(404);
    const changed=await client(shop,'POST','/shop-payments',{...body,amount_vnd:30000},key);expect(changed.status).toBe(409);
    expect((await admin.pool.query('SELECT count(*)::int AS n FROM app.driver_wallets WHERE driver_id IN(SELECT driver_id FROM app.drivers WHERE user_id=$1)',[shop.userId])).rows[0].n).toBe(0);
  });
  it('sends messages once, escapes no content into HTML, counts unread and keeps history after closure',async()=>{
    const id=await create();const key=randomUUID();const body={body:'<img src=x onerror=alert(1)> Đã gửi tiền'};
    expect((await client(shop,'POST',`/requests/${id}/messages`,body,key)).status).toBe(200);
    expect((await client(shop,'POST',`/requests/${id}/messages`,body,key)).status).toBe(200);
    const read=await getAs(admin,systemLoginOf(system),'/business/requests/'+id);expect(read.status).toBe(200);
    const messages=adminData(read).messages as {items:{sequence:string;body:string}[]};expect(messages.items.filter(m=>m.body===body.body)).toHaveLength(1);
    expect((await postAs(admin,systemLoginOf(system),`/business/requests/${id}/read`,{sequence:messages.items.at(-1)!.sequence})).status).toBe(200);
    const rejected=await postAs(admin,systemLoginOf(system),`/business/requests/${id}/reject`,{expected_version:1,reason_code:'NOT_RECEIVED'});expect(rejected.status).toBe(200);
    expect((await client(shop,'POST',`/requests/${id}/messages`,{body:'Sau khi đóng'})).status).toBe(409);
    expect((await client(shop,'GET',`/requests/${id}`)).status).toBe(200);
  });
  it('confirms a shop payment atomically once and refuses reuse of the bank identity on another request',async()=>{
    const id=await create();const body=confirmation();const key=randomUUID();
    const first=await postAs(admin,systemLoginOf(system),`/business/requests/${id}/confirm`,body,key);expect(first.status).toBe(200);
    const replay=await postAs(admin,systemLoginOf(system),`/business/requests/${id}/confirm`,body,key);expect(replay.status).toBe(200);expect(adminData(replay).version).toBe(2);
    expect((await postAs(admin,systemLoginOf(system),`/business/requests/${id}/confirm`,body)).status).toBe(409);
    const duplicate=await postAs(admin,systemLoginOf(system),`/business/requests/${await create()}/confirm`,body);
    expect(adminErrorCode(duplicate)).toBe('BANK_TRANSACTION_ALREADY_RECORDED');
    expect((await admin.pool.query('SELECT count(*)::int AS n FROM app.business_bank_receipts WHERE source_id=$1',[id])).rows[0].n).toBe(1);
    expect((await admin.pool.query(`SELECT count(*)::int AS n FROM app.audit_logs WHERE resource_id=$1 AND action='business.finance.shop_payment.confirm.v1'`,[id])).rows[0].n).toBe(1);
  });
  it('keeps existing topup posting, synchronizes its room, and rejects a bank receipt already used for a shop',async()=>{
    const shipper=await newShipper(app,[]);
    const before=Number((await app.pool.query('SELECT balance_vnd FROM app.driver_wallets WHERE wallet_id=$1',[shipper.walletId])).rows[0].balance_vnd);
    const created=await app.call('POST','/driver/wallet/topup-requests',{bearer:shipper.token,headers:{'idempotency-key':randomUUID()},body:{amount_vnd:100000}});
    expect(created.status).toBe(201);const id=String(dataOf(created).request_id);
    const chat=await admin.call('GET',`/finance/me/requests/${id}`,{basePath:'/v1',headers:{authorization:'Bearer '+shipper.token}});
    expect(chat.status).toBe(200);expect(adminData(chat).request).toMatchObject({kind:'TOPUP',state:'PENDING'});
    const duplicate=await postAs(admin,systemLoginOf(system),`/finance/topup-requests/${id}/confirm`,{...confirmation(),actual_amount_vnd:100000});
    expect(adminErrorCode(duplicate)).toBe('BANK_TRANSACTION_ALREADY_RECORDED');
    const body={...confirmation(),actual_amount_vnd:100000,canonical_transaction_id:'TOPUP-'+randomUUID()};
    const key=randomUUID();expect((await postAs(admin,systemLoginOf(system),`/finance/topup-requests/${id}/confirm`,body,key)).status).toBe(200);
    expect((await postAs(admin,systemLoginOf(system),`/finance/topup-requests/${id}/confirm`,body,key)).status).toBe(200);
    const after=(await getAs(admin,systemLoginOf(system),'/business/requests/'+id));
    expect(adminData(after).request).toMatchObject({state:'CONFIRMED',version:2,actual_amount_vnd:100000});
    expect(Number((await app.pool.query('SELECT balance_vnd FROM app.driver_wallets WHERE wallet_id=$1',[shipper.walletId])).rows[0].balance_vnd)).toBe(before+100000);
    expect((await app.pool.query("SELECT count(*)::int AS n FROM app.wallet_ledger_entries WHERE wallet_id=$1 AND entry_kind='TOPUP'",[shipper.walletId])).rows[0].n).toBe(1);
  });
  it('uses real finance events for M08, not message text or a typed recipient, and rechecks the target owner',async()=>{
    const id=await create();
    expect((await postAs(admin,systemLoginOf(system),`/business/requests/${id}/messages`,{body:'Nội dung ngân hàng không nằm trên push'})).status).toBe(200);
    const row=(await admin.pool.query(`SELECT event_id,event_type,resource_type,resource_id,resource_version,payload,occurred_at FROM app.outbox_events WHERE event_type='business.finance.updated.v1' AND resource_id=$1 ORDER BY occurred_at DESC LIMIT 1`,[id])).rows[0];
    const event:OutboxPublishEvent={attemptCount:1,eventId:row.event_id,eventType:row.event_type,eventSchemaVersion:1,resourceType:row.resource_type,resourceId:row.resource_id,resourceVersion:Number(row.resource_version),payload:row.payload,occurredAt:new Date(row.occurred_at).toISOString()};
    const events=admin.running.app.get(NotificationEventService);await events.consume(event);await events.consume(event);
    const notices=(await admin.pool.query(`SELECT notification_id,recipient_user_id,app,title,body,target_type,target_id FROM app.notifications WHERE source_event_id=$1`,[event.eventId])).rows;
    expect(notices).toHaveLength(1);expect(notices[0]).toMatchObject({recipient_user_id:shop.userId,app:'FOOD',target_type:'FINANCE_REQUEST',target_id:id});
    expect(String(notices[0].body)).not.toContain('ngân hàng');
    const open=await admin.call('POST',`/notifications/${notices[0].notification_id}/open`,{basePath:'/v1',headers:{authorization:'Bearer '+shop.token},body:{}});
    expect(open.status).toBe(200);expect(adminData(open).target).toEqual({type:'FINANCE_REQUEST',id});
    const otherOpen=await admin.call('POST',`/notifications/${notices[0].notification_id}/open`,{basePath:'/v1',headers:{authorization:'Bearer '+other.token},body:{}});expect(otherOpen.status).toBe(404);
  });
  it('serializes duplicate bank confirmations and send versus close without reopening a room',async()=>{
    const a=await create(),b=await create();const transaction='RACE-'+randomUUID();
    const body={...confirmation(),canonical_transaction_id:transaction};
    const results=await Promise.all([postAs(admin,systemLoginOf(system),`/business/requests/${a}/confirm`,body),postAs(admin,systemLoginOf(system),`/business/requests/${b}/confirm`,body)]);
    expect(results.map(r=>r.status).sort()).toEqual([200,409]);
    expect((await admin.pool.query(`SELECT count(*)::int n FROM app.business_bank_receipts WHERE canonical_transaction_id=$1`,[transaction])).rows[0].n).toBe(1);
    const id=await create();
    const [send,close]=await Promise.all([client(shop,'POST',`/requests/${id}/messages`,{body:'Tin cuối trước khi đóng'}),postAs(admin,systemLoginOf(system),`/business/requests/${id}/reject`,{expected_version:1,reason_code:'OTHER'})]);
    expect(close.status).toBe(200);expect([200,409]).toContain(send.status);
    const room=adminData(await client(shop,'GET','/requests/'+id));expect(room.request).toMatchObject({state:'REJECTED'});
    if(send.status===200){const messages=(room.messages as {items:{sequence:string;body:string}[]}).items;const sent=messages.find(m=>m.body==='Tin cuối trước khi đóng')!;const state=messages.find(m=>m.body.startsWith('Yêu cầu bị từ chối'))!;expect(BigInt(sent.sequence)<BigInt(state.sequence)).toBe(true);}
  });
  it('counts a direct call once when it is recalled, without adding an Order',async()=>{
    const current=async()=>adminData(await getAs(admin,systemLoginOf(system),'/business/reports?range=today')).trade as {transactions:number;goods_vnd:number};
    const before=await current();
    const root=await seedDelivery(app.pool,{shopId:shop.shopId,userId:shop.userId,state:'search_stopped'});
    const first=await current();expect(first.transactions).toBe(before.transactions+1);
    await seedDelivery(app.pool,{shopId:shop.shopId,userId:shop.userId,previousDeliveryId:root});
    const recalled=await current();expect(recalled.transactions).toBe(first.transactions);expect(recalled.goods_vnd).toBe(first.goods_vnd);
  });
  it('reports real recorded shop receipts separately from deposits and commission, and an overdue request stays visible without push',async()=>{
    const r=await getAs(admin,systemLoginOf(system),'/business/reports?range=today');expect(r.status).toBe(200);
    const data=adminData(r);const trade=data.trade as {shop_payments:{confirmed_vnd:number}};expect(trade.shop_payments.confirmed_vnd).toBeGreaterThanOrEqual(29000);
    const id=await create();await admin.pool.query("UPDATE app.business_finance_requests SET created_at=clock_timestamp()-interval '31 minutes' WHERE request_id=$1",[id]);
    await admin.running.app.get(BusinessPushService).tick();await admin.running.app.get(BusinessPushService).tick();
    expect((await admin.pool.query("SELECT count(*)::int AS n FROM app.business_finance_messages WHERE request_id=$1 AND event_kind='OVERDUE'",[id])).rows[0].n).toBe(1);
    const pending=await getAs(admin,systemLoginOf(system),'/business/requests?state=PENDING');expect(pending.status).toBe(200);
    expect((adminData(pending).items as {request_id:string}[]).some(r=>r.request_id===id)).toBe(true);
  });
});
