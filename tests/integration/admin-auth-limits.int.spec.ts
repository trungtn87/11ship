import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import {
  AdminApp,
  adminErrorCode,
  count,
  createSystem,
  enrollAndLogin,
  loginBody,
  loginStep,
  preauthCookies,
  startAdminApp,
  SystemAccount,
  totpNow,
} from './support/admin-fixtures';

// M01-D-LOGIN - persistent rate limits (PostgreSQL buckets), locks and the Retry-After header.
describe('M01-D-LOGIN - limits and locks', () => {
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

  it('allows 10 login requests per minute from one address and answers the 11th with 429 + Retry-After', async () => {
    for (let index = 0; index < 10; index += 1) {
      const ok = await app.call('POST', '/login', { body: loginBody(system) });
      expect(ok.status).toBe(200);
    }
    const limited = await app.call('POST', '/login', { body: loginBody(system) });
    expect(limited.status).toBe(429);
    expect(adminErrorCode(limited)).toBe('ADMIN_AUTH_RATE_LIMITED');
    const retry = Number(limited.headers['retry-after']);
    expect(Number.isInteger(retry)).toBe(true);
    expect(retry).toBeGreaterThanOrEqual(1);
    expect(retry).toBeLessThanOrEqual(60);
    expect(limited.setCookie).toEqual([]);
  });

  it('stores bucket digests only - never a phone number, address or user id', async () => {
    await app.call('POST', '/login', { body: loginBody(system, { password: 'Wrong-Password-1' }) });
    const rows = await app.pool.query<{ bucket_key: string; kind: string }>('SELECT bucket_key, kind FROM app.admin_auth_limits');
    expect(rows.rows.length).toBeGreaterThan(0);
    const dump = JSON.stringify(rows.rows);
    expect(dump).not.toContain(system.phone.normalized);
    expect(dump).not.toContain(system.phone.local);
    expect(dump).not.toContain(system.userId);
    expect(dump).not.toContain('127.0.0.1');
  });

  it('locks the phone after 10 wrong passwords; the locking attempt and every later one answer 429', async () => {
    for (let index = 0; index < 9; index += 1) {
      const wrong = await app.call('POST', '/login', { body: loginBody(system, { password: 'Wrong-Password-1' }) });
      expect(wrong.status).toBe(401);
      if (index === 4) {
        // Keep the per-address request quota out of the way: it is a different mechanism with its own test.
        await app.pool.query(`DELETE FROM app.admin_auth_limits WHERE kind IN ('LOGIN_REQUEST_IP')`);
      }
    }
    const locking = await app.call('POST', '/login', { body: loginBody(system, { password: 'Wrong-Password-1' }) });
    expect(locking.status).toBe(429);
    const before = await app.pool.query<{ locked_until: Date | null }>(
      `SELECT max(locked_until) AS locked_until FROM app.admin_auth_limits WHERE kind = 'LOGIN_PHONE'`,
    );
    // Even the CORRECT password is refused while locked, and the lock is not extended.
    const correct = await app.call('POST', '/login', { body: loginBody(system) });
    expect(correct.status).toBe(429);
    expect(Number(correct.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    const after = await app.pool.query<{ locked_until: Date | null }>(
      `SELECT max(locked_until) AS locked_until FROM app.admin_auth_limits WHERE kind = 'LOGIN_PHONE'`,
    );
    expect(after.rows[0]?.locked_until?.getTime()).toBe(before.rows[0]?.locked_until?.getTime());
  });

  it('five wrong codes lock the TOTP of the account; login still hands out a step, verify answers 429', async () => {
    const first = await enrollAndLogin(app, system);
    for (let index = 0; index < 4; index += 1) {
      const preauth = await loginStep(app, system);
      const wrong = await app.call('POST', '/totp/verify', {
        body: { code: totpNow(first.secret, -1) === '000000' ? '111111' : '000000' },
        cookies: preauthCookies(preauth),
        csrf: preauth.csrf,
      });
      expect(wrong.status).toBe(400);
    }
    const preauth = await loginStep(app, system);
    const locking = await app.call('POST', '/totp/verify', {
      body: { code: '123457' === totpNow(first.secret) ? '123458' : '123457' },
      cookies: preauthCookies(preauth),
      csrf: preauth.csrf,
    });
    expect(locking.status).toBe(429);

    const nextStep = await loginStep(app, system);
    const refused = await app.call('POST', '/totp/verify', {
      body: { code: totpNow(first.secret, -1) },
      cookies: preauthCookies(nextStep),
      csrf: nextStep.csrf,
    });
    expect(refused.status).toBe(429);
    expect(adminErrorCode(refused)).toBe('ADMIN_AUTH_RATE_LIMITED');
    expect(Number(refused.headers['retry-after'])).toBeGreaterThanOrEqual(1);
  });

  it('applies the TOTP request quota before the body is read', async () => {
    let last = 0;
    for (let index = 0; index < 31; index += 1) {
      const response = await app.call('POST', '/totp/verify', { rawBody: '{not json', csrf: 'x' });
      last = response.status;
    }
    expect(last).toBe(429);
  });

  it('keeps the locks across an application restart (state lives in PostgreSQL)', async () => {
    for (let index = 0; index < 10; index += 1) {
      await app.call('POST', '/login', { body: loginBody(system, { password: 'Wrong-Password-1' }) });
      if (index === 4) {
        await app.pool.query(`DELETE FROM app.admin_auth_limits WHERE kind = 'LOGIN_REQUEST_IP'`);
      }
    }
    expect(await count(app.pool, `SELECT 1 FROM app.admin_auth_limits WHERE locked_until > now()`)).toBeGreaterThan(0);
    const previous = app;
    await previous.running.app.close();
    await previous.pool.end();
    app = await startAdminApp({ keepLimits: true });
    app.track(system.phone.normalized);
    const locked = await app.call('POST', '/login', { body: loginBody(system) });
    expect(locked.status).toBe(429);
  });
});
