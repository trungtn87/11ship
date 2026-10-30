import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';

/**
 * M04's read side for the administration's summaries and reports (M12). It only READS and only the owner's own tables (driver_wallets,
 * wallet_ledger_entries, wallet_topup_requests, wallet_topups): money is never recomputed from the delivery state, and nothing here writes. Amounts come
 * from PostgreSQL as text and are parsed; a value outside the safe integer range is an internal error, never a rounded number.
 */

export interface WalletTotals {
  readonly wallets: number;
  readonly balanceVnd: number;
  readonly heldVnd: number;
  /** balance - held, the amount a Shipper may still use. */
  readonly availableVnd: number;
}

export interface LedgerPeriodSums {
  /** Positive VND the Shippers paid as commission (the sum of -delta of COMMISSION_DEBIT rows written in the period). */
  readonly commissionVnd: number;
  readonly commissionEntries: number;
  /** Signed net of the adjustments written in the period: ADJUSTMENT_CREDIT minus ADJUSTMENT_DEBIT. */
  readonly adjustmentNetVnd: number;
  readonly adjustmentEntries: number;
  /** Money credited by confirmed top-ups written in the period (a top-up is a deposit, never revenue). */
  readonly topupVnd: number;
  readonly topupEntries: number;
  /** Withdrawals debited in the period (positive VND). */
  readonly withdrawalVnd: number;
  readonly withdrawalEntries: number;
}

export interface PendingTopups {
  readonly count: number;
  readonly requestedVnd: number;
}

function whole(raw: unknown): number {
  if (typeof raw !== 'string' || !/^-?[0-9]{1,19}$/.test(raw)) {
    throw new TechnicalError('internal', 'Database returned an unexpected number');
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new TechnicalError('internal', 'Database returned an unexpected number');
  }
  return value;
}

export interface CommissionTrace {
  readonly assignmentId: string;
  readonly holdStatus: 'ACTIVE' | 'CAPTURED' | 'RELEASED';
  readonly amountVnd: number;
  /** The ledger row that took the commission (only once the hold was captured), else null. */
  readonly ledgerEntryId: string | null;
  readonly ledgerAtMs: number | null;
}

@Injectable()
export class WalletReportReader {
  /**
   * What happened to the commission of each assignment, from M04's own hold and ledger rows (never inferred from the delivery state: a delivered delivery
   * whose commission was not captured shows as ACTIVE or RELEASED here, and the screen says so).
   */
  async commissionOf(context: TransactionContext, assignmentIds: readonly string[]): Promise<CommissionTrace[]> {
    if (assignmentIds.length === 0) {
      return [];
    }
    const result = await context.query<{ assignment_id: string; status: string; amount: string; entry_id: string | null; entry_ms: string | null }>(
      `SELECT h.commission_assignment_id::text AS assignment_id, h.status, h.amount_vnd::text AS amount, e.entry_id::text AS entry_id,
              (extract(epoch FROM e.created_at) * 1000)::bigint::text AS entry_ms
         FROM app.wallet_holds h
         LEFT JOIN app.wallet_ledger_entries e ON e.commission_assignment_id = h.commission_assignment_id AND e.entry_kind = 'COMMISSION_DEBIT'
        WHERE h.purpose = 'COMMISSION' AND h.commission_assignment_id = ANY($1::uuid[])
        ORDER BY h.created_at`,
      [assignmentIds],
    );
    return result.rows.map((row) => {
      if (row.status !== 'ACTIVE' && row.status !== 'CAPTURED' && row.status !== 'RELEASED') {
        throw new TechnicalError('internal', 'Database returned an unexpected hold');
      }
      return { assignmentId: row.assignment_id, holdStatus: row.status, amountVnd: whole(row.amount), ledgerEntryId: row.entry_id, ledgerAtMs: row.entry_ms === null ? null : whole(row.entry_ms) };
    });
  }

  async totals(context: TransactionContext): Promise<WalletTotals> {
    const result = await context.query<{ n: string; balance: string; held: string }>(
      `SELECT count(*)::text AS n, COALESCE(sum(balance_vnd), 0)::text AS balance, COALESCE(sum(held_vnd), 0)::text AS held FROM app.driver_wallets`,
    );
    const row = result.rows[0];
    const balanceVnd = whole(row?.balance);
    const heldVnd = whole(row?.held);
    return { wallets: whole(row?.n), balanceVnd, heldVnd, availableVnd: balanceVnd - heldVnd };
  }

  /** Ledger rows whose `created_at` lies in [fromMs, toMs): the moment the row was WRITTEN, which is the only moment the ledger knows. */
  async ledgerPeriod(context: TransactionContext, fromMs: number, toMs: number): Promise<LedgerPeriodSums> {
    const result = await context.query<{ kind: string; n: string; delta: string }>(
      `SELECT entry_kind AS kind, count(*)::text AS n, COALESCE(sum(delta_vnd), 0)::text AS delta
         FROM app.wallet_ledger_entries
        WHERE created_at >= to_timestamp($1::bigint / 1000.0) AND created_at < to_timestamp($2::bigint / 1000.0)
        GROUP BY entry_kind`,
      [fromMs, toMs],
    );
    const by = new Map(result.rows.map((row) => [row.kind, { n: whole(row.n), delta: whole(row.delta) }]));
    const sum = (kind: string): { n: number; delta: number } => by.get(kind) ?? { n: 0, delta: 0 };
    return {
      commissionVnd: -sum('COMMISSION_DEBIT').delta,
      commissionEntries: sum('COMMISSION_DEBIT').n,
      adjustmentNetVnd: sum('ADJUSTMENT_CREDIT').delta + sum('ADJUSTMENT_DEBIT').delta,
      adjustmentEntries: sum('ADJUSTMENT_CREDIT').n + sum('ADJUSTMENT_DEBIT').n,
      topupVnd: sum('TOPUP').delta,
      topupEntries: sum('TOPUP').n,
      withdrawalVnd: -sum('WITHDRAWAL_DEBIT').delta,
      withdrawalEntries: sum('WITHDRAWAL_DEBIT').n,
    };
  }

  /** Ledger sums per Vietnam day and kind, the rows of the money report. Positive VND for money in (top-up) and for commission / withdrawals taken, signed for adjustments. */
  async ledgerByDay(context: TransactionContext, fromMs: number, toMs: number): Promise<Array<{ day: string; topupVnd: number; commissionVnd: number; adjustmentNetVnd: number; withdrawalVnd: number }>> {
    const result = await context.query<{ day: string; kind: string; delta: string }>(
      `SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'Asia/Ho_Chi_Minh'), 'YYYY-MM-DD') AS day, entry_kind AS kind, COALESCE(sum(delta_vnd), 0)::text AS delta
         FROM app.wallet_ledger_entries
        WHERE created_at >= to_timestamp($1::bigint / 1000.0) AND created_at < to_timestamp($2::bigint / 1000.0)
        GROUP BY 1, 2 ORDER BY 1`,
      [fromMs, toMs],
    );
    const days = new Map<string, { day: string; topupVnd: number; commissionVnd: number; adjustmentNetVnd: number; withdrawalVnd: number }>();
    for (const row of result.rows) {
      const entry = days.get(row.day) ?? { day: row.day, topupVnd: 0, commissionVnd: 0, adjustmentNetVnd: 0, withdrawalVnd: 0 };
      const delta = whole(row.delta);
      if (row.kind === 'TOPUP') {
        entry.topupVnd += delta;
      } else if (row.kind === 'COMMISSION_DEBIT') {
        entry.commissionVnd += -delta;
      } else if (row.kind === 'WITHDRAWAL_DEBIT') {
        entry.withdrawalVnd += -delta;
      } else {
        entry.adjustmentNetVnd += delta;
      }
      days.set(row.day, entry);
    }
    return [...days.values()];
  }

  /** The control total: the sum of every ledger row against the sum of the wallet balances. A difference is shown, never hidden. */
  async reconciliation(context: TransactionContext): Promise<{ ledgerSumVnd: number; walletBalanceVnd: number; differenceVnd: number }> {
    const result = await context.query<{ ledger: string; balance: string }>(
      `SELECT (SELECT COALESCE(sum(delta_vnd), 0) FROM app.wallet_ledger_entries)::text AS ledger, (SELECT COALESCE(sum(balance_vnd), 0) FROM app.driver_wallets)::text AS balance`,
    );
    const ledgerSumVnd = whole(result.rows[0]?.ledger);
    const walletBalanceVnd = whole(result.rows[0]?.balance);
    return { ledgerSumVnd, walletBalanceVnd, differenceVnd: walletBalanceVnd - ledgerSumVnd };
  }

  /**
   * The withdrawals still open RIGHT NOW, by state: waiting for an administrator (`pending`), being transferred (`processing`) and those whose outcome is not known
   * (`unknownOutcome`: the transfer may or may not have happened, so they are never counted as paid or as not paid).
   */
  async openWithdrawals(context: TransactionContext): Promise<{ pending: number; pendingVnd: number; processing: number; unknownOutcome: number; unknownOutcomeVnd: number }> {
    const result = await context.query<Record<string, string>>(
      `SELECT count(*) FILTER (WHERE state = 'PENDING')::text AS p, COALESCE(sum(amount_vnd) FILTER (WHERE state = 'PENDING'), 0)::text AS pa,
              count(*) FILTER (WHERE state = 'PROCESSING')::text AS x,
              count(*) FILTER (WHERE state = 'RECONCILIATION')::text AS r, COALESCE(sum(amount_vnd) FILTER (WHERE state = 'RECONCILIATION'), 0)::text AS ra
         FROM app.wallet_withdrawals`,
    );
    const row = result.rows[0];
    return { pending: whole(row?.p), pendingVnd: whole(row?.pa), processing: whole(row?.x), unknownOutcome: whole(row?.r), unknownOutcomeVnd: whole(row?.ra) };
  }

  async pendingTopups(context: TransactionContext): Promise<PendingTopups> {
    const result = await context.query<{ n: string; amount: string }>(
      `SELECT count(*)::text AS n, COALESCE(sum(amount_requested_vnd), 0)::text AS amount FROM app.wallet_topup_requests WHERE state = 'PENDING'`,
    );
    return { count: whole(result.rows[0]?.n), requestedVnd: whole(result.rows[0]?.amount) };
  }

  /** The top-up requests still PENDING, oldest first (M12 "Việc cần xử lý": one row per request). The Shipper is named by the caller through M03. */
  async pendingTopupList(context: TransactionContext, limit: number): Promise<Array<{ requestId: string; driverId: string; amountVnd: number; sinceMs: number }>> {
    const result = await context.query<{ request_id: string; driver_id: string; amount: string; since: string }>(
      `SELECT request_id::text AS request_id, driver_id::text AS driver_id, amount_requested_vnd::text AS amount, (extract(epoch FROM created_at) * 1000)::bigint::text AS since
         FROM app.wallet_topup_requests WHERE state = 'PENDING' ORDER BY created_at, request_id LIMIT $1::int`,
      [limit],
    );
    return result.rows.map((row) => ({ requestId: row.request_id, driverId: row.driver_id, amountVnd: whole(row.amount), sinceMs: whole(row.since) }));
  }

  /**
   * The withdrawals not finished (PENDING, PROCESSING, RECONCILIATION), oldest wait first. Waiting since: the request (PENDING), the claim (PROCESSING) or the
   * report that the outcome is unknown (RECONCILIATION): the moment the CURRENT step began.
   */
  async openWithdrawalList(context: TransactionContext, limit: number): Promise<Array<{ withdrawalId: string; driverId: string; state: string; amountVnd: number; sinceMs: number }>> {
    const since = `CASE state WHEN 'PENDING' THEN created_at WHEN 'PROCESSING' THEN COALESCE(processing_started_at, created_at) ELSE COALESCE(reconciliation_reported_at, updated_at) END`;
    const result = await context.query<{ withdrawal_id: string; driver_id: string; state: string; amount: string; since: string }>(
      `SELECT withdrawal_id::text AS withdrawal_id, driver_id::text AS driver_id, state, amount_vnd::text AS amount, (extract(epoch FROM ${since}) * 1000)::bigint::text AS since
         FROM app.wallet_withdrawals WHERE state IN ('PENDING', 'PROCESSING', 'RECONCILIATION') ORDER BY ${since}, withdrawal_id LIMIT $1::int`,
      [limit],
    );
    return result.rows.map((row) => ({ withdrawalId: row.withdrawal_id, driverId: row.driver_id, state: row.state, amountVnd: whole(row.amount), sinceMs: whole(row.since) }));
  }
}
