import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Pool, PoolClient } from 'pg';
import { AppError } from '../../apps/backend/src/common/app-errors';
import { TransactionError } from '../../apps/backend/src/transaction/transaction-error';
import { DriverRepository } from '../../apps/backend/src/driver/driver-repository';
import { NotIntegratedDriverWalletPort } from '../../apps/backend/src/driver/driver-wallet-port';
import { poolClientSource } from '../../apps/backend/src/transaction/pg-client-source';
import { WalletRepository } from '../../apps/backend/src/wallet/wallet-repository';
import { WalletService } from '../../apps/backend/src/wallet/wallet-service';
import { eventually, failureOf } from './support/async-helpers';
import { AuthApp, createDriverFor, purgePhone, randomPhone, rowLockWaiters, startAuthApp } from './support/auth-fixtures';
import { WALLET_DOWN_SQL, WALLET_UP_SQL } from './support/wallet-migration-sql';
import { WALLET_HOLD_DOWN_SQL, WALLET_HOLD_UP_SQL } from './support/wallet-hold-migration-sql';
import { holdRowLock } from './support/lock-fixtures';
import { loadIntegrationConfig } from './support/test-helpers';
import { managerFor, testPool } from './support/transaction-fixtures';

// M04-A1 against a REAL PostgreSQL test database: the wallet core (one wallet per Shipper, created at zero), the ledger table that
// cannot be written yet, and the database rules that keep the balance and the ledger identical. Nothing is mocked. The SQL error
// codes asserted are PostgreSQL's own: 23514 check, 23503 foreign key, 23505 unique, 23001 restrict (append-only / never deleted),
// 23000 integrity (the commit-time wallet invariant).
describe('M04-A1 - Shipper wallet core and ledger (schema, participant, transactions)', () => {
  const service = new WalletService(new WalletRepository(), new DriverRepository());
  const phonesToPurge: string[] = [];
  let pool: Pool;

  const manager = () => managerFor(poolClientSource(pool), { timeoutMs: 20_000 });

  async function makeDriver(): Promise<{ userId: string; driverId: string }> {
    const phone = randomPhone();
    phonesToPurge.push(phone.normalized);
    const userId = randomUUID();
    await pool.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
       VALUES ($1::uuid, $2, '$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA', now(), 'PHONE_VERIFIED', 'ACTIVE', 1, now(), now())`,
      [userId, phone.normalized],
    );
    const driverId = await createDriverFor(pool, userId);
    return { userId, driverId };
  }

  async function count(sql: string, values: unknown[] = []): Promise<number> {
    const result = await pool.query(sql, values);
    return result.rowCount ?? 0;
  }

  const walletCount = (driverId: string): Promise<number> => count('SELECT 1 FROM app.driver_wallets WHERE driver_id = $1::uuid', [driverId]);
  const ledgerCount = (): Promise<number> => count('SELECT 1 FROM app.wallet_ledger_entries');

  function sqlState(error: unknown): string | undefined {
    return typeof error === 'object' && error !== null ? ((error as { code?: string }).code) : undefined;
  }

  /**
   * The wallet invariant is a constraint trigger checked at COMMIT: the server refuses the COMMIT, and the transaction manager reports a
   * sanitized COMMIT_REJECTED (it never carries the driver message). The rollback itself is proven by the state checks that follow.
   */
  function expectCommitRejected(error: unknown): void {
    expect(error).toBeInstanceOf(TransactionError);
    expect((error as TransactionError).reason).toBe('COMMIT_REJECTED');
  }

  function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  beforeAll(() => {
    pool = testPool(loadIntegrationConfig().database, { poolMax: 6 });
  });

  afterAll(async () => {
    try {
      for (const phone of phonesToPurge) {
        await purgePhone(pool, phone);
      }
    } finally {
      await pool.end();
    }
  });

  it('1. a Shipper without a wallet reads as NOT PROVISIONED with zero amounts, and the read creates nothing', async () => {
    const { driverId } = await makeDriver();
    const view = await manager().withTransaction((context) => service.readWallet(context, driverId));
    expect(view).toEqual({ provisioned: false, driverId, balanceVnd: 0n, heldVnd: 0n, availableVnd: 0n });
    expect(await walletCount(driverId)).toBe(0);
    // A driver id that does not exist reads the same way: a read is never an error and never a write.
    const unknown = randomUUID();
    expect((await manager().withTransaction((context) => service.readWallet(context, unknown))).provisioned).toBe(false);
    expect(await walletCount(unknown)).toBe(0);
  });

  it('2. the wallet is created exactly once, at 0 VND, version 1, with no ledger row and no money; a repeat returns the same wallet', async () => {
    const { driverId } = await makeDriver();
    const first = await manager().withTransaction((context) => service.ensureZeroWallet(context, driverId));
    expect(first.created).toBe(true);
    expect(first.wallet).toMatchObject({ provisioned: true, driverId, balanceVnd: 0n, heldVnd: 0n, availableVnd: 0n, version: 1n });
    const again = await manager().withTransaction((context) => service.ensureZeroWallet(context, driverId));
    expect(again.created).toBe(false);
    expect(again.wallet.walletId).toBe(first.wallet.walletId);
    expect(await walletCount(driverId)).toBe(1);
    const read = await manager().withTransaction((context) => service.readWallet(context, driverId));
    expect(read).toEqual(first.wallet);
    expect(await count('SELECT 1 FROM app.wallet_ledger_entries WHERE wallet_id = $1::uuid', [first.wallet.walletId])).toBe(0);
  });

  it('3. two simultaneous provisioning requests for one Shipper create ONE wallet (they overlap on the driver lock)', async () => {
    const { driverId } = await makeDriver();
    const held = await holdRowLock(pool, 'SELECT 1 FROM app.drivers WHERE driver_id = $1::uuid FOR UPDATE', [driverId]);
    let released = false;
    try {
      const first = manager().withTransaction((context) => service.ensureZeroWallet(context, driverId));
      const second = manager().withTransaction((context) => service.ensureZeroWallet(context, driverId));
      // Both are inside their transactions, blocked behind the driver row: a real overlap, decided by the server.
      await eventually(async () => (await rowLockWaiters(pool)) >= 2, 'two provisioning requests blocked on the driver row lock');
      await held.release();
      released = true;
      const results = await Promise.all([first, second]);
      expect(results.map((result) => result.created).sort()).toEqual([false, true]);
      expect(results[0]?.wallet.walletId).toBe(results[1]?.wallet.walletId);
      expect(await walletCount(driverId)).toBe(1);
    } finally {
      if (!released) {
        await held.release();
      }
    }
  });

  it('4. no wallet is created for a Shipper that does not exist; the database refuses it too', async () => {
    const unknown = randomUUID();
    const error = await failureOf(() => manager().withTransaction((context) => service.ensureZeroWallet(context, unknown)));
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('DRIVER_NOT_FOUND');
    expect(await walletCount(unknown)).toBe(0);
    const direct = await failureOf(() =>
      pool.query('INSERT INTO app.driver_wallets (wallet_id, driver_id, created_at, updated_at) VALUES ($1::uuid, $2::uuid, now(), now())', [randomUUID(), unknown]),
    );
    expect(sqlState(direct)).toBe('23503');
  });

  it('the database allows one wallet per Shipper and a wallet only at zero', async () => {
    const { driverId } = await makeDriver();
    await manager().withTransaction((context) => service.ensureZeroWallet(context, driverId));
    const twin = await failureOf(() =>
      pool.query('INSERT INTO app.driver_wallets (wallet_id, driver_id, created_at, updated_at) VALUES ($1::uuid, $2::uuid, now(), now())', [randomUUID(), driverId]),
    );
    expect(sqlState(twin)).toBe('23505');
    const other = await makeDriver();
    const rich = await failureOf(() =>
      pool.query('INSERT INTO app.driver_wallets (wallet_id, driver_id, balance_vnd, created_at, updated_at) VALUES ($1::uuid, $2::uuid, 5000, now(), now())', [randomUUID(), other.driverId]),
    );
    expect(messageOf(rich)).toContain('WALLET_MUST_START_AT_ZERO');
    expect(await walletCount(other.driverId)).toBe(0);
  });

  it('5. the balance can never be negative', async () => {
    const { driverId } = await makeDriver();
    await manager().withTransaction((context) => service.ensureZeroWallet(context, driverId));
    const error = await failureOf(() => pool.query('UPDATE app.driver_wallets SET balance_vnd = -1, version = version + 1 WHERE driver_id = $1::uuid', [driverId]));
    expect(sqlState(error)).toBe('23514');
    expect((await manager().withTransaction((context) => service.readWallet(context, driverId))).balanceVnd).toBe(0n);
  });

  it('6. the held amount can never exceed the balance', async () => {
    const { driverId } = await makeDriver();
    await manager().withTransaction((context) => service.ensureZeroWallet(context, driverId));
    const error = await failureOf(() => pool.query('UPDATE app.driver_wallets SET held_vnd = 1, version = version + 1 WHERE driver_id = $1::uuid', [driverId]));
    expect(sqlState(error)).toBe('23514');
  });

  it('every update advances the version by exactly one, the identity never changes and a wallet is never deleted', async () => {
    const { driverId } = await makeDriver();
    const { wallet } = await manager().withTransaction((context) => service.ensureZeroWallet(context, driverId));
    const skipped = await failureOf(() => pool.query('UPDATE app.driver_wallets SET updated_at = now(), version = version + 2 WHERE driver_id = $1::uuid', [driverId]));
    expect(messageOf(skipped)).toContain('WALLET_VERSION_CONFLICT');
    const moved = await makeDriver();
    const rebound = await failureOf(() => pool.query('UPDATE app.driver_wallets SET driver_id = $2::uuid, version = version + 1 WHERE wallet_id = $1::uuid', [wallet.walletId, moved.driverId]));
    expect(messageOf(rebound)).toContain('WALLET_IDENTITY_IMMUTABLE');
    const deleted = await failureOf(() => pool.query('DELETE FROM app.driver_wallets WHERE wallet_id = $1::uuid', [wallet.walletId]));
    expect(sqlState(deleted)).toBe('23001');
    expect(await walletCount(driverId)).toBe(1);
  });

  it('7. the ledger cannot be changed or erased: UPDATE, DELETE and TRUNCATE are refused (even when no row matches)', async () => {
    for (const statement of ['UPDATE app.wallet_ledger_entries SET delta_vnd = 1', 'DELETE FROM app.wallet_ledger_entries', 'TRUNCATE app.wallet_ledger_entries']) {
      const error = await failureOf(() => pool.query(statement));
      expect([statement, sqlState(error), messageOf(error)]).toEqual([statement, '23001', expect.stringContaining('append-only')]);
    }
  });

  it('8. no orphan ledger row: without a business source nothing can be inserted, whatever the amounts are', async () => {
    const { driverId } = await makeDriver();
    const { wallet } = await manager().withTransaction((context) => service.ensureZeroWallet(context, driverId));
    const before = await ledgerCount();
    const error = await failureOf(() =>
      pool.query(
        `INSERT INTO app.wallet_ledger_entries (entry_id, wallet_id, sequence_no, entry_kind, delta_vnd, balance_after_vnd, created_at)
         VALUES ($1::uuid, $2::uuid, 1, 'TOPUP', 100000, 100000, now())`,
        [randomUUID(), wallet.walletId],
      ),
    );
    expect(messageOf(error)).toContain('WALLET_LEDGER_SOURCE_NOT_AVAILABLE');
    // Not even together with a matching balance in one transaction.
    const paired = await failureOf(() =>
      manager().withTransaction(async (context) => {
        await context.query(
          `INSERT INTO app.wallet_ledger_entries (entry_id, wallet_id, sequence_no, entry_kind, delta_vnd, balance_after_vnd, created_at)
           VALUES ($1::uuid, $2::uuid, 1, 'TOPUP', 100000, 100000, now())`,
          [randomUUID(), wallet.walletId],
        );
      }),
    );
    expect(messageOf(paired)).toContain('WALLET_LEDGER_SOURCE_NOT_AVAILABLE');
    expect(await ledgerCount()).toBe(before);
    // And a ledger row of a wallet that does not exist is refused by the foreign key / the gate, never stored.
    const ghost = await failureOf(() =>
      pool.query(
        `INSERT INTO app.wallet_ledger_entries (entry_id, wallet_id, sequence_no, entry_kind, delta_vnd, balance_after_vnd, created_at)
         VALUES ($1::uuid, $2::uuid, 1, 'TOPUP', 1, 1, now())`,
        [randomUUID(), randomUUID()],
      ),
    );
    expect(ghost).toBeDefined();
    expect(await ledgerCount()).toBe(before);
  });

  it('9. a balance that does not equal the ledger rolls the WHOLE transaction back at commit (WALLET_INVARIANT_VIOLATION)', async () => {
    const { driverId } = await makeDriver();
    const { wallet } = await manager().withTransaction((context) => service.ensureZeroWallet(context, driverId));
    const error = await failureOf(() =>
      manager().withTransaction(async (context) => {
        await context.query('UPDATE app.driver_wallets SET balance_vnd = 100000, version = version + 1 WHERE wallet_id = $1::uuid', [wallet.walletId]);
      }),
    );
    expectCommitRejected(error);
    const read = await manager().withTransaction((context) => service.readWallet(context, driverId));
    expect(read).toMatchObject({ provisioned: true, balanceVnd: 0n, heldVnd: 0n, version: 1n });
    // A held amount with no hold source is the same violation (until M04-A2 gives holds a source).
    const held = await failureOf(() =>
      manager().withTransaction(async (context) => {
        await context.query('UPDATE app.driver_wallets SET held_vnd = 0, updated_at = now(), version = version + 1 WHERE wallet_id = $1::uuid', [wallet.walletId]);
        await context.query('UPDATE app.driver_wallets SET balance_vnd = 5000, held_vnd = 5000, version = version + 1 WHERE wallet_id = $1::uuid', [wallet.walletId]);
      }),
    );
    expectCommitRejected(held);
    expect((await manager().withTransaction((context) => service.readWallet(context, driverId))).provisioned).toBe(true);
    expect((await manager().withTransaction((context) => service.readWallet(context, driverId))).balanceVnd).toBe(0n);
  });

  it('10. a failure in the middle of a transaction leaves nothing behind (the wallet created before the failure is rolled back too)', async () => {
    const { driverId } = await makeDriver();
    const error = await failureOf(() =>
      manager().withTransaction(async (context) => {
        await service.ensureZeroWallet(context, driverId);
        throw new Error('boom after the wallet insert');
      }),
    );
    expect(messageOf(error)).toContain('boom');
    expect(await walletCount(driverId)).toBe(0);
    // Same for a violation raised by the database after the insert: the whole transaction goes.
    const violated = await failureOf(() =>
      manager().withTransaction(async (context) => {
        await service.ensureZeroWallet(context, driverId);
        await context.query('UPDATE app.driver_wallets SET balance_vnd = 1, version = version + 1 WHERE driver_id = $1::uuid', [driverId]);
      }),
    );
    expectCommitRejected(violated);
    expect(await walletCount(driverId)).toBe(0);
  });

  it('the triggers also work with a ledger row present: chain, sign and balance rules (the source gate is lifted INSIDE a rolled-back transaction, test only)', async () => {
    const { driverId } = await makeDriver();
    const { wallet } = await manager().withTransaction((context) => service.ensureZeroWallet(context, driverId));
    const client = await pool.connect();
    const insertEntry = (sequence: number, kind: string, delta: number, after: number): Promise<unknown> =>
      client.query(
        `INSERT INTO app.wallet_ledger_entries (entry_id, wallet_id, sequence_no, entry_kind, delta_vnd, balance_after_vnd, created_at)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, now())`,
        [randomUUID(), wallet.walletId, sequence, kind, delta, after],
      );
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE app.wallet_ledger_entries DISABLE TRIGGER wallet_ledger_a_source_gate');
      await insertEntry(1, 'TOPUP', 100000, 100000);
      await client.query('UPDATE app.driver_wallets SET balance_vnd = 100000, version = version + 1 WHERE wallet_id = $1::uuid', [wallet.walletId]);
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      // Each refusal aborts the transaction in PostgreSQL, so every probe runs in its own savepoint.
      const refused = async (label: string, run: () => Promise<unknown>, needle: string): Promise<void> => {
        await client.query(`SAVEPOINT ${label}`);
        const error = await failureOf(run);
        await client.query(`ROLLBACK TO SAVEPOINT ${label}`);
        expect([label, messageOf(error).includes(needle)]).toEqual([label, true]);
      };
      await refused('wrong_sequence', () => insertEntry(3, 'TOPUP', 1, 100001), 'WALLET_LEDGER_CHAIN_BROKEN');
      await refused('wrong_balance_after', () => insertEntry(2, 'TOPUP', 1, 5), 'WALLET_LEDGER_CHAIN_BROKEN');
      await refused('wrong_sign', () => insertEntry(2, 'TOPUP', -1, 99999), 'wallet_ledger_entries_delta_ck');
      await refused('zero_delta', () => insertEntry(2, 'TOPUP', 0, 100000), 'wallet_ledger_entries_delta_ck');
      await refused('unknown_kind', () => insertEntry(2, 'FREE_MONEY', 1, 100001), '_ck');
      await refused('update', () => client.query('UPDATE app.wallet_ledger_entries SET delta_vnd = 1'), 'append-only');
      await refused('delete', () => client.query('DELETE FROM app.wallet_ledger_entries'), 'append-only');
      // The ledger and the balance move together, so the check is deferred for this one pair of statements.
      await client.query('SET CONSTRAINTS ALL DEFERRED');
      await insertEntry(2, 'WITHDRAWAL_DEBIT', -40000, 60000);
      await client.query('UPDATE app.driver_wallets SET balance_vnd = 60000, version = version + 1 WHERE wallet_id = $1::uuid', [wallet.walletId]);
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      // The ledger says 60000; a balance of 70000 breaks the invariant right here.
      await refused('balance_ne_ledger', async () => {
        await client.query('UPDATE app.driver_wallets SET balance_vnd = 70000, version = version + 1 WHERE wallet_id = $1::uuid', [wallet.walletId]);
        await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      }, 'WALLET_INVARIANT_VIOLATION');
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
    // Nothing of it persisted: the gate is back, no ledger row, the wallet is still at zero.
    expect(await count('SELECT 1 FROM app.wallet_ledger_entries WHERE wallet_id = $1::uuid', [wallet.walletId])).toBe(0);
    expect(await manager().withTransaction((context) => service.readWallet(context, driverId))).toMatchObject({ balanceVnd: 0n, version: 1n });
    const gate = await pool.query<{ tgenabled: string }>("SELECT tgenabled FROM pg_trigger WHERE tgname = 'wallet_ledger_a_source_gate'");
    expect(gate.rows.map((row) => row.tgenabled)).toEqual(['O']);
  });

  describe('down migration safety latch (money history is never dropped)', () => {
    const tablesPresent = async (client: Pool | PoolClient): Promise<string[]> =>
      (await client.query<{ n: string }>(`SELECT table_name AS n FROM information_schema.tables WHERE table_schema = 'app' AND table_name IN ('driver_wallets', 'wallet_ledger_entries') ORDER BY 1`)).rows.map((row) => row.n);

    it('a zero wallet exists: the down migration is refused and the wallet and both tables are untouched', async () => {
      const { driverId } = await makeDriver();
      await manager().withTransaction((context) => service.ensureZeroWallet(context, driverId));
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const error = await failureOf(() => client.query(WALLET_DOWN_SQL));
        expect(messageOf(error)).toContain('WALLET_DOWN_MIGRATION_REFUSED');
        expect(sqlState(error)).toBe('23000');
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
      }
      expect(await walletCount(driverId)).toBe(1);
      expect(await tablesPresent(pool)).toEqual(['driver_wallets', 'wallet_ledger_entries']);
      // Nothing was dropped: the triggers still guard the tables.
      const triggers = await pool.query(`SELECT 1 FROM pg_trigger WHERE tgname IN ('driver_wallets_guard', 'wallet_ledger_append_only', 'wallet_ledger_a_source_gate') AND NOT tgisinternal`);
      expect(triggers.rowCount).toBe(3);
    });

    it('a wallet committed while the down migration waits for the table lock is still refused (no race between the check and the DROP)', async () => {
      const { driverId } = await makeDriver();
      const writer = await pool.connect();
      const migrator = await pool.connect();
      try {
        await writer.query('BEGIN');
        await writer.query(
          `INSERT INTO app.driver_wallets (wallet_id, driver_id, balance_vnd, held_vnd, version, created_at, updated_at) VALUES ($1::uuid, $2::uuid, 0, 0, 1, now(), now())`,
          [randomUUID(), driverId],
        );
        await migrator.query('BEGIN');
        const migrating = migrator.query(WALLET_DOWN_SQL).then(() => undefined, (error: unknown) => error);
        // The migration is parked on the table lock behind the uncommitted wallet; only then does the writer commit.
        await eventually(
          async () => (await pool.query(`SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%LOCK TABLE app.driver_wallets, app.wallet_ledger_entries%'`)).rowCount === 1,
          'the down migration waits for the table lock',
        );
        await writer.query('COMMIT');
        const error = await migrating;
        expect(messageOf(error)).toContain('WALLET_DOWN_MIGRATION_REFUSED');
      } finally {
        await writer.query('ROLLBACK').catch(() => undefined);
        await migrator.query('ROLLBACK').catch(() => undefined);
        writer.release();
        migrator.release();
      }
      expect(await walletCount(driverId)).toBe(1);
      expect(await tablesPresent(pool)).toEqual(['driver_wallets', 'wallet_ledger_entries']);
    });

    it('no wallet data: up -> down -> up works (run in a transaction that is rolled back, with the existing test wallets removed only inside it)', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Other tests of this file leave committed wallets until the end; inside this rolled-back transaction the database is made empty.
        await client.query('ALTER TABLE app.driver_wallets DISABLE TRIGGER driver_wallets_no_delete');
        await client.query('DELETE FROM app.driver_wallets');
        await client.query('ALTER TABLE app.driver_wallets ENABLE TRIGGER driver_wallets_no_delete');
        await client.query(WALLET_HOLD_DOWN_SQL); // M04-A2.1 references the wallet table: the very newest, down first, up last
        await client.query(WALLET_DOWN_SQL);
        expect(await tablesPresent(client)).toEqual([]);
        await client.query(WALLET_UP_SQL);
        await client.query(WALLET_HOLD_UP_SQL);
        expect(await tablesPresent(client)).toEqual(['driver_wallets', 'wallet_ledger_entries']);
        // The re-created schema works: a zero wallet can be born again.
        const { driverId } = await (async () => {
          const found = await client.query<{ driver_id: string }>('SELECT driver_id FROM app.drivers LIMIT 1');
          return { driverId: found.rows[0]?.driver_id };
        })();
        if (driverId !== undefined) {
          await client.query(`INSERT INTO app.driver_wallets (wallet_id, driver_id, balance_vnd, held_vnd, version, created_at, updated_at) VALUES ($1::uuid, $2::uuid, 0, 0, 1, now(), now())`, [randomUUID(), driverId]);
          await client.query('SET CONSTRAINTS ALL IMMEDIATE');
        }
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
      }
      expect(await tablesPresent(pool)).toEqual(['driver_wallets', 'wallet_ledger_entries']);
    });
  });

  it('11. provisioning changes nothing of M03: the driver row, bank, history and wallet parameters are identical, and the wallet port still says "not ready / not settled"', async () => {
    const { driverId } = await makeDriver();
    const snapshot = async (): Promise<unknown> => {
      const driver = await pool.query('SELECT * FROM app.drivers WHERE driver_id = $1::uuid', [driverId]);
      const events = await pool.query('SELECT * FROM app.driver_events WHERE driver_id = $1::uuid ORDER BY created_at, event_id', [driverId]);
      const bank = await pool.query('SELECT * FROM app.driver_bank_accounts WHERE driver_id = $1::uuid', [driverId]);
      const parameters = await pool.query('SELECT * FROM app.shipper_wallet_parameters ORDER BY param_key');
      return { driver: driver.rows, events: events.rows, bank: bank.rows, parameters: parameters.rows };
    };
    const before = await snapshot();
    await manager().withTransaction((context) => service.ensureZeroWallet(context, driverId));
    expect(await snapshot()).toEqual(before);
    // Having a wallet, even a zero one, never makes the Shipper ready for orders or the profile closable.
    const port = new NotIntegratedDriverWalletPort();
    expect(await manager().withTransaction(() => port.readinessForOrders())).toEqual({ ready: false, reason: 'WALLET_NOT_AVAILABLE' });
    expect(await manager().withTransaction(() => port.settlementForClosure())).toEqual({ settled: false, reason: 'WALLET_NOT_AVAILABLE' });
  });

  it('12. no route lets a user or an administrator move money: the wallet package exposes no endpoint', async () => {
    const app: AuthApp = await startAuthApp();
    try {
      const paths = ['/wallet', '/wallets', '/wallet/topup', '/wallet/withdraw', '/wallet/adjustment', '/driver/wallet', '/driver/wallet/topups', '/driver/wallet/withdrawals'];
      for (const method of ['GET', 'POST', 'PUT'] as const) {
        for (const path of paths) {
          const response = await app.call(method, path, { body: method === 'GET' ? undefined : { amount_vnd: 100000 } });
          expect([method, path, response.status]).toEqual([method, path, 404]);
        }
      }
    } finally {
      await app.close();
    }
  });
});
