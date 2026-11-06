import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { eventually } from './support/async-helpers';
import {
  advisoryWaiterExists,
  ApiResponse,
  AuthApp,
  countRows,
  dataOf,
  DEVICE,
  SHIP_DEVICE,
  selectContext,
  errorCode,
  expireSession,
  grantRole,
  installRoleSelectShopStall,
  loginUser,
  registerUser,
  Registered,
  removeRoleSelectShopStall,
  rowLockWaiters,
  sessionIdOfToken,
  setUserStatus,
  startAuthApp,
} from './support/auth-fixtures';
import { LockHolder } from './support/idempotency-fixtures';

// M01-A1 (moved to /v1/client-auth by OD-1) — bearer sessions, /me and context selection (including the SHOP single-active-session
// invariant), through the REAL Nest pipeline on a REAL PostgreSQL. SHOP_OWNER needs a FOOD session, DRIVER a SHIP session.
describe('M01-A1 — bearer sessions, /me and context selection', () => {
  let app: AuthApp;

  beforeAll(async () => {
    app = await startAuthApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function me(token: string | undefined, headers: Record<string, string> = {}): Promise<ApiResponse> {
    return app.call('GET', '/client-auth/me', { ...(token === undefined ? {} : { bearer: token }), headers });
  }

  async function selectRole(token: string, role: unknown, target: AuthApp = app): Promise<ApiResponse> {
    return selectContext(target, token, role === 'SHOP' ? 'SHOP_OWNER' : String(role));
  }

  /** A second device: a new login of the same user. */
  async function loginOn(user: Registered, deviceId: string, target: AuthApp = app, ship = false): Promise<string> {
    const response = await loginUser(target, user, { ...(ship ? SHIP_DEVICE : DEVICE), device_id: deviceId });
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
      const query = await app.call('GET', `/client-auth/me?access_token=${user.accessToken}`);
      expect([query.status, errorCode(query)]).toEqual([401, 'SESSION_INVALID']);
      const body = await app.call('POST', '/client-auth/context', { headers: { 'idempotency-key': randomUUID() }, body: { context: 'SHOP_OWNER', access_token: user.accessToken } });
      expect(body.status).toBe(401);
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
        await short.call('GET', '/client-auth/me', { bearer: user.accessToken });
        await short.call('GET', '/client-auth/me', { bearer: user.accessToken });
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
    it('DRIVER: sets the role on THIS session only and leaves other DRIVER sessions valid', async () => {
      const user = await registerUser(app);
      await grantRole(app.pool, user.userId, 'DRIVER');
      const first = await loginOn(user, 'device-driver-a', app, true);
      const second = await loginOn(user, 'device-driver-b', app, true);

      expect((await selectRole(first, 'DRIVER')).status).toBe(200);
      expect((await selectRole(second, 'DRIVER')).status).toBe(200);

      expect(dataOf(await me(first)).active_role).toBe('DRIVER');
      expect(dataOf(await me(second)).active_role).toBe('DRIVER');
      expect(await countRows(app.pool, "SELECT 1 FROM app.sessions WHERE user_id = $1::uuid AND revoked_at IS NOT NULL", [user.userId])).toBe(0);
    });

    it('SHOP: activates on this session and revokes the other SHOP session, never a DRIVER one', async () => {
      const user = await registerUser(app);
      await grantRole(app.pool, user.userId, 'SHOP');
      await grantRole(app.pool, user.userId, 'DRIVER');
      const deviceA = user.accessToken;
      const deviceB = await loginOn(user, 'device-shop-b');
      const driverDevice = await loginOn(user, 'device-driver-c', app, true);

      expect((await selectRole(driverDevice, 'DRIVER')).status).toBe(200);
      const first = await selectRole(deviceA, 'SHOP');
      expect(first.status).toBe(200);
      expect(dataOf(first).active_role).toBe('SHOP_OWNER');
      expect(await unrevokedShopSessions(user.userId)).toBe(1);

      // The user moves SHOP to device B: A is revoked from its next request on.
      const second = await selectRole(deviceB, 'SHOP');
      expect(second.status).toBe(200);
      expect(await unrevokedShopSessions(user.userId)).toBe(1);

      const oldShop = await me(deviceA);
      expect([oldShop.status, errorCode(oldShop)]).toEqual([401, 'SESSION_REVOKED']);
      const newShop = await me(deviceB);
      expect(newShop.status).toBe(200);
      expect(dataOf(newShop).active_role).toBe('SHOP_OWNER');
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
        { action: 'auth.session_revoke.v1', resource_type: 'session', outcome: 'SUCCESS' },
        { action: 'client.auth.context.v1', resource_type: 'session', outcome: 'SUCCESS' },
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

    it('switching the same session from SHOP_OWNER to CUSTOMER frees the SHOP slot for another session', async () => {
      const user = await registerUser(app);
      await grantRole(app.pool, user.userId, 'SHOP');
      await grantRole(app.pool, user.userId, 'DRIVER');
      const other = await loginOn(user, 'device-switch-b');
      expect((await selectRole(user.accessToken, 'SHOP')).status).toBe(200);
      expect((await selectRole(user.accessToken, 'CUSTOMER')).status).toBe(200);
      expect(await unrevokedShopSessions(user.userId)).toBe(0);
      expect((await selectRole(other, 'SHOP')).status).toBe(200);
      expect(await unrevokedShopSessions(user.userId)).toBe(1);
      expect((await me(user.accessToken)).status).toBe(200); // the CUSTOMER session was not revoked
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
        const sessionD = await loginOn(user, 'device-race-d', slow, true);
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

        const afterA = await slow.call('GET', '/client-auth/me', { bearer: sessionA });
        expect([afterA.status, errorCode(afterA)]).toEqual([401, 'SESSION_REVOKED']);
        const afterB = await slow.call('GET', '/client-auth/me', { bearer: sessionB });
        expect(afterB.status).toBe(200);
        expect(dataOf(afterB).active_role).toBe('SHOP_OWNER');
        const driver = await slow.call('GET', '/client-auth/me', { bearer: sessionD });
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
