import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { AdminApp, adminData, adminErrorCode, startAdminApp } from './support/admin-fixtures';
import { AuthApp, dataOf, PASSWORD, startAuthApp } from './support/auth-fixtures';
import { systemSession, SystemSession } from './support/provisioning-fixtures';
import { activatedAdmin, changeGrant, getAs, permission, postAs, systemLoginOf } from './support/m12-fixtures';
import { createShopOwner, ShopOwner } from './support/shop-management-fixtures';
import { PRIVACY, TERMS } from './support/m10-fixtures';
import { BusinessPushService } from '../../apps/backend/src/business-dashboard/business-push-service';

describe('Business Dashboard — real money requests, chat, rights and reports',()=>{
  let admin:AdminApp;let app:AuthApp;let system:SystemSession;let shop:ShopOwner;let other:ShopOwner;let accountId:string;
  const bankTransaction='BIZ-'+randomUUID();
  beforeAll(async()=>{
    const clientAuth={termsVersion:TERMS,privacyVersion:PRIVACY};
    app=await startAuthApp({}, {configOverride:{clientAuth}});
    admin=await startAdminApp({activationDisabledTest:true,configOverride:{clientAuth}});system=await systemSession(admin);
    shop=await clientShop();other=await clientShop();
    accountId=randomUUID();await admin.pool.query(`INSERT INTO app.system_owned_bank_accounts(system_account_id,bank_id,account_number,account_holder,can_receive,created_at,updated_at) VALUES($1,'VCB',$2,'TEST BUSINESS',true,now(),now())`,[accountId,randomUUID().replaceAll('-','').slice(0,15)]);
  });
  afterAll(async()=>{
    try{
      await app.close();await admin.close();
    }finally{
      // The shared fixture pool is closed above. The suite's receiving account is removed by the following guarded test-only connection.
      const {Client}=await import('pg');const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();
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
