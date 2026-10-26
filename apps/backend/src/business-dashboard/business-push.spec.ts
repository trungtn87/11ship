import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import webpush from 'web-push';
import { BusinessPushService } from './business-push-service';
import { BusinessFinanceService } from './finance-service';
import { AdminSessionRepository } from '../admin-auth/admin-session-repository';
import { AppConfig } from '../config/app-config';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { AppError } from '../common/app-errors';

afterEach(()=>{jest.restoreAllMocks();});
function rig(options:{expired?:boolean;denied?:boolean;attempts?:number}={}){
  const request=randomUUID(),sub=randomUUID(),session=randomUUID();const writes:unknown[][]=[];
  const c={isActive:true,query:async(sql:string,values:unknown[]=[])=>{
    if(sql.includes('RETURNING message_sequence'))return {rows:[{message_sequence:'123',subscription_id:sub,attempts:options.attempts??1}],rowCount:1};
    if(sql.includes('p.endpoint'))return {rows:[{endpoint:'https://fcm.googleapis.com/fcm/send/test-only',p256dh:'key',auth:'auth',request_id:request,token_digest:'digest'}],rowCount:1};
    writes.push([sql,...values]);return {rows:[],rowCount:1};
  }} as unknown as TransactionContext;
  const tx={withTransaction:async<T>(f:(c:TransactionContext)=>Promise<T>)=>f(c)} as TransactionManager;
  const finance={room:jest.fn(async()=>{if(options.denied)throw new AppError('ADMIN_FORBIDDEN');return {userId:'admin',role:'SYSTEM'};})} as unknown as BusinessFinanceService;
  const sessions={findByDigest:jest.fn(async()=>({sessionId:session,revoked:false,expiredAtLookup:options.expired??false}))} as unknown as AdminSessionRepository;
  const vapid=webpush.generateVAPIDKeys();
  const config={appEnv:'test',businessPush:{publicKey:vapid.publicKey,privateKey:vapid.privateKey,subject:'mailto:test@example.com'}} as AppConfig;
  return {service:new BusinessPushService(tx,finance,sessions,config),writes,request,finance};
}
describe('Business Web Push privacy, revocation and durable retry',()=>{
  it('sends only a neutral reminder with a validated chat deep link, after checking the bound session',async()=>{
    const send=jest.spyOn(webpush,'sendNotification').mockResolvedValue({statusCode:201,body:'',headers:{}});const r=rig();
    expect(await r.service.sendOne()).toBe(true);expect(r.finance.room).toHaveBeenCalledTimes(1);
    const payload=JSON.parse(String(send.mock.calls[0]![1])) as Record<string,string>;
    expect(payload).toEqual({title:'11Ship',body:'Có cập nhật mới cần kiểm tra.',url:`/business/chat?request=${r.request}`});
    expect(r.writes.some(w=>w[4]==='SENT')).toBe(true);
  });
  it.each([{expired:true},{denied:true}])('does not send after session expiry or finance-right revocation (%j)',async options=>{
    const send=jest.spyOn(webpush,'sendNotification').mockResolvedValue({statusCode:201,body:'',headers:{}});const r=rig(options);
    await r.service.sendOne();expect(send).not.toHaveBeenCalled();expect(r.writes.some(w=>String(w[0]).includes("state='SKIPPED'"))).toBe(true);
  });
  it('retries temporary provider failures but bounds attempts and never fabricates a sent result',async()=>{
    jest.spyOn(webpush,'sendNotification').mockRejectedValue(Object.assign(new Error('provider unavailable'),{statusCode:503}));
    const first=rig();await first.service.sendOne();expect(first.writes.some(w=>w[4]==='PENDING')).toBe(true);expect(first.writes.some(w=>w[4]==='SENT')).toBe(false);
    const last=rig({attempts:5});await last.service.sendOne();expect(last.writes.some(w=>w[4]==='FAILED')).toBe(true);
  });
  it('disables a stale endpoint on 410 while retaining the request and unread inbox',async()=>{
    jest.spyOn(webpush,'sendNotification').mockRejectedValue(Object.assign(new Error('gone'),{statusCode:410}));const r=rig();await r.service.sendOne();
    expect(r.writes.some(w=>String(w[0]).includes('SET active=false'))).toBe(true);expect(r.writes.every(w=>!String(w[0]).includes('business_finance_requests'))).toBe(true);
  });
});
