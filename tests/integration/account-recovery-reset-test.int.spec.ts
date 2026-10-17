import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ADMIN_PREAUTH_COOKIE } from '../../apps/backend/src/admin-auth/admin-auth-constants';
import { Argon2idPasswordHasher } from '../../apps/backend/src/auth/password-hasher';
import {
  AdminApp,
  adminData,
  cookieFrom,
  count,
  createAdminMember,
  createSystem,
  enrollAndLogin,
  loginBody,
  preauthCookies,
  rewindAcceptedStep,
  sessionCookies,
  startAdminApp,
  totpNow,
} from './support/admin-fixtures';
import { api, ApiResponse, dataOf, errorCode, grantRole, PASSWORD, Phone, randomPhone, setUserStatus } from './support/auth-fixtures';

// M01-RESET (docs/tasks/M01-reset-disabled-test-handoff-20261013.md) on the REAL Nest pipeline and a REAL PostgreSQL (TEST
// database only). No OTP, no proof: ACCOUNT_RECOVERY_MODE=DISABLED_TEST resets by phone. USER and ADMIN are reset, SYSTEM and
// unknown phones are not, and the answer never tells them apart.

const NEW_PASSWORD = 'Brand-New-Passw0rd-7';
const WEB_FOOD = { device_id: 'web-food-0001', platform: 'WEB', app: 'FOOD' };
const WEB_SHIP = { device_id: 'web-ship-0001', platform: 'WEB', app: 'SHIP' };
const ACK = { data: { next: 'LOGIN' } };
const ACTION = 'account.password.reset_test.v1';

describe('M01-RESET no-OTP test password reset', () => {
  let app: AdminApp;
  let closed: AdminApp;
  const hasher = new Argon2idPasswordHasher();

  beforeAll(async () => {
    app = await startAdminApp({ accountRecovery: true });
    closed = await startAdminApp();
  });

  afterAll(async () => {
    await closed.close();
    await app.close();
  });

  const reset = (phone: string, password: string, key: string | null = randomUUID(), body?: Record<string, unknown>, target: AdminApp = app, route = '/account-recovery/reset-test'): Promise<ApiResponse> =>
    api(target.running.baseUrl, 'POST', route, {
      ...(key === null ? {} : { headers: { 'idempotency-key': key } }),
      body: body ?? { phone, password },
    });

  const clientLogin = (phone: Phone, password: string, device: Record<string, unknown>): Promise<ApiResponse> =>
    api(app.running.baseUrl, 'POST', '/client-auth/login', {
      headers: { 'idempotency-key': randomUUID() },
      body: { phone: phone.local, password, device },
    });

  const me = (token: string): Promise<ApiResponse> => api(app.running.baseUrl, 'GET', '/client-auth/me', { bearer: token });

  async function seedUser(origin: 'PHONE_VERIFIED' | 'TEST_UNVERIFIED' | 'STAGING_FIXTURE' = 'PHONE_VERIFIED'): Promise<{ phone: Phone; userId: string }> {
    const phone = randomPhone();
    app.track(phone.normalized);
    const userId = randomUUID();
    const verified = origin === 'PHONE_VERIFIED' ? 'now()' : 'NULL';
    await app.pool.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
       VALUES ($1::uuid, $2, $3, ${verified}, $4, 'ACTIVE', 1, now(), now())`,
      [userId, phone.normalized, await hasher.hash(PASSWORD), origin],
    );
    await grantRole(app.pool, userId, 'CUSTOMER');
    return { phone, userId };
  }

  const userRow = async (userId: string) =>
    (await app.pool.query<{ password_hash: string; status: string; version: string }>('SELECT password_hash, status, version::text FROM app.users WHERE user_id = $1::uuid', [userId])).rows[0] as {
      password_hash: string;
      status: string;
      version: string;
    };

  it('GET config reports the mode exactly (no-store; a query is refused); the default app is UNAVAILABLE', async () => {
    const on = await api(app.running.baseUrl, 'GET', '/account-recovery/config');
    expect([on.status, on.body, on.headers.get('cache-control')]).toEqual([200, { data: { mode: 'DISABLED_TEST' } }, 'no-store']);
    expect((await api(app.running.baseUrl, 'GET', '/account-recovery/config?x=1')).status).toBe(400);
    const off = await api(closed.running.baseUrl, 'GET', '/account-recovery/config');
    expect([off.status, off.body]).toEqual([200, { data: { mode: 'UNAVAILABLE' } }]);
  });

  it('a closed application answers 503 before anything is read, hashed or written', async () => {
    const user = await seedUser();
    const before = await userRow(user.userId);
    const response = await reset(user.phone.local, NEW_PASSWORD, randomUUID(), undefined, closed);
    expect(response.status).toBe(503);
    expect(response.text).not.toContain(NEW_PASSWORD);
    expect(await userRow(user.userId)).toEqual(before);
    expect(await count(app.pool, `SELECT 1 FROM app.audit_logs WHERE action = $1 AND resource_id = $2`, [ACTION, user.userId])).toBe(0);
    // Not even the shape of the body is looked at.
    expect((await reset('', '', null, { junk: true }, closed)).status).toBe(503);
  });

  it('resets a USER: every Food/Ship session dies, the old password fails, the new one logs in, status and roles stay', async () => {
    const user = await seedUser();
    const food = await clientLogin(user.phone, PASSWORD, WEB_FOOD);
    const ship = await clientLogin(user.phone, PASSWORD, WEB_SHIP);
    expect([food.status, ship.status]).toEqual([200, 200]);
    const tokens = [String(dataOf(food).access_token), String(dataOf(ship).access_token)];
    expect((await me(tokens[0] as string)).status).toBe(200);
    const before = await userRow(user.userId);

    const key = randomUUID();
    const done = await reset(user.phone.local, NEW_PASSWORD, key);
    expect([done.status, done.body, done.headers.get('cache-control')]).toEqual([200, ACK, 'no-store']);
    expect(done.text).not.toContain(NEW_PASSWORD);

    for (const token of tokens) {
      expect((await me(token)).status).toBe(401);
    }
    expect(await count(app.pool, 'SELECT 1 FROM app.sessions WHERE user_id = $1::uuid AND revoked_at IS NULL', [user.userId])).toBe(0);
    expect((await clientLogin(user.phone, PASSWORD, WEB_FOOD)).status).toBe(401);
    const fresh = await clientLogin(user.phone, NEW_PASSWORD, WEB_FOOD);
    expect(fresh.status).toBe(200);
    expect((await me(String(dataOf(fresh).access_token))).status).toBe(200);

    const after = await userRow(user.userId);
    expect(after.status).toBe('ACTIVE');
    expect(Number(after.version)).toBe(Number(before.version) + 1);
    expect(after.password_hash).not.toBe(before.password_hash);
    expect(await count(app.pool, `SELECT 1 FROM app.user_roles WHERE user_id = $1::uuid AND role = 'CUSTOMER'`, [user.userId])).toBe(1);

    // Audit: IDs and the no-verification marker only; never the phone or a password.
    const audit = await app.pool.query<{ actor_type: string; metadata: Record<string, unknown> }>(
      `SELECT actor_type, metadata FROM app.audit_logs WHERE action = $1 AND resource_id = $2`,
      [ACTION, user.userId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.actor_type).toBe('ANONYMOUS');
    expect(audit.rows[0]?.metadata).toMatchObject({ target_user_id: user.userId, target_kind: 'USER', verification: 'TEST_NO_PHONE_VERIFICATION' });
    const text = JSON.stringify(audit.rows[0]);
    expect(text).not.toContain(NEW_PASSWORD);
    expect(text).not.toContain(user.phone.normalized);
    expect(text).not.toContain(user.phone.local);

    // Idempotency: the same key and body replay the acknowledgement without another hash, revocation or audit row; another body is refused.
    const hashAfter = after.password_hash;
    const replay = await reset(user.phone.local, NEW_PASSWORD, key);
    expect([replay.status, replay.body]).toEqual([200, ACK]);
    expect((await userRow(user.userId)).password_hash).toBe(hashAfter);
    expect((await me(String(dataOf(fresh).access_token))).status).toBe(200);
    expect(await count(app.pool, `SELECT 1 FROM app.audit_logs WHERE action = $1 AND resource_id = $2`, [ACTION, user.userId])).toBe(1);
    const reused = await reset(user.phone.local, 'Another-Passw0rd-Entirely', key);
    expect([reused.status, errorCode(reused)]).toEqual([409, 'IDEMPOTENCY_KEY_REUSED']);
  });

  it('keeps a DISABLED USER disabled and resets a TEST_UNVERIFIED one; a STAGING_FIXTURE account is left alone', async () => {
    const disabled = await seedUser();
    await setUserStatus(app.pool, disabled.userId, 'DISABLED');
    expect((await reset(disabled.phone.local, NEW_PASSWORD)).body).toEqual(ACK);
    const row = await userRow(disabled.userId);
    expect(row.status).toBe('DISABLED');
    expect(await hasher.verify(row.password_hash, NEW_PASSWORD)).toBe(true);

    const unverified = await seedUser('TEST_UNVERIFIED');
    // TEST_UNVERIFIED is ordinary only where the process serves it (the no-proof registration mode); this app does not.
    const beforeU = await userRow(unverified.userId);
    expect((await reset(unverified.phone.local, NEW_PASSWORD)).body).toEqual(ACK);
    expect((await userRow(unverified.userId)).password_hash).toBe(beforeU.password_hash);

    const fixture = await seedUser('STAGING_FIXTURE');
    const beforeF = await userRow(fixture.userId);
    expect((await reset(fixture.phone.local, NEW_PASSWORD)).body).toEqual(ACK);
    expect(await userRow(fixture.userId)).toEqual(beforeF);
  });

  it('answers the same acknowledgement for an unknown phone and for SYSTEM, which stays unchanged', async () => {
    const system = await createSystem(app);
    const beforeS = await app.pool.query('SELECT password_hash, version, status FROM app.users WHERE user_id = $1::uuid', [system.userId]);
    const unknown = await reset(randomPhone().local, NEW_PASSWORD);
    const sys = await reset(system.phone.local, NEW_PASSWORD);
    expect([unknown.status, unknown.body]).toEqual([200, ACK]);
    expect([sys.status, sys.body]).toEqual([200, ACK]);
    expect(sys.text).toBe(unknown.text);
    const afterS = await app.pool.query('SELECT password_hash, version, status FROM app.users WHERE user_id = $1::uuid', [system.userId]);
    expect(afterS.rows).toEqual(beforeS.rows);
    expect(await count(app.pool, `SELECT 1 FROM app.audit_logs WHERE action = $1 AND resource_id = $2`, [ACTION, system.userId])).toBe(0);
    // SYSTEM still logs in with its own password.
    const login = await app.call('POST', '/login', { body: loginBody(system) });
    expect(login.status).toBe(200);
  });

  it('resets an ADMIN: session and preauth die, the old password fails, the new one still needs the SAME active TOTP', async () => {
    const admin = await createAdminMember(app);
    const first = await enrollAndLogin(app, admin);
    const factorBefore = await app.pool.query('SELECT factor_id, state FROM app.admin_totp_factors WHERE user_id = $1::uuid', [admin.userId]);
    expect(factorBefore.rows).toHaveLength(1);
    // A preauth step created before the reset (password right, code not yet given).
    const stale = await app.call('POST', '/login', { body: loginBody(admin) });
    const stalePre = { cookie: String(cookieFrom(stale, ADMIN_PREAUTH_COOKIE)), csrf: String(adminData(stale).csrf_token) };
    expect((await app.call('GET', '/me', { cookies: sessionCookies(first) })).status).toBe(200);

    const done = await reset(admin.phone.local, NEW_PASSWORD, randomUUID(), undefined, app, '/admin-recovery/reset-test');
    expect([done.status, done.body]).toEqual([200, ACK]);

    expect((await app.call('GET', '/me', { cookies: sessionCookies(first) })).status).toBe(401);
    await rewindAcceptedStep(app, admin.userId);
    const stalePost = await app.call('POST', '/totp/verify', {
      body: { code: totpNow(first.secret) },
      cookies: preauthCookies({ ...stalePre } as never),
      csrf: stalePre.csrf,
    });
    expect([401, 400, 403]).toContain(stalePost.status);
    expect(stalePost.body.data).toBeUndefined();
    expect(await count(app.pool, 'SELECT 1 FROM app.admin_sessions WHERE user_id = $1::uuid AND revoked_at IS NULL', [admin.userId])).toBe(0);
    expect(await count(app.pool, 'SELECT 1 FROM app.admin_auth_challenges WHERE user_id = $1::uuid AND consumed_at IS NULL', [admin.userId])).toBe(0);

    const oldLogin = await app.call('POST', '/login', { body: loginBody(admin) });
    expect(oldLogin.status).toBe(401);
    const newLogin = await app.call('POST', '/login', { body: loginBody(admin, { password: NEW_PASSWORD }) });
    expect(newLogin.status).toBe(200);
    expect(adminData(newLogin).next_step).toBe('VERIFY_TOTP');
    const pre = { cookie: String(cookieFrom(newLogin, ADMIN_PREAUTH_COOKIE)), csrf: String(adminData(newLogin).csrf_token) };
    const verified = await app.call('POST', '/totp/verify', { body: { code: totpNow(first.secret) }, cookies: { [ADMIN_PREAUTH_COOKIE]: pre.cookie }, csrf: pre.csrf });
    expect(verified.status).toBe(200);

    const factorAfter = await app.pool.query('SELECT factor_id, state FROM app.admin_totp_factors WHERE user_id = $1::uuid', [admin.userId]);
    expect(factorAfter.rows).toEqual(factorBefore.rows);
    expect(await count(app.pool, `SELECT 1 FROM app.admin_memberships WHERE user_id = $1::uuid AND admin_role = 'ADMIN' AND status = 'ACTIVE'`, [admin.userId])).toBe(1);
    const audit = await app.pool.query<{ metadata: Record<string, unknown> }>(`SELECT metadata FROM app.audit_logs WHERE action = $1 AND resource_id = $2`, [ACTION, admin.userId]);
    expect(audit.rows[0]?.metadata).toMatchObject({ target_kind: 'ADMIN', admin_credentials_revoked: true });
  });

  it('refuses a bad body with a generic 400 that echoes nothing, and writes nothing', async () => {
    const user = await seedUser();
    const before = await userRow(user.userId);
    const cases: Array<Record<string, unknown>> = [
      { phone: user.phone.local, password: NEW_PASSWORD, code: '123456' },
      { phone: user.phone.local, password: NEW_PASSWORD, verification_token: 'x' },
      { phone: user.phone.local, password: NEW_PASSWORD, role: 'ADMIN' },
      { phone: user.phone.local, password: NEW_PASSWORD, password_confirmation: NEW_PASSWORD },
      { phone: user.phone.local },
      { phone: user.phone.local, password: 'short' },
      { phone: 'not-a-phone', password: NEW_PASSWORD },
    ];
    for (const body of cases) {
      const response = await reset('', '', randomUUID(), body);
      expect(response.status).toBe(400);
      expect(response.text).not.toContain(NEW_PASSWORD);
      expect(response.text).not.toContain(user.phone.local);
    }
    const noKey = await reset(user.phone.local, NEW_PASSWORD, null);
    expect(noKey.status).toBe(400);
    expect(await userRow(user.userId)).toEqual(before);
  });
});
