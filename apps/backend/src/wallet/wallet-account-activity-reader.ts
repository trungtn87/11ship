import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../transaction/transaction-context';

const OPEN_WITHDRAWAL_STATES = ['PENDING', 'PROCESSING', 'RECONCILIATION'] as const;

/**
 * What the account lifecycle (M01-LOCK-01) asks of the wallet about ONE shipper (driver id), answered from the wallet's own tables: the
 * Wallet package is the only place that issues SQL against them. Plain reads except `lockWallet`, which only takes the row lock that
 * the wallet writers take too, so a concurrent writer waits until the lock / delete transaction ends. No state, balance rule or amount is
 * decided here: a balance alone is NOT money in progress.
 */
@Injectable()
export class WalletAccountActivityReader {
  /** The driver has a wallet (and so a ledger, holds, top-ups, withdrawals, adjustments that must be kept). */
  async hasWallet(context: TransactionContext, driverId: string | undefined): Promise<boolean> {
    if (driverId === undefined) {
      return false;
    }
    const result = await context.query('SELECT 1 FROM app.driver_wallets WHERE driver_id = $1::uuid LIMIT 1', [driverId]);
    return result.rows.length > 0;
  }

  /** ACTIVE holds + withdrawals not paid or cancelled + top-up requests awaiting a decision. */
  async moneyInProgress(context: TransactionContext, driverId: string | undefined): Promise<number> {
    if (driverId === undefined) {
      return 0;
    }
    const result = await context.query<{ n: number }>(
      `SELECT (
          (SELECT count(*) FROM app.wallet_holds h JOIN app.driver_wallets w ON w.wallet_id = h.wallet_id WHERE h.status = 'ACTIVE' AND w.driver_id = $1::uuid)
        + (SELECT count(*) FROM app.wallet_withdrawals x WHERE x.state = ANY($2::text[]) AND x.driver_id = $1::uuid)
        + (SELECT count(*) FROM app.wallet_topup_requests t WHERE t.state = 'PENDING' AND t.driver_id = $1::uuid)
        )::int AS n`,
      [driverId, [...OPEN_WITHDRAWAL_STATES]],
    );
    const row = result.rows[0];
    if (row === undefined || !Number.isInteger(row.n) || row.n < 0) {
      throw new Error('Wallet activity check returned no count');
    }
    return row.n;
  }

  /** The wallet row FOR UPDATE (none = nothing to lock). */
  async lockWallet(context: TransactionContext, driverId: string | undefined): Promise<void> {
    if (driverId !== undefined) {
      await context.query('SELECT wallet_id FROM app.driver_wallets WHERE driver_id = $1::uuid FOR UPDATE', [driverId]);
    }
  }
}
