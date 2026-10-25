import { DriverRepository } from '../driver/driver-repository';
import { ShopRepository } from '../shop/shop-repository';
import { Injectable } from '@nestjs/common';
import { JsonObject } from '../idempotency/idempotency-executor';
import { TransactionContext } from '../transaction/transaction-context';

export interface FinanceRow {
  request_id: string; kind: 'TOPUP' | 'SHOP_PAYMENT'; owner_user_id: string; shop_id: string | null;
  amount_requested_vnd: string; actual_amount_vnd: string | null; state: string; version: string;
  created_at: Date; resolved_at: Date | null; unread?: string; label?: string;
}
export function financeView(r: FinanceRow): JsonObject {
  return { request_id:r.request_id,kind:r.kind,amount_requested_vnd:Number(r.amount_requested_vnd),actual_amount_vnd:r.actual_amount_vnd===null?null:Number(r.actual_amount_vnd),state:r.state,version:Number(r.version),created_at:r.created_at.toISOString(),resolved_at:r.resolved_at?.toISOString()??null,unread:Number(r.unread??0),label:r.label??(r.kind==='TOPUP'?'Nạp ví shipper':'Thanh toán của quán') };
}
@Injectable()
export class BusinessFinanceRepository {
  constructor(private readonly shops:ShopRepository,private readonly drivers:DriverRepository){}
  async namedView(c:TransactionContext,row:FinanceRow):Promise<JsonObject>{
    const names=await this.shops.namesOf(c,row.shop_id?[row.shop_id]:[]);const codes=await this.drivers.codesForUsers(c,[row.owner_user_id]);
    return financeView({...row,label:row.shop_id?names.get(row.shop_id):`Nạp ví · ${codes.get(row.owner_user_id)??'Shipper'}`});
  }
  async find(c: TransactionContext, requestId: string, lock = false): Promise<FinanceRow | undefined> {
    return (await c.query<FinanceRow>(`SELECT * FROM app.business_finance_requests WHERE request_id=$1::uuid${lock?' FOR UPDATE':''}`,[requestId])).rows[0];
  }
  async list(c: TransactionContext, userId: string, admin: boolean, state: string | null, before: string | null): Promise<JsonObject> {
    const rows = (await c.query<FinanceRow>(`SELECT r.*,
      (SELECT count(*) FROM app.business_finance_messages m WHERE m.request_id=r.request_id
        AND m.sender_user_id IS DISTINCT FROM $1::uuid AND m.sequence_no>COALESCE((SELECT sequence_no FROM app.business_finance_reads WHERE user_id=$1::uuid AND request_id=r.request_id),0))::text AS unread
      FROM app.business_finance_requests r WHERE ($2::boolean OR r.owner_user_id=$1::uuid)
        AND ($3::text IS NULL OR r.state=$3)
        AND ($4::uuid IS NULL OR (r.created_at,r.request_id)<(SELECT created_at,request_id FROM app.business_finance_requests WHERE request_id=$4::uuid))
      ORDER BY r.created_at DESC,r.request_id DESC LIMIT 51`,[userId,admin,state,before])).rows;
    const names=await this.shops.namesOf(c,rows.flatMap(r=>r.shop_id?[r.shop_id]:[]));
    const codes=await this.drivers.codesForUsers(c,rows.filter(r=>r.kind==='TOPUP').map(r=>r.owner_user_id));
    const items=rows.slice(0,50).map(r=>({...r,label:r.shop_id?names.get(r.shop_id):`Nạp ví · ${codes.get(r.owner_user_id)??'Shipper'}`}));const last=items.at(-1);
    return {items:items.map(financeView),has_more:rows.length>50,next_before:rows.length>50&&last?last.request_id:null};
  }
  async messages(c: TransactionContext, requestId: string, before: string | null): Promise<JsonObject> {
    const rows=(await c.query<{sequence_no:string;sender_role:string;body:string;created_at:Date}>(`SELECT sequence_no::text,sender_role,body,created_at FROM app.business_finance_messages
      WHERE request_id=$1::uuid AND ($2::bigint IS NULL OR sequence_no<$2::bigint) ORDER BY sequence_no DESC LIMIT 51`,[requestId,before])).rows;
    const items=rows.slice(0,50);
    return {items:items.reverse().map(r=>({sequence:r.sequence_no,role:r.sender_role,body:r.body,created_at:r.created_at.toISOString()})),has_more:rows.length>50,next_before:rows.length>50?items[0]?.sequence_no??null:null};
  }
  async message(c: TransactionContext, requestId: string, userId: string | null, role: string, body: string): Promise<string> {
    return (await c.query<{sequence_no:string}>(`INSERT INTO app.business_finance_messages(request_id,sender_user_id,sender_role,body) VALUES($1::uuid,$2::uuid,$3,$4) RETURNING sequence_no::text`,[requestId,userId,role,body])).rows[0]!.sequence_no;
  }
  async seen(c: TransactionContext,userId:string,requestId:string,seq:string):Promise<void> {
    // Only acknowledge messages that actually belong to this room, never a future watermark.
    await c.query(`INSERT INTO app.business_finance_reads(user_id,request_id,sequence_no)
      SELECT $1::uuid,$2::uuid,COALESCE(max(sequence_no),0) FROM app.business_finance_messages WHERE request_id=$2::uuid AND sequence_no<=$3::bigint
      ON CONFLICT(user_id,request_id) DO UPDATE SET sequence_no=GREATEST(business_finance_reads.sequence_no,EXCLUDED.sequence_no)`,[userId,requestId,seq]);
  }
  async notifications(c:TransactionContext,userId:string,admin:boolean,before:string|null):Promise<JsonObject> {
    const rows=(await c.query<{sequence_no:string;request_id:string;event_kind:string;created_at:Date;unread:boolean}>(`SELECT m.sequence_no::text,m.request_id,m.event_kind,m.created_at,
      m.sequence_no>COALESCE(rd.sequence_no,0) AS unread FROM app.business_finance_messages m
      JOIN app.business_finance_requests r USING(request_id)
      LEFT JOIN app.business_finance_reads rd ON rd.request_id=r.request_id AND rd.user_id=$1::uuid
      WHERE ($2::boolean OR r.owner_user_id=$1::uuid) AND m.sender_user_id IS DISTINCT FROM $1::uuid
        AND ($3::bigint IS NULL OR m.sequence_no<$3::bigint) ORDER BY m.sequence_no DESC LIMIT 51`,[userId,admin,before])).rows;
    const total=(await c.query<{n:string}>(`SELECT count(*)::text AS n FROM app.business_finance_messages m JOIN app.business_finance_requests r USING(request_id)
      LEFT JOIN app.business_finance_reads rd ON rd.request_id=r.request_id AND rd.user_id=$1::uuid
      WHERE ($2::boolean OR r.owner_user_id=$1::uuid) AND m.sender_user_id IS DISTINCT FROM $1::uuid AND m.sequence_no>COALESCE(rd.sequence_no,0)`,[userId,admin])).rows[0]!.n;
    return {unread:Number(total),items:rows.slice(0,50).map(r=>({sequence:r.sequence_no,request_id:r.request_id,kind:r.event_kind,created_at:r.created_at.toISOString(),unread:r.unread})),next_before:rows.length>50?rows[49]!.sequence_no:null};
  }
}
