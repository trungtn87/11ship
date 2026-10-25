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
import { TOPUP_DOWN_SQL, TOPUP_UP_SQL } from './support/wallet-migration-sql';
import { PAYMENT_CHAT_DOWN_SQL, PAYMENT_CHAT_UP_SQL } from './support/payment-chat-migration-sql';
import { WITHDRAWAL_DOWN_SQL, WITHDRAWAL_UP_SQL } from './support/withdrawal-migration-sql';

// M04-B1 against a REAL PostgreSQL test database: the topup SOURCE core (system receiving accounts, requests, the bank-transaction registry,
// confirmed topups, the typed ledger source). No money can be posted in this package: the A1 ledger source gate is untouched. The rules
// BEHIND that gate are proven inside transactions that are ALWAYS rolled back, with the ledger gate lifted by the test role only inside
// that transaction (afterwards the gates are checked to be active again). Only the race test commits rows, with the gate lifted for a
// moment, and it removes everything it wrote (and restores the gate) before it ends.
describe('M04-B1 - topup sources, bank registry and ledger source (schema, invariants, races, down latch)', () => {
  const service = new WalletService(new WalletRepository(), new DriverRepository());
  const phonesToPurge: string[] = [];
  let pool: Pool;
  let a: Owner;
  let b: Owner;

  interface Owner { userId: string; driverId: string; walletId: string }

  const manager = () => managerFor(poolClientSource(pool), { timeoutMs: 20_000 });
  const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
  const sqlState = (error: unknown): string | undefined => (typeof error === 'object' && error !== null ? (error as { code?: string }).code : undefined);

  async function makeOwner(): Promise<Owner> {
    const phone = randomPhone();
    phonesToPurge.push(phone.normalized);
    const userId = randomUUID();
    await pool.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
       VALUES ($1::uuid, $2, '$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA', now(), 'PHONE_VERIFIED', 'ACTIVE', 1, now(), now())`,
      [userId, phone.normalized],
    );
    const driverId = await createDriverFor(pool, userId);
    const { wallet } = await manager().withTransaction((context) => service.ensureZeroWallet(context, driverId));
    return { userId, driverId, walletId: wallet.walletId };
  }

  beforeAll(async () => {
    pool = testPool(loadIntegrationConfig().database, { poolMax: 8 });
    a = await makeOwner();
    b = await makeOwner();
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

  const LEDGER_GATE = 'wallet_ledger_a_source_gate';
  const GUARDS = ['wallet_bank_transactions_a_gate', 'wallet_bank_transactions_append_only', 'wallet_ledger_a_source_gate', 'wallet_system_accounts_guard', 'wallet_system_accounts_no_delete',
    'wallet_topup_ledger_invariants', 'wallet_topup_requests_guard', 'wallet_topup_requests_invariants', 'wallet_topup_requests_no_delete', 'wallet_topups_append_only', 'wallet_topups_guard', 'wallet_topups_invariants'];

  async function guardsActive(): Promise<void> {
    const triggers = await pool.query<{ tgname: string; tgenabled: string }>(
      `SELECT tgname, tgenabled FROM pg_trigger WHERE tgname = ANY($1::text[]) AND NOT tgisinternal ORDER BY tgname`,
      [GUARDS],
    );
    expect(triggers.rows.map((row) => [row.tgname, row.tgenabled])).toEqual(GUARDS.map((name) => [name, 'O']));
  }

  async function sourceRows(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const table of ['system_owned_bank_accounts', 'wallet_topup_requests', 'wallet_bank_transactions', 'wallet_topups']) {
      counts[table] = Number((await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.${table}`)).rows[0]?.n);
    }
    counts.topup_ledger = Number((await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM app.wallet_ledger_entries WHERE topup_id IS NOT NULL')).rows[0]?.n);
    return counts;
  }
  const NONE = { system_owned_bank_accounts: 0, wallet_topup_requests: 0, wallet_bank_transactions: 0, wallet_topups: 0, topup_ledger: 0 };

  // ---- fixtures: every statement runs on the given client (a transaction that is rolled back by the caller) ----
  const digits = (): string => String(Math.floor(1e9 + Math.random() * 9e9));

  async function account(client: PoolClient, canReceive = true, bank = 'VCB'): Promise<string> {
    const id = randomUUID();
    await client.query(
      `INSERT INTO app.system_owned_bank_accounts (system_account_id, bank_id, account_number, account_holder, can_receive, created_at, updated_at)
       VALUES ($1::uuid, $2, $3, 'CONG TY 11SHIP', $4, now(), now())`,
      [id, bank, digits(), canReceive],
    );
    return id;
  }
  async function request(client: PoolClient, owner: Owner, amount = 100_000): Promise<string> {
    const id = randomUUID();
    await client.query(
      `INSERT INTO app.wallet_topup_requests (request_id, wallet_id, driver_id, amount_requested_vnd, created_by_user_id, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, now(), now())`,
      [id, owner.walletId, owner.driverId, amount, owner.userId],
    );
    return id;
  }
  const bankRecord = (client: PoolClient, input: { id: string; accountId: string; bank?: string; txid: string; amount: number; topupId: string; direction?: string }): Promise<unknown> =>
    client.query(
      `INSERT INTO app.wallet_bank_transactions (bank_record_id, bank_id, system_owned_account_id, canonical_transaction_id, direction, amount_vnd, occurred_at, topup_id, withdrawal_id, created_at)
       VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6, now(), $7::uuid, $8::uuid, now())`,
      [input.id, input.bank ?? 'VCB', input.accountId, input.txid, input.direction ?? 'IN', input.amount, (input.direction ?? 'IN') === 'IN' ? input.topupId : null, (input.direction ?? 'IN') === 'OUT' ? randomUUID() : null],
    );
  const topup = (client: PoolClient, input: { id: string; owner: Owner; requestId?: string | null; bankRecordId: string; amount: number }): Promise<unknown> =>
    client.query(
      `INSERT INTO app.wallet_topups (topup_id, wallet_id, request_id, bank_record_id, actual_amount_vnd, received_at, confirmed_by_user_id, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, now(), $6::uuid, now())`,
      [input.id, input.owner.walletId, input.requestId ?? null, input.bankRecordId, input.amount, input.owner.userId],
    );
  const credit = (client: PoolClient, input: { wallet: string; topupId: string | null; delta: number; sequence?: number; balanceAfter?: number; kind?: string }): Promise<unknown> =>
    client.query(
      `INSERT INTO app.wallet_ledger_entries (entry_id, wallet_id, sequence_no, entry_kind, delta_vnd, balance_after_vnd, created_at, topup_id)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, now(), $7::uuid)`,
      [randomUUID(), input.wallet, input.sequence ?? 1, input.kind ?? 'TOPUP', input.delta, input.balanceAfter ?? input.delta, input.topupId],
    );
  const setBalance = (client: PoolClient, walletId: string, balance: number): Promise<unknown> =>
    client.query('UPDATE app.driver_wallets SET balance_vnd = $2, version = version + 1, updated_at = now() WHERE wallet_id = $1::uuid', [walletId, balance]);
  const confirm = (client: PoolClient, requestId: string): Promise<unknown> =>
    client.query(`UPDATE app.wallet_topup_requests SET state = 'CONFIRMED', resolved_by_user_id = created_by_user_id, resolved_at = now(), updated_at = now(), version = version + 1 WHERE request_id = $1::uuid`, [requestId]);

  /** The full, valid posting of one topup (what B2 will do in one transaction). */
  async function post(client: PoolClient, owner: Owner, input: { accountId: string; txid?: string; amount?: number; requestId?: string | null; sequence?: number; before?: number }): Promise<{ topupId: string; bankRecordId: string }> {
    const amount = input.amount ?? 100_000;
    const topupId = randomUUID();
    const bankRecordId = randomUUID();
    await bankRecord(client, { id: bankRecordId, accountId: input.accountId, txid: input.txid ?? `FT${digits()}`, amount, topupId });
    await topup(client, { id: topupId, owner, requestId: input.requestId, bankRecordId, amount });
    await credit(client, { wallet: owner.walletId, topupId, delta: amount, sequence: input.sequence ?? 1, balanceAfter: (input.before ?? 0) + amount });
    await setBalance(client, owner.walletId, (input.before ?? 0) + amount);
    if (input.requestId) {
      await confirm(client, input.requestId);
    }
    return { topupId, bankRecordId };
  }

  /** A transaction that is ALWAYS rolled back, with ONLY the A1 ledger gate lifted. Afterwards nothing remains and every guard is active. */
  async function rolledBack(run: (client: PoolClient) => Promise<void>): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`ALTER TABLE app.wallet_ledger_entries DISABLE TRIGGER ${LEDGER_GATE}`);
      await run(client);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
    await guardsActive();
    expect(await sourceRows()).toEqual(NONE);
  }

  /** Runs the commit-time checks now (the deferred triggers and foreign keys fire), then defers them again. */
  async function checkNow(client: PoolClient): Promise<void> {
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    await client.query('SET CONSTRAINTS ALL DEFERRED');
  }

  /** Each refusal aborts the PostgreSQL transaction, so every probe runs in its own savepoint. */
  async function refused(client: PoolClient, label: string, run: () => Promise<unknown>, needle: string): Promise<void> {
    await client.query(`SAVEPOINT ${label}`);
    const error = await failureOf(run);
    await client.query(`ROLLBACK TO SAVEPOINT ${label}`);
    expect([label, error === undefined ? 'no error' : needle.split('|').some((alternative) => messageOf(error).includes(alternative)) ? 'refused' : messageOf(error)]).toEqual([label, 'refused']);
  }

  // =====================================================================================================
  it('1. fail closed: the gate refuses a credit without a matching topup source, a complete posting passes it (B2.2b) and a rollback leaves nothing (ledger, topup, bank record, request credit)', async () => {
    // The ledger gate refuses the credit, whatever the source row says.
    const direct = await failureOf(() => credit(pool as unknown as PoolClient, { wallet: a.walletId, topupId: null, delta: 1000 }));
    expect(messageOf(direct)).toContain('WALLET_LEDGER_SOURCE_NOT_AVAILABLE');
    // A whole posting against the real gate (opened by B2.2b for a matching TOPUP source): accepted inside the transaction; the rollback leaves nothing behind.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const accountId = await account(client);
      await post(client, a, { accountId });
      expect((await client.query('SELECT 1 FROM app.wallet_ledger_entries WHERE wallet_id = $1::uuid', [a.walletId])).rowCount).toBe(1);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
    // Everything except the ledger can be written, but it cannot COMMIT: the topup is not posted (no ledger) and the links do not close.
    const half = await pool.connect();
    try {
      await half.query('BEGIN');
      const accountId = await account(half);
      const topupId = randomUUID();
      const bankRecordId = randomUUID();
      await bankRecord(half, { id: bankRecordId, accountId, txid: `FT${digits()}`, amount: 5000, topupId });
      await topup(half, { id: topupId, owner: a, bankRecordId, amount: 5000 });
      const commit = await failureOf(() => half.query('COMMIT'));
      expect(messageOf(commit)).toContain('WALLET_TOPUP_INVARIANT_VIOLATION');
    } finally {
      await half.query('ROLLBACK').catch(() => undefined);
      half.release();
    }
    await guardsActive();
    expect(await sourceRows()).toEqual(NONE);
    expect((await pool.query('SELECT 1 FROM app.wallet_ledger_entries')).rowCount).toBe(0);
  });

  it('2. a complete posting is accepted by the database (the shape B2 will use): bank record, topup and ledger credit 1:1, balance = ledger, request CONFIRMED', async () => {
    await rolledBack(async (client) => {
      const accountId = await account(client);
      const requestId = await request(client, a, 100_000);
      const { topupId } = await post(client, a, { accountId, amount: 60_000, requestId }); // the bank shows 60k although 100k was asked
      await checkNow(client);
      const rows = await client.query<{ requested: string; actual: string; state: string }>(
        `SELECT r.amount_requested_vnd::text AS requested, t.actual_amount_vnd::text AS actual, r.state FROM app.wallet_topup_requests r JOIN app.wallet_topups t ON t.request_id = r.request_id WHERE t.topup_id = $1::uuid`,
        [topupId],
      );
      expect(rows.rows[0]).toEqual({ requested: '100000', actual: '60000', state: 'CONFIRMED' });
      // A second topup on the same wallet continues the chain (no request: a direct record).
      await post(client, a, { accountId, amount: 40_000, sequence: 2, before: 60_000 });
      await checkNow(client);
      expect((await client.query<{ b: string }>('SELECT balance_vnd::text AS b FROM app.driver_wallets WHERE wallet_id = $1::uuid', [a.walletId])).rows[0]?.b).toBe('100000');
    });
  });

  it('3. no money without its document: every broken link is refused at commit time', async () => {
    await rolledBack(async (client) => {
      const accountId = await account(client);
      const fresh = async (): Promise<{ topupId: string; bankRecordId: string }> => ({ topupId: randomUUID(), bankRecordId: randomUUID() });

      await refused(client, 'topup_without_ledger', async () => {
        const { topupId, bankRecordId } = await fresh();
        await bankRecord(client, { id: bankRecordId, accountId, txid: `T${digits()}`, amount: 5000, topupId });
        await topup(client, { id: topupId, owner: a, bankRecordId, amount: 5000 });
        await checkNow(client);
      }, 'WALLET_TOPUP_INVARIANT_VIOLATION');

      await refused(client, 'topup_without_bank_record', async () => {
        const { topupId, bankRecordId } = await fresh();
        await topup(client, { id: topupId, owner: a, bankRecordId, amount: 5000 });
        await credit(client, { wallet: a.walletId, topupId, delta: 5000 });
        await setBalance(client, a.walletId, 5000);
        await checkNow(client);
      }, 'wallet_topups_bank_fk');

      await refused(client, 'bank_record_without_topup', async () => {
        await bankRecord(client, { id: randomUUID(), accountId, txid: `T${digits()}`, amount: 5000, topupId: randomUUID() });
        await checkNow(client);
      }, 'wallet_bank_transactions_topup_fk');

      await refused(client, 'bank_amount_differs_from_topup', async () => {
        const { topupId, bankRecordId } = await fresh();
        await bankRecord(client, { id: bankRecordId, accountId, txid: `T${digits()}`, amount: 4000, topupId });
        await topup(client, { id: topupId, owner: a, bankRecordId, amount: 5000 });
        await credit(client, { wallet: a.walletId, topupId, delta: 5000 });
        await setBalance(client, a.walletId, 5000);
        await checkNow(client);
      }, 'foreign key');

      await refused(client, 'ledger_amount_differs_from_topup', async () => {
        const { topupId, bankRecordId } = await fresh();
        await bankRecord(client, { id: bankRecordId, accountId, txid: `T${digits()}`, amount: 5000, topupId });
        await topup(client, { id: topupId, owner: a, bankRecordId, amount: 5000 });
        await credit(client, { wallet: a.walletId, topupId, delta: 6000 });
        await setBalance(client, a.walletId, 6000);
        await checkNow(client);
      }, 'wallet_ledger_entries_topup_fk|WALLET_TOPUP_INVARIANT_VIOLATION');

      await refused(client, 'ledger_on_another_wallet', async () => {
        const { topupId, bankRecordId } = await fresh();
        await bankRecord(client, { id: bankRecordId, accountId, txid: `T${digits()}`, amount: 5000, topupId });
        await topup(client, { id: topupId, owner: a, bankRecordId, amount: 5000 });
        await credit(client, { wallet: b.walletId, topupId, delta: 5000 });
        await setBalance(client, b.walletId, 5000);
        await checkNow(client);
      }, 'wallet_ledger_entries_topup_fk|WALLET_TOPUP_INVARIANT_VIOLATION');

      await refused(client, 'balance_not_moved', async () => {
        const { topupId, bankRecordId } = await fresh();
        await bankRecord(client, { id: bankRecordId, accountId, txid: `T${digits()}`, amount: 5000, topupId });
        await topup(client, { id: topupId, owner: a, bankRecordId, amount: 5000 });
        await credit(client, { wallet: a.walletId, topupId, delta: 5000 });
        await checkNow(client);
      }, 'WALLET_INVARIANT_VIOLATION');

      await refused(client, 'credited_twice', async () => {
        const { topupId, bankRecordId } = await fresh();
        await bankRecord(client, { id: bankRecordId, accountId, txid: `T${digits()}`, amount: 5000, topupId });
        await topup(client, { id: topupId, owner: a, bankRecordId, amount: 5000 });
        await credit(client, { wallet: a.walletId, topupId, delta: 5000, sequence: 1 });
        await credit(client, { wallet: a.walletId, topupId, delta: 5000, sequence: 2, balanceAfter: 10_000 });
      }, 'wallet_ledger_entries_topup_uq');

      // The ledger carries its source typed: TOPUP needs a topup, every other kind cannot name one.
      await refused(client, 'topup_kind_without_source', () => credit(client, { wallet: a.walletId, topupId: null, delta: 5000 }), 'wallet_ledger_entries_topup_source_ck');
      await refused(client, 'other_kind_with_source', () => credit(client, { wallet: a.walletId, topupId: randomUUID(), delta: 5000, kind: 'ADJUSTMENT_CREDIT' }), 'wallet_ledger_entries_topup_source_ck');
      await refused(client, 'ledger_with_unknown_topup', async () => {
        await credit(client, { wallet: a.walletId, topupId: randomUUID(), delta: 5000 });
        await setBalance(client, a.walletId, 5000);
        await checkNow(client);
      }, 'wallet_ledger_entries_topup_fk');
    });
  });

  it('4. a request cannot credit unless CONFIRMED with its own topup; PENDING / REJECTED / CANCELLED never carry one', async () => {
    await rolledBack(async (client) => {
      const accountId = await account(client);
      for (const state of ['PENDING', 'REJECTED', 'CANCELLED'] as const) {
        await refused(client, `topup_for_${state.toLowerCase()}`, async () => {
          const requestId = await request(client, a);
          if (state !== 'PENDING') {
            await client.query(`UPDATE app.wallet_topup_requests SET state = $2, resolved_by_user_id = created_by_user_id, resolved_at = now(), updated_at = now(), version = 2 WHERE request_id = $1::uuid`, [requestId, state]);
          }
          const { topupId, bankRecordId } = { topupId: randomUUID(), bankRecordId: randomUUID() };
          await bankRecord(client, { id: bankRecordId, accountId, txid: `T${digits()}`, amount: 5000, topupId });
          await topup(client, { id: topupId, owner: a, requestId, bankRecordId, amount: 5000 });
          await credit(client, { wallet: a.walletId, topupId, delta: 5000 });
          await setBalance(client, a.walletId, 5000);
          await checkNow(client);
        }, 'WALLET_TOPUP_INVARIANT_VIOLATION');
      }
      await refused(client, 'confirmed_without_topup', async () => {
        const requestId = await request(client, a);
        await confirm(client, requestId);
        await checkNow(client);
      }, 'WALLET_TOPUP_INVARIANT_VIOLATION');
      await refused(client, 'request_of_another_wallet', async () => {
        const requestId = await request(client, b);
        const { topupId, bankRecordId } = { topupId: randomUUID(), bankRecordId: randomUUID() };
        await bankRecord(client, { id: bankRecordId, accountId, txid: `T${digits()}`, amount: 5000, topupId });
        await topup(client, { id: topupId, owner: a, requestId, bankRecordId, amount: 5000 });
      }, 'wallet_topups_request_fk');
      await refused(client, 'request_used_twice', async () => {
        const requestId = await request(client, a);
        await post(client, a, { accountId, amount: 5000, requestId });
        await post(client, a, { accountId, amount: 5000, requestId, sequence: 2, before: 5000 });
      }, 'wallet_topups_request_uq');
      // PENDING alone is harmless: it exists, credits nothing and leaves the balance at 0.
      await request(client, a, 250_000);
      await checkNow(client);
      expect((await client.query<{ b: string }>('SELECT balance_vnd::text AS b FROM app.driver_wallets WHERE wallet_id = $1::uuid', [a.walletId])).rows[0]?.b).toBe('0');
    });
  });

  it('5. one bank transaction is recorded once: the canonical identity is unique across wallets and requests, exact (no case or zero folding), and only a statement id is accepted', async () => {
    await rolledBack(async (client) => {
      const accountId = await account(client);
      const otherAccount = await account(client);
      const insertOne = (txid: string, account = accountId, bank = 'VCB'): Promise<unknown> =>
        bankRecord(client, { id: randomUUID(), accountId: account, bank, txid, amount: 1000, topupId: randomUUID() });
      await insertOne('FT2610170001');
      await refused(client, 'same_identity', () => insertOne('FT2610170001'), 'wallet_bank_transactions_identity_uq');
      // The namespace is (bank, system account, id): other account, same id is a different transaction. Case and leading zeros are NOT folded.
      await insertOne('FT2610170001', otherAccount);
      await insertOne('ft2610170001');
      await insertOne('0012');
      await insertOne('12');
      await refused(client, 'same_zero_folded', () => insertOne('0012'), 'wallet_bank_transactions_identity_uq');
      // The edge is trimmed by the service, the database refuses anything else: nothing is silently rewritten.
      for (const [label, txid] of [['empty', ''], ['leading_space', ' FT1'], ['trailing_space', 'FT1 '], ['control', 'FT\u00001'], ['newline', 'FT1\n'], ['too_long', 'X'.repeat(129)]] as const) {
        await refused(client, `bad_txid_${label}`, () => insertOne(txid), label === 'too_long' ? 'too long' : label === 'control' ? '' : 'wallet_bank_transactions_txid_ck');
      }
      await insertOne('FT 20 1'); // an inner space is part of the id
      // The account must be a receiving system account of the same bank; OUT is closed until withdrawals exist.
      await refused(client, 'unknown_account', () => bankRecord(client, { id: randomUUID(), accountId: randomUUID(), txid: 'U1', amount: 1000, topupId: randomUUID() }), 'wallet_bank_transactions_account_fk|WALLET_BANK_ACCOUNT_NOT_RECEIVING|WALLET_BANK_ACCOUNT_NOT_FOUND');
      await refused(client, 'wrong_bank_for_account', () => insertOne('B1', accountId, 'ACB'), 'wallet_bank_transactions_account_fk|WALLET_BANK_ACCOUNT_NOT_RECEIVING|WALLET_BANK_ACCOUNT_NOT_FOUND');
      const closed = await account(client, false);
      await refused(client, 'account_not_receiving', () => insertOne('N1', closed), 'WALLET_BANK_ACCOUNT_NOT_RECEIVING');
      await refused(client, 'out_closed', () => bankRecord(client, { id: randomUUID(), accountId, txid: 'O1', amount: 1000, topupId: randomUUID(), direction: 'OUT' }), 'WALLET_BANK_OUT_NOT_AVAILABLE');
      await refused(client, 'amount_zero', () => bankRecord(client, { id: randomUUID(), accountId, txid: 'Z1', amount: 0, topupId: randomUUID() }), 'wallet_bank_transactions_amount_ck');
      await refused(client, 'amount_over_cap', () => bankRecord(client, { id: randomUUID(), accountId, txid: 'Z2', amount: 9_007_199_254_740_992, topupId: randomUUID() }), 'wallet_bank_transactions_amount_ck');
    });
  });

  it('6. sources are immutable: the registry and the topups are append-only, accounts keep their identity, requests move once and are never deleted', async () => {
    await rolledBack(async (client) => {
      const accountId = await account(client);
      const requestId = await request(client, a, 80_000);
      const { topupId, bankRecordId } = await post(client, a, { accountId, amount: 80_000, requestId });
      await checkNow(client);
      for (const [table, key, id] of [['wallet_bank_transactions', 'bank_record_id', bankRecordId], ['wallet_topups', 'topup_id', topupId]] as const) {
        await refused(client, `${table}_update`, () => client.query(`UPDATE app.${table} SET created_at = created_at WHERE ${key} = $1::uuid`, [id]), 'append-only');
        await refused(client, `${table}_update_none`, () => client.query(`UPDATE app.${table} SET created_at = created_at WHERE false`), 'append-only');
        await refused(client, `${table}_delete`, () => client.query(`DELETE FROM app.${table} WHERE ${key} = $1::uuid`, [id]), 'append-only');
        await refused(client, `${table}_truncate`, () => client.query(`TRUNCATE app.${table}`), 'append-only|cannot truncate');
      }
      await refused(client, 'ledger_update', () => client.query('UPDATE app.wallet_ledger_entries SET delta_vnd = 1 WHERE topup_id = $1::uuid', [topupId]), 'append-only');
      // System accounts: identity fixed, the receiving flag can change with a version bump, never deleted.
      const update = (set: string): Promise<unknown> => client.query(`UPDATE app.system_owned_bank_accounts SET ${set} WHERE system_account_id = $1::uuid`, [accountId]);
      await refused(client, 'account_number', () => update(`account_number = '999999999', version = version + 1`), 'WALLET_SYSTEM_ACCOUNT_IDENTITY_IMMUTABLE');
      await refused(client, 'account_holder', () => update(`account_holder = 'SOMEONE', version = version + 1`), 'WALLET_SYSTEM_ACCOUNT_IDENTITY_IMMUTABLE');
      await refused(client, 'account_bank', () => update(`bank_id = 'ACB', version = version + 1`), 'WALLET_SYSTEM_ACCOUNT_IDENTITY_IMMUTABLE');
      await refused(client, 'account_version', () => update('can_receive = false'), 'WALLET_SYSTEM_ACCOUNT_VERSION_CONFLICT');
      await update('can_receive = false, updated_at = now(), version = version + 1');
      await refused(client, 'account_delete', () => client.query('DELETE FROM app.system_owned_bank_accounts'), 'never deleted');
      await refused(client, 'account_truncate', () => client.query('TRUNCATE app.system_owned_bank_accounts'), 'never deleted|cannot truncate');
      // Requests: the owner and the amount never change; one transition out of PENDING, then final; no delete.
      const pending = await request(client, a, 50_000);
      const move = (id: string, set: string): Promise<unknown> => client.query(`UPDATE app.wallet_topup_requests SET ${set} WHERE request_id = $1::uuid`, [id]);
      await refused(client, 'req_amount', () => move(pending, 'amount_requested_vnd = 1, version = version + 1'), 'WALLET_TOPUP_REQUEST_IDENTITY_IMMUTABLE');
      await refused(client, 'req_wallet', () => move(pending, `wallet_id = '${b.walletId}', driver_id = '${b.driverId}', version = version + 1`), 'WALLET_TOPUP_REQUEST_IDENTITY_IMMUTABLE');
      await refused(client, 'req_creator', () => move(pending, `created_by_user_id = '${b.userId}', version = version + 1`), 'WALLET_TOPUP_REQUEST_IDENTITY_IMMUTABLE');
      await refused(client, 'req_pending_to_pending', () => move(pending, 'version = version + 1'), 'WALLET_TOPUP_REQUEST_TRANSITION_REFUSED');
      await refused(client, 'req_unknown_state', () => move(pending, `state = 'LOST', version = version + 1`), 'WALLET_TOPUP_REQUEST_TRANSITION_REFUSED');
      await refused(client, 'req_version', () => move(pending, `state = 'CANCELLED', resolved_by_user_id = created_by_user_id, resolved_at = now(), updated_at = now(), version = version + 3`), 'WALLET_TOPUP_REQUEST_VERSION_CONFLICT');
      await refused(client, 'req_resolved_without_actor', () => move(pending, `state = 'CANCELLED', updated_at = now(), version = version + 1`), 'wallet_topup_requests_resolved_ck');
      // An end state needs BOTH resolution fields: each one alone is refused, for every end state.
      for (const end of ['CONFIRMED', 'REJECTED', 'CANCELLED']) {
        await refused(client, `${end.toLowerCase()}_only_time`, () => move(pending, `state = '${end}', resolved_at = now(), updated_at = now(), version = version + 1`), 'wallet_topup_requests_resolved_ck');
        await refused(client, `${end.toLowerCase()}_only_actor`, () => move(pending, `state = '${end}', resolved_by_user_id = created_by_user_id, updated_at = now(), version = version + 1`), 'wallet_topup_requests_resolved_ck');
      }
      await move(pending, `state = 'CANCELLED', resolved_by_user_id = created_by_user_id, resolved_at = now(), updated_at = now(), version = version + 1`);
      for (const next of ['PENDING', 'CONFIRMED', 'REJECTED']) {
        await refused(client, `cancelled_to_${next.toLowerCase()}`, () => move(pending, `state = '${next}', version = version + 1`), 'WALLET_TOPUP_REQUEST_TRANSITION_REFUSED');
      }
      await refused(client, 'confirmed_to_cancelled', () => move(requestId, `state = 'CANCELLED', version = version + 1`), 'WALLET_TOPUP_REQUEST_TRANSITION_REFUSED');
      await checkNow(client); // settle the deferred events first, so the refusal below is the table's own rule
      await refused(client, 'req_delete', () => client.query('DELETE FROM app.wallet_topup_requests'), 'never deleted');
      await refused(client, 'req_truncate', () => client.query('TRUNCATE app.wallet_topup_requests'), 'never deleted|cannot truncate');
      // Creation rules: PENDING at version 1; the wallet and its driver agree; positive bounded amount; a real creator.
      const insert = (set: { state?: string; amount?: number; driver?: string; creator?: string }): Promise<unknown> =>
        client.query(
          `INSERT INTO app.wallet_topup_requests (request_id, wallet_id, driver_id, amount_requested_vnd, state, created_by_user_id, created_at, updated_at, resolved_at, resolved_by_user_id)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::uuid, now(), now(), $7, $8::uuid)`,
          [randomUUID(), a.walletId, set.driver ?? a.driverId, set.amount ?? 1000, set.state ?? 'PENDING', set.creator ?? a.userId, set.state === undefined ? null : new Date(), set.state === undefined ? null : a.userId],
        );
      await refused(client, 'born_confirmed', () => insert({ state: 'CONFIRMED' }), 'WALLET_TOPUP_REQUEST_MUST_START_PENDING');
      await refused(client, 'driver_of_another_wallet', () => insert({ driver: b.driverId }), 'wallet_topup_requests_owner_fk');
      await refused(client, 'amount_zero', () => insert({ amount: 0 }), 'wallet_topup_requests_amount_ck');
      await refused(client, 'amount_over_cap', () => insert({ amount: 9_007_199_254_740_992 }), 'wallet_topup_requests_amount_ck');
      await refused(client, 'unknown_creator', () => insert({ creator: randomUUID() }), 'wallet_topup_requests_created_by_fk');
    });
  });

  it('7. A1 / A2.1 / M03 data is untouched: down then up (rolled back) leaves wallets, ledger, holds, drivers and parameters identical, and the gates come back', async () => {
    const snapshot = async (client: PoolClient): Promise<unknown> => ({
      wallets: (await client.query('SELECT * FROM app.driver_wallets ORDER BY wallet_id')).rows,
      ledger: (await client.query('SELECT * FROM app.wallet_ledger_entries ORDER BY entry_id')).rows,
      holds: (await client.query('SELECT * FROM app.wallet_holds ORDER BY hold_id')).rows,
      drivers: (await client.query('SELECT * FROM app.drivers ORDER BY driver_id')).rows,
      banks: (await client.query('SELECT * FROM app.driver_bank_accounts ORDER BY driver_id')).rows,
      parameters: (await client.query('SELECT * FROM app.shipper_wallet_parameters ORDER BY param_key')).rows,
    });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const before = await snapshot(client);
      await client.query(PAYMENT_CHAT_DOWN_SQL);
      await client.query(WITHDRAWAL_DOWN_SQL); // M04-C withdrawals: the very newest, down first, up last
      await client.query(TOPUP_DOWN_SQL);
      const gone = await client.query(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'app' AND table_name IN ('system_owned_bank_accounts', 'wallet_topup_requests', 'wallet_bank_transactions', 'wallet_topups')`);
      expect(gone.rowCount).toBe(0);
      expect((await client.query(`SELECT 1 FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'wallet_ledger_entries' AND column_name = 'topup_id'`)).rowCount).toBe(0);
      expect(await snapshot(client)).toEqual(before);
      await client.query(TOPUP_UP_SQL);
      await client.query(WITHDRAWAL_UP_SQL);
      await client.query(PAYMENT_CHAT_UP_SQL);
      expect(await snapshot(client)).toEqual(before);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
    await guardsActive();
    expect(await sourceRows()).toEqual(NONE);
  });

  describe('down migration safety latch and the race on one bank transaction', () => {
    it('ANY system account, request (even CANCELLED), bank record, topup or ledger credit refuses the down migration and loses nothing', async () => {
      await rolledBack(async (client) => {
        await refused(client, 'cancelled_request_only', async () => {
          const requestId = await request(client, a);
          await client.query(`UPDATE app.wallet_topup_requests SET state = 'CANCELLED', resolved_by_user_id = created_by_user_id, resolved_at = now(), updated_at = now(), version = 2 WHERE request_id = $1::uuid`, [requestId]);
          await client.query(TOPUP_DOWN_SQL);
        }, 'WALLET_TOPUP_DOWN_REFUSED');
        await refused(client, 'system_account_only', async () => {
          await account(client);
          await client.query(TOPUP_DOWN_SQL);
        }, 'WALLET_TOPUP_DOWN_REFUSED');
        await refused(client, 'full_posting', async () => {
          const accountId = await account(client);
          await post(client, a, { accountId });
          await client.query(TOPUP_DOWN_SQL);
        }, 'WALLET_TOPUP_DOWN_REFUSED');
        const error = await failureOf(async () => {
          await client.query('SAVEPOINT latch');
          try {
            await account(client);
            await client.query(TOPUP_DOWN_SQL);
          } finally {
            await client.query('ROLLBACK TO SAVEPOINT latch');
          }
        });
        expect(sqlState(error)).toBe('23000');
      });
    });

    it('the down migration waits for a transaction that already uses a source table (ACCESS EXCLUSIVE latch), then runs', async () => {
      const waiting = async (): Promise<number> =>
        Number((await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM pg_locks l WHERE l.locktype = 'relation' AND NOT l.granted AND l.relation = 'app.wallet_topups'::regclass`)).rows[0]?.n);
      const reader = await pool.connect();
      const migrator = await pool.connect();
      try {
        await reader.query('BEGIN');
        await reader.query('SELECT count(*) FROM app.wallet_topups');
        await migrator.query('BEGIN');
        await migrator.query(PAYMENT_CHAT_DOWN_SQL);
        await migrator.query(WITHDRAWAL_DOWN_SQL); // M04-C withdrawals depend on the registry: newest, down first
        const migrating = migrator.query(TOPUP_DOWN_SQL).then(() => undefined, (error: unknown) => error);
        await eventually(async () => (await waiting()) >= 1, 'the down migration blocked behind the open reader');
        await reader.query('COMMIT');
        expect(await migrating).toBeUndefined();
      } finally {
        await reader.query('ROLLBACK').catch(() => undefined);
        await migrator.query('ROLLBACK').catch(() => undefined);
        reader.release();
        migrator.release();
      }
      await guardsActive();
      expect(await sourceRows()).toEqual(NONE);
    });

    it('two writers racing for ONE bank transaction: exactly one posting commits, the other is refused by the registry and leaves nothing', async () => {
      // The only test that COMMITS: the ledger gate is lifted for the duration (test role = migrator), the accounts and rows are created
      // for two throw-away Shippers and everything is removed, and the gate restored, in the finally block.
      const owner1 = await makeOwner();
      const owner2 = await makeOwner();
      const setup = await pool.connect();
      let accountId = '';
      let setupReleased = false;
      try {
        await setup.query('BEGIN');
        accountId = await account(setup);
        await setup.query('COMMIT');
        setup.release();
        setupReleased = true;
        await pool.query(`ALTER TABLE app.wallet_ledger_entries DISABLE TRIGGER ${LEDGER_GATE}`);
        const txid = `FT-RACE-${digits()}`;
        const writer1 = await pool.connect();
        const writer2 = await pool.connect();
        try {
          await writer1.query('BEGIN');
          await writer2.query('BEGIN');
          const topup1 = randomUUID();
          const bank1 = randomUUID();
          await bankRecord(writer1, { id: bank1, accountId, txid, amount: 100_000, topupId: topup1 }); // takes the identity first
          const topup2 = randomUUID();
          const bank2 = randomUUID();
          const second = bankRecord(writer2, { id: bank2, accountId, txid, amount: 100_000, topupId: topup2 }).then(() => undefined, (error: unknown) => error);
          await eventually(
            async () => Number((await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%INSERT INTO app.wallet_bank_transactions%'`)).rows[0]?.n) >= 1,
            'the second writer waits behind the first for the same bank identity',
          );
          await topup(writer1, { id: topup1, owner: owner1, bankRecordId: bank1, amount: 100_000 });
          await credit(writer1, { wallet: owner1.walletId, topupId: topup1, delta: 100_000 });
          await setBalance(writer1, owner1.walletId, 100_000);
          await writer1.query('COMMIT');
          const refusal = await second;
          expect(sqlState(refusal)).toBe('23505');
          expect(messageOf(refusal)).toContain('wallet_bank_transactions_identity_uq');
          await writer2.query('ROLLBACK');
        } finally {
          await writer1.query('ROLLBACK').catch(() => undefined);
          await writer2.query('ROLLBACK').catch(() => undefined);
          writer1.release();
          writer2.release();
        }
        const rows = await pool.query<{ topups: string; credits: string; b1: string; b2: string }>(
          `SELECT (SELECT count(*) FROM app.wallet_topups WHERE wallet_id IN ($1::uuid, $2::uuid))::text AS topups,
                  (SELECT count(*) FROM app.wallet_ledger_entries WHERE topup_id IS NOT NULL AND wallet_id IN ($1::uuid, $2::uuid))::text AS credits,
                  (SELECT balance_vnd FROM app.driver_wallets WHERE wallet_id = $1::uuid)::text AS b1,
                  (SELECT balance_vnd FROM app.driver_wallets WHERE wallet_id = $2::uuid)::text AS b2`,
          [owner1.walletId, owner2.walletId],
        );
        expect(rows.rows[0]).toEqual({ topups: '1', credits: '1', b1: '100000', b2: '0' });
        expect((await pool.query('SELECT 1 FROM app.wallet_bank_transactions WHERE canonical_transaction_id = $1', [txid])).rowCount).toBe(1);
      } finally {
        if (!setupReleased) {
          await setup.query('ROLLBACK').catch(() => undefined);
          setup.release();
        }
        // Cleanup: purge the committed rows of both Shippers (user triggers lifted only for this transaction), then the account, then the gate.
        await pool.query(`ALTER TABLE app.wallet_ledger_entries ENABLE TRIGGER ${LEDGER_GATE}`);
        for (const phone of phonesToPurge.splice(phonesToPurge.length - 2)) {
          await purgePhone(pool, phone);
        }
        if (accountId !== '') {
          const cleanup = await pool.connect();
          try {
            await cleanup.query('BEGIN');
            await cleanup.query('ALTER TABLE app.wallet_bank_transactions DISABLE TRIGGER USER');
            await cleanup.query('DELETE FROM app.wallet_bank_transactions WHERE system_owned_account_id = $1::uuid', [accountId]);
            await cleanup.query('ALTER TABLE app.wallet_bank_transactions ENABLE TRIGGER USER');
            await cleanup.query('ALTER TABLE app.system_owned_bank_accounts DISABLE TRIGGER wallet_system_accounts_no_delete');
            await cleanup.query('DELETE FROM app.system_owned_bank_accounts WHERE system_account_id = $1::uuid', [accountId]);
            await cleanup.query('ALTER TABLE app.system_owned_bank_accounts ENABLE TRIGGER wallet_system_accounts_no_delete');
            await cleanup.query('COMMIT');
          } catch (error) {
            await cleanup.query('ROLLBACK').catch(() => undefined);
            throw error;
          } finally {
            cleanup.release();
          }
        }
      }
      await guardsActive();
      expect(await sourceRows()).toEqual(NONE);
    });
  });
});
