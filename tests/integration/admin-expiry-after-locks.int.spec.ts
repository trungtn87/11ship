import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { ADMIN_SESSION_COOKIE } from '../../apps/backend/src/admin-auth/admin-auth-constants';
import {
  AdminApp,
  AdminResponse,
  adminData,
  adminErrorCode,
  cookieFrom,
  count,
  createSystem,
  enrollAndLogin,
  loginStep,
  preauthCookies,
  sessionCookies,
  startAdminApp,
  SystemAccount,
  totpNow,
} from './support/admin-fixtures';
import { holdRowLock, waitForBlockedBackends, waitUntilDbClockPast } from './support/lock-fixtures';

// M01-D-LOGIN review finding: "expired" must be decided against a FRESH database clock read AFTER every lock of the
// request was granted (enrollment, verify, GET /state, GET /me), never from a value computed before a lock wait ended.
//
// Method: the TEST holds a row lock (without modifying the row), sends a request while the credential is still valid,
// waits until the request is really blocked on PostgreSQL, lets the credential expire (database clock), and only then
// releases the lock. The request must be refused: no factor is activated, no secret handed out, no session created.
//
// Two places the wait can happen are covered. Holding the CREDENTIAL ROW itself is the case a flag computed inside the
// locking SELECT gets wrong. Holding the USER ROW is the contract's own first lock; it passes before and after the fix
// and guards the lock order.

const EXPIRES_IN_SECONDS = 4;

describe('M01-D-LOGIN - credential expiry is decided after the locks are held', () => {
  let app: AdminApp;
  let system: SystemAccount;

  beforeAll(async () => {
    app = await startAdminApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.clearLimits();
    system = await createSystem(app);
  });

  interface Held {
    readonly lockSql: string;
    readonly lockValues: unknown[];
    /** Scalar timestamptz query: the instant after which the credential under test is expired. */
    readonly expirySql: string;
    readonly expiryValues: unknown[];
  }

  async function liveChallengeId(): Promise<string> {
    const rows = await app.pool.query<{ challenge_id: string }>(
      `SELECT challenge_id FROM app.admin_auth_challenges
        WHERE user_id = $1::uuid AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1`,
      [system.userId],
    );
    const row = rows.rows[0];
    if (row === undefined) {
      throw new Error('no live challenge for the test account');
    }
    return row.challenge_id;
  }

  async function liveSessionId(): Promise<string> {
    const rows = await app.pool.query<{ session_id: string }>(
      `SELECT session_id FROM app.admin_sessions WHERE user_id = $1::uuid AND revoked_at IS NULL`,
      [system.userId],
    );
    const row = rows.rows[0];
    if (row === undefined) {
      throw new Error('no live session for the test account');
    }
    return row.session_id;
  }

  /** Makes the challenge expire a few seconds from now on the DATABASE clock (test database only). */
  async function expireChallengeSoon(challengeId: string): Promise<void> {
    await app.pool.query(
      `UPDATE app.admin_auth_challenges
          SET expires_at = date_trunc('milliseconds', clock_timestamp()) + make_interval(secs => $2::double precision)
        WHERE challenge_id = $1::uuid`,
      [challengeId, EXPIRES_IN_SECONDS],
    );
  }

  async function expireSessionSoon(sessionId: string): Promise<void> {
    await app.pool.query(
      `UPDATE app.admin_sessions
          SET expires_at = date_trunc('milliseconds', clock_timestamp()) + make_interval(secs => $2::double precision)
        WHERE session_id = $1::uuid`,
      [sessionId, EXPIRES_IN_SECONDS],
    );
  }

  const challengeHeld = (challengeId: string): Held => ({
    lockSql: 'SELECT challenge_id FROM app.admin_auth_challenges WHERE challenge_id = $1::uuid FOR UPDATE',
    lockValues: [challengeId],
    expirySql: 'SELECT expires_at FROM app.admin_auth_challenges WHERE challenge_id = $1::uuid',
    expiryValues: [challengeId],
  });

  const sessionHeld = (sessionId: string): Held => ({
    lockSql: 'SELECT session_id FROM app.admin_sessions WHERE session_id = $1::uuid FOR UPDATE',
    lockValues: [sessionId],
    expirySql: 'SELECT expires_at FROM app.admin_sessions WHERE session_id = $1::uuid',
    expiryValues: [sessionId],
  });

  /** The contract's FIRST lock of every administration request: the account row. */
  const userHeldForChallenge = (challengeId: string): Held => ({
    lockSql: 'SELECT user_id FROM app.users WHERE user_id = $1::uuid FOR UPDATE',
    lockValues: [system.userId],
    expirySql: 'SELECT expires_at FROM app.admin_auth_challenges WHERE challenge_id = $1::uuid',
    expiryValues: [challengeId],
  });

  const userHeldForSession = (sessionId: string): Held => ({
    lockSql: 'SELECT user_id FROM app.users WHERE user_id = $1::uuid FOR UPDATE',
    lockValues: [system.userId],
    expirySql: 'SELECT expires_at FROM app.admin_sessions WHERE session_id = $1::uuid',
    expiryValues: [sessionId],
  });

  /**
   * Hold the lock, send the request while the credential is still valid, wait until it is blocked, wait until the
   * database clock has passed the expiry, then release. Returns the response of the request that waited.
   */
  async function sendWhileLockedUntilExpired(held: Held, send: () => Promise<AdminResponse>): Promise<AdminResponse> {
    const lock = await holdRowLock(app.pool, held.lockSql, held.lockValues);
    const pending = send();
    // A failing wait below must not leave this promise as an unhandled rejection.
    pending.catch(() => undefined);
    try {
      await waitForBlockedBackends(app.pool);
      await waitUntilDbClockPast(app.pool, held.expirySql, held.expiryValues);
    } finally {
      await lock.release();
    }
    return pending;
  }

  function expectNoSessionCookie(response: AdminResponse): void {
    expect(cookieFrom(response, ADMIN_SESSION_COOKIE)).toBeUndefined();
  }

  describe('the wait happens on the credential row itself', () => {
    it('POST /totp/enrollment: a step that expired while waiting is refused and no factor or secret is created', async () => {
      const preauth = await loginStep(app, system);
      const challengeId = await liveChallengeId();
      await expireChallengeSoon(challengeId);

      const response = await sendWhileLockedUntilExpired(challengeHeld(challengeId), () =>
        app.call('POST', '/totp/enrollment', { body: {}, cookies: preauthCookies(preauth), csrf: preauth.csrf }),
      );

      expect(response.status).toBe(401);
      expect(adminErrorCode(response)).toBe('ADMIN_PREAUTH_INVALID');
      expect(response.text).not.toContain('otpauth');
      expect(await count(app.pool, 'SELECT 1 FROM app.admin_totp_factors WHERE user_id = $1::uuid', [system.userId])).toBe(0);
    });

    it('POST /totp/enrollment/verify: a correct code is refused, the factor stays PENDING and no session is created', async () => {
      const preauth = await loginStep(app, system);
      const started = await app.call('POST', '/totp/enrollment', {
        body: {},
        cookies: preauthCookies(preauth),
        csrf: preauth.csrf,
      });
      const secret = String(adminData(started).secret);
      const challengeId = await liveChallengeId();
      await expireChallengeSoon(challengeId);

      const response = await sendWhileLockedUntilExpired(challengeHeld(challengeId), () =>
        app.call('POST', '/totp/enrollment/verify', {
          body: { code: totpNow(secret) },
          cookies: preauthCookies(preauth),
          csrf: preauth.csrf,
        }),
      );

      expect(response.status).toBe(401);
      expect(adminErrorCode(response)).toBe('ADMIN_PREAUTH_INVALID');
      expectNoSessionCookie(response);
      const factor = await app.pool.query<{ state: string }>(
        'SELECT state FROM app.admin_totp_factors WHERE user_id = $1::uuid',
        [system.userId],
      );
      expect(factor.rows.map((row) => row.state)).toEqual(['PENDING']);
      expect(await count(app.pool, 'SELECT 1 FROM app.admin_sessions WHERE user_id = $1::uuid', [system.userId])).toBe(0);
      expect(
        await count(app.pool, `SELECT 1 FROM app.audit_logs WHERE action = 'admin_auth.login_completed.v1' AND actor_id = $1`, [
          system.userId,
        ]),
      ).toBe(0);
    });

    it('POST /totp/verify: a correct code is refused; the older session stays, the accepted step does not move', async () => {
      const first = await enrollAndLogin(app, system);
      // The enrollment used the current step; moving the stored step back lets the current code be a valid first use.
      await app.pool.query(
        'UPDATE app.admin_totp_factors SET last_accepted_step = last_accepted_step - 10 WHERE user_id = $1::uuid',
        [system.userId],
      );
      const stepBefore = await app.pool.query<{ last_accepted_step: string }>(
        'SELECT last_accepted_step::text AS last_accepted_step FROM app.admin_totp_factors WHERE user_id = $1::uuid',
        [system.userId],
      );
      const preauth = await loginStep(app, system);
      expect(preauth.nextStep).toBe('VERIFY_TOTP');
      const challengeId = await liveChallengeId();
      await expireChallengeSoon(challengeId);

      const response = await sendWhileLockedUntilExpired(challengeHeld(challengeId), () =>
        app.call('POST', '/totp/verify', {
          body: { code: totpNow(first.secret) },
          cookies: preauthCookies(preauth),
          csrf: preauth.csrf,
        }),
      );

      expect(response.status).toBe(401);
      expect(adminErrorCode(response)).toBe('ADMIN_PREAUTH_INVALID');
      expectNoSessionCookie(response);
      expect(await count(app.pool, 'SELECT 1 FROM app.admin_sessions WHERE user_id = $1::uuid', [system.userId])).toBe(1);
      expect(
        await count(app.pool, 'SELECT 1 FROM app.admin_sessions WHERE user_id = $1::uuid AND revoked_at IS NULL', [system.userId]),
      ).toBe(1);
      const stepAfter = await app.pool.query<{ last_accepted_step: string }>(
        'SELECT last_accepted_step::text AS last_accepted_step FROM app.admin_totp_factors WHERE user_id = $1::uuid',
        [system.userId],
      );
      expect(stepAfter.rows[0]?.last_accepted_step).toBe(stepBefore.rows[0]?.last_accepted_step);
    });

    it('GET /me: a session that expired while waiting is refused', async () => {
      const login = await enrollAndLogin(app, system);
      const sessionId = await liveSessionId();
      await expireSessionSoon(sessionId);

      const response = await sendWhileLockedUntilExpired(sessionHeld(sessionId), () =>
        app.call('GET', '/me', { cookies: sessionCookies(login) }),
      );

      expect(response.status).toBe(401);
      expect(adminErrorCode(response)).toBe('ADMIN_SESSION_INVALID');
      expect(response.body.data).toBeUndefined();
    });

    it('GET /state with a session cookie: a session that expired while waiting is not reported as SESSION', async () => {
      const login = await enrollAndLogin(app, system);
      const sessionId = await liveSessionId();
      await expireSessionSoon(sessionId);

      const response = await sendWhileLockedUntilExpired(sessionHeld(sessionId), () =>
        app.call('GET', '/state', { cookies: sessionCookies(login) }),
      );

      expect(response.status).toBe(401);
      expect(adminErrorCode(response)).toBe('ADMIN_SESSION_INVALID');
      expect(response.body.data).toBeUndefined();
    });

    it('GET /state with a preauth cookie: a step that expired while waiting is not reported as PREAUTH', async () => {
      const preauth = await loginStep(app, system);
      const challengeId = await liveChallengeId();
      await expireChallengeSoon(challengeId);

      const response = await sendWhileLockedUntilExpired(challengeHeld(challengeId), () =>
        app.call('GET', '/state', { cookies: preauthCookies(preauth) }),
      );

      expect(response.status).toBe(401);
      expect(adminErrorCode(response)).toBe('ADMIN_PREAUTH_INVALID');
      expect(response.body.data).toBeUndefined();
    });
  });

  describe('the wait happens on the account row (the first lock of the contract order)', () => {
    it('POST /totp/verify: refused after the wait, nothing activated, no session', async () => {
      const first = await enrollAndLogin(app, system);
      await app.pool.query(
        'UPDATE app.admin_totp_factors SET last_accepted_step = last_accepted_step - 10 WHERE user_id = $1::uuid',
        [system.userId],
      );
      const preauth = await loginStep(app, system);
      const challengeId = await liveChallengeId();
      await expireChallengeSoon(challengeId);

      const response = await sendWhileLockedUntilExpired(userHeldForChallenge(challengeId), () =>
        app.call('POST', '/totp/verify', {
          body: { code: totpNow(first.secret) },
          cookies: preauthCookies(preauth),
          csrf: preauth.csrf,
        }),
      );

      expect(response.status).toBe(401);
      expect(adminErrorCode(response)).toBe('ADMIN_PREAUTH_INVALID');
      expectNoSessionCookie(response);
      expect(
        await count(app.pool, 'SELECT 1 FROM app.admin_sessions WHERE user_id = $1::uuid AND revoked_at IS NULL', [system.userId]),
      ).toBe(1);
    });

    it('GET /me: refused after the wait', async () => {
      const login = await enrollAndLogin(app, system);
      const sessionId = await liveSessionId();
      await expireSessionSoon(sessionId);

      const response = await sendWhileLockedUntilExpired(userHeldForSession(sessionId), () =>
        app.call('GET', '/me', { cookies: sessionCookies(login) }),
      );

      expect(response.status).toBe(401);
      expect(adminErrorCode(response)).toBe('ADMIN_SESSION_INVALID');
    });
  });

  describe('control: the same wait without expiry changes nothing', () => {
    it('POST /totp/enrollment/verify succeeds when the lock is released while the step is still valid', async () => {
      const preauth = await loginStep(app, system);
      const started = await app.call('POST', '/totp/enrollment', {
        body: {},
        cookies: preauthCookies(preauth),
        csrf: preauth.csrf,
      });
      const secret = String(adminData(started).secret);
      const challengeId = await liveChallengeId();
      const held = challengeHeld(challengeId);

      const lock = await holdRowLock(app.pool, held.lockSql, held.lockValues);
      const pending = app.call('POST', '/totp/enrollment/verify', {
        body: { code: totpNow(secret) },
        cookies: preauthCookies(preauth),
        csrf: preauth.csrf,
      });
      pending.catch(() => undefined);
      try {
        await waitForBlockedBackends(app.pool);
      } finally {
        await lock.release();
      }
      const response = await pending;

      expect(response.status).toBe(200);
      const session = cookieFrom(response, ADMIN_SESSION_COOKIE);
      expect(session === undefined || session === '').toBe(false);
      const factor = await app.pool.query<{ state: string }>(
        'SELECT state FROM app.admin_totp_factors WHERE user_id = $1::uuid',
        [system.userId],
      );
      expect(factor.rows.map((row) => row.state)).toEqual(['ACTIVE']);
    });
  });
});
