import { AccountActivityRegistry } from '../../apps/backend/src/account-lifecycle/account-activity-registry';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ADMIN_SESSION_COOKIE } from '../../apps/backend/src/admin-auth/admin-auth-constants';
import { ADMIN_PASSWORD, AdminApp, adminData, adminErrorCode, AdminResponse, cookieFrom, loginStep, preauthCookies, rewindAcceptedStep, sessionCookies, startAdminApp, totpNow } from './support/admin-fixtures';
import { begin, ok, post } from './support/activation-fixtures';
import { ApiResponse, AuthApp, countRows, dataOf, errorCode, obtainProof, PASSWORD, Phone, randomPhone, startAuthApp } from './support/auth-fixtures';
import { createInvitation, createPayload, systemSession, SystemSession } from './support/provisioning-fixtures';

// M04-C on REAL Nest pipelines (the 11Ship client API and the administration API) and PostgreSQL: the Shipper asks for a withdrawal, an administrator claims it,
// makes the transfer BY HAND and records it, or reports an unknown outcome for reconciliation. Money moves only in the PAID transaction, exactly once; everything
// else only sets money aside (hold) or gives it back. Funding goes through the REAL top-up path (request -> administrator confirms), never a fixture ledger row.

const TERMS = 'test-terms-20261011-v1';
const PRIVACY = 'test-privacy-20261011-v1';
const WEB_SHIP = { device_id: 'web-ship-0001', platform: 'WEB', app: 'SHIP' };
const WEB_FOOD = { device_id: 'web-food-0001', platform: 'WEB', app: 'FOOD' };
const tag = randomBytes(3).toString('hex').toUpperCase();
const READ = 'wallet.read';
const RECORD = 'wallet.topup.record';
const PROCESS = 'wallet.withdrawal.process';
const CONFIRM = 'wallet.withdrawal.confirm';
const RECONCILE = 'wallet.withdrawal.reconcile';
const BASE = '/driver/wallet';
const HOLDER = `NGUYEN VAN RUT ${tag}`;

interface Login {
  readonly cookie: string;
  readonly csrf: string;
}
interface ActivatedAdmin {
  readonly phone: Phone;
  readonly userId: string;
  readonly secret: string;
}
interface Shipper {
  readonly phone: Phone;
  readonly userId: string;
  readonly token: string;
  readonly driverId: string;
  walletId: string;
  readonly number: string;
}

describe('M04-C — withdrawals: Shipper request, administrator transfer by hand, reconciliation', () => {
  let client: AuthApp;
  let admin: AdminApp;
  let system: SystemSession;
  let account: { id: string; number: string };
  const accountIds: string[] = [];
  const admins: Record<string, { who: ActivatedAdmin; login: Login }> = {};

  beforeAll(async () => {
    client = await startAuthApp({}, { relaxTimeouts: true, configOverride: { clientAuth: { termsVersion: TERMS, privacyVersion: PRIVACY } } });
    admin = await startAdminApp({ activationDisabledTest: true });
    system = await systemSession(admin);
    const specs: Array<[string, string[]]> = [
      ['bare', []],
      ['reader', [READ]],
      ['recorder', [READ, RECORD]],
      ['processor', [READ, PROCESS, CONFIRM]],
      ['processor2', [READ, PROCESS, CONFIRM]],
      ['confirmerOnly', [READ, CONFIRM]],
      ['reconciler', [READ, RECONCILE]],
    ];
    for (const [name, rights] of specs) {
      const who = await activatedAdmin(`Admin ${name} ${tag}`);
      admins[name] = { who, login: await login(who) };
      for (const right of rights) {
        expect((await changeGrant('grant', who.userId, right, 0)).status).toBe(200);
      }
    }
    account = await newAccount(true);
  });

  afterAll(async () => {
    try {
      try {
        await client.close(); // purges the Shippers: withdrawals, events, holds, ledger, topups, bank records, wallets
      } catch (error) {
        console.error('client close failed', error);
      }
      const pool = admin.pool;
      const conn = await pool.connect();
      try {
        await conn.query('BEGIN');
        await conn.query('ALTER TABLE app.admin_finance_grants DISABLE TRIGGER admin_finance_grants_no_delete');
        await conn.query('DELETE FROM app.admin_finance_grants');
        await conn.query('ALTER TABLE app.admin_finance_grants ENABLE TRIGGER admin_finance_grants_no_delete');
        await conn.query('ALTER TABLE app.system_owned_bank_accounts DISABLE TRIGGER wallet_system_accounts_no_delete');
        await conn.query('DELETE FROM app.system_owned_bank_accounts WHERE system_account_id = ANY($1::uuid[])', [accountIds]);
        await conn.query('ALTER TABLE app.system_owned_bank_accounts ENABLE TRIGGER wallet_system_accounts_no_delete');
        await conn.query('COMMIT');
      } catch (error) {
        await conn.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        conn.release();
      }
    } finally {
      await admin.close();
    }
  });

  // ------------------------------------------------------------------------------------------------ helpers (administration)
  async function activatedAdmin(fullName: string): Promise<ActivatedAdmin> {
    const phone = randomPhone();
    admin.track(phone.normalized);
    const invitation = await createInvitation(admin, system, createPayload(phone.local, { full_name: fullName, permissions: [{ app: 'DRIVER', can_view: true, can_review_profile: false, can_lock: false }] }));
    const token = invitation.link.split('#t=')[1] as string;
    const session = await begin(admin, { invitationId: invitation.invitationId, token, phone });
    ok(await post(admin, '/password', session, { password: ADMIN_PASSWORD }));
    const secret = String(adminData(ok(await post(admin, '/totp/enrollment', session))).secret);
    ok(await post(admin, '/complete', session, { code: totpNow(secret) }));
    const found = await admin.pool.query<{ user_id: string }>('SELECT user_id FROM app.users WHERE phone_normalized = $1', [phone.normalized]);
    return { phone, userId: (found.rows[0] as { user_id: string }).user_id, secret };
  }

  async function login(who: ActivatedAdmin): Promise<Login> {
    const preauth = await loginStep(admin, { phone: who.phone, password: ADMIN_PASSWORD, userId: who.userId });
    await rewindAcceptedStep(admin, who.userId);
    const verified = await admin.call('POST', '/totp/verify', { body: { code: totpNow(who.secret) }, cookies: preauthCookies(preauth), csrf: preauth.csrf });
    if (verified.status !== 200) {
      throw new Error(`admin login failed: ${verified.status} ${verified.text}`);
    }
    return { cookie: String(cookieFrom(verified, ADMIN_SESSION_COOKIE)), csrf: String(adminData(verified).csrf_token) };
  }

  const as = (name: string): Login => (admins[name] as { login: Login }).login;
  const systemLogin = (): Login => ({ cookie: system.login.cookie, csrf: system.login.csrf });
  const code = (response: AdminResponse): { status: number; code: string | undefined } => ({ status: response.status, code: adminErrorCode(response) });
  const getAdmin = (who: Login | undefined, path: string): Promise<AdminResponse> => admin.call('GET', path, { basePath: '/v1/admin', ...(who === undefined ? {} : { cookies: sessionCookies(who) }) });

  async function send(who: Login, path: string, body: unknown, key: string = randomUUID()): Promise<AdminResponse> {
    await admin.clearLimits();
    return admin.call('POST', path, { basePath: '/v1/admin', body, cookies: sessionCookies(who), csrf: who.csrf, headers: { 'idempotency-key': key } });
  }
  const changeGrant = (command: 'grant' | 'revoke', target: string, key: string, version: number): Promise<AdminResponse> =>
    send(systemLogin(), `/finance/access/admins/${target}/${command}`, { permission_key: key, expected_version: version });

  async function newAccount(receiving: boolean): Promise<{ id: string; number: string }> {
    const number = String(Math.floor(1e11 + Math.random() * 9e11));
    const created = await send(systemLogin(), '/finance/bank-accounts', { bank_id: 'VCB', account_number: number, account_holder: `CONG TY 11SHIP ${tag}` });
    expect(created.status).toBe(201);
    const id = String(adminData(created).account_id);
    accountIds.push(id);
    if (receiving) {
      expect((await send(systemLogin(), `/finance/bank-accounts/${id}/receiving`, { expected_version: 1, can_receive: true })).status).toBe(200);
    }
    return { id, number };
  }

  // ------------------------------------------------------------------------------------------------ helpers (Shipper)
  async function loginAs(phone: Phone, device: Record<string, string>): Promise<string> {
    const response = await client.call('POST', '/client-auth/login', { headers: { 'idempotency-key': randomUUID() }, body: { phone: phone.local, password: PASSWORD, device } });
    expect(response.status).toBe(200);
    return String(dataOf(response).access_token);
  }

  /** A real Shipper (registered through the client API, onboarded as a driver) with a VERIFIED bank account and `fund` VND of CONFIRMED top-up money. */
  async function newShipper(fund: number, options: { verified?: boolean } = {}): Promise<Shipper> {
    const phone = randomPhone();
    const proof = await obtainProof(client, phone);
    const name = `Nguyễn Văn Rút ${tag}`;
    const registered = await client.call('POST', '/client-auth/register', {
      headers: { 'idempotency-key': randomUUID() },
      body: { phone: phone.local, password: PASSWORD, verification_token: proof.proofToken, device: { ...WEB_FOOD }, full_name: name, consent: { terms_version: TERMS, privacy_version: PRIVACY } },
    });
    expect(registered.status).toBe(201);
    const userId = String(dataOf(registered).user_id);
    let token = await loginAs(phone, WEB_SHIP);
    const created = await client.call('POST', '/onboarding/driver', { bearer: token, headers: { 'idempotency-key': randomUUID() }, body: { full_name: name, plate_number: '59X1-123.45' } });
    expect(created.status).toBe(201);
    const driverId = String(dataOf(created).driver_id);
    token = await loginAs(phone, WEB_SHIP);
    const number = `0${Math.floor(1e9 + Math.random() * 9e9)}`;
    await client.pool.query(
      `INSERT INTO app.driver_bank_accounts (driver_id, bank_code, bank_name, account_number, account_holder, verification_state, verified_by, verified_at, created_at, updated_at)
       VALUES ($1::uuid, 'VCB', 'Vietcombank', $2, $3, $4, $5, $6, clock_timestamp(), clock_timestamp())`,
      [driverId, number, HOLDER, options.verified === false ? 'UNVERIFIED' : 'VERIFIED', options.verified === false ? null : userId, options.verified === false ? null : new Date().toISOString()],
    );
    const shipper: Shipper = { phone, userId, token, driverId, walletId: '', number };
    if (fund > 0) {
      const requested = await client.call('POST', `${BASE}/topup-requests`, { bearer: token, headers: { 'idempotency-key': randomUUID() }, body: { amount_vnd: Math.max(fund, 100_000) } });
      expect(requested.status).toBe(201);
      const confirmed = await send(as('recorder'), `/finance/topup-requests/${String(dataOf(requested).request_id)}/confirm`, {
        expected_version: 1,
        actual_amount_vnd: fund, // the ACTUAL money received, which may be less than the 100.000 asked for
        bank_id: 'VCB',
        system_owned_account_id: account.id,
        canonical_transaction_id: `IN${Math.floor(1e11 + Math.random() * 9e11)}`,
        received_at: new Date(Date.now() - 60_000).toISOString(),
      });
      expect(confirmed.status).toBe(200);
    }
    shipper.walletId = (await client.pool.query<{ wallet_id: string }>('SELECT wallet_id::text FROM app.driver_wallets WHERE driver_id = $1::uuid', [driverId])).rows[0]?.wallet_id ?? '';
    return shipper;
  }

  const gc = (token: string | undefined, path: string): Promise<ApiResponse> => client.call('GET', `${BASE}${path}`, token === undefined ? {} : { bearer: token });
  const withdraw = (s: Shipper, body: unknown, key: string | null = randomUUID()): Promise<ApiResponse> =>
    client.call('POST', `${BASE}/withdrawals`, { bearer: s.token, ...(key === null ? {} : { headers: { 'idempotency-key': key } }), body });
  const cancel = (s: Shipper, id: string, body: unknown, key: string = randomUUID()): Promise<ApiResponse> =>
    client.call('POST', `${BASE}/withdrawals/${id}/cancel`, { bearer: s.token, headers: { 'idempotency-key': key }, body });

  const wallet = async (s: Shipper): Promise<{ balance: string; held: string }> => {
    const row = (await client.pool.query<{ balance_vnd: string; held_vnd: string }>('SELECT balance_vnd::text, held_vnd::text FROM app.driver_wallets WHERE driver_id = $1::uuid', [s.driverId])).rows[0];
    return { balance: row?.balance_vnd ?? 'none', held: row?.held_vnd ?? 'none' };
  };
  const debits = (walletId: string): Promise<number> => countRows(client.pool, `SELECT 1 FROM app.wallet_ledger_entries WHERE wallet_id = $1::uuid AND entry_kind = 'WITHDRAWAL_DEBIT'`, [walletId]);
  const holdOf = async (withdrawalId: string): Promise<{ status: string; amount: string } | undefined> =>
    (await client.pool.query<{ status: string; amount: string }>('SELECT status, amount_vnd::text AS amount FROM app.wallet_holds WHERE withdrawal_id = $1::uuid', [withdrawalId])).rows[0];
  const stateOf = async (id: string): Promise<{ state: string; version: string }> =>
    (await client.pool.query<{ state: string; version: string }>('SELECT state, version::text FROM app.wallet_withdrawals WHERE withdrawal_id = $1::uuid', [id])).rows[0] as { state: string; version: string };
  const txid = (): string => `OUT${Math.floor(1e11 + Math.random() * 9e11)}`;

  async function request(s: Shipper, amount: number): Promise<string> {
    const response = await withdraw(s, { amount_vnd: amount });
    expect(response.status).toBe(201);
    return String(dataOf(response).withdrawal_id);
  }
  const evidence = (id: string, over: Record<string, unknown> = {}, amount = 50_000): Record<string, unknown> => ({
    actual_amount_vnd: amount,
    bank_id: 'VCB',
    system_owned_account_id: account.id,
    canonical_transaction_id: txid(),
    paid_at: new Date(Date.now() - 30_000).toISOString(),
    ...over,
    ...(id === '' ? {} : {}),
  });
  const start = (who: string, id: string, version = 1, key?: string): Promise<AdminResponse> => send(as(who), `/finance/withdrawals/${id}/start-processing`, { expected_version: version }, key);
  const paid = (who: string, id: string, body: Record<string, unknown>, version = 2, key?: string): Promise<AdminResponse> =>
    send(as(who), `/finance/withdrawals/${id}/mark-paid`, { expected_version: version, destination_checked: true, ...body }, key);
  const report = (who: string, id: string, reason: string, version = 2, evidenceBody?: Record<string, unknown>): Promise<AdminResponse> =>
    send(as(who), `/finance/withdrawals/${id}/report-reconciliation`, { expected_version: version, reason_code: reason, ...(evidenceBody === undefined ? {} : { evidence: evidenceBody }) });
  const reconcile = (who: string, id: string, body: Record<string, unknown>, version = 3, key?: string): Promise<AdminResponse> =>
    send(as(who), `/finance/withdrawals/${id}/reconcile`, { expected_version: version, ...body }, key);


  const selfCommand = async (s: Shipper, path: string, extra: Record<string, unknown> = {}) => {
    const profile = dataOf(await client.call('GET', '/driver/me', { bearer: s.token }));
    return client.call('POST', `/driver/me/${path}`, { bearer: s.token, headers: { 'idempotency-key': randomUUID() }, body: { expected_version: profile.version, ...extra } });
  };

  it('M03: SHIP registration provisions an ACTIVE driver and zero wallet without bank or approval, and retries create neither twice', async () => {
    const phone = randomPhone();
    const proof = await obtainProof(client, phone);
    const key = randomUUID();
    const body = { phone: phone.local, password: PASSWORD, verification_token: proof.proofToken, device: { ...WEB_SHIP, platform: 'ANDROID' }, full_name: 'Nguyễn Văn Mới', consent: { terms_version: TERMS, privacy_version: PRIVACY } };
    const registered = await client.call('POST', '/client-auth/register', { headers: { 'idempotency-key': key }, body });
    expect(registered.status).toBe(201);
    const data = dataOf(registered);
    expect(data).toMatchObject({ active_role: 'DRIVER', onboarding_required: false });
    const token = String(data.access_token);
    const profile = dataOf(await client.call('GET', '/driver/me', { bearer: token }));
    expect(profile).toMatchObject({ status: 'ACTIVE', bank: null, accepting_deliveries: false, readiness: { can_accept: false } });
    expect(dataOf(await gc(token, ''))).toMatchObject({ wallet: { provisioned: true, balance_vnd: 0 } });
    const replay = await client.call('POST', '/client-auth/register', { headers: { 'idempotency-key': key }, body });
    expect(replay.status).toBe(201);
    expect(dataOf(replay).user_id).toBe(data.user_id);
    expect(await countRows(client.pool, 'SELECT 1 FROM app.drivers WHERE user_id = $1::uuid', [data.user_id])).toBe(1);
    expect(errorCode(await client.call('POST', '/driver/me/accepting', { bearer: token, headers: { 'idempotency-key': randomUUID() }, body: { expected_version: profile.version, accepting: true } }))).toBe('DRIVER_WALLET_NOT_READY');
  });

  it('Android PASSWORD wallet withdrawal holds once and never debits before manual confirmation', async () => {
    const old = await newShipper(100_000);
    const s = { ...old, token: await loginAs(old.phone, { ...WEB_SHIP, platform: 'ANDROID' }) };
    const key = randomUUID();
    const first = await withdraw(s, { amount_vnd: 50_000 }, key);
    expect(first.status).toBe(201);
    const repeated = await withdraw(s, { amount_vnd: 50_000 }, key);
    expect(dataOf(repeated).withdrawal_id).toBe(dataOf(first).withdrawal_id);
    expect(await wallet(s)).toEqual({ balance: '100000', held: '50000' });
    expect(await debits(s.walletId)).toBe(0);
  });

  it('M03: confirmed funding enables activity without a bank; pending topup credits nothing; Admin suspension blocks activity', async () => {
    const s = await newShipper(100_000);
    await client.pool.query('DELETE FROM app.driver_bank_accounts WHERE driver_id = $1::uuid', [s.driverId]);
    expect((await selfCommand(s, 'accepting', { accepting: true })).status).toBe(200);
    const topup = await client.call('POST', `${BASE}/topup-requests`, { bearer: s.token, headers: { 'idempotency-key': randomUUID() }, body: { amount_vnd: 100_000 } });
    expect(topup.status).toBe(201);
    expect(await wallet(s)).toEqual({ balance: '100000', held: '0' });
    const profile = dataOf(await client.call('GET', '/driver/me', { bearer: s.token }));
    expect((await send(systemLogin(), `/shippers/${s.driverId}/lock`, { expected_version: profile.version, reason: 'M03 test lock' })).status).toBe(200);
    expect(errorCode(await selfCommand(s, 'accepting', { accepting: true }))).toBe('DRIVER_NOT_ACTIVE');
  });

  it('M03: active delivery work blocks refund, while closure request immediately stops new orders', async () => {
    const s = await newShipper(100_000);
    const activity = client.running.app.get(AccountActivityRegistry);
    activity.register({ name: 'M03_ACTIVE_WORK_TEST', activeWork: async (_context, userId) => userId === s.userId ? 1 : 0 });
    try {
      expect((await selfCommand(s, 'closure-request', { note: null })).status).toBe(200);
      expect(errorCode(await withdraw(s, { amount_vnd: 100_000 }))).toBe('DRIVER_HAS_ACTIVE_WORK');
      expect(await wallet(s)).toEqual({ balance: '100000', held: '0' });
      expect(errorCode(await selfCommand(s, 'accepting', { accepting: true }))).toBe('DRIVER_NOT_ACTIVE');
    } finally {
      activity.unregister('M03_ACTIVE_WORK_TEST');
    }
  });

  it('M03: closing returns all 5.000 VND below the ordinary minimum, holds once, and cannot close before payment', async () => {
    const s = await newShipper(5_000);
    expect((await selfCommand(s, 'closure-request', { note: 'Rút toàn bộ' })).status).toBe(200);
    const key = randomUUID();
    const first = await withdraw(s, { amount_vnd: 5_000 }, key);
    expect(first.status).toBe(201);
    const id = String(dataOf(first).withdrawal_id);
    const replay = await withdraw(s, { amount_vnd: 5_000 }, key);
    expect(dataOf(replay).withdrawal_id).toBe(id);
    expect(await wallet(s)).toEqual({ balance: '5000', held: '5000' });
    expect((await withdraw(s, { amount_vnd: 5_000 })).status).toBe(409);
    expect(errorCode(await selfCommand(s, 'closure-cancel'))).toBe('DRIVER_WALLET_NOT_SETTLED');
    const profile = dataOf(await client.call('GET', '/driver/me', { bearer: s.token }));
    expect(adminErrorCode(await send(systemLogin(), `/shippers/${s.driverId}/closure/finalize`, { expected_version: profile.version }))).toBe('DRIVER_WALLET_NOT_SETTLED');
    expect((await start('processor', id)).status).toBe(200);
    const paidKey = randomUUID();
    const paidBody = evidence(id, {}, 5_000);
    expect((await paid('processor', id, paidBody, 2, paidKey)).status).toBe(200);
    expect((await paid('processor', id, paidBody, 2, paidKey)).status).toBe(200);
    expect(await debits(s.walletId)).toBe(1);
    expect(await wallet(s)).toEqual({ balance: '0', held: '0' });
    expect((await send(systemLogin(), `/shippers/${s.driverId}/closure/finalize`, { expected_version: profile.version })).status).toBe(200);
    expect(await countRows(client.pool, "SELECT 1 FROM app.user_roles WHERE user_id = $1::uuid AND role = 'CUSTOMER'", [s.userId])).toBe(1);
  });

  // ------------------------------------------------------------------------------------------------ tests
  it('1. the Shipper wallet is read-only and private: the summary adds no wallet, shows B / H / A, and another Shipper reads as not found', async () => {
    const poor = await newShipper(0);
    const before = await countRows(client.pool, 'SELECT 1 FROM app.driver_wallets WHERE driver_id = $1::uuid', [poor.driverId]);
    const summary = await gc(poor.token, '');
    expect(summary.status).toBe(200);
    expect(dataOf(summary)).toMatchObject({ wallet: { provisioned: true, balance_vnd: 0, held_vnd: 0, available_vnd: 0 }, limits: { withdraw_min_vnd: 10_000 }, commission_vnd: 1000 });
    expect(await countRows(client.pool, 'SELECT 1 FROM app.driver_wallets WHERE driver_id = $1::uuid', [poor.driverId])).toBe(before);
    expect((await gc(poor.token, '/transactions')).status).toBe(200);
    expect(dataOf(await gc(poor.token, '/transactions')).items).toEqual([]);
    expect((await gc(undefined, '')).status).toBe(401);
    expect((await gc(poor.token, '?driver_id=x')).status).toBe(400);

    const rich = await newShipper(150_000);
    expect(dataOf(await gc(rich.token, ''))).toMatchObject({ wallet: { provisioned: true, balance_vnd: 150_000, held_vnd: 0, available_vnd: 150_000 } });
    const history = dataOf(await gc(rich.token, '/transactions')).items as Array<Record<string, unknown>>;
    expect(history[0]).toMatchObject({ type: 'topup', amount_vnd: 150_000, status: 'success' });
    const id = await request(rich, 20_000);
    expect(dataOf(await gc(rich.token, '')).wallet).toMatchObject({ balance_vnd: 150_000, held_vnd: 20_000, available_vnd: 130_000 });
    expect(dataOf(await gc(rich.token, '/holds')).items).toHaveLength(1);
    const other = await newShipper(0);
    expect(errorCode(await gc(other.token, `/withdrawals/${id}`))).toBe('WITHDRAWAL_NOT_FOUND');
    expect(errorCode(await cancel(other, id, { expected_version: 1 }))).toBe('WITHDRAWAL_NOT_FOUND');
    expect(errorCode(await gc(other.token, '/withdrawals/not-a-uuid'))).toBe('WITHDRAWAL_NOT_FOUND');
    expect((await stateOf(id)).state).toBe('PENDING');
  });

  it('2. create: the amount is only set aside (hold), never debited; bank details are a verified snapshot; refusals write nothing', async () => {
    const s = await newShipper(100_000);
    for (const body of [{}, { amount_vnd: 0 }, { amount_vnd: 10.5 }, { amount_vnd: '10000' }, { amount_vnd: 10_000, driver_id: s.driverId }]) {
      expect([JSON.stringify(body), (await withdraw(s, body)).status]).toEqual([JSON.stringify(body), 400]);
    }
    expect(errorCode(await withdraw(s, { amount_vnd: 9_999 }))).toBe('WITHDRAWAL_AMOUNT_BELOW_MINIMUM');
    expect(errorCode(await withdraw(s, { amount_vnd: 100_001 }))).toBe('WITHDRAWAL_INSUFFICIENT_AVAILABLE');
    expect(errorCode(await withdraw(s, { amount_vnd: 10_000 }, null))).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(await wallet(s)).toEqual({ balance: '100000', held: '0' });
    const key = randomUUID();
    const created = await withdraw(s, { amount_vnd: 40_000 }, key);
    expect(created.status).toBe(201);
    const data = dataOf(created);
    expect(data).toMatchObject({ amount_vnd: 40_000, state: 'PENDING', version: 1, can_cancel: true, account: { bank_code: 'VCB', account_number_masked: `****${s.number.slice(-4)}` } });
    expect(JSON.stringify(data)).not.toContain(s.number);
    const id = String(data.withdrawal_id);
    expect(await wallet(s)).toEqual({ balance: '100000', held: '40000' });
    expect(await holdOf(id)).toEqual({ status: 'ACTIVE', amount: '40000' });
    expect(await debits(s.walletId)).toBe(0);
    // The snapshot keeps the leading zero and the exact verified data.
    const snap = (await client.pool.query('SELECT account_number, account_holder, bank_code FROM app.wallet_withdrawals WHERE withdrawal_id = $1::uuid', [id])).rows[0];
    expect(snap).toEqual({ account_number: s.number, account_holder: HOLDER, bank_code: 'VCB' });
    expect(s.number.startsWith('0')).toBe(true);
    // Replay: same key and body -> the same withdrawal, nothing more; the same key with another body is refused.
    expect(dataOf(await withdraw(s, { amount_vnd: 40_000 }, key)).withdrawal_id).toBe(id);
    expect(errorCode(await withdraw(s, { amount_vnd: 41_000 }, key))).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await countRows(client.pool, 'SELECT 1 FROM app.wallet_withdrawals WHERE wallet_id = $1::uuid', [s.walletId])).toBe(1);
    expect(await wallet(s)).toEqual({ balance: '100000', held: '40000' });
    // Audit and outbox: identifiers, state and amount, never a bank detail.
    const trail = JSON.stringify([
      (await client.pool.query('SELECT metadata FROM app.audit_logs WHERE resource_id = $1', [id])).rows,
      (await client.pool.query('SELECT payload FROM app.outbox_events WHERE resource_id = $1', [id])).rows,
    ]);
    for (const secret of [s.number, HOLDER]) {
      expect(trail).not.toContain(secret);
    }
    // The second request sees the available money already set aside.
    expect(errorCode(await withdraw(s, { amount_vnd: 60_001 }))).toBe('WITHDRAWAL_INSUFFICIENT_AVAILABLE');
    expect((await withdraw(s, { amount_vnd: 60_000 })).status).toBe(201);
    expect(await wallet(s)).toEqual({ balance: '100000', held: '100000' });
  });

  it('3. no verified bank account, no withdrawal; two parallel requests cannot overspend the available money', async () => {
    const unverified = await newShipper(50_000, { verified: false });
    expect(errorCode(await withdraw(unverified, { amount_vnd: 10_000 }))).toBe('WITHDRAWAL_BANK_NOT_VERIFIED');
    expect(await wallet(unverified)).toEqual({ balance: '50000', held: '0' });
    expect(await countRows(client.pool, 'SELECT 1 FROM app.wallet_withdrawals WHERE wallet_id = $1::uuid', [unverified.walletId])).toBe(0);
    const s = await newShipper(100_000);
    const results = await Promise.all([withdraw(s, { amount_vnd: 70_000 }), withdraw(s, { amount_vnd: 70_000 }), withdraw(s, { amount_vnd: 70_000 })]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(await wallet(s)).toEqual({ balance: '100000', held: '70000' });
  });

  it('4. cancel: only while PENDING, once, at the right version; the hold is released and no ledger row appears', async () => {
    const s = await newShipper(100_000);
    const id = await request(s, 30_000);
    expect(errorCode(await cancel(s, id, { expected_version: 7 }))).toBe('VERSION_CONFLICT');
    expect(errorCode(await cancel(s, id, {}))).toBe('BAD_REQUEST');
    const key = randomUUID();
    const cancelled = await cancel(s, id, { expected_version: 1 }, key);
    expect(cancelled.status).toBe(200);
    expect(dataOf(cancelled)).toMatchObject({ state: 'CANCELLED', version: 2, can_cancel: false });
    expect(await holdOf(id)).toEqual({ status: 'RELEASED', amount: '30000' });
    expect(await wallet(s)).toEqual({ balance: '100000', held: '0' });
    expect(await debits(s.walletId)).toBe(0);
    expect(dataOf(await cancel(s, id, { expected_version: 1 }, key)).state).toBe('CANCELLED'); // replay
    expect(errorCode(await cancel(s, id, { expected_version: 2 }))).toBe('WITHDRAWAL_STATE_CONFLICT');
    // Parallel cancels: exactly one releases.
    const id2 = await request(s, 20_000);
    const both = await Promise.all([cancel(s, id2, { expected_version: 1 }), cancel(s, id2, { expected_version: 1 })]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await wallet(s)).toEqual({ balance: '100000', held: '0' });
  });

  it('5. permissions: no right, read only, process only, confirm only and reconcile only each get exactly their own routes; the destination is masked in lists', async () => {
    const s = await newShipper(100_000);
    const id = await request(s, 50_000);
    const path = `/finance/withdrawals/${id}`;
    expect((await getAdmin(undefined, '/finance/withdrawals')).status).toBe(401);
    for (const response of [await getAdmin(as('bare'), '/finance/withdrawals'), await getAdmin(as('bare'), path), await start('bare', id)]) {
      expect(code(response)).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    }
    // read only: sees (masked), cannot act.
    const list = await getAdmin(as('reader'), '/finance/withdrawals?status=PENDING');
    expect(list.status).toBe(200);
    expect(list.text).not.toContain(s.number);
    expect(list.text).not.toContain(HOLDER);
    const detail = adminData(await getAdmin(as('reader'), path));
    expect(detail).toMatchObject({ state: 'PENDING', destination: { full: false, account_number_masked: `****${s.number.slice(-4)}` }, rights: { can_process: false } });
    expect(JSON.stringify(detail)).not.toContain(s.number);
    expect(code(await start('reader', id))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    // confirm only / reconcile only / recorder cannot claim a transfer either.
    for (const who of ['confirmerOnly', 'reconciler', 'recorder']) {
      expect(code(await start(who, id))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    }
    expect(code(await paid('reader', id, evidence(id)))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    expect(code(await reconcile('processor', id, { outcome: 'UNKNOWN', reason_code: 'STILL_UNCLEAR' }))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    expect(await stateOf(id)).toEqual({ state: 'PENDING', version: '1' });
    expect(await wallet(s)).toEqual({ balance: '100000', held: '50000' });
    // A revoked right stops at once; the right is asked again on a replay.
    const key = randomUUID();
    expect((await start('processor', id, 1, key)).status).toBe(200);
    expect((await changeGrant('revoke', admins.processor?.who.userId as string, PROCESS, 1)).status).toBe(200);
    expect(code(await start('processor', id, 1, key))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    expect((await changeGrant('grant', admins.processor?.who.userId as string, PROCESS, 2)).status).toBe(200);
    expect((await start('processor', id, 1, key)).status).toBe(200);
  });

  it('6. start-processing: a stale bank snapshot is refused; the claim is written once; only the owner sees the whole destination; the Shipper can no longer cancel', async () => {
    const s = await newShipper(100_000);
    const stale = await request(s, 10_000);
    await client.pool.query(`UPDATE app.driver_bank_accounts SET account_number = '9999999999', verification_state = 'UNVERIFIED', verified_by = NULL, verified_at = NULL, updated_at = clock_timestamp() WHERE driver_id = $1::uuid`, [s.driverId]);
    expect(code(await start('processor', stale))).toEqual({ status: 409, code: 'BANK_SNAPSHOT_STALE' });
    expect(await stateOf(stale)).toEqual({ state: 'PENDING', version: '1' });
    expect(dataOf(await cancel(s, stale, { expected_version: 1 })).state).toBe('CANCELLED'); // the Shipper starts over after verifying again
    await client.pool.query(
      `UPDATE app.driver_bank_accounts SET account_number = $2, verification_state = 'VERIFIED', verified_by = $3, verified_at = clock_timestamp(), updated_at = clock_timestamp() WHERE driver_id = $1::uuid`,
      [s.driverId, s.number, s.userId],
    );
    const id = await request(s, 50_000);
    const claimed = await start('processor', id);
    expect(claimed.status).toBe(200);
    const data = adminData(claimed);
    expect(data).toMatchObject({ state: 'PROCESSING', version: 2, processing: { is_owner: true }, destination: { full: true, account_number: s.number, account_holder: HOLDER } });
    const owner = (await client.pool.query<{ o: string }>('SELECT processing_owner_user_id::text AS o FROM app.wallet_withdrawals WHERE withdrawal_id = $1::uuid', [id])).rows[0]?.o;
    expect(owner).toBe(admins.processor?.who.userId);
    // Another administrator, even with the same rights, sees the destination masked and cannot confirm.
    const other = adminData(await getAdmin(as('processor2'), `/finance/withdrawals/${id}`));
    expect(other).toMatchObject({ state: 'PROCESSING', processing: { is_owner: false }, destination: { full: false } });
    expect(JSON.stringify(other)).not.toContain(s.number);
    expect(code(await paid('processor2', id, evidence(id)))).toEqual({ status: 403, code: 'WITHDRAWAL_NOT_OWNER' });
    expect(code(await start('processor2', id, 2))).toEqual({ status: 409, code: 'WITHDRAWAL_STATE_CONFLICT' });
    // The Shipper cannot cancel any more, and nothing was debited.
    expect(errorCode(await cancel(s, id, { expected_version: 2 }))).toBe('WITHDRAWAL_STATE_CONFLICT');
    expect(await holdOf(id)).toEqual({ status: 'ACTIVE', amount: '50000' });
    expect(await debits(s.walletId)).toBe(0);
  });

  it('7. mark-paid records the manual transfer: ONE debit of exactly the amount, hold captured, once; a different amount is refused; the owner only', async () => {
    const s = await newShipper(100_000);
    const id = await request(s, 50_000);
    expect((await start('processor', id)).status).toBe(200);
    expect(code(await paid('processor', id, evidence(id, {}, 49_000)))).toEqual({ status: 409, code: 'WITHDRAWAL_EVIDENCE_MISMATCH' });
    expect(code(await paid('processor', id, evidence(id, { paid_at: new Date(Date.now() + 3_600_000).toISOString() })))).toEqual({ status: 400, code: 'ADMIN_INPUT_INVALID' });
    expect(code(await send(as('processor'), `/finance/withdrawals/${id}/mark-paid`, { expected_version: 2, ...evidence(id) }))).toEqual({ status: 400, code: 'ADMIN_INPUT_INVALID' }); // destination not checked
    expect(await wallet(s)).toEqual({ balance: '100000', held: '50000' });
    const ref = txid();
    const key = randomUUID();
    const proof = evidence(id, { canonical_transaction_id: ref });
    const response = await paid('processor', id, proof, 2, key);
    expect(response.status).toBe(200);
    expect(adminData(response)).toMatchObject({ state: 'PAID', version: 3, outcome: 'PAID', outgoing: { bank_id: 'VCB', amount_vnd: 50_000, matches_amount: true } });
    expect(await wallet(s)).toEqual({ balance: '50000', held: '0' });
    expect(await holdOf(id)).toEqual({ status: 'CAPTURED', amount: '50000' });
    expect(await debits(s.walletId)).toBe(1);
    const last = (await client.pool.query('SELECT entry_kind, delta_vnd::text, balance_after_vnd::text FROM app.wallet_ledger_entries WHERE wallet_id = $1::uuid ORDER BY sequence_no DESC LIMIT 1', [s.walletId])).rows[0];
    expect(last).toEqual({ entry_kind: 'WITHDRAWAL_DEBIT', delta_vnd: '-50000', balance_after_vnd: '50000' });
    // A replay (a lost response) debits nothing more; a new key on the finished withdrawal is a state conflict.
    expect((await paid('processor', id, proof, 2, key)).status).toBe(200);
    expect(await debits(s.walletId)).toBe(1);
    expect(code(await paid('processor', id, evidence(id), 3))).toEqual({ status: 409, code: 'WITHDRAWAL_STATE_CONFLICT' });
    // The bank transaction is recorded once for the whole system: a second withdrawal cannot reuse it, and rolls back whole.
    const id2 = await request(s, 20_000);
    expect((await start('processor', id2)).status).toBe(200);
    expect(code(await paid('processor', id2, evidence(id2, { canonical_transaction_id: ` ${ref} ` }, 20_000)))).toEqual({ status: 409, code: 'BANK_TRANSACTION_ALREADY_RECORDED' });
    expect(await stateOf(id2)).toEqual({ state: 'PROCESSING', version: '2' });
    expect(await debits(s.walletId)).toBe(1);
    expect(await wallet(s)).toEqual({ balance: '50000', held: '20000' });
    // The shipper's own history shows the debit as a success and nothing is shown twice.
    const history = dataOf(await gc(s.token, '/transactions')).items as Array<Record<string, unknown>>;
    expect(history.filter((row) => row.type === 'withdraw' && row.status === 'success')).toHaveLength(1);
  });

  it('8. races: two administrators claiming at once, and the same confirmation sent twice, end with one winner and one debit', async () => {
    const s = await newShipper(100_000);
    const id = await request(s, 40_000);
    const claims = await Promise.all([start('processor', id), start('processor2', id)]);
    expect(claims.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = claims[0]?.status === 200 ? 'processor' : 'processor2';
    const ref = txid();
    const key = randomUUID();
    const proof = evidence(id, { canonical_transaction_id: ref }, 40_000);
    const twice = await Promise.all([paid(winner, id, proof, 2, key), paid(winner, id, proof, 2, key)]);
    expect(twice.map((r) => r.status).filter((status) => status === 200).length).toBeGreaterThanOrEqual(1);
    expect(await debits(s.walletId)).toBe(1);
    expect(await wallet(s)).toEqual({ balance: '60000', held: '0' });
    // Shipper cancel against the claim: exactly one of them wins.
    const t = await newShipper(100_000);
    const raced = await request(t, 30_000);
    const outcome = await Promise.all([cancel(t, raced, { expected_version: 1 }), start('processor', raced)]);
    const state = (await stateOf(raced)).state;
    expect(['CANCELLED', 'PROCESSING']).toContain(state);
    expect(outcome.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await wallet(t)).toEqual(state === 'CANCELLED' ? { balance: '100000', held: '0' } : { balance: '100000', held: '30000' });
  });

  it('9. an unknown outcome goes to reconciliation with the hold ACTIVE: no release, no debit, no second transfer; each way out needs its own right', async () => {
    const s = await newShipper(200_000);
    const id = await request(s, 50_000);
    expect((await start('processor', id)).status).toBe(200);
    expect(code(await report('reader', id, 'UNKNOWN_OUTCOME'))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    expect(code(await report('processor2', id, 'UNKNOWN_OUTCOME'))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' }); // has process but did not claim it
    const reported = await report('processor', id, 'UNKNOWN_OUTCOME');
    expect(reported.status).toBe(200);
    expect(adminData(reported)).toMatchObject({ state: 'RECONCILIATION', version: 3, reconciliation: { reason_code: 'UNKNOWN_OUTCOME' } });
    expect(await holdOf(id)).toEqual({ status: 'ACTIVE', amount: '50000' });
    expect(await wallet(s)).toEqual({ balance: '200000', held: '50000' });
    expect(errorCode(await cancel(s, id, { expected_version: 3 }))).toBe('WITHDRAWAL_STATE_CONFLICT');
    expect(code(await start('processor2', id, 3))).toEqual({ status: 409, code: 'WITHDRAWAL_STATE_CONFLICT' });
    expect(code(await paid('processor', id, evidence(id), 3))).toEqual({ status: 409, code: 'WITHDRAWAL_STATE_CONFLICT' });
    // Only a reconciler settles it, and only with evidence; UNKNOWN keeps it open.
    expect(code(await reconcile('processor', id, { outcome: 'UNKNOWN', reason_code: 'STILL_UNCLEAR' }))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    const unknown = await reconcile('reconciler', id, { outcome: 'UNKNOWN', reason_code: 'STILL_UNCLEAR' });
    expect(adminData(unknown)).toMatchObject({ state: 'RECONCILIATION', version: 4, rights: { can_reconcile: true } });
    expect(await holdOf(id)).toEqual({ status: 'ACTIVE', amount: '50000' });
    // PAID without evidence or with a different amount is refused, state untouched.
    expect(code(await reconcile('reconciler', id, { outcome: 'CONFIRMED_PAID', reason_code: 'STATEMENT_CONFIRMED', destination_checked: true }, 4))).toEqual({ status: 400, code: 'ADMIN_INPUT_INVALID' });
    expect(code(await reconcile('reconciler', id, { outcome: 'CONFIRMED_PAID', reason_code: 'STATEMENT_CONFIRMED', destination_checked: true, evidence: evidence(id, {}, 49_000) }, 4))).toEqual({ status: 409, code: 'WITHDRAWAL_EVIDENCE_MISMATCH' });
    expect(await debits(s.walletId)).toBe(0);
    const settled = await reconcile('reconciler', id, { outcome: 'CONFIRMED_PAID', reason_code: 'STATEMENT_CONFIRMED', destination_checked: true, evidence: evidence(id, {}, 50_000) }, 4);
    expect(settled.status).toBe(200);
    expect(adminData(settled)).toMatchObject({ state: 'PAID', outcome: 'PAID' });
    expect(await debits(s.walletId)).toBe(1);
    expect(await wallet(s)).toEqual({ balance: '150000', held: '0' });
    const events = (await client.pool.query<{ kind: string }>('SELECT kind FROM app.wallet_withdrawal_events WHERE withdrawal_id = $1::uuid ORDER BY created_at, event_id', [id])).rows.map((row) => row.kind);
    expect(events).toEqual(['CREATED', 'PROCESSING_STARTED', 'RECONCILIATION_REPORTED', 'RECONCILIATION_UNKNOWN', 'RECONCILED_PAID']);
  });

  it('10. certainly NOT sent releases the hold (no debit); a transfer that has an outgoing record can never be released; a transfer of another amount stays open', async () => {
    const s = await newShipper(200_000);
    const a = await request(s, 50_000);
    expect((await start('processor', a)).status).toBe(200);
    expect((await report('processor', a, 'TAKEOVER_NEEDED')).status).toBe(200);
    expect(code(await reconcile('reconciler', a, { outcome: 'CONFIRMED_NOT_SENT_FINAL', reason_code: 'BANK_CONFIRMED_NOT_SENT' }))).toEqual({ status: 400, code: 'ADMIN_INPUT_INVALID' });
    const released = await reconcile('reconciler', a, { outcome: 'CONFIRMED_NOT_SENT_FINAL', reason_code: 'BANK_CONFIRMED_NOT_SENT', bank_confirmed_not_sent: true }, 3);
    expect(released.status).toBe(200);
    expect(adminData(released)).toMatchObject({ state: 'CANCELLED', outcome: 'CONFIRMED_NOT_SENT_FINAL' });
    expect(await holdOf(a)).toEqual({ status: 'RELEASED', amount: '50000' });
    expect(await wallet(s)).toEqual({ balance: '200000', held: '0' });
    expect(await debits(s.walletId)).toBe(0);

    // A different amount was sent: reported with its evidence (the identity is claimed), it can be neither PAID nor released.
    const b = await request(s, 50_000);
    expect((await start('processor', b)).status).toBe(200);
    const reported = await report('processor', b, 'AMOUNT_MISMATCH', 2, evidence(b, {}, 45_000));
    expect(reported.status).toBe(200);
    expect(adminData(reported)).toMatchObject({ state: 'RECONCILIATION', outgoing: { amount_vnd: 45_000, matches_amount: false } });
    expect(code(await reconcile('reconciler', b, { outcome: 'CONFIRMED_NOT_SENT_FINAL', reason_code: 'BANK_CONFIRMED_NOT_SENT', bank_confirmed_not_sent: true }, 3))).toEqual({ status: 409, code: 'WITHDRAWAL_STATE_CONFLICT' });
    expect(code(await reconcile('reconciler', b, { outcome: 'CONFIRMED_PAID', reason_code: 'STATEMENT_CONFIRMED', destination_checked: true }, 3))).toEqual({ status: 409, code: 'WITHDRAWAL_EVIDENCE_MISMATCH' });
    expect(await holdOf(b)).toEqual({ status: 'ACTIVE', amount: '50000' });
    expect(await wallet(s)).toEqual({ balance: '200000', held: '50000' });
    expect(await debits(s.walletId)).toBe(0);
  });

  it('11. the database refuses what the code must never do: a debit without a captured hold, PAID without its debit, a delete, an edit of the snapshot', async () => {
    const s = await newShipper(100_000);
    const id = await request(s, 30_000);
    const conn = await client.pool.connect();
    try {
      await expect(conn.query(`INSERT INTO app.wallet_ledger_entries (entry_id, wallet_id, sequence_no, entry_kind, delta_vnd, balance_after_vnd, created_at, withdrawal_id) VALUES (gen_random_uuid(), $1::uuid, 2, 'WITHDRAWAL_DEBIT', -30000, 70000, now(), $2::uuid)`, [s.walletId, id])).rejects.toThrow(/WALLET_LEDGER_SOURCE_NOT_AVAILABLE/);
      await expect(conn.query(`UPDATE app.wallet_withdrawals SET account_number = '1234567890' WHERE withdrawal_id = $1::uuid`, [id])).rejects.toThrow(/WALLET_WITHDRAWAL_IDENTITY_IMMUTABLE|WALLET_WITHDRAWAL_VERSION/);
      await expect(conn.query('DELETE FROM app.wallet_withdrawals WHERE withdrawal_id = $1::uuid', [id])).rejects.toThrow(/never deleted|append-only/);
      await expect(conn.query(`UPDATE app.wallet_withdrawals SET state = 'CANCELLED', version = version + 1, outcome = 'CANCELLED_BY_SHIPPER', resolved_by_user_id = $2::uuid, resolved_at = now() WHERE withdrawal_id = $1::uuid`, [id, s.userId])).rejects.toThrow(/WALLET_WITHDRAWAL_INVARIANT_VIOLATION|WALLET_INVARIANT/);
      // PENDING -> PAID is not a transition at all.
      await expect(conn.query(`UPDATE app.wallet_withdrawals SET state = 'PAID', version = version + 1 WHERE withdrawal_id = $1::uuid`, [id])).rejects.toThrow(/TRANSITION_REFUSED|violates check/);
      await expect(conn.query('DELETE FROM app.wallet_withdrawal_events')).rejects.toThrow(/append-only/);
      await expect(conn.query('UPDATE app.wallet_commission_policies SET commission_vnd = 5 WHERE policy_version = 1')).rejects.toThrow(/append-only/);
    } finally {
      conn.release();
    }
    expect(await stateOf(id)).toEqual({ state: 'PENDING', version: '1' });
    expect(await wallet(s)).toEqual({ balance: '100000', held: '30000' });
  });

  it('12. a failure after the debit is written rolls everything back: no debit, no capture, no state change, no outgoing record', async () => {
    const s = await newShipper(100_000);
    const id = await request(s, 30_000);
    expect((await start('processor', id)).status).toBe(200);
    await client.pool.query(`CREATE FUNCTION app.test_c_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'TEST_C_FAULT'; END $$`);
    await client.pool.query(`CREATE TRIGGER test_c_fail BEFORE UPDATE ON app.wallet_withdrawals FOR EACH ROW WHEN (NEW.state = 'PAID') EXECUTE FUNCTION app.test_c_fail()`);
    const ref = txid();
    try {
      expect((await paid('processor', id, evidence(id, { canonical_transaction_id: ref }, 30_000))).status).toBeGreaterThanOrEqual(500);
    } finally {
      await client.pool.query('DROP TRIGGER test_c_fail ON app.wallet_withdrawals');
      await client.pool.query('DROP FUNCTION app.test_c_fail()');
    }
    expect(await stateOf(id)).toEqual({ state: 'PROCESSING', version: '2' });
    expect(await holdOf(id)).toEqual({ status: 'ACTIVE', amount: '30000' });
    expect(await debits(s.walletId)).toBe(0);
    expect(await countRows(client.pool, 'SELECT 1 FROM app.wallet_bank_transactions WHERE canonical_transaction_id = $1', [ref])).toBe(0);
    expect(await wallet(s)).toEqual({ balance: '100000', held: '30000' });
    // The reference is free again and the same command now succeeds.
    expect((await paid('processor', id, evidence(id, { canonical_transaction_id: ref }, 30_000))).status).toBe(200);
    expect(await debits(s.walletId)).toBe(1);
  });

  it('13. the finance reads come from the database and are masked; the commission policy is versioned and SYSTEM only', async () => {
    const s = await newShipper(60_000);
    const overview = await getAdmin(as('reader'), '/finance/overview');
    expect(overview.status).toBe(200);
    const o = adminData(overview);
    expect(o).toMatchObject({ commission_vnd: 1000 });
    // The drift figure is the database's own count (this test creates none: its wallets always equal their ledger and holds).
    const direct = await client.pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM app.driver_wallets w
        WHERE w.balance_vnd <> COALESCE((SELECT SUM(delta_vnd) FROM app.wallet_ledger_entries l WHERE l.wallet_id = w.wallet_id), 0)
           OR w.held_vnd <> COALESCE((SELECT SUM(amount_vnd) FROM app.wallet_holds h WHERE h.wallet_id = w.wallet_id AND h.status = 'ACTIVE'), 0)`,
    );
    expect((o.drift as { wallets: number }).wallets).toBe(Number(direct.rows[0]?.n));
    expect(Number(o.total_balance_vnd) - Number(o.total_held_vnd)).toBe(Number(o.total_available_vnd));
    expect(code(await getAdmin(as('bare'), '/finance/overview'))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    const wallets = await getAdmin(as('reader'), `/finance/wallets?q=${encodeURIComponent(s.phone.local.replace(/^0/, ''))}`);
    expect(wallets.status).toBe(200);
    const items = (adminData(wallets).items as Array<Record<string, unknown>>) ?? [];
    expect(items.map((item) => item.driver_id)).toContain(s.driverId);
    expect(wallets.text).not.toContain(s.phone.local);
    expect(wallets.text).not.toContain('Nguyễn Văn Rút');
    const one = adminData(await getAdmin(as('reader'), `/finance/wallets/${s.driverId}`));
    expect(one).toMatchObject({ wallet: { balance_vnd: 60_000, held_vnd: 0, available_vnd: 60_000 } });
    const ledger = adminData(await getAdmin(as('reader'), `/finance/transactions?kind=TOPUP&driver_id=${s.driverId}`));
    expect((ledger.items as unknown[]).length).toBe(1);
    expect(code(await getAdmin(as('reader'), '/finance/transactions?kind=NOPE'))).toEqual({ status: 400, code: 'ADMIN_INPUT_INVALID' });
    const rec = adminData(await getAdmin(as('reader'), '/finance/reconciliation'));
    expect((rec.drift as Array<{ driver_id: string }>).map((row) => row.driver_id)).not.toContain(s.driverId);
    // The audited check records nothing when nothing drifted, and needs the reconcile right.
    expect(code(await send(as('reader'), '/finance/reconciliation/check', {}))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    expect(adminData(await send(as('reconciler'), '/finance/reconciliation/check', {}))).toHaveProperty('checked_wallets');

    // Commission policy: any reader sees it; only SYSTEM changes it, at the version in force, and an ADMIN is forbidden.
    expect(adminData(await getAdmin(as('reader'), '/finance/commission-policy'))).toMatchObject({ current: { version: 1, commission_vnd: 1000 } });
    expect(code(await send(as('processor'), '/finance/commission-policy', { expected_version: 1, commission_vnd: 2000 }))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    expect(code(await send(systemLogin(), '/finance/commission-policy', { expected_version: 9, commission_vnd: 2000 }))).toEqual({ status: 409, code: 'COMMISSION_POLICY_VERSION_CONFLICT' });
    expect(code(await send(systemLogin(), '/finance/commission-policy', { expected_version: 1, commission_vnd: 0 }))).toEqual({ status: 400, code: 'ADMIN_INPUT_INVALID' });
    expect(await countRows(client.pool, 'SELECT 1 FROM app.wallet_commission_policies')).toBe(1);
  });
  it('14. M03 activation needs real confirmed top-ups: under 100.000 it is refused, 100.000 with the money still available approves, and nothing is credited twice', async () => {
    // A Shipper whose profile was sent for review, with a verified bank account of its own name, and no money at all.
    const s = await newShipper(0);
    await client.pool.query(`UPDATE app.drivers SET status = 'PENDING', review_state = 'SUBMITTED' WHERE driver_id = $1::uuid`, [s.driverId]);
    const driverVersion = async (): Promise<number> => Number((await client.pool.query<{ version: string }>('SELECT version::text FROM app.drivers WHERE driver_id = $1::uuid', [s.driverId])).rows[0]?.version);
    const approve = async (): Promise<AdminResponse> => send(systemLogin(), `/shippers/${s.driverId}/approve`, { expected_version: await driverVersion() });
    const status = async (): Promise<string> => String((await client.pool.query('SELECT status FROM app.drivers WHERE driver_id = $1::uuid', [s.driverId])).rows[0]?.status);
    const topups = (): Promise<number> => countRows(client.pool, `SELECT 1 FROM app.wallet_ledger_entries l JOIN app.driver_wallets w ON w.wallet_id = l.wallet_id WHERE w.driver_id = $1::uuid AND l.entry_kind = 'TOPUP'`, [s.driverId]);
    /** One real top-up: the Shipper asks, an administrator records the money that really arrived. */
    const topup = async (amount: number): Promise<void> => {
      const requested = await client.call('POST', `${BASE}/topup-requests`, { bearer: s.token, headers: { 'idempotency-key': randomUUID() }, body: { amount_vnd: Math.max(amount, 100_000) } });
      expect(requested.status).toBe(201);
      const confirmed = await send(as('recorder'), `/finance/topup-requests/${String(dataOf(requested).request_id)}/confirm`, {
        expected_version: 1,
        actual_amount_vnd: amount,
        bank_id: 'VCB',
        system_owned_account_id: account.id,
        canonical_transaction_id: `IN${Math.floor(1e11 + Math.random() * 9e11)}`,
        received_at: new Date(Date.now() - 60_000).toISOString(),
      });
      expect(confirmed.status).toBe(200);
    };

    // No money, then a request that only says "I have transferred": still refused, and nothing was created.
    expect(code(await approve())).toEqual({ status: 409, code: 'DRIVER_FUNDING_REQUIRED' });
    const asked = await client.call('POST', `${BASE}/topup-requests`, { bearer: s.token, headers: { 'idempotency-key': randomUUID() }, body: { amount_vnd: 200_000 } });
    expect(asked.status).toBe(201);
    expect(code(await approve())).toEqual({ status: 409, code: 'DRIVER_FUNDING_REQUIRED' });
    expect(await status()).toBe('PENDING');

    // 50.000 of recorded money is not enough either.
    await topup(50_000);
    expect(code(await approve())).toEqual({ status: 409, code: 'DRIVER_FUNDING_REQUIRED' });
    expect(await status()).toBe('PENDING');
    expect(await topups()).toBe(1);

    // 100.000 confirmed in total, but a withdrawal asked since set money aside: the AVAILABLE money is under 100.000, so it is refused again.
    await topup(50_000);
    expect(await wallet(s)).toEqual({ balance: '100000', held: '0' });
    const reserved = await request(s, 20_000);
    expect(code(await approve())).toEqual({ status: 409, code: 'DRIVER_FUNDING_REQUIRED' });
    const cancelled = await cancel(s, reserved, { expected_version: 1 });
    expect(cancelled.status).toBe(200);

    // 100.000 confirmed and available: approved. Approving credits nothing, and a replay of the same command neither.
    const key = randomUUID();
    const approvedAt = await driverVersion();
    const first = await send(systemLogin(), `/shippers/${s.driverId}/approve`, { expected_version: approvedAt }, key);
    expect(first.status).toBe(200);
    expect(await status()).toBe('ACTIVE');
    const replay = await send(systemLogin(), `/shippers/${s.driverId}/approve`, { expected_version: approvedAt }, key);
    expect(replay.status).toBe(200);
    expect(await wallet(s)).toEqual({ balance: '100000', held: '0' });
    expect(await topups()).toBe(2);
    expect(await countRows(client.pool, `SELECT 1 FROM app.wallet_ledger_entries l JOIN app.driver_wallets w ON w.wallet_id = l.wallet_id WHERE w.driver_id = $1::uuid AND l.entry_kind <> 'TOPUP'`, [s.driverId])).toBe(0);
  });
});
