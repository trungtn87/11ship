import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import {
  CHALLENGE_ATTEMPT_LIMIT,
  PASSWORD_FAILURE_LIMIT,
  TOTP_FAILURE_LIMIT,
} from '../../apps/backend/src/admin-auth/admin-auth-constants';
import {
  AdminApp,
  adminData,
  adminErrorCode,
  AdminResponse,
  count,
  createSystem,
  enrollAndLogin,
  loginBody,
  loginStep,
  preauthCookies,
  rewindAcceptedStep,
  startAdminApp,
  SystemAccount,
  totpNow,
  wrongCode,
} from './support/admin-fixtures';

// M01-D-LOGIN - concurrent requests on ONE limiter bucket (and on one step) through the real pipeline.
// Every request in a burst is released together; the statuses are counted, never ordered:
//  * no budget overrun (exactly the limit of failures is ever charged),
//  * no lost counter (the stored count equals the number of charged failures),
//  * no lock extension (requests refused by the lock do not touch the row).
describe('M01-D-LOGIN - concurrency on one bucket and one step', () => {
  let app: AdminApp;
  let system: SystemAccount;

  beforeAll(async () => {
    // Each request names its own client address, so the per-address request quota never decides the outcome.
    app = await startAdminApp({ trustedProxyIps: ['127.0.0.1'] });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.clearLimits();
    system = await createSystem(app);
  });

  interface BucketRow {
    bucket_key: string;
    window_started_at: Date;
    failure_count: number;
    locked_until: Date | null;
    updated_at: Date;
  }

  async function bucket(kind: string): Promise<BucketRow[]> {
    const result = await app.pool.query<BucketRow>(
      `SELECT bucket_key, window_started_at, failure_count, locked_until, updated_at
         FROM app.admin_auth_limits WHERE kind = $1 ORDER BY bucket_key`,
      [kind],
    );
    return result.rows;
  }

  function tally(responses: AdminResponse[]): Record<number, number> {
    const result: Record<number, number> = {};
    for (const response of responses) {
      result[response.status] = (result[response.status] ?? 0) + 1;
    }
    return result;
  }

  const address = (index: number) => `198.51.100.${String(index + 1)}`;

  it('14 concurrent wrong passwords on one phone: exactly 10 failures are charged, 9 answer 401 and 5 answer 429', async () => {
    const burst = PASSWORD_FAILURE_LIMIT + 4;
    const responses = await Promise.all(
      Array.from({ length: burst }, (_unused, index) =>
        app.call('POST', '/login', {
          body: loginBody(system, { password: 'Wrong-Password-1' }),
          headers: { 'x-forwarded-for': address(index) },
        }),
      ),
    );
    expect(tally(responses)).toEqual({ 401: PASSWORD_FAILURE_LIMIT - 1, 429: burst - (PASSWORD_FAILURE_LIMIT - 1) });
    for (const response of responses.filter((candidate) => candidate.status === 429)) {
      expect(adminErrorCode(response)).toBe('ADMIN_AUTH_RATE_LIMITED');
      expect(Number(response.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    }

    const phone = await bucket('LOGIN_PHONE');
    expect(phone).toHaveLength(1);
    expect(phone[0]?.failure_count).toBe(PASSWORD_FAILURE_LIMIT);
    expect(phone[0]?.locked_until).not.toBeNull();
    // Each of the 14 addresses failed at most once; none of them reached its own threshold.
    for (const row of await bucket('LOGIN_IP')) {
      expect(row.failure_count).toBeLessThanOrEqual(1);
    }

    // A second burst against the locked bucket leaves the row byte-for-byte as it was: no extension, no count.
    const locked = await bucket('LOGIN_PHONE');
    const again = await Promise.all(
      Array.from({ length: 8 }, (_unused, index) =>
        app.call('POST', '/login', {
          body: loginBody(system, { password: 'Wrong-Password-1' }),
          headers: { 'x-forwarded-for': address(50 + index) },
        }),
      ),
    );
    expect(tally(again)).toEqual({ 429: 8 });
    expect(await bucket('LOGIN_PHONE')).toEqual(locked);
  });

  it('concurrent wrong codes on one live step: exactly 5 are charged (4 answer 400, the rest 429) and the lock is not extended', async () => {
    const first = await enrollAndLogin(app, system);
    const step = await loginStep(app, system, address(0));
    const burst = TOTP_FAILURE_LIMIT + 3;
    const responses = await Promise.all(
      Array.from({ length: burst }, (_unused, index) =>
        app.call('POST', '/totp/verify', {
          body: { code: wrongCode(first.secret) },
          cookies: preauthCookies(step),
          csrf: step.csrf,
          headers: { 'x-forwarded-for': address(index + 1) },
        }),
      ),
    );
    expect(tally(responses)).toEqual({ 400: TOTP_FAILURE_LIMIT - 1, 429: burst - (TOTP_FAILURE_LIMIT - 1) });

    const totp = await bucket('TOTP_USER');
    expect(totp).toHaveLength(1);
    expect(totp[0]?.failure_count).toBe(TOTP_FAILURE_LIMIT);
    expect(totp[0]?.locked_until).not.toBeNull();
    const attempts = await app.pool.query<{ attempt_count: number }>(
      'SELECT attempt_count FROM app.admin_auth_challenges WHERE challenge_id IN (SELECT challenge_id FROM app.admin_auth_challenges WHERE user_id = $1::uuid AND consumed_at IS NULL)',
      [system.userId],
    );
    for (const row of attempts.rows) {
      expect(row.attempt_count).toBeLessThanOrEqual(CHALLENGE_ATTEMPT_LIMIT);
    }

    const locked = await bucket('TOTP_USER');
    const again = await Promise.all(
      Array.from({ length: 6 }, (_unused, index) =>
        app.call('POST', '/totp/verify', {
          body: { code: wrongCode(first.secret) },
          cookies: preauthCookies(step),
          csrf: step.csrf,
          headers: { 'x-forwarded-for': address(30 + index) },
        }),
      ),
    );
    expect(tally(again)).toEqual({ 429: 6 });
    expect(await bucket('TOTP_USER')).toEqual(locked);
    expect(await count(app.pool, 'SELECT 1 FROM app.admin_sessions WHERE user_id = $1::uuid', [system.userId])).toBe(1);
  });

  it('a double-submitted verify creates exactly one session: one 200, the other 401', async () => {
    const first = await enrollAndLogin(app, system);
    await rewindAcceptedStep(app, system.userId);
    const step = await loginStep(app, system, address(0));
    const code = totpNow(first.secret);
    const responses = await Promise.all(
      [1, 2, 3].map((index) =>
        app.call('POST', '/totp/verify', {
          body: { code },
          cookies: preauthCookies(step),
          csrf: step.csrf,
          headers: { 'x-forwarded-for': address(index) },
        }),
      ),
    );
    expect(tally(responses)).toEqual({ 200: 1, 401: 2 });
    for (const response of responses.filter((candidate) => candidate.status === 401)) {
      expect(adminErrorCode(response)).toBe('ADMIN_PREAUTH_INVALID');
      expect(response.setCookie).toEqual([]);
    }
    const sessions = await app.pool.query<{ revoked: boolean }>(
      'SELECT revoked_at IS NOT NULL AS revoked FROM app.admin_sessions WHERE user_id = $1::uuid ORDER BY created_at, session_id',
      [system.userId],
    );
    expect(sessions.rows.map((row) => row.revoked)).toEqual([true, false]);
    // Nothing was charged: the losers were refused as an already consumed step, not as wrong codes.
    expect(await bucket('TOTP_USER')).toEqual([]);
  });

  it('a double-submitted enrollment verify activates the factor and creates the session once', async () => {
    const step = await loginStep(app, system, address(0));
    const started = await app.call('POST', '/totp/enrollment', {
      body: {},
      cookies: preauthCookies(step),
      csrf: step.csrf,
      headers: { 'x-forwarded-for': address(1) },
    });
    expect(started.status).toBe(200);
    const code = totpNow(String(adminData(started).secret));
    const responses = await Promise.all(
      [2, 3, 4].map((index) =>
        app.call('POST', '/totp/enrollment/verify', {
          body: { code },
          cookies: preauthCookies(step),
          csrf: step.csrf,
          headers: { 'x-forwarded-for': address(index) },
        }),
      ),
    );
    expect(tally(responses)).toEqual({ 200: 1, 401: 2 });
    expect(await count(app.pool, 'SELECT 1 FROM app.admin_sessions WHERE user_id = $1::uuid', [system.userId])).toBe(1);
    expect(
      await count(app.pool, `SELECT 1 FROM app.admin_totp_factors WHERE user_id = $1::uuid AND state = 'ACTIVE'`, [system.userId]),
    ).toBe(1);
  });
});
