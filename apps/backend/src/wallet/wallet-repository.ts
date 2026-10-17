import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { assertHoldRowSound, assertWalletRowSound, HoldPurpose, HoldRow, HoldStatus, WalletRow } from './wallet-types';

// SQL of app.driver_wallets (M04-A1). It only reads and inserts a zero wallet: there is no UPDATE here, because no package of M04-A1
// moves money. Every amount arrives as text from PostgreSQL and is parsed to bigint; a malformed value is an internal error.

interface RawWallet {
  wallet_id: string;
  driver_id: string;
  balance_vnd: string;
  held_vnd: string;
  version: string;
  created_ms: string;
  updated_ms: string;
}

const COLUMNS = `w.wallet_id::text AS wallet_id, w.driver_id::text AS driver_id, w.balance_vnd::text AS balance_vnd, w.held_vnd::text AS held_vnd,
  w.version::text AS version, (extract(epoch FROM w.created_at) * 1000)::bigint::text AS created_ms,
  (extract(epoch FROM w.updated_at) * 1000)::bigint::text AS updated_ms`;

function toBigint(raw: unknown): bigint {
  if (typeof raw !== 'string' || !/^-?[0-9]{1,19}$/.test(raw)) {
    throw new TechnicalError('internal', 'Database returned an unexpected number');
  }
  return BigInt(raw);
}

function toMs(raw: unknown): number {
  const value = Number(toBigint(raw));
  if (!Number.isSafeInteger(value)) {
    throw new TechnicalError('internal', 'Database returned an unexpected time');
  }
  return value;
}

function toWallet(row: RawWallet): WalletRow {
  return assertWalletRowSound({
    walletId: row.wallet_id,
    driverId: row.driver_id,
    balanceVnd: toBigint(row.balance_vnd),
    heldVnd: toBigint(row.held_vnd),
    version: toBigint(row.version),
    createdAtMs: toMs(row.created_ms),
    updatedAtMs: toMs(row.updated_ms),
  });
}

interface RawHold {
  hold_id: string;
  wallet_id: string;
  purpose: string;
  amount_vnd: string;
  status: string;
  commission_assignment_id: string | null;
  withdrawal_id: string | null;
  version: string;
  created_ms: string;
  resolved_ms: string | null;
}

const HOLD_COLUMNS = `h.hold_id::text AS hold_id, h.wallet_id::text AS wallet_id, h.purpose, h.amount_vnd::text AS amount_vnd, h.status,
  h.commission_assignment_id::text AS commission_assignment_id, h.withdrawal_id::text AS withdrawal_id, h.version::text AS version,
  (extract(epoch FROM h.created_at) * 1000)::bigint::text AS created_ms, (extract(epoch FROM h.resolved_at) * 1000)::bigint::text AS resolved_ms`;

function toHold(row: RawHold): HoldRow {
  if ((row.purpose !== 'COMMISSION' && row.purpose !== 'WITHDRAWAL') || (row.status !== 'ACTIVE' && row.status !== 'CAPTURED' && row.status !== 'RELEASED')) {
    throw new TechnicalError('internal', 'Database returned an unexpected hold');
  }
  return assertHoldRowSound({
    holdId: row.hold_id,
    walletId: row.wallet_id,
    purpose: row.purpose as HoldPurpose,
    amountVnd: toBigint(row.amount_vnd),
    status: row.status as HoldStatus,
    commissionAssignmentId: row.commission_assignment_id,
    withdrawalId: row.withdrawal_id,
    version: toBigint(row.version),
    createdAtMs: toMs(row.created_ms),
    resolvedAtMs: row.resolved_ms === null ? null : toMs(row.resolved_ms),
  });
}

@Injectable()
export class WalletRepository {
  /** Every hold of a wallet, oldest first. A plain read (M04-A2.1 has no hold writer): no lock, no side effect. */
  async listHolds(context: TransactionContext, walletId: string): Promise<HoldRow[]> {
    const result = await context.query<RawHold>(
      `SELECT ${HOLD_COLUMNS} FROM app.wallet_holds h WHERE h.wallet_id = $1::uuid ORDER BY h.created_at, h.hold_id`,
      [walletId],
    );
    return result.rows.map(toHold);
  }

  /** The wallet of a driver exactly as stored, or undefined. A plain read: no lock, no insert. */
  async findByDriverId(context: TransactionContext, driverId: string): Promise<WalletRow | undefined> {
    const result = await context.query<RawWallet>(`SELECT ${COLUMNS} FROM app.driver_wallets w WHERE w.driver_id = $1::uuid`, [driverId]);
    const row = result.rows[0];
    return row === undefined ? undefined : toWallet(row);
  }

  /**
   * Inserts the zero wallet of a driver. ON CONFLICT (driver_id) DO NOTHING lets the database decide a race (UNIQUE driver_id): the
   * caller already holds the driver lock, so a second request waits for it, but this statement stays correct without it. Returns the
   * new row, or undefined when the wallet already existed. The balance, the held amount and the version are fixed literals: nothing a
   * caller passes can open a wallet with money in it (a trigger refuses it anyway).
   */
  async insertZero(context: TransactionContext, walletId: string, driverId: string): Promise<WalletRow | undefined> {
    const result = await context.query<RawWallet>(
      `WITH clock AS (SELECT date_trunc('milliseconds', clock_timestamp()) AS t),
            inserted AS (
              INSERT INTO app.driver_wallets (wallet_id, driver_id, balance_vnd, held_vnd, version, created_at, updated_at)
              SELECT $1::uuid, $2::uuid, 0, 0, 1, clock.t, clock.t FROM clock
              ON CONFLICT (driver_id) DO NOTHING
              RETURNING *
            )
       SELECT ${COLUMNS} FROM inserted w`,
      [walletId, driverId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toWallet(row);
  }
}
