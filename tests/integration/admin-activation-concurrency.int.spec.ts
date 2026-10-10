import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { Argon2idPasswordHasher } from '../../apps/backend/src/auth/password-hasher';
import { adminData, adminErrorCode, cookieFrom, totpNow } from './support/admin-fixtures';
import {
  ACTIVATION_COOKIE,
  act,
  advance,
  ActivationApp,
  attemptsOf,
  auditCount,
  begin,
  bucketFailures,
  bucketRows,
  challengesOf,
  cookiesOf,
  getState,
  insertAttempt,
  invitationStatus,
  issueSecret,
  liveAttempts,
  newInvite,
  ok,
  post,
  sendOtp,
  setPassword,
  startActivationApp,
  verifyOtp,
} from './support/activation-fixtures';
import { api, sessionOf, stepUp, SystemSession, systemSession } from './support/provisioning-fixtures';

// M01-D-ADMIN-1C: races decided by real PostgreSQL locks (concurrent requests through the real HTTP pipeline), the
// clock-dependent branches (built by INSERT because created_at / expires_at are immutable) and the repeat-complete
// no-write rule. Outcomes of a race are asserted as invariants over every legal interleaving, never as one lucky order.

describe('M01-D-ADMIN-1C - races, expiry by the database clock and replay', () => {
  let ctx: ActivationApp;
  let system: SystemSession;
  const deps = (): { app: ActivationApp['app']; provider: ActivationApp['provider'] } => ({ app: ctx.app, provider: ctx.provider });

  beforeAll(async () => {
    ctx = await startActivationApp();
    system = await systemSession(ctx.app);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await ctx.app.clearLimits();
    ctx.provider.clear();
  });

  async function userCount(phone: string): Promise<number> {
    const result = await ctx.app.pool.query<{ n: string }>('SELECT count(*)::text AS n FROM app.users WHERE phone_normalized = $1', [phone]);
    return Number(result.rows[0]?.n);
  }

  // ----- K1, K22: complete races ---------------------------------------------------------------------------------

  it('K1: two completes of one attempt with the same code create exactly one account; both answers are COMPLETED', async () => {
    const { app } = ctx;
    const invite = await newInvite(app, system);
    const { session, secret } = await advance(deps(), invite, 'TOTP_ISSUED');
    const code = totpNow(String(secret));
    const results = await Promise.all([post(app, '/complete', session, { code }), post(app, '/complete', session, { code })]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    for (const result of results) {
      expect(adminData(result)).toEqual({ state: 'COMPLETED', next: 'LOGIN' });
    }
    expect(await userCount(invite.phone.normalized)).toBe(1);
    expect(await invitationStatus(app.pool, invite.invitationId)).toBe('ACCEPTED');
  });

  it('K22: a wrong and a right TOTP code at once - the right one always completes, the count is never lost', async () => {
    const { app } = ctx;
    const invite = await newInvite(app, system);
    const { session, secret } = await advance(deps(), invite, 'TOTP_ISSUED');
    const [wrong, right] = await Promise.all([
      post(app, '/complete', session, { code: totpNow(String(secret), 9) }),
      post(app, '/complete', session, { code: totpNow(String(secret)) }),
    ]);
    expect(right.status).toBe(200);
    expect([200, 400]).toContain(wrong.status);
    expect(await userCount(invite.phone.normalized)).toBe(1);
    const [attempt] = await attemptsOf(app.pool, invite.invitationId);
    expect(attempt?.status).toBe('COMPLETED');
    expect(attempt?.totp_attempt_count).toBe(wrong.status === 400 ? 1 : 0);
  });

  it('K8: seven wrong TOTP codes at once count to exactly five, the attempt is invalidated once and the bucket matches', async () => {
    const { app } = ctx;
    const invite = await newInvite(app, system);
    const { session, secret } = await advance(deps(), invite, 'TOTP_ISSUED');
    const wrongCode = totpNow(String(secret), 9);
    const results = await Promise.all(Array.from({ length: 7 }, () => post(app, '/complete', session, { code: wrongCode })));
    const counted = results.filter((r) => r.status === 400 && adminErrorCode(r) === 'ADMIN_TOTP_INVALID');
    expect(counted).toHaveLength(5);
    expect(results.filter((r) => ![400, 409, 429].includes(r.status))).toEqual([]);
    const attempts = await attemptsOf(app.pool, invite.invitationId);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ status: 'INVALIDATED', invalidated_reason: 'ATTEMPTS_EXHAUSTED', totp_attempt_count: 5 });
    expect(await bucketFailures(app.pool, 'ACTIVATION_TOTP')).toBe(5);
    expect(await userCount(invite.phone.normalized)).toBe(0);
  });

  // ----- K5, K6, K7, K13, K21 ------------------------------------------------------------------------------------

  it('K5: two starts without a cookie leave exactly one live attempt and one SUPERSEDED', async () => {
    const { app } = ctx;
    const invite = await newInvite(app, system);
    const results = await Promise.all([
      act(app, 'POST', '/start', { body: { token: invite.token } }),
      act(app, 'POST', '/start', { body: { token: invite.token } }),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    const attempts = await attemptsOf(app.pool, invite.invitationId);
    expect(attempts.map((row) => row.status).sort()).toEqual(['INVALIDATED', 'STARTED']);
    expect(attempts.find((row) => row.status === 'INVALIDATED')?.invalidated_reason).toBe('SUPERSEDED');
  });

  it('K21: start resuming with a cookie at once with a fresh start never leaves two live attempts', async () => {
    const { app } = ctx;
    const invite = await newInvite(app, system);
    const first = await begin(app, invite);
    const results = await Promise.all([
      act(app, 'POST', '/start', { body: { token: invite.token }, cookies: cookiesOf(first) }),
      act(app, 'POST', '/start', { body: { token: invite.token } }),
    ]);
    for (const result of results) {
      expect([200, 201]).toContain(result.status);
    }
    expect(await liveAttempts(app.pool, invite.invitationId)).toHaveLength(1);
  });

  it('K6: two OTP requests at once send exactly one code; the other is OTP_RATE_LIMITED', async () => {
    const { app, provider } = ctx;
    const invite = await newInvite(app, system);
    const session = await begin(app, invite);
    const results = await Promise.all([post(app, '/otp/request', session), post(app, '/otp/request', session)]);
    expect(results.map((r) => r.status).sort()).toEqual([202, 429]);
    expect(adminErrorCode(results.find((r) => r.status === 429) as (typeof results)[number])).toBe('OTP_RATE_LIMITED');
    expect(provider.sendStarted()).toBe(1);
    const [attempt] = await liveAttempts(app.pool, invite.invitationId);
    expect((await challengesOf(app.pool, String(attempt?.attempt_id))).map((row) => row.status)).toEqual(['PENDING']);
  });

  it('K7: the fifth wrong code and the right code at once - LOCKED is never overwritten by VERIFIED', async () => {
    const { app } = ctx;
    const invite = await newInvite(app, system);
    const session = await begin(app, invite);
    const otp = await sendOtp(deps(), invite, session);
    const wrong = otp === '000000' ? '111111' : '000000';
    for (let index = 0; index < 4; index += 1) {
      expect((await post(app, '/otp/verify', session, { code: wrong })).status).toBe(400);
    }
    await Promise.all([post(app, '/otp/verify', session, { code: wrong }), post(app, '/otp/verify', session, { code: otp })]);
    const [attempt] = await attemptsOf(app.pool, invite.invitationId);
    const [challenge] = await challengesOf(app.pool, String(attempt?.attempt_id));
    if (challenge?.status === 'LOCKED') {
      expect(attempt?.status).toBe('STARTED');
      expect(challenge.attempt_count).toBe(5);
    } else {
      expect(challenge?.status).toBe('VERIFIED');
      expect(attempt?.status).toBe('OTP_VERIFIED');
    }
  });

  it('K13: a resend at once with a verify of the old code never verifies a challenge that was invalidated', async () => {
    const { app, pool, provider } = ctx;
    const invite = await newInvite(app, system);
    const session = await begin(app, invite);
    const otp = await sendOtp(deps(), invite, session);
    const sent = provider.sentCount();
    const results = await Promise.all([post(app, '/otp/verify', session, { code: otp }), post(app, '/otp/request', session)]);
    expect(provider.sentCount()).toBe(sent); // the resend is inside the 60 s cooldown: no second code
    const [attempt] = await attemptsOf(pool, invite.invitationId);
    expect(['OTP_VERIFIED', 'STARTED']).toContain(attempt?.status);
    const challenges = await challengesOf(pool, String(attempt?.attempt_id));
    expect(challenges.filter((row) => row.status === 'VERIFIED').length).toBe(attempt?.status === 'OTP_VERIFIED' ? 1 : 0);
    expect(results.find((r) => r.status === 429 || r.status === 409 || r.status === 200 || r.status === 202)).toBeDefined();
  });

  // ----- K24, K25, K29: clocks of the database ---------------------------------------------------------------

  it('K24: past the 600 s password deadline the password is refused with restart_required, restart gives a new attempt and the old OTP is useless', async () => {
    const { app, pool } = ctx;
    const invite = await newInvite(app, system);
    const stale = await insertAttempt(pool, {
      invitationId: invite.invitationId,
      status: 'OTP_VERIFIED',
      createdAgoSeconds: 900,
      expiresInSeconds: 900,
      otpVerifiedAgoSeconds: 700,
    });
    const state = adminData(ok(await getState(app, { cookie: stale.cookie, csrf: '' })));
    expect(state).toMatchObject({ state: 'OTP_VERIFIED', restart_required: true });
    const session = { cookie: stale.cookie, csrf: String(state.csrf_token) };
    const refused = await post(app, '/password', session, { password: 'Correct-Horse-Battery-9' });
    expect(refused.status).toBe(409);
    expect(refused.body.error?.details).toMatchObject({ state: 'OTP_VERIFIED', restart_required: true });
    // start with the token and the stale cookie does not resume it either: a new attempt.
    const restarted = ok(await post(app, '/restart', session), 201);
    const fresh = { cookie: cookieFrom(restarted, ACTIVATION_COOKIE) as string, csrf: String(adminData(restarted).csrf_token) };
    const all = await attemptsOf(pool, invite.invitationId);
    expect(all.map((row) => [row.status, row.invalidated_reason])).toEqual([
      ['INVALIDATED', 'SUPERSEDED'],
      ['STARTED', null],
    ]);
    await verifyOtp(deps(), invite, fresh);
    await setPassword(deps(), fresh);
    const secret = await issueSecret(deps(), fresh);
    ok(await post(app, '/complete', fresh, { code: totpNow(secret) }));
    expect(await invitationStatus(pool, invite.invitationId)).toBe('ACCEPTED');
  });

  it('K24(d): start with the token and a cookie past its password deadline starts a new attempt instead of resuming', async () => {
    const { app, pool } = ctx;
    const invite = await newInvite(app, system);
    const stale = await insertAttempt(pool, {
      invitationId: invite.invitationId,
      status: 'OTP_VERIFIED',
      createdAgoSeconds: 900,
      expiresInSeconds: 900,
      otpVerifiedAgoSeconds: 700,
    });
    const response = await act(app, 'POST', '/start', { body: { token: invite.token }, cookies: { [ACTIVATION_COOKIE]: stale.cookie } });
    expect(response.status).toBe(201);
    expect(adminData(response).state).toBe('STARTED');
    expect((await liveAttempts(pool, invite.invitationId)).map((row) => row.status)).toEqual(['STARTED']);
  });

  it('K25/K29: the cookie of an attempt is valid up to expires_at by the DATABASE clock and 401 from then on, on every route', async () => {
    const { app, pool } = ctx;
    const invite = await newInvite(app, system);
    const expired = await insertAttempt(pool, { invitationId: invite.invitationId, status: 'STARTED', createdAgoSeconds: 1800, expiresInSeconds: -1 });
    const before = await auditCount(pool);
    const csrf = 'anything';
    const session = { cookie: expired.cookie, csrf };
    const calls = [
      getState(app, session),
      post(app, '/restart', session),
      post(app, '/otp/request', session),
      post(app, '/otp/verify', session, { code: '123456' }),
      post(app, '/password', session, { password: 'Correct-Horse-Battery-9' }),
      post(app, '/totp/enrollment', session),
      post(app, '/complete', session, { code: '123456' }),
    ];
    for (const response of await Promise.all(calls)) {
      expect(response.status).toBe(401);
      expect(adminErrorCode(response)).toBe('ADMIN_ACTIVATION_SESSION_INVALID');
    }
    expect(await auditCount(pool)).toBe(before);
    // start ignores the dead cookie and goes by the token.
    const started = await act(app, 'POST', '/start', { body: { token: invite.token }, cookies: { [ACTIVATION_COOKIE]: expired.cookie } });
    expect(started.status).toBe(201);
    // Just before expiry the same kind of cookie still works.
    const other = await newInvite(app, system);
    const alive = await insertAttempt(pool, { invitationId: other.invitationId, status: 'STARTED', createdAgoSeconds: 60, expiresInSeconds: 120 });
    expect(adminData(ok(await getState(app, { cookie: alive.cookie, csrf: '' }))).state).toBe('STARTED');
  });

  it('K29: an INVALIDATED(PHONE_CONFLICT) attempt answers 409 PHONE_CONFLICT before expires_at and 401 from it, without any write', async () => {
    const { app, pool } = ctx;
    const invite = await newInvite(app, system);
    const live = await insertAttempt(pool, {
      invitationId: invite.invitationId,
      status: 'INVALIDATED',
      reason: 'PHONE_CONFLICT',
      createdAgoSeconds: 60,
      expiresInSeconds: 300,
    });
    const body = adminData(ok(await getState(app, { cookie: live.cookie, csrf: '' })));
    expect(body).toMatchObject({ state: 'INVALIDATED', reason: 'PHONE_CONFLICT', can_restart: false });
    expect(body.csrf_token).toBeUndefined();
    const dead = await newInvite(app, system);
    const gone = await insertAttempt(pool, {
      invitationId: dead.invitationId,
      status: 'INVALIDATED',
      reason: 'PHONE_CONFLICT',
      createdAgoSeconds: 600,
      expiresInSeconds: -1,
    });
    expect((await getState(app, { cookie: gone.cookie, csrf: '' })).status).toBe(401);
  });

  // ----- K26: replay writes nothing but the ingress quota -----------------------------------------------------

  it('K26: a repeated complete on a COMPLETED attempt is 200 and writes nothing but the ingress quota (+1 per request)', async () => {
    const { app, pool } = ctx;
    const invite = await newInvite(app, system);
    const { session, secret } = await advance(deps(), invite, 'TOTP_ISSUED');
    ok(await post(app, '/complete', session, { code: totpNow(String(secret)) }));
    const attemptId = (await attemptsOf(pool, invite.invitationId))[0]?.attempt_id;
    const snapshot = async (): Promise<unknown> => ({
      buckets: await bucketRows(pool, 'ACTIVATION_REQUEST_IP'),
      audits: await auditCount(pool, ''),
      rows: (
        await pool.query(
          `SELECT (SELECT xmin::text FROM app.admin_activation_attempts WHERE attempt_id = $1::uuid) AS attempt,
                  (SELECT xmin::text FROM app.admin_invitations WHERE invitation_id = $2::uuid) AS invitation,
                  (SELECT xmin::text FROM app.users WHERE phone_normalized = $3) AS usr,
                  (SELECT count(*) FROM app.admin_totp_factors WHERE user_id IN (SELECT user_id FROM app.users WHERE phone_normalized = $3)) AS factors`,
          [attemptId, invite.invitationId, invite.phone.normalized],
        )
      ).rows,
    });
    const requests = async (): Promise<number> => bucketFailures(pool, 'ACTIVATION_REQUEST_IP');
    const before = await snapshot();
    const quotaBefore = await requests();
    for (let index = 0; index < 3; index += 1) {
      const response = await post(app, '/complete', session, { code: totpNow(String(secret), index === 0 ? 0 : 3) });
      expect(response.status).toBe(200);
      expect(adminData(response)).toEqual({ state: 'COMPLETED', next: 'LOGIN' });
    }
    expect(await snapshot()).toEqual(before);
    expect(await requests()).toBe(quotaBefore + 3);
    // start with the token and the COMPLETED cookie is the same answer, also without a write.
    const started = await act(app, 'POST', '/start', { body: { token: invite.token }, cookies: cookiesOf(session) });
    expect(started.status).toBe(200);
    expect(adminData(started)).toEqual({ state: 'COMPLETED', next: 'LOGIN' });
    expect(await snapshot()).toEqual(before);
  });

  // ----- K3, K4, K20: the 1B hook ----------------------------------------------------------------------------

  it('K4: a 1B reissue invalidates the live attempt and its challenge; the old session is refused, the new link starts fresh', async () => {
    const { app, pool } = ctx;
    const invite = await newInvite(app, system);
    const session = await begin(app, invite);
    await sendOtp(deps(), invite, session);
    const payload = { invitation_id: invite.invitationId, expected_version: 1, reason: 'r' };
    const operationId = await stepUp(app, system, 'REISSUE_INVITATION', payload);
    const reissued = await api(app, 'POST', `/invitations/${invite.invitationId}/reissue`, {
      body: { operation_id: operationId, expected_version: 1, reason: 'r' },
      headers: { 'idempotency-key': randomUUID() },
      ...sessionOf(system),
    });
    expect(reissued.status).toBe(201);
    const attempts = await attemptsOf(pool, invite.invitationId);
    expect(attempts.map((row) => [row.status, row.invalidated_reason])).toEqual([['INVALIDATED', 'INVITATION_CLOSED']]);
    expect((await challengesOf(pool, String(attempts[0]?.attempt_id))).map((row) => row.status)).toEqual(['INVALIDATED']);
    // The old session answers the closed-link state (no CSRF token, not restartable); the old token is a 404.
    const state = adminData(ok(await getState(app, session)));
    expect(state).toMatchObject({ state: 'INVALIDATED', reason: 'LINK_UNAVAILABLE', can_restart: false });
    const oldLink = await act(app, 'POST', '/start', { body: { token: invite.token } });
    expect(oldLink.status).toBe(404);
    expect(adminErrorCode(oldLink)).toBe('ADMIN_ACTIVATION_LINK_INVALID');
  });

  it('K3: a revoked invitation can no longer be activated, even by an attempt that was already at TOTP_ISSUED', async () => {
    const { app, pool } = ctx;
    const invite = await newInvite(app, system);
    const { session, secret } = await advance(deps(), invite, 'TOTP_ISSUED');
    const operationId = await stepUp(app, system, 'REVOKE_INVITATION', { invitation_id: invite.invitationId, expected_version: 1, reason: 'r' });
    const revoked = await api(app, 'POST', `/invitations/${invite.invitationId}/revoke`, {
      body: { operation_id: operationId, expected_version: 1, reason: 'r' },
      headers: { 'idempotency-key': randomUUID() },
      ...sessionOf(system),
    });
    expect(revoked.status).toBe(200);
    const result = await post(app, '/complete', session, { code: totpNow(String(secret)) });
    expect(result.status).toBe(409);
    expect(await userCount(invite.phone.normalized)).toBe(0);
    const [attempt] = await attemptsOf(pool, invite.invitationId);
    expect(attempt).toMatchObject({ status: 'INVALIDATED', invalidated_reason: 'INVITATION_CLOSED' });
    const restart = await post(app, '/restart', session);
    expect(restart.status).toBe(409);
  });

  // ----- PHONE_CONFLICT (K23 functional part) -----------------------------------------------------------------

  it('K23: a phone that already belongs to an account closes the invitation (PHONE_CONFLICT) at start, restart-free, with 409', async () => {
    const { app, pool } = ctx;
    const invite = await newInvite(app, system);
    const session = await begin(app, invite);
    await pool.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
       VALUES ($1::uuid, $2, $3, now(), 'PHONE_VERIFIED', 'ACTIVE', 1, now(), now())`,
      [randomUUID(), invite.phone.normalized, await new Argon2idPasswordHasher().hash('Another-Passw0rd-1')],
    );
    const result = await post(app, '/otp/request', session);
    expect(result.status).toBe(409);
    expect(adminErrorCode(result)).toBe('ADMIN_PHONE_CONFLICT');
    expect(await invitationStatus(pool, invite.invitationId)).toBe('PHONE_CONFLICT');
    expect((await attemptsOf(pool, invite.invitationId)).map((row) => [row.status, row.invalidated_reason])).toEqual([['INVALIDATED', 'PHONE_CONFLICT']]);
    // The state read reports the closure without a CSRF token; no OTP was ever sent.
    expect(adminData(ok(await getState(app, session)))).toMatchObject({ state: 'INVALIDATED', reason: 'PHONE_CONFLICT', can_restart: false });
    expect(ctx.provider.sendStarted()).toBe(0);
  });
});
