import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../transaction/transaction-context';

// SQL of "Bảng phân tích vận hành" (issue #241). Read only. Every figure comes from the rows the modules own (orders, deliveries, assignments, the 15-minute Online
// counts); nothing is stored here but those counts. Times are PostgreSQL clock values; the day / hour buckets are Vietnam time (Asia/Ho_Chi_Minh). A figure whose
// denominator is 0 is returned as null by the service ("chưa đủ dữ liệu"), never as 0.

export type SourceFilter = 'ALL' | 'ORDER' | 'DIRECT';

const VN = `'Asia/Ho_Chi_Minh'`;
const num = (v: string | number | null | undefined): number => (v === null || v === undefined ? 0 : Number(v));
const nullableNum = (v: string | number | null | undefined): number | null => (v === null || v === undefined ? null : Number(v));

/** The delivery source filter as SQL (the delivery table says ORDER for the dish orders; every other source is a direct call). */
const SOURCE_SQL = `($3::text = 'ALL' OR ($3::text = 'ORDER' AND d.source = 'ORDER') OR ($3::text = 'DIRECT' AND d.source <> 'ORDER'))`;

export interface SearchSummary {
  readonly total: number;
  readonly searching: number;
  readonly matched: number;
  readonly failed: number;
  readonly failedAfterRelease: number;
  readonly cancelledByCreator: number;
  readonly cancelledBySystem: number;
  readonly releases: number;
  readonly matchMedianSeconds: number | null;
  readonly matchP90Seconds: number | null;
}

export interface ShopConfirmRow {
  readonly shopId: string;
  readonly shopName: string;
  readonly samples: number;
  readonly confirmed: number;
  readonly slow: number;
  readonly expired: number;
  readonly rejected: number;
  readonly medianSeconds: number | null;
  readonly p90Seconds: number | null;
}

export interface ConfirmSummary {
  readonly total: number;
  readonly waiting: number;
  readonly confirmed: number;
  readonly slow: number;
  readonly noSnapshot: number;
  readonly expired: number;
  readonly rejected: number;
  readonly cancelledByCustomer: number;
  readonly medianSeconds: number | null;
  readonly p90Seconds: number | null;
}

export interface HeatCell {
  readonly weekday: number;
  readonly hour: number;
  readonly requests: number;
  readonly notMatched: number;
  readonly medianMatchSeconds: number | null;
  readonly supplyAvgOnline: number | null;
  readonly supplyAvgReady: number | null;
  readonly supplySlots: number;
}

export interface FunnelCohort {
  readonly entered: Record<string, number>;
  readonly cancelledAt: Record<string, Record<string, number>>;
  readonly completed: number;
  readonly inProgress: number;
}

export interface DrillRow {
  readonly code: string;
  readonly kind: string;
  readonly shopName: string | null;
  readonly state: string;
  readonly atMs: number;
  readonly detail: string | null;
}

@Injectable()
export class OpsAnalyticsRepository {
  async searchSummary(context: TransactionContext, fromMs: number, toMs: number, source: SourceFilter): Promise<SearchSummary> {
    const result = await context.query<Record<string, string | null>>(
      `WITH s AS (
         SELECT d.delivery_id, d.state,
                EXISTS (SELECT 1 FROM app.delivery_assignments a WHERE a.delivery_id = d.delivery_id) AS had_assignment,
                (SELECT min(a.accepted_at) FROM app.delivery_assignments a WHERE a.delivery_id = d.delivery_id) AS first_accepted,
                d.search_started_at
           FROM app.deliveries d
          WHERE d.created_at >= to_timestamp($1::bigint / 1000.0) AND d.created_at < to_timestamp($2::bigint / 1000.0) AND ${SOURCE_SQL}
       )
       SELECT count(*)::text AS total,
              count(*) FILTER (WHERE state = 'waiting_driver' AND NOT had_assignment)::text AS searching,
              count(*) FILTER (WHERE had_assignment)::text AS matched,
              count(*) FILTER (WHERE state = 'search_stopped' AND NOT had_assignment)::text AS failed,
              count(*) FILTER (WHERE state = 'search_stopped' AND had_assignment)::text AS failed_after_release,
              count(*) FILTER (WHERE state = 'cancelled_by_merchant' AND NOT had_assignment)::text AS cancelled_by_creator,
              count(*) FILTER (WHERE state = 'cancelled_by_system' AND NOT had_assignment)::text AS cancelled_by_system,
              (SELECT count(*) FROM app.delivery_assignments a JOIN s s2 ON s2.delivery_id = a.delivery_id WHERE a.status = 'CANCELLED_BY_SHIPPER')::text AS releases,
              (percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (first_accepted - search_started_at))) FILTER (WHERE had_assignment))::text AS median_s,
              (percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM (first_accepted - search_started_at))) FILTER (WHERE had_assignment))::text AS p90_s
         FROM s`,
      [fromMs, toMs, source],
    );
    const r = result.rows[0] ?? {};
    return {
      total: num(r.total), searching: num(r.searching), matched: num(r.matched), failed: num(r.failed), failedAfterRelease: num(r.failed_after_release),
      cancelledByCreator: num(r.cancelled_by_creator), cancelledBySystem: num(r.cancelled_by_system), releases: num(r.releases),
      matchMedianSeconds: nullableNum(r.median_s) === null ? null : Math.round(num(r.median_s)), matchP90Seconds: nullableNum(r.p90_s) === null ? null : Math.round(num(r.p90_s)),
    };
  }

  /** ORDER only: the wait for the shop. "Slow" = confirmed after the first reminder time the Order itself carries (its own timeout snapshot, never a second SLA). */
  async confirmSummary(context: TransactionContext, fromMs: number, toMs: number): Promise<{ summary: ConfirmSummary; shops: ShopConfirmRow[] }> {
    const base = `FROM app.orders o WHERE o.created_at >= to_timestamp($1::bigint / 1000.0) AND o.created_at < to_timestamp($2::bigint / 1000.0) AND o.scheduled_for IS NULL`;
    const slow = `(o.confirmed_at IS NOT NULL AND o.timeout_snapshot IS NOT NULL AND o.confirmed_at > (o.timeout_snapshot->>'warning_at')::timestamptz)`;
    const total = await context.query<Record<string, string | null>>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE o.status = 'PENDING_CONFIRMATION')::text AS waiting,
              count(*) FILTER (WHERE o.confirmed_at IS NOT NULL)::text AS confirmed,
              count(*) FILTER (WHERE ${slow})::text AS slow,
              count(*) FILTER (WHERE o.confirmed_at IS NOT NULL AND o.timeout_snapshot IS NULL)::text AS no_snapshot,
              count(*) FILTER (WHERE o.status = 'CANCELLED_BY_SYSTEM' AND o.confirmed_at IS NULL)::text AS expired,
              count(*) FILTER (WHERE o.status = 'REJECTED_BY_SHOP')::text AS rejected,
              count(*) FILTER (WHERE o.status = 'CANCELLED_BY_CUSTOMER' AND o.confirmed_at IS NULL)::text AS cancelled_by_customer,
              (percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (o.confirmed_at - o.created_at))) FILTER (WHERE o.confirmed_at IS NOT NULL))::text AS median_s,
              (percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM (o.confirmed_at - o.created_at))) FILTER (WHERE o.confirmed_at IS NOT NULL))::text AS p90_s
         ${base}`,
      [fromMs, toMs],
    );
    const t = total.rows[0] ?? {};
    const shops = await context.query<Record<string, string | null>>(
      `SELECT o.shop_id::text AS shop_id, max(o.shop_name) AS shop_name, count(*)::text AS samples,
              count(*) FILTER (WHERE o.confirmed_at IS NOT NULL)::text AS confirmed,
              count(*) FILTER (WHERE ${slow})::text AS slow,
              count(*) FILTER (WHERE o.status = 'CANCELLED_BY_SYSTEM' AND o.confirmed_at IS NULL)::text AS expired,
              count(*) FILTER (WHERE o.status = 'REJECTED_BY_SHOP')::text AS rejected,
              (percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (o.confirmed_at - o.created_at))) FILTER (WHERE o.confirmed_at IS NOT NULL))::text AS median_s,
              (percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM (o.confirmed_at - o.created_at))) FILTER (WHERE o.confirmed_at IS NOT NULL))::text AS p90_s
         ${base} GROUP BY o.shop_id ORDER BY (count(*) FILTER (WHERE ${slow}) + count(*) FILTER (WHERE o.status = 'CANCELLED_BY_SYSTEM' AND o.confirmed_at IS NULL)) DESC, count(*) DESC, o.shop_id LIMIT 50`,
      [fromMs, toMs],
    );
    return {
      summary: {
        total: num(t.total), waiting: num(t.waiting), confirmed: num(t.confirmed), slow: num(t.slow), noSnapshot: num(t.no_snapshot), expired: num(t.expired), rejected: num(t.rejected),
        cancelledByCustomer: num(t.cancelled_by_customer), medianSeconds: nullableNum(t.median_s) === null ? null : Math.round(num(t.median_s)), p90Seconds: nullableNum(t.p90_s) === null ? null : Math.round(num(t.p90_s)),
      },
      shops: shops.rows.map((r) => ({
        shopId: String(r.shop_id), shopName: String(r.shop_name), samples: num(r.samples), confirmed: num(r.confirmed), slow: num(r.slow), expired: num(r.expired), rejected: num(r.rejected),
        medianSeconds: nullableNum(r.median_s) === null ? null : Math.round(num(r.median_s)), p90Seconds: nullableNum(r.p90_s) === null ? null : Math.round(num(r.p90_s)),
      })),
    };
  }

  /** Demand by Vietnam weekday (1 = Monday ... 7 = Sunday) and hour, with the Online counts of the same cell when the 15-minute snapshots exist. */
  async heatmap(context: TransactionContext, fromMs: number, toMs: number, source: SourceFilter): Promise<{ cells: HeatCell[]; snapshotsInPeriod: number }> {
    const demand = await context.query<Record<string, string | null>>(
      `WITH s AS (
         SELECT extract(isodow FROM d.created_at AT TIME ZONE ${VN})::int AS wd, extract(hour FROM d.created_at AT TIME ZONE ${VN})::int AS hr,
                d.state, EXISTS (SELECT 1 FROM app.delivery_assignments a WHERE a.delivery_id = d.delivery_id) AS had_assignment,
                (SELECT min(a.accepted_at) FROM app.delivery_assignments a WHERE a.delivery_id = d.delivery_id) AS first_accepted, d.search_started_at
           FROM app.deliveries d
          WHERE d.created_at >= to_timestamp($1::bigint / 1000.0) AND d.created_at < to_timestamp($2::bigint / 1000.0) AND ${SOURCE_SQL}
       )
       SELECT wd::text, hr::text, count(*)::text AS requests,
              count(*) FILTER (WHERE state = 'search_stopped' AND NOT had_assignment)::text AS not_matched,
              (percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (first_accepted - search_started_at))) FILTER (WHERE had_assignment))::text AS median_s
         FROM s GROUP BY wd, hr ORDER BY wd, hr`,
      [fromMs, toMs, source],
    );
    const supply = await context.query<Record<string, string | null>>(
      `SELECT extract(isodow FROM slot_at AT TIME ZONE ${VN})::int::text AS wd, extract(hour FROM slot_at AT TIME ZONE ${VN})::int::text AS hr,
              avg(online_count)::text AS online, avg(ready_count)::text AS ready, count(*)::text AS slots
         FROM app.ops_online_snapshots WHERE slot_at >= to_timestamp($1::bigint / 1000.0) AND slot_at < to_timestamp($2::bigint / 1000.0) GROUP BY 1, 2`,
      [fromMs, toMs],
    );
    const slots = supply.rows.reduce((sum, r) => sum + num(r.slots), 0);
    const bySlot = new Map(supply.rows.map((r) => [`${String(r.wd)}:${String(r.hr)}`, r]));
    const keys = new Set<string>([...demand.rows.map((r) => `${String(r.wd)}:${String(r.hr)}`), ...supply.rows.map((r) => `${String(r.wd)}:${String(r.hr)}`)]);
    const demandBy = new Map(demand.rows.map((r) => [`${String(r.wd)}:${String(r.hr)}`, r]));
    const cells: HeatCell[] = [...keys].sort().map((key) => {
      const [wd, hr] = key.split(':') as [string, string];
      const d = demandBy.get(key);
      const s = bySlot.get(key);
      return {
        weekday: Number(wd), hour: Number(hr), requests: num(d?.requests), notMatched: num(d?.not_matched),
        medianMatchSeconds: nullableNum(d?.median_s) === null ? null : Math.round(num(d?.median_s)),
        supplyAvgOnline: s === undefined ? null : Math.round(num(s.online) * 10) / 10, supplyAvgReady: s === undefined ? null : Math.round(num(s.ready) * 10) / 10, supplySlots: num(s?.slots),
      };
    });
    return { cells, snapshotsInPeriod: slots };
  }

  /**
   * The last step of every Order that ended without being delivered, and how many Orders ENTERED each step (the denominator). Steps: AWAITING_SHOP -> CONFIRMED (no
   * delivery yet) -> SEARCHING -> ASSIGNED (a Shipper holds it, not picked up) -> PICKED_UP -> COMPLETED. An Order still running is counted apart, not as cancelled.
   */
  async orderFunnel(context: TransactionContext, fromMs: number, toMs: number): Promise<FunnelCohort> {
    const result = await context.query<{ step: string; actor: string | null; n: string; kind: string }>(
      `WITH o2 AS (
         SELECT o.order_id, o.status, o.end_actor, o.confirmed_at,
                EXISTS (SELECT 1 FROM app.deliveries d WHERE d.order_id = o.order_id) AS has_delivery,
                EXISTS (SELECT 1 FROM app.deliveries d JOIN app.delivery_assignments a ON a.delivery_id = d.delivery_id WHERE d.order_id = o.order_id) AS has_assignment,
                EXISTS (SELECT 1 FROM app.deliveries d WHERE d.order_id = o.order_id AND d.picked_up_at IS NOT NULL) AS was_picked_up
           FROM app.orders o
          WHERE o.created_at >= to_timestamp($1::bigint / 1000.0) AND o.created_at < to_timestamp($2::bigint / 1000.0)
       ), t AS (
         SELECT *, CASE WHEN confirmed_at IS NULL THEN 'AWAITING_SHOP' WHEN NOT has_delivery THEN 'CONFIRMED' WHEN NOT has_assignment THEN 'SEARCHING'
                        WHEN NOT was_picked_up THEN 'ASSIGNED' ELSE 'PICKED_UP' END AS last_step
           FROM o2
       )
       SELECT 'entered' AS kind, 'AWAITING_SHOP' AS step, NULL AS actor, count(*)::text AS n FROM t
       UNION ALL SELECT 'entered', 'CONFIRMED', NULL, count(*) FILTER (WHERE confirmed_at IS NOT NULL)::text FROM t
       UNION ALL SELECT 'entered', 'SEARCHING', NULL, count(*) FILTER (WHERE has_delivery)::text FROM t
       UNION ALL SELECT 'entered', 'ASSIGNED', NULL, count(*) FILTER (WHERE has_assignment)::text FROM t
       UNION ALL SELECT 'entered', 'PICKED_UP', NULL, count(*) FILTER (WHERE was_picked_up)::text FROM t
       UNION ALL SELECT 'completed', 'COMPLETED', NULL, count(*) FILTER (WHERE status = 'COMPLETED')::text FROM t
       UNION ALL SELECT 'running', 'RUNNING', NULL, count(*) FILTER (WHERE status IN ('PENDING_CONFIRMATION', 'PREPARING'))::text FROM t
       UNION ALL SELECT 'cancelled', last_step, COALESCE(end_actor, 'UNKNOWN'), count(*)::text FROM t
                  WHERE status IN ('CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_SHOP', 'CANCELLED_BY_SYSTEM', 'REJECTED_BY_SHOP', 'NOT_COMPLETED') GROUP BY last_step, end_actor`,
      [fromMs, toMs],
    );
    const entered: Record<string, number> = {};
    const cancelledAt: Record<string, Record<string, number>> = {};
    let completed = 0;
    let inProgress = 0;
    for (const r of result.rows) {
      if (r.kind === 'entered') entered[r.step] = num(r.n);
      else if (r.kind === 'completed') completed = num(r.n);
      else if (r.kind === 'running') inProgress = num(r.n);
      else (cancelledAt[r.step] ??= {})[String(r.actor)] = num(r.n);
    }
    return { entered, cancelledAt, completed, inProgress };
  }

  /** Direct calls (no dish order): the same steps from SEARCHING on; the confirmation steps do not exist for them. */
  async directFunnel(context: TransactionContext, fromMs: number, toMs: number): Promise<FunnelCohort> {
    const result = await context.query<{ kind: string; step: string; actor: string | null; n: string }>(
      `WITH t AS (
         SELECT d.state, EXISTS (SELECT 1 FROM app.delivery_assignments a WHERE a.delivery_id = d.delivery_id) AS has_assignment, (d.picked_up_at IS NOT NULL) AS was_picked_up,
                CASE WHEN d.state = 'cancelled_by_system' THEN 'SYSTEM' WHEN d.state = 'cancelled_by_merchant' THEN 'CREATOR' ELSE 'UNKNOWN' END AS actor,
                CASE WHEN NOT EXISTS (SELECT 1 FROM app.delivery_assignments a WHERE a.delivery_id = d.delivery_id) THEN 'SEARCHING' WHEN d.picked_up_at IS NULL THEN 'ASSIGNED' ELSE 'PICKED_UP' END AS last_step
           FROM app.deliveries d
          WHERE d.source <> 'ORDER' AND d.created_at >= to_timestamp($1::bigint / 1000.0) AND d.created_at < to_timestamp($2::bigint / 1000.0)
       )
       SELECT 'entered' AS kind, 'SEARCHING' AS step, NULL AS actor, count(*)::text AS n FROM t
       UNION ALL SELECT 'entered', 'ASSIGNED', NULL, count(*) FILTER (WHERE has_assignment)::text FROM t
       UNION ALL SELECT 'entered', 'PICKED_UP', NULL, count(*) FILTER (WHERE was_picked_up)::text FROM t
       UNION ALL SELECT 'completed', 'COMPLETED', NULL, count(*) FILTER (WHERE state = 'completed')::text FROM t
       UNION ALL SELECT 'running', 'RUNNING', NULL, count(*) FILTER (WHERE state IN ('waiting_driver', 'accepted', 'location_confirmed', 'picked_up', 'delivering'))::text FROM t
       UNION ALL SELECT 'cancelled', last_step, actor, count(*)::text FROM t WHERE state IN ('cancelled_by_merchant', 'cancelled_by_system', 'search_stopped', 'failed') GROUP BY last_step, actor`,
      [fromMs, toMs],
    );
    const entered: Record<string, number> = {};
    const cancelledAt: Record<string, Record<string, number>> = {};
    let completed = 0;
    let inProgress = 0;
    for (const r of result.rows) {
      if (r.kind === 'entered') entered[r.step] = num(r.n);
      else if (r.kind === 'completed') completed = num(r.n);
      else if (r.kind === 'running') inProgress = num(r.n);
      else (cancelledAt[r.step] ??= {})[String(r.actor)] = num(r.n);
    }
    return { entered, cancelledAt, completed, inProgress };
  }

  /** One page of the records behind a figure (code, shop, state, time): no phone, no address, no amount. */
  async drilldown(context: TransactionContext, kind: 'search_failed' | 'slow_confirm' | 'expired_confirm' | 'cancelled_at_step', fromMs: number, toMs: number, source: SourceFilter, step: string | null, limit: number, offset: number): Promise<{ rows: DrillRow[]; total: number }> {
    if (kind === 'search_failed') {
      const where = `d.state = 'search_stopped' AND d.created_at >= to_timestamp($1::bigint / 1000.0) AND d.created_at < to_timestamp($2::bigint / 1000.0) AND ${SOURCE_SQL}`;
      const total = await context.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.deliveries d WHERE ${where}`, [fromMs, toMs, source]);
      const rows = await context.query<{ code: string; source: string; shop_name: string; state: string; at: string; had: boolean }>(
        `SELECT d.code, d.source, d.shop_name, d.state, (extract(epoch FROM d.created_at) * 1000)::bigint::text AS at,
                EXISTS (SELECT 1 FROM app.delivery_assignments a WHERE a.delivery_id = d.delivery_id) AS had
           FROM app.deliveries d WHERE ${where} ORDER BY d.created_at DESC, d.delivery_id LIMIT $4 OFFSET $5`,
        [fromMs, toMs, source, limit, offset],
      );
      return { total: num(total.rows[0]?.n), rows: rows.rows.map((r) => ({ code: r.code, kind: r.source === 'ORDER' ? 'ORDER' : 'DIRECT', shopName: r.shop_name, state: r.state, atMs: num(r.at), detail: r.had ? 'Đã có shipper nhận rồi bỏ, hết thời gian tìm' : 'Chưa có shipper nhận, hết thời gian tìm' })) };
    }
    const filter =
      kind === 'slow_confirm'
        ? `o.confirmed_at IS NOT NULL AND o.timeout_snapshot IS NOT NULL AND o.confirmed_at > (o.timeout_snapshot->>'warning_at')::timestamptz`
        : kind === 'expired_confirm'
          ? `o.status = 'CANCELLED_BY_SYSTEM' AND o.confirmed_at IS NULL`
          : `o.status IN ('CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_SHOP', 'CANCELLED_BY_SYSTEM', 'REJECTED_BY_SHOP', 'NOT_COMPLETED')
             AND (CASE WHEN o.confirmed_at IS NULL THEN 'AWAITING_SHOP'
                       WHEN NOT EXISTS (SELECT 1 FROM app.deliveries d WHERE d.order_id = o.order_id) THEN 'CONFIRMED'
                       WHEN NOT EXISTS (SELECT 1 FROM app.deliveries d JOIN app.delivery_assignments a ON a.delivery_id = d.delivery_id WHERE d.order_id = o.order_id) THEN 'SEARCHING'
                       WHEN NOT EXISTS (SELECT 1 FROM app.deliveries d WHERE d.order_id = o.order_id AND d.picked_up_at IS NOT NULL) THEN 'ASSIGNED' ELSE 'PICKED_UP' END) = $3::text`;
    const params: unknown[] = kind === 'cancelled_at_step' ? [fromMs, toMs, step ?? ''] : [fromMs, toMs];
    const where = `o.created_at >= to_timestamp($1::bigint / 1000.0) AND o.created_at < to_timestamp($2::bigint / 1000.0) AND ${filter}`;
    const total = await context.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.orders o WHERE ${where}`, params);
    const rows = await context.query<{ code: string; shop_name: string; status: string; at: string; end_reason: string | null }>(
      `SELECT COALESCE(app.shop_display_order(o.order_id), o.code) AS code, o.shop_name, o.status, (extract(epoch FROM o.created_at) * 1000)::bigint::text AS at, o.end_reason
         FROM app.orders o WHERE ${where} ORDER BY o.created_at DESC, o.order_id LIMIT $${String(params.length + 1)} OFFSET $${String(params.length + 2)}`,
      [...params, limit, offset],
    );
    return { total: num(total.rows[0]?.n), rows: rows.rows.map((r) => ({ code: r.code, kind: 'ORDER', shopName: r.shop_name, state: r.status, atMs: num(r.at), detail: r.end_reason })) };
  }

  // ---- the 15-minute Online counts --------------------------------------------------------------------------------------------

  /** Records the slot ONCE (a second tick of the same slot changes nothing). Counts only. */
  async recordSnapshot(context: TransactionContext, slotMs: number, onlineCount: number, readyCount: number): Promise<boolean> {
    const result = await context.query(
      `INSERT INTO app.ops_online_snapshots (slot_at, online_count, ready_count) VALUES (to_timestamp($1::bigint / 1000.0), $2::int, $3::int) ON CONFLICT (slot_at) DO NOTHING`,
      [slotMs, onlineCount, Math.min(readyCount, onlineCount)],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async purgeSnapshotsBefore(context: TransactionContext, beforeMs: number): Promise<number> {
    const result = await context.query('DELETE FROM app.ops_online_snapshots WHERE slot_at < to_timestamp($1::bigint / 1000.0)', [beforeMs]);
    return result.rowCount ?? 0;
  }
}
