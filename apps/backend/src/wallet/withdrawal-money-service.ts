import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppError, TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { WithdrawalRepository, WithdrawalRow } from './withdrawal-repository';

// M04-C: the money side of a withdrawal, in four steps that follow its life (ADR-004 4.1 and 7). Each takes the caller's TransactionContext and commits nothing:
// it runs in the transaction that also moves the withdrawal, the event, the audit row and the idempotency record, so they change together or not at all (the database
// proves their agreement again at COMMIT: wallet_withdrawal_assert). The caller already holds, in ADR-004 order, the idempotency record, the actor, the Shipper root
// (drivers FOR UPDATE) and, for the administration, the withdrawal's wallet; this class locks the wallet FOR UPDATE (a no-op when already held), then the hold.
//
//   reserve        create:                 available >= amount  ->  a WITHDRAWAL hold ACTIVE, held += amount                  (no ledger row, balance unchanged)
//   release        cancel / not sent:      hold ACTIVE          ->  RELEASED, held -= amount                                  (no ledger row, balance unchanged)
//   capture        PAID:                   hold ACTIVE          ->  CAPTURED, one WITHDRAWAL_DEBIT, balance -= amount, held -= amount
//
// Amounts are bigint end to end. Nothing here calls a bank: PAID only RECORDS a transfer an administrator made by hand.

interface LockedWallet {
  readonly walletId: string;
  readonly balanceVnd: bigint;
  readonly heldVnd: bigint;
  readonly version: string;
}

const CLOCK = `date_trunc('milliseconds', clock_timestamp())`;

function bigintOf(raw: unknown): bigint {
  if (typeof raw !== 'string' || !/^-?[0-9]{1,19}$/.test(raw)) {
    throw new TechnicalError('internal', 'Database returned an unexpected number');
  }
  return BigInt(raw);
}

@Injectable()
export class WithdrawalMoneyService {
  constructor(private readonly withdrawals: WithdrawalRepository) {}

  /** The wallet of a Shipper FOR UPDATE, or undefined when there is none (no wallet means no money). */
  async lockWalletOfDriver(context: TransactionContext, driverId: string): Promise<LockedWallet | undefined> {
    const result = await context.query<{ wallet_id: string; balance_vnd: string; held_vnd: string; version: string }>(
      `SELECT wallet_id::text AS wallet_id, balance_vnd::text AS balance_vnd, held_vnd::text AS held_vnd, version::text AS version FROM app.driver_wallets WHERE driver_id = $1::uuid FOR UPDATE`,
      [driverId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : { walletId: row.wallet_id, balanceVnd: bigintOf(row.balance_vnd), heldVnd: bigintOf(row.held_vnd), version: row.version };
  }

  async #lockWallet(context: TransactionContext, walletId: string): Promise<LockedWallet> {
    const result = await context.query<{ wallet_id: string; balance_vnd: string; held_vnd: string; version: string }>(
      `SELECT wallet_id::text AS wallet_id, balance_vnd::text AS balance_vnd, held_vnd::text AS held_vnd, version::text AS version FROM app.driver_wallets WHERE wallet_id = $1::uuid FOR UPDATE`,
      [walletId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new TechnicalError('internal', 'Wallet of a withdrawal vanished');
    }
    return { walletId: row.wallet_id, balanceVnd: bigintOf(row.balance_vnd), heldVnd: bigintOf(row.held_vnd), version: row.version };
  }

  /**
   * Creates the withdrawal and sets its amount aside, in this transaction. The wallet is locked FOR UPDATE by the caller first (lockWalletOfDriver). Throws
   * WITHDRAWAL_INSUFFICIENT_AVAILABLE (nothing written) when balance - held < amount, WITHDRAWAL_BANK_NOT_VERIFIED when the Shipper has no verified bank account.
   */
  async reserve(context: TransactionContext, wallet: LockedWallet, input: { driverId: string; amountVnd: bigint; createdByUserId: string }): Promise<WithdrawalRow> {
    if (input.amountVnd <= 0n) {
      throw new TechnicalError('internal', 'A withdrawal needs a positive amount');
    }
    if (wallet.balanceVnd - wallet.heldVnd < input.amountVnd) {
      throw new AppError('WITHDRAWAL_INSUFFICIENT_AVAILABLE');
    }
    const withdrawalId = randomUUID();
    const holdId = randomUUID();
    const withdrawal = await this.withdrawals.insertPending(context, { withdrawalId, walletId: wallet.walletId, driverId: input.driverId, holdId, amountVnd: input.amountVnd, createdByUserId: input.createdByUserId });
    if (withdrawal === undefined) {
      throw new AppError('WITHDRAWAL_BANK_NOT_VERIFIED');
    }
    await context.query(
      `INSERT INTO app.wallet_holds (hold_id, wallet_id, purpose, amount_vnd, status, commission_assignment_id, withdrawal_id, version, created_at, updated_at, resolved_at)
       SELECT $1::uuid, $2::uuid, 'WITHDRAWAL', $3::bigint, 'ACTIVE', NULL, $4::uuid, 1, ${CLOCK}, ${CLOCK}, NULL`,
      [holdId, wallet.walletId, input.amountVnd.toString(), withdrawalId],
    );
    await this.#moveWallet(context, wallet, 0n, input.amountVnd);
    return withdrawal;
  }

  /** Gives the amount back (held -= amount). The hold goes ACTIVE -> RELEASED once; the ledger and the balance are untouched. */
  async release(context: TransactionContext, withdrawal: WithdrawalRow): Promise<void> {
    const wallet = await this.#lockWallet(context, withdrawal.walletId);
    const hold = await this.#lockHold(context, withdrawal);
    if (wallet.heldVnd < hold.amountVnd) {
      throw new TechnicalError('internal', 'Withdrawal hold exceeds the held amount');
    }
    await this.#resolveHold(context, hold, 'RELEASED');
    await this.#moveWallet(context, wallet, 0n, -hold.amountVnd);
  }

  /**
   * Takes the amount that was set aside: the hold goes ACTIVE -> CAPTURED, ONE WITHDRAWAL_DEBIT of exactly that amount is appended and the balance and the held
   * amount both fall by it. The caller then moves the withdrawal to PAID in the same transaction. Never debits what is not held.
   */
  async capture(context: TransactionContext, withdrawal: WithdrawalRow): Promise<{ readonly sequenceNo: number; readonly balanceAfterVnd: bigint }> {
    const wallet = await this.#lockWallet(context, withdrawal.walletId);
    const hold = await this.#lockHold(context, withdrawal);
    if (wallet.heldVnd < hold.amountVnd || wallet.balanceVnd < hold.amountVnd) {
      throw new TechnicalError('internal', 'Withdrawal hold exceeds the wallet');
    }
    const last = await context.query<{ sequence_no: string; balance_after_vnd: string }>(
      `SELECT l.sequence_no::text AS sequence_no, l.balance_after_vnd::text AS balance_after_vnd FROM app.wallet_ledger_entries l WHERE l.wallet_id = $1::uuid ORDER BY l.sequence_no DESC LIMIT 1`,
      [wallet.walletId],
    );
    const lastRow = last.rows[0];
    if ((lastRow === undefined ? 0n : bigintOf(lastRow.balance_after_vnd)) !== wallet.balanceVnd) {
      // The ledger and the balance disagree before this debit: never post on top of a drift.
      throw new TechnicalError('internal', 'Wallet balance differs from its ledger');
    }
    const sequenceNo = (lastRow === undefined ? 0 : Number(bigintOf(lastRow.sequence_no))) + 1;
    const balanceAfter = wallet.balanceVnd - hold.amountVnd;
    await this.#resolveHold(context, hold, 'CAPTURED');
    await context.query(
      `INSERT INTO app.wallet_ledger_entries (entry_id, wallet_id, sequence_no, entry_kind, delta_vnd, balance_after_vnd, created_at, withdrawal_id)
       VALUES ($1::uuid, $2::uuid, $3::bigint, 'WITHDRAWAL_DEBIT', -$4::bigint, $5::bigint, ${CLOCK}, $6::uuid)`,
      [randomUUID(), wallet.walletId, sequenceNo, hold.amountVnd.toString(), balanceAfter.toString(), withdrawal.withdrawalId],
    );
    await this.#moveWallet(context, wallet, -hold.amountVnd, -hold.amountVnd);
    return { sequenceNo, balanceAfterVnd: balanceAfter };
  }

  async #lockHold(context: TransactionContext, withdrawal: WithdrawalRow): Promise<{ holdId: string; amountVnd: bigint; version: string }> {
    const result = await context.query<{ hold_id: string; amount_vnd: string; status: string; version: string }>(
      `SELECT hold_id::text AS hold_id, amount_vnd::text AS amount_vnd, status, version::text AS version FROM app.wallet_holds
        WHERE hold_id = $1::uuid AND withdrawal_id = $2::uuid AND purpose = 'WITHDRAWAL' FOR UPDATE`,
      [withdrawal.holdId, withdrawal.withdrawalId],
    );
    const row = result.rows[0];
    if (row === undefined || row.status !== 'ACTIVE' || bigintOf(row.amount_vnd) !== withdrawal.amountVnd) {
      // An open withdrawal always has its ACTIVE hold of its own amount: anything else is drift, never repaired here.
      throw new TechnicalError('internal', 'Withdrawal hold is missing or not active');
    }
    return { holdId: row.hold_id, amountVnd: bigintOf(row.amount_vnd), version: row.version };
  }

  async #resolveHold(context: TransactionContext, hold: { holdId: string; version: string }, status: 'CAPTURED' | 'RELEASED'): Promise<void> {
    const updated = await context.query(
      `UPDATE app.wallet_holds SET status = $2::varchar, version = version + 1, updated_at = ${CLOCK}, resolved_at = ${CLOCK} WHERE hold_id = $1::uuid AND status = 'ACTIVE' AND version = $3::bigint`,
      [hold.holdId, status, hold.version],
    );
    if (updated.rowCount !== 1) {
      throw new TechnicalError('internal', 'Withdrawal hold changed while locked');
    }
  }

  async #moveWallet(context: TransactionContext, wallet: LockedWallet, balanceDelta: bigint, heldDelta: bigint): Promise<void> {
    const updated = await context.query(
      `UPDATE app.driver_wallets SET balance_vnd = balance_vnd + $2::bigint, held_vnd = held_vnd + $3::bigint, version = version + 1, updated_at = ${CLOCK}
        WHERE wallet_id = $1::uuid AND version = $4::bigint`,
      [wallet.walletId, balanceDelta.toString(), heldDelta.toString(), wallet.version],
    );
    if (updated.rowCount !== 1) {
      throw new TechnicalError('internal', 'Wallet changed while locked');
    }
  }
}
