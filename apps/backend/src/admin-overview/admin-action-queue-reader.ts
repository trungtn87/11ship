import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';

/** One record still waiting, as stored. The service adds the wording, the rights and the sort; nothing here is invented or counted twice. */
export interface QueueRecord {
  /** Identity of the file within its kind: the same file is the same key on every read, so reloading never multiplies it. */
  readonly key: string;
  readonly code: string;
  readonly status: string;
  /** Closed code of why it waits (the service turns it into words). */
  readonly reason: string;
  readonly waitingSinceMs: number;
  /** The id the detail screen opens (a shipper, a top-up, a withdrawal or a finance request), when the web has such a screen. */
  readonly targetId: string | null;
  /** The shop or Shipper the file is about: its display name/code comes from the owning module (M02 / M03), never from a join here. */
  readonly subject: { readonly kind: 'shop' | 'driver'; readonly id: string } | null;
  /** True only when an existing rule of the system already calls it late; null = no such rule, so it is never labelled late. */
  readonly overdue: boolean | null;
  readonly detail: Readonly<Record<string, string | number | null>>;
}

const ms = (column: string): string => `(extract(epoch FROM ${column}) * 1000)::bigint::text`;

function whole(value: string | null | undefined): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) {
    throw new TechnicalError('internal', 'Database returned an unexpected number');
  }
  return n;
}

/**
 * M12 read side of "Việc cần xử lý": the files that still wait, one row per file, straight from the table that owns each (orders M10, complaints and
 * their money adjustments M11, wallet top-ups and withdrawals M04, shop payments and the menu entitlement #198). Plain reads: it writes nothing, takes
 * no lock and decides no right. Deliveries and Shipper reviews are read through their own repositories by the service.
 */
@Injectable()
export class AdminActionQueueReader {
  /** Orders the shop has not confirmed yet. Waiting since the order was created; the system keeps its own phase deadlines, so nothing is called late here. */
  async ordersAwaitingConfirmation(context: TransactionContext, limit: number): Promise<QueueRecord[]> {
    const result = await context.query<{ order_id: string; code: string; since: string }>(
      `SELECT o.order_id::text AS order_id, o.code, ${ms('o.created_at')} AS since
         FROM app.orders o WHERE o.status = 'PENDING_CONFIRMATION' ORDER BY o.created_at, o.order_id LIMIT $1::int`,
      [limit],
    );
    return result.rows.map((row) => ({ key: `order:${row.order_id}`, code: row.code, status: 'PENDING_CONFIRMATION', reason: 'ORDER_AWAITING_SHOP', waitingSinceMs: whole(row.since), targetId: null, subject: null, overdue: null, detail: { order_id: row.order_id } }));
  }

  /** The code of the Order behind ORDER-sourced deliveries, so a delivery and its Order are ONE file whichever side the list reached it from. */
  async orderCodes(context: TransactionContext, orderIds: readonly string[]): Promise<Map<string, string>> {
    if (orderIds.length === 0) {
      return new Map();
    }
    const result = await context.query<{ order_id: string; code: string }>('SELECT order_id::text AS order_id, code FROM app.orders WHERE order_id = ANY($1::uuid[])', [[...orderIds]]);
    return new Map(result.rows.map((row) => [row.order_id, row.code]));
  }

  /** When and why the goods of each failed delivery were left open (the incident record, not the delivery's end). */
  async openIncidents(context: TransactionContext, deliveryIds: readonly string[]): Promise<Map<string, { sinceMs: number; goods: string; reason: string }>> {
    if (deliveryIds.length === 0) {
      return new Map();
    }
    const result = await context.query<{ delivery_id: string; since: string; goods: string; reason: string }>(
      `SELECT delivery_id::text AS delivery_id, ${ms('opened_at')} AS since, goods_condition AS goods, reason_code AS reason
         FROM app.delivery_incidents WHERE status = 'OPEN' AND delivery_id = ANY($1::uuid[])`,
      [[...deliveryIds]],
    );
    return new Map(result.rows.map((row) => [row.delivery_id, { sinceMs: whole(row.since), goods: row.goods, reason: row.reason }]));
  }

  /**
   * Complaints that still wait for the administration (the same three statuses the overview counts) PLUS closed ones with a reconsideration request still
   * PENDING. One row per complaint: its follow-up messages are never counted.
   */
  async complaints(context: TransactionContext, limit: number): Promise<QueueRecord[]> {
    const result = await context.query<{ complaint_id: string; code: string; status: string; awaiting_from: string | null; since: string; related_code: string; reconsider: string | null }>(
      `SELECT c.complaint_id::text AS complaint_id, c.code, c.status, c.awaiting_from, c.related_code, ${ms('c.created_at')} AS since, ${ms('r.requested_at')} AS reconsider
         FROM app.complaints c
         LEFT JOIN LATERAL (SELECT requested_at FROM app.complaint_reconsiderations q WHERE q.complaint_id = c.complaint_id AND q.status = 'PENDING' ORDER BY requested_at LIMIT 1) r ON true
        WHERE c.status IN ('PENDING', 'IN_PROGRESS', 'AWAITING_INFO') OR r.requested_at IS NOT NULL
        ORDER BY COALESCE(r.requested_at, c.created_at), c.complaint_id LIMIT $1::int`,
      [limit],
    );
    return result.rows.map((row) => {
      const open = row.status === 'PENDING' || row.status === 'IN_PROGRESS' || row.status === 'AWAITING_INFO';
      if (!open) {
        return { key: `complaint:${row.complaint_id}`, code: row.code, status: 'RECONSIDERATION_PENDING', reason: 'COMPLAINT_RECONSIDERATION', waitingSinceMs: whole(row.reconsider), targetId: null, subject: null, overdue: null, detail: { related_code: row.related_code } };
      }
      return {
        key: `complaint:${row.complaint_id}`,
        code: row.code,
        status: row.status,
        reason: row.status === 'AWAITING_INFO' ? `COMPLAINT_AWAITING_${row.awaiting_from ?? 'INFO'}` : 'COMPLAINT_OPEN',
        waitingSinceMs: whole(row.since),
        targetId: null,
        subject: null,
        overdue: null,
        detail: { related_code: row.related_code },
      };
    });
  }

  /** Commission adjustments of complaints whose money M04 has not posted: one row per adjustment, with the reason M04 gave. */
  async pendingAdjustments(context: TransactionContext, limit: number): Promise<QueueRecord[]> {
    const result = await context.query<{ adjustment_id: string; complaint_code: string; delivery_code: string; direction: string; amount: string; reason: string; since: string }>(
      `SELECT a.adjustment_id::text AS adjustment_id, c.code AS complaint_code, d.code AS delivery_code, a.direction, a.amount_vnd::text AS amount, a.pending_reason AS reason, ${ms('a.created_at')} AS since
         FROM app.complaint_adjustments a
         JOIN app.complaints c ON c.complaint_id = a.complaint_id
         JOIN app.deliveries d ON d.delivery_id = a.delivery_id
        WHERE a.status = 'PENDING_FINANCE' ORDER BY a.created_at, a.adjustment_id LIMIT $1::int`,
      [limit],
    );
    return result.rows.map((row) => ({
      key: `adjustment:${row.adjustment_id}`,
      code: row.complaint_code,
      status: 'PENDING_FINANCE',
      reason: `ADJUSTMENT_${row.reason}`,
      waitingSinceMs: whole(row.since),
      targetId: null,
      subject: null,
      overdue: null,
      detail: { delivery_code: row.delivery_code, direction: row.direction, amount_vnd: whole(row.amount) },
    }));
  }

  /**
   * Shop payments still waiting for the money to be confirmed. `overdue` is the system's own rule: the payment room posts its "quá 30 phút" reminder (reminded_at)
   * once a request has waited that long; nothing else here is ever called late.
   */
  async pendingShopPayments(context: TransactionContext, limit: number): Promise<QueueRecord[]> {
    const result = await context.query<{ request_id: string; shop_id: string; amount: string; since: string; late: boolean }>(
      `SELECT r.request_id::text AS request_id, r.shop_id::text AS shop_id, r.amount_requested_vnd::text AS amount, ${ms('r.created_at')} AS since, (r.reminded_at IS NOT NULL) AS late
         FROM app.business_finance_requests r
        WHERE r.kind = 'SHOP_PAYMENT' AND r.state = 'PENDING' ORDER BY r.created_at, r.request_id LIMIT $1::int`,
      [limit],
    );
    return result.rows.map((row) => ({ key: `shop-payment:${row.request_id}`, code: '', status: 'PENDING', reason: 'SHOP_PAYMENT_AWAITING_CONFIRMATION', waitingSinceMs: whole(row.since), targetId: row.request_id, subject: { kind: 'shop', id: row.shop_id }, overdue: row.late, detail: { amount_vnd: whole(row.amount) } }));
  }

  /**
   * Shops whose payment was CONFIRMED but whose menu entitlement was not granted afterwards. Only the two real records decide it (the confirmed request and
   * the append-only grant history): nothing is read from chat. One row per SHOP (the entitlement belongs to the shop, so several confirmed payments are
   * still one open job), waiting since the OLDEST confirmed payment that no later grant answered, opening the latest of them. A shop that is already
   * expanded, or whose entitlement was granted/revoked by an administrator after the confirmation, is answered and leaves.
   */
  async confirmedAwaitingGrant(context: TransactionContext, limit: number): Promise<QueueRecord[]> {
    const result = await context.query<{ request_id: string; shop_id: string; amount: string; since: string; payments: string }>(
      `SELECT x.request_id::text AS request_id, x.shop_id::text AS shop_id, x.amount::text AS amount, ${ms('x.since')} AS since, x.payments::text AS payments
         FROM (
           SELECT DISTINCT ON (r.shop_id) r.request_id, r.shop_id, COALESCE(r.actual_amount_vnd, r.amount_requested_vnd) AS amount,
                  min(r.resolved_at) OVER (PARTITION BY r.shop_id) AS since, count(*) OVER (PARTITION BY r.shop_id) AS payments
             FROM app.business_finance_requests r
            WHERE r.kind = 'SHOP_PAYMENT' AND r.state = 'CONFIRMED'
              AND NOT EXISTS (SELECT 1 FROM app.shop_entitlement_grants g WHERE g.shop_id = r.shop_id AND g.entitlement = 'MENU_EXPANDED' AND g.created_at >= r.resolved_at)
              AND COALESCE((SELECT g2.action FROM app.shop_entitlement_grants g2 WHERE g2.shop_id = r.shop_id AND g2.entitlement = 'MENU_EXPANDED' ORDER BY g2.seq DESC LIMIT 1), 'REVOKE') <> 'GRANT'
            ORDER BY r.shop_id, r.resolved_at DESC, r.request_id
         ) x
        ORDER BY x.since, x.shop_id LIMIT $1::int`,
      [limit],
    );
    return result.rows.map((row) => ({
      key: `shop-grant:${row.shop_id}`,
      code: '',
      status: 'CONFIRMED',
      reason: 'SHOP_PAYMENT_AWAITING_GRANT',
      waitingSinceMs: whole(row.since),
      targetId: row.request_id,
      subject: { kind: 'shop', id: row.shop_id },
      overdue: null,
      detail: { amount_vnd: whole(row.amount), confirmed_payments: whole(row.payments) },
    }));
  }
}
