import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';

// M07's read side for the administration reports (M12-E). Plain aggregates over the owner's own tables (deliveries, delivery_assignments, delivery_incidents); nothing is
// written and no figure is derived from another module's data. The moment a delivery is counted at is named by the caller: its creation (`created`) or the moment it
// ended (`ended`: completed, failed, cancelled by the shop or search stopped). Days are days of the Vietnam clock.

export type ReportBasis = 'created' | 'ended';

export interface DayRow {
  readonly day: string;
  readonly total: number;
  readonly completed: number;
  readonly failed: number;
  readonly cancelled: number;
  readonly stopped: number;
  readonly active: number;
}

export interface DeliverySummary {
  readonly total: number;
  readonly completed: number;
  readonly failed: number;
  readonly cancelled: number;
  readonly stopped: number;
  readonly active: number;
  readonly direct: number;
  readonly fromOrder: number;
  /** Deliveries created by calling again (they point back at an earlier one): a recall is a new delivery, never a new Order. */
  readonly recalls: number;
  readonly goodsValueVnd: number;
  /** Fees of the COMPLETED deliveries: money between the parties, never platform revenue. */
  readonly completedFeeVnd: number;
}

export interface ShopRow {
  readonly shopId: string;
  readonly shopName: string;
  readonly total: number;
  readonly completed: number;
  readonly failed: number;
  readonly cancelled: number;
  readonly stopped: number;
}

export interface ShipperRow {
  readonly driverId: string;
  readonly accepted: number;
  readonly completed: number;
  readonly failed: number;
  readonly cancelledByShipper: number;
  readonly releasedByAdmin: number;
  readonly cancelledByShop: number;
}

export interface QualitySummary {
  readonly failureReasons: ReadonlyArray<{ readonly reason: string; readonly count: number }>;
  readonly custodyOpen: number;
  readonly stoppedNotRecalled: number;
  readonly adminReleases: number;
  readonly shipperReleases: number;
  readonly assignmentsAccepted: number;
  /** Average seconds from the start of the search to the first acceptance, over the deliveries created in the period that were accepted; null when none was. */
  readonly avgSecondsToAccept: number | null;
  readonly acceptedDeliveries: number;
}

const DAY_EXPR = (column: string): string => `to_char(date_trunc('day', ${column} AT TIME ZONE 'Asia/Ho_Chi_Minh'), 'YYYY-MM-DD')`;

function whole(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new TechnicalError('internal', 'Database returned an unexpected number');
  }
  return value;
}

const column = (basis: ReportBasis): string => (basis === 'created' ? 'd.created_at' : 'd.ended_at');

@Injectable()
export class DeliveryReportReader {
  async perDay(context: TransactionContext, basis: ReportBasis, fromMs: number, toMs: number): Promise<DayRow[]> {
    const result = await context.query<Record<string, string>>(
      `SELECT ${DAY_EXPR(column(basis))} AS day, count(*)::text AS total,
              count(*) FILTER (WHERE d.state = 'completed')::text AS completed, count(*) FILTER (WHERE d.state = 'failed')::text AS failed,
              count(*) FILTER (WHERE d.state = 'cancelled_by_merchant')::text AS cancelled, count(*) FILTER (WHERE d.state = 'search_stopped')::text AS stopped,
              count(*) FILTER (WHERE d.state NOT IN ('completed', 'failed', 'cancelled_by_merchant', 'search_stopped'))::text AS active
         FROM app.deliveries d
        WHERE ${column(basis)} >= to_timestamp($1::bigint / 1000.0) AND ${column(basis)} < to_timestamp($2::bigint / 1000.0)
        GROUP BY 1 ORDER BY 1`,
      [fromMs, toMs],
    );
    return result.rows.map((row) => ({ day: row.day as string, total: whole(row.total), completed: whole(row.completed), failed: whole(row.failed), cancelled: whole(row.cancelled), stopped: whole(row.stopped), active: whole(row.active) }));
  }

  async summary(context: TransactionContext, basis: ReportBasis, fromMs: number, toMs: number): Promise<DeliverySummary> {
    const result = await context.query<Record<string, string>>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE d.state = 'completed')::text AS completed, count(*) FILTER (WHERE d.state = 'failed')::text AS failed,
              count(*) FILTER (WHERE d.state = 'cancelled_by_merchant')::text AS cancelled, count(*) FILTER (WHERE d.state = 'search_stopped')::text AS stopped,
              count(*) FILTER (WHERE d.state NOT IN ('completed', 'failed', 'cancelled_by_merchant', 'search_stopped'))::text AS active,
              count(*) FILTER (WHERE d.source = 'DIRECT')::text AS direct, count(*) FILTER (WHERE d.source = 'ORDER')::text AS from_order,
              count(*) FILTER (WHERE d.previous_delivery_id IS NOT NULL)::text AS recalls,
              COALESCE(sum(d.goods_value_vnd), 0)::text AS goods, COALESCE(sum(d.fee_vnd) FILTER (WHERE d.state = 'completed'), 0)::text AS fee
         FROM app.deliveries d
        WHERE ${column(basis)} >= to_timestamp($1::bigint / 1000.0) AND ${column(basis)} < to_timestamp($2::bigint / 1000.0)`,
      [fromMs, toMs],
    );
    const row = result.rows[0] as Record<string, string>;
    return {
      total: whole(row.total), completed: whole(row.completed), failed: whole(row.failed), cancelled: whole(row.cancelled), stopped: whole(row.stopped), active: whole(row.active),
      direct: whole(row.direct), fromOrder: whole(row.from_order), recalls: whole(row.recalls), goodsValueVnd: whole(row.goods), completedFeeVnd: whole(row.fee),
    };
  }

  async perShop(context: TransactionContext, basis: ReportBasis, fromMs: number, toMs: number, limit: number): Promise<ShopRow[]> {
    const result = await context.query<Record<string, string>>(
      `SELECT d.shop_id::text AS shop_id, (array_agg(d.shop_name ORDER BY d.created_at DESC))[1] AS shop_name, count(*)::text AS total,
              count(*) FILTER (WHERE d.state = 'completed')::text AS completed, count(*) FILTER (WHERE d.state = 'failed')::text AS failed,
              count(*) FILTER (WHERE d.state = 'cancelled_by_merchant')::text AS cancelled, count(*) FILTER (WHERE d.state = 'search_stopped')::text AS stopped
         FROM app.deliveries d
        WHERE ${column(basis)} >= to_timestamp($1::bigint / 1000.0) AND ${column(basis)} < to_timestamp($2::bigint / 1000.0)
        GROUP BY d.shop_id ORDER BY count(*) DESC, d.shop_id LIMIT $3::int`,
      [fromMs, toMs, limit],
    );
    return result.rows.map((row) => ({ shopId: row.shop_id as string, shopName: row.shop_name as string, total: whole(row.total), completed: whole(row.completed), failed: whole(row.failed), cancelled: whole(row.cancelled), stopped: whole(row.stopped) }));
  }

  /** Per Shipper, over the assignments ACCEPTED in the period (a Shipper's work is counted when they took it, whatever the delivery's own dates). */
  async perShipper(context: TransactionContext, fromMs: number, toMs: number, limit: number): Promise<ShipperRow[]> {
    const result = await context.query<Record<string, string>>(
      `SELECT a.driver_id::text AS driver_id, count(*)::text AS accepted,
              count(*) FILTER (WHERE a.status = 'COMPLETED')::text AS completed, count(*) FILTER (WHERE a.status = 'FAILED')::text AS failed,
              count(*) FILTER (WHERE a.status = 'CANCELLED_BY_SHIPPER')::text AS by_shipper, count(*) FILTER (WHERE a.status = 'RELEASED_BY_ADMIN')::text AS by_admin,
              count(*) FILTER (WHERE a.status = 'CANCELLED_BY_SHOP')::text AS by_shop
         FROM app.delivery_assignments a
        WHERE a.accepted_at >= to_timestamp($1::bigint / 1000.0) AND a.accepted_at < to_timestamp($2::bigint / 1000.0)
        GROUP BY a.driver_id ORDER BY count(*) DESC, a.driver_id LIMIT $3::int`,
      [fromMs, toMs, limit],
    );
    return result.rows.map((row) => ({
      driverId: row.driver_id as string, accepted: whole(row.accepted), completed: whole(row.completed), failed: whole(row.failed),
      cancelledByShipper: whole(row.by_shipper), releasedByAdmin: whole(row.by_admin), cancelledByShop: whole(row.by_shop),
    }));
  }

  async quality(context: TransactionContext, fromMs: number, toMs: number): Promise<QualitySummary> {
    const range = [fromMs, toMs];
    const reasons = await context.query<{ reason: string; n: string }>(
      `SELECT reason_code AS reason, count(*)::text AS n FROM app.delivery_incidents
        WHERE opened_at >= to_timestamp($1::bigint / 1000.0) AND opened_at < to_timestamp($2::bigint / 1000.0) GROUP BY 1 ORDER BY count(*) DESC, 1`,
      range,
    );
    const facts = await context.query<Record<string, string | null>>(
      `SELECT (SELECT count(*) FROM app.delivery_incidents i WHERE i.status = 'OPEN' AND i.opened_at >= to_timestamp($1::bigint / 1000.0) AND i.opened_at < to_timestamp($2::bigint / 1000.0))::text AS custody_open,
              (SELECT count(*) FROM app.deliveries d WHERE d.state = 'search_stopped' AND d.created_at >= to_timestamp($1::bigint / 1000.0) AND d.created_at < to_timestamp($2::bigint / 1000.0)
                  AND NOT EXISTS (SELECT 1 FROM app.deliveries n WHERE n.previous_delivery_id = d.delivery_id))::text AS stopped,
              (SELECT count(*) FROM app.delivery_assignments a WHERE a.status = 'RELEASED_BY_ADMIN' AND a.accepted_at >= to_timestamp($1::bigint / 1000.0) AND a.accepted_at < to_timestamp($2::bigint / 1000.0))::text AS admin_releases,
              (SELECT count(*) FROM app.delivery_assignments a WHERE a.status = 'CANCELLED_BY_SHIPPER' AND a.accepted_at >= to_timestamp($1::bigint / 1000.0) AND a.accepted_at < to_timestamp($2::bigint / 1000.0))::text AS shipper_releases,
              (SELECT count(*) FROM app.delivery_assignments a WHERE a.accepted_at >= to_timestamp($1::bigint / 1000.0) AND a.accepted_at < to_timestamp($2::bigint / 1000.0))::text AS accepted,
              (SELECT round(avg(extract(epoch FROM (first_a.accepted_at - d.search_started_at))))::text
                 FROM app.deliveries d JOIN LATERAL (SELECT min(a.accepted_at) AS accepted_at FROM app.delivery_assignments a WHERE a.delivery_id = d.delivery_id) first_a ON first_a.accepted_at IS NOT NULL
                WHERE d.created_at >= to_timestamp($1::bigint / 1000.0) AND d.created_at < to_timestamp($2::bigint / 1000.0)) AS avg_accept,
              (SELECT count(*) FROM app.deliveries d WHERE d.created_at >= to_timestamp($1::bigint / 1000.0) AND d.created_at < to_timestamp($2::bigint / 1000.0)
                  AND EXISTS (SELECT 1 FROM app.delivery_assignments a WHERE a.delivery_id = d.delivery_id))::text AS accepted_deliveries`,
      range,
    );
    const row = facts.rows[0] as Record<string, string | null>;
    return {
      failureReasons: reasons.rows.map((r) => ({ reason: r.reason, count: whole(r.n) })),
      custodyOpen: whole(row.custody_open), stoppedNotRecalled: whole(row.stopped), adminReleases: whole(row.admin_releases), shipperReleases: whole(row.shipper_releases),
      assignmentsAccepted: whole(row.accepted), avgSecondsToAccept: row.avg_accept === null ? null : whole(row.avg_accept), acceptedDeliveries: whole(row.accepted_deliveries),
    };
  }
}
