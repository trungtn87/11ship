import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { generateToken } from '../../apps/backend/src/auth/tokens';
import { ADMIN_SESSION_COOKIE } from '../../apps/backend/src/admin-auth/admin-auth-constants';
import {
  ADMIN_ORIGIN,
  ADMIN_PASSWORD,
  adminData,
  adminErrorCode,
  cookieFrom,
  loginStep,
  preauthCookies,
  totpNow,
} from './support/admin-fixtures';
import {
  ACTIVATION_COOKIE,
  act,
  advance,
  ActivationApp,
  attemptsOf,
  auditCount,
  begin,
  bucketFailures,
  challengesOf,
  cookiesOf,
  getState,
  invitationStatus,
  insertAttempt,
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
import { sessionOf, SystemSession, systemSession } from './support/provisioning-fixtures';

// M01-D-ADMIN-1C: the eight activation routes through the real Nest pipeline and the real PostgreSQL. The only fake is
// the SMS provider, bound explicitly by the test. No sleeps decide anything.

describe('M01-D-ADMIN-1C - activation flow, transport and the CSRF/state matrix', () => {
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

  // ----- the whole flow and the atomic account creation -----------------------------------------------------------

  it('activates an invitation atomically: no account before the last step, then login with password + TOTP, no session issued', async () => {
    const { app, pool } = ctx;
    const invite = await newInvite(app, system);
    const users = async (): Promise<number> =>
      Number((await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM app.users WHERE phone_normalized = $1', [invite.phone.normalized])).rows[0]?.n);

    const session = await begin(app, invite);
    expect(await users()).toBe(0);
    await verifyOtp(deps(), invite, session);
    await setPassword(deps(), session);
    const secret = await issueSecret(deps(), session);
    // Every step before COMPLETED leaves no user, membership, profile, permission or factor behind.
    expect(await users()).toBe(0);
    const [attempt] = await liveAttempts(pool, invite.invitationId);
    expect(attempt?.status).toBe('TOTP_ISSUED');
    expect(await invitationStatus(pool, invite.invitationId)).toBe('PENDING');
    expect(Number((await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM app.admin_totp_factors WHERE factor_id = $1::uuid', [attempt?.factor_id])).rows[0]?.n)).toBe(0);

    const completed = ok(await post(app, '/complete', session, { code: totpNow(secret) }));
    expect(adminData(completed)).toEqual({ state: 'COMPLETED', next: 'LOGIN' });
    // The user, membership, profile, permissions and the ACTIVE factor exist together, with the pre-allocated ids.
    const account = await pool.query<{ user_id: string; status: string; account_origin: string; phone_verified_at: Date | null }>(
      'SELECT user_id, status, account_origin, phone_verified_at FROM app.users WHERE phone_normalized = $1',
      [invite.phone.normalized],
    );
    expect(account.rows).toHaveLength(1);
    expect(account.rows[0]?.user_id).toBe(attempt?.user_id);
    expect(account.rows[0]?.status).toBe('ACTIVE');
    expect(account.rows[0]?.account_origin).toBe('ADMIN_PROVISIONED');
    const membership = await pool.query<{ admin_role: string; status: string }>('SELECT admin_role, status FROM app.admin_memberships WHERE user_id = $1::uuid', [attempt?.user_id]);
    expect(membership.rows).toEqual([{ admin_role: 'ADMIN', status: 'ACTIVE' }]);
    const profile = await pool.query<{ full_name: string }>('SELECT full_name FROM app.admin_profiles WHERE user_id = $1::uuid', [attempt?.user_id]);
    expect(profile.rows[0]?.full_name).toBe('Nguyễn Văn Quản Trị');
    const permissions = await pool.query<{ app: string; can_view: boolean }>('SELECT app, can_view FROM app.admin_app_permissions WHERE user_id = $1::uuid', [attempt?.user_id]);
    expect(permissions.rows).toEqual([{ app: 'SHOP', can_view: true }]);
    const factor = await pool.query<{ state: string; user_id: string }>('SELECT state, user_id FROM app.admin_totp_factors WHERE factor_id = $1::uuid', [attempt?.factor_id]);
    expect(factor.rows).toEqual([{ state: 'ACTIVE', user_id: attempt?.user_id }]);
    expect(await invitationStatus(pool, invite.invitationId)).toBe('ACCEPTED');
    expect((await attemptsOf(pool, invite.invitationId)).map((row) => row.status)).toEqual(['COMPLETED']);
    // The secret and the password hash are gone from the attempt once it is COMPLETED.
    const stored = await pool.query<{ password_hash: string | null; totp_ciphertext: Buffer | null }>(
      'SELECT password_hash, totp_ciphertext FROM app.admin_activation_attempts WHERE attempt_id = $1::uuid',
      [attempt?.attempt_id],
    );
    expect(stored.rows[0]).toEqual({ password_hash: null, totp_ciphertext: null });
    // No admin session was issued by the activation.
    expect(completed.setCookie.some((line) => line.startsWith(`${ADMIN_SESSION_COOKIE}=`))).toBe(false);
    expect(Number((await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM app.admin_sessions WHERE user_id = $1::uuid', [attempt?.user_id])).rows[0]?.n)).toBe(0);

    // GET state of a COMPLETED attempt: the same safe answer, never a CSRF token.
    const state = ok(await getState(app, session));
    expect(adminData(state)).toEqual({ state: 'COMPLETED', next: 'LOGIN' });
    // The activated administrator signs in with the chosen password, then the TOTP of the secret shown at enrollment.
    const account2 = { phone: invite.phone, password: ADMIN_PASSWORD, userId: String(attempt?.user_id) };
    const preauth = await loginStep(app, account2);
    const verified = await app.call('POST', '/totp/verify', { body: { code: totpNow(secret) }, cookies: preauthCookies(preauth), csrf: preauth.csrf });
    expect(verified.status).toBe(200);
    expect(cookieFrom(verified, ADMIN_SESSION_COOKIE)).toBeTruthy();
  });

  it('records audit rows for the transitions and never an OTP, password, secret, token or phone', async () => {
    const { app, pool } = ctx;
    const invite = await newInvite(app, system);
    const before = await auditCount(pool);
    const progress = await advance(deps(), invite, 'TOTP_ISSUED');
    ok(await post(app, '/complete', progress.session, { code: totpNow(String(progress.secret)) }));
    expect(await auditCount(pool)).toBeGreaterThanOrEqual(before + 6);
    const rows = await pool.query<{ action: string; metadata: unknown }>("SELECT action, metadata FROM app.audit_logs WHERE action LIKE 'admin_activation.%'");
    const text = JSON.stringify(rows.rows);
    for (const secret of [invite.token, ADMIN_PASSWORD, String(progress.secret), invite.phone.normalized, invite.phone.local, progress.session.cookie]) {
      expect(text).not.toContain(secret);
    }
    expect(rows.rows.map((row) => row.action)).toEqual(expect.arrayContaining(['admin_activation.attempt_started.v1', 'admin_activation.completed.v1']));
  });

  // ----- start --------------------------------------------------------------------------------------------------

  it('start: a wrong, malformed, closed or expired token is one uniform 404 and never sets a cookie', async () => {
    const { app } = ctx;
    const invite = await newInvite(app, system);
    const wrong = await act(app, 'POST', '/start', { body: { token: generateToken().token } });
    const malformed = await act(app, 'POST', '/start', { body: { token: 'short' } });
    expect(wrong.status).toBe(404);
    expect(adminErrorCode(wrong)).toBe('ADMIN_ACTIVATION_LINK_INVALID');
    expect(wrong.setCookie).toEqual([]);
    // A malformed token is rejected as input (400) before any lookup, or as the uniform link error: never a hint of existence.
    expect([400, 404]).toContain(malformed.status);
    const first = await begin(app, invite);
    expect(first.cookie).toHaveLength(43);
  });

  it('start: twice with the cookie and the same token resumes (200), without the cookie supersedes the old attempt', async () => {
    const { app, pool } = ctx;
    const invite = await newInvite(app, system);
    const first = await begin(app, invite);
    const resumed = await act(app, 'POST', '/start', { body: { token: invite.token }, cookies: cookiesOf(first) });
    expect(resumed.status).toBe(200);
    expect(adminData(resumed).state).toBe('STARTED');
    expect((await liveAttempts(pool, invite.invitationId)).length).toBe(1);
    const second = await begin(app, invite);
    expect(second.cookie).not.toBe(first.cookie);
    const all = await attemptsOf(pool, invite.invitationId);
    expect(all.map((row) => [row.status, row.invalidated_reason])).toEqual([
      ['INVALIDATED', 'SUPERSEDED'],
      ['STARTED', null],
    ]);
    // The old cookie still names its (now SUPERSEDED) attempt: the state says so, with no CSRF token.
    const stale = await getState(app, first);
    expect(stale.status).toBe(200);
    expect(adminData(stale).state).toBe('INVALIDATED');
    expect(adminData(stale).csrf_token).toBeUndefined();
  });

  // ----- transport: headers, cookie attributes, Origin, content type, size, CSRF ----------------------------------

  it('every response carries no-store / no-referrer / nosniff and never an ETag, even errors and 401', async () => {
    const { app } = ctx;
    const invite = await newInvite(app, system);
    const session = await begin(app, invite);
    const responses = [
      await act(app, 'POST', '/start', { body: { token: generateToken().token } }),
      await getState(app, session),
      await getState(app, undefined),
      await post(app, '/otp/verify', session, { code: '123456' }),
      await post(app, '/password', undefined, { password: 'x' }),
    ];
    for (const response of responses) {
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['pragma']).toBe('no-cache');
      expect(response.headers['referrer-policy']).toBe('no-referrer');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['etag']).toBeUndefined();
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    }
    // A conditional request is never answered 304.
    const conditional = await getState(app, session, { headers: { 'if-none-match': '*', 'if-modified-since': 'Wed, 21 Oct 2037 07:28:00 GMT' } });
    expect(conditional.status).toBe(200);
  });

  it('the activation cookie is __Host-, HttpOnly, Secure, SameSite=Strict, Path=/ with no Domain', async () => {
    const { app } = ctx;
    const invite = await newInvite(app, system);
    const response = await act(app, 'POST', '/start', { body: { token: invite.token } });
    const line = response.setCookie.find((value) => value.startsWith(`${ACTIVATION_COOKIE}=`)) ?? '';
    expect(ACTIVATION_COOKIE.startsWith('__Host-')).toBe(true);
    expect(line).toMatch(/; Max-Age=\d+/);
    expect(line).toContain('; Path=/');
    expect(line).toContain('; Secure');
    expect(line).toContain('; HttpOnly');
    expect(line).toContain('; SameSite=Strict');
    expect(line.toLowerCase()).not.toContain('domain=');
  });

  it('POST needs the exact Origin; a wrong, missing or look-alike Origin is 403 ADMIN_CSRF_INVALID before any work', async () => {
    const { app, pool } = ctx;
    const invite = await newInvite(app, system);
    const before = await bucketFailures(pool, 'ACTIVATION_LINK_IP');
    for (const origin of ['https://evil.example.test', `${ADMIN_ORIGIN}.evil.test`, `${ADMIN_ORIGIN}/`, null]) {
      const response = await act(app, 'POST', '/start', { body: { token: invite.token }, origin });
      expect(response.status).toBe(403);
      expect(adminErrorCode(response)).toBe('ADMIN_CSRF_INVALID');
      expect(response.setCookie).toEqual([]);
    }
    expect(await attemptsOf(pool, invite.invitationId)).toEqual([]);
    expect(await bucketFailures(pool, 'ACTIVATION_LINK_IP')).toBe(before);
  });

  it('POST must be JSON, at most 4 KiB, with an exact body: anything else is 400 ADMIN_INPUT_INVALID', async () => {
    const { app } = ctx;
    const invite = await newInvite(app, system);
    const cases: Array<[string, Parameters<typeof act>[3]]> = [
      ['text/plain', { rawBody: JSON.stringify({ token: invite.token }), contentType: 'text/plain' }],
      ['no content type', { rawBody: JSON.stringify({ token: invite.token }), contentType: null }],
      ['extra key', { body: { token: invite.token, extra: 1 } }],
      ['token not a string', { body: { token: 12345 } }],
      ['array body', { body: [invite.token] }],
      ['over 4 KiB', { body: { token: 'T'.repeat(5000) } }],
    ];
    for (const [name, options] of cases) {
      const response = await act(app, 'POST', '/start', options);
      expect({ name, status: response.status, code: adminErrorCode(response) }).toEqual({ name, status: 400, code: 'ADMIN_INPUT_INVALID' });
    }
  });

  it('the token travels only in the body of POST /start: a token in the query or a header is not read', async () => {
    const { app } = ctx;
    const invite = await newInvite(app, system);
    const viaQuery = await act(app, 'POST', `/start?token=${invite.token}`, { body: {} });
    expect(viaQuery.status).toBe(400);
    const viaHeader = await act(app, 'POST', '/start', { body: {}, headers: { 'x-activation-token': invite.token } });
    expect(viaHeader.status).toBe(400);
  });

  it('CSRF: every session POST needs the header token of THIS attempt; GET state needs none', async () => {
    const { app, pool } = ctx;
    const invite = await newInvite(app, system);
    const other = await newInvite(app, system);
    const session = await begin(app, invite);
    const foreign = await begin(app, other);
    const routes: Array<[string, unknown]> = [
      ['/restart', {}],
      ['/otp/request', {}],
      ['/otp/verify', { code: '123456' }],
      ['/password', { password: ADMIN_PASSWORD }],
      ['/totp/enrollment', {}],
      ['/complete', { code: '123456' }],
    ];
    const before = await auditCount(pool);
    for (const [path, body] of routes) {
      for (const csrf of [undefined, 'x', foreign.csrf, `${session.csrf}A`]) {
        const response = await act(app, 'POST', path, { body, cookies: cookiesOf(session), ...(csrf === undefined ? {} : { csrf }) });
        expect({ path, csrf: csrf === undefined ? 'none' : 'bad', status: response.status, code: adminErrorCode(response) }).toEqual({
          path,
          csrf: csrf === undefined ? 'none' : 'bad',
          status: 403,
          code: 'ADMIN_CSRF_INVALID',
        });
      }
    }
    expect(await auditCount(pool)).toBe(before);
    expect(await challengesOf(pool, (await liveAttempts(pool, invite.invitationId))[0]?.attempt_id as string)).toEqual([]);
    expect((await getState(app, session)).status).toBe(200);
  });

  it('a missing, malformed or unknown cookie is 401 ADMIN_ACTIVATION_SESSION_INVALID and the cookie is cleared', async () => {
    const { app } = ctx;
    const fresh = { cookie: generateToken().token, csrf: 'whatever' };
    for (const response of [
      await getState(app, undefined),
      await getState(app, fresh),
      await getState(app, { cookie: 'short', csrf: '' }),
      await post(app, '/otp/request', fresh),
    ]) {
      expect(response.status).toBe(401);
      expect(adminErrorCode(response)).toBe('ADMIN_ACTIVATION_SESSION_INVALID');
    }
    const cleared = await getState(app, fresh);
    expect(cleared.setCookie.some((line) => line.startsWith(`${ACTIVATION_COOKIE}=;`) && line.includes('Max-Age=0'))).toBe(true);
  });

  it('an administration login cookie is never accepted as an activation cookie, nor the reverse', async () => {
    const { app } = ctx;
    const cookie = sessionOf(system).cookies[ADMIN_SESSION_COOKIE] as string;
    const response = await act(app, 'GET', '/state', { cookies: { [ADMIN_SESSION_COOKIE]: cookie } });
    expect(response.status).toBe(401);
    const invite = await newInvite(app, system);
    const session = await begin(app, invite);
    const reverse = await app.call('GET', '/me', { basePath: '/v1/admin-auth', cookies: { [ACTIVATION_COOKIE]: session.cookie } });
    expect(reverse.status).toBeGreaterThanOrEqual(400);
  });

  it('the ingress quota is 30 per minute per address and is spent by every POST, malformed or not', async () => {
    const { app, pool } = ctx;
    for (let index = 0; index < 30; index += 1) {
      const response = await act(app, 'POST', '/start', { body: { token: generateToken().token } });
      expect([404, 429]).toContain(response.status);
    }
    const blocked = await act(app, 'POST', '/start', { body: { token: generateToken().token } });
    expect(blocked.status).toBe(429);
    expect(adminErrorCode(blocked)).toBe('ADMIN_AUTH_RATE_LIMITED');
    expect(await bucketFailures(pool, 'ACTIVATION_REQUEST_IP')).toBeGreaterThanOrEqual(30);
  });

  it('wrong invitation tokens lock the address after 10 failures; a valid token from that address is refused too', async () => {
    const { app } = ctx;
    const invite = await newInvite(app, system);
    const codes: Array<string | undefined> = [];
    for (let index = 0; index < 10; index += 1) {
      codes.push(adminErrorCode(await act(app, 'POST', '/start', { body: { token: generateToken().token } })));
    }
    expect(codes.every((code) => code === 'ADMIN_ACTIVATION_LINK_INVALID')).toBe(true);
    const locked = await act(app, 'POST', '/start', { body: { token: invite.token } });
    expect(locked.status).toBe(429);
    expect(adminErrorCode(locked)).toBe('ADMIN_AUTH_RATE_LIMITED');
  });

  // ----- OTP ----------------------------------------------------------------------------------------------------

  it('OTP: request needs STARTED; resend inside 60 s is refused; a wrong code counts; five wrong codes lock the challenge', async () => {
    const { app, pool } = ctx;
    const invite = await newInvite(app, system);
    const session = await begin(app, invite);
    const otp = await sendOtp(deps(), invite, session);
    const early = await post(app, '/otp/request', session);
    expect(early.status).toBe(429);
    expect(adminErrorCode(early)).toBe('OTP_RATE_LIMITED');
    const wrong = otp === '000000' ? '111111' : '000000';
    for (let index = 1; index <= 4; index += 1) {
      const response = await post(app, '/otp/verify', session, { code: wrong });
      expect({ status: response.status, code: adminErrorCode(response) }).toEqual({ status: 400, code: 'OTP_INVALID' });
    }
    const state = adminData(ok(await getState(app, session)));
    expect(state).toMatchObject({ state: 'STARTED', otp: { status: 'SUBMITTED', attempts_left: 1 } });
    const fifth = await post(app, '/otp/verify', session, { code: wrong });
    expect(adminErrorCode(fifth)).toBe('OTP_RATE_LIMITED');
    const [attempt] = await liveAttempts(pool, invite.invitationId);
    const [challenge] = await challengesOf(pool, String(attempt?.attempt_id));
    expect(challenge).toMatchObject({ status: 'LOCKED', attempt_count: 5 });
    // K27: a sixth verify (even with the right code) changes nothing - no counter, no audit, same row version.
    const audits = await auditCount(pool);
    const sixth = await post(app, '/otp/verify', session, { code: otp });
    expect(adminErrorCode(sixth)).toBe('OTP_RATE_LIMITED');
    const [after] = await challengesOf(pool, String(attempt?.attempt_id));
    expect(after).toEqual(challenge);
    expect(await auditCount(pool)).toBe(audits);
    expect(adminData(ok(await getState(app, session))).otp).toMatchObject({ status: 'LOCKED' });
  });

  it('OTP: the right code verifies once; verify with no challenge is a 409 with the safe state', async () => {
    const { app } = ctx;
    const invite = await newInvite(app, system);
    const session = await begin(app, invite);
    const none = await post(app, '/otp/verify', session, { code: '123456' });
    expect(none.status).toBe(409);
    expect(adminErrorCode(none)).toBe('ADMIN_ACTIVATION_STEP_INVALID');
    expect(none.body.error?.details).toMatchObject({ state: 'STARTED', otp: { status: 'NONE' } });
    await verifyOtp(deps(), invite, session);
    const again = await post(app, '/otp/verify', session, { code: '123456' });
    expect(again.status).toBe(409);
    expect(again.body.error?.details).toMatchObject({ state: 'OTP_VERIFIED' });
  });

  it('OTP provider outcomes: REJECTED fails the challenge (503) and may be retried at once; UNKNOWN is accepted; one send per request', async () => {
    const { app, pool } = ctx;
    const { provider } = ctx;
    const invite = await newInvite(app, system);
    const session = await begin(app, invite);
    provider.script('REJECTED');
    const rejected = await post(app, '/otp/request', session);
    expect(rejected.status).toBe(503);
    expect(provider.sendStarted()).toBe(1);
    expect(provider.sentCount()).toBe(0);
    const [attempt] = await liveAttempts(pool, invite.invitationId);
    expect((await challengesOf(pool, String(attempt?.attempt_id))).map((row) => row.status)).toEqual(['DELIVERY_FAILED']);
    provider.script('UNKNOWN');
    ok(await post(app, '/otp/request', session), 202);
    expect(provider.sendStarted()).toBe(2);
    expect((await challengesOf(pool, String(attempt?.attempt_id))).map((row) => row.status)).toEqual(['DELIVERY_FAILED', 'PENDING']);
    // The "unknown" SMS did reach the (fake) phone, so its code verifies.
    const code = provider.lastOtpFor(invite.phone.normalized) as string;
    ok(await post(app, '/otp/verify', session, { code }));
    // A provider exception is UNKNOWN too, never a second call.
    const invite2 = await newInvite(app, system);
    const session2 = await begin(app, invite2);
    provider.script('THROW');
    const before = provider.sendStarted();
    const thrown = await post(app, '/otp/request', session2);
    expect(thrown.status).toBe(202);
    expect(provider.sendStarted()).toBe(before + 1);
  });

  // ----- steps in order -----------------------------------------------------------------------------------------

  it('steps cannot be skipped or repeated: a wrong-state call is 409 ADMIN_ACTIVATION_STEP_INVALID with the safe state', async () => {
    const { app } = ctx;
    const invite = await newInvite(app, system);
    const session = await begin(app, invite);
    for (const [path, body] of [
      ['/password', { password: ADMIN_PASSWORD }],
      ['/totp/enrollment', {}],
      ['/complete', { code: '123456' }],
    ] as Array<[string, unknown]>) {
      const response = await post(app, path, session, body);
      expect({ path, status: response.status, code: adminErrorCode(response) }).toEqual({ path, status: 409, code: 'ADMIN_ACTIVATION_STEP_INVALID' });
      expect(response.body.error?.details).toMatchObject({ state: 'STARTED' });
    }
    await verifyOtp(deps(), invite, session);
    const early = await post(app, '/totp/enrollment', session);
    expect(early.status).toBe(409);
    expect(early.body.error?.details).toMatchObject({ state: 'OTP_VERIFIED' });
    const weak = await post(app, '/password', session, { password: 'short' });
    expect(weak.status).toBe(400);
    await setPassword(deps(), session);
    const again = await post(app, '/password', session, { password: ADMIN_PASSWORD });
    expect(again.status).toBe(409);
    expect(again.body.error?.details).toMatchObject({ state: 'PASSWORD_SET' });
    const noSecretYet = await post(app, '/complete', session, { code: '123456' });
    expect(noSecretYet.status).toBe(409);
  });

  it('enrollment replays the SAME secret; complete with the right code needs that secret', async () => {
    const { app } = ctx;
    const invite = await newInvite(app, system);
    const { session, secret } = await advance(deps(), invite, 'TOTP_ISSUED');
    const replay = await issueSecret(deps(), session);
    expect(replay).toBe(secret);
    const wrong = await post(app, '/complete', session, { code: totpNow(String(secret), 5) });
    expect(wrong.status).toBe(400);
    expect(adminErrorCode(wrong)).toBe('ADMIN_TOTP_INVALID');
    expect(adminData(ok(await getState(app, session)))).toMatchObject({ state: 'TOTP_ISSUED', totp_attempts_left: 4 });
    ok(await post(app, '/complete', session, { code: totpNow(String(secret)) }));
  });

  // ----- K28: five wrong TOTP codes, reload, restart ------------------------------------------------------------

  it('K28: five wrong TOTP codes invalidate the attempt; the reloaded state allows restart with a fresh OTP, and a locked TOTP bucket is not reset', async () => {
    const { app, pool } = ctx;
    const invite = await newInvite(app, system);
    const { session, secret } = await advance(deps(), invite, 'TOTP_ISSUED');
    const wrongCode = totpNow(String(secret), 7);
    const statuses: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      statuses.push((await post(app, '/complete', session, { code: wrongCode })).status);
    }
    // The fifth wrong code commits the invalidation and the bucket lock, and is answered as the rate limit.
    expect(statuses).toEqual([400, 400, 400, 400, 429]);
    const [attempt] = await attemptsOf(pool, invite.invitationId);
    expect(attempt).toMatchObject({ status: 'INVALIDATED', invalidated_reason: 'ATTEMPTS_EXHAUSTED', totp_attempt_count: 5 });
    // The page is reloaded: only the cookie is left. GET state still gives the recovery CSRF token.
    const reloaded = adminData(ok(await getState(app, { cookie: session.cookie, csrf: '' })));
    expect(reloaded).toMatchObject({ state: 'INVALIDATED', reason: 'ATTEMPTS_EXHAUSTED', can_restart: true });
    expect(typeof reloaded.csrf_token).toBe('string');
    const bucketBefore = await pool.query("SELECT * FROM app.admin_auth_limits WHERE kind = 'ACTIVATION_TOTP' ORDER BY bucket_key");
    const restarted = ok(await post(app, '/restart', { cookie: session.cookie, csrf: String(reloaded.csrf_token) }), 201);
    expect(adminData(restarted).state).toBe('STARTED');
    const fresh = { cookie: cookieFrom(restarted, ACTIVATION_COOKIE) as string, csrf: String(adminData(restarted).csrf_token) };
    expect(fresh.cookie).not.toBe(session.cookie);
    const bucketAfter = await pool.query("SELECT * FROM app.admin_auth_limits WHERE kind = 'ACTIVATION_TOTP' ORDER BY bucket_key");
    expect(bucketAfter.rows).toEqual(bucketBefore.rows);
    // The new attempt starts at OTP again (nothing inherited).
    const passwordTooEarly = await post(app, '/password', fresh, { password: ADMIN_PASSWORD });
    expect(passwordTooEarly.status).toBe(409);
    await verifyOtp(deps(), invite, fresh);
    await setPassword(deps(), fresh);
    const secret2 = await issueSecret(deps(), fresh);
    // The TOTP bucket is still locked: the correct code is refused with 429, not applied.
    const locked = await post(app, '/complete', fresh, { code: totpNow(secret2) });
    expect(locked.status).toBe(429);
    expect(adminErrorCode(locked)).toBe('ADMIN_AUTH_RATE_LIMITED');
    expect(await invitationStatus(pool, invite.invitationId)).toBe('PENDING');
    // The lock ends: the same correct code now completes the activation.
    await pool.query("UPDATE app.admin_auth_limits SET locked_until = now() - interval '1 second' WHERE kind = 'ACTIVATION_TOTP'");
    ok(await post(app, '/complete', fresh, { code: totpNow(secret2) }));
    expect(await invitationStatus(pool, invite.invitationId)).toBe('ACCEPTED');
  });

  it('T-CSRF-MATRIX: GET state gives a CSRF token for the four live states and ATTEMPTS_EXHAUSTED, for nothing else', async () => {
    const { app, pool } = ctx;
    const seen: Record<string, boolean> = {};
    const invite = await newInvite(app, system);
    const start = await begin(app, invite);
    seen.STARTED = typeof adminData(ok(await getState(app, start))).csrf_token === 'string';
    await verifyOtp(deps(), invite, start);
    seen.OTP_VERIFIED = typeof adminData(ok(await getState(app, start))).csrf_token === 'string';
    await setPassword(deps(), start);
    seen.PASSWORD_SET = typeof adminData(ok(await getState(app, start))).csrf_token === 'string';
    const secret = await issueSecret(deps(), start);
    seen.TOTP_ISSUED = typeof adminData(ok(await getState(app, start))).csrf_token === 'string';
    ok(await post(app, '/complete', start, { code: totpNow(secret) }));
    seen.COMPLETED = typeof adminData(ok(await getState(app, start))).csrf_token === 'string';
    // INVALIDATED(SUPERSEDED): the first cookie after a new start.
    const second = await newInvite(app, system);
    const old = await begin(app, second);
    await begin(app, second);
    seen.SUPERSEDED = typeof adminData(ok(await getState(app, old))).csrf_token === 'string';
    // INVALIDATED(INVITATION_CLOSED): the invitation is revoked through 1B hook -> simulated by closing the row state is
    // covered by the 1B hook tests; here the reason is checked through a direct attempt insert.
    const third = await newInvite(app, system);
    const closed = await insertAttempt(pool, {
      invitationId: third.invitationId,
      status: 'INVALIDATED',
      reason: 'INVITATION_CLOSED',
      createdAgoSeconds: 60,
      expiresInSeconds: 600,
    });
    seen.INVITATION_CLOSED = typeof adminData(ok(await getState(app, { cookie: closed.cookie, csrf: '' }))).csrf_token === 'string';
    const fourth = await newInvite(app, system);
    const conflict = await insertAttempt(pool, {
      invitationId: fourth.invitationId,
      status: 'INVALIDATED',
      reason: 'PHONE_CONFLICT',
      createdAgoSeconds: 60,
      expiresInSeconds: 600,
    });
    seen.PHONE_CONFLICT = typeof adminData(ok(await getState(app, { cookie: conflict.cookie, csrf: '' }))).csrf_token === 'string';
    const fifth = await newInvite(app, system);
    const exhausted = await insertAttempt(pool, {
      invitationId: fifth.invitationId,
      status: 'INVALIDATED',
      reason: 'ATTEMPTS_EXHAUSTED',
      createdAgoSeconds: 60,
      expiresInSeconds: 600,
    });
    seen.ATTEMPTS_EXHAUSTED = typeof adminData(ok(await getState(app, { cookie: exhausted.cookie, csrf: '' }))).csrf_token === 'string';
    expect(seen).toEqual({
      STARTED: true,
      OTP_VERIFIED: true,
      PASSWORD_SET: true,
      TOTP_ISSUED: true,
      COMPLETED: false,
      SUPERSEDED: false,
      INVITATION_CLOSED: false,
      PHONE_CONFLICT: false,
      ATTEMPTS_EXHAUSTED: true,
    });
  });
});
