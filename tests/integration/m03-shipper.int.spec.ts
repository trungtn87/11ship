import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ADMIN_SESSION_COOKIE } from '../../apps/backend/src/admin-auth/admin-auth-constants';
import { DRIVER_WALLET_PORT, DriverWalletPort, WalletReadiness, WalletSettlement } from '../../apps/backend/src/driver/driver-wallet-port';
import {
  ADMIN_PASSWORD,
  AdminApp,
  adminData,
  adminErrorCode,
  AdminResponse,
  cookieFrom,
  loginStep,
  preauthCookies,
  rewindAcceptedStep,
  sessionCookies,
  startAdminApp,
  totpNow,
} from './support/admin-fixtures';
import { begin, ok, post } from './support/activation-fixtures';
import {
  ApiResponse,
  AuthApp,
  countRows,
  createDriverFor,
  dataOf,
  errorCode,
  obtainProof,
  PASSWORD,
  Phone,
  randomPhone,
  startAuthApp,
} from './support/auth-fixtures';
import { createInvitation, createPayload, systemSession, SystemSession } from './support/provisioning-fixtures';

// M03 — Shipper management on a REAL Nest pipeline and PostgreSQL: the Shipper's own profile / bank / submit / accepting / closure
// commands (Bearer client session), the administration web commands and reads (cookie + CSRF), the wallet parameters, the safe
// blocks that wait for M04, and the privacy of the internal classification. Two applications share the one test database: the
// "client" one (with a controllable stand-in for the M04 wallet port, the only provider replaced) and the administration one.

const TERMS = 'test-terms-20261011-v1';
const PRIVACY = 'test-privacy-20261011-v1';
const WEB_SHIP = { device_id: 'web-ship-0001', platform: 'WEB', app: 'SHIP' };
const WEB_FOOD = { device_id: 'web-food-0001', platform: 'WEB', app: 'FOOD' };
const tag = randomBytes(3).toString('hex').toUpperCase();

/** The M04 wallet as a test can control it: nothing is real, the flags only say what M04 would answer. */
const wallet = { ready: false, settled: false };
const walletPort: DriverWalletPort = {
  readinessForOrders: (): Promise<WalletReadiness> => Promise.resolve(wallet.ready ? { ready: true } : { ready: false, reason: 'WALLET_NOT_AVAILABLE' }),
  settlementForClosure: (): Promise<WalletSettlement> => Promise.resolve(wallet.settled ? { settled: true } : { settled: false, reason: 'BALANCE_REMAINING' }),
};

interface Shipper {
  readonly phone: Phone;
  readonly userId: string;
  readonly token: string;
  readonly driverId: string;
}
interface AdminLogin {
  readonly cookie: string;
  readonly csrf: string;
}
interface ActivatedAdmin {
  readonly phone: Phone;
  readonly userId: string;
  readonly secret: string;
}

const permission = (app: string, view: boolean, review: boolean, lock: boolean): Record<string, unknown> => ({
  app,
  can_view: view,
  can_review_profile: review,
  can_lock: lock,
});

describe('M03 — Shipper management', () => {
  let client: AuthApp;
  let admin: AdminApp;
  let system: SystemSession;
  let reviewer: AdminLogin;
  let viewer: AdminLogin;
  let lockOnly: AdminLogin;
  let noDriverRight: AdminLogin;
  let reviewerUser: ActivatedAdmin;

  beforeAll(async () => {
    client = await startAuthApp({}, { relaxTimeouts: true, configOverride: { clientAuth: { termsVersion: TERMS, privacyVersion: PRIVACY } }, overrides: [{ provide: DRIVER_WALLET_PORT, useValue: walletPort }] });
    admin = await startAdminApp({ activationDisabledTest: true, overrides: [{ provide: DRIVER_WALLET_PORT, useValue: walletPort }] });
    system = await systemSession(admin);
    reviewerUser = await activatedAdmin([permission('DRIVER', true, true, false)], `Duyệt Shipper ${tag}`);
    reviewer = await login(reviewerUser);
    viewer = await login(await activatedAdmin([permission('DRIVER', true, false, false)], `Xem Shipper ${tag}`));
    lockOnly = await login(await activatedAdmin([permission('DRIVER', true, false, true)], `Khóa Shipper ${tag}`));
    noDriverRight = await login(await activatedAdmin([permission('SHOP', true, false, false)], `Quán ${tag}`));
  });

  afterAll(async () => {
    // Order matters for the foreign keys: the Shippers (and their bank accounts / history) go with their own accounts first, then
    // whatever points at the administrators (the parameter change log) is removed, and only then the administrators themselves.
    await client.close();
    await admin.pool.query('DELETE FROM app.shipper_wallet_parameter_changes');
    await admin.pool.query('UPDATE app.shipper_wallet_parameters SET updated_by = NULL');
    await admin.close();
  });

  // ------------------------------------------------------------------------------------------------ helpers (admin)

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

  async function login(who: ActivatedAdmin): Promise<AdminLogin> {
    const preauth = await loginStep(admin, { phone: who.phone, password: ADMIN_PASSWORD, userId: who.userId });
    await rewindAcceptedStep(admin, who.userId);
    const verified = await admin.call('POST', '/totp/verify', { body: { code: totpNow(who.secret) }, cookies: preauthCookies(preauth), csrf: preauth.csrf });
    if (verified.status !== 200) {
      throw new Error(`admin login failed: ${verified.status} ${verified.text}`);
    }
    return { cookie: String(cookieFrom(verified, ADMIN_SESSION_COOKIE)), csrf: String(adminData(verified).csrf_token) };
  }

  const systemLogin = (): AdminLogin => ({ cookie: system.login.cookie, csrf: system.login.csrf });

  const adminGet = (who: AdminLogin | undefined, path: string): Promise<AdminResponse> =>
    admin.call('GET', path, { basePath: '/v1/admin', ...(who === undefined ? {} : { cookies: sessionCookies(who) }) });

  async function adminPost(who: AdminLogin, path: string, body: unknown, options: { key?: string; csrf?: string | null } = {}): Promise<AdminResponse> {
    // The ingress quota (30 POST per minute per address, shared with login) is not under test here.
    await admin.clearLimits();
    return admin.call('POST', path, {
      basePath: '/v1/admin',
      body,
      cookies: sessionCookies(who),
      ...(options.csrf === null ? {} : { csrf: options.csrf ?? who.csrf }),
      headers: { 'idempotency-key': options.key ?? randomUUID() },
    });
  }

  const codeOf = (response: AdminResponse): { status: number; code: string | undefined } => ({ status: response.status, code: adminErrorCode(response) });
  const command = (who: AdminLogin, driverId: string, name: string, body: unknown, options: { key?: string } = {}): Promise<AdminResponse> =>
    adminPost(who, `/shippers/${driverId}/${name}`, body, options);

  // ------------------------------------------------------------------------------------------------ helpers (Shipper)

  async function newShipper(name = `Nguyễn Văn Shipper ${tag}`): Promise<Shipper> {
    const phone = randomPhone();
    const proof = await obtainProof(client, phone);
    const registered = await client.call('POST', '/client-auth/register', {
      headers: { 'idempotency-key': randomUUID() },
      body: {
        phone: phone.local,
        password: PASSWORD,
        verification_token: proof.proofToken,
        device: { ...WEB_FOOD },
        full_name: name,
        consent: { terms_version: TERMS, privacy_version: PRIVACY },
      },
    });
    expect(registered.status).toBe(201);
    const userId = String(dataOf(registered).user_id);
    const loggedIn = await client.call('POST', '/client-auth/login', {
      headers: { 'idempotency-key': randomUUID() },
      body: { phone: phone.local, password: PASSWORD, device: { ...WEB_SHIP } },
    });
    expect(loggedIn.status).toBe(200);
    const token = String(dataOf(loggedIn).access_token);
    const created = await client.call('POST', '/onboarding/driver', { bearer: token, headers: { 'idempotency-key': randomUUID() }, body: { full_name: name, plate_number: '59X1-123.45' } });
    expect(created.status).toBe(201);
    return { phone, userId, token, driverId: String(dataOf(created).driver_id) };
  }

  const mine = async (s: Shipper): Promise<Record<string, unknown>> => dataOf(await client.call('GET', '/driver/me', { bearer: s.token }));
  const versionOf = async (s: Shipper): Promise<number> => Number((await mine(s)).version);

  function put(s: Shipper, path: string, body: unknown, key = randomUUID()): Promise<ApiResponse> {
    return client.call('PUT', path, { bearer: s.token, headers: { 'idempotency-key': key }, body });
  }
  function send(s: Shipper, path: string, body: unknown, key = randomUUID()): Promise<ApiResponse> {
    return client.call('POST', path, { bearer: s.token, headers: { 'idempotency-key': key }, body });
  }
  const bankBody = (version: number, overrides: Record<string, unknown> = {}, holder = `NGUYEN VAN SHIPPER ${tag}`): Record<string, unknown> => ({
    expected_version: version,
    bank_code: 'VCB',
    account_number: '0123456789',
    account_holder: holder,
    ...overrides,
  });
  const saveBank = async (s: Shipper, overrides: Record<string, unknown> = {}, holder?: string): Promise<ApiResponse> => put(s, '/driver/me/bank', bankBody(await versionOf(s), overrides, holder));
  const submit = async (s: Shipper): Promise<ApiResponse> => send(s, '/driver/me/submit', { expected_version: await versionOf(s) });
  const setAccepting = async (s: Shipper, accepting: boolean): Promise<ApiResponse> => send(s, '/driver/me/accepting', { expected_version: await versionOf(s), accepting });

  /** A Shipper with a bank account that has been submitted, and the version the administrator will see. */
  async function submitted(): Promise<Shipper> {
    const s = await newShipper();
    expect((await saveBank(s)).status).toBe(200);
    expect((await submit(s)).status).toBe(200);
    return s;
  }

  async function approved(verifiedBank = true): Promise<Shipper> {
    const s = await submitted();
    expect((await command(reviewer, s.driverId, 'approve', { expected_version: await versionOf(s) })).status).toBe(200);
    if (verifiedBank) {
      expect((await command(reviewer, s.driverId, 'bank/verify', { expected_version: await versionOf(s) })).status).toBe(200);
    }
    return s;
  }

  const row = async (driverId: string): Promise<Record<string, unknown>> =>
    (await admin.pool.query('SELECT * FROM app.drivers WHERE driver_id = $1::uuid', [driverId])).rows[0] as Record<string, unknown>;
  const bankRow = async (driverId: string): Promise<Record<string, unknown> | undefined> =>
    (await admin.pool.query('SELECT * FROM app.driver_bank_accounts WHERE driver_id = $1::uuid', [driverId])).rows[0] as Record<string, unknown> | undefined;
  const audits = (driverId: string, action: string): Promise<number> => countRows(admin.pool, 'SELECT 1 FROM app.audit_logs WHERE resource_id = $1 AND action = $2', [driverId, action]);
  const history = (driverId: string, type: string): Promise<number> => countRows(admin.pool, 'SELECT 1 FROM app.driver_events WHERE driver_id = $1::uuid AND event_type = $2', [driverId, type]);

  // ------------------------------------------------------------------------------------------------ M03-A

  describe('M03-A — profile and bank account', () => {
    it('shows the name and phone of the account, a Shipper code and no internal classification', async () => {
      const s = await newShipper();
      const me = await mine(s);
      expect(me).toMatchObject({ driver_id: s.driverId, full_name: `Nguyễn Văn Shipper ${tag}`, status: 'PENDING', review_state: 'DRAFT', accepting_deliveries: false, bank: null, can_submit: true });
      expect(String(me.phone)).toBe(s.phone.normalized);
      expect(String(me.shipper_code)).toMatch(/^SH[0-9]{6,}$/);
      expect(JSON.stringify(me)).not.toMatch(/driver_type|PLATFORM|EXTERNAL/);
    });

    it('does not submit a profile without a bank account, and refuses a holder that is not the Shipper', async () => {
      const s = await newShipper();
      expect(errorCode(await submit(s))).toBe('DRIVER_PROFILE_INCOMPLETE');
      expect(errorCode(await saveBank(s, {}, 'TRAN THI KHAC'))).toBe('BANK_HOLDER_MISMATCH');
      expect(await bankRow(s.driverId)).toBeUndefined();
      expect((await row(s.driverId)).review_state).toBe('DRAFT');
    });

    it('accepts a holder written like the bank prints it (capitals, no marks) and starts UNVERIFIED', async () => {
      const s = await newShipper();
      const saved = await saveBank(s);
      expect(saved.status).toBe(200);
      expect(dataOf(saved).bank).toMatchObject({ bank_code: 'VCB', bank_name: 'Vietcombank', verification_state: 'UNVERIFIED' });
      expect((await bankRow(s.driverId))?.verification_state).toBe('UNVERIFIED');
    });

    it('refuses an unknown bank, a short number and any key the contract does not know (no status, type or review state from a client)', async () => {
      const s = await newShipper();
      const v = await versionOf(s);
      for (const bad of [
        bankBody(v, { bank_code: 'NOPE' }),
        bankBody(v, { account_number: '123' }),
        bankBody(v, { account_number: '12345abc90' }),
        { ...bankBody(v), verification_state: 'VERIFIED' },
        { ...bankBody(v), driver_type: 'PLATFORM' },
      ]) {
        const response = await put(s, '/driver/me/bank', bad);
        expect([response.status, errorCode(response)]).toEqual([400, 'BAD_REQUEST']);
      }
      const profile = await put(s, '/driver/me/profile', { expected_version: v, full_name: 'Nguyễn Văn A', plate_number: null, driver_type: 'PLATFORM' });
      expect([profile.status, errorCode(profile)]).toEqual([400, 'BAD_REQUEST']);
      expect((await row(s.driverId)).driver_type).toBe('EXTERNAL');
    });

    it('submits once: a second submit, and a stale version, are refused; the state is SUBMITTED', async () => {
      const s = await newShipper();
      await saveBank(s);
      const v = await versionOf(s);
      expect((await send(s, '/driver/me/submit', { expected_version: v })).status).toBe(200);
      expect(errorCode(await send(s, '/driver/me/submit', { expected_version: v }))).toBe('VERSION_CONFLICT');
      expect(errorCode(await send(s, '/driver/me/submit', { expected_version: await versionOf(s) }))).toBe('DRIVER_STATE_CONFLICT');
      expect(await mine(s)).toMatchObject({ review_state: 'SUBMITTED', can_edit_profile: false });
      expect(await history(s.driverId, 'driver.submitted')).toBe(1);
      expect(await audits(s.driverId, 'driver.profile.submit.v1')).toBe(1);
    });

    it('replays a lost answer from the stored result without a second change', async () => {
      const s = await newShipper();
      await saveBank(s);
      const v = await versionOf(s);
      const key = randomUUID();
      const first = await send(s, '/driver/me/submit', { expected_version: v }, key);
      const again = await send(s, '/driver/me/submit', { expected_version: v }, key);
      expect([first.status, again.status]).toEqual([200, 200]);
      expect(dataOf(again).version).toBe(dataOf(first).version);
      expect(await history(s.driverId, 'driver.submitted')).toBe(1);
    });

    it('does not let the name change while the profile is under review, but the plate can', async () => {
      const s = await submitted();
      const v = await versionOf(s);
      expect(errorCode(await put(s, '/driver/me/profile', { expected_version: v, full_name: 'Tên Khác', plate_number: null }))).toBe('DRIVER_PROFILE_LOCKED');
      const plate = await put(s, '/driver/me/profile', { expected_version: v, full_name: `Nguyễn Văn Shipper ${tag}`, plate_number: '60A-999.99' });
      expect(plate.status).toBe(200);
      expect(dataOf(plate).plate_number).toBe('60A-999.99');
    });
  });

  // ------------------------------------------------------------------------------------------------ admin review

  describe('Web Admin — list, detail, review', () => {
    it('lists Shippers and finds them by name (without marks), phone and code; filters by state; shows the classification only here', async () => {
      const s = await submitted();
      const code = String((await mine(s)).shipper_code);
      for (const q of [`shipper ${tag}`.toLowerCase(), s.phone.local, code]) {
        const found = await adminGet(reviewer, `/shippers?q=${encodeURIComponent(q)}`);
        expect(found.status).toBe(200);
        const items = adminData(found).items as Array<Record<string, unknown>>;
        expect(items.some((item) => item.driver_id === s.driverId)).toBe(true);
      }
      const filtered = await adminGet(reviewer, `/shippers?status=SUBMITTED&q=${tag}`);
      const items = adminData(filtered).items as Array<Record<string, unknown>>;
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((item) => item.review_state === 'SUBMITTED' && item.driver_type === 'EXTERNAL')).toBe(true);
      expect(codeOf(await adminGet(reviewer, '/shippers?status=NOPE'))).toEqual({ status: 400, code: 'ADMIN_INPUT_INVALID' });
    });

    it('shows the profile, the bank account, the readiness and the history of one Shipper', async () => {
      const s = await submitted();
      const detail = adminData(await adminGet(viewer, `/shippers/${s.driverId}`));
      expect(detail).toMatchObject({ driver_id: s.driverId, driver_type: 'EXTERNAL', review_state: 'SUBMITTED', bank: { bank_code: 'VCB', account_number: '0123456789', verification_state: 'UNVERIFIED' } });
      expect((detail.history as Array<Record<string, unknown>>).map((event) => event.event_type)).toContain('driver.submitted');
    });

    it('does not approve a profile that was not sent, and one without a bank account', async () => {
      const draft = await newShipper();
      expect(codeOf(await command(reviewer, draft.driverId, 'approve', { expected_version: await versionOf(draft) }))).toEqual({ status: 409, code: 'DRIVER_STATE_CONFLICT' });
      // A profile sent for review whose bank account vanished (older data) is incomplete, never approved.
      const odd = await submitted();
      await admin.pool.query('DELETE FROM app.driver_bank_accounts WHERE driver_id = $1::uuid', [odd.driverId]);
      expect(codeOf(await command(reviewer, odd.driverId, 'approve', { expected_version: await versionOf(odd) }))).toEqual({ status: 409, code: 'DRIVER_PROFILE_INCOMPLETE' });
      expect((await row(odd.driverId)).status).toBe('PENDING');
    });

    it('approves: the Shipper becomes ACTIVE but does not take orders by itself', async () => {
      const s = await submitted();
      const response = await command(reviewer, s.driverId, 'approve', { expected_version: await versionOf(s) });
      expect(response.status).toBe(200);
      expect(adminData(response)).toMatchObject({ status: 'ACTIVE', review_state: 'APPROVED', accepting_deliveries: false });
      expect(await audits(s.driverId, 'admin.shipper.approve.v1')).toBe(1);
      expect(await history(s.driverId, 'driver.approved')).toBe(1);
      expect((await row(s.driverId)).reviewed_by).toBe(reviewerUser.userId);
    });

    it('two administrators approving at once: one wins, the other is refused', async () => {
      const s = await submitted();
      const v = await versionOf(s);
      const results = await Promise.all([command(reviewer, s.driverId, 'approve', { expected_version: v }), command(systemLogin(), s.driverId, 'approve', { expected_version: v })]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await history(s.driverId, 'driver.approved')).toBe(1);
    });

    it('rejects only with a reason; the Shipper sees it, edits and sends again', async () => {
      const s = await submitted();
      const v = await versionOf(s);
      expect(codeOf(await command(reviewer, s.driverId, 'reject', { expected_version: v }))).toEqual({ status: 400, code: 'ADMIN_INPUT_INVALID' });
      expect(codeOf(await command(reviewer, s.driverId, 'reject', { expected_version: v, reason: '   ' }))).toEqual({ status: 400, code: 'ADMIN_INPUT_INVALID' });
      expect((await command(reviewer, s.driverId, 'reject', { expected_version: v, reason: 'Tên chủ tài khoản chưa rõ' })).status).toBe(200);
      expect(await mine(s)).toMatchObject({ status: 'PENDING', review_state: 'REJECTED', rejection_reason: 'Tên chủ tài khoản chưa rõ', can_edit_profile: true });
      // Fix the bank account and send again.
      expect((await saveBank(s, { account_number: '9876543210' })).status).toBe(200);
      expect((await submit(s)).status).toBe(200);
      expect(await mine(s)).toMatchObject({ review_state: 'SUBMITTED', rejection_reason: null });
      expect(await history(s.driverId, 'driver.rejected')).toBe(1);
      expect(await history(s.driverId, 'driver.submitted')).toBe(2);
    });

    it('verifies a bank account; changing the bank takes the verification away and stops receiving orders; a rejected account needs a reason', async () => {
      wallet.ready = true;
      try {
        const s = await approved();
        expect((await bankRow(s.driverId))?.verification_state).toBe('VERIFIED');
        expect((await setAccepting(s, true)).status).toBe(200);
        const changed = await saveBank(s, { bank_code: 'TCB', account_number: '1112223334' });
        expect(changed.status).toBe(200);
        expect(dataOf(changed)).toMatchObject({ accepting_deliveries: false, bank: { bank_code: 'TCB', verification_state: 'UNVERIFIED' } });
        expect(errorCode(await setAccepting(s, true))).toBe('DRIVER_BANK_NOT_VERIFIED');
        expect(codeOf(await command(reviewer, s.driverId, 'bank/reject', { expected_version: await versionOf(s) }))).toEqual({ status: 400, code: 'ADMIN_INPUT_INVALID' });
        expect((await command(reviewer, s.driverId, 'bank/reject', { expected_version: await versionOf(s), reason: 'Số tài khoản không tồn tại' })).status).toBe(200);
        expect((await mine(s)).bank).toMatchObject({ verification_state: 'REJECTED', rejection_reason: 'Số tài khoản không tồn tại' });
      } finally {
        wallet.ready = false;
      }
    });

    it('keeps the same bank data VERIFIED when it is saved again unchanged', async () => {
      const s = await approved();
      const v = await versionOf(s);
      const again = await saveBank(s);
      expect(again.status).toBe(200);
      expect(await versionOf(s)).toBe(v);
      expect((await bankRow(s.driverId))?.verification_state).toBe('VERIFIED');
    });
  });

  // ------------------------------------------------------------------------------------------------ M03-B

  describe('M03-B — receiving orders', () => {
    it('refuses to switch on until the profile is approved, the bank verified and the wallet ready — decided by the server', async () => {
      const draft = await newShipper();
      expect(errorCode(await setAccepting(draft, true))).toBe('DRIVER_NOT_ACTIVE');
      const s = await approved(false);
      expect(errorCode(await setAccepting(s, true))).toBe('DRIVER_BANK_NOT_VERIFIED');
      await command(reviewer, s.driverId, 'bank/verify', { expected_version: await versionOf(s) });
      // M04 has not provided a wallet: blocked, with a clear reason, and nothing is invented.
      expect(errorCode(await setAccepting(s, true))).toBe('DRIVER_WALLET_NOT_READY');
      expect((await row(s.driverId)).accepting_deliveries).toBe(false);
      const readiness = (await mine(s)).readiness as Record<string, unknown>;
      expect(readiness).toMatchObject({ profile_approved: true, bank_verified: true, wallet_ready: false, can_accept: false });
      expect(readiness.blocks).toEqual(['WALLET_NOT_AVAILABLE']);
    });

    it('switches on when every condition holds and off at any time without touching anything else', async () => {
      wallet.ready = true;
      try {
        const s = await approved();
        const on = await setAccepting(s, true);
        expect(on.status).toBe(200);
        expect(dataOf(on).accepting_deliveries).toBe(true);
        const off = await setAccepting(s, false);
        expect(dataOf(off)).toMatchObject({ accepting_deliveries: false, status: 'ACTIVE' });
        // Already off: the same answer, no new version, no history.
        const v = await versionOf(s);
        expect((await setAccepting(s, false)).status).toBe(200);
        expect(await versionOf(s)).toBe(v);
        expect(await history(s.driverId, 'driver.accepting_off')).toBe(1);
      } finally {
        wallet.ready = false;
      }
    });

    it('a suspension stops receiving orders, keeps the profile, needs a reason and can be reopened only with a verified bank', async () => {
      wallet.ready = true;
      try {
        const s = await approved();
        await setAccepting(s, true);
        const v = await versionOf(s);
        expect(codeOf(await command(lockOnly, s.driverId, 'lock', { expected_version: v }))).toEqual({ status: 400, code: 'ADMIN_INPUT_INVALID' });
        const locked = await command(lockOnly, s.driverId, 'lock', { expected_version: v, reason: 'Khiếu nại giao hàng' });
        expect(locked.status).toBe(200);
        expect(adminData(locked)).toMatchObject({ status: 'SUSPENDED', accepting_deliveries: false, suspension_reason: 'Khiếu nại giao hàng' });
        expect(await mine(s)).toMatchObject({ status: 'SUSPENDED', suspension_reason: 'Khiếu nại giao hàng' });
        expect(errorCode(await setAccepting(s, true))).toBe('DRIVER_NOT_ACTIVE');
        // The bank account and the profile are untouched by the suspension.
        expect((await bankRow(s.driverId))?.verification_state).toBe('VERIFIED');
        expect(await history(s.driverId, 'driver.suspended')).toBe(1);

        const reopened = await command(lockOnly, s.driverId, 'unlock', { expected_version: await versionOf(s) });
        expect(adminData(reopened)).toMatchObject({ status: 'ACTIVE', accepting_deliveries: false, suspension_reason: null });
        // Reopening does not switch receiving back on by itself.
        expect((await setAccepting(s, true)).status).toBe(200);
      } finally {
        wallet.ready = false;
      }
    });

    it('does not reopen a Shipper whose bank account is not verified', async () => {
      const s = await approved();
      await command(lockOnly, s.driverId, 'lock', { expected_version: await versionOf(s), reason: 'Kiểm tra' });
      await saveBank(s, { account_number: '5555666677' });
      expect(codeOf(await command(lockOnly, s.driverId, 'unlock', { expected_version: await versionOf(s) }))).toEqual({ status: 409, code: 'DRIVER_BANK_NOT_VERIFIED' });
      expect((await row(s.driverId)).status).toBe('SUSPENDED');
    });
  });

  describe('M03-B — stopping activity', () => {
    it('a request stops new orders at once; it can be cancelled; the profile and bank stay', async () => {
      wallet.ready = true;
      try {
        const s = await approved();
        await setAccepting(s, true);
        const requested = await send(s, '/driver/me/closure-request', { expected_version: await versionOf(s), note: 'Nghỉ việc' });
        expect(requested.status).toBe(200);
        expect(dataOf(requested)).toMatchObject({ status: 'CLOSING', accepting_deliveries: false, closure: { note: 'Nghỉ việc', can_cancel: true } });
        expect(errorCode(await setAccepting(s, true))).toBe('DRIVER_NOT_ACTIVE');
        expect(errorCode(await send(s, '/driver/me/closure-request', { expected_version: await versionOf(s), note: null }))).toBe('DRIVER_STATE_CONFLICT');
        const cancelled = await send(s, '/driver/me/closure-cancel', { expected_version: await versionOf(s) });
        expect(dataOf(cancelled)).toMatchObject({ status: 'ACTIVE', accepting_deliveries: false, closure: null });
        expect((await bankRow(s.driverId))?.verification_state).toBe('VERIFIED');
      } finally {
        wallet.ready = false;
      }
    });

    it('is closed by an administrator only once the wallet is settled; until then it stays CLOSING and nothing is lost', async () => {
      const s = await approved();
      await send(s, '/driver/me/closure-request', { expected_version: await versionOf(s), note: null });
      // M04 absent / balance remaining: blocked, nothing changes.
      expect(codeOf(await command(reviewer, s.driverId, 'closure/finalize', { expected_version: await versionOf(s) }))).toEqual({ status: 409, code: 'DRIVER_WALLET_NOT_SETTLED' });
      expect((await row(s.driverId)).status).toBe('CLOSING');
      wallet.settled = true;
      try {
        const closed = await command(reviewer, s.driverId, 'closure/finalize', { expected_version: await versionOf(s) });
        expect(adminData(closed)).toMatchObject({ status: 'CLOSED', accepting_deliveries: false });
      } finally {
        wallet.settled = false;
      }
      expect((await bankRow(s.driverId))?.verification_state).toBe('VERIFIED');
      expect(await history(s.driverId, 'driver.closed')).toBe(1);
    });

    it('an administrator can decline the request with a reason: the Shipper goes back to ACTIVE', async () => {
      const s = await approved();
      await send(s, '/driver/me/closure-request', { expected_version: await versionOf(s), note: null });
      expect(codeOf(await command(reviewer, s.driverId, 'closure/reject', { expected_version: await versionOf(s) }))).toEqual({ status: 400, code: 'ADMIN_INPUT_INVALID' });
      const declined = await command(reviewer, s.driverId, 'closure/reject', { expected_version: await versionOf(s), reason: 'Còn đơn đang giao' });
      expect(adminData(declined)).toMatchObject({ status: 'ACTIVE', closure: null });
    });
  });

  // ------------------------------------------------------------------------------------------------ classification

  describe('internal classification (PLATFORM / EXTERNAL)', () => {
    it('is set only by an administrator with the review right, shown only on the web admin and never reaches a client or a role', async () => {
      const s = await approved();
      const rolesBefore = (await admin.pool.query('SELECT role FROM app.user_roles WHERE user_id = $1::uuid ORDER BY role', [s.userId])).rows;
      expect(codeOf(await command(lockOnly, s.driverId, 'classification', { expected_version: await versionOf(s), driver_type: 'PLATFORM' }))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
      expect(codeOf(await command(reviewer, s.driverId, 'classification', { expected_version: await versionOf(s), driver_type: 'SYSTEM' }))).toEqual({ status: 400, code: 'ADMIN_INPUT_INVALID' });
      const set = await command(reviewer, s.driverId, 'classification', { expected_version: await versionOf(s), driver_type: 'PLATFORM' });
      expect(adminData(set)).toMatchObject({ driver_type: 'PLATFORM' });
      expect(await history(s.driverId, 'driver.classified')).toBe(1);
      // The Shipper learns nothing: not from the profile, not from a command answer.
      expect(JSON.stringify(await mine(s))).not.toMatch(/PLATFORM|driver_type/);
      const touched = await saveBank(s, { account_number: '2223334445' });
      expect(JSON.stringify(dataOf(touched))).not.toMatch(/PLATFORM|driver_type/);
      // No administration right comes with it.
      expect((await admin.pool.query('SELECT role FROM app.user_roles WHERE user_id = $1::uuid ORDER BY role', [s.userId])).rows).toEqual(rolesBefore);
      expect(await countRows(admin.pool, 'SELECT 1 FROM app.admin_memberships WHERE user_id = $1::uuid', [s.userId])).toBe(0);
      // Setting the same value again changes nothing.
      const v = await versionOf(s);
      await command(reviewer, s.driverId, 'classification', { expected_version: v, driver_type: 'PLATFORM' });
      expect(await versionOf(s)).toBe(v);
    });

    it('an administrator cannot review or classify their own Shipper profile', async () => {
      const driverId = await createDriverFor(admin.pool, reviewerUser.userId, { status: 'PENDING' });
      await admin.pool.query("UPDATE app.drivers SET review_state = 'SUBMITTED' WHERE driver_id = $1::uuid", [driverId]);
      const current = Number((await row(driverId)).version);
      for (const [name, body] of [
        ['approve', { expected_version: current }],
        ['classification', { expected_version: current, driver_type: 'PLATFORM' }],
      ] as const) {
        expect(codeOf(await command(reviewer, driverId, name, body))).toEqual({ status: 403, code: 'DRIVER_SELF_ACTION_FORBIDDEN' });
      }
      expect((await row(driverId)).driver_type).toBe('EXTERNAL');
    });
  });

  // ------------------------------------------------------------------------------------------------ authorization

  describe('server-side authorization', () => {
    it('a Shipper session cannot reach any administration function', async () => {
      const s = await submitted();
      const asClient = (method: 'GET' | 'POST', path: string, body?: unknown): Promise<AdminResponse> =>
        admin.call(method, path, {
          basePath: '/v1/admin',
          headers: { authorization: `Bearer ${s.token}`, 'idempotency-key': randomUUID() },
          ...(body === undefined ? {} : { body, csrf: 'x' }),
        });
      for (const response of [
        await asClient('GET', '/shippers'),
        await asClient('GET', `/shippers/${s.driverId}`),
        await asClient('POST', `/shippers/${s.driverId}/approve`, { expected_version: 1 }),
        await asClient('GET', '/system-settings/shipper-wallet'),
        await asClient('POST', '/system-settings/shipper-wallet', { expected_version: 2, topup_min_vnd: 1, withdraw_min_vnd: 1 }),
      ]) {
        expect([401, 403]).toContain(response.status);
        expect(response.body.data).toBeUndefined();
      }
      expect((await row(s.driverId)).review_state).toBe('SUBMITTED');
    });

    it('needs the session, the CSRF token and the right: viewer reads but cannot review, lock-only cannot approve, other apps see nothing', async () => {
      const s = await submitted();
      const v = await versionOf(s);
      expect(codeOf(await adminGet(undefined, '/shippers'))).toEqual({ status: 401, code: 'ADMIN_SESSION_INVALID' });
      expect(codeOf(await adminGet(noDriverRight, '/shippers'))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
      expect((await adminGet(viewer, '/shippers')).status).toBe(200);
      expect(codeOf(await command(viewer, s.driverId, 'approve', { expected_version: v }))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
      expect(codeOf(await command(lockOnly, s.driverId, 'approve', { expected_version: v }))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
      expect(codeOf(await adminPost(reviewer, `/shippers/${s.driverId}/approve`, { expected_version: v }, { csrf: null }))).toEqual({ status: 403, code: 'ADMIN_CSRF_INVALID' });
      expect(codeOf(await command(reviewer, randomUUID(), 'approve', { expected_version: v }))).toEqual({ status: 404, code: 'DRIVER_NOT_FOUND' });
      expect((await row(s.driverId)).review_state).toBe('SUBMITTED');
    });
  });

  // ------------------------------------------------------------------------------------------------ wallet parameters

  describe('Cài đặt → Tham số hệ thống → Ví Shipper', () => {
    const read = (who: AdminLogin): Promise<AdminResponse> => adminGet(who, '/system-settings/shipper-wallet');
    const write = (who: AdminLogin, body: unknown): Promise<AdminResponse> => adminPost(who, '/system-settings/shipper-wallet', body);

    it('starts from the database defaults (100000 / 10000), is SYSTEM only and is read by M04\'s in-process reader and the Shipper app hint', async () => {
      const current = adminData(await read(systemLogin()));
      expect(current).toMatchObject({ topup_min_vnd: 100000, withdraw_min_vnd: 10000 });
      expect(codeOf(await read(reviewer))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
      expect(codeOf(await write(reviewer, { expected_version: Number(current.version), topup_min_vnd: 200000, withdraw_min_vnd: 20000 }))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
      const s = await newShipper();
      const hint = await client.call('GET', '/driver/wallet-limits', { bearer: s.token });
      expect(dataOf(hint)).toEqual({ topup_min_vnd: 100000, withdraw_min_vnd: 10000 });
    });

    it('accepts only whole positive VND, applies at once, versions the pair and records old / new value, actor and time', async () => {
      const start = adminData(await read(systemLogin()));
      const version = Number(start.version);
      for (const bad of [
        { expected_version: version, topup_min_vnd: 0, withdraw_min_vnd: 10000 },
        { expected_version: version, topup_min_vnd: -5, withdraw_min_vnd: 10000 },
        { expected_version: version, topup_min_vnd: 150000.5, withdraw_min_vnd: 10000 },
        { expected_version: version, topup_min_vnd: '150000', withdraw_min_vnd: 10000 },
        { expected_version: version, topup_min_vnd: 150000, withdraw_min_vnd: null },
        { expected_version: version, topup_min_vnd: 2_000_000_000, withdraw_min_vnd: 10000 },
        { expected_version: version, topup_min_vnd: 150000, withdraw_min_vnd: 10000, extra: 1 },
        { expected_version: version, topup_min_vnd: 150000 },
      ]) {
        expect(codeOf(await write(systemLogin(), bad))).toEqual({ status: 400, code: 'ADMIN_INPUT_INVALID' });
      }
      const changed = await write(systemLogin(), { expected_version: version, topup_min_vnd: 150000, withdraw_min_vnd: 20000 });
      expect(changed.status).toBe(200);
      expect(adminData(changed)).toMatchObject({ topup_min_vnd: 150000, withdraw_min_vnd: 20000 });
      expect((adminData(changed).changed as unknown[]).length).toBe(2);
      const log = (await admin.pool.query('SELECT param_key, old_value::int AS old_value, new_value::int AS new_value, changed_by FROM app.shipper_wallet_parameter_changes ORDER BY changed_at DESC, param_key LIMIT 2')).rows;
      expect(log).toEqual(expect.arrayContaining([expect.objectContaining({ param_key: 'topup_min_vnd', old_value: 100000, new_value: 150000 }), expect.objectContaining({ param_key: 'withdraw_min_vnd', old_value: 10000, new_value: 20000 })]));
      expect(await countRows(admin.pool, "SELECT 1 FROM app.audit_logs WHERE action = 'admin.shipper_wallet_parameters.update.v1'")).toBeGreaterThanOrEqual(2);
      // The reader every other module uses sees the new values; the Shipper hint too.
      const s = await newShipper();
      expect(dataOf(await client.call('GET', '/driver/wallet-limits', { bearer: s.token }))).toEqual({ topup_min_vnd: 150000, withdraw_min_vnd: 20000 });
      // A stale screen cannot overwrite the newer values.
      expect(codeOf(await write(systemLogin(), { expected_version: version, topup_min_vnd: 300000, withdraw_min_vnd: 30000 }))).toEqual({ status: 409, code: 'WALLET_PARAMETER_VERSION_CONFLICT' });
      // Back to the defaults (the minimum for a new request is not the balance needed to take orders: nothing here reads a balance).
      const back = adminData(await read(systemLogin()));
      expect((await write(systemLogin(), { expected_version: Number(back.version), topup_min_vnd: 100000, withdraw_min_vnd: 10000 })).status).toBe(200);
    });
  });

  // ------------------------------------------------------------------------------------------------ privacy

  it('the Shipper app has no settings or parameter route of any kind', async () => {
    const s = await newShipper();
    for (const path of ['/driver/settings', '/driver/system-settings', '/driver/parameters', '/driver/me/settings', '/admin/system-settings/shipper-wallet']) {
      const response = await client.call('GET', path, { bearer: s.token });
      expect([401, 403, 404]).toContain(response.status);
    }
  });
});
