import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';

// Shop revenue (issue #391): the value of the dishes of COMPLETED orders of ONE shop over a Vietnam calendar period. Read only. One statement per read, so
// the totals and the per-day rows are one snapshot and always agree. No other money is involved: no delivery fee, no tip, no COD, no wallet movement.
// The value is orders.items_total_vnd, which the database freezes once the order is confirmed (trigger orders_guard), so a COMPLETED order keeps the value it
// had when the shop confirmed it. No discount or voucher column exists on orders at the time of writing (checked against database/migrations).

export const SHOP_REVENUE_TIME_ZONE = 'Asia/Ho_Chi_Minh';

export interface ShopRevenuePeriod {
  /** Inclusive first Vietnam calendar day, YYYY-MM-DD. */
  readonly from: string;
  /** Inclusive last Vietnam calendar day, YYYY-MM-DD. */
  readonly to: string;
}

export interface ShopRevenueTotalsRow {
  /** COMPLETED orders of the shop in the period, one per order. */
  readonly completedCount: bigint;
  /** Sum of items_total_vnd of those orders (whole VND). */
  readonly itemsVnd: bigint;
}

export interface ShopRevenueDayRow extends ShopRevenueTotalsRow {
  /** Vietnam calendar day, YYYY-MM-DD. Days with no completed order are present with zeros. */
  readonly day: string;
}

export interface ShopRevenueOrderRow {
  readonly orderId: string;
  readonly code: string;
  /** The exact instant the order ended, ISO 8601 with microseconds. */
  readonly endedAt: string;
  readonly itemsVnd: bigint;
}

/** A cursor position: the exact ended_at text and the order id of the last row returned. */
export interface ShopRevenueCursor {
  readonly endedAt: string;
  readonly orderId: string;
}

interface RawTotals {
  completed: string;
  items: string;
}

interface RawDay extends RawTotals {
  date: string;
}

function totalsOf(raw: RawTotals): ShopRevenueTotalsRow {
  return { completedCount: bigintOf(raw.completed), itemsVnd: bigintOf(raw.items) };
}

function bigintOf(raw: unknown): bigint {
  if (typeof raw !== 'string' || !/^-?[0-9]{1,19}$/.test(raw)) {
    throw new TechnicalError('internal', 'Database returned an unexpected number');
  }
  return BigInt(raw);
}

@Injectable()
export class ShopRevenueReader {
  /** Totals and every day of the period, from ONE statement (one snapshot). */
  async summary(context: TransactionContext, shopId: string, period: ShopRevenuePeriod): Promise<{ totals: ShopRevenueTotalsRow; days: ShopRevenueDayRow[] }> {
    const result = await context.query<{ totals: RawTotals; days: RawDay[] }>(
      `WITH bounds AS (
         SELECT ($2::date)::timestamp AT TIME ZONE '${SHOP_REVENUE_TIME_ZONE}' AS start_at,
                (($3::date) + 1)::timestamp AT TIME ZONE '${SHOP_REVENUE_TIME_ZONE}' AS end_at
       ),
       base AS (
         SELECT (o.ended_at AT TIME ZONE '${SHOP_REVENUE_TIME_ZONE}')::date AS day, o.items_total_vnd
           FROM app.orders o
           CROSS JOIN bounds b
          WHERE o.shop_id = $1::uuid
            AND o.status = 'COMPLETED'
            AND o.ended_at >= b.start_at
            AND o.ended_at < b.end_at
       ),
       totals AS (
         SELECT count(*)::text AS completed, COALESCE(SUM(items_total_vnd), 0)::text AS items FROM base
       ),
       per_day AS (
         SELECT day, count(*) AS completed, COALESCE(SUM(items_total_vnd), 0) AS items FROM base GROUP BY day
       ),
       days AS (
         SELECT g::date AS day FROM generate_series($2::date, $3::date, interval '1 day') AS g
       )
       SELECT
         (SELECT row_to_json(t) FROM totals t) AS totals,
         (SELECT COALESCE(json_agg(json_build_object(
                   'date', to_char(x.day, 'YYYY-MM-DD'),
                   'completed', COALESCE(p.completed, 0)::text,
                   'items', COALESCE(p.items, 0)::text
                 ) ORDER BY x.day), '[]'::json)
            FROM days x LEFT JOIN per_day p ON p.day = x.day) AS days`,
      [shopId, period.from, period.to],
    );
    const row = result.rows[0];
    if (row === undefined || row.totals === null || !Array.isArray(row.days)) {
      throw new TechnicalError('internal', 'Revenue query returned no totals');
    }
    return { totals: totalsOf(row.totals), days: row.days.map((day) => ({ day: day.date, ...totalsOf(day) })) };
  }

  /**
   * COMPLETED orders of the shop in the period, newest first, after the cursor (keyset on ended_at, order_id). Asks for one row more than `limit`
   * so the caller knows whether another page exists.
   */
  async orders(context: TransactionContext, shopId: string, period: ShopRevenuePeriod, limit: number, cursor: ShopRevenueCursor | undefined): Promise<ShopRevenueOrderRow[]> {
    const result = await context.query<{ order_id: string; code: string; ended_at: string; items_total_vnd: string }>(
      `WITH bounds AS (
         SELECT ($2::date)::timestamp AT TIME ZONE '${SHOP_REVENUE_TIME_ZONE}' AS start_at,
                (($3::date) + 1)::timestamp AT TIME ZONE '${SHOP_REVENUE_TIME_ZONE}' AS end_at
       )
       SELECT o.order_id::text AS order_id, o.code, to_char(o.ended_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS ended_at, o.items_total_vnd::text AS items_total_vnd
         FROM app.orders o
         CROSS JOIN bounds b
        WHERE o.shop_id = $1::uuid
          AND o.status = 'COMPLETED'
          AND o.ended_at >= b.start_at
          AND o.ended_at < b.end_at
          AND ($4::timestamptz IS NULL OR (o.ended_at, o.order_id) < ($4::timestamptz, $5::uuid))
        ORDER BY o.ended_at DESC, o.order_id DESC
        LIMIT $6`,
      [shopId, period.from, period.to, cursor?.endedAt ?? null, cursor?.orderId ?? null, limit + 1],
    );
    return result.rows.map((row) => ({
      orderId: row.order_id,
      code: row.code,
      endedAt: row.ended_at,
      itemsVnd: bigintOf(row.items_total_vnd),
    }));
  }
}
