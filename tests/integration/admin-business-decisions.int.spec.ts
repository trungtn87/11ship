import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { ADMIN_SESSION_COOKIE } from '../../apps/backend/src/admin-auth/admin-auth-constants';
import {
  AdminApp,
  adminErrorCode,
  cookieFrom,
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

// The two business decisions the Owner fixed for this round (M01-D-LOGIN review).
//
// Q1: a correct password still gets a preauth step while the TOTP account is locked; verify answers
//     ADMIN_AUTH_RATE_LIMITED with Retry-After; login never resets, raises, extends or shortens anything of the TOTP bucket.
// Q2: the password-failure buckets stay per PHONE and per ADDRESS (not phone+address); the lock is 15 minutes; the
//     failure that reaches the threshold answers 429. Accepted risk, written down: anyone who knows the SYSTEM phone can
//     lock it with ~10 requests per 15 minutes, and there is no recovery in this task.

interface BucketRow {
  bucket_key: string;
  kind: string;
  window_started_at: Date;
  failure_count: number;
  locked_until: Date | null;
  updated_at: Date;
}

describe('M01-D-LOGIN Q1 - correct password while the TOTP account is locked', () => {
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

  /** Every column of the TOTP_USER bucket row: any change at all (count, window, lock, even updated_at) shows up. */
  async function totpBucket(): Promise<BucketRow[]> {
    const result = await app.pool.query<BucketRow>(
      `SELECT bucket_key, kind, window_started_at, failure_count, locked_until, updated_at
         FROM app.admin_auth_limits WHERE kind = 'TOTP_USER' ORDER BY bucket_key`,
    );
    return result.rows;
  }

  it('hands out a step, answers verify with 429 + Retry-After, and login changes neither the budget nor the lock', async () => {
    const first = await enrollAndLogin(app, system);

    // Lock the TOTP account the product way: five wrong codes (the fifth reaches the limit and answers 429).
    const lockingStep = await loginStep(app, system);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const wrong = await app.call('POST', '/totp/verify', {
        body: { code: wrongCode(first.secret) },
        cookies: preauthCookies(lockingStep),
        csrf: lockingStep.csrf,
      });
      expect(wrong.status).toBe(attempt < 5 ? 400 : 429);
    }
    const locked = await totpBucket();
    expect(locked).toHaveLength(1);
    expect(locked[0]?.failure_count).toBe(5);
    expect(locked[0]?.locked_until).not.toBeNull();

    // Correct password: a step is still handed out, and the bucket is byte-for-byte what it was.
    const next = await loginStep(app, system);
    expect(next.nextStep).toBe('VERIFY_TOTP');
    expect(await totpBucket()).toEqual(locked);

    // Verify is refused by the lock even for a code that would be valid (the accepted step is moved back, so a replay
    // is not the reason). The refusal carries Retry-After, creates no session and changes nothing.
    await rewindAcceptedStep(app, system.userId);
    const refused = await app.call('POST', '/totp/verify', {
      body: { code: totpNow(first.secret) },
      cookies: preauthCookies(next),
      csrf: next.csrf,
    });
    expect(refused.status).toBe(429);
    expect(adminErrorCode(refused)).toBe('ADMIN_AUTH_RATE_LIMITED');
    expect(cookieFrom(refused, ADMIN_SESSION_COOKIE)).toBeUndefined();
    const retryAfter = Number(refused.headers['retry-after']);
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(900);
    const remaining = await app.pool.query<{ seconds: number }>(
      `SELECT ceil(extract(epoch FROM (locked_until - clock_timestamp())))::int AS seconds
         FROM app.admin_auth_limits WHERE kind = 'TOTP_USER'`,
    );
    // The header is computed before this read, so it can only be equal or larger: the lock was not shortened.
    expect(retryAfter).toBeGreaterThanOrEqual(remaining.rows[0]?.seconds ?? Number.MAX_SAFE_INTEGER);
    expect(await totpBucket()).toEqual(locked);

    // The blocked step was not charged an attempt, and no second session exists.
    const attempts = await app.pool.query<{ attempt_count: number }>(
      'SELECT attempt_count FROM app.admin_auth_challenges WHERE user_id = $1::uuid AND consumed_at IS NULL',
      [system.userId],
    );
    expect(attempts.rows.map((row) => row.attempt_count)).toEqual([0]);
    expect(await count(app.pool, 'SELECT 1 FROM app.admin_sessions WHERE user_id = $1::uuid', [system.userId])).toBe(1);
  });

  it('does not reset the failure budget on a new login or on a successful code; the budget continues across steps', async () => {
    const first = await enrollAndLogin(app, system);
    await rewindAcceptedStep(app, system.userId);

    const stepOne = await loginStep(app, system);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const wrong = await app.call('POST', '/totp/verify', {
        body: { code: wrongCode(first.secret) },
        cookies: preauthCookies(stepOne),
        csrf: stepOne.csrf,
      });
      expect(wrong.status).toBe(400);
    }
    const afterTwo = await totpBucket();
    expect(afterTwo).toHaveLength(1);
    expect(afterTwo[0]?.failure_count).toBe(2);
    expect(afterTwo[0]?.locked_until).toBeNull();

    // A new login (correct password) does not give the budget back ...
    const stepTwo = await loginStep(app, system);
    expect(await totpBucket()).toEqual(afterTwo);

    // ... and neither does a successful code.
    const ok = await app.call('POST', '/totp/verify', {
      body: { code: totpNow(first.secret) },
      cookies: preauthCookies(stepTwo),
      csrf: stepTwo.csrf,
    });
    expect(ok.status).toBe(200);
    expect(await totpBucket()).toEqual(afterTwo);

    // The next failure on yet another step continues from 2.
    const stepThree = await loginStep(app, system);
    const wrong = await app.call('POST', '/totp/verify', {
      body: { code: wrongCode(first.secret) },
      cookies: preauthCookies(stepThree),
      csrf: stepThree.csrf,
    });
    expect(wrong.status).toBe(400);
    expect((await totpBucket())[0]?.failure_count).toBe(3);
  });
});

describe('M01-D-LOGIN Q2 - password failure buckets per phone and per address, 15 minute lock', () => {
  let app: AdminApp;
  let system: SystemAccount;

  const ADDRESS_A = '203.0.113.10';
  const ADDRESS_B = '203.0.113.11';
  const ADDRESS_C = '203.0.113.12';
  const ADDRESS_D = '203.0.113.13';

  beforeAll(async () => {
    // The test socket is 127.0.0.1; trusting exactly that proxy lets each request name its own client address.
    app = await startAdminApp({ trustedProxyIps: ['127.0.0.1'] });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.clearLimits();
    system = await createSystem(app);
  });

  const from = (address: string) => ({ 'x-forwarded-for': address });

  const wrongLogin = (address: string, phone?: string) =>
    app.call('POST', '/login', {
      body: { ...loginBody(system, { password: 'Wrong-Password-1' }), ...(phone === undefined ? {} : { phone }) },
      headers: from(address),
    });

  it('the phone bucket is keyed by the phone alone: 10 wrong passwords from one address lock it for every address', async () => {
    for (let attempt = 1; attempt <= 9; attempt += 1) {
      expect((await wrongLogin(ADDRESS_A)).status).toBe(401);
    }
    // The failure that reaches the threshold answers 429 and says how long the lock lasts.
    const locking = await wrongLogin(ADDRESS_A);
    expect(locking.status).toBe(429);
    expect(adminErrorCode(locking)).toBe('ADMIN_AUTH_RATE_LIMITED');
    const lockingRetry = Number(locking.headers['retry-after']);
    expect(lockingRetry).toBeGreaterThanOrEqual(895);
    expect(lockingRetry).toBeLessThanOrEqual(900);

    // Another address, the CORRECT password: still refused, because the lock belongs to the phone.
    const other = await app.call('POST', '/login', { body: loginBody(system), headers: from(ADDRESS_B) });
    expect(other.status).toBe(429);
    expect(adminErrorCode(other)).toBe('ADMIN_AUTH_RATE_LIMITED');
    const otherRetry = Number(other.headers['retry-after']);
    expect(otherRetry).toBeGreaterThanOrEqual(1);
    expect(otherRetry).toBeLessThanOrEqual(900);
    expect(other.setCookie).toEqual([]);

    // One bucket for the phone whatever the address (a phone+address bucket would have created a second one) ...
    expect(await count(app.pool, `SELECT 1 FROM app.admin_auth_limits WHERE kind = 'LOGIN_PHONE'`)).toBe(1);
    // ... locked for 15 minutes.
    const lock = await app.pool.query<{ seconds: number }>(
      `SELECT extract(epoch FROM (locked_until - clock_timestamp()))::int AS seconds
         FROM app.admin_auth_limits WHERE kind = 'LOGIN_PHONE'`,
    );
    expect(lock.rows[0]?.seconds).toBeGreaterThan(880);
    expect(lock.rows[0]?.seconds).toBeLessThanOrEqual(900);
  });

  it('the address bucket is keyed by the address alone: 10 wrong passwords for 10 phones lock that address, not the phones', async () => {
    for (let index = 1; index <= 9; index += 1) {
      const phone = `09000001${String(index).padStart(2, '0')}`;
      expect((await wrongLogin(ADDRESS_C, phone)).status).toBe(401);
    }
    const locking = await wrongLogin(ADDRESS_C, '0900000110');
    expect(locking.status).toBe(429);
    expect(adminErrorCode(locking)).toBe('ADMIN_AUTH_RATE_LIMITED');

    // The per-minute request quota is a different mechanism with its own test; clear it so the next call is decided by
    // the failure lock alone.
    await app.pool.query(`DELETE FROM app.admin_auth_limits WHERE kind = 'LOGIN_REQUEST_IP'`);
    const sameAddress = await app.call('POST', '/login', { body: loginBody(system), headers: from(ADDRESS_C) });
    expect(sameAddress.status).toBe(429);
    expect(adminErrorCode(sameAddress)).toBe('ADMIN_AUTH_RATE_LIMITED');

    // Another address with the same correct credentials is fine: the SYSTEM phone itself is not locked.
    const otherAddress = await app.call('POST', '/login', { body: loginBody(system), headers: from(ADDRESS_D) });
    expect(otherAddress.status).toBe(200);
  });
});
