import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { eventually } from './support/async-helpers';
import {
  ApiResponse,
  AuthApp,
  dataOf,
  errorCode,
  grantRole,
  registerUser,
  Registered,
  rowLockWaitersRunning,
  sessionIdOfToken,
  startAuthApp,
} from './support/auth-fixtures';
import { LockHolder } from './support/idempotency-fixtures';

// Post-merge repair, section 3 — /auth/me reads the CURRENT session under shared locks, and the router
// projection reports the EFFECTIVE active role.
//
// Barriers: SessionAuthGuard uses a plain SELECT, which never waits for a row lock, so a held uncommitted change
// on app.users / app.sessions lets the guard pass and stalls only the business transaction of /me. The wait is
// observed on that transaction's own FOR SHARE statement (pg_locks + pg_stat_activity), never by sleeping.

const USER_SHARE = '%FROM app.users WHERE user_id = $1::uuid FOR SHARE%';
const SESSION_SHARE = '%FROM app.sessions WHERE session_id = $1::uuid FOR SHARE%';

describe('M00/M01 repair §3 — /auth/me under shared locks and the effective active role', () => {
  let app: AuthApp;

  beforeAll(async () => {
    app = await startAuthApp({}, { relaxTimeouts: true });
  });

  afterAll(async () => {
    await app.close();
  });

  const me = (token: string): Promise<ApiResponse> => app.call('GET', '/auth/me', { bearer: token });
  const select = (token: string, role: string): Promise<ApiResponse> =>
    app.call('POST', '/auth/role/select', { bearer: token, body: { role } });
  const waiterOn = (pattern: string) => async (): Promise<boolean> =>
    (await rowLockWaitersRunning(app.pool, pattern)) >= 1;

  /** A test-only lifecycle transition: like production writers it takes the user root lock first. */
  async function lifecycle(userId: string, sql: string): Promise<void> {
    const holder = await LockHolder.begin(app.pool);
    try {
      await holder.query('SELECT 1 FROM app.users WHERE user_id = $1::uuid FOR UPDATE', [userId]);
      await holder.query(sql, [userId]);
      await holder.commit();
    } catch (error) {
      await holder.rollback();
      throw error;
    }
  }
  const closeDriver = (userId: string): Promise<void> =>
    lifecycle(userId, "UPDATE app.drivers SET status = 'CLOSED', updated_at = clock_timestamp() WHERE user_id = $1::uuid");
  const disableShop = (userId: string): Promise<void> =>
    lifecycle(
      userId,
      `UPDATE app.shops SET status = 'DISABLED', accepting_orders = false, version = version + 1, updated_at = clock_timestamp()
        WHERE shop_id IN (SELECT shop_id FROM app.shop_members WHERE user_id = $1::uuid)`,
    );

  const projection = (response: ApiResponse): Record<string, unknown> => {
    const data = dataOf(response);
    return {
      active_role: data.active_role,
      available_roles: data.available_roles,
      role_selection_required: data.role_selection_required,
      onboarding_required: data.onboarding_required,
    };
  };

  async function waitingMe(user: Registered, hold: (holder: LockHolder, ids: { sessionId: string }) => Promise<void>, pattern: string) {
    const sessionId = await sessionIdOfToken(app.pool, user.accessToken);
    const holder = await LockHolder.begin(app.pool);
    let released = false;
    try {
      await hold(holder, { sessionId });
      const pending = me(user.accessToken);
      await eventually(waiterOn(pattern), '/me business transaction waits for the shared lock');
      await holder.commit();
      released = true;
      return await pending;
    } finally {
      if (!released) {
        await holder.rollback();
      }
    }
  }

  describe('/me waits for writers and reads fresh state', () => {
    it('waits behind a role selection committing on its session and reports the NEW active role, not the guard snapshot', async () => {
      const user = await registerUser(app);
      await grantRole(app.pool, user.userId, 'DRIVER');
      const response = await waitingMe(
        user,
        (holder, { sessionId }) =>
          holder.query(
            "UPDATE app.sessions SET active_role = 'DRIVER', updated_at = clock_timestamp() WHERE session_id = $1::uuid",
            [sessionId],
          ),
        SESSION_SHARE,
      );
      expect(response.status).toBe(200);
      expect(projection(response)).toEqual({
        active_role: 'DRIVER',
        available_roles: ['DRIVER'],
        role_selection_required: false,
        onboarding_required: false,
      });
    });

    it('waits behind a revocation of its session and then answers SESSION_REVOKED', async () => {
      const user = await registerUser(app);
      const response = await waitingMe(
        user,
        (holder, { sessionId }) =>
          holder.query('UPDATE app.sessions SET revoked_at = clock_timestamp(), updated_at = clock_timestamp() WHERE session_id = $1::uuid', [
            sessionId,
          ]),
        SESSION_SHARE,
      );
      expect([response.status, errorCode(response)]).toEqual([401, 'SESSION_REVOKED']);
    });

    it('waits behind the user row being disabled and then answers ACCOUNT_DISABLED', async () => {
      const user = await registerUser(app);
      const response = await waitingMe(
        user,
        (holder) =>
          holder.query("UPDATE app.users SET status = 'DISABLED', updated_at = clock_timestamp() WHERE user_id = $1::uuid", [user.userId]),
        USER_SHARE,
      );
      expect([response.status, errorCode(response)]).toEqual([403, 'ACCOUNT_DISABLED']);
    });
  });

  it('simultaneous /me readers are compatible: a reader holding both FOR SHARE locks does not stall /me', async () => {
    const user = await registerUser(app);
    const sessionId = await sessionIdOfToken(app.pool, user.accessToken);
    const reader = await LockHolder.begin(app.pool);
    try {
      await reader.query('SELECT 1 FROM app.users WHERE user_id = $1::uuid FOR SHARE', [user.userId]);
      await reader.query('SELECT 1 FROM app.sessions WHERE session_id = $1::uuid FOR SHARE', [sessionId]);
      const response = await me(user.accessToken);
      expect(response.status).toBe(200);
      expect(await rowLockWaitersRunning(app.pool, '%FOR SHARE%')).toBe(0);
    } finally {
      await reader.rollback();
    }
  });

  describe('effective active role over HTTP', () => {
    it('DRIVER selected, then CLOSED, usable SHOP remains: no active role, selection required', async () => {
      const user = await registerUser(app);
      await grantRole(app.pool, user.userId, 'SHOP');
      await grantRole(app.pool, user.userId, 'DRIVER');
      expect((await select(user.accessToken, 'DRIVER')).status).toBe(200);
      await closeDriver(user.userId);
      expect(projection(await me(user.accessToken))).toEqual({
        active_role: null,
        available_roles: ['SHOP'],
        role_selection_required: true,
        onboarding_required: false,
      });
    });

    it('SHOP selected, then DISABLED, usable DRIVER remains: no active role, selection required', async () => {
      const user = await registerUser(app);
      await grantRole(app.pool, user.userId, 'SHOP');
      await grantRole(app.pool, user.userId, 'DRIVER');
      expect((await select(user.accessToken, 'SHOP')).status).toBe(200);
      await disableShop(user.userId);
      expect(projection(await me(user.accessToken))).toEqual({
        active_role: null,
        available_roles: ['DRIVER'],
        role_selection_required: true,
        onboarding_required: false,
      });
    });

    it('no usable role left and a completed profile: null, [], no selection and no onboarding loop', async () => {
      const user = await registerUser(app);
      await grantRole(app.pool, user.userId, 'SHOP');
      expect((await select(user.accessToken, 'SHOP')).status).toBe(200);
      await disableShop(user.userId);
      expect(projection(await me(user.accessToken))).toEqual({
        active_role: null,
        available_roles: [],
        role_selection_required: false,
        onboarding_required: false,
      });
    });

    it('a still-valid active role stays selected, and a roleless session is unchanged', async () => {
      const user = await registerUser(app);
      await grantRole(app.pool, user.userId, 'DRIVER');
      expect(projection(await me(user.accessToken))).toEqual({
        active_role: null,
        available_roles: ['DRIVER'],
        role_selection_required: true,
        onboarding_required: false,
      });
      expect((await select(user.accessToken, 'DRIVER')).status).toBe(200);
      expect(projection(await me(user.accessToken))).toEqual({
        active_role: 'DRIVER',
        available_roles: ['DRIVER'],
        role_selection_required: false,
        onboarding_required: false,
      });
    });

    it('/me never mutates the session: the stored active role is untouched by a stale-role read', async () => {
      const user = await registerUser(app);
      await grantRole(app.pool, user.userId, 'SHOP');
      await grantRole(app.pool, user.userId, 'DRIVER');
      expect((await select(user.accessToken, 'DRIVER')).status).toBe(200);
      await closeDriver(user.userId);
      const sessionId = await sessionIdOfToken(app.pool, user.accessToken);
      const before = await app.pool.query('SELECT active_role, updated_at FROM app.sessions WHERE session_id = $1::uuid', [sessionId]);
      await me(user.accessToken);
      const after = await app.pool.query('SELECT active_role, updated_at FROM app.sessions WHERE session_id = $1::uuid', [sessionId]);
      expect(after.rows).toEqual(before.rows);
      expect(after.rows[0]?.active_role).toBe('DRIVER');
    });
  });
});
