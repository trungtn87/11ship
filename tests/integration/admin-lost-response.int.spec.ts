import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { ADMIN_AUDIT_ACTIONS, ADMIN_SESSION_COOKIE } from '../../apps/backend/src/admin-auth/admin-auth-constants';
import {
  AdminApp,
  adminData,
  adminErrorCode,
  cookieFrom,
  count,
  createSystem,
  enrollAndLogin,
  loginStep,
  preauthCookies,
  rewindAcceptedStep,
  sessionCookies,
  startAdminApp,
  SystemAccount,
  totpNow,
} from './support/admin-fixtures';

// M01-D-LOGIN - the response is lost AFTER the server committed.
// The browser never sees the 200 (no session cookie arrives), so it retries the very same request. The contract:
//  * the retry is refused as a consumed step (401 ADMIN_PREAUTH_INVALID), never replayed: no second session, no second
//    audit row, the factor is not activated again (same generation, same version);
//  * the user continues from the password step: a new login hands out a new step, and the TOTP replay guard makes the
//    code of the already used 30-second step wait for the next step.
describe('M01-D-LOGIN - lost response after commit', () => {
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

  const auditCount = (action: string) =>
    count(app.pool, 'SELECT 1 FROM app.audit_logs WHERE action = $1 AND actor_id = $2', [action, system.userId]);

  const sessionCount = () => count(app.pool, 'SELECT 1 FROM app.admin_sessions WHERE user_id = $1::uuid', [system.userId]);

  async function factorRows(): Promise<Array<{ factor_id: string; state: string; version: number; last_accepted_step: string }>> {
    const result = await app.pool.query<{ factor_id: string; state: string; version: number; last_accepted_step: string }>(
      `SELECT factor_id, state, version::int AS version, last_accepted_step::text AS last_accepted_step
         FROM app.admin_totp_factors WHERE user_id = $1::uuid`,
      [system.userId],
    );
    return result.rows;
  }

  it('enrollment verify: the retry creates no second session or audit row and does not activate the factor again', async () => {
    const preauth = await loginStep(app, system);
    const started = await app.call('POST', '/totp/enrollment', { body: {}, cookies: preauthCookies(preauth), csrf: preauth.csrf });
    expect(started.status).toBe(200);
    const secret = String(adminData(started).secret);
    const code = totpNow(secret);

    // The server commits; the client "loses" this response and keeps nothing from it.
    const lost = await app.call('POST', '/totp/enrollment/verify', { body: { code }, cookies: preauthCookies(preauth), csrf: preauth.csrf });
    expect(lost.status).toBe(200);
    const afterCommit = {
      factors: await factorRows(),
      sessions: await sessionCount(),
      enrolled: await auditCount(ADMIN_AUDIT_ACTIONS.totpEnrolled),
      completed: await auditCount(ADMIN_AUDIT_ACTIONS.loginCompleted),
    };
    expect(afterCommit.factors).toHaveLength(1);
    expect(afterCommit.factors[0]?.state).toBe('ACTIVE');
    expect(afterCommit.sessions).toBe(1);
    expect(afterCommit.enrolled).toBe(1);
    expect(afterCommit.completed).toBe(1);

    // The retry of the same request (same cookie, same CSRF token, same code).
    const retry = await app.call('POST', '/totp/enrollment/verify', { body: { code }, cookies: preauthCookies(preauth), csrf: preauth.csrf });
    expect(retry.status).toBe(401);
    expect(adminErrorCode(retry)).toBe('ADMIN_PREAUTH_INVALID');
    expect(cookieFrom(retry, ADMIN_SESSION_COOKIE)).toBeUndefined();
    // Starting the enrollment again with the consumed step cannot touch the active factor either.
    const restart = await app.call('POST', '/totp/enrollment', { body: {}, cookies: preauthCookies(preauth), csrf: preauth.csrf });
    expect(restart.status).toBe(401);

    expect(await factorRows()).toEqual(afterCommit.factors);
    expect(await sessionCount()).toBe(afterCommit.sessions);
    expect(await auditCount(ADMIN_AUDIT_ACTIONS.totpEnrolled)).toBe(afterCommit.enrolled);
    expect(await auditCount(ADMIN_AUDIT_ACTIONS.loginCompleted)).toBe(afterCommit.completed);

    // Continuing: the authenticator already holds the secret, so the user logs in again and verifies with a code of a
    // later 30-second step. (The real-clock wait for that step is the next test; here the accepted step is moved back.)
    const next = await loginStep(app, system);
    expect(next.nextStep).toBe('VERIFY_TOTP');
    const sameStepCode = await app.call('POST', '/totp/verify', { body: { code }, cookies: preauthCookies(next), csrf: next.csrf });
    expect(sameStepCode.status).toBe(400);
    expect(adminErrorCode(sameStepCode)).toBe('ADMIN_TOTP_INVALID');
    await rewindAcceptedStep(app, system.userId);
    const continued = await app.call('POST', '/totp/verify', { body: { code }, cookies: preauthCookies(next), csrf: next.csrf });
    expect(continued.status).toBe(200);
    const cookie = cookieFrom(continued, ADMIN_SESSION_COOKIE);
    expect(cookie).toBeTruthy();
    expect((await app.call('GET', '/me', { cookies: { [ADMIN_SESSION_COOKIE]: String(cookie) } })).status).toBe(200);
  });

  it('verify: the retry creates no second session or audit row; a new login continues once the next TOTP step starts (real clock)', async () => {
    const first = await enrollAndLogin(app, system);
    const step = await loginStep(app, system);
    // Let the TOTP step used by the enrollment pass, in real time, so the lost verify below uses a genuinely later step.
    const periodMs = 30_000;
    const untilNextStep = periodMs - (Date.now() % periodMs) + 250;
    await new Promise((resolve) => setTimeout(resolve, untilNextStep));
    const code = totpNow(first.secret);

    const lost = await app.call('POST', '/totp/verify', { body: { code }, cookies: preauthCookies(step), csrf: step.csrf });
    expect(lost.status).toBe(200);
    const before = {
      factors: await factorRows(),
      sessions: await sessionCount(),
      completed: await auditCount(ADMIN_AUDIT_ACTIONS.loginCompleted),
    };
    expect(before.sessions).toBe(2);
    expect(before.completed).toBe(2);

    const retry = await app.call('POST', '/totp/verify', { body: { code }, cookies: preauthCookies(step), csrf: step.csrf });
    expect(retry.status).toBe(401);
    expect(adminErrorCode(retry)).toBe('ADMIN_PREAUTH_INVALID');
    expect(retry.setCookie).toEqual([]);
    expect(await factorRows()).toEqual(before.factors);
    expect(await sessionCount()).toBe(before.sessions);
    expect(await auditCount(ADMIN_AUDIT_ACTIONS.loginCompleted)).toBe(before.completed);

    // The session of the lost response exists server side (the user simply never received its cookie); the user
    // continues with a new password step. The used step's code is refused (replay guard) ...
    const next = await loginStep(app, system);
    const replay = await app.call('POST', '/totp/verify', { body: { code }, cookies: preauthCookies(next), csrf: next.csrf });
    expect(replay.status).toBe(400);
    expect(adminErrorCode(replay)).toBe('ADMIN_TOTP_INVALID');
    expect(await sessionCount()).toBe(before.sessions);

    // ... and the code of the following step completes it, in real time.
    const wait = periodMs - (Date.now() % periodMs) + 250;
    await new Promise((resolve) => setTimeout(resolve, wait));
    const continued = await app.call('POST', '/totp/verify', {
      body: { code: totpNow(first.secret) },
      cookies: preauthCookies(next),
      csrf: next.csrf,
    });
    expect(continued.status).toBe(200);
    expect(await sessionCount()).toBe(before.sessions + 1);
    // Only the newest session is live; the one nobody received a cookie for was revoked by this successful second factor.
    expect(
      await count(app.pool, 'SELECT 1 FROM app.admin_sessions WHERE user_id = $1::uuid AND revoked_at IS NULL', [system.userId]),
    ).toBe(1);
    expect((await app.call('GET', '/me', { cookies: sessionCookies(first) })).status).toBe(401);
  }, 120_000);
});
