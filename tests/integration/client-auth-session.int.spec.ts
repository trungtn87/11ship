import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Argon2idPasswordHasher } from '../../apps/backend/src/auth/password-hasher';
import { eventually } from './support/async-helpers';
import {
  api,
  ApiResponse,
  AuthApp,
  countRows,
  createDriverFor,
  dataOf,
  errorCode,
  expireSession,
  grantRole,
  grantStrayRole,
  obtainProof,
  OTHER_PASSWORD,
  PASSWORD,
  Phone,
  randomPhone,
  registerUser,
  rowLockWaiters,
  sessionIdOfToken,
  setUserStatus,
  startAuthApp,
} from './support/auth-fixtures';
import { LockHolder } from './support/idempotency-fixtures';

// M01.04 — POST /v1/client-auth/login, GET /me, POST /context, POST /logout on the REAL Nest pipeline and a REAL PostgreSQL
// (TEST database only): login contexts per app, credentials and status rechecked under the user lock, replay with the original
// token and the CURRENT identity, context eligibility and replay, session-only revocation. Contract: docs/design/system-v2-20261011
// 10-m01-client-contract.md and 11-m01-session-device-contract.md sections 1-6.

const TERMS = 'test-terms-20261011-v1';
const PRIVACY = 'test-privacy-20261011-v1';
const WEB_FOOD = { device_id: 'web-food-0001', platform: 'WEB', app: 'FOOD' };
const WEB_SHIP = { device_id: 'web-ship-0001', platform: 'WEB', app: 'SHIP' };
const ANDROID_FOOD = { device_id: 'android-device-0001', platform: 'ANDROID', app: 'FOOD' };
const IDENTITY_KEYS = [
  'user_id',
  'phone_normalized',
  'available_roles',
  'active_role',
  'profile',
  'capabilities',
  'onboarding',
  'onboarding_required',
  'role_selection_required',
  'phone_verification_status',
];
const NOT_REPLAYABLE_MESSAGE = 'The authentication result can no longer be replayed';

interface Customer {
  readonly phone: Phone;
  readonly password: string;
  readonly userId: string;
}

describe('M01.04 — client login, me, context, logout', () => {
  let app: AuthApp;

  beforeAll(async () => {
    app = await startAuthApp({}, { relaxTimeouts: true, configOverride: { clientAuth: { termsVersion: TERMS, privacyVersion: PRIVACY } } });
  });

  afterAll(async () => {
    await app.close();
  });

  // ---------------------------------------------------------------------------------------------------- helpers

  /** A real CUSTOMER account, created through the client registration (OTP proof, consent, profile "Nguyễn Văn An"). */
  async function newCustomer(): Promise<Customer> {
    const phone = randomPhone();
    const proof = await obtainProof(app, phone);
    const response = await app.call('POST', '/client-auth/register', {
      headers: { 'idempotency-key': randomUUID() },
      body: {
        phone: phone.local,
        password: PASSWORD,
        verification_token: proof.proofToken,
        device: { ...WEB_FOOD },
        full_name: 'Nguyễn Văn An',
        consent: { terms_version: TERMS, privacy_version: PRIVACY },
      },
    });
    expect(response.status).toBe(201);
    return { phone, password: PASSWORD, userId: String(dataOf(response).user_id) };
  }

  function login(
    user: Customer,
    options: { device?: Record<string, unknown>; key?: string | null; password?: string; target?: AuthApp } = {},
  ): Promise<ApiResponse> {
    const key = options.key === undefined ? randomUUID() : options.key;
    return (options.target ?? app).call('POST', '/client-auth/login', {
      ...(key === null ? {} : { headers: { 'idempotency-key': key } }),
      body: { phone: user.phone.local, password: options.password ?? user.password, device: options.device ?? { ...WEB_FOOD } },
    });
  }

  async function loginOk(user: Customer, device: Record<string, unknown> = { ...WEB_FOOD }, key: string = randomUUID()) {
    const response = await login(user, { device, key });
    expect(response.status).toBe(200);
    const data = dataOf(response);
    const token = String(data.access_token);
    return { response, data, token, key, sessionId: await sessionIdOfToken(app.pool, token) };
  }

  const me = (token: string, target: AuthApp = app) => target.call('GET', '/client-auth/me', { bearer: token });

  function switchContext(token: string, context: unknown, key: string | null = randomUUID()): Promise<ApiResponse> {
    return app.call('POST', '/client-auth/context', {
      bearer: token,
      ...(key === null ? {} : { headers: { 'idempotency-key': key } }),
      body: { context },
    });
  }

  const logout = (token: string, body: unknown = {}) => app.call('POST', '/client-auth/logout', { bearer: token, body });

  async function sessionRow(sessionId: string) {
    const result = await app.pool.query<{ active_role: string | null; revoked: boolean; app: string; platform: string }>(
      'SELECT active_role, revoked_at IS NOT NULL AS revoked, app, platform FROM app.sessions WHERE session_id = $1::uuid',
      [sessionId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error('session row not found');
    }
    return row;
  }

  const sessionCount = (userId: string) => countRows(app.pool, 'SELECT 1 FROM app.sessions WHERE user_id = $1::uuid', [userId]);
  const auditCount = (userId: string, action: string) =>
    countRows(app.pool, 'SELECT 1 FROM app.audit_logs WHERE actor_id = $1 AND action = $2', [userId, action]);
  const loginRecords = (userId: string) =>
    countRows(app.pool, "SELECT 1 FROM app.idempotency_records WHERE scope_type = 'client_login' AND scope_id = $1", [userId]);
  const roleRows = (userId: string) => countRows(app.pool, 'SELECT 1 FROM app.user_roles WHERE user_id = $1::uuid', [userId]);

  async function auditMetadata(userId: string, action: string): Promise<Record<string, unknown>[]> {
    const result = await app.pool.query<{ metadata: Record<string, unknown> }>(
      'SELECT metadata FROM app.audit_logs WHERE actor_id = $1 AND action = $2 ORDER BY occurred_at',
      [userId, action],
    );
    return result.rows.map((row) => row.metadata);
  }

  /** Two real, distinguishable accounts the credentials cases need: an administration account has no client login. */
  async function adminProvisioned(): Promise<Customer> {
    const phone = randomPhone();
    app.track(phone.normalized);
    const userId = randomUUID();
    await app.pool.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
       VALUES ($1::uuid, $2, $3, NULL, 'ADMIN_PROVISIONED', 'ACTIVE', 1, now(), now())`,
      [userId, phone.normalized, await new Argon2idPasswordHasher().hash(PASSWORD)],
    );
    return { phone, password: PASSWORD, userId };
  }

  // -------------------------------------------------------------------------------------------------- L — login

  describe('L — login: response, context per app, no grants', () => {
    it('FOOD: exact response, CUSTOMER session, one audit row with safe fields only', async () => {
      const user = await newCustomer();
      const before = await sessionCount(user.userId);
      const response = await login(user);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const data = dataOf(response);
      expect(Object.keys(data)).toEqual([...IDENTITY_KEYS, 'access_token', 'session']);
      expect(data.user_id).toBe(user.userId);
      expect(data.phone_normalized).toBe(user.phone.normalized);
      expect(data.available_roles).toEqual(['CUSTOMER']);
      expect(data.active_role).toBe('CUSTOMER');
      expect(data.profile).toEqual({ full_name: 'Nguyễn Văn An', version: 1 });
      expect(data.capabilities).toEqual({ customer_access: true, shop_profile_read: false, shop_manage: false, driver_profile_read: false });
      expect(data.onboarding).toEqual({ shop: 'NOT_STARTED', driver: 'NOT_STARTED' });
      expect(data.onboarding_required).toBe(false);
      expect(data.role_selection_required).toBe(false);
      expect(Object.keys(data.session as object)).toEqual(['expires_at']);
      const expiresAt = Date.parse((data.session as { expires_at: string }).expires_at);
      expect(expiresAt).toBeGreaterThan(Date.now());

      const token = String(data.access_token);
      const sessionId = await sessionIdOfToken(app.pool, token);
      expect(await sessionRow(sessionId)).toEqual({ active_role: 'CUSTOMER', revoked: false, app: 'FOOD', platform: 'WEB' });
      expect(await sessionCount(user.userId)).toBe(before + 1);

      const [audit] = await auditMetadata(user.userId, 'client.auth.login.v1');
      expect(await auditCount(user.userId, 'client.auth.login.v1')).toBe(1);
      expect(audit).toEqual({ user_id: user.userId, session_id: sessionId, client_app: 'FOOD', binding_id: null });
      expect(JSON.stringify(audit)).not.toContain(token);
      expect(JSON.stringify(audit)).not.toContain(PASSWORD);
    });

    it('SHIP: a customer without a driver profile is CUSTOMER and asked for driver onboarding', async () => {
      const user = await newCustomer();
      const { data, sessionId } = await loginOk(user, { ...WEB_SHIP });
      expect(data.active_role).toBe('CUSTOMER');
      expect(data.onboarding_required).toBe(true);
      expect((await sessionRow(sessionId)).app).toBe('SHIP');
    });

    it('SHIP prefers DRIVER when it is selectable; FOOD never picks DRIVER or SHOP_OWNER on its own', async () => {
      const user = await newCustomer();
      await grantRole(app.pool, user.userId, 'DRIVER');
      await grantRole(app.pool, user.userId, 'SHOP');
      const ship = await loginOk(user, { ...WEB_SHIP });
      expect(ship.data.available_roles).toEqual(['CUSTOMER', 'SHOP_OWNER', 'DRIVER']);
      expect(ship.data.active_role).toBe('DRIVER');
      expect((await sessionRow(ship.sessionId)).active_role).toBe('DRIVER');
      expect(ship.data.onboarding_required).toBe(false);
      const food = await loginOk(user, { ...WEB_FOOD });
      expect(food.data.active_role).toBe('CUSTOMER');
      expect((await sessionRow(food.sessionId)).active_role).toBe('CUSTOMER');
    });

    it('SHIP falls back to CUSTOMER when the driver profile is CLOSED (not selectable)', async () => {
      const user = await newCustomer();
      await createDriverFor(app.pool, user.userId, { status: 'CLOSED' });
      await grantStrayRole(app.pool, user.userId, 'DRIVER');
      const { data } = await loginOk(user, { ...WEB_SHIP });
      expect(data.available_roles).toEqual(['CUSTOMER']);
      expect(data.active_role).toBe('CUSTOMER');
    });

    it('login never grants or repairs a role: a legacy account without CUSTOMER gets a roleless session', async () => {
      const legacy = await registerUser(app);
      const user: Customer = { phone: legacy.phone, password: legacy.password, userId: legacy.userId };
      const { data, sessionId } = await loginOk(user, { ...WEB_FOOD });
      expect(data.available_roles).toEqual([]);
      expect(data.active_role).toBeNull();
      expect(data.onboarding_required).toBe(true);
      expect(data.role_selection_required).toBe(false);
      expect(data.capabilities).toEqual({ customer_access: false, shop_profile_read: false, shop_manage: false, driver_profile_read: false });
      expect((await sessionRow(sessionId)).active_role).toBeNull();
      expect(await roleRows(user.userId)).toBe(0);
      expect(await countRows(app.pool, 'SELECT 1 FROM app.customer_profiles WHERE user_id = $1::uuid', [user.userId])).toBe(0);
    });
  });

  describe('L — credentials, status, device gate and request shape', () => {
    it('wrong password, unknown phone and an administration account are one answer and create nothing', async () => {
      const user = await newCustomer();
      const admin = await adminProvisioned();
      const before = await sessionCount(user.userId);
      const wrong = await login(user, { password: OTHER_PASSWORD });
      const unknown = await login({ ...user, phone: randomPhone() });
      const administration = await login(admin);
      for (const response of [wrong, unknown, administration]) {
        expect([response.status, errorCode(response)]).toEqual([401, 'INVALID_CREDENTIALS']);
        expect(response.body.error?.message).toBe(wrong.body.error?.message);
        expect(response.body.error?.details).toEqual(wrong.body.error?.details);
      }
      expect(await sessionCount(user.userId)).toBe(before);
      expect(await sessionCount(admin.userId)).toBe(0);
      expect(await loginRecords(user.userId)).toBe(0); // a wrong password never reaches an idempotency record
    });

    it('a disabled ordinary account is ACCOUNT_DISABLED (403), creates no session and leaves a DENIED audit row', async () => {
      const user = await newCustomer();
      await setUserStatus(app.pool, user.userId, 'DISABLED');
      const before = await sessionCount(user.userId);
      const response = await login(user);
      expect([response.status, errorCode(response)]).toEqual([403, 'ACCOUNT_DISABLED']);
      expect(await sessionCount(user.userId)).toBe(before);
      expect(await loginRecords(user.userId)).toBe(0);
      await eventually(
        async () =>
          (await countRows(app.pool, "SELECT 1 FROM app.audit_logs WHERE actor_id = $1 AND action = 'client.auth.login.v1' AND outcome = 'DENIED'", [user.userId])) === 1,
        'the best-effort DENIED audit row',
      );
    });

    it('requires an Idempotency-Key and the exact body {phone,password,device}', async () => {
      const user = await newCustomer();
      const before = await sessionCount(user.userId);
      const missing = await login(user, { key: null });
      expect([missing.status, errorCode(missing)]).toEqual([400, 'IDEMPOTENCY_KEY_REQUIRED']);
      expect(errorCode(await login(user, { key: 'not-a-uuid' }))).toBe('INVALID_IDEMPOTENCY_KEY');
      const extra = await app.call('POST', '/client-auth/login', {
        headers: { 'idempotency-key': randomUUID() },
        body: { phone: user.phone.local, password: user.password, device: { ...WEB_FOOD }, role: 'DRIVER' },
      });
      expect(extra.status).toBe(400);
      const legacyDevice = await login(user, { device: { device_id: 'device-test-0001', platform: 'ANDROID', app: 'SHIP11' } });
      expect(legacyDevice.status).toBe(400);
      expect(await sessionCount(user.userId)).toBe(before);
    });

    it('Android password login replaces prior sessions even with identical device_id; replay never revives them', async () => {
      const user = await newCustomer();
      const old = await loginOk(user, ANDROID_FOOD);
      expect((await me(old.token)).status).toBe(200);
      expect(errorCode(await login(user, { device: ANDROID_FOOD, password: 'wrong-password' }))).toBe('INVALID_CREDENTIALS');
      expect((await me(old.token)).status).toBe(200);
      const next = await loginOk(user, { ...ANDROID_FOOD, app: 'SHIP' });
      expect(errorCode(await me(old.token))).toBe('SESSION_REVOKED');
      expect((await me(next.token)).status).toBe(200);
      expect(errorCode(await login(user, { device: ANDROID_FOOD, key: old.key }))).toBe('AUTH_RESULT_NOT_REPLAYABLE');
      const replay = await login(user, { device: { ...ANDROID_FOOD, app: 'SHIP' }, key: next.key });
      expect(dataOf(replay).access_token).toBe(next.token);
      expect((await app.call('GET', '/client-auth/me')).status).toBe(401);
      expect((await app.call('GET', '/driver/me/wallet', { bearer: next.token })).status).not.toBe(200);
      expect((await logout(next.token)).status).toBe(204);
      expect(errorCode(await me(next.token))).toBe('SESSION_REVOKED');
      const again = await loginOk(user, ANDROID_FOOD);
      await expireSession(app.pool, again.sessionId);
      expect(errorCode(await me(again.token))).toBe('SESSION_EXPIRED');
    });

    it('login quota survives device/app changes and expiry restores credential login', async () => {
      const user = await newCustomer();
      const bucket = app.config.auth!.otpHmacKey.hmacSha256Hex(JSON.stringify(['11ship.client-login.v1', user.phone.normalized]));
      await app.pool.query('INSERT INTO app.client_login_limits (bucket_key, window_started_at, attempts) VALUES ($1, clock_timestamp(), 30)', [bucket]);
      const limited = await login(user, { device: { ...ANDROID_FOOD, device_id: 'another-untrusted-id', app: 'SHIP' } });
      expect([limited.status, errorCode(limited)]).toEqual([429, 'LOGIN_RATE_LIMITED']);
      await app.pool.query("UPDATE app.client_login_limits SET window_started_at = clock_timestamp() - interval '61 seconds' WHERE bucket_key = $1", [bucket]);
      expect((await login(user, { device: ANDROID_FOOD })).status).toBe(200);
    });

    it('legacy native token cannot become Bearer-only through client headers; session mode is immutable', async () => {
      const user = await newCustomer();
      const legacy = await loginOk(user);
      // Simulate the immutable facts of a session created by the old server, not a client-supplied mode.
      await app.pool.query("UPDATE app.sessions SET platform = 'ANDROID' WHERE session_id = $1", [legacy.sessionId]);
      for (const headers of [{} as Record<string, string>, { 'x-session-auth-method': 'PASSWORD', 'x-device-id': ANDROID_FOOD.device_id }]) {
        const denied = await app.call('GET', '/client-auth/me', { bearer: legacy.token, headers });
        expect(denied.status).toBeGreaterThanOrEqual(400);
      }
      const next = await loginOk(user, ANDROID_FOOD);
      await expect(app.pool.query("UPDATE app.sessions SET auth_method = 'LEGACY_DEVICE_PROOF' WHERE session_id = $1", [next.sessionId])).rejects.toThrow('immutable');
      expect((await me(next.token)).status).toBe(200);
      expect(errorCode(await me(legacy.token))).toBe('SESSION_REVOKED');
    });

    for (const [label, override] of [
      ['production', { appEnv: 'production' }],
      ['non-loopback bind in test', { host: '0.0.0.0' }],
    ] as const) {
      it(`WEB in ${label} answers DEVICE_PROOF_REQUIRED (403); a LOCAL_WEB session is not served there either`, async () => {
        const user = await newCustomer();
        const issued = await loginOk(user);
        const gated = await startAuthApp({}, { configOverride: { clientAuth: { termsVersion: TERMS, privacyVersion: PRIVACY }, ...override } as never });
        try {
          const before = await sessionCount(user.userId);
          const response = await login(user, { target: gated });
          expect([response.status, errorCode(response)]).toEqual([403, 'DEVICE_PROOF_REQUIRED']);
          expect(await sessionCount(user.userId)).toBe(before);
          // The platform RECORDED on the session is gated too: me answers the same, nothing is read.
          const served = await me(issued.token, gated);
          expect([served.status, errorCode(served)]).toEqual([403, 'DEVICE_PROOF_REQUIRED']);
          const left = await gated.call('POST', '/client-auth/logout', { bearer: issued.token, body: {} });
          expect([left.status, errorCode(left)]).toEqual([403, 'DEVICE_PROOF_REQUIRED']);
          expect((await sessionRow(issued.sessionId)).revoked).toBe(false);
        } finally {
          await gated.close();
        }
      });
    }

    it('a legacy session is not a session of this API: other app label -> 401; the legacy route issues no native ANDROID session -> 403', async () => {
      const legacy = await registerUser(app);
      const labelled = await api(app.running.baseUrl, 'POST', '/auth/login', {
        body: { phone: legacy.phone.local, password: legacy.password, device: { device_id: 'device-test-0001', platform: 'ANDROID', app: 'SHIP11' } },
      });
      const otherApp = String(dataOf(labelled).access_token);
      const labelledMe = await me(otherApp);
      expect([labelledMe.status, errorCode(labelledMe)]).toEqual([401, 'SESSION_INVALID']);
      // M01-ANDROID: the legacy login must not become a way around the device binding, so it refuses the native Food / Ship ANDROID labels.
      const androidFood = await api(app.running.baseUrl, 'POST', '/auth/login', {
        body: { phone: legacy.phone.local, password: legacy.password, device: { device_id: 'device-test-0002', platform: 'ANDROID', app: 'FOOD' } },
      });
      expect([androidFood.status, errorCode(androidFood)]).toEqual([403, 'DEVICE_PROOF_REQUIRED']);
    });
  });

  describe('L — recheck under the user lock', () => {
    async function loginBlockedAtUserLock(user: Customer, mutate: (holder: LockHolder) => Promise<void>) {
      const holder = await LockHolder.begin(app.pool);
      try {
        await holder.query('SELECT 1 FROM app.users WHERE user_id = $1::uuid FOR UPDATE', [user.userId]);
        const pending = login(user);
        // The password is verified OUTSIDE the transaction; the login then waits for the user row lock.
        await eventually(async () => (await rowLockWaiters(app.pool)) >= 1, 'the login waits on the user row lock');
        await mutate(holder);
        await holder.commit();
        return await pending;
      } finally {
        await holder.rollback();
      }
    }

    it('an account disabled while the password was being verified creates no session', async () => {
      const user = await newCustomer();
      const before = await sessionCount(user.userId);
      const response = await loginBlockedAtUserLock(user, (holder) =>
        holder.query("UPDATE app.users SET status = 'DISABLED', updated_at = clock_timestamp() WHERE user_id = $1::uuid", [user.userId]),
      );
      expect([response.status, errorCode(response)]).toEqual([403, 'ACCOUNT_DISABLED']);
      expect(await sessionCount(user.userId)).toBe(before);
    });

    it('a password changed while it was being verified creates no session (the verified hash is no longer current)', async () => {
      const user = await newCustomer();
      const before = await sessionCount(user.userId);
      const replacement = await new Argon2idPasswordHasher().hash(OTHER_PASSWORD);
      const response = await loginBlockedAtUserLock(user, (holder) =>
        holder.query('UPDATE app.users SET password_hash = $2, updated_at = clock_timestamp() WHERE user_id = $1::uuid', [user.userId, replacement]),
      );
      expect([response.status, errorCode(response)]).toEqual([401, 'INVALID_CREDENTIALS']);
      expect(await sessionCount(user.userId)).toBe(before);
      expect(await loginRecords(user.userId)).toBe(0);
    });

    it('a REPLAY whose verified password hash changed while it waited for the lock is INVALID_CREDENTIALS and returns no token', async () => {
      const user = await newCustomer();
      const first = await loginOk(user);
      const sessions = await sessionCount(user.userId);
      const audits = await auditCount(user.userId, 'client.auth.login.v1');
      const replacement = await new Argon2idPasswordHasher().hash(OTHER_PASSWORD);

      const holder = await LockHolder.begin(app.pool);
      let response: Awaited<ReturnType<typeof login>>;
      try {
        await holder.query('SELECT 1 FROM app.users WHERE user_id = $1::uuid FOR UPDATE', [user.userId]);
        // The same key and body: the password verifies against the OLD hash, then the replay waits for the user lock.
        const pending = login(user, { key: first.key });
        await eventually(async () => (await rowLockWaiters(app.pool)) >= 1, 'the replay waits on the user row lock');
        await holder.query('UPDATE app.users SET password_hash = $2, updated_at = clock_timestamp() WHERE user_id = $1::uuid', [user.userId, replacement]);
        await holder.commit();
        response = await pending;
      } finally {
        await holder.rollback();
      }

      // The session is still valid, yet the proof is stale: refused like a new login with a wrong password.
      expect([response.status, errorCode(response)]).toEqual([401, 'INVALID_CREDENTIALS']);
      expect(response.text).not.toContain(String(first.data.access_token));
      expect((await me(first.token)).status).toBe(200);
      expect(await sessionCount(user.userId)).toBe(sessions);
      expect(await auditCount(user.userId, 'client.auth.login.v1')).toBe(audits);
    });
  });

  describe('L — replay', () => {
    it('same key and body: the ORIGINAL token and expiry, no second session, no second audit row', async () => {
      const user = await newCustomer();
      const first = await loginOk(user);
      const count = await sessionCount(user.userId);
      const replay = await login(user, { key: first.key });
      expect(replay.status).toBe(200);
      expect(dataOf(replay).access_token).toBe(first.data.access_token);
      expect(dataOf(replay).session).toEqual(first.data.session);
      expect(await sessionCount(user.userId)).toBe(count);
      expect(await auditCount(user.userId, 'client.auth.login.v1')).toBe(1);
    });

    it('serves the CURRENT identity, never a snapshot: roles granted after the login appear in the replay', async () => {
      const user = await newCustomer();
      const first = await loginOk(user);
      expect(first.data.available_roles).toEqual(['CUSTOMER']);
      await grantRole(app.pool, user.userId, 'SHOP');
      const replay = dataOf(await login(user, { key: first.key }));
      expect(replay.access_token).toBe(first.data.access_token);
      expect(replay.available_roles).toEqual(['CUSTOMER', 'SHOP_OWNER']);
      expect((replay.capabilities as Record<string, boolean>).shop_manage).toBe(true);
    });

    it('a context switched after the login is reflected in the replay and is not undone by it', async () => {
      const user = await newCustomer();
      await grantRole(app.pool, user.userId, 'SHOP');
      const first = await loginOk(user);
      expect((await switchContext(first.token, 'SHOP_OWNER')).status).toBe(200);
      const replay = dataOf(await login(user, { key: first.key }));
      expect(replay.active_role).toBe('SHOP_OWNER');
      expect((await sessionRow(first.sessionId)).active_role).toBe('SHOP');
    });

    it('the same key with another body is IDEMPOTENCY_KEY_REUSED; with a wrong password it is only INVALID_CREDENTIALS', async () => {
      const user = await newCustomer();
      const first = await loginOk(user);
      const other = await login(user, { key: first.key, device: { ...WEB_FOOD, device_id: 'web-food-0002' } });
      expect([other.status, errorCode(other)]).toEqual([409, 'IDEMPOTENCY_KEY_REUSED']);
      const wrong = await login(user, { key: first.key, password: OTHER_PASSWORD });
      expect([wrong.status, errorCode(wrong)]).toEqual([401, 'INVALID_CREDENTIALS']);
      expect(wrong.text).not.toContain(String(first.data.access_token));
    });

    for (const [label, invalidate] of [
      ['logged out', async (_user: Customer, token: string) => void expect((await logout(token)).status).toBe(204)],
      ['expired', async (_user: Customer, token: string) => expireSession(app.pool, await sessionIdOfToken(app.pool, token))],
      ['disabled', async (user: Customer) => setUserStatus(app.pool, user.userId, 'DISABLED')],
    ] as const) {
      it(`a session that is ${label} is AUTH_RESULT_NOT_REPLAYABLE (409) and the token is not returned`, async () => {
        const user = await newCustomer();
        const first = await loginOk(user);
        await invalidate(user, first.token);
        const replay = await login(user, { key: first.key });
        expect([replay.status, errorCode(replay)]).toEqual([409, 'AUTH_RESULT_NOT_REPLAYABLE']);
        expect(replay.body.error?.message).toBe(NOT_REPLAYABLE_MESSAGE);
        expect(replay.body.error?.details).toEqual({});
        expect(replay.text).not.toContain(String(first.data.access_token));
      });
    }

    it('concurrent same-key logins create ONE session; different keys create two independent ones', async () => {
      const user = await newCustomer();
      const before = await sessionCount(user.userId);
      const key = randomUUID();
      const [a, b] = await Promise.all([login(user, { key }), login(user, { key })]);
      expect([a.status, b.status]).toEqual([200, 200]);
      expect(dataOf(a).access_token).toBe(dataOf(b).access_token);
      expect(await sessionCount(user.userId)).toBe(before + 1);

      const first = await loginOk(user);
      const second = await loginOk(user);
      expect(first.token).not.toBe(second.token);
      expect((await me(first.token)).status).toBe(200);
      expect((await me(second.token)).status).toBe(200);
    });
  });

  // ----------------------------------------------------------------------------------------------------- M — me

  describe('M — GET /me', () => {
    it('answers the identity and the session expiry, never a token, and writes nothing', async () => {
      const user = await newCustomer();
      const issued = await loginOk(user);
      const audits = await countRows(app.pool, 'SELECT 1 FROM app.audit_logs WHERE actor_id = $1', [user.userId]);
      const response = await me(issued.token);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const data = dataOf(response);
      expect(Object.keys(data)).toEqual([...IDENTITY_KEYS, 'session']);
      expect(data.session).toEqual(issued.data.session);
      expect(data.active_role).toBe('CUSTOMER');
      expect(response.text).not.toContain(issued.token);
      expect(await countRows(app.pool, 'SELECT 1 FROM app.audit_logs WHERE actor_id = $1', [user.userId])).toBe(audits);
    });

    it('reports the CURRENT state: a stale active context is null and is not rewritten by a GET', async () => {
      const user = await newCustomer();
      const issued = await loginOk(user);
      await app.pool.query("UPDATE app.sessions SET active_role = 'DRIVER' WHERE session_id = $1::uuid", [issued.sessionId]);
      const data = dataOf(await me(issued.token));
      expect(data.available_roles).toEqual(['CUSTOMER']);
      expect(data.active_role).toBeNull();
      expect(data.role_selection_required).toBe(true);
      expect((await sessionRow(issued.sessionId)).active_role).toBe('DRIVER');
    });

    it('refuses an unknown, malformed, revoked, expired or disabled session', async () => {
      const user = await newCustomer();
      const revoked = await loginOk(user);
      const expired = await loginOk(user);
      const disabled = await loginOk(user);
      expect((await logout(revoked.token)).status).toBe(204);
      await expireSession(app.pool, expired.sessionId);
      await setUserStatus(app.pool, user.userId, 'DISABLED');
      const results = [
        await app.call('GET', '/client-auth/me'),
        await app.call('GET', '/client-auth/me', { headers: { authorization: 'Bearer short' } }),
        await me('A'.repeat(43)),
        await me(revoked.token),
        await me(expired.token),
        await me(disabled.token),
      ];
      expect(results.map((r) => [r.status, errorCode(r)])).toEqual([
        [401, 'SESSION_INVALID'],
        [401, 'SESSION_INVALID'],
        [401, 'SESSION_INVALID'],
        [401, 'SESSION_REVOKED'],
        [401, 'SESSION_EXPIRED'],
        [403, 'ACCOUNT_DISABLED'],
      ]);
    });
  });

  // ------------------------------------------------------------------------------------------------- C — context

  describe('C — POST /context', () => {
    it('switches only this session, stores SHOP for SHOP_OWNER, audits once and leaves the other app alone', async () => {
      const user = await newCustomer();
      await grantRole(app.pool, user.userId, 'SHOP');
      const food = await loginOk(user, { ...WEB_FOOD });
      const ship = await loginOk(user, { ...WEB_SHIP });
      expect(ship.data.active_role).toBe('CUSTOMER');

      const switched = await switchContext(food.token, 'SHOP_OWNER');
      expect(switched.status).toBe(200);
      expect(switched.headers.get('cache-control')).toBe('no-store');
      const data = dataOf(switched);
      expect(Object.keys(data)).toEqual([...IDENTITY_KEYS, 'session']);
      expect(data.active_role).toBe('SHOP_OWNER');
      expect(data.session).toEqual(food.data.session);
      expect(switched.text).not.toContain(food.token);
      expect((data.capabilities as Record<string, boolean>).shop_manage).toBe(true);
      expect((await sessionRow(food.sessionId)).active_role).toBe('SHOP');
      expect((await sessionRow(ship.sessionId)).active_role).toBe('CUSTOMER');
      expect((await me(ship.token)).status).toBe(200);
      expect(dataOf(await me(food.token)).active_role).toBe('SHOP_OWNER');

      const audits = await auditMetadata(user.userId, 'client.auth.context.v1');
      expect(audits).toEqual([{ user_id: user.userId, session_id: food.sessionId, from_context: 'CUSTOMER', to_context: 'SHOP_OWNER' }]);

      expect(dataOf(await switchContext(food.token, 'CUSTOMER')).active_role).toBe('CUSTOMER');
      expect((await sessionRow(food.sessionId)).active_role).toBe('CUSTOMER');
    });

    it('never grants: every unavailable context is the same 403, and no role or context changes', async () => {
      const everything = await newCustomer();
      await grantRole(app.pool, everything.userId, 'DRIVER');
      await grantRole(app.pool, everything.userId, 'SHOP');
      const stray = await newCustomer();
      await grantStrayRole(app.pool, stray.userId, 'SHOP');
      const closed = await newCustomer();
      await createDriverFor(app.pool, closed.userId, { status: 'CLOSED' });
      await grantStrayRole(app.pool, closed.userId, 'DRIVER');
      const plain = await newCustomer();

      const cases: [Customer, Record<string, unknown>, string][] = [
        [everything, WEB_FOOD, 'DRIVER'], // FOOD never wears DRIVER, even for a driver
        [everything, WEB_SHIP, 'SHOP_OWNER'], // SHIP never wears SHOP_OWNER, even for a shop owner
        [stray, WEB_FOOD, 'SHOP_OWNER'], // a SHOP row without an ACTIVE owned shop
        [closed, WEB_SHIP, 'DRIVER'], // a CLOSED driver profile
        [plain, WEB_FOOD, 'SHOP_OWNER'], // not held
        [plain, WEB_SHIP, 'DRIVER'],
      ];
      let message: string | undefined;
      for (const [user, device, context] of cases) {
        const issued = await loginOk(user, device);
        const rolesBefore = await roleRows(user.userId);
        const response = await switchContext(issued.token, context);
        expect([response.status, errorCode(response)]).toEqual([403, 'ROLE_NOT_AVAILABLE']);
        message ??= response.body.error?.message;
        expect(response.body.error?.message).toBe(message);
        expect(await roleRows(user.userId)).toBe(rolesBefore);
        expect((await sessionRow(issued.sessionId)).active_role).toBe(String(issued.data.active_role));
        expect(await auditCount(user.userId, 'client.auth.context.v1')).toBe(0);
      }
    });

    it('requires Bearer first, then an Idempotency-Key and the exact body {context}', async () => {
      const user = await newCustomer();
      const issued = await loginOk(user);
      const anonymous = await app.call('POST', '/client-auth/context', { headers: { 'idempotency-key': randomUUID() }, body: { context: 'SHOP' } });
      expect([anonymous.status, errorCode(anonymous)]).toEqual([401, 'SESSION_INVALID']);
      expect(errorCode(await switchContext(issued.token, 'CUSTOMER', null))).toBe('IDEMPOTENCY_KEY_REQUIRED');
      expect(errorCode(await switchContext(issued.token, 'CUSTOMER', 'nope'))).toBe('INVALID_IDEMPOTENCY_KEY');
      for (const context of ['SHOP', 'ADMIN', 7, undefined]) {
        expect((await switchContext(issued.token, context)).status).toBe(400);
      }
      const extra = await app.call('POST', '/client-auth/context', {
        bearer: issued.token,
        headers: { 'idempotency-key': randomUUID() },
        body: { context: 'CUSTOMER', user_id: user.userId },
      });
      expect(extra.status).toBe(400);
    });

    it('a replay re-checks and returns the CURRENT identity: it never applies the switch again or moves the session back', async () => {
      const user = await newCustomer();
      await grantRole(app.pool, user.userId, 'SHOP');
      const issued = await loginOk(user);
      const k1 = randomUUID();
      expect((await switchContext(issued.token, 'SHOP_OWNER', k1)).status).toBe(200);
      expect((await switchContext(issued.token, 'CUSTOMER')).status).toBe(200);
      expect(await auditCount(user.userId, 'client.auth.context.v1')).toBe(2);

      const replay = await switchContext(issued.token, 'SHOP_OWNER', k1);
      expect(replay.status).toBe(200);
      expect(dataOf(replay).active_role).toBe('CUSTOMER');
      expect((await sessionRow(issued.sessionId)).active_role).toBe('CUSTOMER');
      expect(await auditCount(user.userId, 'client.auth.context.v1')).toBe(2);

      const reused = await switchContext(issued.token, 'CUSTOMER', k1);
      expect([reused.status, errorCode(reused)]).toEqual([409, 'IDEMPOTENCY_KEY_REUSED']);

      // The requested context is no longer selectable: the replay is refused, not served from the cache.
      await app.pool.query("DELETE FROM app.user_roles WHERE user_id = $1::uuid AND role = 'SHOP'", [user.userId]);
      const gone = await switchContext(issued.token, 'SHOP_OWNER', k1);
      expect([gone.status, errorCode(gone)]).toEqual([403, 'ROLE_NOT_AVAILABLE']);

      // A revoked session is refused before any of it.
      expect((await logout(issued.token)).status).toBe(204);
      const revoked = await switchContext(issued.token, 'SHOP_OWNER', k1);
      expect([revoked.status, errorCode(revoked)]).toEqual([401, 'SESSION_REVOKED']);
    });

    it('SHOP_OWNER keeps one SHOP session: choosing it revokes the other SHOP sessions only', async () => {
      const user = await newCustomer();
      await grantRole(app.pool, user.userId, 'SHOP');
      const first = await loginOk(user, { ...WEB_FOOD });
      const second = await loginOk(user, { ...WEB_FOOD, device_id: 'web-food-0002' });
      const ship = await loginOk(user, { ...WEB_SHIP });
      expect((await switchContext(first.token, 'SHOP_OWNER')).status).toBe(200);
      expect((await switchContext(second.token, 'SHOP_OWNER')).status).toBe(200);
      expect(await sessionRow(first.sessionId)).toMatchObject({ revoked: true });
      expect((await me(first.token)).status).toBe(401);
      expect(await sessionRow(second.sessionId)).toMatchObject({ revoked: false, active_role: 'SHOP' });
      expect(await sessionRow(ship.sessionId)).toMatchObject({ revoked: false, active_role: 'CUSTOMER' });
      expect(await countRows(app.pool, "SELECT 1 FROM app.audit_logs WHERE actor_id = $1 AND action = 'auth.session_revoke.v1'", [user.userId])).toBe(1);
    });

    it('concurrent requests with the same key apply and audit the switch once', async () => {
      const user = await newCustomer();
      await grantRole(app.pool, user.userId, 'SHOP');
      const issued = await loginOk(user);
      const key = randomUUID();
      const [a, b] = await Promise.all([switchContext(issued.token, 'SHOP_OWNER', key), switchContext(issued.token, 'SHOP_OWNER', key)]);
      expect([a.status, b.status]).toEqual([200, 200]);
      expect(dataOf(a).active_role).toBe('SHOP_OWNER');
      expect(dataOf(b).active_role).toBe('SHOP_OWNER');
      expect(await auditCount(user.userId, 'client.auth.context.v1')).toBe(1);
    });
  });

  // ------------------------------------------------------------------------------------------------- O — logout

  describe('O — POST /logout', () => {
    it('revokes this session only: 204 without a body, one audit row, the other app and other users untouched', async () => {
      const user = await newCustomer();
      const other = await newCustomer();
      const food = await loginOk(user, { ...WEB_FOOD });
      const ship = await loginOk(user, { ...WEB_SHIP });
      const stranger = await loginOk(other);

      const response = await logout(food.token);
      expect(response.status).toBe(204);
      expect(response.text).toBe('');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect((await sessionRow(food.sessionId)).revoked).toBe(true);
      expect(errorCode(await me(food.token))).toBe('SESSION_REVOKED');
      expect((await me(ship.token)).status).toBe(200);
      expect((await me(stranger.token)).status).toBe(200);
      expect(await auditMetadata(user.userId, 'client.auth.logout.v1')).toEqual([
        { user_id: user.userId, session_id: food.sessionId, client_app: 'FOOD' },
      ]);
    });

    it('is idempotent: a retry, an expired session and a disabled account still answer 204, with no second audit row', async () => {
      const user = await newCustomer();
      const first = await loginOk(user);
      const expired = await loginOk(user);
      const disabled = await loginOk(user);
      expect((await logout(first.token)).status).toBe(204);
      expect((await logout(first.token)).status).toBe(204);
      await expireSession(app.pool, expired.sessionId);
      expect((await logout(expired.token)).status).toBe(204);
      await setUserStatus(app.pool, user.userId, 'DISABLED');
      expect((await logout(disabled.token)).status).toBe(204);
      expect((await sessionRow(disabled.sessionId)).revoked).toBe(true);
      expect(await auditCount(user.userId, 'client.auth.logout.v1')).toBe(2); // first and disabled; not the retry, not the expired one
    });

    it('answers 401 SESSION_INVALID for an unknown or malformed token and 400 for any body but {}', async () => {
      const user = await newCustomer();
      const issued = await loginOk(user);
      for (const response of [
        await app.call('POST', '/client-auth/logout', { body: {} }),
        await app.call('POST', '/client-auth/logout', { headers: { authorization: 'Bearer short' }, body: {} }),
        await logout('A'.repeat(43)),
      ]) {
        expect([response.status, errorCode(response)]).toEqual([401, 'SESSION_INVALID']);
      }
      for (const body of [{ user_id: user.userId }, { session_id: issued.sessionId }, []]) {
        expect((await logout(issued.token, body)).status).toBe(400);
      }
      expect((await sessionRow(issued.sessionId)).revoked).toBe(false);
    });
  });
});
