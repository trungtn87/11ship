import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';

// Plain READS of the wallet tables for the Shipper's own history and for the administration's finance screens (M04-C). No statement here writes, locks or creates a
// wallet. Every figure comes from ONE SQL statement (one snapshot) so a balance and the ledger it is checked against can never be read at two moments. Amounts arrive
// as text and become bigint; the services turn them into JSON numbers after proving they are safe integers.

export function bigintOf(raw: unknown): bigint {
  if (typeof raw !== 'string' || !/^-?[0-9]{1,19}$/.test(raw)) {
    throw new TechnicalError('internal', 'Database returned an unexpected number');
  }
  return BigInt(raw);
}

function msOf(raw: unknown): number {
  const value = Number(bigintOf(raw));
  if (!Number.isSafeInteger(value)) {
    throw new TechnicalError('internal', 'Database returned an unexpected time');
  }
  return value;
}

// ---- The Shipper's history: one feed over the ledger, the holds and the requests ---------------------------------------------------------------------------------

export type FeedType = 'topup' | 'withdraw' | 'commission' | 'hold' | 'release' | 'adjustment';
export type FeedStatus = 'success' | 'pending' | 'processing' | 'cancelled';
export type FeedFilter = 'all' | 'topup' | 'withdraw' | 'commission' | 'hold';
export const FEED_FILTERS: readonly FeedFilter[] = ['all', 'topup', 'withdraw', 'commission', 'hold'];

export interface FeedRow {
  readonly rowId: string;
  readonly atMs: number;
  readonly type: FeedType;
  /** Signed for a ledger movement and for a pending request (topup +, withdraw -, commission -); the (positive) hold amount for hold / release. */
  readonly amountVnd: bigint;
  readonly status: FeedStatus;
  readonly orderRef: string | null;
  readonly requestId: string | null;
  readonly requestKind: 'topup' | 'withdrawal' | null;
}

export interface HoldView {
  readonly holdId: string;
  readonly purpose: 'COMMISSION' | 'WITHDRAWAL';
  readonly amountVnd: bigint;
  readonly status: 'ACTIVE' | 'CAPTURED' | 'RELEASED';
  readonly createdAtMs: number;
  readonly resolvedAtMs: number | null;
  readonly orderRef: string | null;
  readonly withdrawalId: string | null;
}

export interface FeedCursor {
  readonly atMs: number;
  readonly rowId: string;
}

// ---- Administration --------------------------------------------------------------------------------------------------------------------------------------------

export interface AdminWalletRow {
  readonly walletId: string;
  readonly driverId: string;
  readonly balanceVnd: bigint;
  readonly heldVnd: bigint;
  readonly version: number;
  readonly updatedAtMs: number;
}

export interface WalletCursor {
  readonly updatedAtMs: number;
  readonly walletId: string;
}

export interface AdminLedgerRow {
  readonly rowId: string;
  readonly atMs: number;
  readonly kind: 'TOPUP' | 'WITHDRAWAL_DEBIT' | 'COMMISSION_DEBIT' | 'ADJUSTMENT_CREDIT' | 'ADJUSTMENT_DEBIT' | 'HOLD_COMMISSION' | 'HOLD_WITHDRAWAL';
  readonly driverId: string;
  readonly amountVnd: bigint;
  /** Ledger rows: the balance right after; hold rows: null. */
  readonly balanceAfterVnd: bigint | null;
  /** Hold rows: ACTIVE / CAPTURED / RELEASED; ledger rows: null. */
  readonly holdStatus: string | null;
  readonly orderRef: string | null;
  readonly sourceId: string | null;
}

export const ADMIN_LEDGER_KINDS = ['TOPUP', 'WITHDRAWAL_DEBIT', 'COMMISSION_DEBIT', 'ADJUSTMENT_CREDIT', 'ADJUSTMENT_DEBIT', 'HOLD_COMMISSION', 'HOLD_WITHDRAWAL'] as const;
export type AdminLedgerKind = (typeof ADMIN_LEDGER_KINDS)[number];

export interface AdminLedgerCursor {
  readonly atMs: number;
  readonly rowId: string;
}

export interface FinanceOverview {
  readonly wallets: number;
  readonly totalBalanceVnd: bigint;
  readonly totalHeldVnd: bigint;
  readonly topupPending: number;
  readonly topupPendingVnd: bigint;
  readonly withdrawalPending: number;
  readonly withdrawalPendingVnd: bigint;
  readonly withdrawalProcessing: number;
  readonly withdrawalReconciliation: number;
  readonly withdrawalReconciliationVnd: bigint;
  readonly topupConfirmed24h: number;
  readonly topupConfirmed24hVnd: bigint;
  readonly withdrawalPaid24h: number;
  readonly withdrawalPaid24hVnd: bigint;
  readonly commission24h: number;
  readonly commission24hVnd: bigint;
  readonly driftWallets: number;
  readonly driftWithdrawals: number;
}

export interface DriftRow {
  readonly walletId: string;
  readonly driverId: string;
  readonly balanceVnd: bigint;
  readonly heldVnd: bigint;
  readonly ledgerSumVnd: bigint;
  readonly lastBalanceAfterVnd: bigint;
  readonly activeHoldsVnd: bigint;
}

const DRIFT_WALLETS = `
  SELECT w.wallet_id, w.driver_id, w.balance_vnd, w.held_vnd,
         COALESCE(l.total, 0) AS ledger_sum, COALESCE(lastl.balance_after_vnd, 0) AS last_after, COALESCE(h.total, 0) AS active_holds
    FROM app.driver_wallets w
    LEFT JOIN (SELECT wallet_id, SUM(delta_vnd) AS total FROM app.wallet_ledger_entries GROUP BY wallet_id) l ON l.wallet_id = w.wallet_id
    LEFT JOIN (SELECT DISTINCT ON (wallet_id) wallet_id, balance_after_vnd FROM app.wallet_ledger_entries ORDER BY wallet_id, sequence_no DESC) lastl ON lastl.wallet_id = w.wallet_id
    LEFT JOIN (SELECT wallet_id, SUM(amount_vnd) AS total FROM app.wallet_holds WHERE status = 'ACTIVE' GROUP BY wallet_id) h ON h.wallet_id = w.wallet_id
   WHERE w.balance_vnd::numeric <> COALESCE(l.total, 0) OR w.balance_vnd <> COALESCE(lastl.balance_after_vnd, 0) OR w.held_vnd::numeric <> COALESCE(h.total, 0)`;

// A withdrawal whose state and its hold / debit disagree (the database refuses such a commit; any row here is an alarm).
const DRIFT_WITHDRAWALS = `
  SELECT d.withdrawal_id FROM app.wallet_withdrawals d
    JOIN app.wallet_holds h ON h.hold_id = d.hold_id
    LEFT JOIN (SELECT withdrawal_id, count(*) AS n FROM app.wallet_ledger_entries WHERE withdrawal_id IS NOT NULL GROUP BY withdrawal_id) l ON l.withdrawal_id = d.withdrawal_id
   WHERE (d.state IN ('PENDING', 'PROCESSING', 'RECONCILIATION') AND (h.status <> 'ACTIVE' OR COALESCE(l.n, 0) <> 0))
      OR (d.state = 'PAID' AND (h.status <> 'CAPTURED' OR COALESCE(l.n, 0) <> 1))
      OR (d.state = 'CANCELLED' AND (h.status <> 'RELEASED' OR COALESCE(l.n, 0) <> 0))`;

@Injectable()
export class WalletReadRepository {
  /**
   * The history of ONE wallet, newest first, as a single feed: ledger movements (success), the commission holds and their release (information, no money moves),
   * the top-up requests that are not CONFIRMED yet (a CONFIRMED one is its ledger credit) and the withdrawals that are not PAID yet (a PAID one is its ledger debit).
   */
  async feed(context: TransactionContext, walletId: string, options: { filter: FeedFilter; limit: number; after: FeedCursor | undefined }): Promise<FeedRow[]> {
    const types: readonly string[] =
      options.filter === 'all' ? [] : options.filter === 'hold' ? ['hold', 'release'] : [options.filter];
    const result = await context.query<{ row_id: string; at_ms: string; type: string; amount_vnd: string; status: string; order_ref: string | null; request_id: string | null; request_kind: string | null }>(
      `WITH feed AS (
         SELECT 'L:' || l.entry_id::text AS row_id, l.created_at AS at,
                CASE l.entry_kind WHEN 'TOPUP' THEN 'topup' WHEN 'WITHDRAWAL_DEBIT' THEN 'withdraw' WHEN 'COMMISSION_DEBIT' THEN 'commission' ELSE 'adjustment' END AS type,
                l.delta_vnd AS amount, 'success' AS status, d.code AS order_ref,
                COALESCE(t.request_id, l.withdrawal_id)::text AS request_id,
                CASE WHEN t.request_id IS NOT NULL THEN 'topup' WHEN l.withdrawal_id IS NOT NULL THEN 'withdrawal' END AS request_kind
           FROM app.wallet_ledger_entries l
           LEFT JOIN app.wallet_topups t ON t.topup_id = l.topup_id
           LEFT JOIN app.delivery_assignments a ON a.assignment_id = l.commission_assignment_id
           LEFT JOIN app.deliveries d ON d.delivery_id = a.delivery_id
          WHERE l.wallet_id = $1::uuid
         UNION ALL
         SELECT 'H:' || h.hold_id::text, h.created_at, 'hold', h.amount_vnd, CASE h.status WHEN 'ACTIVE' THEN 'pending' ELSE 'success' END, d.code, NULL, NULL
           FROM app.wallet_holds h
           JOIN app.delivery_assignments a ON a.assignment_id = h.commission_assignment_id
           JOIN app.deliveries d ON d.delivery_id = a.delivery_id
          WHERE h.wallet_id = $1::uuid AND h.purpose = 'COMMISSION'
         UNION ALL
         SELECT 'E:' || h.hold_id::text, h.resolved_at, 'release', h.amount_vnd, 'success', d.code, NULL, NULL
           FROM app.wallet_holds h
           JOIN app.delivery_assignments a ON a.assignment_id = h.commission_assignment_id
           JOIN app.deliveries d ON d.delivery_id = a.delivery_id
          WHERE h.wallet_id = $1::uuid AND h.purpose = 'COMMISSION' AND h.status = 'RELEASED'
         UNION ALL
         SELECT 'T:' || r.request_id::text, r.created_at, 'topup', r.amount_requested_vnd, CASE r.state WHEN 'PENDING' THEN 'pending' ELSE 'cancelled' END, NULL, r.request_id::text, 'topup'
           FROM app.wallet_topup_requests r WHERE r.wallet_id = $1::uuid AND r.state <> 'CONFIRMED'
         UNION ALL
         SELECT 'W:' || w.withdrawal_id::text, w.created_at, 'withdraw', -w.amount_vnd,
                CASE w.state WHEN 'PENDING' THEN 'pending' WHEN 'CANCELLED' THEN 'cancelled' ELSE 'processing' END, NULL, w.withdrawal_id::text, 'withdrawal'
           FROM app.wallet_withdrawals w WHERE w.wallet_id = $1::uuid AND w.state <> 'PAID'
       )
       SELECT row_id, (extract(epoch FROM at) * 1000)::bigint::text AS at_ms, type, amount::text AS amount_vnd, status, order_ref, request_id, request_kind
         FROM feed
        WHERE (cardinality($2::text[]) = 0 OR type = ANY($2::text[]))
          AND ($3::bigint IS NULL OR (at, row_id) < ('epoch'::timestamptz + $3::bigint * interval '1 millisecond', $4::text))
        ORDER BY at DESC, row_id DESC
        LIMIT $5::int`,
      [walletId, types, options.after?.atMs ?? null, options.after?.rowId ?? null, options.limit],
    );
    return result.rows.map((row) => ({
      rowId: row.row_id,
      atMs: msOf(row.at_ms),
      type: row.type as FeedType,
      amountVnd: bigintOf(row.amount_vnd),
      status: row.status as FeedStatus,
      orderRef: row.order_ref,
      requestId: row.request_id,
      requestKind: row.request_kind as 'topup' | 'withdrawal' | null,
    }));
  }

  /** The holds of one wallet (newest first, at most `limit`), with the delivery code of a commission hold. A plain read. */
  async holds(context: TransactionContext, walletId: string, options: { status: 'ACTIVE' | 'CAPTURED' | 'RELEASED' | undefined; limit: number }): Promise<HoldView[]> {
    const result = await context.query<{ hold_id: string; purpose: string; amount_vnd: string; status: string; created_ms: string; resolved_ms: string | null; order_ref: string | null; withdrawal_id: string | null }>(
      `SELECT h.hold_id::text AS hold_id, h.purpose, h.amount_vnd::text AS amount_vnd, h.status, (extract(epoch FROM h.created_at) * 1000)::bigint::text AS created_ms,
              (extract(epoch FROM h.resolved_at) * 1000)::bigint::text AS resolved_ms, d.code AS order_ref, h.withdrawal_id::text AS withdrawal_id
         FROM app.wallet_holds h
         LEFT JOIN app.delivery_assignments a ON a.assignment_id = h.commission_assignment_id
         LEFT JOIN app.deliveries d ON d.delivery_id = a.delivery_id
        WHERE h.wallet_id = $1::uuid AND ($2::text IS NULL OR h.status = $2::text)
        ORDER BY h.created_at DESC, h.hold_id DESC
        LIMIT $3::int`,
      [walletId, options.status ?? null, options.limit],
    );
    return result.rows.map((row) => ({
      holdId: row.hold_id,
      purpose: row.purpose as 'COMMISSION' | 'WITHDRAWAL',
      amountVnd: bigintOf(row.amount_vnd),
      status: row.status as 'ACTIVE' | 'CAPTURED' | 'RELEASED',
      createdAtMs: msOf(row.created_ms),
      resolvedAtMs: row.resolved_ms === null ? null : msOf(row.resolved_ms),
      orderRef: row.order_ref,
      withdrawalId: row.withdrawal_id,
    }));
  }

  // ---- Administration -------------------------------------------------------------------------------------------------------------------------------------

  /** Wallets, most recently changed first. `driverIds` (when given) restricts the page to those Shipper profiles (a search the Driver package resolved). */
  async listWallets(context: TransactionContext, options: { driverIds: readonly string[] | undefined; limit: number; after: WalletCursor | undefined }): Promise<AdminWalletRow[]> {
    const result = await context.query<{ wallet_id: string; driver_id: string; balance_vnd: string; held_vnd: string; version: string; updated_ms: string }>(
      `SELECT w.wallet_id::text AS wallet_id, w.driver_id::text AS driver_id, w.balance_vnd::text AS balance_vnd, w.held_vnd::text AS held_vnd, w.version::text AS version,
              (extract(epoch FROM w.updated_at) * 1000)::bigint::text AS updated_ms
         FROM app.driver_wallets w
        WHERE ($1::uuid[] IS NULL OR w.driver_id = ANY($1::uuid[]))
          AND ($2::bigint IS NULL OR (w.updated_at, w.wallet_id) < ('epoch'::timestamptz + $2::bigint * interval '1 millisecond', $3::uuid))
        ORDER BY w.updated_at DESC, w.wallet_id DESC
        LIMIT $4::int`,
      [options.driverIds === undefined ? null : [...options.driverIds], options.after?.updatedAtMs ?? null, options.after?.walletId ?? null, options.limit],
    );
    return result.rows.map(walletOf);
  }

  async findWalletByDriver(context: TransactionContext, driverId: string): Promise<AdminWalletRow | undefined> {
    const result = await context.query<{ wallet_id: string; driver_id: string; balance_vnd: string; held_vnd: string; version: string; updated_ms: string }>(
      `SELECT w.wallet_id::text AS wallet_id, w.driver_id::text AS driver_id, w.balance_vnd::text AS balance_vnd, w.held_vnd::text AS held_vnd, w.version::text AS version,
              (extract(epoch FROM w.updated_at) * 1000)::bigint::text AS updated_ms
         FROM app.driver_wallets w WHERE w.driver_id = $1::uuid`,
      [driverId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : walletOf(row);
  }

  /** The ledger rows and the holds of every wallet (optionally one Shipper, optionally one kind), newest first, as one feed. */
  async listLedger(
    context: TransactionContext,
    options: { kind: AdminLedgerKind | undefined; driverId: string | undefined; limit: number; after: AdminLedgerCursor | undefined },
  ): Promise<AdminLedgerRow[]> {
    const result = await context.query<{
      row_id: string;
      at_ms: string;
      kind: string;
      driver_id: string;
      amount_vnd: string;
      balance_after_vnd: string | null;
      hold_status: string | null;
      order_ref: string | null;
      source_id: string | null;
    }>(
      `WITH feed AS (
         SELECT 'L:' || l.entry_id::text AS row_id, l.created_at AS at, l.entry_kind AS kind, w.driver_id, l.delta_vnd AS amount, l.balance_after_vnd AS balance_after,
                NULL::text AS hold_status, d.code AS order_ref, COALESCE(l.topup_id, l.withdrawal_id, l.commission_assignment_id)::text AS source_id
           FROM app.wallet_ledger_entries l
           JOIN app.driver_wallets w ON w.wallet_id = l.wallet_id
           LEFT JOIN app.delivery_assignments a ON a.assignment_id = l.commission_assignment_id
           LEFT JOIN app.deliveries d ON d.delivery_id = a.delivery_id
         UNION ALL
         SELECT 'H:' || h.hold_id::text, h.created_at, 'HOLD_' || h.purpose, w.driver_id, h.amount_vnd, NULL::bigint, h.status, d.code, COALESCE(h.commission_assignment_id, h.withdrawal_id)::text
           FROM app.wallet_holds h
           JOIN app.driver_wallets w ON w.wallet_id = h.wallet_id
           LEFT JOIN app.delivery_assignments a ON a.assignment_id = h.commission_assignment_id
           LEFT JOIN app.deliveries d ON d.delivery_id = a.delivery_id
       )
       SELECT row_id, (extract(epoch FROM at) * 1000)::bigint::text AS at_ms, kind, driver_id::text AS driver_id, amount::text AS amount_vnd, balance_after::text AS balance_after_vnd,
              hold_status, order_ref, source_id
         FROM feed
        WHERE ($1::text IS NULL OR kind = $1::text)
          AND ($2::uuid IS NULL OR driver_id = $2::uuid)
          AND ($3::bigint IS NULL OR (at, row_id) < ('epoch'::timestamptz + $3::bigint * interval '1 millisecond', $4::text))
        ORDER BY at DESC, row_id DESC
        LIMIT $5::int`,
      [options.kind ?? null, options.driverId ?? null, options.after?.atMs ?? null, options.after?.rowId ?? null, options.limit],
    );
    return result.rows.map((row) => ({
      rowId: row.row_id,
      atMs: msOf(row.at_ms),
      kind: row.kind as AdminLedgerKind,
      driverId: row.driver_id,
      amountVnd: bigintOf(row.amount_vnd),
      balanceAfterVnd: row.balance_after_vnd === null ? null : bigintOf(row.balance_after_vnd),
      holdStatus: row.hold_status,
      orderRef: row.order_ref,
      sourceId: row.source_id,
    }));
  }

  /** Every KPI of the overview from ONE statement, so the totals and the drift counts describe the same moment. */
  async overview(context: TransactionContext): Promise<FinanceOverview> {
    const result = await context.query<Record<string, string>>(
      `SELECT
         (SELECT count(*) FROM app.driver_wallets)::text AS wallets,
         (SELECT COALESCE(SUM(balance_vnd), 0) FROM app.driver_wallets)::text AS total_balance,
         (SELECT COALESCE(SUM(held_vnd), 0) FROM app.driver_wallets)::text AS total_held,
         (SELECT count(*) FROM app.wallet_topup_requests WHERE state = 'PENDING')::text AS topup_pending,
         (SELECT COALESCE(SUM(amount_requested_vnd), 0) FROM app.wallet_topup_requests WHERE state = 'PENDING')::text AS topup_pending_vnd,
         (SELECT count(*) FROM app.wallet_withdrawals WHERE state = 'PENDING')::text AS wd_pending,
         (SELECT COALESCE(SUM(amount_vnd), 0) FROM app.wallet_withdrawals WHERE state = 'PENDING')::text AS wd_pending_vnd,
         (SELECT count(*) FROM app.wallet_withdrawals WHERE state = 'PROCESSING')::text AS wd_processing,
         (SELECT count(*) FROM app.wallet_withdrawals WHERE state = 'RECONCILIATION')::text AS wd_reconciliation,
         (SELECT COALESCE(SUM(amount_vnd), 0) FROM app.wallet_withdrawals WHERE state = 'RECONCILIATION')::text AS wd_reconciliation_vnd,
         (SELECT count(*) FROM app.wallet_ledger_entries WHERE entry_kind = 'TOPUP' AND created_at >= clock_timestamp() - interval '24 hours')::text AS topup_24h,
         (SELECT COALESCE(SUM(delta_vnd), 0) FROM app.wallet_ledger_entries WHERE entry_kind = 'TOPUP' AND created_at >= clock_timestamp() - interval '24 hours')::text AS topup_24h_vnd,
         (SELECT count(*) FROM app.wallet_ledger_entries WHERE entry_kind = 'WITHDRAWAL_DEBIT' AND created_at >= clock_timestamp() - interval '24 hours')::text AS wd_paid_24h,
         (SELECT COALESCE(SUM(-delta_vnd), 0) FROM app.wallet_ledger_entries WHERE entry_kind = 'WITHDRAWAL_DEBIT' AND created_at >= clock_timestamp() - interval '24 hours')::text AS wd_paid_24h_vnd,
         (SELECT count(*) FROM app.wallet_ledger_entries WHERE entry_kind = 'COMMISSION_DEBIT' AND created_at >= clock_timestamp() - interval '24 hours')::text AS commission_24h,
         (SELECT COALESCE(SUM(-delta_vnd), 0) FROM app.wallet_ledger_entries WHERE entry_kind = 'COMMISSION_DEBIT' AND created_at >= clock_timestamp() - interval '24 hours')::text AS commission_24h_vnd,
         (SELECT count(*) FROM (${DRIFT_WALLETS}) x)::text AS drift_wallets,
         (SELECT count(*) FROM (${DRIFT_WITHDRAWALS}) y)::text AS drift_withdrawals`,
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new TechnicalError('internal', 'Database returned no overview');
    }
    const n = (key: string): number => {
      const value = Number(bigintOf(row[key]));
      if (!Number.isSafeInteger(value)) {
        throw new TechnicalError('internal', 'Database returned an unexpected count');
      }
      return value;
    };
    const v = (key: string): bigint => bigintOf(row[key]);
    return {
      wallets: n('wallets'),
      totalBalanceVnd: v('total_balance'),
      totalHeldVnd: v('total_held'),
      topupPending: n('topup_pending'),
      topupPendingVnd: v('topup_pending_vnd'),
      withdrawalPending: n('wd_pending'),
      withdrawalPendingVnd: v('wd_pending_vnd'),
      withdrawalProcessing: n('wd_processing'),
      withdrawalReconciliation: n('wd_reconciliation'),
      withdrawalReconciliationVnd: v('wd_reconciliation_vnd'),
      topupConfirmed24h: n('topup_24h'),
      topupConfirmed24hVnd: v('topup_24h_vnd'),
      withdrawalPaid24h: n('wd_paid_24h'),
      withdrawalPaid24hVnd: v('wd_paid_24h_vnd'),
      commission24h: n('commission_24h'),
      commission24hVnd: v('commission_24h_vnd'),
      driftWallets: n('drift_wallets'),
      driftWithdrawals: n('drift_withdrawals'),
    };
  }

  /** The wallets whose balance, last ledger row or held amount disagree with the ledger and the ACTIVE holds, from one snapshot. Read only: nothing is repaired. */
  async driftWallets(context: TransactionContext, limit: number): Promise<DriftRow[]> {
    const result = await context.query<{ wallet_id: string; driver_id: string; balance_vnd: string; held_vnd: string; ledger_sum: string; last_after: string; active_holds: string }>(
      `SELECT wallet_id::text AS wallet_id, driver_id::text AS driver_id, balance_vnd::text AS balance_vnd, held_vnd::text AS held_vnd, ledger_sum::text AS ledger_sum,
              last_after::text AS last_after, active_holds::text AS active_holds
         FROM (${DRIFT_WALLETS}) d ORDER BY wallet_id LIMIT $1::int`,
      [limit],
    );
    return result.rows.map((row) => ({
      walletId: row.wallet_id,
      driverId: row.driver_id,
      balanceVnd: bigintOf(row.balance_vnd),
      heldVnd: bigintOf(row.held_vnd),
      ledgerSumVnd: bigintOf(row.ledger_sum),
      lastBalanceAfterVnd: bigintOf(row.last_after),
      activeHoldsVnd: bigintOf(row.active_holds),
    }));
  }

  async pendingTopupCount(context: TransactionContext, walletId: string): Promise<number> {
    const result = await context.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.wallet_topup_requests WHERE wallet_id = $1::uuid AND state = 'PENDING'`, [walletId]);
    return Number(bigintOf(result.rows[0]?.n));
  }

  async openWithdrawalCountOfDriver(context: TransactionContext, driverId: string): Promise<number> {
    const result = await context.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM app.wallet_withdrawals d WHERE d.driver_id = $1::uuid AND d.state IN ('PENDING', 'PROCESSING', 'RECONCILIATION')`,
      [driverId],
    );
    return Number(bigintOf(result.rows[0]?.n));
  }

  /** Total of the confirmed top-ups and the available balance of a Shipper, for the first-activation funding check. */
  async fundingOfDriver(context: TransactionContext, driverId: string): Promise<{ readonly confirmedTopupVnd: bigint; readonly availableVnd: bigint }> {
    const result = await context.query<{ topups: string; available: string }>(
      `SELECT COALESCE((SELECT SUM(t.actual_amount_vnd) FROM app.wallet_topups t JOIN app.driver_wallets w ON w.wallet_id = t.wallet_id WHERE w.driver_id = $1::uuid), 0)::text AS topups,
              COALESCE((SELECT w.balance_vnd - w.held_vnd FROM app.driver_wallets w WHERE w.driver_id = $1::uuid), 0)::text AS available`,
      [driverId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new TechnicalError('internal', 'Database returned no funding');
    }
    return { confirmedTopupVnd: bigintOf(row.topups), availableVnd: bigintOf(row.available) };
  }
}

function walletOf(row: { wallet_id: string; driver_id: string; balance_vnd: string; held_vnd: string; version: string; updated_ms: string }): AdminWalletRow {
  return { walletId: row.wallet_id, driverId: row.driver_id, balanceVnd: bigintOf(row.balance_vnd), heldVnd: bigintOf(row.held_vnd), version: Number(bigintOf(row.version)), updatedAtMs: msOf(row.updated_ms) };
}
