import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { WalletRepository } from './wallet-repository';
import { WalletHoldRow } from './wallet-types';

// M04-A2.2: the commission of a delivery, in three steps that follow the life of an assignment (ADR-004 4.1).
//
//   reserveCommission   accept:      available >= amount   ->  a hold ACTIVE, held += amount          (no ledger row)
//   captureCommission   completed:   hold ACTIVE           ->  CAPTURED, a COMMISSION_DEBIT, balance -= amount, held -= amount
//   releaseCommission   cancel/fail: hold ACTIVE           ->  RELEASED, held -= amount              (no ledger row)
//
// Each takes the caller's TransactionContext and commits nothing: it runs in the transaction that also moves the assignment, so the hold, the
// assignment and the delivery change together or not at all (the database checks their agreement at COMMIT). The caller holds the DRIVER row
// lock (the root of every money path); each step then locks the wallet row. The amount is the one SNAPSHOTTED on the assignment, never the
// current setting. A repeat of capture or release on a hold already in that state is answered `already`, with nothing written; the opposite
// terminal state is `conflict`. Amounts are bigint end to end. The database gates (the hold source gate, the ledger source gate, the deferred
// wallet and commission invariants) refuse anything this code might get wrong.

export type ReserveOutcome =
  | { readonly kind: 'reserved'; readonly hold: WalletHoldRow }
  /** The wallet does not exist or its available money (balance - held) is below the amount. Nothing was written. */
  | { readonly kind: 'insufficient' };

export type SettleOutcome =
  | { readonly kind: 'done'; readonly hold: WalletHoldRow }
  /** This very transition already happened (a repeat). Nothing was written. */
  | { readonly kind: 'already'; readonly hold: WalletHoldRow }
  /** The hold is in the opposite terminal state (or there is none). Nothing was written. */
  | { readonly kind: 'conflict' };

interface LockedWallet {
  wallet_id: string;
  balance_vnd: string;
  held_vnd: string;
  version: string;
}

const CLOCK = `date_trunc('milliseconds', clock_timestamp())`;

function bigintOf(raw: unknown): bigint {
  if (typeof raw !== 'string' || !/^-?[0-9]{1,19}$/.test(raw)) {
    throw new TechnicalError('internal', 'Database returned an unexpected number');
  }
  return BigInt(raw);
}

@Injectable()
export class CommissionHoldService {
  constructor(private readonly wallets: WalletRepository) {}

  /** Sets `amountVnd` aside for `assignmentId`. The assignment row must already exist in this transaction (the database gate checks it). */
  async reserveCommission(context: TransactionContext, input: { readonly driverId: string; readonly assignmentId: string; readonly amountVnd: bigint }): Promise<ReserveOutcome> {
    if (input.amountVnd <= 0n) {
      throw new TechnicalError('internal', 'A commission hold needs a positive amount');
    }
    const wallet = await this.#lockByDriver(context, input.driverId);
    if (wallet === undefined || bigintOf(wallet.balance_vnd) - bigintOf(wallet.held_vnd) < input.amountVnd) {
      return { kind: 'insufficient' };
    }
    const holdId = randomUUID();
    await context.query(
      `INSERT INTO app.wallet_holds (hold_id, wallet_id, purpose, amount_vnd, status, commission_assignment_id, withdrawal_id, version, created_at, updated_at, resolved_at)
       SELECT $1::uuid, $2::uuid, 'COMMISSION', $3::bigint, 'ACTIVE', $4::uuid, NULL, 1, ${CLOCK}, ${CLOCK}, NULL`,
      [holdId, wallet.wallet_id, input.amountVnd.toString(), input.assignmentId],
    );
    await this.#moveWallet(context, wallet, 0n, input.amountVnd);
    return { kind: 'reserved', hold: await this.#hold(context, input.assignmentId) };
  }

  /** The delivery completed: take the commission that was set aside. Once. */
  async captureCommission(context: TransactionContext, assignmentId: string): Promise<SettleOutcome> {
    const hold = await this.#lockHold(context, assignmentId);
    if (hold === undefined || hold.status === 'RELEASED') {
      return { kind: 'conflict' };
    }
    if (hold.status === 'CAPTURED') {
      return { kind: 'already', hold };
    }
    const wallet = await this.#lockWallet(context, hold.walletId);
    const balance = bigintOf(wallet.balance_vnd);
    const held = bigintOf(wallet.held_vnd);
    if (held < hold.amountVnd || balance < hold.amountVnd) {
      // The money that was reserved is not there: never debit what is not held. The transaction rolls back and nothing is repaired.
      throw new TechnicalError('internal', 'Commission hold exceeds the wallet');
    }
    await this.#resolve(context, hold, 'CAPTURED');
    await context.query(
      `INSERT INTO app.wallet_ledger_entries (entry_id, wallet_id, sequence_no, entry_kind, delta_vnd, balance_after_vnd, created_at, commission_assignment_id)
       SELECT $1::uuid, $2::uuid, COALESCE(MAX(l.sequence_no), 0) + 1, 'COMMISSION_DEBIT', -$3::bigint, $4::bigint, ${CLOCK}, $5::uuid
         FROM app.wallet_ledger_entries l WHERE l.wallet_id = $2::uuid`,
      [randomUUID(), hold.walletId, hold.amountVnd.toString(), (balance - hold.amountVnd).toString(), assignmentId],
    );
    await this.#moveWallet(context, wallet, -hold.amountVnd, -hold.amountVnd);
    return { kind: 'done', hold: await this.#hold(context, assignmentId) };
  }

  /** The assignment ended without a successful delivery: give the commission back. Once. */
  async releaseCommission(context: TransactionContext, assignmentId: string): Promise<SettleOutcome> {
    const hold = await this.#lockHold(context, assignmentId);
    if (hold === undefined || hold.status === 'CAPTURED') {
      return { kind: 'conflict' };
    }
    if (hold.status === 'RELEASED') {
      return { kind: 'already', hold };
    }
    const wallet = await this.#lockWallet(context, hold.walletId);
    if (bigintOf(wallet.held_vnd) < hold.amountVnd) {
      throw new TechnicalError('internal', 'Commission hold exceeds the held amount');
    }
    await this.#resolve(context, hold, 'RELEASED');
    await this.#moveWallet(context, wallet, 0n, -hold.amountVnd);
    return { kind: 'done', hold: await this.#hold(context, assignmentId) };
  }

  /** The hold of an assignment as stored (a plain read), or undefined. */
  async holdOf(context: TransactionContext, assignmentId: string): Promise<WalletHoldRow | undefined> {
    const row = await this.wallets.findHoldBySource(context, assignmentId);
    return row;
  }

  async #hold(context: TransactionContext, assignmentId: string): Promise<WalletHoldRow> {
    const hold = await this.wallets.findHoldBySource(context, assignmentId);
    if (hold === undefined) {
      throw new TechnicalError('internal', 'Commission hold vanished');
    }
    return hold;
  }

  async #lockHold(context: TransactionContext, assignmentId: string): Promise<WalletHoldRow | undefined> {
    await context.query('SELECT hold_id FROM app.wallet_holds WHERE commission_assignment_id = $1::uuid FOR UPDATE', [assignmentId]);
    return this.wallets.findHoldBySource(context, assignmentId);
  }

  async #lockByDriver(context: TransactionContext, driverId: string): Promise<LockedWallet | undefined> {
    const result = await context.query<LockedWallet>(
      `SELECT wallet_id::text AS wallet_id, balance_vnd::text AS balance_vnd, held_vnd::text AS held_vnd, version::text AS version
         FROM app.driver_wallets WHERE driver_id = $1::uuid FOR UPDATE`,
      [driverId],
    );
    return result.rows[0];
  }

  async #lockWallet(context: TransactionContext, walletId: string): Promise<LockedWallet> {
    const result = await context.query<LockedWallet>(
      `SELECT wallet_id::text AS wallet_id, balance_vnd::text AS balance_vnd, held_vnd::text AS held_vnd, version::text AS version
         FROM app.driver_wallets WHERE wallet_id = $1::uuid FOR UPDATE`,
      [walletId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new TechnicalError('internal', 'Wallet of a hold vanished');
    }
    return row;
  }

  async #resolve(context: TransactionContext, hold: WalletHoldRow, status: 'CAPTURED' | 'RELEASED'): Promise<void> {
    const updated = await context.query(
      `UPDATE app.wallet_holds SET status = $2::varchar, version = version + 1, updated_at = ${CLOCK}, resolved_at = ${CLOCK}
        WHERE hold_id = $1::uuid AND status = 'ACTIVE' AND version = $3::bigint`,
      [hold.holdId, status, hold.version.toString()],
    );
    if (updated.rowCount !== 1) {
      throw new TechnicalError('internal', 'Commission hold changed while locked');
    }
  }

  /** Moves the wallet by a delta of the balance and of the held amount (both may be negative) and advances its version; the checks are the database's. */
  async #moveWallet(context: TransactionContext, wallet: LockedWallet, balanceDelta: bigint, heldDelta: bigint): Promise<void> {
    const updated = await context.query(
      `UPDATE app.driver_wallets
          SET balance_vnd = balance_vnd + $2::bigint, held_vnd = held_vnd + $3::bigint, version = version + 1, updated_at = ${CLOCK}
        WHERE wallet_id = $1::uuid AND version = $4::bigint`,
      [wallet.wallet_id, balanceDelta.toString(), heldDelta.toString(), wallet.version],
    );
    if (updated.rowCount !== 1) {
      throw new TechnicalError('internal', 'Wallet changed while locked');
    }
  }
}
