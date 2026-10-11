import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { DEFAULT_ACTIVATION_LIMITS } from '../../apps/backend/src/config/admin-activation-config';
import { generateToken } from '../../apps/backend/src/auth/tokens';
import { ADMIN_PASSWORD, adminData, adminErrorCode } from './support/admin-fixtures';
import {
  act,
  ActivationApp,
  attemptsOf,
  begin,
  challengesOf,
  getState,
  newInvite,
  ok,
  post,
  sendOtp,
  startActivationApp,
  verifyOtp,
} from './support/activation-fixtures';
import { waitUntilDbClockPast } from './support/lock-fixtures';
import { SystemSession, systemSession } from './support/provisioning-fixtures';

// M01-D-ADMIN-1C - the section 7 values are configuration (section 16): each configured value really drives the
// behaviour. Defaults equal section 7 and are covered by the unit tests of the loader and by every other suite.

describe('M01-D-ADMIN-1C - configured TTLs and thresholds drive the behaviour', () => {
  let ctx: ActivationApp;
  let system: SystemSession;
  const deps = (): { app: ActivationApp['app']; provider: ActivationApp['provider'] } => ({ app: ctx.app, provider: ctx.provider });

  beforeAll(async () => {
    ctx = await startActivationApp({
      activationConfig: {
        limits: {
          ...DEFAULT_ACTIVATION_LIMITS,
          requestLimit: 40,
          attemptTtlSeconds: 20,
          otpTtlSeconds: 3,
          otpResendCooldownSeconds: 1,
          passwordDeadlineSeconds: 3,
          linkFailureLimit: 2,
        },
      },
    });
    system = await systemSession(ctx.app);
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await ctx.app.clearLimits();
    ctx.provider.clear();
  });

  it('attemptTtlSeconds: expires_at = created_at + 20 s', async () => {
    const invite = await newInvite(ctx.app, system);
    const session = await begin(ctx.app, invite);
    const [attempt] = await attemptsOf(ctx.pool, invite.invitationId);
    const span = await ctx.pool.query<{ s: string }>(
      'SELECT extract(epoch FROM expires_at - created_at)::text AS s FROM app.admin_activation_attempts WHERE attempt_id = $1::uuid',
      [attempt?.attempt_id],
    );
    expect(Number(span.rows[0]?.s)).toBe(20);
    ok(await getState(ctx.app, session));
  });

  it('otpTtlSeconds and otpResendCooldownSeconds: the code is valid 3 s, a resend is allowed after 1 s', async () => {
    const invite = await newInvite(ctx.app, system);
    const session = await begin(ctx.app, invite);
    const otp = await sendOtp(deps(), invite, session);
    const [attempt] = await attemptsOf(ctx.pool, invite.invitationId);
    const [challenge] = await challengesOf(ctx.pool, String(attempt?.attempt_id));
    const times = await ctx.pool.query<{ ttl: string; cooldown: string }>(
      `SELECT extract(epoch FROM expires_at - created_at)::int::text AS ttl, extract(epoch FROM resend_not_before - created_at)::int::text AS cooldown
         FROM app.admin_activation_otp_challenges WHERE challenge_id = $1::uuid`,
      [challenge?.challenge_id],
    );
    expect(times.rows[0]).toEqual({ ttl: '3', cooldown: '1' });
    await waitUntilDbClockPast(ctx.pool, 'SELECT expires_at FROM app.admin_activation_otp_challenges WHERE challenge_id = $1::uuid', [challenge?.challenge_id]);
    const late = await post(ctx.app, '/otp/verify', session, { code: otp });
    expect(adminErrorCode(late)).toBe('OTP_EXPIRED');
    // the cooldown is long over: a resend is accepted at once
    await sendOtp(deps(), invite, session);
  });

  it('passwordDeadlineSeconds: 3 s after the OTP check the password is refused with restart_required and restart is offered', async () => {
    const invite = await newInvite(ctx.app, system);
    const session = await begin(ctx.app, invite);
    await verifyOtp(deps(), invite, session);
    const [attempt] = await attemptsOf(ctx.pool, invite.invitationId);
    await waitUntilDbClockPast(
      ctx.pool,
      "SELECT otp_verified_at + interval '3 seconds' FROM app.admin_activation_attempts WHERE attempt_id = $1::uuid",
      [attempt?.attempt_id],
    );
    const refused = await post(ctx.app, '/password', session, { password: ADMIN_PASSWORD });
    expect(refused.status).toBe(409);
    expect(adminErrorCode(refused)).toBe('ADMIN_ACTIVATION_STEP_INVALID');
    expect(adminData(ok(await getState(ctx.app, session)))).toMatchObject({ state: 'OTP_VERIFIED', restart_required: true });
  });

  it('linkFailureLimit: the second wrong token locks the address (429 with Retry-After), a valid token is refused too', async () => {
    const invite = await newInvite(ctx.app, system);
    for (let index = 0; index < 2; index += 1) {
      expect(adminErrorCode(await act(ctx.app, 'POST', '/start', { body: { token: generateToken().token } }))).toBe('ADMIN_ACTIVATION_LINK_INVALID');
    }
    const locked = await act(ctx.app, 'POST', '/start', { body: { token: invite.token } });
    expect(locked.status).toBe(429);
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);
  });
});

describe('M01-D-ADMIN-1C - the ingress quota follows requestLimit / requestWindowSeconds', () => {
  let ctx: ActivationApp;

  beforeAll(async () => {
    ctx = await startActivationApp({ activationConfig: { limits: { ...DEFAULT_ACTIVATION_LIMITS, requestLimit: 3, requestWindowSeconds: 30 } } });
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await ctx.app.clearLimits();
  });

  it('the fourth POST inside the window is 429 with Retry-After <= 30', async () => {
    const statuses: number[] = [];
    let last: Awaited<ReturnType<typeof post>> | undefined;
    for (let index = 0; index < 4; index += 1) {
      last = await post(ctx.app, '/otp/request', { cookie: 'f'.repeat(43), csrf: 'x' });
      statuses.push(last.status);
    }
    expect(statuses).toEqual([401, 401, 401, 429]);
    const retryAfter = Number(last?.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(30);
  });
});
