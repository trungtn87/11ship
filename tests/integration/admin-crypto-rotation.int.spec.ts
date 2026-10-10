import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { Keyring } from '../../apps/backend/src/crypto/keyring';
import { FIXTURE_MASTER_K2 } from '../../apps/backend/src/crypto/test-keys.fixture';
import {
  AdminApp,
  adminData,
  adminErrorCode,
  count,
  createSystem,
  enrollAndLogin,
  loginBody,
  loginStep,
  preauthCookies,
  rewindAcceptedStep,
  sessionCookies,
  startAdminApp,
  StartAdminOptions,
  SystemAccount,
  totpNow,
  wrongCode,
} from './support/admin-fixtures';

// M01-D-LOGIN - rotation of the CRYPTO active key.
//  * Historical keys kept: an old factor (sealed under k1), an old step and an old session (bound under k1) keep working
//    after k2 becomes active, new credentials are bound to k2, and the limiter (budgets and locks) does not move at all:
//    it is keyed by its OWN secret (ADMIN_RATE_LIMIT_HMAC_KEY), not by the CRYPTO keyring.
//  * A historical key missing: every credential that needs it fails closed with the admin boundary's 503, and nothing
//    falls back to the new key.
describe('M01-D-LOGIN - CRYPTO key rotation and a missing historical key', () => {
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

  // Every case ends on the default configuration again (k1 active, both fixture keys), whatever happened inside it.
  afterEach(async () => {
    await restart({});
  });

  /** Stops the application WITHOUT purging data and starts it again with another keyring; the limiter state is kept. */
  async function restart(options: StartAdminOptions): Promise<void> {
    const previous = app;
    await previous.running.app.close();
    await previous.pool.end();
    app = await startAdminApp({ ...options, keepLimits: true });
    app.track(system.phone.normalized);
  }

  interface LimiterRow {
    bucket_key: string;
    kind: string;
    window_started_at: Date;
    failure_count: number;
    locked_until: Date | null;
    updated_at: Date;
  }

  async function limiterRows(kind?: string): Promise<LimiterRow[]> {
    const result = await app.pool.query<LimiterRow>(
      `SELECT bucket_key, kind, window_started_at, failure_count, locked_until, updated_at
         FROM app.admin_auth_limits WHERE ($1::text IS NULL OR kind = $1::text) ORDER BY bucket_key`,
      [kind ?? null],
    );
    return result.rows;
  }

  it('old factor, step and session keep working after the active key changes; new credentials use the new key; no limiter state moves', async () => {
    const first = await enrollAndLogin(app, system);
    await rewindAcceptedStep(app, system.userId);
    const step = await loginStep(app, system);

    // Limiter state worth keeping: 3 wrong passwords (phone and address budgets) and 2 wrong codes (TOTP budget).
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const wrong = await app.call('POST', '/login', { body: loginBody(system, { password: 'Wrong-Password-1' }) });
      expect(wrong.status).toBe(401);
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const wrong = await app.call('POST', '/totp/verify', {
        body: { code: wrongCode(first.secret) },
        cookies: preauthCookies(step),
        csrf: step.csrf,
      });
      expect(wrong.status).toBe(400);
    }
    const limiterBefore = await limiterRows();
    expect(limiterBefore.find((row) => row.kind === 'LOGIN_PHONE')?.failure_count).toBe(3);
    expect(limiterBefore.find((row) => row.kind === 'TOTP_USER')?.failure_count).toBe(2);
    const factorBefore = await app.pool.query<{ key_id: string; factor_id: string; version: number }>(
      'SELECT key_id, factor_id, version::int AS version FROM app.admin_totp_factors WHERE user_id = $1::uuid',
      [system.userId],
    );
    expect(factorBefore.rows[0]?.key_id).toBe('k1');

    await restart({ activeKeyId: 'k2' });

    // The old session still works and shows the SAME CSRF token (derived from its stored nonce and its own key k1).
    const me = await app.call('GET', '/me', { cookies: sessionCookies(first) });
    expect(me.status).toBe(200);
    expect(String(adminData(me).csrf_token)).toBe(first.csrf);
    // Nothing of the limiter moved: not at the restart, not by this read.
    expect(await limiterRows()).toEqual(limiterBefore);

    // The old step completes: its CSRF token is checked and its factor is opened with the HISTORICAL key.
    const verified = await app.call('POST', '/totp/verify', {
      body: { code: totpNow(first.secret) },
      cookies: preauthCookies(step),
      csrf: step.csrf,
    });
    expect(verified.status).toBe(200);
    const sessions = await app.pool.query<{ csrf_key_id: string; password_key_id: string; revoked: boolean }>(
      `SELECT csrf_key_id, password_key_id, revoked_at IS NOT NULL AS revoked FROM app.admin_sessions
        WHERE user_id = $1::uuid ORDER BY created_at, session_id`,
      [system.userId],
    );
    expect(sessions.rows).toEqual([
      { csrf_key_id: 'k1', password_key_id: 'k1', revoked: true },
      { csrf_key_id: 'k2', password_key_id: 'k2', revoked: false },
    ]);
    // The factor generation is untouched by the rotation: same key, same id, same version (no re-encryption here).
    const factorAfter = await app.pool.query<{ key_id: string; factor_id: string; version: number }>(
      'SELECT key_id, factor_id, version::int AS version FROM app.admin_totp_factors WHERE user_id = $1::uuid',
      [system.userId],
    );
    expect(factorAfter.rows).toEqual(factorBefore.rows);

    // A login after the rotation is bound to the new key, and the budgets simply continue (not reset).
    await loginStep(app, system);
    const newest = await app.pool.query<{ csrf_key_id: string; password_key_id: string }>(
      `SELECT csrf_key_id, password_key_id FROM app.admin_auth_challenges
        WHERE user_id = $1::uuid ORDER BY created_at DESC, challenge_id LIMIT 1`,
      [system.userId],
    );
    expect(newest.rows[0]).toEqual({ csrf_key_id: 'k2', password_key_id: 'k2' });
    const wrongAgain = await app.call('POST', '/login', { body: loginBody(system, { password: 'Wrong-Password-1' }) });
    expect(wrongAgain.status).toBe(401);
    expect((await limiterRows('LOGIN_PHONE'))[0]?.failure_count).toBe(4);
  });

  it('a lock set before the rotation is still in force afterwards, unchanged', async () => {
    const first = await enrollAndLogin(app, system);
    const lockingStep = await loginStep(app, system);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const wrong = await app.call('POST', '/totp/verify', {
        body: { code: wrongCode(first.secret) },
        cookies: preauthCookies(lockingStep),
        csrf: lockingStep.csrf,
      });
      expect(wrong.status).toBe(attempt < 5 ? 400 : 429);
    }
    const lockedBefore = await limiterRows('TOTP_USER');
    expect(lockedBefore).toHaveLength(1);
    expect(lockedBefore[0]?.locked_until).not.toBeNull();

    await restart({ activeKeyId: 'k2' });

    // A correct password still gets a step (decision Q1); the lock decides at verify, with the same end time.
    const next = await loginStep(app, system);
    await rewindAcceptedStep(app, system.userId);
    const refused = await app.call('POST', '/totp/verify', {
      body: { code: totpNow(first.secret) },
      cookies: preauthCookies(next),
      csrf: next.csrf,
    });
    expect(refused.status).toBe(429);
    expect(adminErrorCode(refused)).toBe('ADMIN_AUTH_RATE_LIMITED');
    expect(await limiterRows('TOTP_USER')).toEqual(lockedBefore);
  });

  it('without the historical key every old credential fails closed with 503, and nothing falls back to the new key', async () => {
    const first = await enrollAndLogin(app, system);
    await rewindAcceptedStep(app, system.userId);
    const step = await loginStep(app, system);
    const totpBefore = await limiterRows('TOTP_USER');

    // Only k2 is left: k1, which sealed the factor and bound the old credentials, is gone.
    await restart({ keyring: new Keyring([{ id: 'k2', master: FIXTURE_MASTER_K2 }], 'k2') });

    const me = await app.call('GET', '/me', { cookies: sessionCookies(first) });
    expect(me.status).toBe(503);
    expect(adminErrorCode(me)).toBe('SERVICE_UNAVAILABLE');
    expect(me.body.data).toBeUndefined();

    const state = await app.call('GET', '/state', { cookies: preauthCookies(step) });
    expect(state.status).toBe(503);
    expect(adminErrorCode(state)).toBe('SERVICE_UNAVAILABLE');

    const oldStep = await app.call('POST', '/totp/verify', {
      body: { code: totpNow(first.secret) },
      cookies: preauthCookies(step),
      csrf: step.csrf,
    });
    expect(oldStep.status).toBe(503);
    expect(adminErrorCode(oldStep)).toBe('SERVICE_UNAVAILABLE');
    expect(oldStep.setCookie).toEqual([]);

    // A new login is bound to the ACTIVE key k2, so a step is handed out; but its code cannot be checked, because the
    // factor is sealed under the missing key: refused with 503, and nothing is created, charged or activated.
    const next = await loginStep(app, system);
    const newStep = await app.call('POST', '/totp/verify', {
      body: { code: totpNow(first.secret) },
      cookies: preauthCookies(next),
      csrf: next.csrf,
    });
    expect(newStep.status).toBe(503);
    expect(adminErrorCode(newStep)).toBe('SERVICE_UNAVAILABLE');
    expect(newStep.setCookie).toEqual([]);

    expect(await count(app.pool, 'SELECT 1 FROM app.admin_sessions WHERE user_id = $1::uuid', [system.userId])).toBe(1);
    expect(
      await count(app.pool, 'SELECT 1 FROM app.admin_sessions WHERE user_id = $1::uuid AND revoked_at IS NULL', [system.userId]),
    ).toBe(1);
    const attempts = await app.pool.query<{ attempt_count: number }>(
      `SELECT attempt_count FROM app.admin_auth_challenges
        WHERE user_id = $1::uuid AND consumed_at IS NULL ORDER BY created_at, challenge_id`,
      [system.userId],
    );
    expect(attempts.rows.map((row) => row.attempt_count)).toEqual([0, 0]);
    expect(await limiterRows('TOTP_USER')).toEqual(totpBefore);
  });
});
