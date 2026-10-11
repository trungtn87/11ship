import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { ADMIN_SESSION_COOKIE } from '../../apps/backend/src/admin-auth/admin-auth-constants';
import {
  AdminApp,
  adminData,
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

// M01-D-LOGIN - supersession exactly as the contract states it:
//  * factor NOT active: a new login supersedes the older preauth step and removes its pending generation;
//  * factor ACTIVE: a new login does NOT cancel the other live steps (two tabs), the TOTP replay guard still allows each
//    step's code once, and only a SUCCESSFUL second factor revokes the older session;
//  * a failed login or a failed code never touches a session.
describe('M01-D-LOGIN - supersession, two tabs and TOTP replay', () => {
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

  interface LiveChallenge {
    challenge_id: string;
    factor_id: string | null;
    attempt_count: number;
  }

  async function liveChallenges(): Promise<LiveChallenge[]> {
    const result = await app.pool.query<LiveChallenge>(
      `SELECT challenge_id, factor_id, attempt_count FROM app.admin_auth_challenges
        WHERE user_id = $1::uuid AND consumed_at IS NULL ORDER BY created_at, challenge_id`,
      [system.userId],
    );
    return result.rows;
  }

  async function sessionRows(): Promise<Array<{ session_id: string; revoked: boolean }>> {
    const result = await app.pool.query<{ session_id: string; revoked: boolean }>(
      `SELECT session_id, revoked_at IS NOT NULL AS revoked FROM app.admin_sessions
        WHERE user_id = $1::uuid ORDER BY created_at, session_id`,
      [system.userId],
    );
    return result.rows;
  }

  async function activeFactorId(): Promise<string> {
    const result = await app.pool.query<{ factor_id: string }>(
      `SELECT factor_id FROM app.admin_totp_factors WHERE user_id = $1::uuid AND state = 'ACTIVE'`,
      [system.userId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error('no ACTIVE factor');
    }
    return row.factor_id;
  }

  const meWith = (cookie: string) => app.call('GET', '/me', { cookies: { [ADMIN_SESSION_COOKIE]: cookie } });

  function sessionCookieOf(response: Awaited<ReturnType<AdminApp['call']>>): string {
    const cookie = cookieFrom(response, ADMIN_SESSION_COOKIE);
    if (cookie === undefined || cookie === '') {
      throw new Error(`no session cookie in the response (status ${String(response.status)})`);
    }
    return cookie;
  }

  describe('factor not ACTIVE yet', () => {
    it('a new login supersedes the older step, deletes its pending generation and invalidates the old QR code', async () => {
      const tabOne = await loginStep(app, system);
      const startedOne = await app.call('POST', '/totp/enrollment', {
        body: {},
        cookies: preauthCookies(tabOne),
        csrf: tabOne.csrf,
      });
      expect(startedOne.status).toBe(200);
      const secretOne = String(adminData(startedOne).secret);
      const generationOne = await app.pool.query<{ factor_id: string }>(
        'SELECT factor_id FROM app.admin_totp_factors WHERE user_id = $1::uuid',
        [system.userId],
      );
      expect(generationOne.rows).toHaveLength(1);
      const factorIdOne = generationOne.rows[0]?.factor_id;

      const tabTwo = await loginStep(app, system);
      expect(tabTwo.nextStep).toBe('ENROLL_TOTP');

      // Only the new step is live; the pending generation of the superseded step is gone; no session exists.
      expect(await liveChallenges()).toHaveLength(1);
      expect(await count(app.pool, 'SELECT 1 FROM app.admin_totp_factors WHERE user_id = $1::uuid', [system.userId])).toBe(0);
      expect(await sessionRows()).toEqual([]);

      // The old tab is dead for every call.
      const staleStart = await app.call('POST', '/totp/enrollment', {
        body: {},
        cookies: preauthCookies(tabOne),
        csrf: tabOne.csrf,
      });
      expect(staleStart.status).toBe(401);
      expect(adminErrorCode(staleStart)).toBe('ADMIN_PREAUTH_INVALID');
      const staleVerify = await app.call('POST', '/totp/enrollment/verify', {
        body: { code: totpNow(secretOne) },
        cookies: preauthCookies(tabOne),
        csrf: tabOne.csrf,
      });
      expect(staleVerify.status).toBe(401);
      expect(adminErrorCode(staleVerify)).toBe('ADMIN_PREAUTH_INVALID');
      expect(cookieFrom(staleVerify, ADMIN_SESSION_COOKIE)).toBeUndefined();
      const staleState = await app.call('GET', '/state', { cookies: preauthCookies(tabOne) });
      expect(staleState.status).toBe(401);
      expect(adminErrorCode(staleState)).toBe('ADMIN_PREAUTH_INVALID');

      // The new tab gets a NEW generation: new factor id, version 1, a different secret.
      const startedTwo = await app.call('POST', '/totp/enrollment', {
        body: {},
        cookies: preauthCookies(tabTwo),
        csrf: tabTwo.csrf,
      });
      expect(startedTwo.status).toBe(200);
      const secretTwo = String(adminData(startedTwo).secret);
      expect(secretTwo).not.toBe(secretOne);
      const generationTwo = await app.pool.query<{ factor_id: string; state: string; version: number }>(
        'SELECT factor_id, state, version::int AS version FROM app.admin_totp_factors WHERE user_id = $1::uuid',
        [system.userId],
      );
      expect(generationTwo.rows).toHaveLength(1);
      expect(generationTwo.rows[0]?.state).toBe('PENDING');
      expect(generationTwo.rows[0]?.version).toBe(1);
      expect(generationTwo.rows[0]?.factor_id).not.toBe(factorIdOne);

      // The old QR code (secret one) does not complete the new generation; the new one does.
      const oldCode = await app.call('POST', '/totp/enrollment/verify', {
        body: { code: totpNow(secretOne) },
        cookies: preauthCookies(tabTwo),
        csrf: tabTwo.csrf,
      });
      expect(oldCode.status).toBe(400);
      expect(adminErrorCode(oldCode)).toBe('ADMIN_TOTP_INVALID');
      const done = await app.call('POST', '/totp/enrollment/verify', {
        body: { code: totpNow(secretTwo) },
        cookies: preauthCookies(tabTwo),
        csrf: tabTwo.csrf,
      });
      expect(done.status).toBe(200);
      expect((await meWith(sessionCookieOf(done))).status).toBe(200);
    });
  });

  describe('factor ACTIVE', () => {
    it('a new login does NOT cancel the other live step; each tab completes once with its own TOTP step', async () => {
      const first = await enrollAndLogin(app, system);
      await rewindAcceptedStep(app, system.userId);
      const factorId = await activeFactorId();

      const tabA = await loginStep(app, system);
      const tabB = await loginStep(app, system);
      expect(tabA.nextStep).toBe('VERIFY_TOTP');
      expect(tabB.nextStep).toBe('VERIFY_TOTP');

      // Both steps are live and both snapshot the ACTIVE factor; the first session was not touched by either login.
      const live = await liveChallenges();
      expect(live).toHaveLength(2);
      expect(live.map((row) => row.factor_id)).toEqual([factorId, factorId]);
      for (const tab of [tabA, tabB]) {
        const state = await app.call('GET', '/state', { cookies: preauthCookies(tab) });
        expect(state.status).toBe(200);
        expect(adminData(state)).toMatchObject({ state: 'PREAUTH', next_step: 'VERIFY_TOTP' });
      }
      expect((await meWith(first.cookie)).status).toBe(200);

      // Tab A completes with the previous step's code. Only this SUCCESS revokes the older session.
      const codeA = totpNow(first.secret, -1);
      const verifiedA = await app.call('POST', '/totp/verify', {
        body: { code: codeA },
        cookies: preauthCookies(tabA),
        csrf: tabA.csrf,
      });
      expect(verifiedA.status).toBe(200);
      const cookieA = sessionCookieOf(verifiedA);
      expect((await meWith(first.cookie)).status).toBe(401);
      expect((await meWith(cookieA)).status).toBe(200);

      // Replay across challenges: the same code on tab B is refused, and the refusal changes no session.
      const replay = await app.call('POST', '/totp/verify', {
        body: { code: codeA },
        cookies: preauthCookies(tabB),
        csrf: tabB.csrf,
      });
      expect(replay.status).toBe(400);
      expect(adminErrorCode(replay)).toBe('ADMIN_TOTP_INVALID');
      expect(cookieFrom(replay, ADMIN_SESSION_COOKIE)).toBeUndefined();
      expect((await meWith(cookieA)).status).toBe(200);
      const afterReplay = await liveChallenges();
      expect(afterReplay).toHaveLength(1);
      expect(afterReplay[0]?.attempt_count).toBe(1);

      // Tab B completes with the CURRENT step's code, a later step than tab A used.
      const verifiedB = await app.call('POST', '/totp/verify', {
        body: { code: totpNow(first.secret, 0) },
        cookies: preauthCookies(tabB),
        csrf: tabB.csrf,
      });
      expect(verifiedB.status).toBe(200);
      const cookieB = sessionCookieOf(verifiedB);
      expect((await meWith(cookieA)).status).toBe(401);
      expect((await meWith(cookieB)).status).toBe(200);

      // Exactly one live session remains, and a used step cannot be used again.
      const sessions = await sessionRows();
      expect(sessions).toHaveLength(3);
      expect(sessions.filter((row) => !row.revoked)).toHaveLength(1);
      const reuse = await app.call('POST', '/totp/verify', {
        body: { code: totpNow(first.secret, 0) },
        cookies: preauthCookies(tabA),
        csrf: tabA.csrf,
      });
      expect(reuse.status).toBe(401);
      expect(adminErrorCode(reuse)).toBe('ADMIN_PREAUTH_INVALID');
    });

    it('a failed login or a failed code never touches a session or a live step', async () => {
      const first = await enrollAndLogin(app, system);
      const live = await loginStep(app, system);
      const before = { sessions: await sessionRows(), challenges: await liveChallenges() };

      const wrongPassword = await app.call('POST', '/login', { body: loginBody(system, { password: 'Wrong-Password-1' }) });
      expect(wrongPassword.status).toBe(401);
      expect(adminErrorCode(wrongPassword)).toBe('INVALID_CREDENTIALS');
      const unknownPhone = await app.call('POST', '/login', { body: { ...loginBody(system), phone: '0900000001' } });
      expect(unknownPhone.status).toBe(401);
      expect(await sessionRows()).toEqual(before.sessions);
      expect(await liveChallenges()).toEqual(before.challenges);
      expect((await meWith(first.cookie)).status).toBe(200);
      expect((await app.call('GET', '/state', { cookies: preauthCookies(live) })).status).toBe(200);

      // A wrong code costs the step one attempt and revokes nothing.
      const wrong = await app.call('POST', '/totp/verify', {
        body: { code: wrongCode(first.secret) },
        cookies: preauthCookies(live),
        csrf: live.csrf,
      });
      expect(wrong.status).toBe(400);
      expect(await sessionRows()).toEqual(before.sessions);
      expect((await meWith(first.cookie)).status).toBe(200);
      const afterWrong = await liveChallenges();
      expect(afterWrong).toHaveLength(1);
      expect(afterWrong[0]?.attempt_count).toBe(1);
    });

    it('a correct password alone hands out a step and revokes no session', async () => {
      const first = await enrollAndLogin(app, system);
      const step = await loginStep(app, system);
      expect(step.nextStep).toBe('VERIFY_TOTP');
      expect((await meWith(first.cookie)).status).toBe(200);
      expect((await sessionRows()).filter((row) => !row.revoked)).toHaveLength(1);
    });
  });
});
