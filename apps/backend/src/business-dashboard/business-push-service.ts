import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import webpush from 'web-push';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { TransactionManager } from '../transaction/transaction-manager';
import { FinanceIdentity, BusinessFinanceService } from './finance-service';
import { JsonObject } from '../idempotency/idempotency-executor';
import { subscription } from './finance-validation';
import { AdminSessionRepository } from '../admin-auth/admin-session-repository';
import { AppError } from '../common/app-errors';

@Injectable()
export class BusinessPushService implements OnApplicationBootstrap,OnApplicationShutdown {
  private timer:ReturnType<typeof setInterval>|undefined;
  private running=false;
  private readonly log=new Logger(BusinessPushService.name);
  constructor(private readonly tx:TransactionManager,private readonly finance:BusinessFinanceService,private readonly sessions:AdminSessionRepository,@Inject(APP_CONFIG) private readonly config:AppConfig) {}
  status():JsonObject{return {configured:this.config.businessPush!==undefined,public_key:this.config.businessPush?.publicKey??null};}
  async subscribe(who:FinanceIdentity,body:unknown,key:string|readonly string[]|undefined,requestId:string):Promise<JsonObject> {
    const s=subscription(body);
    if(!this.config.businessPush)throw new AppError('BUSINESS_PUSH_NOT_CONFIGURED');
    return this.finance.command(who,'push.subscribe',{endpoint:s.endpoint,p256dh:s.p256dh,auth:s.auth},key,requestId,async(c,a)=>{
      if(who.kind!=='admin')throw new AppError('ADMIN_FORBIDDEN');
      // Another user's active session cannot be displaced. Ended bindings may be rebound after a new login.
      const result=await c.query(`INSERT INTO app.business_push_subscriptions(subscription_id,user_id,session_id,endpoint,p256dh,auth)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(endpoint) DO UPDATE SET active=true,user_id=EXCLUDED.user_id,session_id=EXCLUDED.session_id,p256dh=EXCLUDED.p256dh,auth=EXCLUDED.auth
        WHERE business_push_subscriptions.user_id=EXCLUDED.user_id OR NOT business_push_subscriptions.active
          OR EXISTS(SELECT 1 FROM app.admin_sessions old_session WHERE old_session.session_id=business_push_subscriptions.session_id AND (old_session.revoked_at IS NOT NULL OR old_session.expires_at<=clock_timestamp()))`,[randomUUID(),a.userId,who.known.sessionId,s.endpoint,s.p256dh,s.auth]);
      if(result.rowCount!==1)throw new AppError('ADMIN_FORBIDDEN');
      return {ok:true};
    },false);
  }
  async unsubscribe(who:FinanceIdentity,key:string|readonly string[]|undefined,requestId:string):Promise<JsonObject> {
    return this.finance.command(who,'push.unsubscribe',{},key,requestId,async(c,a)=>{
      if(who.kind!=='admin')throw new AppError('ADMIN_FORBIDDEN');
      await c.query(`UPDATE app.business_push_subscriptions SET active=false WHERE user_id=$1 AND session_id=$2`,[a.userId,who.known.sessionId]);return {ok:true};
    },false);
  }
  onApplicationBootstrap():void {if(this.config.appEnv==='test')return;this.timer=setInterval(()=>void this.tick(),10000);this.timer.unref();}
  onApplicationShutdown():void {if(this.timer)clearInterval(this.timer);}
  async tick():Promise<void> {
    if(this.running)return;this.running=true;
    try{
      // Durable one-time reminder even when push is disabled, permissions denied or a provider is down.
      await this.tx.withTransaction(async c=>{
        const rows=(await c.query<{request_id:string}>(`UPDATE app.business_finance_requests SET reminded_at=clock_timestamp()
          WHERE request_id IN (SELECT request_id FROM app.business_finance_requests WHERE state='PENDING' AND reminded_at IS NULL AND created_at<clock_timestamp()-interval '30 minutes' ORDER BY created_at LIMIT 50 FOR UPDATE SKIP LOCKED)
          RETURNING request_id`)).rows;
        for(const r of rows)await c.query(`INSERT INTO app.business_finance_messages(request_id,sender_role,body,event_kind) VALUES($1,'SYSTEM_EVENT','Yêu cầu đang chờ kiểm tra quá 30 phút.','OVERDUE')`,[r.request_id]);
      });
      if(!this.config.businessPush)return;
      for(let n=0;n<20;n++)if(!await this.sendOne())break;
    }catch{this.log.warn('business_push_tick_failed');}finally{this.running=false;}
  }
  async sendOne():Promise<boolean> {
    const config=this.config.businessPush;if(!config)return false;
    const lease=randomUUID();
    const job=await this.tx.withTransaction(async c=>{
      const r=(await c.query<{message_sequence:string;subscription_id:string;attempts:number}>(`UPDATE app.business_push_jobs SET attempts=attempts+1,next_at=clock_timestamp()+interval '60 seconds',lease_token=$1
        WHERE (message_sequence,subscription_id) IN (SELECT message_sequence,subscription_id FROM app.business_push_jobs WHERE state='PENDING' AND next_at<=clock_timestamp() ORDER BY next_at LIMIT 1 FOR UPDATE SKIP LOCKED)
        RETURNING message_sequence::text,subscription_id,attempts`,[lease])).rows[0];
      if(!r)return undefined;
      // Check the bound session, user, factor and finance right AGAIN before every send. No payload has financial information.
      let sub: {endpoint:string;p256dh:string;auth:string;request_id:string;token_digest:string}|undefined=(await c.query<{endpoint:string;p256dh:string;auth:string;request_id:string;token_digest:string}>(`SELECT p.endpoint,p.p256dh,p.auth,msg.request_id,s.token_digest FROM app.business_push_subscriptions p
        JOIN app.admin_sessions s ON s.session_id=p.session_id AND s.user_id=p.user_id
        JOIN app.business_finance_messages msg ON msg.sequence_no=$2::bigint
        WHERE p.subscription_id=$1 AND p.active`,[r.subscription_id,r.message_sequence])).rows[0];
      if(sub) {
        const known=await this.sessions.findByDigest(c,sub.token_digest);
        if(!known||known.revoked||known.expiredAtLookup)sub=undefined;
        else {
          try {await this.finance.room(c,{kind:'admin',known},sub.request_id);}
          catch(error){if(error instanceof AppError)sub=undefined;else throw error;}
        }
      }
      if(!sub)await c.query(`UPDATE app.business_push_jobs SET state='SKIPPED' WHERE message_sequence=$1 AND subscription_id=$2 AND lease_token=$3`,[r.message_sequence,r.subscription_id,lease]);
      return {...r,sub};
    });
    if(!job)return false;if(!job.sub)return true;
    let state='SENT';let deactivate=false;
    try{
      await webpush.sendNotification({endpoint:job.sub.endpoint,keys:{p256dh:job.sub.p256dh,auth:job.sub.auth}},JSON.stringify({title:'11Ship',body:'Có cập nhật mới cần kiểm tra.',url:`/business/chat?request=${job.sub.request_id}`}),{vapidDetails:{subject:config.subject,publicKey:config.publicKey,privateKey:config.privateKey},TTL:300,timeout:10000,urgency:'normal'});
    }catch(error){
      const status=typeof error==='object'&&error!==null&&'statusCode' in error?Number(error.statusCode):0;
      deactivate=status===404||status===410;state=deactivate||job.attempts>=5?'FAILED':'PENDING';
    }
    await this.tx.withTransaction(async c=>{
      await c.query(`UPDATE app.business_push_jobs SET state=$4,next_at=clock_timestamp()+interval '2 minutes' WHERE message_sequence=$1 AND subscription_id=$2 AND lease_token=$3`,[job.message_sequence,job.subscription_id,lease,state]);
      if(deactivate)await c.query(`UPDATE app.business_push_subscriptions SET active=false WHERE subscription_id=$1`,[job.subscription_id]);
    });return true;
  }
}
