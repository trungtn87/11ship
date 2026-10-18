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

@Injectable()
export class WalletReportReader {
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

  async pendingTopups(context: TransactionContext): Promise<PendingTopups> {
    const result = await context.query<{ n: string; amount: string }>(
      `SELECT count(*)::text AS n, COALESCE(sum(amount_requested_vnd), 0)::text AS amount FROM app.wallet_topup_requests WHERE state = 'PENDING'`,
    );
    return { count: whole(result.rows[0]?.n), requestedVnd: whole(result.rows[0]?.amount) };
  }
}
