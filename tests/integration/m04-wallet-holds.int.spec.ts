import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Pool, PoolClient } from 'pg';
import { NotIntegratedDriverWalletPort } from '../../apps/backend/src/driver/driver-wallet-port';
import { DriverRepository } from '../../apps/backend/src/driver/driver-repository';
import { TransactionContext } from '../../apps/backend/src/transaction/transaction-context';
import { poolClientSource } from '../../apps/backend/src/transaction/pg-client-source';
import { WalletRepository } from '../../apps/backend/src/wallet/wallet-repository';
import { WalletService } from '../../apps/backend/src/wallet/wallet-service';
import { eventually, failureOf } from './support/async-helpers';
import { AuthApp, createActiveShopFor, createDriverFor, purgePhone, randomPhone, startAuthApp } from './support/auth-fixtures';
import { insertCommissionSource, M07_INVARIANT_TRIGGERS } from './support/delivery-fixtures';
import { loadIntegrationConfig } from './support/test-helpers';
import { managerFor, testPool } from './support/transaction-fixtures';
import { WALLET_HOLD_DOWN_SQL, WALLET_HOLD_UP_SQL } from './support/wallet-hold-migration-sql';

// M04-A2.1 - the Shipper hold core, on a REAL PostgreSQL (the test database only). No hold can be written in this package: the source
// gate refuses every INSERT because the source tables (M07 assignments, M04-C withdrawals) do not exist. The rules BEHIND the gate
// (amounts, sources, transitions, held = SUM(ACTIVE holds), no delete) are proven inside transactions that are ALWAYS rolled back, with
// the two source gates lifted by the test role only inside that transaction; afterwards the gates are checked to be active again.
describe('M04-A2.1 - Shipper hold core (schema, invariant, gate, down latch)', () => {
  const service = new WalletService(new WalletRepository(), new DriverRepository());
  const phonesToPurge: string[] = [];
  let pool: Pool;

  const manager = () => managerFor(poolClientSource(pool), { timeoutMs: 20_000 });

  async function makeDriver(): Promise<{ driverId: string }> {
    const phone = randomPhone();
    phonesToPurge.push(phone.normalized);
    const userId = randomUUID();
    await pool.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
       VALUES ($1::uuid, $2, '$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA', now(), 'PHONE_VERIFIED', 'ACTIVE', 1, now(), now())`,
      [userId, phone.normalized],
    );
    return { driverId: await createDriverFor(pool, userId) };
  }

  async function makeWallet(): Promise<{ driverId: string; walletId: string }> {
    const { driverId } = await makeDriver();
    const { wallet } = await manager().withTransaction((context) => service.ensureZeroWallet(context, driverId));
    return { driverId, walletId: wallet.walletId };
  }

  const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
  const contextOf = (client: PoolClient): TransactionContext => ({ isActive: true, query: (text, values) => client.query(text, values as unknown[] | undefined) });

  async function gateStates(): Promise<string[]> {
    const rows = await pool.query<{ tgname: string; tgenabled: string }>(
      `SELECT tgname, tgenabled FROM pg_trigger WHERE tgname IN ('wallet_holds_a_source_gate', 'wallet_ledger_a_source_gate') AND NOT tgisinternal ORDER BY tgname`,
    );
    return rows.rows.map((row) => `${row.tgname}:${row.tgenabled}`);
  }
  const GATES_ACTIVE = ['wallet_holds_a_source_gate:O', 'wallet_ledger_a_source_gate:O'];

  interface HoldInput {
    readonly purpose?: 'COMMISSION' | 'WITHDRAWAL';
    readonly amount: number;
    readonly status?: 'ACTIVE' | 'CAPTURED' | 'RELEASED';
    readonly holdId?: string;
    readonly commissionAssignmentId?: string | null;
    readonly withdrawalId?: string | null;
    /** Since M07 a commission hold can have a REAL source (assignment, delivery and, for CAPTURED, the ledger debit). Off: the old random id, which the rules must refuse. */
    readonly real?: boolean;
  }

  /** The raw INSERT, exactly as given (a hold not born ACTIVE is refused by the guard). */
  function insertHoldRaw(client: PoolClient, walletId: string, input: HoldInput): Promise<unknown> {
    const purpose = input.purpose ?? 'COMMISSION';
    const status = input.status ?? 'ACTIVE';
    const commission = input.commissionAssignmentId === undefined ? (purpose === 'COMMISSION' ? randomUUID() : null) : input.commissionAssignmentId;
    const withdrawal = input.withdrawalId === undefined ? (purpose === 'WITHDRAWAL' ? randomUUID() : null) : input.withdrawalId;
    return client.query(
      `INSERT INTO app.wallet_holds (hold_id, wallet_id, purpose, amount_vnd, status, commission_assignment_id, withdrawal_id, version, created_at, updated_at, resolved_at)
       VALUES ($1::uuid, $2::uuid, $3::varchar, $4::bigint, $5::varchar, $6::uuid, $7::uuid, 1, now(), now(), CASE WHEN $5::varchar = 'ACTIVE' THEN NULL ELSE now() END)`,
      [input.holdId ?? randomUUID(), walletId, purpose, input.amount, status, commission, withdrawal],
    );
  }

  /** A hold as it really comes to exist: born ACTIVE, then (for CAPTURED / RELEASED) moved by the one allowed transition. */
  async function insertHold(client: PoolClient, walletId: string, input: HoldInput): Promise<unknown> {
    const holdId = input.holdId ?? randomUUID();
    const status = input.status ?? 'ACTIVE';
    // A commission hold has a REAL source since M07: an assignment in the state that matches the hold's final status. The M07 invariant (delivery,
    // assignment and hold agree) is deferred around the pair and then checked at once.
    let commissionAssignmentId = input.commissionAssignmentId;
    const sourced = input.real === true && (input.purpose ?? 'COMMISSION') === 'COMMISSION' && commissionAssignmentId === undefined;
    if (sourced) {
      const owner = await sourceShop();
      const wallet = await client.query<{ driver_id: string }>('SELECT driver_id FROM app.driver_wallets WHERE wallet_id = $1::uuid', [walletId]);
      await client.query(`SET CONSTRAINTS ${M07_INVARIANT_TRIGGERS.join(', ')} DEFERRED`);
      commissionAssignmentId = await insertCommissionSource(client, { ...owner, driverId: (wallet.rows[0] as { driver_id: string }).driver_id, amountVnd: input.amount, outcome: status });
    }
    const result = await insertHoldRaw(client, walletId, { ...input, holdId, status: 'ACTIVE', ...(commissionAssignmentId === undefined ? {} : { commissionAssignmentId }) });
    if (status !== 'ACTIVE') {
      await client.query(`UPDATE app.wallet_holds SET status = $2::varchar, resolved_at = now(), updated_at = now(), version = version + 1 WHERE hold_id = $1::uuid`, [holdId, status]);
    }
    if (sourced && status === 'CAPTURED') {
      await insertCaptureDebit(client, walletId, commissionAssignmentId as string, input.amount);
    }
    if (sourced) {
      await client.query(`SET CONSTRAINTS ${M07_INVARIANT_TRIGGERS.join(', ')} IMMEDIATE`);
    }
    return result;
  }

  /** A captured hold has exactly one commission debit (the database refuses a capture without it): the next ledger row of the wallet, and the balance follows. */
  async function insertCaptureDebit(client: PoolClient, walletId: string, assignmentId: string, amount: number): Promise<void> {
    const last = await client.query<{ sequence_no: string; balance_after_vnd: string }>('SELECT sequence_no, balance_after_vnd FROM app.wallet_ledger_entries WHERE wallet_id = $1::uuid ORDER BY sequence_no DESC LIMIT 1', [walletId]);
    const previous = last.rows[0] as { sequence_no: string; balance_after_vnd: string };
    await client.query(
      `INSERT INTO app.wallet_ledger_entries (entry_id, wallet_id, sequence_no, entry_kind, delta_vnd, balance_after_vnd, created_at, commission_assignment_id)
       VALUES ($1::uuid, $2::uuid, $3, 'COMMISSION_DEBIT', $4, $5, now(), $6::uuid)`,
      [randomUUID(), walletId, Number(previous.sequence_no) + 1, -amount, Number(previous.balance_after_vnd) - amount, assignmentId],
    );
    await client.query('UPDATE app.driver_wallets SET balance_vnd = balance_vnd - $2, version = version + 1 WHERE wallet_id = $1::uuid', [walletId, amount]);
  }

  /** The delivery of an ACTIVE assignment runs to its end: picked up, completed; the assignment completes (the order the database's graph allows). */
  async function completeSource(client: PoolClient, assignmentId: string): Promise<void> {
    const delivery = `(SELECT delivery_id FROM app.delivery_assignments WHERE assignment_id = $1::uuid)`;
    await client.query(`UPDATE app.deliveries SET state = 'delivering', picked_up_at = now(), fee_vnd = 10000, version = version + 1, updated_at = now() WHERE delivery_id = ${delivery}`, [assignmentId]);
    await client.query(`UPDATE app.deliveries SET state = 'completed', ended_at = now(), version = version + 1, updated_at = now() WHERE delivery_id = ${delivery}`, [assignmentId]);
    await client.query(`UPDATE app.delivery_assignments SET status = 'COMPLETED', ended_at = now(), end_actor = 'SHIPPER', version = version + 1, updated_at = now() WHERE assignment_id = $1::uuid`, [assignmentId]);
  }

  /** The one shop (and its owner) that the commission sources of this suite hang from; removed with its owner's phone after the Shippers. */
  let shopOwner: { shopId: string; userId: string } | undefined;
  async function sourceShop(): Promise<{ shopId: string; userId: string }> {
    if (shopOwner === undefined) {
      const phone = randomPhone();
      shopPhone = phone.normalized;
      const userId = randomUUID();
      await pool.query(
        `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
         VALUES ($1::uuid, $2, '$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA', now(), 'PHONE_VERIFIED', 'ACTIVE', 1, now(), now())`,
        [userId, phone.normalized],
      );
      shopOwner = { shopId: await createActiveShopFor(pool, userId), userId };
    }
    return shopOwner;
  }
  let shopPhone: string | undefined;

  /**
   * A wallet with 100000 VND in its ledger, inside a transaction that is ALWAYS rolled back, with both source gates lifted for this
   * transaction only (the test role owns the tables). Checks are IMMEDIATE after the setup so a rule fires at the statement.
   */
  async function inFixture(run: (client: PoolClient, walletId: string) => Promise<void>): Promise<void> {
    const { walletId } = await makeWallet();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE app.wallet_holds DISABLE TRIGGER wallet_holds_a_source_gate');
      await client.query('ALTER TABLE app.wallet_ledger_entries DISABLE TRIGGER wallet_ledger_a_source_gate');
      await client.query(
        `INSERT INTO app.wallet_ledger_entries (entry_id, wallet_id, sequence_no, entry_kind, delta_vnd, balance_after_vnd, created_at) VALUES ($1::uuid, $2::uuid, 1, 'ADJUSTMENT_CREDIT', 100000, 100000, now())`,
        [randomUUID(), walletId],
      );
      await client.query('UPDATE app.driver_wallets SET balance_vnd = 100000, version = version + 1 WHERE wallet_id = $1::uuid', [walletId]);
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      await run(client, walletId);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
    expect(await gateStates()).toEqual(GATES_ACTIVE);
    expect((await pool.query('SELECT 1 FROM app.wallet_holds WHERE wallet_id = $1::uuid', [walletId])).rowCount).toBe(0);
    expect((await pool.query('SELECT 1 FROM app.wallet_ledger_entries WHERE wallet_id = $1::uuid', [walletId])).rowCount).toBe(0);
  }

  /** Each refusal aborts the PostgreSQL transaction, so every probe runs in its own savepoint. */
  async function refused(client: PoolClient, label: string, run: () => Promise<unknown>, needle: string): Promise<void> {
    await client.query(`SAVEPOINT ${label}`);
    const error = await failureOf(run);
    await client.query(`ROLLBACK TO SAVEPOINT ${label}`);
    expect([label, error === undefined ? 'no error' : messageOf(error).includes(needle) ? 'refused' : messageOf(error)]).toEqual([label, 'refused']);
  }

  /** The wallet carries the held amount that its ACTIVE holds sum to (both changes in one deferred step, then checked). */
  async function setHeld(client: PoolClient, walletId: string, held: number): Promise<void> {
    await client.query('UPDATE app.driver_wallets SET held_vnd = $2, version = version + 1 WHERE wallet_id = $1::uuid', [walletId, held]);
  }

  beforeAll(() => {
    pool = testPool(loadIntegrationConfig().database, { poolMax: 6 });
  });

  afterAll(async () => {
    try {
      for (const phone of phonesToPurge) {
        await purgePhone(pool, phone);
      }
      if (shopPhone !== undefined) {
        await purgePhone(pool, shopPhone);
      }
    } finally {
      await pool.end();
    }
  });

  it('1. migration forward from A1 with wallet data: wallet, ledger and M03 rows are identical after down then up, and the hold table is empty', async () => {
    const { driverId } = await makeWallet();
    const snapshot = async (client: PoolClient): Promise<unknown> => {
      const wallets = await client.query('SELECT * FROM app.driver_wallets ORDER BY wallet_id');
      const ledger = await client.query('SELECT * FROM app.wallet_ledger_entries ORDER BY entry_id');
      const drivers = await client.query('SELECT * FROM app.drivers WHERE driver_id = $1::uuid', [driverId]);
      const parameters = await client.query('SELECT * FROM app.shipper_wallet_parameters ORDER BY param_key');
      return { wallets: wallets.rows, ledger: ledger.rows, drivers: drivers.rows, parameters: parameters.rows };
    };
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const before = await snapshot(client);
      await client.query(WALLET_HOLD_DOWN_SQL);
      expect((await client.query("SELECT 1 FROM information_schema.tables WHERE table_schema = 'app' AND table_name = 'wallet_holds'")).rowCount).toBe(0);
      // Back at the A1 state, the A1 rule is back: held must be 0 (and it is).
      expect(await snapshot(client)).toEqual(before);
      await client.query(WALLET_HOLD_UP_SQL);
      expect(await snapshot(client)).toEqual(before);
      expect((await client.query('SELECT 1 FROM app.wallet_holds')).rowCount).toBe(0);
      // The re-created schema still carries the gate and the invariant.
      expect((await client.query("SELECT 1 FROM pg_trigger WHERE tgname IN ('wallet_holds_a_source_gate', 'wallet_holds_guard', 'wallet_holds_no_delete', 'wallet_holds_invariants') AND NOT tgisinternal")).rowCount).toBe(4);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
    expect((await pool.query("SELECT 1 FROM information_schema.tables WHERE table_schema = 'app' AND table_name = 'wallet_holds'")).rowCount).toBe(1);
  });

  it('2. a hold without a valid source document is refused every time, whatever the amount, the available money and the UUIDs', async () => {
    const { walletId } = await makeWallet();
    // The wallet has no available money at all; the gate refuses before any money rule is even looked at, so a hold is refused with plenty too (3 below).
    for (const input of [
      { purpose: 'COMMISSION' as const, amount: 1 },
      { purpose: 'WITHDRAWAL' as const, amount: 1 },
      { purpose: 'COMMISSION' as const, amount: 5000, commissionAssignmentId: randomUUID() },
      { purpose: 'WITHDRAWAL' as const, amount: 5000, withdrawalId: '00000000-0000-4000-8000-000000000000' },
    ]) {
      const client = await pool.connect();
      try {
        const error = await failureOf(() => insertHold(client, walletId, input));
        expect(messageOf(error)).toContain('WALLET_HOLD_SOURCE_NOT_AVAILABLE');
      } finally {
        client.release();
      }
    }
    expect((await pool.query('SELECT 1 FROM app.wallet_holds')).rowCount).toBe(0);
    // No polymorphic source: the two source columns are typed, there is no free "source_id" column.
    const columns = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'wallet_holds' ORDER BY ordinal_position`,
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual(['hold_id', 'wallet_id', 'purpose', 'amount_vnd', 'status', 'commission_assignment_id', 'withdrawal_id', 'version', 'created_at', 'updated_at', 'resolved_at']);
  });

  it('3. even with 100000 VND available, the gate refuses a hold; with the gate lifted (rolled-back fixture) the table rules still refuse a hold without exactly the source of its purpose', async () => {
    const { walletId } = await makeWallet();
    // Gate active, money available: still refused. The money is placed in a rolled-back transaction that does NOT lift the hold gate.
    const gated = await pool.connect();
    try {
      await gated.query('BEGIN');
      await gated.query('ALTER TABLE app.wallet_ledger_entries DISABLE TRIGGER wallet_ledger_a_source_gate');
      await gated.query(`INSERT INTO app.wallet_ledger_entries (entry_id, wallet_id, sequence_no, entry_kind, delta_vnd, balance_after_vnd, created_at) VALUES ($1::uuid, $2::uuid, 1, 'ADJUSTMENT_CREDIT', 100000, 100000, now())`, [randomUUID(), walletId]);
      await gated.query('UPDATE app.driver_wallets SET balance_vnd = 100000, version = version + 1 WHERE wallet_id = $1::uuid', [walletId]);
      const error = await failureOf(() => insertHold(gated, walletId, { amount: 1000 }));
      expect(messageOf(error)).toContain('WALLET_HOLD_SOURCE_NOT_AVAILABLE');
    } finally {
      await gated.query('ROLLBACK').catch(() => undefined);
      gated.release();
    }
    await inFixture(async (client, wallet) => {
      await refused(client, 'no_source', () => insertHold(client, wallet, { amount: 1000, commissionAssignmentId: null }), 'wallet_holds_source_ck');
      await refused(client, 'both_sources', () => insertHold(client, wallet, { amount: 1000, commissionAssignmentId: randomUUID(), withdrawalId: randomUUID() }), 'wallet_holds_source_ck');
      await refused(client, 'wrong_source_for_purpose', () => insertHold(client, wallet, { purpose: 'WITHDRAWAL', amount: 1000, commissionAssignmentId: randomUUID(), withdrawalId: null }), 'wallet_holds_source_ck');
      await refused(client, 'unknown_purpose', () => insertHold(client, wallet, { purpose: 'TIP' as unknown as 'COMMISSION', amount: 1000 }), 'wallet_holds_purpose_ck');
      await refused(client, 'zero_amount', () => insertHold(client, wallet, { amount: 0 }), 'wallet_holds_amount_ck');
      await refused(client, 'negative_amount', () => insertHold(client, wallet, { amount: -5 }), 'wallet_holds_amount_ck');
      await refused(client, 'over_the_technical_cap', () => insertHold(client, wallet, { amount: 9_007_199_254_740_992 }), 'wallet_holds_amount_ck');
      for (const born of ['CAPTURED', 'RELEASED'] as const) {
        await refused(client, `born_${born.toLowerCase()}`, () => insertHoldRaw(client, wallet, { amount: 1000, status: born }), 'WALLET_HOLD_MUST_START_ACTIVE');
      }
      await refused(client, 'unknown_wallet', () => insertHold(client, randomUUID(), { amount: 1000 }), 'wallet_holds_wallet_fk');
    });
  });

  it('3b. the runtime role gets SELECT, INSERT and UPDATE on the holds, never DELETE (the grants file; M07 opened the commission path); the effective privileges are proven with the real restricted role by the self-hosted PostgreSQL job', () => {
    const grants = readFileSync(path.resolve(__dirname, '..', '..', '..', 'ops', 'selfhosted', '02-runtime-grants.sql'), 'utf8');
    const holdGrants = grants.split('\n').filter((line) => /^GRANT .* ON app\.wallet_holds TO ship11_app;/.test(line));
    expect(holdGrants).toEqual(['GRANT SELECT, INSERT, UPDATE ON app.wallet_holds TO ship11_app;']);
    expect(grants).not.toMatch(/GRANT [A-Z, ]*\b(DELETE|TRUNCATE)\b[A-Z, ]* ON app\.(wallet_holds|wallet_ledger_entries|driver_wallets) /);
    // The ledger is append-only: INSERT (TOPUP posting, COMMISSION capture), never UPDATE.
    expect(grants).not.toMatch(/GRANT [A-Z, ]*\bUPDATE\b[A-Z, ]* ON app\.wallet_ledger_entries /);
  });

  it('4. held = SUM(ACTIVE holds): several holds match, one coin short or over rolls back, held above the balance fails (all rolled-back fixtures)', async () => {
    await inFixture(async (client, walletId) => {
      await client.query('SET CONSTRAINTS ALL DEFERRED');
      await insertHold(client, walletId, { real: true, purpose: 'COMMISSION', amount: 30000 });
      await insertHold(client, walletId, { real: true, purpose: 'WITHDRAWAL', amount: 20000 });
      await insertHold(client, walletId, { real: true, purpose: 'COMMISSION', amount: 1000, status: 'RELEASED' });
      await insertHold(client, walletId, { real: true, purpose: 'COMMISSION', amount: 2000, status: 'CAPTURED' });
      await setHeld(client, walletId, 50000);
      await client.query('SET CONSTRAINTS ALL IMMEDIATE'); // 30000 + 20000 = 50000: the RELEASED and CAPTURED ones do not count
      // The read model on the same transaction agrees with the database.
      const context = contextOf(client);
      const driver = await client.query<{ driver_id: string }>('SELECT driver_id FROM app.driver_wallets WHERE wallet_id = $1::uuid', [walletId]);
      const driverId = (driver.rows[0] as { driver_id: string }).driver_id;
      const summary = await service.holdSummary(context, driverId);
      expect(summary).toEqual({ provisioned: true, driverId, heldVnd: 50000n, activeHoldCount: 2, activeHoldTotalVnd: 50000n, consistent: true });
      expect((await service.listHolds(context, driverId)).map((hold) => [hold.purpose, hold.status, hold.amountVnd])).toEqual(expect.arrayContaining([['COMMISSION', 'ACTIVE', 30000n], ['WITHDRAWAL', 'ACTIVE', 20000n], ['COMMISSION', 'RELEASED', 1000n], ['COMMISSION', 'CAPTURED', 2000n]]));
      expect((await service.listHolds(context, driverId, 'ACTIVE')).map((hold) => hold.amountVnd).sort()).toEqual([20000n, 30000n]);
      await client.query('SET CONSTRAINTS ALL DEFERRED');
      await refused(client, 'one_coin_short', async () => {
        await client.query('SET CONSTRAINTS ALL DEFERRED');
        await setHeld(client, walletId, 49999);
        await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      }, 'WALLET_INVARIANT_VIOLATION');
      await refused(client, 'one_coin_over', async () => {
        await client.query('SET CONSTRAINTS ALL DEFERRED');
        await setHeld(client, walletId, 50001);
        await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      }, 'WALLET_INVARIANT_VIOLATION');
      await refused(client, 'hold_without_held', async () => {
        await client.query('SET CONSTRAINTS ALL DEFERRED');
        await insertHold(client, walletId, { real: true, purpose: 'COMMISSION', amount: 7 });
        await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      }, 'WALLET_INVARIANT_VIOLATION');
      await refused(client, 'release_without_lowering_held', async () => {
        await client.query('SET CONSTRAINTS ALL DEFERRED');
        await client.query(`UPDATE app.wallet_holds SET status = 'RELEASED', version = version + 1, updated_at = now(), resolved_at = now() WHERE purpose = 'WITHDRAWAL'`);
        await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      }, 'WALLET_INVARIANT_VIOLATION');
      // Held above the balance: the wallet CHECK refuses it even when the holds add up.
      await refused(client, 'held_above_balance', async () => {
        await client.query('SET CONSTRAINTS ALL DEFERRED');
        await insertHold(client, walletId, { real: true, purpose: 'WITHDRAWAL', amount: 60000 });
        await setHeld(client, walletId, 110000);
      }, 'driver_wallets_held_ck');
      // With any hold present (here ACTIVE ones) the down migration is refused, savepointed, so nothing is dropped.
      await refused(client, 'down_with_holds', () => client.query(WALLET_HOLD_DOWN_SQL), 'WALLET_HOLD_DOWN_REFUSED');
      // A hold never writes the ledger by itself: the fixture's credit and the ONE commission debit of the captured hold are the only rows.
      expect((await client.query('SELECT 1 FROM app.wallet_ledger_entries')).rowCount).toBe(2);
    });
  });

  it('5. a hold is immutable except ACTIVE -> CAPTURED / RELEASED once, the version advances by one, nothing is deleted or truncated (all rolled back)', async () => {
    await inFixture(async (client, walletId) => {
      const holdId = randomUUID();
      await client.query('SET CONSTRAINTS ALL DEFERRED');
      const driver = await client.query<{ driver_id: string }>('SELECT driver_id FROM app.driver_wallets WHERE wallet_id = $1::uuid', [walletId]);
      const assignment = await insertCommissionSource(client, { ...(await sourceShop()), driverId: (driver.rows[0] as { driver_id: string }).driver_id, amountVnd: 30000, outcome: 'ACTIVE' });
      await insertHold(client, walletId, { holdId, amount: 30000, commissionAssignmentId: assignment });
      await setHeld(client, walletId, 30000);
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      await client.query('SET CONSTRAINTS ALL DEFERRED');
      const update = (set: string): Promise<unknown> => client.query(`UPDATE app.wallet_holds SET ${set} WHERE hold_id = $1::uuid`, [holdId]);
      const bump = 'version = version + 1, updated_at = now()';
      await refused(client, 'amount', () => update(`${bump}, amount_vnd = 1`), 'WALLET_HOLD_IDENTITY_IMMUTABLE');
      await refused(client, 'purpose', () => update(`${bump}, purpose = 'WITHDRAWAL', commission_assignment_id = NULL, withdrawal_id = gen_random_uuid()`), 'WALLET_HOLD_IDENTITY_IMMUTABLE');
      await refused(client, 'source', () => update(`${bump}, commission_assignment_id = gen_random_uuid()`), 'WALLET_HOLD_IDENTITY_IMMUTABLE');
      await refused(client, 'wallet', () => update(`${bump}, wallet_id = gen_random_uuid()`), 'WALLET_HOLD_IDENTITY_IMMUTABLE');
      await refused(client, 'created_at', () => update(`${bump}, created_at = created_at - interval '1 day'`), 'WALLET_HOLD_IDENTITY_IMMUTABLE');
      await refused(client, 'unknown_status', () => update(`${bump}, status = 'LOST', resolved_at = now()`), 'WALLET_HOLD_TRANSITION_REFUSED');
      await refused(client, 'active_to_active', () => update(bump), 'WALLET_HOLD_TRANSITION_REFUSED');
      await refused(client, 'version_skipped', () => update(`status = 'RELEASED', version = version + 2, updated_at = now(), resolved_at = now()`), 'WALLET_HOLD_VERSION_CONFLICT');
      await refused(client, 'resolved_without_time', () => update(`${bump}, status = 'RELEASED'`), 'wallet_holds_resolved_ck');
      await refused(client, 'duplicate_source', () => insertHold(client, walletId, { amount: 1, commissionAssignmentId: assignment }), 'wallet_holds_commission_assignment_uq');
      // The legal move: ACTIVE -> CAPTURED, with the held amount lowered in the same transaction. It writes no ledger row by itself.
      await update(`${bump}, status = 'CAPTURED', resolved_at = now()`);
      await setHeld(client, walletId, 0);
      // Since M07 a capture is the commission debit of the ledger (exactly one) and a completed assignment: the database refuses either missing.
      await insertCaptureDebit(client, walletId, assignment, 30000);
      await completeSource(client, assignment);
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      await client.query('SET CONSTRAINTS ALL DEFERRED');
      for (const next of ['ACTIVE', 'RELEASED', 'CAPTURED']) {
        await refused(client, `terminal_to_${next.toLowerCase()}`, () => update(`${bump}, status = '${next}', resolved_at = now()`), 'WALLET_HOLD_TRANSITION_REFUSED');
      }
      await refused(client, 'delete', () => client.query('DELETE FROM app.wallet_holds'), 'never deleted');
      await refused(client, 'delete_no_match', () => client.query('DELETE FROM app.wallet_holds WHERE false'), 'never deleted');
      await refused(client, 'truncate', () => client.query('TRUNCATE app.wallet_holds'), 'never deleted');
      expect((await client.query('SELECT 1 FROM app.wallet_ledger_entries')).rowCount).toBe(2); // the fixture credit and the captured hold's one commission debit
      expect((await client.query("SELECT 1 FROM app.wallet_holds WHERE hold_id = $1::uuid AND status = 'CAPTURED' AND version = 2", [holdId])).rowCount).toBe(1);
    });
  });

  it('6. the down migration is refused when wallet_holds has ANY row (even a RELEASED one) and the data is untouched; a hold committed while it waits for the lock still refuses it', async () => {
    const { driverId, walletId } = await makeWallet();
    // A RELEASED hold needs no held money: it is the one hold a test can commit, with the gate lifted and restored INSIDE the same transaction.
    const writer = await pool.connect();
    const migrator = await pool.connect();
    try {
      await writer.query('BEGIN');
      await writer.query('ALTER TABLE app.wallet_holds DISABLE TRIGGER wallet_holds_a_source_gate');
      await insertHold(writer, walletId, { real: true, amount: 4000, status: 'RELEASED' });
      // ALTER TABLE refuses a table with pending deferred trigger events: run the invariant now (a RELEASED hold holds nothing, it passes).
      await writer.query('SET CONSTRAINTS ALL IMMEDIATE');
      await writer.query('ALTER TABLE app.wallet_holds ENABLE TRIGGER wallet_holds_a_source_gate');
      await migrator.query('BEGIN');
      const migrating = migrator.query(WALLET_HOLD_DOWN_SQL).then(() => undefined, (error: unknown) => error);
      await eventually(
        async () => (await pool.query(`SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%LOCK TABLE app.wallet_holds, app.driver_wallets%'`)).rowCount === 1,
        'the down migration waits for the table lock behind the uncommitted hold',
      );
      await writer.query('COMMIT');
      const error = await migrating;
      expect(messageOf(error)).toContain('WALLET_HOLD_DOWN_REFUSED');
      expect((error as { code?: string }).code).toBe('23000');
    } finally {
      await writer.query('ROLLBACK').catch(() => undefined);
      await migrator.query('ROLLBACK').catch(() => undefined);
      writer.release();
      migrator.release();
    }
    expect(await gateStates()).toEqual(GATES_ACTIVE);
    // Committed and still there; a fresh down attempt is refused too, and nothing is dropped.
    expect((await pool.query("SELECT 1 FROM app.wallet_holds WHERE wallet_id = $1::uuid AND status = 'RELEASED' AND amount_vnd = 4000", [walletId])).rowCount).toBe(1);
    const second = await pool.connect();
    try {
      await second.query('BEGIN');
      const error = await failureOf(() => second.query(WALLET_HOLD_DOWN_SQL));
      expect(messageOf(error)).toContain('WALLET_HOLD_DOWN_REFUSED');
    } finally {
      await second.query('ROLLBACK').catch(() => undefined);
      second.release();
    }
    expect((await pool.query("SELECT 1 FROM information_schema.tables WHERE table_schema = 'app' AND table_name = 'wallet_holds'")).rowCount).toBe(1);
    // The committed RELEASED hold reads back through the read model (bigint, no side effect); the summary has nothing active.
    const holds = await manager().withTransaction((context) => service.listHolds(context, driverId));
    expect(holds).toHaveLength(1);
    expect(holds[0]).toMatchObject({ walletId, purpose: 'COMMISSION', amountVnd: 4000n, status: 'RELEASED', version: 2n, withdrawalId: null });
    expect(await manager().withTransaction((context) => service.holdSummary(context, driverId))).toEqual({
      provisioned: true,
      driverId,
      heldVnd: 0n,
      activeHoldCount: 0,
      activeHoldTotalVnd: 0n,
      consistent: true,
    });
    expect(await manager().withTransaction((context) => service.listHolds(context, driverId, 'ACTIVE'))).toEqual([]);
  });

  it('6b. with no hold at all (the test database emptied inside a rolled-back transaction), up -> down -> up works', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Empty the test database inside this rolled-back transaction: holds are none (gate), wallets of earlier tests are removed here only.
      await client.query('ALTER TABLE app.driver_wallets DISABLE TRIGGER driver_wallets_no_delete');
      await client.query('ALTER TABLE app.wallet_holds DISABLE TRIGGER wallet_holds_no_delete');
      await client.query('DELETE FROM app.wallet_holds');
      await client.query('DELETE FROM app.driver_wallets');
      await client.query(WALLET_HOLD_DOWN_SQL);
      expect((await client.query("SELECT 1 FROM information_schema.tables WHERE table_schema = 'app' AND table_name = 'wallet_holds'")).rowCount).toBe(0);
      await client.query(WALLET_HOLD_UP_SQL);
      expect((await client.query("SELECT 1 FROM information_schema.tables WHERE table_schema = 'app' AND table_name = 'wallet_holds'")).rowCount).toBe(1);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
    expect((await pool.query("SELECT 1 FROM information_schema.tables WHERE table_schema = 'app' AND table_name = 'wallet_holds'")).rowCount).toBe(1);
    expect(await gateStates()).toEqual(GATES_ACTIVE);
  });

  it('7. reads never create a wallet, an unprovisioned Shipper has no holds, and the M03 readiness / closure ports still fail closed', async () => {
    const { driverId } = await makeDriver();
    expect(await manager().withTransaction((context) => service.listHolds(context, driverId))).toEqual([]);
    expect(await manager().withTransaction((context) => service.holdSummary(context, driverId))).toEqual({
      provisioned: false,
      driverId,
      heldVnd: 0n,
      activeHoldCount: 0,
      activeHoldTotalVnd: 0n,
      consistent: true,
    });
    expect((await pool.query('SELECT 1 FROM app.driver_wallets WHERE driver_id = $1::uuid', [driverId])).rowCount).toBe(0);
    const port = new NotIntegratedDriverWalletPort();
    expect(await manager().withTransaction(() => port.readinessForOrders())).toEqual({ ready: false, reason: 'WALLET_NOT_AVAILABLE' });
    expect(await manager().withTransaction(() => port.settlementForClosure())).toEqual({ settled: false, reason: 'WALLET_NOT_AVAILABLE' });
  });

  it('8. no route opens holds or any money movement for a user or an administrator', async () => {
    const app: AuthApp = await startAuthApp();
    try {
      const paths = ['/wallet/holds', '/wallets/holds', '/driver/wallet/holds', '/driver/wallet/reserve', '/driver/wallet/release', '/driver/wallet/capture', '/admin/wallet/holds'];
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
