import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { AccountActivityRegistry } from '../../apps/backend/src/account-lifecycle/account-activity-registry';
import { Argon2idPasswordHasher } from '../../apps/backend/src/auth/password-hasher';
import { SessionAuthorizationParticipant } from '../../apps/backend/src/auth/session-authorization-participant';
import { TransactionManager } from '../../apps/backend/src/transaction/transaction-manager';
import { runSmsGatewayCli } from '../../apps/backend/src/sms-gateway/cli/sms-gateway-cli';
import { SmsGatewayConfig } from '../../apps/backend/src/config/sms-gateway-config';
import {
  AdminApp,
  adminData,
  adminErrorCode,
  AdminResponse,
  adminTestEnv,
  count,
  createAdminMember,
  enrollAndLogin,
  loginBody,
  sessionCookies,
  startAdminApp,
} from './support/admin-fixtures';
import { api, ApiResponse, dataOf, errorCode, grantRole, PASSWORD, Phone, randomPhone } from './support/auth-fixtures';
import { systemSession, SystemSession } from './support/provisioning-fixtures';

// M01 final package (Owner decisions 2026-10-14) on the REAL Nest pipeline and a REAL PostgreSQL (TEST database only): the SYSTEM
// settings (the two OTP switches), the separation of the administration scope and the application scope, the delete / lock / recover
// lifecycle of an application account, and the limited access of a locked driver. The "phone" of the SMS gateway is played by calls
// to /v1/sms-gateway, exactly as in sms-gateway.int.spec.ts; the OTP is read from the claim response.

const tag = randomBytes(3).toString('hex').toUpperCase();
const TERMS = 'test-terms-20261014-v1';
const PRIVACY = 'test-privacy-20261014-v1';
const CONSENT = { terms_version: TERMS, privacy_version: PRIVACY };
const NEW_PASSWORD = 'Brand-New-Passw0rd-7';
const FOOD = { device_id: 'web-food-0001', platform: 'WEB', app: 'FOOD' };
const SHIP = { device_id: 'web-ship-0001', platform: 'WEB', app: 'SHIP' };
const ADMIN_BASE = '/v1/admin';
const SETTINGS = '/system-settings/phone-verification';
const OPEN: SmsGatewayConfig = {
  recipientMode: 'OPEN',
  allowlist: new Set(),
  limitPhonePerHour: 50,
  limitPhonePerDay: 100,
  limitGlobalPerDay: 10_000,
  onlineWindowSeconds: 90,
  leaseSeconds: 60,
  pollSeconds: 5,
};

interface Login {
  readonly cookie: string;
  readonly csrf: string;
}

async function ctl(...argv: string[]): Promise<{ code: number; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runSmsGatewayCli({ env: adminTestEnv(), argv, out: (line) => out.push(line), err: (line) => err.push(line) });
  return { code, out, err };
}

describe('account lifecycle, scopes and system settings', () => {
  let app: AdminApp;
  let system: SystemSession;
  let deviceToken = '';
  const hasher = new Argon2idPasswordHasher();

  const sys = (): Login => ({ cookie: system.login.cookie, csrf: system.login.csrf });
  const base = (): string => app.running.baseUrl;

  // ---- admin API -----------------------------------------------------------------------------------------------------------
  const getSettings = (who: { cookie: string }): Promise<AdminResponse> => app.call('GET', SETTINGS, { basePath: ADMIN_BASE, cookies: sessionCookies(who) });
  const postSettings = async (
    who: Login,
    body: unknown,
    options: { key?: string | null; csrf?: string | null } = {},
  ): Promise<AdminResponse> => {
    await app.clearLimits();
    const key = options.key === undefined ? randomUUID() : options.key;
    return app.call('POST', SETTINGS, {
      basePath: ADMIN_BASE,
      body,
      cookies: sessionCookies(who),
      ...(options.csrf === null ? {} : { csrf: options.csrf ?? who.csrf }),
      ...(key === null ? {} : { headers: { 'idempotency-key': key } }),
    });
  };
  const settingsBody = (version: number, registration: boolean, reset: boolean): Record<string, unknown> => ({
    expected_version: version,
    otp_registration_enabled: registration,
    otp_password_reset_enabled: reset,
  });
  const command = async (kind: 'lock' | 'unlock' | 'delete', userId: string, body: Record<string, unknown>, who: Login = sys(), key = randomUUID()): Promise<AdminResponse> => {
    await app.clearLimits();
    return app.call('POST', `/users/${userId}/${kind}`, { basePath: ADMIN_BASE, body, cookies: sessionCookies(who), csrf: who.csrf, headers: { 'idempotency-key': key } });
  };
  const detail = (userId: string, who: { cookie: string } = sys()): Promise<AdminResponse> => app.call('GET', `/users/${userId}`, { basePath: ADMIN_BASE, cookies: sessionCookies(who) });
  const lockBody = (version: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ expected_version: version, reason: 'Kiểm thử vòng đời tài khoản', ...extra });
  const codeOf = (response: AdminResponse): { status: number; code: string | undefined } => ({ status: response.status, code: adminErrorCode(response) });

  async function resetSettings(): Promise<void> {
    await app.pool.query('DELETE FROM app.system_setting_changes');
    await app.pool.query('DELETE FROM app.system_settings');
  }

  // ---- application API ------------------------------------------------------------------------------------------------------
  const registerBody = (phone: Phone, device: Record<string, unknown> = FOOD, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    phone: phone.local,
    password: PASSWORD,
    device: { ...device },
    full_name: 'Nguyễn Văn An',
    consent: { ...CONSENT },
    ...extra,
  });
  const registerClient = (body: Record<string, unknown>, key: string = randomUUID()): Promise<ApiResponse> =>
    api(base(), 'POST', '/client-auth/register', { headers: { 'idempotency-key': key }, body });
  const loginClient = (phone: Phone, password = PASSWORD, device: Record<string, unknown> = FOOD): Promise<ApiResponse> =>
    api(base(), 'POST', '/client-auth/login', { headers: { 'idempotency-key': randomUUID() }, body: { phone: phone.local, password, device: { ...device } } });
  const me = (token: string): Promise<ApiResponse> => api(base(), 'GET', '/client-auth/me', { bearer: token });
  const tokenOf = (response: ApiResponse): string => String(dataOf(response).access_token);
  const clientConfig = async (): Promise<unknown> => dataOf(await api(base(), 'GET', '/client-auth/config')).registration_verification;
  const resetConfig = async (): Promise<unknown> => dataOf(await api(base(), 'GET', '/account-recovery/config')).mode;

  // ---- the SMS gateway phone -------------------------------------------------------------------------------------------------
  const gw = (path: string, body: unknown = {}): Promise<ApiResponse> => api(base(), 'POST', `/sms-gateway${path}`, { bearer: deviceToken, body });
  const claim = async (): Promise<{ job_id: string; attempt_id: string; to: string; text: string } | null> =>
    dataOf(await gw('/jobs/claim', { sms_permission: true, paused: false })).job as { job_id: string; attempt_id: string; to: string; text: string } | null;
  /** The next queued SMS as the phone would send it; null when nothing was queued. */
  async function nextSms(): Promise<{ to: string; otp: string } | null> {
    const job = await claim();
    if (job === null) {
      return null;
    }
    await gw(`/jobs/${job.job_id}/ack`, { attempt_id: job.attempt_id, result: 'SENT' });
    return { to: job.to, otp: /([0-9]{6})/.exec(job.text)?.[1] as string };
  }
  const drainQueue = async (): Promise<void> => {
    await app.pool.query('DELETE FROM app.sms_jobs');
  };

  // ---- seeds -----------------------------------------------------------------------------------------------------------------
  interface Seeded {
    readonly id: string;
    readonly phone: Phone;
  }
  async function seedUser(options: { roles?: readonly ('CUSTOMER' | 'SHOP' | 'DRIVER')[]; status?: 'ACTIVE' | 'DISABLED'; lockReason?: 'DELETE_REQUEST' | 'VIOLATION' | 'SECURITY'; phone?: Phone } = {}): Promise<Seeded> {
    const phone = options.phone ?? randomPhone();
    app.track(phone.normalized);
    const id = randomUUID();
    const disabled = options.status === 'DISABLED';
    await app.pool.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at, lock_reason, locked_at)
       VALUES ($1::uuid, $2, $3, clock_timestamp(), 'PHONE_VERIFIED', $4, 1, clock_timestamp(), clock_timestamp(), $5::text, CASE WHEN $5::text IS NULL THEN NULL ELSE clock_timestamp() END)`,
      [id, phone.normalized, await hasher.hash(PASSWORD), disabled ? 'DISABLED' : 'ACTIVE', disabled ? (options.lockReason ?? 'VIOLATION') : null],
    );
    for (const role of options.roles ?? ['CUSTOMER']) {
      if (role === 'CUSTOMER') {
        await app.pool.query('INSERT INTO app.user_roles (user_id, role, created_at) VALUES ($1::uuid, $2, clock_timestamp())', [id, 'CUSTOMER']);
        await app.pool.query('INSERT INTO app.customer_profiles (user_id, full_name) VALUES ($1::uuid, $2)', [id, `Khách ${tag}`]);
      } else {
        await grantRole(app.pool, id, role);
      }
    }
    return { id, phone };
  }
  const userRow = async (id: string) =>
    (
      await app.pool.query<{ status: string; lock_reason: string | null; account_origin: string; account_scope: string; verified: boolean; version: string }>(
        'SELECT status, lock_reason, account_origin, account_scope, phone_verified_at IS NOT NULL AS verified, version::text FROM app.users WHERE user_id = $1::uuid',
        [id],
      )
    ).rows[0];
  const exists = (id: string): Promise<number> => count(app.pool, 'SELECT 1 FROM app.users WHERE user_id = $1::uuid', [id]);
  const auditCount = (action: string, resourceId?: string): Promise<number> =>
    resourceId === undefined
      ? count(app.pool, 'SELECT 1 FROM app.audit_logs WHERE action = $1', [action])
      : count(app.pool, 'SELECT 1 FROM app.audit_logs WHERE action = $1 AND resource_id = $2', [action, resourceId]);

  beforeAll(async () => {
    app = await startAdminApp({
      smsGateway: OPEN,
      userAccountMutations: true,
      activationDisabledTest: false,
      configOverride: { clientAuth: { termsVersion: TERMS, privacyVersion: PRIVACY } },
    });
    await drainQueue();
    await app.pool.query('DELETE FROM app.sms_gateway_devices');
    const out = await ctl('pair', '--label', 'Lifecycle phone');
    deviceToken = /: ([A-Za-z0-9_-]{43})$/.exec(out.out[1] ?? '')?.[1] as string;
    expect((await ctl('enable')).code).toBe(0);
    expect((await gw('/heartbeat', { app_version: '0.2.0', sms_permission: true, paused: false })).status).toBe(200);
    system = await systemSession(app);
    await resetSettings();
  }, 300_000);

  afterAll(async () => {
    try {
      await resetSettings();
      await drainQueue();
      await app.pool.query('DELETE FROM app.sms_gateway_devices');
      await app.pool.query('DELETE FROM app.sms_gateway_control');
    } finally {
      await app.close();
    }
  });

  beforeEach(async () => {
    await resetSettings();
    await drainQueue();
  });

  // =============================================================================================================================
  // 2. System settings: only SYSTEM, two independent switches, immediate, logged
  // =============================================================================================================================
  describe('system settings (SYSTEM only)', () => {
    it('case 1 — SYSTEM flips each OTP switch on its own; the effect is immediate; every change is logged (old, new, actor, time)', async () => {
      const auditBefore = await auditCount('admin.system_setting.update.v1');
      expect(adminData(await getSettings(sys()))).toMatchObject({ version: 0, otp_registration_enabled: true, otp_password_reset_enabled: true, updated_at: null, history: [] });
      expect(await clientConfig()).toBe('REQUIRED');
      expect(await resetConfig()).toBe('SMS_OTP');

      // Registration OTP off, reset OTP untouched.
      const first = await postSettings(sys(), settingsBody(0, false, true));
      expect(first.status).toBe(200);
      expect(first.headers['cache-control']).toBe('no-store');
      expect(adminData(first)).toMatchObject({ version: 1, otp_registration_enabled: false, otp_password_reset_enabled: true, changed: [{ setting_key: 'otp_registration_enabled', old_value: true, new_value: false }] });
      expect(await clientConfig()).toBe('NOT_REQUIRED');
      expect(await resetConfig()).toBe('SMS_OTP');

      // Reset OTP off as well.
      const second = await postSettings(sys(), settingsBody(1, false, false));
      expect(adminData(second)).toMatchObject({ version: 2, changed: [{ setting_key: 'otp_password_reset_enabled', old_value: true, new_value: false }] });
      expect(await clientConfig()).toBe('NOT_REQUIRED');
      expect(await resetConfig()).toBe('UNAVAILABLE');

      // Registration back on while the reset stays off: the two are independent.
      const third = await postSettings(sys(), settingsBody(2, true, false));
      expect(adminData(third)).toMatchObject({ version: 3, otp_registration_enabled: true, otp_password_reset_enabled: false });
      expect(await clientConfig()).toBe('REQUIRED');
      expect(await resetConfig()).toBe('UNAVAILABLE');

      // Nothing to change: no new version, no log row.
      const same = await postSettings(sys(), settingsBody(3, true, false));
      expect(adminData(same)).toMatchObject({ version: 3, changed: [] });

      const changes = await app.pool.query<{ setting_key: string; old_value: boolean; new_value: boolean; changed_by: string }>(
        'SELECT setting_key, old_value, new_value, changed_by::text FROM app.system_setting_changes ORDER BY changed_at, setting_key',
      );
      expect(changes.rows).toHaveLength(3);
      expect(changes.rows.every((row) => row.changed_by === system.account.userId && row.old_value !== row.new_value)).toBe(true);
      expect(await auditCount('admin.system_setting.update.v1')).toBe(auditBefore + 3);
      const audit = await app.pool.query<{ actor_type: string; actor_id: string; metadata: Record<string, unknown> }>(
        "SELECT actor_type, actor_id, metadata FROM app.audit_logs WHERE action = 'admin.system_setting.update.v1' ORDER BY occurred_at, audit_id",
      );
      expect(audit.rows[auditBefore]).toMatchObject({ actor_type: 'SYSTEM', actor_id: system.account.userId, metadata: { setting_key: 'otp_registration_enabled', old_value: true, new_value: false } });
      const history = adminData(await getSettings(sys())).history as Array<Record<string, unknown>>;
      expect(history).toHaveLength(3);
      expect(history[0]).toMatchObject({ setting_key: 'otp_registration_enabled', old_value: false, new_value: true });
    });

    it('the same key and body is the original answer (nothing written twice); a stale version is a conflict that writes nothing', async () => {
      const key = randomUUID();
      const first = await postSettings(sys(), settingsBody(0, false, true), { key });
      const replay = await postSettings(sys(), settingsBody(0, false, true), { key });
      expect(replay.status).toBe(200);
      expect(adminData(replay)).toEqual(adminData(first));
      expect(await count(app.pool, 'SELECT 1 FROM app.system_setting_changes')).toBe(1);
      expect(codeOf(await postSettings(sys(), settingsBody(0, false, false)))).toEqual({ status: 409, code: 'SYSTEM_SETTING_VERSION_CONFLICT' });
      expect(codeOf(await postSettings(sys(), settingsBody(0, true, true), { key }))).toEqual({ status: 409, code: 'IDEMPOTENCY_KEY_REUSED' });
      expect(await count(app.pool, 'SELECT 1 FROM app.system_setting_changes')).toBe(1);
    });

    it('case 2 — an ADMIN can neither read nor change the settings; no session, a missing CSRF token and a loose body are refused', async () => {
      const admin = await createAdminMember(app);
      const adminLogin = await enrollAndLogin(app, admin);
      expect(codeOf(await getSettings(adminLogin))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
      expect(codeOf(await postSettings(adminLogin, settingsBody(0, false, false)))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
      expect(await clientConfig()).toBe('REQUIRED');
      expect(await count(app.pool, 'SELECT 1 FROM app.system_settings')).toBe(0);

      expect(codeOf(await getSettings({ cookie: 'x'.repeat(43) }))).toMatchObject({ status: 401 });
      expect((await app.call('GET', SETTINGS, { basePath: ADMIN_BASE })).status).toBe(401);
      expect(codeOf(await postSettings(sys(), settingsBody(0, false, true), { csrf: null }))).toMatchObject({ status: 403 });
      for (const odd of [
        { expected_version: 0, otp_registration_enabled: false },
        { ...settingsBody(0, false, false), extra: true },
        { ...settingsBody(0, false, false), otp_registration_enabled: 'false' },
        { ...settingsBody(0, false, false), expected_version: -1 },
        [],
      ]) {
        expect(codeOf(await postSettings(sys(), odd))).toEqual({ status: 400, code: 'ADMIN_INPUT_INVALID' });
      }
      expect(await count(app.pool, 'SELECT 1 FROM app.system_setting_changes')).toBe(0);
      // A bearer token of an application user is nothing to the administration routes.
      const user = await seedUser();
      const token = tokenOf(await loginClient(user.phone));
      const withBearer = await app.call('GET', SETTINGS, { basePath: ADMIN_BASE, headers: { authorization: `Bearer ${token}` } });
      expect(withBearer.status).toBe(401);
    });
  });

  // =============================================================================================================================
  // 3 / 4. The switches and the application: registration and password reset
  // =============================================================================================================================
  describe('registration and password reset follow the switches', () => {
    it('case 3 — registration OTP off: no code is issued; the account is created with an UNVERIFIED phone; ON again refuses the proof-less body', async () => {
      await postSettings(sys(), settingsBody(0, false, true));
      const phone = randomPhone();
      app.track(phone.normalized);

      const otp = await api(base(), 'POST', '/auth/phone-verifications', { body: { phone: phone.local, purpose: 'REGISTER' } });
      expect([otp.status, errorCode(otp)]).toEqual([409, 'PHONE_VERIFICATION_NOT_REQUIRED']);
      expect(await nextSms()).toBeNull();
      expect(await count(app.pool, 'SELECT 1 FROM app.phone_verifications WHERE phone_normalized = $1', [phone.normalized])).toBe(0);

      // A token the server did not ask for is a plain 400: the body shape follows the server mode.
      const withToken = await registerClient(registerBody(phone, FOOD, { verification_token: 'A'.repeat(43) }));
      expect(withToken.status).toBe(400);
      const key = randomUUID();
      const created = await registerClient(registerBody(phone), key);
      expect(created.status).toBe(201);
      const data = dataOf(created);
      expect(data.available_roles).toEqual(['CUSTOMER']);
      const row = await userRow(String(data.user_id));
      expect(row).toMatchObject({ status: 'ACTIVE', account_origin: 'PHONE_UNVERIFIED', account_scope: 'APP_USER', verified: false });
      expect(await count(app.pool, 'SELECT 1 FROM app.user_roles WHERE user_id = $1::uuid', [String(data.user_id)])).toBe(1);
      expect(await auditCount('client.auth.register.unverified.v1', String(data.user_id))).toBe(1);
      // The lost-response retry is the same answer, not a second account.
      const replay = await registerClient(registerBody(phone), key);
      expect(replay.status).toBe(201);
      expect(dataOf(replay).user_id).toBe(data.user_id);
      expect(await count(app.pool, 'SELECT 1 FROM app.users WHERE account_scope = $1 AND phone_normalized = $2', ['APP_USER', phone.normalized])).toBe(1);
      expect((await loginClient(phone)).status).toBe(200);
      // Registering the same number again is the ordinary conflict, not a second account.
      expect(errorCode(await registerClient(registerBody(phone)))).toBe('PHONE_ALREADY_REGISTERED');

      // SYSTEM turns the OTP back on: the proof-less body is refused and creates nothing.
      await postSettings(sys(), settingsBody(1, true, true));
      const other = randomPhone();
      app.track(other.normalized);
      const refused = await registerClient(registerBody(other));
      expect(refused.status).toBe(400);
      expect(await count(app.pool, 'SELECT 1 FROM app.users WHERE phone_normalized = $1', [other.normalized])).toBe(0);
      // And the OTP request works again.
      const again = await api(base(), 'POST', '/auth/phone-verifications', { body: { phone: other.local, purpose: 'REGISTER' } });
      expect(again.status).toBe(201);
    });

    it('case 4 — reset OTP off: the self-service reset is closed at every step, sends nothing and never becomes a reset without a proof', async () => {
      const user = await seedUser();
      // A code asked while the switch was still on...
      const asked = await api(base(), 'POST', '/account-recovery/otp', { body: { phone: user.phone.local } });
      expect(asked.status).toBe(200);
      const verificationId = String(dataOf(asked).verification_id);
      const sms = await nextSms();
      expect(sms?.to).toBe(user.phone.normalized);
      const proofResponse = await api(base(), 'POST', `/account-recovery/otp/${verificationId}/verify`, { body: { otp: sms?.otp } });
      const proof = String(dataOf(proofResponse).verification_token);

      // ...SYSTEM now turns the switch off.
      await postSettings(sys(), settingsBody(0, true, false));
      expect(await resetConfig()).toBe('UNAVAILABLE');
      const request = await api(base(), 'POST', '/account-recovery/otp', { body: { phone: user.phone.local } });
      expect([request.status, errorCode(request)]).toEqual([403, 'PASSWORD_RESET_DISABLED']);
      expect(await nextSms()).toBeNull();
      const verify = await api(base(), 'POST', `/account-recovery/otp/${verificationId}/verify`, { body: { otp: '000000' } });
      expect([verify.status, errorCode(verify)]).toEqual([403, 'PASSWORD_RESET_DISABLED']);
      const reset = await api(base(), 'POST', '/account-recovery/reset', { headers: { 'idempotency-key': randomUUID() }, body: { verification_token: proof, password: NEW_PASSWORD } });
      expect([reset.status, errorCode(reset)]).toEqual([403, 'PASSWORD_RESET_DISABLED']);
      // The old password still works, the new one does not, and the proof is not spent.
      expect((await loginClient(user.phone)).status).toBe(200);
      expect((await loginClient(user.phone, NEW_PASSWORD)).status).toBe(401);
      expect(await count(app.pool, 'SELECT 1 FROM app.verification_proofs WHERE phone_normalized = $1 AND consumed_at IS NOT NULL', [user.phone.normalized])).toBe(0);
      // The test-only no-OTP route does not exist outside development.
      const noOtp = await api(base(), 'POST', '/account-recovery/reset-test', { headers: { 'idempotency-key': randomUUID() }, body: { phone: user.phone.local, password: NEW_PASSWORD } });
      expect(noOtp.status).toBe(503);

      // ON again: the very same proof now resets (it was never consumed).
      await postSettings(sys(), settingsBody(1, true, true));
      const done = await api(base(), 'POST', '/account-recovery/reset', { headers: { 'idempotency-key': randomUUID() }, body: { verification_token: proof, password: NEW_PASSWORD } });
      expect(done.status).toBe(200);
      expect((await loginClient(user.phone, NEW_PASSWORD)).status).toBe(200);
    });
  });

  // =============================================================================================================================
  // 5 / 6. Two scopes: the administration web and the applications
  // =============================================================================================================================
  describe('administration scope and application scope are independent', () => {
    it('case 5 — a SYSTEM phone registers in 11Food as a plain application user; each side logs in only with its own password', async () => {
      await postSettings(sys(), settingsBody(0, false, true));
      const shared = system.account.phone;
      const adminId = system.account.userId;
      const APP_SIDE = 'App-Side-Passw0rd-3';
      const created = await registerClient(registerBody(shared, FOOD, { password: APP_SIDE }), randomUUID());
      expect(created.status).toBe(201);
      const appUserId = String(dataOf(created).user_id);
      expect(appUserId).not.toBe(adminId);
      expect(await userRow(appUserId)).toMatchObject({ account_scope: 'APP_USER', account_origin: 'PHONE_UNVERIFIED' });
      expect(await userRow(adminId)).toMatchObject({ account_scope: 'ADMIN_WEB', account_origin: 'ADMIN_PROVISIONED' });
      expect(await count(app.pool, 'SELECT 1 FROM app.users WHERE phone_normalized = $1', [shared.normalized])).toBe(2);
      // The application user owns nothing administrative.
      expect(await count(app.pool, 'SELECT 1 FROM app.admin_memberships WHERE user_id = $1::uuid', [appUserId])).toBe(0);
      expect(await count(app.pool, "SELECT 1 FROM app.user_roles WHERE user_id = $1::uuid AND role <> 'CUSTOMER'", [appUserId])).toBe(0);

      // Application side: its own password works, the administration password does not (and nothing says why).
      const appLogin = await loginClient(shared, APP_SIDE);
      expect(appLogin.status).toBe(200);
      const mine = await me(tokenOf(appLogin));
      expect(dataOf(mine).user_id).toBe(appUserId);
      const adminPasswordOnApp = await loginClient(shared, system.account.password);
      expect([adminPasswordOnApp.status, errorCode(adminPasswordOnApp)]).toEqual([401, 'INVALID_CREDENTIALS']);

      // Administration side: its own password reaches the TOTP step; the application password does not.
      await app.clearLimits();
      const adminLogin = await app.call('POST', '/login', { body: loginBody(system.account) });
      expect(adminLogin.status).toBe(200);
      await app.clearLimits();
      const appPasswordOnAdmin = await app.call('POST', '/login', { body: loginBody({ ...system.account, password: APP_SIDE }) });
      expect(appPasswordOnAdmin.status).toBe(401);
      // The shared phone is also an application phone for the OTP-registration lookup: registering it again is the plain conflict.
      expect(errorCode(await registerClient(registerBody(shared)))).toBe('PHONE_ALREADY_REGISTERED');
    });

    it('case 6 — an application user (even a shop owner or a driver) cannot sign in to the administration web, and has no administration right', async () => {
      const user = await seedUser({ roles: ['CUSTOMER', 'SHOP', 'DRIVER'] });
      await app.clearLimits();
      const attempt = await app.call('POST', '/login', { body: loginBody({ phone: user.phone, password: PASSWORD, userId: user.id }) });
      expect(attempt.status).toBe(401);
      expect(attempt.setCookie).toEqual([]);
      expect(await count(app.pool, 'SELECT 1 FROM app.admin_sessions WHERE user_id = $1::uuid', [user.id])).toBe(0);
      // The same phone and password do work in the applications.
      expect((await loginClient(user.phone)).status).toBe(200);
      // A forged administration cookie of an application session is nothing.
      const token = tokenOf(await loginClient(user.phone));
      expect(codeOf(await getSettings({ cookie: token }))).toMatchObject({ status: 401 });
      expect((await app.call('GET', '/users', { basePath: ADMIN_BASE, cookies: sessionCookies({ cookie: token }) })).status).toBe(401);
    });

    it('password reset is scoped by the route: the application never touches an administration account and the other way round; proofs are not interchangeable', async () => {
      const shared = system.account.phone;
      await app.pool.query("SELECT app.purge_app_user(user_id) FROM app.users WHERE phone_normalized = $1 AND account_scope = 'APP_USER'", [shared.normalized]);
      // The application account that shares the SYSTEM phone.
      const appUser = await seedUser({ phone: shared });
      const adminHashBefore = (await app.pool.query<{ password_hash: string }>('SELECT password_hash FROM app.users WHERE user_id = $1::uuid', [system.account.userId])).rows[0]?.password_hash;

      const asked = await api(base(), 'POST', '/account-recovery/otp', { body: { phone: shared.local } });
      const id = String(dataOf(asked).verification_id);
      const sms = await nextSms();
      expect(sms?.to).toBe(shared.normalized);
      const proof = String(dataOf(await api(base(), 'POST', `/account-recovery/otp/${id}/verify`, { body: { otp: sms?.otp } })).verification_token);
      // The application proof is refused by the administration reset (another purpose) and nothing is consumed.
      const crossed = await api(base(), 'POST', '/admin-recovery/reset', { headers: { 'idempotency-key': randomUUID() }, body: { verification_token: proof, password: NEW_PASSWORD } });
      expect([crossed.status, errorCode(crossed)]).toEqual([400, 'VERIFICATION_PURPOSE_MISMATCH']);
      const reset = await api(base(), 'POST', '/account-recovery/reset', { headers: { 'idempotency-key': randomUUID() }, body: { verification_token: proof, password: NEW_PASSWORD } });
      expect(reset.status).toBe(200);
      // Only the application account changed.
      expect((await loginClient(shared, NEW_PASSWORD)).status).toBe(200);
      expect((await app.pool.query<{ password_hash: string }>('SELECT password_hash FROM app.users WHERE user_id = $1::uuid', [system.account.userId])).rows[0]?.password_hash).toBe(adminHashBefore);
      expect(await count(app.pool, 'SELECT 1 FROM app.audit_logs WHERE resource_id = $1 AND action = $2', [appUser.id, 'account.password.reset_otp.v1'])).toBe(1);

      // Issue #117: the cooldown is ONE per phone for every flow, so the application reset above still holds it for this shared number: let it elapse.
      await app.pool.query(
        `UPDATE app.phone_verifications SET created_at = created_at - interval '2 minutes', expires_at = expires_at - interval '2 minutes', resend_not_before = resend_not_before - interval '2 minutes' WHERE phone_normalized = $1`,
        [shared.normalized],
      );
      // The administration reset: an ADMIN member only (never SYSTEM); it queues an SMS only for that scope.
      const sysAsk = await api(base(), 'POST', '/admin-recovery/otp', { body: { phone: shared.local } });
      expect(sysAsk.status).toBe(200);
      expect(await nextSms()).toBeNull(); // SYSTEM is never reset by SMS, and the application account of the same phone is not its business
      const admin = await createAdminMember(app);
      const adminAsk = await api(base(), 'POST', '/admin-recovery/otp', { body: { phone: admin.phone.local } });
      const adminId = String(dataOf(adminAsk).verification_id);
      const adminSms = await nextSms();
      expect(adminSms?.to).toBe(admin.phone.normalized);
      const adminProof = String(dataOf(await api(base(), 'POST', `/admin-recovery/otp/${adminId}/verify`, { body: { otp: adminSms?.otp } })).verification_token);
      const wrongRoute = await api(base(), 'POST', '/account-recovery/reset', { headers: { 'idempotency-key': randomUUID() }, body: { verification_token: adminProof, password: NEW_PASSWORD } });
      expect([wrongRoute.status, errorCode(wrongRoute)]).toEqual([400, 'VERIFICATION_PURPOSE_MISMATCH']);
      const ok = await api(base(), 'POST', '/admin-recovery/reset', { headers: { 'idempotency-key': randomUUID() }, body: { verification_token: adminProof, password: NEW_PASSWORD } });
      expect(ok.status).toBe(200);
      await app.clearLimits();
      expect((await app.call('POST', '/login', { body: loginBody(admin, { password: NEW_PASSWORD }) })).status).toBe(200);
      // An application phone asked on the administration route: a generic answer and no SMS.
      const plain = await seedUser();
      expect((await api(base(), 'POST', '/admin-recovery/otp', { body: { phone: plain.phone.local } })).status).toBe(200);
      expect(await nextSms()).toBeNull();
      // The administration reset is not closed by the application switch.
      await postSettings(sys(), settingsBody(0, true, false));
      expect((await api(base(), 'GET', '/admin-recovery/config')).body.data?.mode).toBe('SMS_OTP');
    });
  });

  // =============================================================================================================================
  // 7 / 8 / 9. Delete, lock and unlock
  // =============================================================================================================================
  describe('delete, lock and unlock of an application account', () => {
    it('case 7 — an account without related data is deleted for good; its own rows go, audit stays, the phone can register again as a NEW account', async () => {
      await postSettings(sys(), settingsBody(0, false, true));
      // This first registration makes a second, unrelated account. Its phone is tracked so app.close() purges it: an unverified account left behind would
      // outlive this suite and make the migration Down guards ("phone-unverified accounts exist") fail in whatever suite runs next.
      const bystander = randomPhone();
      app.track(bystander.normalized);
      const created = await registerClient(registerBody(bystander));
      const phone = randomPhone();
      app.track(phone.normalized);
      const registered = await registerClient(registerBody(phone));
      expect(registered.status).toBe(201);
      void created;
      const userId = String(dataOf(registered).user_id);
      const token = tokenOf(await loginClient(phone));
      expect((await me(token)).status).toBe(200);
      expect(await count(app.pool, 'SELECT 1 FROM app.sessions WHERE user_id = $1::uuid', [userId])).toBeGreaterThan(0);
      expect(await count(app.pool, 'SELECT 1 FROM app.user_consents WHERE user_id = $1::uuid', [userId])).toBe(1);

      const shown = adminData(await detail(userId));
      expect(shown).toMatchObject({ phone_verified: false });
      expect(shown.allowed_actions).toEqual(['LOCK', 'DELETE']);
      expect(shown.lifecycle).toMatchObject({ related_data: [], active_work: [], delete_effect: 'DELETE_PERMANENTLY', lock_blocked_reason: null, delete_blocked_reason: null });

      const key = randomUUID();
      const deleted = await command('delete', userId, lockBody(Number(shown.version)), sys(), key);
      expect(deleted.status).toBe(200);
      expect(adminData(deleted)).toMatchObject({ user_id: userId, result: 'DELETED', related_data: [] });
      expect(await exists(userId)).toBe(0);
      for (const table of ['sessions', 'user_roles', 'customer_profiles', 'user_consents', 'client_device_bindings']) {
        expect(await count(app.pool, `SELECT 1 FROM app.${table} WHERE user_id = $1::uuid`, [userId])).toBe(0);
      }
      expect((await me(token)).status).toBe(401);
      expect((await loginClient(phone)).status).toBe(401);
      expect(await auditCount('admin.user.delete.v1', userId)).toBe(1);
      expect(await count(app.pool, "SELECT 1 FROM app.outbox_events WHERE resource_id = $1 AND event_type = 'user.account.deleted.v1'", [userId])).toBe(1);
      expect((await app.pool.query<{ metadata: Record<string, unknown> }>("SELECT metadata FROM app.audit_logs WHERE action = 'admin.user.delete.v1' AND resource_id = $1", [userId])).rows[0]?.metadata).toMatchObject({ result: 'DELETED', target_user_id: userId });
      // The replay of the same command is the original answer (the account is gone, the audit is not repeated).
      const replay = await command('delete', userId, lockBody(Number(shown.version)), sys(), key);
      expect(replay.status).toBe(200);
      expect(adminData(replay)).toEqual(adminData(deleted));
      expect(await auditCount('admin.user.delete.v1', userId)).toBe(1);
      // A new command for the same id is an unknown account.
      expect(codeOf(await command('delete', userId, lockBody(Number(shown.version))))).toEqual({ status: 404, code: 'USER_NOT_AVAILABLE' });

      // The phone registers again and gets a NEW account (new id, nothing of the old one).
      const again = await registerClient(registerBody(phone));
      expect(again.status).toBe(201);
      expect(dataOf(again).user_id).not.toBe(userId);
    });

    it('case 7b — SYSTEM and ADMIN accounts are never deleted or locked by this command', async () => {
      const admin = await createAdminMember(app);
      for (const id of [system.account.userId, admin.userId]) {
        expect(codeOf(await command('delete', id, lockBody(1)))).toEqual({ status: 404, code: 'USER_NOT_AVAILABLE' });
        expect(codeOf(await command('lock', id, lockBody(1)))).toEqual({ status: 404, code: 'USER_NOT_AVAILABLE' });
        expect(await exists(id)).toBe(1);
      }
    });

    it('case 7c — the database function refuses an administration account and an account with business data, whatever the caller did before', async () => {
      const driver = await seedUser({ roles: ['CUSTOMER', 'DRIVER'] });
      await expect(app.pool.query('SELECT app.purge_app_user($1::uuid)', [driver.id])).rejects.toMatchObject({ code: '23503' });
      expect((await app.pool.query<{ purged: boolean }>('SELECT app.purge_app_user($1::uuid) AS purged', [system.account.userId])).rows[0]?.purged).toBe(false);
      expect((await app.pool.query<{ purged: boolean }>('SELECT app.purge_app_user($1::uuid) AS purged', [randomUUID()])).rows[0]?.purged).toBe(false);
      expect(await exists(driver.id)).toBe(1);
      expect(await exists(system.account.userId)).toBe(1);
    });

    it('case 8 — an account with related data is NEVER deleted: it is locked at its owner\'s request; id, roles, profile and records stay', async () => {
      const owner = await seedUser({ roles: ['CUSTOMER', 'SHOP', 'DRIVER'] });
      const [food, ship] = [tokenOf(await loginClient(owner.phone)), tokenOf(await loginClient(owner.phone, PASSWORD, SHIP))];
      const rolesBefore = (await app.pool.query('SELECT role FROM app.user_roles WHERE user_id = $1::uuid ORDER BY role', [owner.id])).rows;
      const shopBefore = (await app.pool.query('SELECT s.shop_id, s.status, s.name FROM app.shop_members m JOIN app.shops s ON s.shop_id = m.shop_id WHERE m.user_id = $1::uuid', [owner.id])).rows;
      const driverBefore = (await app.pool.query('SELECT status FROM app.drivers WHERE user_id = $1::uuid', [owner.id])).rows;

      const shown = adminData(await detail(owner.id));
      expect(shown.lifecycle).toMatchObject({ related_data: ['SHOP', 'DRIVER_PROFILE'], delete_effect: 'LOCK', lock_reason: null });
      expect(shown.allowed_actions).toEqual(['LOCK', 'DELETE']);

      const deleted = await command('delete', owner.id, lockBody(Number(shown.version)));
      expect(deleted.status).toBe(200);
      expect(adminData(deleted)).toMatchObject({ user_id: owner.id, result: 'LOCKED', account_status: 'DISABLED', lock_reason: 'DELETE_REQUEST', related_data: ['SHOP', 'DRIVER_PROFILE'] });
      expect(await exists(owner.id)).toBe(1);
      expect(await userRow(owner.id)).toMatchObject({ status: 'DISABLED', lock_reason: 'DELETE_REQUEST' });
      expect((await app.pool.query('SELECT role FROM app.user_roles WHERE user_id = $1::uuid ORDER BY role', [owner.id])).rows).toEqual(rolesBefore);
      expect((await app.pool.query('SELECT s.shop_id, s.status, s.name FROM app.shop_members m JOIN app.shops s ON s.shop_id = m.shop_id WHERE m.user_id = $1::uuid', [owner.id])).rows).toEqual(shopBefore);
      expect((await app.pool.query('SELECT status FROM app.drivers WHERE user_id = $1::uuid', [owner.id])).rows).toEqual(driverBefore);
      expect(await count(app.pool, 'SELECT 1 FROM app.sessions WHERE user_id = $1::uuid AND revoked_at IS NULL', [owner.id])).toBe(0);
      expect(await count(app.pool, 'SELECT 1 FROM app.sessions WHERE user_id = $1::uuid', [owner.id])).toBe(2); // history stays
      expect((await me(food)).status).toBe(401);
      expect((await me(ship)).status).toBe(401);
      expect(errorCode(await loginClient(owner.phone))).toBe('ACCOUNT_DISABLED');
      const after = adminData(await detail(owner.id));
      expect(after.lifecycle).toMatchObject({ lock_reason: 'DELETE_REQUEST', delete_blocked_reason: 'ALREADY_LOCKED' });
      expect(after.allowed_actions).toEqual(['UNLOCK', 'DELETE']);
      // A second delete of a locked account that has data is "already in that state"; nothing changes.
      expect(codeOf(await command('delete', owner.id, lockBody(Number(after.version))))).toEqual({ status: 409, code: 'USER_ACCOUNT_ALREADY_IN_STATE' });
      // The shop of a locked owner takes no new orders; unlocking restores that answer only, the shop row is never touched.
      const shopId = (shopBefore[0] as { shop_id: string }).shop_id;
      const availability = async (): Promise<string> => {
        const result = await app.pool.query<{ owner_locked: boolean }>(
          `SELECT EXISTS (SELECT 1 FROM app.shop_members om JOIN app.users ou ON ou.user_id = om.user_id WHERE om.shop_id = $1::uuid AND om.member_role = 'OWNER' AND ou.status <> 'ACTIVE') AS owner_locked`,
          [shopId],
        );
        return result.rows[0]?.owner_locked === true ? 'LOCKED' : 'OPEN';
      };
      expect(await availability()).toBe('LOCKED');
      expect((await command('unlock', owner.id, lockBody(Number(after.version)))).status).toBe(200);
      expect(await availability()).toBe('OPEN');
      expect(await userRow(owner.id)).toMatchObject({ status: 'ACTIVE', lock_reason: null });
      expect((await app.pool.query('SELECT s.shop_id, s.status, s.name FROM app.shop_members m JOIN app.shops s ON s.shop_id = m.shop_id WHERE m.user_id = $1::uuid', [owner.id])).rows).toEqual(shopBefore);
    });

    it('case 9 — orders or deliveries still being processed block the lock (and a delete that would lock); finished or cancelled ones do not', async () => {
      const registry = app.running.app.get(AccountActivityRegistry, { strict: false });
      const user = await seedUser({ roles: ['CUSTOMER', 'DRIVER'] });
      let processing = 2;
      registry.register({ name: 'DELIVERIES', relatedData: () => Promise.resolve(true), activeWork: (_context, userId) => Promise.resolve(userId === user.id ? processing : 0) });
      try {
        const shown = adminData(await detail(user.id));
        expect(shown.lifecycle).toMatchObject({ active_work: ['DELIVERIES'], lock_blocked_reason: 'ACTIVE_WORK', delete_blocked_reason: 'ACTIVE_WORK' });
        const version = Number(shown.version);
        expect(codeOf(await command('lock', user.id, lockBody(version)))).toEqual({ status: 409, code: 'USER_ACCOUNT_HAS_ACTIVE_WORK' });
        expect(codeOf(await command('delete', user.id, lockBody(version)))).toEqual({ status: 409, code: 'USER_ACCOUNT_HAS_ACTIVE_WORK' });
        expect(await userRow(user.id)).toMatchObject({ status: 'ACTIVE', version: String(version) });
        expect(await auditCount('admin.user.lock.v1', user.id)).toBe(0);
        // The orders finish (or are cancelled): the lock is allowed and records its category.
        processing = 0;
        const locked = await command('lock', user.id, lockBody(version, { lock_reason: 'SECURITY' }));
        expect(locked.status).toBe(200);
        expect(adminData(locked)).toMatchObject({ account_status: 'DISABLED', lock_reason: 'SECURITY' });
        expect(await userRow(user.id)).toMatchObject({ status: 'DISABLED', lock_reason: 'SECURITY' });
        // Unlock is never blocked by work, whatever the lock reason was.
        processing = 5;
        expect((await command('unlock', user.id, lockBody(version + 1))).status).toBe(200);
        expect(await userRow(user.id)).toMatchObject({ status: 'ACTIVE', lock_reason: null });
      } finally {
        registry.unregister('DELIVERIES');
      }
    });

    it('an ADMIN without the lock right on every domain cannot lock, delete or unlock; the category is only accepted on a lock', async () => {
      const user = await seedUser({ roles: ['CUSTOMER'] });
      const admin = await createAdminMember(app);
      const adminLogin = await enrollAndLogin(app, admin);
      expect(codeOf(await command('lock', user.id, lockBody(1), adminLogin))).toMatchObject({ status: 403, code: 'ADMIN_FORBIDDEN' });
      expect(codeOf(await command('delete', user.id, lockBody(1), adminLogin))).toMatchObject({ status: 403, code: 'ADMIN_FORBIDDEN' });
      expect(codeOf(await command('delete', user.id, lockBody(1, { lock_reason: 'SECURITY' })))).toEqual({ status: 400, code: 'ADMIN_INPUT_INVALID' });
      expect(codeOf(await command('lock', user.id, lockBody(1, { lock_reason: 'DELETE_REQUEST' })))).toEqual({ status: 400, code: 'ADMIN_INPUT_INVALID' });
      expect(await userRow(user.id)).toMatchObject({ status: 'ACTIVE' });
    });
  });

  // =============================================================================================================================
  // 10. A locked driver keeps the wallet and nothing else
  // =============================================================================================================================
  describe('a locked driver', () => {
    it('case 10 — signs in to 11Ship with the limited (wallet-only) access; cannot take new orders or use any other function; a locked non-driver cannot sign in', async () => {
      const driver = await seedUser({ roles: ['CUSTOMER', 'DRIVER'] });
      expect((await command('lock', driver.id, lockBody(1))).status).toBe(200);

      // Food refuses; Ship serves the limited access.
      expect(errorCode(await loginClient(driver.phone, PASSWORD, FOOD))).toBe('ACCOUNT_DISABLED');
      const login = await loginClient(driver.phone, PASSWORD, SHIP);
      expect(login.status).toBe(200);
      const identity = dataOf(login);
      expect(identity).toMatchObject({ user_id: driver.id, account_status: 'LOCKED', limited_access: 'WALLET_ONLY', available_roles: [], active_role: null, onboarding_required: false, role_selection_required: false });
      expect(identity.capabilities).toEqual({ customer_access: false, shop_profile_read: false, shop_manage: false, driver_profile_read: false });
      const token = tokenOf(login);
      const mine = await me(token);
      expect(mine.status).toBe(200);
      expect(dataOf(mine)).toMatchObject({ account_status: 'LOCKED', limited_access: 'WALLET_ONLY' });

      // Every other route and every business command stays closed (ACCOUNT_DISABLED): nothing new is accepted.
      for (const [method, path, body] of [
        ['POST', '/client-auth/context', { context: 'DRIVER' }],
        ['GET', '/driver/me', undefined],
        ['GET', '/customer/me/profile', undefined],
        ['GET', '/shop/me', undefined],
      ] as const) {
        const response = await api(base(), method, path, { bearer: token, headers: { 'idempotency-key': randomUUID() }, ...(body === undefined ? {} : { body }) });
        expect([path, response.status, errorCode(response)]).toEqual([path, 403, 'ACCOUNT_DISABLED']);
      }

      // The participant every business command uses refuses; only the wallet variant serves a locked DRIVER.
      const participant = app.running.app.get(SessionAuthorizationParticipant, { strict: false });
      const transactions = app.running.app.get(TransactionManager, { strict: false });
      const session = (await app.pool.query<{ session_id: string }>('SELECT session_id FROM app.sessions WHERE user_id = $1::uuid AND revoked_at IS NULL', [driver.id])).rows[0]?.session_id as string;
      const actor = { userId: driver.id, sessionId: session };
      await expect(transactions.withTransaction((context) => participant.lockAuthorizedActor(context, actor))).rejects.toMatchObject({ code: 'ACCOUNT_DISABLED' });
      await expect(transactions.withTransaction((context) => participant.lockAuthorizedShopActor(context, actor))).rejects.toMatchObject({ code: 'ACCOUNT_DISABLED' });
      await expect(transactions.withTransaction((context) => participant.lockAuthorizedDriverWalletActor(context, actor))).resolves.toEqual({ limited: true });
      // A session of the CUSTOMER context (no DRIVER context) gets nothing, even with the DRIVER role held.
      await app.pool.query("UPDATE app.sessions SET active_role = NULL WHERE session_id = $1::uuid", [session]);
      await expect(transactions.withTransaction((context) => participant.lockAuthorizedDriverWalletActor(context, actor))).rejects.toMatchObject({ code: 'ACCOUNT_DISABLED' });

      // A locked account that is not a driver has no access at all; unlocking restores the ordinary sign-in.
      const customer = await seedUser({ roles: ['CUSTOMER'] });
      expect((await command('lock', customer.id, lockBody(1))).status).toBe(200);
      expect(errorCode(await loginClient(customer.phone, PASSWORD, SHIP))).toBe('ACCOUNT_DISABLED');
      expect((await command('unlock', driver.id, lockBody(2))).status).toBe(200);
      const back = await loginClient(driver.phone, PASSWORD, SHIP);
      expect(back.status).toBe(200);
      expect(dataOf(back).account_status).toBeUndefined();
    });
  });

  // =============================================================================================================================
  // 11 / 12 / 13. Recovery of a locked account
  // =============================================================================================================================
  describe('recovery of a locked account', () => {
    async function lockedByDeleteRequest(): Promise<Seeded & { shopId: string }> {
      const owner = await seedUser({ roles: ['CUSTOMER', 'SHOP'] });
      const shopId = (await app.pool.query<{ shop_id: string }>('SELECT shop_id FROM app.shop_members WHERE user_id = $1::uuid', [owner.id])).rows[0]?.shop_id as string;
      const deleted = await command('delete', owner.id, lockBody(1));
      expect(adminData(deleted)).toMatchObject({ result: 'LOCKED', lock_reason: 'DELETE_REQUEST' });
      return { ...owner, shopId };
    }
    const recoverOtp = (phone: Phone): Promise<ApiResponse> => api(base(), 'POST', '/account-recovery/locked/otp', { body: { phone: phone.local } });
    const recoverVerify = (id: string, otp: string): Promise<ApiResponse> => api(base(), 'POST', `/account-recovery/locked/otp/${id}/verify`, { body: { otp } });
    const recover = (token: string, password: string = NEW_PASSWORD, key: string = randomUUID()): Promise<ApiResponse> =>
      api(base(), 'POST', '/account-recovery/locked/recover', { headers: { 'idempotency-key': key }, body: { verification_token: token, password } });

    it('case 11 + 13 — registering the phone of such an account points to recovery; recovery REQUIRES the OTP and a new password; same id, roles and records; old sessions stay dead', async () => {
      const owner = await lockedByDeleteRequest();
      const before = {
        roles: (await app.pool.query('SELECT role FROM app.user_roles WHERE user_id = $1::uuid ORDER BY role', [owner.id])).rows,
        shop: (await app.pool.query('SELECT shop_id, name, status, version::text FROM app.shops WHERE shop_id = $1::uuid', [owner.shopId])).rows,
        created: (await app.pool.query('SELECT created_at FROM app.users WHERE user_id = $1::uuid', [owner.id])).rows,
        profile: (await app.pool.query('SELECT full_name FROM app.customer_profiles WHERE user_id = $1::uuid', [owner.id])).rows,
        audit: await count(app.pool, 'SELECT 1 FROM app.audit_logs WHERE resource_id = $1', [owner.id]),
      };

      // The register screen's two entry points both say "recover".
      const otpRequest = await api(base(), 'POST', '/auth/phone-verifications', { body: { phone: owner.phone.local, purpose: 'REGISTER' } });
      expect([otpRequest.status, errorCode(otpRequest)]).toEqual([409, 'ACCOUNT_RECOVERY_AVAILABLE']);
      expect(await nextSms()).toBeNull();
      await postSettings(sys(), settingsBody(0, false, false)); // BOTH switches off: recovery must not become easier
      const direct = await registerClient(registerBody(owner.phone));
      expect([direct.status, errorCode(direct)]).toEqual([409, 'ACCOUNT_RECOVERY_AVAILABLE']);
      expect(await count(app.pool, 'SELECT 1 FROM app.users WHERE phone_normalized = $1', [owner.phone.normalized])).toBe(1);
      expect(await resetConfig()).toBe('UNAVAILABLE');
      expect((await api(base(), 'GET', '/account-recovery/locked/config')).body.data?.mode).toBe('SMS_OTP');

      // No proof, no recovery: the OTP cannot be skipped by any body.
      const noProof = await recover('A'.repeat(43));
      expect([noProof.status, errorCode(noProof)]).toEqual([400, 'VERIFICATION_PROOF_INVALID']);
      expect(await userRow(owner.id)).toMatchObject({ status: 'DISABLED', lock_reason: 'DELETE_REQUEST' });
      // The password-reset proof of the same phone is not a recovery proof.
      const asked = await recoverOtp(owner.phone);
      expect(asked.status).toBe(200);
      const id = String(dataOf(asked).verification_id);
      const sms = await nextSms();
      expect(sms?.to).toBe(owner.phone.normalized);
      expect((await recoverVerify(id, sms?.otp === '000000' ? '111111' : '000000')).status).toBe(400); // wrong code
      const proof = String(dataOf(await recoverVerify(id, sms?.otp as string)).verification_token);
      const crossed = await api(base(), 'POST', '/account-recovery/reset', { headers: { 'idempotency-key': randomUUID() }, body: { verification_token: proof, password: NEW_PASSWORD } });
      expect([crossed.status, errorCode(crossed)]).toEqual([403, 'PASSWORD_RESET_DISABLED']);
      await postSettings(sys(), settingsBody(2, true, true));
      const crossedOn = await api(base(), 'POST', '/account-recovery/reset', { headers: { 'idempotency-key': randomUUID() }, body: { verification_token: proof, password: NEW_PASSWORD } });
      expect([crossedOn.status, errorCode(crossedOn)]).toEqual([400, 'VERIFICATION_PURPOSE_MISMATCH']);
      expect(await userRow(owner.id)).toMatchObject({ status: 'DISABLED' });

      // The real recovery.
      const key = randomUUID();
      const recovered = await recover(proof, NEW_PASSWORD, key);
      expect(recovered.status).toBe(200);
      expect(recovered.body.data).toEqual({ next: 'LOGIN' });
      expect(await userRow(owner.id)).toMatchObject({ status: 'ACTIVE', lock_reason: null });
      expect((await recover(proof, NEW_PASSWORD, key)).status).toBe(200); // the lost-response retry is the same answer
      expect(errorCode(await recover(proof))).toBe('VERIFICATION_PROOF_USED');
      expect((await loginClient(owner.phone)).status).toBe(401); // the old password is gone
      const login = await loginClient(owner.phone, NEW_PASSWORD);
      expect(login.status).toBe(200);
      expect(dataOf(login).user_id).toBe(owner.id);

      // Same id, same roles, same records; nothing was reactivated by the unlock itself.
      expect((await app.pool.query('SELECT role FROM app.user_roles WHERE user_id = $1::uuid ORDER BY role', [owner.id])).rows).toEqual(before.roles);
      expect((await app.pool.query('SELECT shop_id, name, status, version::text FROM app.shops WHERE shop_id = $1::uuid', [owner.shopId])).rows).toEqual(before.shop);
      expect((await app.pool.query('SELECT created_at FROM app.users WHERE user_id = $1::uuid', [owner.id])).rows).toEqual(before.created);
      expect((await app.pool.query('SELECT full_name FROM app.customer_profiles WHERE user_id = $1::uuid', [owner.id])).rows).toEqual(before.profile);
      expect(await count(app.pool, 'SELECT 1 FROM app.audit_logs WHERE resource_id = $1', [owner.id])).toBeGreaterThan(before.audit);
      expect(await auditCount('account.recover_locked.v1', owner.id)).toBe(1);
      expect(await count(app.pool, "SELECT 1 FROM app.outbox_events WHERE resource_id = $1 AND event_type = 'user.account.unlocked.v1'", [owner.id])).toBe(1);
      expect(await count(app.pool, 'SELECT 1 FROM app.users WHERE phone_normalized = $1', [owner.phone.normalized])).toBe(1);
    });

    it('case 11b — with the SMS gateway not working there is no recovery: the request answers 503 honestly and nothing is unlocked or skipped', async () => {
      const owner = await lockedByDeleteRequest();
      expect((await ctl('disable')).code).toBe(0);
      try {
        const asked = await recoverOtp(owner.phone);
        expect(asked.status).toBe(503);
        expect(await count(app.pool, "SELECT 1 FROM app.phone_verifications WHERE phone_normalized = $1 AND purpose = 'RECOVER_ACCOUNT' AND status = 'VERIFIED'", [owner.phone.normalized])).toBe(0);
        const direct = await recover('B'.repeat(43));
        expect(direct.status).toBe(400);
        expect(await userRow(owner.id)).toMatchObject({ status: 'DISABLED', lock_reason: 'DELETE_REQUEST' });
      } finally {
        expect((await ctl('enable')).code).toBe(0);
        expect((await gw('/heartbeat', { app_version: '0.2.0', sms_permission: true, paused: false })).status).toBe(200);
      }
    });

    it('case 12 — an account locked for a violation or for security cannot recover itself: no SMS, a forged proof is refused, registering says plainly "already registered"', async () => {
      for (const reason of ['VIOLATION', 'SECURITY'] as const) {
        const user = await seedUser({ roles: ['CUSTOMER'], status: 'DISABLED', lockReason: reason });
        const registerOtp = await api(base(), 'POST', '/auth/phone-verifications', { body: { phone: user.phone.local, purpose: 'REGISTER' } });
        expect([registerOtp.status, errorCode(registerOtp)]).toEqual([409, 'PHONE_ALREADY_REGISTERED']);
        // With the OTP switch off a bodyless registration reaches the phone check: still the plain conflict, never "recover".
        const current = adminData(await getSettings(sys()));
        await postSettings(sys(), settingsBody(Number(current.version), false, true));
        const direct = await registerClient(registerBody(user.phone));
        expect(errorCode(direct)).toBe('PHONE_ALREADY_REGISTERED');
        await postSettings(sys(), settingsBody(Number(current.version) + 1, true, true));
        // The generic answer, but no SMS is queued for such an account.
        expect((await recoverOtp(user.phone)).status).toBe(200);
        expect(await nextSms()).toBeNull();
        // A proof of the recovery purpose for this phone (forged straight into the database) still unlocks nothing.
        const proof = await forgeRecoveryProof(user.phone);
        const refused = await recover(proof);
        expect([refused.status, errorCode(refused)]).toEqual([400, 'VERIFICATION_PROOF_INVALID']);
        expect(await userRow(user.id)).toMatchObject({ status: 'DISABLED', lock_reason: reason });
        expect(errorCode(await loginClient(user.phone, NEW_PASSWORD))).toBe('INVALID_CREDENTIALS');
      }
      // An older lock with no recorded reason is read as "not self-recoverable" as well.
      const legacy = await seedUser({ roles: ['CUSTOMER'], status: 'DISABLED' });
      await app.pool.query("UPDATE app.users SET lock_reason = NULL, locked_at = NULL WHERE user_id = $1::uuid", [legacy.id]);
      const now = adminData(await getSettings(sys()));
      await postSettings(sys(), settingsBody(Number(now.version), false, true));
      expect(errorCode(await registerClient(registerBody(legacy.phone)))).toBe('PHONE_ALREADY_REGISTERED');
      const forged = await forgeRecoveryProof(legacy.phone);
      expect(errorCode(await recover(forged))).toBe('VERIFICATION_PROOF_INVALID');
      expect(await userRow(legacy.id)).toMatchObject({ status: 'DISABLED' });
    });

    it('a recovered account whose shop was closed meanwhile does not get the shop back; an unlock by an administrator never reactivates anything either', async () => {
      const owner = await lockedByDeleteRequest();
      await app.pool.query("UPDATE app.shops SET status = 'DISABLED' WHERE shop_id = $1::uuid", [owner.shopId]);
      const asked = await recoverOtp(owner.phone);
      const sms = await nextSms();
      const proof = String(dataOf(await recoverVerify(String(dataOf(asked).verification_id), sms?.otp as string)).verification_token);
      expect((await recover(proof)).status).toBe(200);
      expect((await app.pool.query<{ status: string }>('SELECT status FROM app.shops WHERE shop_id = $1::uuid', [owner.shopId])).rows[0]?.status).toBe('DISABLED');
      const login = await loginClient(owner.phone, NEW_PASSWORD);
      expect(login.status).toBe(200);
      expect(dataOf(login).available_roles).not.toContain('SHOP_OWNER');
    });

    async function forgeRecoveryProof(phone: Phone): Promise<string> {
      const verificationId = randomUUID();
      const token = randomBytes(32).toString('base64url');
      await app.pool.query(
        `INSERT INTO app.phone_verifications (verification_id, phone_normalized, purpose, otp_digest, status, attempt_count, expires_at, resend_not_before, verified_at, created_at)
         VALUES ($1::uuid, $2, 'RECOVER_ACCOUNT', repeat('0', 64), 'VERIFIED', 0, now() + interval '10 minutes', now(), now(), now())`,
        [verificationId, phone.normalized],
      );
      await app.pool.query(
        `INSERT INTO app.verification_proofs (proof_id, verification_id, phone_normalized, purpose, token_digest, expires_at, created_at)
         VALUES ($1::uuid, $2::uuid, $3, 'RECOVER_ACCOUNT', $4, clock_timestamp() + interval '10 minutes', clock_timestamp())`,
        [randomUUID(), verificationId, phone.normalized, createHash('sha256').update(token).digest('hex')],
      );
      return token;
    }
  });
});
