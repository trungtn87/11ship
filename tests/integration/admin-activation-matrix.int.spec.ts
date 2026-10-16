import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { parseRevokeBody } from '../../apps/backend/src/admin-provisioning/admin-provisioning-validation';
import { Argon2idPasswordHasher } from '../../apps/backend/src/auth/password-hasher';
import { generateToken } from '../../apps/backend/src/auth/tokens';
import { poolClientSource } from '../../apps/backend/src/transaction/pg-client-source';
import { eventually } from './support/async-helpers';
import { ADMIN_PASSWORD, adminData, adminErrorCode, AdminResponse, cookieFrom, totpNow } from './support/admin-fixtures';
import {
  ACTIVATION_COOKIE,
  act,
  Act,
  ActivationApp,
  advance,
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
  Invite,
  newInvite,
  ok,
  post,
  startActivationApp,
  Stage,
} from './support/activation-fixtures';
import { waitUntilDbClockPast } from './support/lock-fixtures';
import { directServices, stepUp, SystemSession, systemSession } from './support/provisioning-fixtures';

// M01-D-ADMIN-1C - contract 11.2 as an executable table: 8 routes x 6 states (INVALIDATED in its 4 reasons), every state
// built through the REAL routes (supersede by a second start, five wrong TOTP codes, a real 1B revoke, a taken phone).
// Cells that PROCESS (a write path) are covered by the flow/schedule specs; here every other cell must answer exactly as
// the contract says AND leave attempts, challenges, invitation, users, audit and the business buckets untouched.

const STEP = 'ADMIN_ACTIVATION_STEP_INVALID';
const SESSION = 'ADMIN_ACTIVATION_SESSION_INVALID';
const LINK = 'ADMIN_ACTIVATION_LINK_INVALID';
const PHONE = 'ADMIN_PHONE_CONFLICT';

type Label = 'STARTED' | 'OTP_VERIFIED' | 'PASSWORD_SET' | 'TOTP_ISSUED' | 'COMPLETED' | 'SUPERSEDED' | 'INVITATION_CLOSED' | 'PHONE_CONFLICT' | 'ATTEMPTS_EXHAUSTED';
type Route = 'verify' | 'password' | 'enrollment' | 'complete' | 'otp/request' | 'restart' | 'start (valid cookie)' | 'GET state';
type Expectation = 'process' | { readonly status: number; readonly code?: string; readonly state?: string };

const ROUTES: readonly Route[] = ['verify', 'password', 'enrollment', 'complete', 'otp/request', 'restart', 'start (valid cookie)', 'GET state'];
const LABELS: readonly Label[] = [
  'STARTED',
  'OTP_VERIFIED',
  'PASSWORD_SET',
  'TOTP_ISSUED',
  'COMPLETED',
  'SUPERSEDED',
  'INVITATION_CLOSED',
  'PHONE_CONFLICT',
  'ATTEMPTS_EXHAUSTED',
];

const refused = (code: string = STEP, status = 409): Expectation => ({ status, code });

/** Contract 11.2, column by column. */
function expected(label: Label, route: Route): Expectation {
  const invalidated = label === 'SUPERSEDED' || label === 'INVITATION_CLOSED' || label === 'PHONE_CONFLICT' || label === 'ATTEMPTS_EXHAUSTED';
  switch (route) {
    case 'verify':
      return label === 'STARTED' ? 'process' : refused();
    case 'password':
      return label === 'OTP_VERIFIED' ? 'process' : refused();
    case 'enrollment':
      if (label === 'PASSWORD_SET') {
        return 'process';
      }
      return label === 'TOTP_ISSUED' ? { status: 200 } : refused();
    case 'complete':
      if (label === 'TOTP_ISSUED') {
        return 'process';
      }
      if (label === 'COMPLETED') {
        return { status: 200, state: 'COMPLETED' };
      }
      return label === 'PHONE_CONFLICT' ? refused(PHONE) : refused();
    case 'otp/request':
      return label === 'STARTED' ? 'process' : refused();
    case 'restart':
      if (label === 'COMPLETED' || label === 'SUPERSEDED' || label === 'INVITATION_CLOSED' || label === 'PHONE_CONFLICT') {
        return refused();
      }
      return 'process';
    case 'start (valid cookie)':
      if (label === 'COMPLETED') {
        return { status: 200, state: 'COMPLETED' };
      }
      if (label === 'SUPERSEDED' || label === 'ATTEMPTS_EXHAUSTED') {
        return 'process';
      }
      if (invalidated) {
        return refused(LINK, 404);
      }
      return { status: 200 };
    case 'GET state':
      return { status: 200, state: invalidated ? 'INVALIDATED' : label };
  }
}

describe('M01-D-ADMIN-1C - contract 11.2 matrix (8 routes x 6 states, INVALIDATED in 4 reasons)', () => {
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

  async function takePhone(phone: string): Promise<void> {
    await ctx.pool.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
       VALUES ($1::uuid, $2, $3, now(), 'ADMIN_PROVISIONED', 'ACTIVE', 1, now(), now())`,
      [randomUUID(), phone, await new Argon2idPasswordHasher().hash(ADMIN_PASSWORD)],
    );
  }

  async function revoke(invitationId: string): Promise<void> {
    const operationId = await stepUp(ctx.app, system, 'REVOKE_INVITATION', { invitation_id: invitationId, expected_version: 1, reason: 'r' });
    const services = directServices(ctx.app, poolClientSource(ctx.pool));
    await services.invitations.revoke(
      system.login.cookie,
      system.login.csrf,
      parseRevokeBody(invitationId, { operation_id: operationId, expected_version: 1, reason: 'r' }),
      randomUUID(),
      { requestId: randomUUID() },
    );
  }

  /** The state, built through real operations. `secret` is the TOTP secret while it is still known. */
  async function build(label: Label): Promise<{ invite: Invite; session: Act }> {
    const invite = await newInvite(ctx.app, system);
    const through = async (stage: Stage): Promise<Act> => (await advance(deps(), invite, stage)).session;
    switch (label) {
      case 'STARTED':
        return { invite, session: await through('START') };
      case 'OTP_VERIFIED':
        return { invite, session: await through('OTP_VERIFIED') };
      case 'PASSWORD_SET':
        return { invite, session: await through('PASSWORD_SET') };
      case 'TOTP_ISSUED':
        return { invite, session: await through('TOTP_ISSUED') };
      case 'COMPLETED': {
        const progress = await advance(deps(), invite, 'TOTP_ISSUED');
        ok(await post(ctx.app, '/complete', progress.session, { code: totpNow(String(progress.secret)) }));
        return { invite, session: progress.session };
      }
      case 'SUPERSEDED': {
        const old = await begin(ctx.app, invite);
        await begin(ctx.app, invite); // no cookie: a new attempt, the old one is superseded
        return { invite, session: old };
      }
      case 'INVITATION_CLOSED': {
        const session = await through('PASSWORD_SET');
        await revoke(invite.invitationId);
        return { invite, session };
      }
      case 'PHONE_CONFLICT': {
        const progress = await advance(deps(), invite, 'TOTP_ISSUED');
        await takePhone(invite.phone.normalized);
        const response = await post(ctx.app, '/complete', progress.session, { code: totpNow(String(progress.secret)) });
        expect(response.status).toBe(409);
        expect(adminErrorCode(response)).toBe(PHONE);
        return { invite, session: progress.session };
      }
      case 'ATTEMPTS_EXHAUSTED': {
        const progress = await advance(deps(), invite, 'TOTP_ISSUED');
        for (let step = 9; step < 14; step += 1) {
          const response = await post(ctx.app, '/complete', progress.session, { code: totpNow(String(progress.secret), step) });
          if (step < 13) {
            expect(response.status).toBe(400);
            expect(adminErrorCode(response)).toBe('ADMIN_TOTP_INVALID');
          } else {
            // The fifth wrong code invalidates the attempt AND fills the 5/15 min TOTP bucket: contract section 8, 429.
            expect(response.status).toBe(429);
            expect(adminErrorCode(response)).toBe('ADMIN_AUTH_RATE_LIMITED');
            expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
          }
        }
        return { invite, session: progress.session };
      }
    }
  }

  const users = async (phone: string): Promise<number> =>
    Number((await ctx.pool.query<{ n: string }>('SELECT count(*)::text AS n FROM app.users WHERE phone_normalized = $1', [phone])).rows[0]?.n);

  /** Everything a "—" cell must leave alone. The ingress bucket is the one allowed change. */
  async function footprint(invite: Invite): Promise<unknown> {
    const attempts = await attemptsOf(ctx.pool, invite.invitationId);
    const challenges: unknown[] = [];
    for (const attempt of attempts) {
      challenges.push(...(await challengesOf(ctx.pool, attempt.attempt_id)).map((row) => [row.challenge_id, row.status, row.attempt_count, row.xmin]));
    }
    return {
      attempts: attempts.map((row) => [row.attempt_id, row.status, row.invalidated_reason, row.totp_attempt_count, row.xmin]),
      challenges,
      invitation: await invitationStatus(ctx.pool, invite.invitationId),
      users: await users(invite.phone.normalized),
      audit: await auditCount(ctx.pool, ''),
      buckets: (
        await ctx.pool.query("SELECT * FROM app.admin_auth_limits WHERE kind NOT IN ('ACTIVATION_REQUEST_IP', 'ACTIVATION_LINK_IP') ORDER BY bucket_key")
      ).rows,
      sends: ctx.provider.sendStarted(),
    };
  }

  function call(route: Route, invite: Invite, session: Act): Promise<AdminResponse> {
    switch (route) {
      case 'verify':
        return post(ctx.app, '/otp/verify', session, { code: '123456' });
      case 'password':
        return post(ctx.app, '/password', session, { password: ADMIN_PASSWORD });
      case 'enrollment':
        return post(ctx.app, '/totp/enrollment', session);
      case 'complete':
        return post(ctx.app, '/complete', session, { code: '123456' });
      case 'otp/request':
        return post(ctx.app, '/otp/request', session);
      case 'restart':
        return post(ctx.app, '/restart', session);
      case 'start (valid cookie)':
        return act(ctx.app, 'POST', '/start', { body: { token: invite.token }, cookies: cookiesOf(session) });
      case 'GET state':
        return getState(ctx.app, session);
    }
  }

  it.each(LABELS)('state %s: every non-processing route answers as 11.2 says and writes nothing', async (label) => {
    const { invite, session } = await build(label);
    for (const route of ROUTES) {
      const want = expected(label, route);
      if (want === 'process') {
        continue;
      }
      await ctx.app.clearLimits();
      const before = await footprint(invite);
      const linkBefore = await bucketFailures(ctx.pool, 'ACTIVATION_LINK_IP');
      const response = await call(route, invite, session);
      const cell = { label, route, status: response.status, code: adminErrorCode(response) };
      expect(cell).toEqual({ label, route, status: want.status, code: want.code });
      if (want.state !== undefined) {
        expect({ label, route, state: adminData(response).state }).toEqual({ label, route, state: want.state });
      }
      expect({ label, route, footprint: await footprint(invite) }).toEqual({ label, route, footprint: before });
      // DEVIATION 9 (documented): the uniform 404 of start counts ONE link failure (contract 10.1 step 6 and 8), although the
      // 11.2 legend writes "-" for these cells. Nothing else may change.
      const countsLink = route === 'start (valid cookie)' && want.code === LINK;
      expect({ label, route, link: await bucketFailures(ctx.pool, 'ACTIVATION_LINK_IP') }).toEqual({ label, route, link: linkBefore + (countsLink ? 1 : 0) });
    }
  });

  it('a repeated enrollment replays the SAME secret (TOTP_ISSUED), and a repeated complete on COMPLETED ignores a LOCKED TOTP bucket', async () => {
    const invite = await newInvite(ctx.app, system);
    const progress = await advance(deps(), invite, 'TOTP_ISSUED');
    const again = ok(await post(ctx.app, '/totp/enrollment', progress.session));
    expect(adminData(again).secret).toBe(progress.secret);
    // One wrong code creates the TOTP bucket row; the right code completes; then the bucket is locked by hand.
    await ctx.app.clearLimits();
    expect((await post(ctx.app, '/complete', progress.session, { code: totpNow(String(progress.secret), 9) })).status).toBe(400);
    ok(await post(ctx.app, '/complete', progress.session, { code: totpNow(String(progress.secret)) }));
    const locked = await ctx.pool.query(
      `UPDATE app.admin_auth_limits SET failure_count = 5, locked_until = now() + interval '1 hour', updated_at = now() WHERE kind = 'ACTIVATION_TOTP'`,
    );
    expect(locked.rowCount).toBeGreaterThan(0);
    const before = await bucketRows(ctx.pool, 'ACTIVATION_REQUEST_IP');
    const repeat = ok(await post(ctx.app, '/complete', progress.session, { code: '000000' }));
    expect(adminData(repeat)).toMatchObject({ state: 'COMPLETED' });
    expect(await bucketRows(ctx.pool, 'ACTIVATION_REQUEST_IP')).toEqual(before);
  });

  describe('row 0 and the start variants', () => {
    it('an unknown cookie is 401 SESSION_INVALID on every route except start, with the cookie cleared', async () => {
      const { invite } = await build('STARTED');
      const stranger: Act = { cookie: 'a'.repeat(43), csrf: 'x' };
      for (const route of ROUTES.filter((route) => route !== 'start (valid cookie)')) {
        await ctx.app.clearLimits();
        const response = await call(route, invite, stranger);
        expect({ route, status: response.status, code: adminErrorCode(response) }).toEqual({ route, status: 401, code: SESSION });
        expect(response.setCookie.some((line) => line.startsWith(`${ACTIVATION_COOKIE}=;`))).toBe(true);
      }
    });

    it('start with an invalid cookie: PENDING invitation -> a new attempt (201); a closed or accepted one -> 404 LINK_INVALID', async () => {
      const pending = await newInvite(ctx.app, system);
      const response = await act(ctx.app, 'POST', '/start', { body: { token: pending.token }, cookies: { [ACTIVATION_COOKIE]: 'b'.repeat(43) } });
      expect(response.status).toBe(201);
      expect(cookieFrom(response, ACTIVATION_COOKIE)).toBeTruthy();
      const { invite: accepted } = await build('COMPLETED');
      const { invite: closed } = await build('INVITATION_CLOSED');
      for (const invite of [accepted, closed]) {
        await ctx.app.clearLimits();
        const before = await footprint(invite);
        const linkBefore = await bucketFailures(ctx.pool, 'ACTIVATION_LINK_IP');
        const refusedStart = await act(ctx.app, 'POST', '/start', { body: { token: invite.token }, cookies: { [ACTIVATION_COOKIE]: 'c'.repeat(43) } });
        expect({ status: refusedStart.status, code: adminErrorCode(refusedStart) }).toEqual({ status: 404, code: LINK });
        expect(await footprint(invite)).toEqual(before);
        expect(await bucketFailures(ctx.pool, 'ACTIVATION_LINK_IP')).toBe(linkBefore + 1);
      }
    });

    it('start with a valid COMPLETED cookie but ANOTHER invitation token behaves like a cookie of another invitation', async () => {
      const { session } = await build('COMPLETED');
      const other = await newInvite(ctx.app, system);
      const response = await act(ctx.app, 'POST', '/start', { body: { token: other.token }, cookies: cookiesOf(session) });
      expect(response.status).toBe(201);
      const [attempt] = await attemptsOf(ctx.pool, other.invitationId);
      expect(attempt?.status).toBe('STARTED');
    });
  });

  describe('429 carries Retry-After', () => {
    it('DEVIATION 4 (documented for review): a malformed JSON body is the framework 400 BAD_REQUEST, rejected before the quota', async () => {
      const before = await bucketRows(ctx.pool);
      const response = await act(ctx.app, 'POST', '/start', { rawBody: '{"token":' });
      expect({ status: response.status, code: adminErrorCode(response) }).toEqual({ status: 400, code: 'BAD_REQUEST' });
      expect(await bucketRows(ctx.pool)).toEqual(before);
    });

    it('the invitation-link quota (10 wrong tokens) answers 429 ADMIN_AUTH_RATE_LIMITED with a positive integer Retry-After', async () => {
      const invite = await newInvite(ctx.app, system);
      for (let index = 0; index < 10; index += 1) {
        await act(ctx.app, 'POST', '/start', { body: { token: generateToken().token } });
      }
      const locked = await act(ctx.app, 'POST', '/start', { body: { token: invite.token } });
      expect(locked.status).toBe(429);
      expect(adminErrorCode(locked)).toBe('ADMIN_AUTH_RATE_LIMITED');
      const retryAfter = Number(locked.headers['retry-after']);
      expect(Number.isInteger(retryAfter)).toBe(true);
      expect(retryAfter).toBeGreaterThan(0);
    });

    it('the ingress quota (30 POST per minute, 401s included) answers 429 on the 31st with Retry-After <= 60', async () => {
      const stranger: Act = { cookie: 'd'.repeat(43), csrf: 'x' };
      const statuses: number[] = [];
      let last: AdminResponse | undefined;
      for (let index = 0; index < 31; index += 1) {
        last = await post(ctx.app, '/otp/request', stranger);
        statuses.push(last.status);
      }
      expect(statuses.slice(0, 30).every((status) => status === 401)).toBe(true);
      expect(statuses[30]).toBe(429);
      const retryAfter = Number(last?.headers['retry-after']);
      expect(Number.isInteger(retryAfter)).toBe(true);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(60);
    });

    it('DEVIATION 5 (documented for review): GET state is NOT metered by the ingress quota - 40 reads never answer 429 and write no bucket', async () => {
      const stranger: Act = { cookie: 'e'.repeat(43), csrf: 'x' };
      const before = await bucketRows(ctx.pool);
      for (let index = 0; index < 40; index += 1) {
        expect((await getState(ctx.app, stranger)).status).toBe(401);
      }
      expect(await bucketRows(ctx.pool)).toEqual(before);
    });
  });
});

describe('M01-D-ADMIN-1C - the session cookie expires (row 0), in every state, decided by the DATABASE clock', () => {
  let ctx: ActivationApp;
  let system: SystemSession;

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

  const routes = (invite: Invite, session: Act): [string, () => Promise<AdminResponse>][] => [
    ['verify', () => post(ctx.app, '/otp/verify', session, { code: '123456' })],
    ['password', () => post(ctx.app, '/password', session, { password: ADMIN_PASSWORD })],
    ['enrollment', () => post(ctx.app, '/totp/enrollment', session)],
    ['complete', () => post(ctx.app, '/complete', session, { code: '123456' })],
    ['otp/request', () => post(ctx.app, '/otp/request', session)],
    ['restart', () => post(ctx.app, '/restart', session)],
    ['GET state', () => getState(ctx.app, session)],
    ['start', () => act(ctx.app, 'POST', '/start', { body: { token: invite.token }, cookies: cookiesOf(session) })],
  ];

  async function expectExpired(invite: Invite, session: Act, label: string): Promise<void> {
    const attemptsBefore = (await attemptsOf(ctx.pool, invite.invitationId)).map((row) => [row.attempt_id, row.status, row.xmin]);
    const auditBefore = await auditCount(ctx.pool, '');
    const invitationBefore = await invitationStatus(ctx.pool, invite.invitationId);
    for (const [name, run] of routes(invite, session)) {
      await ctx.app.clearLimits();
      const response = await run();
      if (name === 'start') {
        // The cookie is ignored by start: the token decides. An ACCEPTED invitation is 404; a PENDING one would start anew.
        expect({ label, name, status: response.status }).toEqual({ label, name, status: invitationBefore === 'PENDING' ? 201 : 404 });
        continue;
      }
      expect({ label, name, status: response.status, code: adminErrorCode(response) }).toEqual({ label, name, status: 401, code: SESSION });
    }
    if (invitationBefore !== 'PENDING') {
      expect((await attemptsOf(ctx.pool, invite.invitationId)).map((row) => [row.attempt_id, row.status, row.xmin])).toEqual(attemptsBefore);
      expect(await auditCount(ctx.pool, '')).toBe(auditBefore);
    }
  }

  it('COMPLETED: after the attempt expiry every route is 401, start is 404 (ACCEPTED) and nothing is written', async () => {
    const invite = await newInvite(ctx.app, system);
    // The attempt lifetime is 30 minutes and expires_at is immutable, so the COMPLETED attempt of this test is born from an
    // INSERT at PASSWORD_SET with a 20 s lifetime; enrollment and complete are then the REAL routes.
    const row = await insertAttempt(ctx.pool, { invitationId: invite.invitationId, status: 'PASSWORD_SET', createdAgoSeconds: 5, expiresInSeconds: 20 });
    const state = adminData(ok(await getState(ctx.app, { cookie: row.cookie, csrf: '' })));
    const session: Act = { cookie: row.cookie, csrf: String(state.csrf_token) };
    const issued = ok(await post(ctx.app, '/totp/enrollment', session));
    ok(await post(ctx.app, '/complete', session, { code: totpNow(String(adminData(issued).secret)) }));
    expect(adminData(ok(await getState(ctx.app, session))).state).toBe('COMPLETED'); // before the expiry the answer is still 200 (TX-P)
    expect(await invitationStatus(ctx.pool, invite.invitationId)).toBe('ACCEPTED');
    await eventually(
      async () =>
        (await ctx.pool.query<{ past: boolean }>('SELECT clock_timestamp() > expires_at AS past FROM app.admin_activation_attempts WHERE attempt_id = $1::uuid', [row.attemptId])).rows[0]
          ?.past === true,
      'the database clock to pass the COMPLETED attempt expiry',
      30_000,
    );
    await expectExpired(invite, session, 'COMPLETED');
  }, 60_000);

  it('STARTED, OTP_VERIFIED, PASSWORD_SET, TOTP_ISSUED and INVALIDATED: expires_at chosen at INSERT, the DB clock walks past it, then 401 everywhere', async () => {
    const statuses = ['STARTED', 'OTP_VERIFIED', 'PASSWORD_SET', 'TOTP_ISSUED'] as const;
    const made: { invite: Invite; cookie: string; attemptId: string; label: string }[] = [];
    for (const status of statuses) {
      const invite = await newInvite(ctx.app, system);
      const row = await insertAttempt(ctx.pool, { invitationId: invite.invitationId, status, createdAgoSeconds: 60, expiresInSeconds: 8 });
      made.push({ invite, cookie: row.cookie, attemptId: row.attemptId, label: status });
    }
    const gone = await newInvite(ctx.app, system);
    const invalidated = await insertAttempt(ctx.pool, {
      invitationId: gone.invitationId,
      status: 'INVALIDATED',
      reason: 'SUPERSEDED',
      createdAgoSeconds: 60,
      expiresInSeconds: 8,
    });
    made.push({ invite: gone, cookie: invalidated.cookie, attemptId: invalidated.attemptId, label: 'INVALIDATED' });
    // Before the expiry the same cookies are accepted (GET state) - the 401 below is the expiry, nothing else.
    for (const entry of made) {
      const early = await getState(ctx.app, { cookie: entry.cookie, csrf: '' });
      expect({ label: entry.label, status: early.status }).toEqual({ label: entry.label, status: 200 });
    }
    for (const entry of made) {
      await waitUntilDbClockPast(ctx.pool, 'SELECT expires_at FROM app.admin_activation_attempts WHERE attempt_id = $1::uuid', [entry.attemptId]);
    }
    for (const entry of made) {
      const session: Act = { cookie: entry.cookie, csrf: 'x' };
      const attemptsBefore = (await attemptsOf(ctx.pool, entry.invite.invitationId)).map((row) => [row.attempt_id, row.status, row.xmin]);
      for (const [name, run] of routes(entry.invite, session)) {
        if (name === 'start') {
          continue; // start ignores the cookie and would create a new attempt for a PENDING invitation (tested elsewhere)
        }
        await ctx.app.clearLimits();
        const response = await run();
        expect({ label: entry.label, name, status: response.status, code: adminErrorCode(response) }).toEqual({
          label: entry.label,
          name,
          status: 401,
          code: SESSION,
        });
      }
      expect((await attemptsOf(ctx.pool, entry.invite.invitationId)).map((row) => [row.attempt_id, row.status, row.xmin])).toEqual(attemptsBefore);
    }
  }, 60_000);
});
