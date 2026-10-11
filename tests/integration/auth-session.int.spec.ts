import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { eventually } from './support/async-helpers';
import {
  advisoryWaiterExists,
  ApiResponse,
  AuthApp,
  countRows,
  dataOf,
  DEVICE,
  errorCode,
  expireSession,
  grantRole,
  installRoleSelectShopStall,
  loginUser,
  OTHER_PASSWORD,
  randomPhone,
  registerUser,
  Registered,
  removeRoleSelectShopStall,
  rowLockWaiters,
  sessionIdOfToken,
  setUserStatus,
  startAuthApp,
} from './support/auth-fixtures';
import { LockHolder } from './support/idempotency-fixtures';

// M01-A1 — login, bearer sessions, /me and role selection (including the SHOP single-active-session
// invariant), through the REAL Nest pipeline on a REAL PostgreSQL.
describe('M01-A1 — login, sessions, /me and role selection', () => {
  let app: AuthApp;

  beforeAll(async () => {
    app = await startAuthApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function me(token: string | undefined, headers: Record<string, string> = {}): Promise<ApiResponse> {
    return app.call('GET', '/auth/me', { ...(token === undefined ? {} : { bearer: token }), headers });
  }

  async function selectRole(token: string, role: unknown, target: AuthApp = app): Promise<ApiResponse> {
    return target.call('POST', '/auth/role/select', { bearer: token, body: { role } });
  }

  /** A second device: a new login of the same user. */
  async function loginOn(user: Registered, deviceId: string, target: AuthApp = app): Promise<string> {
    const response = await loginUser(target, user, { ...DEVICE, device_id: deviceId });
    if (response.status !== 200) {
      throw new Error(`login failed: ${response.status} ${response.text}`);
    }
    return String(dataOf(response).access_token);
  }

  async function unrevokedShopSessions(userId: string): Promise<number> {
    return countRows(
      app.pool,
      "SELECT 1 FROM app.sessions WHERE user_id = $1::uuid AND active_role = 'SHOP' AND revoked_at IS NULL",
      [userId],
    );
  }

  describe('login', () => {
    it('creates a NEW roleless session and returns the token once', async () => {
      const user = await registerUser(app);
      const response = await loginUser(app, user);

      expect(response.status).toBe(200);
      const data = dataOf(response);
      expect(Object.keys(data).sort()).toEqual([
        'access_token',
        'active_role',
        'available_roles',
        'onboarding_required',
        'phone_verification_status', // issue #49: display value only (VERIFIED for a registered account)
        'role_selection_required',
        'user_id',
      ]);
      expect(data.phone_verification_status).toBe('VERIFIED');
      expect(data.user_id).toBe(user.userId);
      expect(data.available_roles).toEqual([]);
      expect(data.active_role).toBeNull();
      expect(data.onboarding_required).toBe(true);
      expect(data.role_selection_required).toBe(false);
      expect(data.access_token).not.toBe(user.accessToken);

      const sessions = await app.pool.query<{ active_role: string | null }>(
        'SELECT active_role FROM app.sessions WHERE user_id = $1::uuid ORDER BY created_at',
        [user.userId],
      );
      expect(sessions.rows).toEqual([{ active_role: null }, { active_role: null }]);

      const audit = await app.pool.query<{ outcome: string; actor_id: string }>(
        `SELECT outcome, actor_id FROM app.audit_logs WHERE request_id = $1::uuid AND action = 'auth.login.v1'`,
        [response.requestId],
      );
      expect(audit.rows).toEqual([{ outcome: 'SUCCESS', actor_id: user.userId }]);
    });

    it('accepts every phone form of the same number', async () => {
      const user = await registerUser(app);
      for (const phone of [user.phone.local, user.phone.international, `+${user.phone.international}`, ` ${user.phone.local} `]) {
        const response = await app.call('POST', '/auth/login', {
          body: { phone, password: user.password, device: { ...DEVICE } },
        });
        expect([phone, response.status]).toEqual([phone, 200]);
      }
    });

    it('answers a wrong password and an unknown phone with the SAME error', async () => {
      const user = await registerUser(app);
      const wrong = await loginUser(app, { phone: user.phone, password: OTHER_PASSWORD });
      const unknown = await loginUser(app, { phone: randomPhone(), password: user.password });
      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(errorCode(wrong)).toBe('INVALID_CREDENTIALS');
      expect(wrong.body.error?.code).toBe(unknown.body.error?.code);
      expect(wrong.body.error?.message).toBe(unknown.body.error?.message);
      expect(Object.keys(wrong.body.error ?? {}).sort()).toEqual(Object.keys(unknown.body.error ?? {}).sort());
      expect(await countRows(app.pool, 'SELECT 1 FROM app.sessions WHERE user_id = $1::uuid', [user.userId])).toBe(1);
    });

    it('a correct password on a DISABLED account is ACCOUNT_DISABLED (no session, DENIED audit); a wrong one is not', async () => {
      const user = await registerUser(app);
      await setUserStatus(app.pool, user.userId, 'DISABLED');

      const disabled = await loginUser(app, user);
      expect([disabled.status, errorCode(disabled)]).toEqual([403, 'ACCOUNT_DISABLED']);
      expect(await countRows(app.pool, 'SELECT 1 FROM app.sessions WHERE user_id = $1::uuid', [user.userId])).toBe(1);
      const audit = await app.pool.query<{ outcome: string; reason_code: string }>(
        `SELECT outcome, reason_code FROM app.audit_logs WHERE request_id = $1::uuid AND action = 'auth.login.v1'`,
        [disabled.requestId],
      );
      expect(audit.rows).toEqual([{ outcome: 'DENIED', reason_code: 'ACCOUNT_DISABLED' }]);

      const wrong = await loginUser(app, { phone: user.phone, password: OTHER_PASSWORD });
      expect([wrong.status, errorCode(wrong)]).toEqual([401, 'INVALID_CREDENTIALS']);
    });

    it('returns sorted available roles, never selects one, and asks for role selection', async () => {
      const user = await registerUser(app);
      await grantRole(app.pool, user.userId, 'SHOP');
      await grantRole(app.pool, user.userId, 'DRIVER');
      const response = await loginUser(app, user);
      const data = dataOf(response);
      expect(data.available_roles).toEqual(['DRIVER', 'SHOP']);
      expect(data.active_role).toBeNull();
      expect(data.role_selection_required).toBe(true);
      expect(data.onboarding_required).toBe(false);
    });

    it('a single role is still not auto-selected', async () => {
      const user = await registerUser(app);
      await grantRole(app.pool, user.userId, 'DRIVER');
      const data = dataOf(await loginUser(app, user));
      expect(data.active_role).toBeNull();
      expect(data.role_selection_required).toBe(true);
    });

    it('refuses forbidden fields, a bad device and a bad phone', async () => {
      const user = await registerUser(app);
      const base = { phone: user.phone.local, password: user.password, device: { ...DEVICE } };
      for (const body of [
        { ...base, role: 'ADMIN' },
        { ...base, is_admin: true },
        { phone: base.phone, password: base.password },
        { ...base, device: { ...DEVICE, platform: 'android' } },
        { ...base, password: 123 },
      ]) {
        const response = await app.call('POST', '/auth/login', { body });
        expect([response.status, errorCode(response)]).toEqual([400, 'BAD_REQUEST']);
      }
      const badPhone = await app.call('POST', '/auth/login', { body: { ...base, phone: '12345' } });
      expect([badPhone.status, errorCode(badPhone)]).toEqual([400, 'INVALID_PHONE']);
    });
  });

  describe('bearer authentication (every protected request)', () => {
    it('refuses a missing, malformed or unknown credential with SESSION_INVALID', async () => {
      const user = await registerUser(app);
      const unknownToken = randomBytes(32).toString('base64url');
      const cases: Array<[string, ApiResponse]> = [
        ['no header', await me(undefined)],
        ['empty scheme', await me(undefined, { authorization: 'Bearer' })],
        ['basic scheme', await me(undefined, { authorization: `Basic ${user.accessToken}` })],
        ['short token', await me(undefined, { authorization: 'Bearer abc' })],
        ['unknown token', await me(unknownToken)],
        ['non-canonical padding', await me(undefined, { authorization: `Bearer ${user.accessToken}=` })],
        ['two tokens', await me(undefined, { authorization: `Bearer ${user.accessToken}, Bearer ${user.accessToken}` })],
        ['extra space', await me(undefined, { authorization: `Bearer  ${user.accessToken}` })],
      ];
      for (const [label, response] of cases) {
        expect([label, response.status, errorCode(response)]).toEqual([label, 401, 'SESSION_INVALID']);
        expect(response.body.error?.request_id).toBe(response.requestId);
      }
    });

    it('never reads the token from the query string or the body', async () => {
      const user = await registerUser(app);
      const query = await app.call('GET', `/auth/me?access_token=${user.accessToken}`);
      expect([query.status, errorCode(query)]).toEqual([401, 'SESSION_INVALID']);
      const body = await app.call('POST', '/auth/role/select', { body: { role: 'SHOP', access_token: user.accessToken } });
      expect(body.status).toBe(401);
    });

    it('accepts a valid token and returns the documented /me contract', async () => {
      const user = await registerUser(app);
      const response = await me(user.accessToken);
      expect(response.status).toBe(200);
      expect(dataOf(response)).toEqual({
        user_id: user.userId,
        phone_normalized: user.phone.normalized,
        phone_verification_status: 'VERIFIED', // issue #49: display value only, never an authorization source
        available_roles: [],
        active_role: null,
        onboarding_required: true,
        role_selection_required: false,
        onboarding: { shop: 'NOT_STARTED', driver: 'NOT_STARTED' },
      });
    });

    it('/me shows only supported roles and asks for selection while no role is active', async () => {
      const user = await registerUser(app);
      await grantRole(app.pool, user.userId, 'SHOP');
      await grantRole(app.pool, user.userId, 'ADMIN'); // never exposed and never selectable through Auth
      const data = dataOf(await me(user.accessToken));
      expect(data.available_roles).toEqual(['SHOP']);
      expect(data.role_selection_required).toBe(true);
      expect(data.onboarding_required).toBe(false);
    });

    it('a revoked session is SESSION_REVOKED, an expired one SESSION_EXPIRED, a disabled user ACCOUNT_DISABLED', async () => {
      const revoked = await registerUser(app);
      await app.pool.query('UPDATE app.sessions SET revoked_at = clock_timestamp() WHERE user_id = $1::uuid', [revoked.userId]);
      const revokedResponse = await me(revoked.accessToken);
      expect([revokedResponse.status, errorCode(revokedResponse)]).toEqual([401, 'SESSION_REVOKED']);

      const expired = await registerUser(app);
      await expireSession(app.pool, await sessionIdOfToken(app.pool, expired.accessToken));
      const expiredResponse = await me(expired.accessToken);
      expect([expiredResponse.status, errorCode(expiredResponse)]).toEqual([401, 'SESSION_EXPIRED']);

      const disabled = await registerUser(app);
      await setUserStatus(app.pool, disabled.userId, 'DISABLED');
      const disabledResponse = await me(disabled.accessToken);
      expect([disabledResponse.status, errorCode(disabledResponse)]).toEqual([403, 'ACCOUNT_DISABLED']);
      // The same checks guard role selection.
      const select = await selectRole(disabled.accessToken, 'SHOP');
      expect([select.status, errorCode(select)]).toEqual([403, 'ACCOUNT_DISABLED']);
    });

    it('re-enabling the user makes the same token work again (status is read on every request)', async () => {
      const user = await registerUser(app);
      await setUserStatus(app.pool, user.userId, 'DISABLED');
      expect((await me(user.accessToken)).status).toBe(403);
      await setUserStatus(app.pool, user.userId, 'ACTIVE');
      expect((await me(user.accessToken)).status).toBe(200);
    });

    it('the lifetime is absolute: using the session never extends expires_at, and AUTH_SESSION_TTL_SECONDS is honoured', async () => {
      const short = await startAuthApp({ sessionTtlSeconds: 300 });
      try {
        const user = await registerUser(short);
        const read = async (): Promise<string> =>
          (await short.pool.query<{ e: string }>('SELECT expires_at::text AS e FROM app.sessions WHERE user_id = $1::uuid', [user.userId]))
            .rows[0]?.e as string;
        const before = await read();
        await short.call('GET', '/auth/me', { bearer: user.accessToken });
        await short.call('GET', '/auth/me', { bearer: user.accessToken });
        expect(await read()).toBe(before);
        const ttl = await short.pool.query<{ s: number }>(
          'SELECT extract(epoch FROM (expires_at - created_at))::int AS s FROM app.sessions WHERE user_id = $1::uuid',
          [user.userId],
        );
        expect(ttl.rows[0]?.s).toBe(300);
      } finally {
        await short.close();
      }
    });
  });

  describe('role selection', () => {
    it('refuses unsupported or unknown roles with ROLE_NOT_AVAILABLE, even if a row exists', async () => {
      const user = await registerUser(app);
      await grantRole(app.pool, user.userId, 'ADMIN');
      for (const role of ['ADMIN', 'SYSTEM', 'PLATFORM', 'EXTERNAL', 'shop', 'Driver', 'NOPE', 'SHOP ']) {
        const response = await selectRole(user.accessToken, role);
        expect([role, response.status, errorCode(response)]).toEqual([role, 403, 'ROLE_NOT_AVAILABLE']);
      }
      expect(dataOf(await me(user.accessToken)).active_role).toBeNull();
    });

    it('refuses a supported role the user does not hold', async () => {
      const user = await registerUser(app);
      const response = await selectRole(user.accessToken, 'SHOP');
      expect([response.status, errorCode(response)]).toEqual([403, 'ROLE_NOT_AVAILABLE']);
    });

    it('validates the body strictly', async () => {
      const user = await registerUser(app);
      for (const body of [{}, { role: 1 }, { role: '' }, { role: 'SHOP', extra: true }, { roles: ['SHOP'] }]) {
        const response = await app.call('POST', '/auth/role/select', { bearer: user.accessToken, body });
        expect([response.status, errorCode(response)]).toEqual([400, 'BAD_REQUEST']);
      }
      const unauthenticated = await app.call('POST', '/auth/role/select', { body: { role: 'SHOP' } });
      expect([unauthenticated.status, errorCode(unauthenticated)]).toEqual([401, 'SESSION_INVALID']);
    });

    it('DRIVER: sets the role on THIS session only and leaves other DRIVER sessions valid', async () => {
      const user = await registerUser(app);
      await grantRole(app.pool, user.userId, 'DRIVER');
      const second = await loginOn(user, 'device-driver-b');

      expect((await selectRole(user.accessToken, 'DRIVER')).status).toBe(200);
      expect((await selectRole(second, 'DRIVER')).status).toBe(200);

      expect(dataOf(await me(user.accessToken)).active_role).toBe('DRIVER');
      expect(dataOf(await me(second)).active_role).toBe('DRIVER');
      expect(await countRows(app.pool, "SELECT 1 FROM app.sessions WHERE user_id = $1::uuid AND revoked_at IS NOT NULL", [user.userId])).toBe(0);
    });

    it('SHOP: activates on this session and revokes the other SHOP session, never a DRIVER one', async () => {
      const user = await registerUser(app);
      await grantRole(app.pool, user.userId, 'SHOP');
      await grantRole(app.pool, user.userId, 'DRIVER');
      const deviceA = user.accessToken;
      const deviceB = await loginOn(user, 'device-shop-b');
      const driverDevice = await loginOn(user, 'device-driver-c');

      expect((await selectRole(driverDevice, 'DRIVER')).status).toBe(200);
      const first = await selectRole(deviceA, 'SHOP');
      expect(first.status).toBe(200);
      expect(dataOf(first).active_role).toBe('SHOP');
      expect(await unrevokedShopSessions(user.userId)).toBe(1);

      // The user moves SHOP to device B: A is revoked from its next request on.
      const second = await selectRole(deviceB, 'SHOP');
      expect(second.status).toBe(200);
      expect(await unrevokedShopSessions(user.userId)).toBe(1);

      const oldShop = await me(deviceA);
      expect([oldShop.status, errorCode(oldShop)]).toEqual([401, 'SESSION_REVOKED']);
      const newShop = await me(deviceB);
      expect(newShop.status).toBe(200);
      expect(dataOf(newShop).active_role).toBe('SHOP');
      // DRIVER on another device is untouched by the SHOP move.
      const driver = await me(driverDevice);
      expect(driver.status).toBe(200);
      expect(dataOf(driver).active_role).toBe('DRIVER');

      // A revoked session can neither act nor select again.
      const again = await selectRole(deviceA, 'SHOP');
      expect([again.status, errorCode(again)]).toEqual([401, 'SESSION_REVOKED']);

      // Audit: the role selection and the replacement/revocation are recorded in the same transaction.
      const audit = await app.pool.query<{ action: string; resource_type: string; outcome: string }>(
        `SELECT action, resource_type, outcome FROM app.audit_logs WHERE request_id = $1::uuid ORDER BY action`,
        [second.requestId],
      );
      expect(audit.rows).toEqual([
        { action: 'auth.role_select.v1', resource_type: 'session', outcome: 'SUCCESS' },
        { action: 'auth.session_revoke.v1', resource_type: 'session', outcome: 'SUCCESS' },
      ]);
    });

    it('selecting SHOP twice on the same session is harmless (it never revokes itself)', async () => {
      const user = await registerUser(app);
      await grantRole(app.pool, user.userId, 'SHOP');
      expect((await selectRole(user.accessToken, 'SHOP')).status).toBe(200);
      expect((await selectRole(user.accessToken, 'SHOP')).status).toBe(200);
      expect(await unrevokedShopSessions(user.userId)).toBe(1);
      expect((await me(user.accessToken)).status).toBe(200);
    });

    it('switching the same session from SHOP to DRIVER frees the SHOP slot for another session', async () => {
      const user = await registerUser(app);
      await grantRole(app.pool, user.userId, 'SHOP');
      await grantRole(app.pool, user.userId, 'DRIVER');
      const other = await loginOn(user, 'device-switch-b');
      expect((await selectRole(user.accessToken, 'SHOP')).status).toBe(200);
      expect((await selectRole(user.accessToken, 'DRIVER')).status).toBe(200);
      expect(await unrevokedShopSessions(user.userId)).toBe(0);
      expect((await selectRole(other, 'SHOP')).status).toBe(200);
      expect(await unrevokedShopSessions(user.userId)).toBe(1);
      expect((await me(user.accessToken)).status).toBe(200); // the DRIVER session was not revoked
    });

    describe('concurrent SHOP selection', () => {
      let slow: AuthApp;

      beforeAll(async () => {
        slow = await startAuthApp({}, { relaxTimeouts: true });
      });

      afterAll(async () => {
        await removeRoleSelectShopStall(slow.pool);
        await slow.close();
      });

      it('two sessions select SHOP at once: both calls are serialized, exactly one unrevoked SHOP session remains, DRIVER survives', async () => {
        const STALL_KEY = [910_101, 910_102] as const;
        const user = await registerUser(slow);
        await grantRole(slow.pool, user.userId, 'SHOP');
        await grantRole(slow.pool, user.userId, 'DRIVER');
        const sessionA = user.accessToken;
        const sessionB = await loginOn(user, 'device-race-b', slow);
        const sessionD = await loginOn(user, 'device-race-d', slow);
        expect((await selectRole(sessionD, 'DRIVER', slow)).status).toBe(200);

        // Deterministic barrier, no sleeps. A test-only trigger makes the statement that moves a session into
        // SHOP wait for a fixed advisory lock that the test holds. A selection reaches that statement only after
        // it has locked the user row and its own session row, so "A is an advisory waiter" PROVES that A is
        // inside its transaction holding the user lock. B must then block behind A's row lock: real overlap.
        await removeRoleSelectShopStall(slow.pool);
        await installRoleSelectShopStall(slow.pool, STALL_KEY);
        const holder = await LockHolder.begin(slow.pool);
        await holder.query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [STALL_KEY[0], STALL_KEY[1]]);
        let released = false;
        const release = async (): Promise<void> => {
          if (!released) {
            released = true;
            await holder.commit();
          }
        };

        let resultA: ApiResponse;
        let resultB: ApiResponse;
        try {
          const pendingA = selectRole(sessionA, 'SHOP', slow);
          await eventually(() => advisoryWaiterExists(slow.pool, STALL_KEY), 'selection A is stalled inside its transaction');

          const blockedBefore = await rowLockWaiters(slow.pool);
          const pendingB = selectRole(sessionB, 'SHOP', slow);
          await eventually(async () => (await rowLockWaiters(slow.pool)) > blockedBefore, 'selection B is blocked on the row lock A holds');
          // A is still stalled while B is blocked: the two transactions genuinely overlap.
          expect(await advisoryWaiterExists(slow.pool, STALL_KEY)).toBe(true);

          await release();
          [resultA, resultB] = await Promise.all([pendingA, pendingB]);
        } finally {
          await release();
          await removeRoleSelectShopStall(slow.pool);
        }

        // Sequential success: A went first (it held the lock), B followed and replaced it.
        expect([resultA.status, resultB.status]).toEqual([200, 200]);
        expect(await unrevokedShopSessions(user.userId)).toBe(1);

        const sessionRows = await slow.pool.query<{ session_id: string; active_role: string | null; revoked: boolean }>(
          'SELECT session_id, active_role, revoked_at IS NOT NULL AS revoked FROM app.sessions WHERE user_id = $1::uuid',
          [user.userId],
        );
        const byId = new Map(sessionRows.rows.map((row) => [row.session_id, row]));
        const rowA = byId.get(await sessionIdOfToken(slow.pool, sessionA));
        const rowB = byId.get(await sessionIdOfToken(slow.pool, sessionB));
        const rowD = byId.get(await sessionIdOfToken(slow.pool, sessionD));
        expect([rowA?.active_role, rowA?.revoked]).toEqual(['SHOP', true]); // the earlier SHOP session is revoked
        expect([rowB?.active_role, rowB?.revoked]).toEqual(['SHOP', false]); // the later one is the single live SHOP session
        expect([rowD?.active_role, rowD?.revoked]).toEqual(['DRIVER', false]);

        const afterA = await slow.call('GET', '/auth/me', { bearer: sessionA });
        expect([afterA.status, errorCode(afterA)]).toEqual([401, 'SESSION_REVOKED']);
        const afterB = await slow.call('GET', '/auth/me', { bearer: sessionB });
        expect(afterB.status).toBe(200);
        expect(dataOf(afterB).active_role).toBe('SHOP');
        const driver = await slow.call('GET', '/auth/me', { bearer: sessionD });
        expect(driver.status).toBe(200);
        expect(dataOf(driver).active_role).toBe('DRIVER');
      });
    });
  });

  describe('privacy of sessions', () => {
    it('stores only the SHA-256 digest of an access token and never logs a token or an Authorization header', async () => {
      const user = await registerUser(app);
      const login = await loginUser(app, user);
      const token = String(dataOf(login).access_token);
      await me(token);
      const dump = await app.pool.query<{ dump: string }>(
        'SELECT s::text AS dump FROM app.sessions s WHERE user_id = $1::uuid',
        [user.userId],
      );
      const text = dump.rows.map((row) => row.dump).join('\n');
      expect(text).not.toContain(token);
      expect(text).not.toContain(user.accessToken);
      expect(app.running.logs.join('\n')).not.toContain(token);
      expect(app.running.logs.join('\n')).not.toMatch(/bearer/i);
    });
  });
});
