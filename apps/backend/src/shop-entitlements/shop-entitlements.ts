import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../transaction/transaction-context';
import { JsonObject } from '../idempotency/idempotency-executor';
@Injectable()
export class ShopEntitlements {
  async policy(c:TransactionContext,lock=false):Promise<{visible_limit:number;messages_per_minute:number;version:string}> {
    return (await c.query<{visible_limit:number;messages_per_minute:number;version:string}>(`SELECT * FROM app.shop_finance_policy WHERE singleton${lock?' FOR SHARE':''}`)).rows[0]!;
  }
  async expanded(c:TransactionContext,shopId:string):Promise<boolean> {
    return (await c.query<{action:string}>(`SELECT action FROM app.shop_entitlement_grants WHERE shop_id=$1 AND entitlement='MENU_EXPANDED' ORDER BY seq DESC LIMIT 1`,[shopId])).rows[0]?.action==='GRANT';
  }
  async view(c:TransactionContext,shopId:string):Promise<JsonObject> {
    const rows=(await c.query<{grant_id:string;action:string;reason:string;actor_user_id:string;payment_request_id:string|null;created_at:Date;seq:string}>(`SELECT * FROM app.shop_entitlement_grants WHERE shop_id=$1 ORDER BY seq DESC LIMIT 100`,[shopId])).rows;
    return {shop_id:shopId,expanded:rows[0]?.action==='GRANT',version:rows[0]?.seq??'0',history:rows.map(r=>({grant_id:r.grant_id,action:r.action,reason:r.reason,actor_user_id:r.actor_user_id,payment_request_id:r.payment_request_id,created_at:r.created_at.toISOString()}))};
  }
}
