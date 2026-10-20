import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Pool } from 'pg';
import { eventually } from './support/async-helpers';
import { ApiResponse, AuthApp, countRows, dataOf, errorCode, obtainProof, PASSWORD, Phone, randomPhone, startAuthApp } from './support/auth-fixtures';
import { holdRowLock } from './support/lock-fixtures';

// M04-B2.1 on a REAL Nest pipeline and PostgreSQL: the Shipper creates, reads and cancels top-up REQUESTS under /v1/driver/wallet. A request
// asks for money and never moves any: every test that writes also proves the wallet balance, the ledger, the topups and the bank
// registry are untouched. The receiving account is a TEST fixture row (the product has none until a SYSTEM-only package configures one).

const TERMS = 'test-terms-20261011-v1';
const PRIVACY = 'test-privacy-20261011-v1';
const WEB_SHIP = { device_id: 'web-ship-0001', platform: 'WEB', app: 'SHIP' };
const WEB_FOOD = { device_id: 'web-food-0001', platform: 'WEB', app: 'FOOD' };
const tag = randomBytes(3).toString('hex').toUpperCase();
const BASE = '/driver/wallet';

interface Shipper {
  readonly phone: Phone;
  readonly userId: string;
  readonly token: string;
  readonly driverId: string;
}

describe('M04-B2.1 — Shipper top-up requests', () => {
  let app: AuthApp;
  let pool: Pool;
  let accountId: string;
  let originalMin: number;

  beforeAll(async () => {
    app = await startAuthApp({}, { relaxTimeouts: true, configOverride: { clientAuth: { termsVersion: TERMS, privacyVersion: PRIVACY } } });
    pool = app.pool;
    originalMin = Number((await pool.query<{ v: string }>(`SELECT int_value::text AS v FROM app.shipper_wallet_parameters WHERE param_key = 'topup_min_vnd'`)).rows[0]?.v);
    accountId = randomUUID();
    await pool.query(
      `INSERT INTO app.system_owned_bank_accounts (system_account_id, bank_id, account_number, account_holder, can_receive, created_at, updated_at)
       VALUES ($1::uuid, 'VCB', $2, 'CONG TY TEST 11SHIP', true, now(), now())`,
      [accountId, String(Math.floor(1e9 + Math.random() * 9e9))],
    );
  });

  afterAll(async () => {
    try {
      await setMin(originalMin);
      // The fixture account: removed under the lifted "never deleted" guard, only here (nothing references it).
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('ALTER TABLE app.system_owned_bank_accounts DISABLE TRIGGER wallet_system_accounts_no_delete');
        await client.query('DELETE FROM app.system_owned_bank_accounts WHERE system_account_id = $1::uuid', [accountId]);
        await client.query('ALTER TABLE app.system_owned_bank_accounts ENABLE TRIGGER wallet_system_accounts_no_delete');
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    } finally {
      await app.close(); // purges the tracked accounts, their wallets and requests, then ends the pool
    }
  });

  // ------------------------------------------------------------------------------------------------ helpers
  async function newShipper(options: { driver?: boolean } = {}): Promise<Shipper> {
    const phone = randomPhone();
    const proof = await obtainProof(app, phone);
    const name = `Nguyễn Văn Nạp ${tag}`;
    const registered = await app.call('POST', '/client-auth/register', {
      headers: { 'idempotency-key': randomUUID() },
      body: { phone: phone.local, password: PASSWORD, verification_token: proof.proofToken, device: { ...WEB_FOOD }, full_name: name, consent: { terms_version: TERMS, privacy_version: PRIVACY } },
    });
    expect(registered.status).toBe(201);
    const userId = String(dataOf(registered).user_id);
    let token = await loginAs(phone, WEB_SHIP);
    let driverId = '';
    if (options.driver !== false) {
      const created = await app.call('POST', '/onboarding/driver', { bearer: token, headers: { 'idempotency-key': randomUUID() }, body: { full_name: name, plate_number: '59X1-123.45' } });
      expect(created.status).toBe(201);
      driverId = String(dataOf(created).driver_id);
      // A session wears the hat it was created with: a new login after onboarding wears DRIVER.
      token = await loginAs(phone, WEB_SHIP);
    }
    return { phone, userId, token, driverId };
  }

  async function loginAs(phone: Phone, device: Record<string, string>): Promise<string> {
    const response = await app.call('POST', '/client-auth/login', { headers: { 'idempotency-key': randomUUID() }, body: { phone: phone.local, password: PASSWORD, device } });
    expect(response.status).toBe(200);
    return String(dataOf(response).access_token);
  }

  const create = (token: string | undefined, body: unknown, key: string | null = randomUUID()): Promise<ApiResponse> =>
    app.call('POST', `${BASE}/topup-requests`, { ...(token === undefined ? {} : { bearer: token }), ...(key === null ? {} : { headers: { 'idempotency-key': key } }), body });
  const cancel = (token: string, id: string, body: unknown, key: string = randomUUID()): Promise<ApiResponse> =>
    app.call('POST', `${BASE}/topup-requests/${id}/cancel`, { bearer: token, headers: { 'idempotency-key': key }, body });
  const get = (token: string | undefined, path: string): Promise<ApiResponse> => app.call('GET', `${BASE}${path}`, token === undefined ? {} : { bearer: token });

  const setMin = async (value: number): Promise<void> => {
    await pool.query(`UPDATE app.shipper_wallet_parameters SET int_value = $1::bigint, version = version + 1, updated_at = now() WHERE param_key = 'topup_min_vnd'`, [value]);
  };
  const setReceiving = async (value: boolean): Promise<void> => {
    await pool.query('UPDATE app.system_owned_bank_accounts SET can_receive = $2, version = version + 1, updated_at = now() WHERE system_account_id = $1::uuid', [accountId, value]);
  };

  const requestRows = (driverId: string): Promise<number> => countRows(pool, 'SELECT 1 FROM app.wallet_topup_requests WHERE driver_id = $1::uuid', [driverId]);
  const walletOf = async (driverId: string): Promise<Record<string, string> | undefined> =>
    (await pool.query('SELECT wallet_id::text, balance_vnd::text, held_vnd::text, version::text FROM app.driver_wallets WHERE driver_id = $1::uuid', [driverId])).rows[0] as Record<string, string> | undefined;
  const auditCount = (id: string, action: string): Promise<number> => countRows(pool, 'SELECT 1 FROM app.audit_logs WHERE resource_id = $1 AND action = $2', [id, action]);
  const outboxOf = async (id: string): Promise<Record<string, unknown>[]> =>
    (await pool.query('SELECT payload FROM app.outbox_events WHERE resource_id = $1 ORDER BY occurred_at, event_id', [id])).rows.map((row: { payload: Record<string, unknown> }) => row.payload);

  /** Nothing that holds or moves money was touched for this Shipper: zero balance, zero held, no topup, no bank record, no ledger row. */
  async function expectNoMoney(driverId: string): Promise<void> {
    const wallet = await walletOf(driverId);
    if (wallet !== undefined) {
      expect(wallet).toMatchObject({ balance_vnd: '0', held_vnd: '0', version: '1' });
      expect(await countRows(pool, 'SELECT 1 FROM app.wallet_ledger_entries WHERE wallet_id = $1::uuid', [wallet.wallet_id])).toBe(0);
      expect(await countRows(pool, 'SELECT 1 FROM app.wallet_topups WHERE wallet_id = $1::uuid', [wallet.wallet_id])).toBe(0);
    }
    expect(await countRows(pool, 'SELECT 1 FROM app.wallet_bank_transactions')).toBe(0);
  }

  const lockWaiters = async (): Promise<number> =>
    Number((await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`)).rows[0]?.n);

  // ------------------------------------------------------------------------------------------------ tests
  it('1. creates a PENDING request for a PENDING Shipper: 201, one row, the wallet appears at 0, nothing moves; the same key replays and creates nothing more', async () => {
    const s = await newShipper();
    const key = randomUUID();
    const response = await create(s.token, { amount_vnd: 150_000 }, key);
    expect(response.status).toBe(201);
    const data = dataOf(response);
    expect(data).toMatchObject({ amount_requested_vnd: 150_000, state: 'PENDING', version: 1, resolved_at: null });
    expect(Object.keys(data).sort()).toEqual(['amount_requested_vnd', 'created_at', 'request_id', 'resolved_at', 'state', 'version']);
    const id = String(data.request_id);
    const row = (await pool.query('SELECT state, version::text, amount_requested_vnd::text, created_by_user_id::text, resolved_at, resolved_by_user_id FROM app.wallet_topup_requests WHERE request_id = $1::uuid', [id])).rows[0];
    expect(row).toMatchObject({ state: 'PENDING', version: '1', amount_requested_vnd: '150000', created_by_user_id: s.userId, resolved_at: null, resolved_by_user_id: null });
    expect(await walletOf(s.driverId)).toMatchObject({ balance_vnd: '0', held_vnd: '0' });
    expect(await auditCount(id, 'wallet.topup_request.create.v1')).toBe(1);
    // The event carries the identifier, the state and the version only: nothing about the amount, the owner, a bank or a phone.
    expect(await outboxOf(id)).toEqual([{ request_id: id, state: 'PENDING', version: 1 }]);
    // Replay: same key and body -> the same answer, nothing new. Same key, different amount -> refused.
    const replay = await create(s.token, { amount_vnd: 150_000 }, key);
    expect(replay.status).toBe(201);
    expect(dataOf(replay).request_id).toBe(id);
    expect(errorCode(await create(s.token, { amount_vnd: 200_000 }, key))).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await requestRows(s.driverId)).toBe(1);
    expect(await auditCount(id, 'wallet.topup_request.create.v1')).toBe(1);
    await expectNoMoney(s.driverId);
  });

  it('2. reads never write: no wallet is created by a list or a detail, the list is the Shipper\'s own, and the receiving accounts are only those that can receive', async () => {
    const s = await newShipper();
    const list = await get(s.token, '/topup-requests');
    expect(list.status).toBe(200);
    expect(dataOf(list)).toEqual({ items: [], next_cursor: null });
    expect(await walletOf(s.driverId)).toMatchObject({ balance_vnd: '0', held_vnd: '0', version: '1' });
    expect((await get(s.token, `/topup-requests/${randomUUID()}`)).status).toBe(404);
    expect(await walletOf(s.driverId)).toMatchObject({ balance_vnd: '0', held_vnd: '0', version: '1' });
    const accounts = dataOf(await get(s.token, '/topup-receiving-accounts')).accounts as Array<Record<string, unknown>>;
    const mine = accounts.filter((account) => account.account_holder === 'CONG TY TEST 11SHIP');
    expect(mine).toHaveLength(1);
    expect(Object.keys(mine[0] as object).sort()).toEqual(['account_holder', 'account_number', 'bank_id']);
    expect(await walletOf(s.driverId)).toMatchObject({ balance_vnd: '0', held_vnd: '0', version: '1' });
    // Query parameters other than the documented ones, and a body on a GET, are refused.
    expect((await get(s.token, '/topup-requests?driver_id=x')).status).toBe(400);
    expect((await get(s.token, '/topup-receiving-accounts?x=1')).status).toBe(400);
  });

  it('3. the minimum comes from the database parameter at creation time: below is refused with nothing written, a later change does not touch an earlier request', async () => {
    const s = await newShipper();
    await setMin(100_000);
    const below = await create(s.token, { amount_vnd: 99_999 });
    expect([below.status, errorCode(below)]).toEqual([400, 'TOPUP_AMOUNT_BELOW_MINIMUM']);
    expect(await requestRows(s.driverId)).toBe(0);
    expect(await walletOf(s.driverId)).toMatchObject({ balance_vnd: '0', held_vnd: '0', version: '1' }); // the zero wallet was rolled back with the refusal
    await setMin(50_000);
    const accepted = await create(s.token, { amount_vnd: 60_000 });
    expect(accepted.status).toBe(201);
    await setMin(200_000);
    expect(errorCode(await create(s.token, { amount_vnd: 150_000 }))).toBe('TOPUP_AMOUNT_BELOW_MINIMUM');
    expect(dataOf(await get(s.token, `/topup-requests/${String(dataOf(accepted).request_id)}`))).toMatchObject({ amount_requested_vnd: 60_000, state: 'PENDING' });
    await setMin(originalMin);
    await expectNoMoney(s.driverId);
  });

  it('4. strict input: amount must be a safe integer >= 1, no extra field (no driver, wallet, user or state), an Idempotency-Key is required', async () => {
    const s = await newShipper();
    const bad: unknown[] = [{}, { amount_vnd: 0 }, { amount_vnd: -1000 }, { amount_vnd: 1000.5 }, { amount_vnd: '100000' }, { amount_vnd: 9_007_199_254_740_992 }, { amount_vnd: null },
      { amount_vnd: 100_000, driver_id: s.driverId }, { amount_vnd: 100_000, wallet_id: randomUUID() }, { amount_vnd: 100_000, user_id: s.userId }, { amount_vnd: 100_000, state: 'CONFIRMED' }, []];
    for (const body of bad) {
      expect([JSON.stringify(body), (await create(s.token, body)).status]).toEqual([JSON.stringify(body), 400]);
    }
    expect(errorCode(await create(s.token, { amount_vnd: 100_000 }, null))).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(await requestRows(s.driverId)).toBe(0);
    expect(await walletOf(s.driverId)).toMatchObject({ balance_vnd: '0', held_vnd: '0', version: '1' });
  });

  it('5. without a receiving account nothing is created and no address is shown; the lists stay readable', async () => {
    const s = await newShipper();
    await setReceiving(false);
    try {
      const refused = await create(s.token, { amount_vnd: 100_000 });
      expect([refused.status, errorCode(refused)]).toEqual([409, 'TOPUP_RECEIVING_ACCOUNT_NOT_CONFIGURED']);
      expect(await requestRows(s.driverId)).toBe(0);
      expect(await walletOf(s.driverId)).toMatchObject({ balance_vnd: '0', held_vnd: '0', version: '1' });
      const accounts = dataOf(await get(s.token, '/topup-receiving-accounts')).accounts as Array<Record<string, unknown>>;
      expect(accounts.filter((account) => account.account_holder === 'CONG TY TEST 11SHIP')).toEqual([]);
      expect(dataOf(await get(s.token, '/topup-requests'))).toEqual({ items: [], next_cursor: null });
    } finally {
      await setReceiving(true);
    }
  });

  it('6. only the Shipper hat of the 11Ship app: FOOD, a customer without a Shipper profile, a CLOSED Shipper, a disabled account, a revoked session and no token are all refused, nothing is written', async () => {
    const s = await newShipper();
    const foodToken = await loginAs(s.phone, WEB_FOOD);
    const foodCreate = await create(foodToken, { amount_vnd: 100_000 });
    expect([foodCreate.status, errorCode(foodCreate)]).toEqual([403, 'ROLE_NOT_AVAILABLE']);
    expect((await get(foodToken, '/topup-requests')).status).toBe(403);
    expect((await get(foodToken, '/topup-receiving-accounts')).status).toBe(403);

    const customer = await newShipper({ driver: false });
    const asCustomer = await create(customer.token, { amount_vnd: 100_000 });
    expect(asCustomer.status).toBe(403);
    expect((await get(customer.token, '/topup-requests')).status).toBe(403);

    expect((await create(undefined, { amount_vnd: 100_000 })).status).toBe(401);
    expect((await get(undefined, '/topup-requests')).status).toBe(401);

    const closed = await newShipper();
    await pool.query(`UPDATE app.drivers SET status = 'CLOSED', version = version + 1, updated_at = now() WHERE driver_id = $1::uuid`, [closed.driverId]);
    expect(errorCode(await create(closed.token, { amount_vnd: 100_000 }))).toBe('DRIVER_STATE_CONFLICT');
    expect(errorCode(await get(closed.token, '/topup-requests'))).toBe('DRIVER_STATE_CONFLICT');

    const disabled = await newShipper();
    await pool.query(`UPDATE app.users SET status = 'DISABLED', version = version + 1, updated_at = now() WHERE user_id = $1::uuid`, [disabled.userId]);
    expect(errorCode(await create(disabled.token, { amount_vnd: 100_000 }))).toBe('ACCOUNT_DISABLED');
    expect((await get(disabled.token, '/topup-requests')).status).toBe(403);

    const revoked = await newShipper();
    await pool.query(`UPDATE app.sessions SET revoked_at = now() WHERE user_id = $1::uuid`, [revoked.userId]);
    expect(errorCode(await create(revoked.token, { amount_vnd: 100_000 }))).toBe('SESSION_REVOKED');

    const roleless = await newShipper();
    await pool.query(`DELETE FROM app.user_roles WHERE user_id = $1::uuid AND role = 'DRIVER'`, [roleless.userId]);
    const afterRevoke = await create(roleless.token, { amount_vnd: 100_000 });
    expect(afterRevoke.status).toBeGreaterThanOrEqual(400);

    for (const driverId of [s.driverId, closed.driverId, disabled.driverId, revoked.driverId, roleless.driverId]) {
      expect([driverId, await requestRows(driverId)]).toEqual([driverId, 0]);
    }
    expect(await walletOf(s.driverId)).toMatchObject({ balance_vnd: '0', held_vnd: '0', version: '1' });
  });

  it('7. ownership: another Shipper cannot read or cancel a request, and an unknown or malformed id reads the same as another\'s', async () => {
    const owner = await newShipper();
    const other = await newShipper();
    const created = await create(owner.token, { amount_vnd: 100_000 });
    const id = String(dataOf(created).request_id);
    for (const response of [await get(other.token, `/topup-requests/${id}`), await get(other.token, `/topup-requests/${randomUUID()}`), await get(other.token, '/topup-requests/not-a-uuid')]) {
      expect([response.status, errorCode(response)]).toEqual([404, 'TOPUP_REQUEST_NOT_FOUND']);
    }
    const stolen = await cancel(other.token, id, { expected_version: 1 });
    expect([stolen.status, errorCode(stolen)]).toEqual([404, 'TOPUP_REQUEST_NOT_FOUND']);
    expect(dataOf(await get(owner.token, `/topup-requests/${id}`))).toMatchObject({ state: 'PENDING', version: 1 });
    const otherList = dataOf(await get(other.token, '/topup-requests')) as { items: unknown[] };
    expect(otherList.items).toEqual([]);
    expect(await requestRows(other.driverId)).toBe(0);
  });

  it('8. cancel: PENDING -> CANCELLED with both resolution fields, version +1, the row kept; a replay does nothing more; a second cancel, a wrong version and a REJECTED request are refused', async () => {
    const s = await newShipper();
    const id = String(dataOf(await create(s.token, { amount_vnd: 100_000 })).request_id);
    // A wrong version is refused and leaves the request PENDING.
    const wrong = await cancel(s.token, id, { expected_version: 7 });
    expect([wrong.status, errorCode(wrong)]).toEqual([409, 'VERSION_CONFLICT']);
    expect((await cancel(s.token, id, { expected_version: 1, state: 'CONFIRMED' })).status).toBe(400);
    expect((await cancel(s.token, id, {})).status).toBe(400);

    const key = randomUUID();
    const done = await cancel(s.token, id, { expected_version: 1 }, key);
    expect(done.status).toBe(200);
    expect(dataOf(done)).toMatchObject({ request_id: id, state: 'CANCELLED', version: 2 });
    expect(dataOf(done).resolved_at).not.toBeNull();
    const row = (await pool.query('SELECT state, version::text, resolved_by_user_id::text, resolved_at IS NOT NULL AS has_time FROM app.wallet_topup_requests WHERE request_id = $1::uuid', [id])).rows[0];
    expect(row).toMatchObject({ state: 'CANCELLED', version: '2', resolved_by_user_id: s.userId, has_time: true });
    expect(await requestRows(s.driverId)).toBe(1);
    // Same key replays; a new key on the closed request is a state conflict, never a second cancel.
    const replay = await cancel(s.token, id, { expected_version: 1 }, key);
    expect(replay.status).toBe(200);
    expect(dataOf(replay).version).toBe(2);
    const again = await cancel(s.token, id, { expected_version: 2 });
    expect([again.status, errorCode(again)]).toEqual([409, 'TOPUP_REQUEST_STATE_CONFLICT']);
    expect(await auditCount(id, 'wallet.topup_request.cancel.v1')).toBe(1);
    expect(await outboxOf(id)).toEqual([{ request_id: id, state: 'PENDING', version: 1 }, { request_id: id, state: 'CANCELLED', version: 2 }]);
    // A request an administrator rejected (B2.2 will do it; here directly in the database) cannot be cancelled either.
    const rejectedId = String(dataOf(await create(s.token, { amount_vnd: 100_000 })).request_id);
    await pool.query(`UPDATE app.wallet_topup_requests SET state = 'REJECTED', resolved_by_user_id = created_by_user_id, resolved_at = now(), updated_at = now(), version = version + 1 WHERE request_id = $1::uuid`, [rejectedId]);
    const afterReject = await cancel(s.token, rejectedId, { expected_version: 2 });
    expect([afterReject.status, errorCode(afterReject)]).toEqual([409, 'TOPUP_REQUEST_STATE_CONFLICT']);
    // The list shows both, newest first, and the status filter and the page limit work.
    const all = dataOf(await get(s.token, '/topup-requests')) as { items: Array<{ request_id: string; state: string }>; next_cursor: string | null };
    expect(all.items.map((item) => item.state)).toEqual(['REJECTED', 'CANCELLED']);
    const firstPage = dataOf(await get(s.token, '/topup-requests?limit=1')) as { items: Array<{ request_id: string }>; next_cursor: string | null };
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.next_cursor).not.toBeNull();
    const secondPage = dataOf(await get(s.token, `/topup-requests?limit=1&cursor=${String(firstPage.next_cursor)}`)) as { items: Array<{ request_id: string }>; next_cursor: string | null };
    expect(secondPage.items.map((item) => item.request_id)).toEqual([id]);
    expect(secondPage.next_cursor).toBeNull();
    expect((dataOf(await get(s.token, '/topup-requests?status=CANCELLED')) as { items: unknown[] }).items).toHaveLength(1);
    expect((await get(s.token, '/topup-requests?status=LOST')).status).toBe(400);
    expect((await get(s.token, '/topup-requests?limit=500')).status).toBe(400);
    await expectNoMoney(s.driverId);
  });

  it('9. races decided by the database: the same key twice makes ONE request, two cancels make ONE cancellation', async () => {
    const s = await newShipper();
    const user = await holdRowLock(pool, 'SELECT 1 FROM app.users WHERE user_id = $1::uuid FOR UPDATE', [s.userId]);
    let released = false;
    const key = randomUUID();
    try {
      const first = create(s.token, { amount_vnd: 100_000 }, key);
      const second = create(s.token, { amount_vnd: 100_000 }, key);
      await eventually(async () => (await lockWaiters()) >= 2, 'two creations blocked behind the held user row');
      await user.release();
      released = true;
      const results = await Promise.all([first, second]);
      expect(results.map((result) => result.status).sort()).toEqual(expect.arrayContaining([201]));
      for (const result of results) {
        expect([201, 409]).toContain(result.status); // a replay answers 201; an overlapping twin may be told to retry (IDEMPOTENCY_BUSY)
      }
      expect(await requestRows(s.driverId)).toBe(1);
    } finally {
      if (!released) {
        await user.release();
      }
    }
    const id = (await pool.query<{ request_id: string }>('SELECT request_id::text FROM app.wallet_topup_requests WHERE driver_id = $1::uuid', [s.driverId])).rows[0]?.request_id as string;
    const held = await holdRowLock(pool, 'SELECT 1 FROM app.users WHERE user_id = $1::uuid FOR UPDATE', [s.userId]);
    let freed = false;
    try {
      const a = cancel(s.token, id, { expected_version: 1 });
      const b = cancel(s.token, id, { expected_version: 1 });
      await eventually(async () => (await lockWaiters()) >= 2, 'two cancels blocked behind the held user row');
      await held.release();
      freed = true;
      const results = await Promise.all([a, b]);
      expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
      expect(errorCode(results.find((result) => result.status === 409) as ApiResponse)).toBe('TOPUP_REQUEST_STATE_CONFLICT');
    } finally {
      if (!freed) {
        await held.release();
      }
    }
    expect(await auditCount(id, 'wallet.topup_request.cancel.v1')).toBe(1);
    expect(dataOf(await get(s.token, `/topup-requests/${id}`))).toMatchObject({ state: 'CANCELLED', version: 2 });
    await expectNoMoney(s.driverId);
  });

  it('10. money stays closed: the database refuses any credit, topup or bank record, and no route confirms, rejects or reaches an Admin function', async () => {
    const s = await newShipper();
    const id = String(dataOf(await create(s.token, { amount_vnd: 100_000 })).request_id);
    const wallet = (await walletOf(s.driverId)) as Record<string, string>;
    // The A1 ledger gate is untouched: a credit is refused.
    await expect(
      pool.query(
        `INSERT INTO app.wallet_ledger_entries (entry_id, wallet_id, sequence_no, entry_kind, delta_vnd, balance_after_vnd, created_at, topup_id)
         VALUES ($1::uuid, $2::uuid, 1, 'TOPUP', 100000, 100000, now(), $3::uuid)`,
        [randomUUID(), wallet.wallet_id, randomUUID()],
      ),
    ).rejects.toThrow('WALLET_LEDGER_SOURCE_NOT_AVAILABLE');
    // A request cannot be CONFIRMED without a topup (committed state is checked at COMMIT).
    await expect(pool.query(`UPDATE app.wallet_topup_requests SET state = 'CONFIRMED', resolved_by_user_id = created_by_user_id, resolved_at = now(), updated_at = now(), version = version + 1 WHERE request_id = $1::uuid`, [id])).rejects.toThrow();
    expect(dataOf(await get(s.token, `/topup-requests/${id}`))).toMatchObject({ state: 'PENDING', version: 1 });
    // There is no confirm / reject / admin route on this surface.
    for (const [method, path] of [['POST', `${BASE}/topup-requests/${id}/confirm`], ['POST', `${BASE}/topup-requests/${id}/reject`], ['PUT', `${BASE}/topup-requests/${id}`], ['DELETE', `${BASE}/topup-requests/${id}`], ['PATCH', `${BASE}/topup-requests/${id}`]] as const) {
      const response = await app.call(method, path, { bearer: s.token, headers: { 'idempotency-key': randomUUID() }, body: { expected_version: 1 } });
      expect([method, path, response.status]).toEqual([method, path, 404]);
    }
    await expectNoMoney(s.driverId);
  });
});
