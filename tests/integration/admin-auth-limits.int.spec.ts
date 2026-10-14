import { randomBytes } from 'node:crypto';
import { AdminLimitsRepository } from '../../apps/backend/src/admin-auth/admin-limits-repository';
import { TransactionManager } from '../../apps/backend/src/transaction/transaction-manager';
import { deferred, eventually } from './support/async-helpers';
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

  it('keeps an overtaken request clock monotonic without losing a quota slot', async () => {
    const key = randomBytes(32).toString('hex');
    const first = await app.pool.connect();
    const repository = app.running.app.get(AdminLimitsRepository);
    const manager = app.running.app.get(TransactionManager);
    const ready = deferred<number>();
    let pending: Promise<unknown> | undefined;
    try {
      await first.query('BEGIN');
      await first.query(`WITH clock AS (SELECT date_trunc('milliseconds', clock_timestamp()) AS t)
        INSERT INTO app.admin_auth_limits (bucket_key, kind, window_started_at, failure_count, updated_at)
        SELECT $1, 'LOGIN_REQUEST_IP', t, 1, t FROM clock`, [key]);
      pending = manager.withTransaction(async (context) => {
        const pid = await context.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
        ready.resolve(pid.rows[0]?.pid as number);
        return repository.reserveRequest(context, { bucketKey: key, kind: 'LOGIN_REQUEST_IP', limit: 2, windowSeconds: 60 });
      });
      // Observe the real conflicting insert waiting after it has evaluated its own clock.
      void pending.catch((error: unknown) => ready.reject(error));
      const pid = await ready.promise;
      await eventually(async () => {
        const row = await app.pool.query<{ waiting: boolean }>(
          "SELECT wait_event_type = 'Lock' AS waiting FROM pg_stat_activity WHERE pid = $1", [pid]);
        return row.rows[0]?.waiting === true;
      }, 'request reservation waits for the first bucket insert');
      // Advance the DB clock beyond its millisecond precision, after the lock wait was observed.
      await first.query('SELECT pg_sleep(0.01)');
      // The winner publishes a window newer than the waiter's already captured statement clock.
      await first.query(`WITH clock AS (SELECT date_trunc('milliseconds', clock_timestamp()) AS t)
        UPDATE app.admin_auth_limits SET window_started_at = t, updated_at = t FROM clock WHERE bucket_key = $1`, [key]);
      await first.query('COMMIT');
      expect(await pending).toEqual({ allowed: true, retryAfterSeconds: 0 });
      const row = await app.pool.query<{ failure_count: number; ordered: boolean }>(
        'SELECT failure_count, updated_at >= window_started_at AS ordered FROM app.admin_auth_limits WHERE bucket_key = $1', [key]);
      expect(row.rows[0]).toEqual({ failure_count: 2, ordered: true });
      const refused = await manager.withTransaction((context) =>
        repository.reserveRequest(context, { bucketKey: key, kind: 'LOGIN_REQUEST_IP', limit: 2, windowSeconds: 60 }));
      expect(refused.allowed).toBe(false);
      expect(refused.retryAfterSeconds).toBeGreaterThanOrEqual(1);
      expect(refused.retryAfterSeconds).toBeLessThanOrEqual(60);
    } finally {
      await first.query('ROLLBACK');
      first.release();
      await pending?.catch(() => undefined);
    }
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

  it('reserves the TOTP request quota (30 per minute per address) before any cookie or code is looked at', async () => {
    let last = 0;
    for (let index = 0; index < 31; index += 1) {
      const response = await app.call('POST', '/totp/verify', { body: { code: '123456' }, csrf: 'x' });
      last = response.status;
      if (index < 30) {
        expect(response.status).toBe(401);
      }
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
