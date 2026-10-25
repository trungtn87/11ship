import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../transaction/transaction-context';
import { Period } from '../admin-m12/vietnam-time';
import { JsonObject } from '../idempotency/idempotency-executor';
import { TechnicalError } from '../common/app-errors';
const safe=(v:string):number=>{const n=Number(v);if(!Number.isSafeInteger(n))throw new TechnicalError('internal','Aggregate exceeds safe integer');return n;};
@Injectable()
export class BusinessTradeReader {
  async summary(c:TransactionContext,p:Period,money:boolean):Promise<JsonObject> {
    // Each customer Order and each root DIRECT call is one transaction. Recalls never add a transaction or duplicate its goods.
    const rows=(await c.query<Record<string,string>>(`WITH trades AS (
      SELECT o.order_id AS id,o.shop_id,o.items_total_vnd AS goods FROM app.orders o
        WHERE o.created_at>=to_timestamp($1::bigint/1000.0) AND o.created_at<to_timestamp($2::bigint/1000.0)
      UNION ALL
      SELECT d.delivery_id,d.shop_id,d.goods_value_vnd FROM app.deliveries d WHERE d.source='DIRECT' AND d.previous_delivery_id IS NULL
        AND d.created_at>=to_timestamp($1::bigint/1000.0) AND d.created_at<to_timestamp($2::bigint/1000.0))
      SELECT count(*)::text AS transactions,COALESCE(sum(goods),0)::text AS goods_vnd FROM trades`,[p.fromMs,p.toMs])).rows[0]!;
    const ranking=(await c.query<{shop_id:string;orders:string;goods:string}>(`WITH t AS (
      SELECT shop_id,items_total_vnd AS goods FROM app.orders WHERE created_at>=to_timestamp($1::bigint/1000.0) AND created_at<to_timestamp($2::bigint/1000.0)
      UNION ALL SELECT shop_id,goods_value_vnd FROM app.deliveries WHERE source='DIRECT' AND previous_delivery_id IS NULL
        AND created_at>=to_timestamp($1::bigint/1000.0) AND created_at<to_timestamp($2::bigint/1000.0))
      SELECT shop_id,count(*)::text AS orders,sum(t.goods)::text AS goods FROM t
      GROUP BY shop_id ORDER BY count(*) DESC,shop_id LIMIT 101`,[p.fromMs,p.toMs])).rows;
    const quality=(await c.query<{reviews:string;stars:string|null;complaints:string;seconds:string|null}>(`SELECT
      (SELECT count(*) FROM app.reviews WHERE created_at>=to_timestamp($1::bigint/1000.0) AND created_at<to_timestamp($2::bigint/1000.0))::text AS reviews,
      (SELECT round(avg(stars),2) FROM app.reviews WHERE created_at>=to_timestamp($1::bigint/1000.0) AND created_at<to_timestamp($2::bigint/1000.0))::text AS stars,
      (SELECT count(*) FROM app.complaints WHERE created_at>=to_timestamp($1::bigint/1000.0) AND created_at<to_timestamp($2::bigint/1000.0))::text AS complaints,
      (SELECT round(avg(extract(epoch FROM(closed_at-created_at)))) FROM app.complaints WHERE closed_at>=to_timestamp($1::bigint/1000.0) AND closed_at<to_timestamp($2::bigint/1000.0))::text AS seconds`,[p.fromMs,p.toMs])).rows[0]!;
    let shopPayments:JsonObject={status:'FORBIDDEN'};
    if(money){
      const r=(await c.query<{total:string;count:string}>(`SELECT COALESCE(sum(actual_amount_vnd),0)::text AS total,count(*)::text AS count FROM app.business_finance_requests
        WHERE kind='SHOP_PAYMENT' AND state='CONFIRMED' AND resolved_at>=to_timestamp($1::bigint/1000.0) AND resolved_at<to_timestamp($2::bigint/1000.0)`,[p.fromMs,p.toMs])).rows[0]!;
      shopPayments={status:'OK',confirmed_vnd:safe(r.total),confirmed_count:safe(r.count)};
    }
    return {transactions:safe(rows.transactions!),goods_vnd:safe(rows.goods_vnd!),goods_note:'Giá trị đơn tạo trong kỳ, gồm cả đơn hủy; mỗi đơn chỉ tính một lần. Không phải doanh thu nền tảng.',ranking_truncated:ranking.length>100,ranking:ranking.slice(0,100).map(r=>({shop_id:r.shop_id,orders:safe(r.orders),goods_vnd:safe(r.goods)})),quality:{reviews:safe(quality.reviews),average_stars:quality.stars===null?null:Number(quality.stars),complaints:safe(quality.complaints),average_resolution_seconds:quality.seconds===null?null:safe(quality.seconds)},shop_payments:shopPayments};
  }
}
