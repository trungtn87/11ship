import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Pool, PoolClient } from 'pg';
import { DriverRepository } from '../../apps/backend/src/driver/driver-repository';
import { poolClientSource } from '../../apps/backend/src/transaction/pg-client-source';
import { WalletRepository } from '../../apps/backend/src/wallet/wallet-repository';
import { WalletService } from '../../apps/backend/src/wallet/wallet-service';
import { eventually, failureOf } from './support/async-helpers';
import { createDriverFor, purgePhone, randomPhone } from './support/auth-fixtures';
import { loadIntegrationConfig } from './support/test-helpers';
import { managerFor, testPool } from './support/transaction-fixtures';
import { HOLD_DOWN_SQL, HOLD_UP_SQL } from './support/wallet-migration-sql';

// M04-A2.1 against a REAL PostgreSQL test database: the hold table, its source gate (no hold can exist until M07 / M04-C provide the
// sources), the money invariant held = SUM(ACTIVE holds), immutability / state machine, and the down latch. Fixtures that need a hold
// to exist lift the two source gates INSIDE a transaction that is always rolled back (the test role owns the tables, i.e. it plays
// the migrator); afterwards the gates are proven active again. Nothing here commits a hold, a ledger row or a balance.
describe('M04-A2.1 - Shipper wallet holds (schema, gate, invariant, immutability, down latch)', () => {
  const service = new WalletService(new WalletRepository(), new DriverRepository());
  const phonesToPurge: string[] = [];
  let pool: Pool;
  let walletId: string;
  let driverId: string;

  const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
  const sqlState = (error: unknown): string | undefined => (typeof error === 'object' && error !== null ? (error as { code?: string }).code : undefined);

  beforeAll(async () => {
    pool = testPool(loadIntegrationConfig().database, { poolMax: 6 });
    const phone = randomPhone();
    phonesToPurge.push(phone.normalized);
    const userId = randomUUID();
    await pool.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
       VALUES ($1::uuid, $2, '$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA', now(), 'PHONE_VERIFIED', 'ACTIVE', 1, now(), now())`,
      [userId, phone.normalized],
    );
    driverId = await createDriverFor(pool, userId);
    const manager = managerFor(poolClientSource(pool), { timeoutMs: 20_000 });
    walletId = (await manager.withTransaction((context) => service.ensureZeroWallet(context, driverId))).wallet.walletId;
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

  /** A transaction that is ALWAYS rolled back, with both source gates lifted and the wallet funded (ledger row + balance). */
  async function rolledBack(run: (client: PoolClient) => Promise<void>, balance = 100_000): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE app.wallet_ledger_entries DISABLE TRIGGER wallet_ledger_a_source_gate');
      await client.query('ALTER TABLE app.wallet_holds DISABLE TRIGGER wallet_holds_a_source_gate');
      if (balance > 0) {
        await client.query(
          `INSERT INTO app.wallet_ledger_entries (entry_id, wallet_id, sequence_no, entry_kind, delta_vnd, balance_after_vnd, created_at)
           VALUES ($1::uuid, $2::uuid, 1, 'TOPUP', $3, $3, now())`,
          [randomUUID(), walletId, balance],
        );
        await client.query('UPDATE app.driver_wallets SET balance_vnd = $2, version = version + 1, updated_at = now() WHERE wallet_id = $1::uuid', [walletId, balance]);
      }
      await run(client);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  }

  const setHeld = (client: PoolClient, held: number): Promise<unknown> =>
    client.query('UPDATE app.driver_wallets SET held_vnd = $2, version = version + 1, updated_at = now() WHERE wallet_id = $1::uuid', [walletId, held]);

  const insertHold = (client: PoolClient, amount: number, purpose: 'COMMISSION' | 'WITHDRAWAL' = 'COMMISSION', holdId = randomUUID(), source = randomUUID()): Promise<unknown> =>
    client.query(
      `INSERT INTO app.wallet_holds (hold_id, wallet_id, purpose, amount_vnd, commission_assignment_id, withdrawal_id, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, now(), now())`,
      [holdId, walletId, purpose, amount, purpose === 'COMMISSION' ? source : null, purpose === 'WITHDRAWAL' ? source : null],
    );

  /** Runs the commit-time invariant now (the deferred triggers fire), then defers again. */
  async function checkNow(client: PoolClient): Promise<void> {
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    await client.query('SET CONSTRAINTS ALL DEFERRED');
  }

  /** Each refusal aborts the PostgreSQL transaction, so every probe runs in its own savepoint. */
  async function refused(client: PoolClient, label: string, run: () => Promise<unknown>, needle: string): Promise<void> {
    await client.query(`SAVEPOINT ${label}`);
    const error = await failureOf(run);
    await client.query(`ROLLBACK TO SAVEPOINT ${label}`);
    expect([label, messageOf(error).includes(needle)]).toEqual([label, true]);
  }

  async function gatesActive(): Promise<void> {
    const triggers = await pool.query<{ tgname: string; tgenabled: string }>(
      `SELECT tgname, tgenabled FROM pg_trigger WHERE tgname IN ('wallet_holds_a_source_gate', 'wallet_ledger_a_source_gate', 'wallet_holds_guard', 'wallet_holds_invariants', 'wallet_holds_no_delete') AND NOT tgisinternal ORDER BY tgname`,
    );
    expect(triggers.rows.map((row) => [row.tgname, row.tgenabled])).toEqual([
      ['wallet_holds_a_source_gate', 'O'], ['wallet_holds_guard', 'O'], ['wallet_holds_invariants', 'O'], ['wallet_holds_no_delete', 'O'], ['wallet_ledger_a_source_gate', 'O'],
    ]);
  }

  it('1. no hold can be inserted without a valid source: refused even with enough available balance and fabricated ids, for both purposes', async () => {
    // Plain connection (a real wallet at 0 VND, a random UUID as "source"): refused by the gate.
    for (const purpose of ['COMMISSION', 'WITHDRAWAL'] as const) {
      const error = await failureOf(() =>
        pool.query(
          `INSERT INTO app.wallet_holds (hold_id, wallet_id, purpose, amount_vnd, commission_assignment_id, withdrawal_id, created_at, updated_at)
           VALUES ($1::uuid, $2::uuid, $3, 1000, $4, $5, now(), now())`,
          [randomUUID(), walletId, purpose, purpose === 'COMMISSION' ? randomUUID() : null, purpose === 'WITHDRAWAL' ? randomUUID() : null],
        ),
      );
      expect(messageOf(error)).toContain('WALLET_HOLD_SOURCE_NOT_AVAILABLE');
      expect(sqlState(error)).toBe('23001');
    }
    // Funded wallet: only the LEDGER gate is lifted (to create available money), the hold gate stays: still refused.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE app.wallet_ledger_entries DISABLE TRIGGER wallet_ledger_a_source_gate');
      await client.query(
        `INSERT INTO app.wallet_ledger_entries (entry_id, wallet_id, sequence_no, entry_kind, delta_vnd, balance_after_vnd, created_at) VALUES ($1::uuid, $2::uuid, 1, 'TOPUP', 100000, 100000, now())`,
        [randomUUID(), walletId],
      );
      await client.query('UPDATE app.driver_wallets SET balance_vnd = 100000, version = version + 1 WHERE wallet_id = $1::uuid', [walletId]);
      await refused(client, 'funded', () => insertHold(client, 1000), 'WALLET_HOLD_SOURCE_NOT_AVAILABLE');
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
    await gatesActive();
    expect((await pool.query('SELECT 1 FROM app.wallet_holds')).rowCount).toBe(0);
    expect((await pool.query('SELECT 1 FROM app.wallet_ledger_entries')).rowCount).toBe(0);
    // Typed source columns only: no polymorphic source id, and (until the source tables exist) no foreign key to a table that is not there.
    const columns = await pool.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'wallet_holds' AND column_name LIKE '%source%'`);
    expect(columns.rowCount).toBe(0);
    const fks = await pool.query<{ conname: string }>(`SELECT conname FROM pg_constraint WHERE conrelid = 'app.wallet_holds'::regclass AND contype = 'f'`);
    expect(fks.rows.map((row) => row.conname)).toEqual(['wallet_holds_wallet_fk']);
  });

  it('2. row rules: exactly one typed source of the purpose, positive bounded amount, valid status, a real wallet, a hold starts ACTIVE', async () => {
    await rolledBack(async (client) => {
      const raw = (purpose: string, amount: number, commission: string | null, withdrawal: string | null, status = 'ACTIVE', resolved = false, wallet = walletId): Promise<unknown> =>
        client.query(
          `INSERT INTO app.wallet_holds (hold_id, wallet_id, purpose, amount_vnd, status, commission_assignment_id, withdrawal_id, created_at, updated_at, resolved_at)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, now(), now(), ${resolved ? 'now()' : 'NULL'})`,
          [randomUUID(), wallet, purpose, amount, status, commission, withdrawal],
        );
      await refused(client, 'both_sources', () => raw('COMMISSION', 1000, randomUUID(), randomUUID()), 'wallet_holds_source_ck');
      await refused(client, 'no_source', () => raw('COMMISSION', 1000, null, null), 'wallet_holds_source_ck');
      await refused(client, 'wrong_column', () => raw('COMMISSION', 1000, null, randomUUID()), 'wallet_holds_source_ck');
      await refused(client, 'wrong_column_2', () => raw('WITHDRAWAL', 1000, randomUUID(), null), 'wallet_holds_source_ck');
      await refused(client, 'purpose', () => raw('TOPUP', 1000, randomUUID(), null), 'wallet_holds_purpose_ck');
      await refused(client, 'zero', () => raw('COMMISSION', 0, randomUUID(), null), 'wallet_holds_amount_ck');
      await refused(client, 'negative', () => raw('COMMISSION', -5, randomUUID(), null), 'wallet_holds_amount_ck');
      await refused(client, 'cap', () => raw('COMMISSION', Number.MAX_SAFE_INTEGER + 1, randomUUID(), null), 'wallet_holds_amount_ck');
      await refused(client, 'status', () => raw('COMMISSION', 1000, randomUUID(), null, 'PENDING'), 'WALLET_HOLD_MUST_START_ACTIVE');
      await refused(client, 'born_captured', () => raw('COMMISSION', 1000, randomUUID(), null, 'CAPTURED', true), 'WALLET_HOLD_MUST_START_ACTIVE');
      await refused(client, 'no_wallet', () => raw('COMMISSION', 1000, randomUUID(), null, 'ACTIVE', false, randomUUID()), 'wallet_holds_wallet_fk');
      // The same source cannot hold twice (per purpose / typed column).
      const source = randomUUID();
      await insertHold(client, 1000, 'COMMISSION', randomUUID(), source);
      await refused(client, 'dup_commission', () => insertHold(client, 2000, 'COMMISSION', randomUUID(), source), 'wallet_holds_commission_uq');
      const withdrawal = randomUUID();
      await insertHold(client, 1000, 'WITHDRAWAL', randomUUID(), withdrawal);
      await refused(client, 'dup_withdrawal', () => insertHold(client, 2000, 'WITHDRAWAL', randomUUID(), withdrawal), 'wallet_holds_withdrawal_uq');
    });
    await gatesActive();
  });

  it('3. invariant: balance = ledger and held = SUM(ACTIVE holds), checked at commit; one VND too few or too many, or held above balance, is refused', async () => {
    await rolledBack(async (client) => {
      await insertHold(client, 30_000);
      await insertHold(client, 25_000, 'WITHDRAWAL');
      await refused(client, 'held_missing', () => checkNow(client), 'WALLET_INVARIANT_VIOLATION'); // holds exist, wallet.held still 0
      await setHeld(client, 55_000);
      await checkNow(client); // several ACTIVE holds, held == sum: fine
      await refused(client, 'one_less', async () => { await setHeld(client, 54_999); await checkNow(client); }, 'WALLET_INVARIANT_VIOLATION');
      await refused(client, 'one_more', async () => { await setHeld(client, 55_001); await checkNow(client); }, 'WALLET_INVARIANT_VIOLATION');
      await refused(client, 'above_balance', () => setHeld(client, 100_001), 'driver_wallets_held_ck');
      await refused(client, 'negative_held', () => setHeld(client, -1), 'driver_wallets_held_ck');
      // The balance cannot move without the ledger, whatever the holds say.
      await refused(client, 'balance_without_ledger', async () => { await client.query('UPDATE app.driver_wallets SET balance_vnd = balance_vnd + 1, version = version + 1 WHERE wallet_id = $1::uuid', [walletId]); await checkNow(client); }, 'WALLET_INVARIANT_VIOLATION');
      // Holds never write the ledger: still exactly the one funding row.
      expect((await client.query('SELECT 1 FROM app.wallet_ledger_entries WHERE wallet_id = $1::uuid', [walletId])).rowCount).toBe(1);
    });
    // The same violation really rejects the COMMIT (not only the early check): nothing stays.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE app.wallet_holds DISABLE TRIGGER wallet_holds_a_source_gate');
      await insertHold(client, 1_000); // wallet.held stays 0
      const error = await failureOf(() => client.query('COMMIT'));
      expect(messageOf(error)).toContain('WALLET_INVARIANT_VIOLATION');
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
    expect((await pool.query('SELECT 1 FROM app.wallet_holds')).rowCount).toBe(0);
    await gatesActive();
  });

  it('4. immutability and state machine: only ACTIVE -> CAPTURED / RELEASED, terminal is final, version +1, no DELETE / TRUNCATE; held follows the ACTIVE total', async () => {
    await rolledBack(async (client) => {
      const keep = randomUUID();
      const other = randomUUID();
      const third = randomUUID();
      await insertHold(client, 40_000, 'COMMISSION', keep);
      await insertHold(client, 10_000, 'WITHDRAWAL', other);
      await insertHold(client, 5_000, 'COMMISSION', third);
      await setHeld(client, 55_000);
      await checkNow(client);
      const update = (id: string, set: string, values: unknown[] = []): Promise<unknown> => client.query(`UPDATE app.wallet_holds SET ${set} WHERE hold_id = $1::uuid`, [id, ...values]);
      await refused(client, 'amount', () => update(keep, 'amount_vnd = 1, version = version + 1'), 'WALLET_HOLD_IDENTITY_IMMUTABLE');
      await refused(client, 'purpose', () => update(keep, `purpose = 'WITHDRAWAL', version = version + 1`), 'WALLET_HOLD_IDENTITY_IMMUTABLE');
      await refused(client, 'source', () => update(keep, 'commission_assignment_id = gen_random_uuid(), version = version + 1'), 'WALLET_HOLD_IDENTITY_IMMUTABLE');
      await refused(client, 'source_swap', () => update(keep, `commission_assignment_id = NULL, withdrawal_id = gen_random_uuid(), purpose = 'WITHDRAWAL', version = version + 1`), 'WALLET_HOLD_IDENTITY_IMMUTABLE');
      await refused(client, 'created_at', () => update(keep, `created_at = created_at - interval '1 day', version = version + 1`), 'WALLET_HOLD_IDENTITY_IMMUTABLE');
      await refused(client, 'wallet', () => update(keep, 'wallet_id = gen_random_uuid(), version = version + 1'), 'WALLET_HOLD_IDENTITY_IMMUTABLE');
      await refused(client, 'noop_transition', () => update(keep, 'version = version + 1'), 'WALLET_HOLD_TRANSITION_REFUSED');
      await refused(client, 'bogus_status', () => update(keep, `status = 'PENDING', version = version + 1`), 'WALLET_HOLD_TRANSITION_REFUSED');
      await refused(client, 'version', () => update(keep, `status = 'RELEASED', resolved_at = now(), version = version + 5`), 'WALLET_HOLD_VERSION_CONFLICT');
      await refused(client, 'resolved_missing', () => update(keep, `status = 'RELEASED', version = version + 1`), 'wallet_holds_resolved_ck');
      // Release without lowering held: the commit-time invariant refuses it.
      await refused(client, 'release_held_unchanged', async () => { await update(keep, `status = 'RELEASED', resolved_at = now(), updated_at = now(), version = version + 1`); await checkNow(client); }, 'WALLET_INVARIANT_VIOLATION');
      // A correct release and a correct capture: the hold changes state and held drops by exactly its amount, no ledger row.
      await update(keep, `status = 'RELEASED', resolved_at = now(), updated_at = now(), version = version + 1`);
      await setHeld(client, 15_000);
      await update(other, `status = 'CAPTURED', resolved_at = now(), updated_at = now(), version = version + 1`);
      await setHeld(client, 5_000);
      await checkNow(client);
      // Terminal -> anything is final.
      for (const [label, id] of [['released', keep], ['captured', other]] as const) {
        await refused(client, `${label}_to_active`, () => update(id, `status = 'ACTIVE', resolved_at = NULL, version = version + 1`), 'WALLET_HOLD_TRANSITION_REFUSED');
        await refused(client, `${label}_to_captured`, () => update(id, `status = 'CAPTURED', version = version + 1`), 'WALLET_HOLD_TRANSITION_REFUSED');
        await refused(client, `${label}_to_released`, () => update(id, `status = 'RELEASED', version = version + 1`), 'WALLET_HOLD_TRANSITION_REFUSED');
      }
      // Never deleted, even when no row matches (statement-level).
      await refused(client, 'delete', () => client.query('DELETE FROM app.wallet_holds WHERE hold_id = $1::uuid', [keep]), 'never deleted');
      await refused(client, 'delete_none', () => client.query('DELETE FROM app.wallet_holds WHERE false'), 'never deleted');
      await refused(client, 'truncate', () => client.query('TRUNCATE app.wallet_holds'), 'never deleted');
      expect((await client.query('SELECT 1 FROM app.wallet_ledger_entries WHERE wallet_id = $1::uuid', [walletId])).rowCount).toBe(1);
      expect((await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.wallet_holds WHERE status = 'ACTIVE'`)).rows[0]?.n).toBe('1');
    });
    expect((await pool.query('SELECT 1 FROM app.wallet_holds')).rowCount).toBe(0);
  });

  it('5. the read model: no hold exists today, so the summary is empty with zero totals (provisioned or not), and it writes nothing', async () => {
    const manager = managerFor(poolClientSource(pool), { timeoutMs: 20_000 });
    expect(await manager.withTransaction((context) => service.readHolds(context, driverId))).toEqual({ driverId, provisioned: true, holds: [], activeCount: 0, activeVnd: 0n });
    const unknown = randomUUID();
    expect(await manager.withTransaction((context) => service.readHolds(context, unknown))).toEqual({ driverId: unknown, provisioned: false, holds: [], activeCount: 0, activeVnd: 0n });
    expect((await pool.query('SELECT 1 FROM app.wallet_holds')).rowCount).toBe(0);
  });

  describe('migration and down latch', () => {
    const holdTable = async (client: Pool | PoolClient): Promise<number> =>
      (await client.query(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'app' AND table_name = 'wallet_holds'`)).rowCount ?? 0;

    it('up -> down -> up (rolled back) with zero-VND wallets present changes no wallet, ledger or driver row and restores every gate', async () => {
      const snapshot = async (client: PoolClient): Promise<unknown> => ({
        wallets: (await client.query('SELECT * FROM app.driver_wallets ORDER BY wallet_id')).rows,
        ledger: (await client.query('SELECT * FROM app.wallet_ledger_entries ORDER BY entry_id')).rows,
        drivers: (await client.query('SELECT * FROM app.drivers ORDER BY driver_id')).rows,
        parameters: (await client.query('SELECT * FROM app.shipper_wallet_parameters ORDER BY param_key')).rows,
      });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const before = await snapshot(client);
        await client.query(HOLD_DOWN_SQL);
        expect(await holdTable(client)).toBe(0);
        // Back to the A1 rule: held must be 0, and the A1 invariant function works.
        await client.query('SELECT app.wallet_assert_invariants($1::uuid)', [walletId]);
        await client.query(HOLD_UP_SQL);
        expect(await holdTable(client)).toBe(1);
        expect(await snapshot(client)).toEqual(before);
        const error = await failureOf(async () => {
          await client.query('SAVEPOINT gate');
          try {
            await insertHold(client, 1000);
          } finally {
            await client.query('ROLLBACK TO SAVEPOINT gate');
          }
        });
        expect(messageOf(error)).toContain('WALLET_HOLD_SOURCE_NOT_AVAILABLE');
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
      }
      expect(await holdTable(pool)).toBe(1);
      await gatesActive();
    });

    it('ANY hold row (even RELEASED) or a held amount refuses the down migration with WALLET_HOLD_DOWN_REFUSED and loses nothing', async () => {
      await rolledBack(async (client) => {
        const id = randomUUID();
        await insertHold(client, 10_000, 'COMMISSION', id);
        await setHeld(client, 10_000);
        await refused(client, 'active', () => client.query(HOLD_DOWN_SQL), 'WALLET_HOLD_DOWN_REFUSED');
        await client.query(`UPDATE app.wallet_holds SET status = 'RELEASED', resolved_at = now(), updated_at = now(), version = version + 1 WHERE hold_id = $1::uuid`, [id]);
        await setHeld(client, 0);
        await checkNow(client);
        const error = await failureOf(() => client.query(HOLD_DOWN_SQL));
        expect(messageOf(error)).toContain('WALLET_HOLD_DOWN_REFUSED');
        expect(sqlState(error)).toBe('23000');
      });
      expect(await holdTable(pool)).toBe(1);
      await gatesActive();
    });

    it('race: the down migration waits for a transaction that already uses the hold table, and a writer waits behind the down latch (ACCESS EXCLUSIVE)', async () => {
      const lockWaiters = async (): Promise<number> =>
        Number((await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM pg_locks l WHERE l.locktype = 'relation' AND NOT l.granted AND l.relation = 'app.wallet_holds'::regclass`)).rows[0]?.n);
      // (a) a reader of the hold table is open; the down migration must wait for it, then run to the end.
      const reader = await pool.connect();
      const migrator = await pool.connect();
      try {
        await reader.query('BEGIN');
        await reader.query('SELECT count(*) FROM app.wallet_holds');
        await migrator.query('BEGIN');
        const migrating = migrator.query(HOLD_DOWN_SQL).then(() => undefined, (error: unknown) => error);
        await eventually(async () => (await lockWaiters()) >= 1, 'the down migration blocked behind the open reader');
        await reader.query('COMMIT');
        expect(await migrating).toBeUndefined();
        expect(await holdTable(migrator)).toBe(0);
      } finally {
        await reader.query('ROLLBACK').catch(() => undefined);
        await migrator.query('ROLLBACK').catch(() => undefined);
        reader.release();
        migrator.release();
      }
      expect(await holdTable(pool)).toBe(1);
      // (b) the down latch is held: a concurrent writer cannot get in between the check and the DROP.
      const latch = await pool.connect();
      try {
        await latch.query('BEGIN');
        await latch.query('LOCK TABLE app.driver_wallets, app.wallet_ledger_entries, app.wallet_holds IN ACCESS EXCLUSIVE MODE');
        const writer = pool.query(`SELECT count(*) FROM app.wallet_holds`).then(() => 'done', () => 'failed');
        await eventually(async () => (await lockWaiters()) >= 1, 'the writer blocked behind the down latch');
        await latch.query('ROLLBACK');
        expect(await writer).toBe('done');
      } finally {
        await latch.query('ROLLBACK').catch(() => undefined);
        latch.release();
      }
    });
  });
});
