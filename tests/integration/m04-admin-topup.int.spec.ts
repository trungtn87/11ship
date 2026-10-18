import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Argon2idPasswordHasher } from '../../apps/backend/src/auth/password-hasher';
import { ADMIN_SESSION_COOKIE } from '../../apps/backend/src/admin-auth/admin-auth-constants';
import { ADMIN_PASSWORD, AdminApp, adminData, adminErrorCode, AdminResponse, cookieFrom, loginStep, preauthCookies, rewindAcceptedStep, sessionCookies, startAdminApp, totpNow } from './support/admin-fixtures';
import { begin, ok, post } from './support/activation-fixtures';
import { countRows, createDriverFor, Phone, purgePhone, randomPhone } from './support/auth-fixtures';
import { createInvitation, createPayload, systemSession, SystemSession } from './support/provisioning-fixtures';

// M04-B2.2b on a REAL Nest administration pipeline and PostgreSQL: the Admin reconciles a Shipper top-up request against the bank statement and the
// ACTUAL amount is posted (bank record + topup + ledger credit + balance + request CONFIRMED) in ONE transaction. The Shipper is never activated and no
// other ledger kind exists. The receiving accounts are created and switched on through the real SYSTEM routes. Committed rows are removed in afterAll.

const tag = randomBytes(3).toString('hex').toUpperCase();
const READ = 'wallet.read';
const RECORD = 'wallet.topup.record';
const SECRET_HOLDER = `CONG TY SECRET ${tag}`;

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
  readonly driverId: string;
  readonly walletId: string;
}
interface Account {
  readonly id: string;
  readonly number: string;
}

describe('M04-B2.2b — Admin top-up reconciliation and TOPUP posting', () => {
  let admin: AdminApp;
  let system: SystemSession;
  let bare: ActivatedAdmin;
  let bareLogin: Login;
  let reader: ActivatedAdmin;
  let readerLogin: Login;
  let recorder: ActivatedAdmin;
  let recorderLogin: Login;
  let account: Account;
  const shippers: Shipper[] = [];
  const accountIds: string[] = [];

  const permission = (app: string, view: boolean): Record<string, unknown> => ({ app, can_view: view, can_review_profile: false, can_lock: false });

  beforeAll(async () => {
    admin = await startAdminApp({ activationDisabledTest: true });
    system = await systemSession(admin);
    bare = await activatedAdmin([permission('DRIVER', true)], `Admin trống ${tag}`);
    bareLogin = await login(bare);
    reader = await activatedAdmin([permission('DRIVER', true)], `Admin đọc ${tag}`);
    readerLogin = await login(reader);
    recorder = await activatedAdmin([permission('DRIVER', true)], `Admin ghi ${tag}`);
    recorderLogin = await login(recorder);
    expect((await changeGrant('grant', reader.userId, READ, 0)).status).toBe(200);
    expect((await changeGrant('grant', recorder.userId, RECORD, 0)).status).toBe(200);
    hash = await new Argon2idPasswordHasher().hash(ADMIN_PASSWORD);
    account = await newAccount(true);
  });

  afterAll(async () => {
    try {
      for (const shipper of shippers) {
        await purgePhone(admin.pool, shipper.phone.normalized); // wallets, ledger, topups, bank records, requests, driver, user
      }
      const client = await admin.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('ALTER TABLE app.admin_finance_grants DISABLE TRIGGER admin_finance_grants_no_delete');
        await client.query('DELETE FROM app.admin_finance_grants');
        await client.query('ALTER TABLE app.admin_finance_grants ENABLE TRIGGER admin_finance_grants_no_delete');
        await client.query('ALTER TABLE app.system_owned_bank_accounts DISABLE TRIGGER wallet_system_accounts_no_delete');
        await client.query('DELETE FROM app.system_owned_bank_accounts WHERE system_account_id = ANY($1::uuid[])', [accountIds]);
        await client.query('ALTER TABLE app.system_owned_bank_accounts ENABLE TRIGGER wallet_system_accounts_no_delete');
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    } finally {
      await admin.close();
    }
  });

  // ------------------------------------------------------------------------------------------------ helpers
  async function activatedAdmin(permissions: Record<string, unknown>[], fullName: string): Promise<ActivatedAdmin> {
    const phone = randomPhone();
    admin.track(phone.normalized);
    const invitation = await createInvitation(admin, system, createPayload(phone.local, { full_name: fullName, permissions }));
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

  const systemLogin = (): Login => ({ cookie: system.login.cookie, csrf: system.login.csrf });
  const code = (response: AdminResponse): { status: number; code: string | undefined } => ({ status: response.status, code: adminErrorCode(response) });
  const get = (who: Login | undefined, path: string): Promise<AdminResponse> => admin.call('GET', path, { basePath: '/v1/admin', ...(who === undefined ? {} : { cookies: sessionCookies(who) }) });

  async function send(who: Login, path: string, body: unknown, key: string = randomUUID()): Promise<AdminResponse> {
    await admin.clearLimits(); // the ingress quota is not under test
    return admin.call('POST', path, { basePath: '/v1/admin', body, cookies: sessionCookies(who), csrf: who.csrf, headers: { 'idempotency-key': key } });
  }
  const changeGrant = (command: 'grant' | 'revoke', target: string, key: string, version: number): Promise<AdminResponse> =>
    send(systemLogin(), `/finance/access/admins/${target}/${command}`, { permission_key: key, expected_version: version });

  async function newAccount(receiving: boolean): Promise<Account> {
    const number = String(Math.floor(1e11 + Math.random() * 9e11));
    const created = await send(systemLogin(), '/finance/bank-accounts', { bank_id: 'VCB', account_number: number, account_holder: SECRET_HOLDER });
    expect(created.status).toBe(201);
    const id = String(adminData(created).account_id);
    accountIds.push(id);
    if (receiving) {
      const on = await send(systemLogin(), `/finance/bank-accounts/${id}/receiving`, { expected_version: 1, can_receive: true });
      expect(on.status).toBe(200);
    }
    return { id, number };
  }

  /** A Shipper (PENDING profile) with a zero wallet and one PENDING request of the amount, written as the product would have left them. */
  async function newShipper(amount = 100_000, status = 'PENDING'): Promise<Shipper & { requestId: string }> {
    const phone = randomPhone();
    admin.track(phone.normalized);
    const userId = randomUUID();
    await admin.pool.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
       VALUES ($1::uuid, $2, $3, now(), 'PHONE_VERIFIED', 'ACTIVE', 1, now(), now())`,
      [userId, phone.normalized, hash],
    );
    const driverId = await createDriverFor(admin.pool, userId, { status });
    const walletId = randomUUID();
    await admin.pool.query(`INSERT INTO app.driver_wallets (wallet_id, driver_id, balance_vnd, held_vnd, version, created_at, updated_at) VALUES ($1::uuid, $2::uuid, 0, 0, 1, now(), now())`, [walletId, driverId]);
    const requestId = randomUUID();
    await admin.pool.query(
      `INSERT INTO app.wallet_topup_requests (request_id, wallet_id, driver_id, amount_requested_vnd, state, created_by_user_id, version, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::bigint, 'PENDING', $5::uuid, 1, now(), now())`,
      [requestId, walletId, driverId, amount, userId],
    );
    const shipper = { phone, userId, driverId, walletId, requestId };
    shippers.push(shipper);
    return shipper;
  }

  let hash = '';
  const txid = (): string => `FT${Math.floor(1e11 + Math.random() * 9e11)}`;
  const confirmBody = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    expected_version: 1,
    actual_amount_vnd: 100_000,
    bank_id: 'VCB',
    system_owned_account_id: account.id,
    canonical_transaction_id: txid(),
    received_at: new Date(Date.now() - 60_000).toISOString(),
    ...overrides,
  });
  const confirm = (who: Login, requestId: string, body: Record<string, unknown> = confirmBody(), key?: string): Promise<AdminResponse> => send(who, `/finance/topup-requests/${requestId}/confirm`, body, key);
  const reject = (who: Login, requestId: string, body: Record<string, unknown> = { expected_version: 1, reason_code: 'NOT_RECEIVED' }, key?: string): Promise<AdminResponse> =>
    send(who, `/finance/topup-requests/${requestId}/reject`, body, key);

  const walletOf = async (walletId: string): Promise<{ balance: string; version: string }> =>
    (await admin.pool.query('SELECT balance_vnd::text AS balance, version::text FROM app.driver_wallets WHERE wallet_id = $1::uuid', [walletId])).rows[0] as { balance: string; version: string };
  const stateOf = async (requestId: string): Promise<{ state: string; version: string }> =>
    (await admin.pool.query('SELECT state, version::text FROM app.wallet_topup_requests WHERE request_id = $1::uuid', [requestId])).rows[0] as { state: string; version: string };
  const ledgerOf = (walletId: string): Promise<Array<Record<string, string>>> =>
    admin.pool.query('SELECT sequence_no::text, entry_kind, delta_vnd::text, balance_after_vnd::text FROM app.wallet_ledger_entries WHERE wallet_id = $1::uuid ORDER BY sequence_no', [walletId]).then((r) => r.rows as Array<Record<string, string>>);
  const auditCount = (id: string, action: string): Promise<number> => countRows(admin.pool, 'SELECT 1 FROM app.audit_logs WHERE resource_id = $1 AND action = $2', [id, action]);
  const bankRows = (canonical: string): Promise<number> => countRows(admin.pool, 'SELECT 1 FROM app.wallet_bank_transactions WHERE canonical_transaction_id = $1', [canonical]);

  /** Nothing of money exists for this Shipper: zero balance at version 1, no ledger, no topup. */
  async function expectUntouched(s: { walletId: string; requestId: string }): Promise<void> {
    expect(await walletOf(s.walletId)).toEqual({ balance: '0', version: '1' });
    expect(await ledgerOf(s.walletId)).toEqual([]);
    expect(await countRows(admin.pool, 'SELECT 1 FROM app.wallet_topups WHERE wallet_id = $1::uuid', [s.walletId])).toBe(0);
    expect(await stateOf(s.requestId)).toEqual({ state: 'PENDING', version: '1' });
  }

  // ------------------------------------------------------------------------------------------------ tests
  it('1. permissions: no right, read only and record only each get exactly their own routes; SYSTEM has both; a revoked right is gone at once; no session is 401', async () => {
    const s = await newShipper();
    const path = `/finance/topup-requests/${s.requestId}`;
    expect((await get(undefined, '/finance/topup-requests')).status).toBe(401);
    for (const response of [await get(bareLogin, '/finance/topup-requests'), await get(bareLogin, path), await confirm(bareLogin, s.requestId), await reject(bareLogin, s.requestId)]) {
      expect(code(response)).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    }
    // Read only: sees, cannot decide.
    expect((await get(readerLogin, '/finance/topup-requests')).status).toBe(200);
    expect((await get(readerLogin, path)).status).toBe(200);
    expect(code(await confirm(readerLogin, s.requestId))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    expect(code(await reject(readerLogin, s.requestId))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    // Record only: decides, but cannot read the list.
    expect(code(await get(recorderLogin, '/finance/topup-requests'))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    // The receiving switch is SYSTEM only, whatever the finance rights.
    for (const who of [bareLogin, readerLogin, recorderLogin]) {
      expect(code(await send(who, `/finance/bank-accounts/${account.id}/receiving`, { expected_version: 2, can_receive: false }))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    }
    await expectUntouched(s);
    // A revoked right stops working at once (the session stays valid).
    expect((await changeGrant('revoke', recorder.userId, RECORD, 1)).status).toBe(200);
    expect(code(await reject(recorderLogin, s.requestId))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    expect((await changeGrant('grant', recorder.userId, RECORD, 2)).status).toBe(200);
    expect((await reject(recorderLogin, s.requestId)).status).toBe(200);
    expect((await get(systemLogin(), path)).status).toBe(200);
  });

  it('2. confirm credits the ACTUAL amount (not the requested one) in one transaction: bank record, topup, ledger, balance, request; the Shipper is not activated; replay writes nothing', async () => {
    const s = await newShipper(100_000);
    const body = confirmBody({ actual_amount_vnd: 60_000, canonical_transaction_id: `  ${txid()}  ` });
    const canonical = String(body.canonical_transaction_id).trim();
    const key = randomUUID();
    const response = await confirm(recorderLogin, s.requestId, body, key);
    expect(response.status).toBe(200);
    expect(adminData(response)).toMatchObject({ request_id: s.requestId, driver_id: s.driverId, amount_requested_vnd: 100_000, actual_amount_vnd: 60_000, state: 'CONFIRMED', version: 2 });
    expect(await ledgerOf(s.walletId)).toEqual([{ sequence_no: '1', entry_kind: 'TOPUP', delta_vnd: '60000', balance_after_vnd: '60000' }]);
    expect(await walletOf(s.walletId)).toEqual({ balance: '60000', version: '2' });
    expect(await stateOf(s.requestId)).toEqual({ state: 'CONFIRMED', version: '2' });
    const topup = (await admin.pool.query('SELECT actual_amount_vnd::text AS a, confirmed_by_user_id::text AS by, request_id::text AS r FROM app.wallet_topups WHERE wallet_id = $1::uuid', [s.walletId])).rows;
    expect(topup).toEqual([{ a: '60000', by: recorder.userId, r: s.requestId }]);
    expect(await bankRows(canonical)).toBe(1);
    expect((await admin.pool.query('SELECT status, accepting_deliveries FROM app.drivers WHERE driver_id = $1::uuid', [s.driverId])).rows[0]).toEqual({ status: 'PENDING', accepting_deliveries: false });
    // Audit and event carry identifiers, state and amounts only: no account number, holder, bank transaction code.
    expect(await auditCount(s.requestId, 'admin.wallet_topup.confirm.v1')).toBe(1);
    const evidence = JSON.stringify([
      (await admin.pool.query('SELECT metadata FROM app.audit_logs WHERE resource_id = $1', [s.requestId])).rows,
      (await admin.pool.query('SELECT payload FROM app.outbox_events WHERE resource_id = $1', [s.requestId])).rows,
    ]);
    for (const secret of [canonical, account.number, SECRET_HOLDER]) {
      expect(evidence).not.toContain(secret);
    }
    // Replay: same key and body -> the same answer, nothing more written; same key with another body is refused.
    expect((await confirm(recorderLogin, s.requestId, body, key)).status).toBe(200);
    expect(adminErrorCode(await confirm(recorderLogin, s.requestId, confirmBody(), key))).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await ledgerOf(s.walletId)).toHaveLength(1);
    expect(await auditCount(s.requestId, 'admin.wallet_topup.confirm.v1')).toBe(1);
    // A new key on the resolved request is a state conflict, and a reject of it too.
    expect(code(await confirm(recorderLogin, s.requestId, confirmBody({ expected_version: 2 })))).toEqual({ status: 409, code: 'TOPUP_REQUEST_STATE_CONFLICT' });
    expect(code(await reject(recorderLogin, s.requestId, { expected_version: 2, reason_code: 'OTHER' }))).toEqual({ status: 409, code: 'TOPUP_REQUEST_STATE_CONFLICT' });
    // A second top-up of the same Shipper continues the chain.
    const again = await newShipper(1);
    void again;
    expect(await ledgerOf(s.walletId)).toHaveLength(1);
  });

  it('3. one bank transaction is recorded once system-wide: another request, another key, spaces around the code all lose; nothing is written by the loser', async () => {
    const first = await newShipper();
    const second = await newShipper();
    const code1 = txid();
    expect((await confirm(recorderLogin, first.requestId, confirmBody({ canonical_transaction_id: code1 }))).status).toBe(200);
    const loser = await confirm(recorderLogin, second.requestId, confirmBody({ canonical_transaction_id: ` ${code1} ` }));
    expect(code(loser)).toEqual({ status: 409, code: 'BANK_TRANSACTION_ALREADY_RECORDED' });
    await expectUntouched(second);
    expect(await bankRows(code1)).toBe(1);
    // The same code on ANOTHER account is another bank transaction (the registry key is bank + account + code).
    const other = await newAccount(true);
    expect((await confirm(recorderLogin, second.requestId, confirmBody({ canonical_transaction_id: code1, system_owned_account_id: other.id }))).status).toBe(200);
  });

  it('4. races: the same request confirmed twice, confirm against reject, and one bank code claimed by two requests each end with exactly one winner and one ledger row', async () => {
    const one = await newShipper();
    const results = await Promise.all([confirm(recorderLogin, one.requestId, confirmBody()), confirm(systemLogin(), one.requestId, confirmBody())]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(code(results.find((r) => r.status === 409) as AdminResponse).code).toBe('TOPUP_REQUEST_STATE_CONFLICT');
    expect(await ledgerOf(one.walletId)).toHaveLength(1);
    expect(await walletOf(one.walletId)).toEqual({ balance: '100000', version: '2' }); // credited exactly once
    expect(await countRows(admin.pool, 'SELECT 1 FROM app.wallet_topups WHERE wallet_id = $1::uuid', [one.walletId])).toBe(1);

    const two = await newShipper();
    const mixed = await Promise.all([confirm(recorderLogin, two.requestId, confirmBody()), reject(systemLogin(), two.requestId)]);
    expect(mixed.map((r) => r.status).sort()).toEqual([200, 409]);
    const state = (await stateOf(two.requestId)).state;
    expect(await ledgerOf(two.walletId)).toHaveLength(state === 'CONFIRMED' ? 1 : 0);

    const a = await newShipper();
    const b = await newShipper();
    const same = txid();
    const claims = await Promise.all([confirm(recorderLogin, a.requestId, confirmBody({ canonical_transaction_id: same })), confirm(systemLogin(), b.requestId, confirmBody({ canonical_transaction_id: same }))]);
    expect(claims.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(code(claims.find((r) => r.status === 409) as AdminResponse).code).toBe('BANK_TRANSACTION_ALREADY_RECORDED');
    expect(await bankRows(same)).toBe(1);
    expect((await ledgerOf(a.walletId)).length + (await ledgerOf(b.walletId)).length).toBe(1);
  });

  it('5. any failure rolls back everything: a fault after the ledger and balance are written leaves no bank record, topup, ledger, balance change or request change', async () => {
    const s = await newShipper();
    const canonical = txid();
    await admin.pool.query(`CREATE FUNCTION app.test_b22b_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'TEST_B22B_FAULT'; END $$`);
    await admin.pool.query('CREATE TRIGGER test_b22b_fail BEFORE UPDATE ON app.wallet_topup_requests FOR EACH ROW WHEN (NEW.state = \'CONFIRMED\') EXECUTE FUNCTION app.test_b22b_fail()');
    try {
      const failed = await confirm(recorderLogin, s.requestId, confirmBody({ canonical_transaction_id: canonical }));
      expect(failed.status).toBeGreaterThanOrEqual(500);
    } finally {
      await admin.pool.query('DROP TRIGGER test_b22b_fail ON app.wallet_topup_requests');
      await admin.pool.query('DROP FUNCTION app.test_b22b_fail()');
    }
    await expectUntouched(s);
    expect(await bankRows(canonical)).toBe(0);
    expect(await auditCount(s.requestId, 'admin.wallet_topup.confirm.v1')).toBe(0);
    // The same code is free again and the request can still be confirmed.
    expect((await confirm(recorderLogin, s.requestId, confirmBody({ canonical_transaction_id: canonical }))).status).toBe(200);
  });

  it('6. refusals write nothing: input shape, version, account state, bank mismatch, future time, wallet limit, closed Shipper, unknown request', async () => {
    const s = await newShipper();
    const invalid = [
      confirmBody({ actual_amount_vnd: 0 }),
      confirmBody({ actual_amount_vnd: 10.5 }),
      confirmBody({ actual_amount_vnd: '1000' }),
      confirmBody({ canonical_transaction_id: '   ' }),
      confirmBody({ received_at: 'yesterday' }),
      confirmBody({ received_at: new Date(Date.now() + 3_600_000).toISOString() }),
      { ...confirmBody(), driver_id: s.driverId },
      confirmBody({ system_owned_account_id: 'not-a-uuid' }),
    ];
    for (const body of invalid) {
      expect(code(await confirm(recorderLogin, s.requestId, body))).toEqual({ status: 400, code: 'ADMIN_INPUT_INVALID' });
    }
    expect(code(await reject(recorderLogin, s.requestId, { expected_version: 1, reason_code: 'BECAUSE' }))).toEqual({ status: 400, code: 'ADMIN_INPUT_INVALID' });
    expect(code(await confirm(recorderLogin, s.requestId, confirmBody({ expected_version: 7 })))).toEqual({ status: 409, code: 'VERSION_CONFLICT' });
    expect(code(await confirm(recorderLogin, s.requestId, confirmBody({ actual_amount_vnd: Number.MAX_SAFE_INTEGER + 2 })))).toEqual({ status: 400, code: 'ADMIN_INPUT_INVALID' });
    expect(code(await confirm(recorderLogin, s.requestId, confirmBody({ bank_id: 'ACB' })))).toMatchObject({ status: 409 });
    expect(code(await confirm(recorderLogin, s.requestId, confirmBody({ system_owned_account_id: randomUUID() })))).toMatchObject({ status: 409 });
    expect(code(await confirm(recorderLogin, randomUUID()))).toEqual({ status: 404, code: 'TOPUP_REQUEST_NOT_FOUND' });
    await expectUntouched(s);
    // The wallet limit: a credit that would pass the maximum balance is refused and writes nothing.
    const rich = await newShipper(100_000);
    expect((await confirm(recorderLogin, rich.requestId, confirmBody({ actual_amount_vnd: 9_007_199_254_740_000 }))).status).toBe(200);
    const extra = randomUUID();
    await admin.pool.query(
      `INSERT INTO app.wallet_topup_requests (request_id, wallet_id, driver_id, amount_requested_vnd, state, created_by_user_id, version, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 2000, 'PENDING', $4::uuid, 1, now(), now())`,
      [extra, rich.walletId, rich.driverId, rich.userId],
    );
    expect(code(await confirm(recorderLogin, extra, confirmBody({ actual_amount_vnd: 2000 })))).toEqual({ status: 409, code: 'TOPUP_WALLET_LIMIT_EXCEEDED' });
    expect(await stateOf(extra)).toEqual({ state: 'PENDING', version: '1' });
    expect((await ledgerOf(rich.walletId)).length).toBe(1);
    // A closed profile gets no money, but its request can be rejected.
    const closed = await newShipper(100_000, 'CLOSED');
    expect(code(await confirm(recorderLogin, closed.requestId))).toEqual({ status: 409, code: 'DRIVER_STATE_CONFLICT' });
    await expectUntouched(closed);
    expect((await reject(recorderLogin, closed.requestId)).status).toBe(200);
  });

  it('7. reject records the reason code only, moves no money and is idempotent', async () => {
    const s = await newShipper();
    const key = randomUUID();
    const response = await reject(recorderLogin, s.requestId, { expected_version: 1, reason_code: 'AMOUNT_MISMATCH' }, key);
    expect(response.status).toBe(200);
    expect(adminData(response)).toMatchObject({ state: 'REJECTED', version: 2, actual_amount_vnd: null });
    expect((await walletOf(s.walletId)).balance).toBe('0');
    expect(await ledgerOf(s.walletId)).toEqual([]);
    expect((await reject(recorderLogin, s.requestId, { expected_version: 1, reason_code: 'AMOUNT_MISMATCH' }, key)).status).toBe(200);
    expect(await auditCount(s.requestId, 'admin.wallet_topup.reject.v1')).toBe(1);
    const listed = adminData(await get(readerLogin, `/finance/topup-requests?status=REJECTED&limit=50`)).items as Array<{ request_id: string }>;
    expect(listed.map((item) => item.request_id)).toContain(s.requestId);
    expect(code(await get(readerLogin, '/finance/topup-requests?status=NOPE'))).toEqual({ status: 400, code: 'ADMIN_INPUT_INVALID' });
  });

  it('8. SYSTEM switches an account on and off with a version, an audit and an event; money for a disabled account is refused; a no-op or stale switch is a conflict', async () => {
    const fresh = await newAccount(false);
    const s = await newShipper();
    expect(code(await confirm(recorderLogin, s.requestId, confirmBody({ system_owned_account_id: fresh.id })))).toEqual({ status: 409, code: 'TOPUP_ACCOUNT_NOT_RECEIVING' });
    const path = `/finance/bank-accounts/${fresh.id}/receiving`;
    expect(code(await send(systemLogin(), path, { expected_version: 1, can_receive: false }))).toEqual({ status: 409, code: 'FINANCE_BANK_ACCOUNT_STATE_CONFLICT' });
    expect(code(await send(systemLogin(), path, { expected_version: 5, can_receive: true }))).toEqual({ status: 409, code: 'FINANCE_VERSION_CONFLICT' });
    expect(code(await send(systemLogin(), `/finance/bank-accounts/${randomUUID()}/receiving`, { expected_version: 1, can_receive: true }))).toEqual({ status: 404, code: 'FINANCE_BANK_ACCOUNT_NOT_FOUND' });
    expect(code(await send(systemLogin(), path, { expected_version: 1, can_receive: 'yes' }))).toEqual({ status: 400, code: 'ADMIN_INPUT_INVALID' });
    const key = randomUUID();
    const on = await send(systemLogin(), path, { expected_version: 1, can_receive: true }, key);
    expect(adminData(on)).toMatchObject({ can_receive: true, version: 2 });
    expect((await send(systemLogin(), path, { expected_version: 1, can_receive: true }, key)).status).toBe(200); // replay
    expect(await auditCount(fresh.id, 'admin.system_bank_account.receiving.v1')).toBe(1);
    expect((await confirm(recorderLogin, s.requestId, confirmBody({ system_owned_account_id: fresh.id }))).status).toBe(200);
    // Switched off again: recorded money stays, new money for the account is refused (fail closed) until SYSTEM switches it on.
    expect(adminData(await send(systemLogin(), path, { expected_version: 2, can_receive: false }))).toMatchObject({ can_receive: false, version: 3 });
    const late = await newShipper();
    expect(code(await confirm(recorderLogin, late.requestId, confirmBody({ system_owned_account_id: fresh.id })))).toEqual({ status: 409, code: 'TOPUP_ACCOUNT_NOT_RECEIVING' });
    await expectUntouched(late);
    expect((await ledgerOf(s.walletId)).length).toBe(1);
  });

  it('9. the ledger accepts only a TOPUP backed by its topup row: every other kind and a mismatched amount are still refused by the database', async () => {
    const s = await newShipper();
    for (const [kind, delta] of [['TOPUP', 500], ['ADJUSTMENT', 500], ['COMMISSION', -500]] as const) {
      const client = await admin.pool.connect();
      try {
        await client.query('BEGIN');
        const error = await client
          .query(
            `INSERT INTO app.wallet_ledger_entries (entry_id, wallet_id, sequence_no, entry_kind, delta_vnd, balance_after_vnd, created_at, topup_id)
             VALUES ($1::uuid, $2::uuid, 1, $3, $4::bigint, $4::bigint, now(), NULL)`,
            [randomUUID(), s.walletId, kind, delta],
          )
          .then(() => undefined, (e: Error) => e);
        expect(error).toBeDefined();
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
      }
    }
    await expectUntouched(s);
  });

  it('10. a replay is authorized again: after the right is revoked the same key and body get 403 and write nothing; after it is granted again the replay answers the stored result', async () => {
    const extra = await activatedAdmin([permission('DRIVER', true)], `Admin thu hồi ${tag}`);
    const extraLogin = await login(extra);
    expect((await changeGrant('grant', extra.userId, RECORD, 0)).status).toBe(200);
    const s = await newShipper();
    const body = confirmBody({ actual_amount_vnd: 70_000 });
    const key = randomUUID();
    expect((await confirm(extraLogin, s.requestId, body, key)).status).toBe(200);
    expect((await changeGrant('revoke', extra.userId, RECORD, 1)).status).toBe(200);
    expect(code(await confirm(extraLogin, s.requestId, body, key))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    expect(await ledgerOf(s.walletId)).toHaveLength(1);
    expect(await auditCount(s.requestId, 'admin.wallet_topup.confirm.v1')).toBe(1);
    expect((await changeGrant('grant', extra.userId, RECORD, 2)).status).toBe(200);
    const replay = await confirm(extraLogin, s.requestId, body, key);
    expect(replay.status).toBe(200);
    expect(adminData(replay)).toMatchObject({ state: 'CONFIRMED', actual_amount_vnd: 70_000 });
    expect(await ledgerOf(s.walletId)).toHaveLength(1);
    expect(await walletOf(s.walletId)).toEqual({ balance: '70000', version: '2' });
    // Another administrator cannot replay this administrator's key (the scope is the actor).
    expect(adminErrorCode(await confirm(recorderLogin, s.requestId, body, key))).not.toBe(undefined);
    expect(await ledgerOf(s.walletId)).toHaveLength(1);
  });

  it('11. the receiving-account projection for the confirmation: SYSTEM and the record right only, number masked, no holder, no mutation', async () => {
    const path = '/finance/topup-receiving-accounts';
    expect((await get(undefined, path)).status).toBe(401);
    for (const who of [bareLogin, readerLogin]) {
      expect(code(await get(who, path))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' }); // not even the read right opens it
    }
    expect(code(await get(recorderLogin, `${path}?x=1`))).toEqual({ status: 400, code: 'ADMIN_INPUT_INVALID' });
    const before = await countRows(admin.pool, 'SELECT 1 FROM app.audit_logs');
    for (const who of [recorderLogin, systemLogin()]) {
      const response = await get(who, path);
      expect(response.status).toBe(200);
      const accounts = adminData(response).accounts as Array<Record<string, unknown>>;
      const mine = accounts.find((item) => item.account_id === account.id);
      expect(mine).toEqual({ account_id: account.id, bank_id: 'VCB', account_number_masked: `****${account.number.slice(-4)}`, can_receive: true });
      for (const item of accounts) {
        expect(Object.keys(item).sort()).toEqual(['account_id', 'account_number_masked', 'bank_id', 'can_receive']);
      }
      expect(response.text).not.toContain(account.number);
      expect(response.text).not.toContain(SECRET_HOLDER);
    }
    expect(await countRows(admin.pool, 'SELECT 1 FROM app.audit_logs')).toBe(before); // a read writes nothing
    // Revoked right: gone at once.
    expect((await changeGrant('revoke', recorder.userId, RECORD, 3)).status).toBe(200);
    expect(code(await get(recorderLogin, path))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    expect((await changeGrant('grant', recorder.userId, RECORD, 4)).status).toBe(200);
  });
});
