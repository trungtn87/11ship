import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { Argon2idPasswordHasher } from '../../apps/backend/src/auth/password-hasher';
import { generateToken } from '../../apps/backend/src/auth/tokens';
import { adminData, adminErrorCode } from './support/admin-fixtures';
import {
  act,
  ActivationApp,
  attemptsOf,
  challengesOf,
  cookiesOf,
  getState,
  insertAttempt,
  insertChallenge,
  invitationStatus,
  newInvite,
  ok,
  startActivationApp,
} from './support/activation-fixtures';
import { holdRowLock, waitForBlockedBackends, waitUntilDbClockPast } from './support/lock-fixtures';
import { api, sessionOf, stepUp, SystemSession, systemSession } from './support/provisioning-fixtures';
import { randomPhone } from './support/auth-fixtures';

// M01-D-ADMIN-1C - the wait for the challenge lock (L9b) happens BEFORE the clock `T` is read.
//
// txn2 of otp/request (the late delivery outcome) locks only the CHALLENGE row, without the attempt lock. A start / restart /
// phone-conflict closing / 1B hook that needs that challenge must therefore take it before it reads the DB clock; otherwise it
// waits AFTER reading `T`, and then decides and writes with a clock that is older than the lock it just obtained. Each test
// holds the live challenge on its own connection (what txn2 holds), sends the request, waits until it is really blocked, lets
// the DATABASE clock pass an expiry, releases, and checks the answer and that nothing was written with the old clock.
// Expiries are 3 s, leaving scheduler headroom below the 10 s test lock_timeout.
// The barrier and DATABASE clock still decide the order; no sleep orders anything.

describe('M01-D-ADMIN-1C - T is read after the challenge lock (start / restart / phone conflict / 1B hook)', () => {
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

  interface Setup {
    readonly invitationId: string;
    readonly token: string;
    readonly phone: string;
    readonly attemptId: string;
    readonly challengeId: string;
    readonly session: { cookie: string; csrf: string };
  }

  /** An invitation that expires after `seconds` (1B enforces a 1 h minimum, so it is INSERTed like the other short expiries). */
  async function shortInvitation(seconds: number): Promise<{ invitationId: string; token: string; phone: string }> {
    const phone = randomPhone();
    ctx.app.track(phone.normalized);
    const invitationId = randomUUID();
    const token = generateToken();
    const client = await ctx.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO app.admin_invitations
           (invitation_id, generation_id, phone_normalized, full_name, note, token_digest, status, version, created_by,
            created_at, expires_at, snapshot_sealed)
         VALUES ($1::uuid, $2::uuid, $3, 'Short Lived', NULL, $4, 'PENDING', 1, $5::uuid,
                 now() - interval '1 hour', now() + make_interval(secs => $6::int), false)`,
        [invitationId, randomUUID(), phone.normalized, token.digest, system.account.userId, seconds],
      );
      await client.query(
        `INSERT INTO app.admin_invitation_permissions (invitation_id, app, can_view, can_review_profile, can_lock)
         VALUES ($1::uuid, 'SHOP', true, false, false)`,
        [invitationId],
      );
      await client.query('UPDATE app.admin_invitations SET snapshot_sealed = true WHERE invitation_id = $1::uuid', [invitationId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    return { invitationId, token: token.token, phone: phone.normalized };
  }

  async function setup(input: { invitationSeconds?: number; attemptSeconds: number; phoneTaken?: boolean }): Promise<Setup> {
    let base: { invitationId: string; token: string; phone: string };
    if (input.invitationSeconds === undefined) {
      const invite = await newInvite(ctx.app, system);
      base = { invitationId: invite.invitationId, token: invite.token, phone: invite.phone.normalized };
    } else {
      base = await shortInvitation(input.invitationSeconds);
    }
    const row = await insertAttempt(ctx.pool, { invitationId: base.invitationId, status: 'STARTED', createdAgoSeconds: 5, expiresInSeconds: input.attemptSeconds });
    const challengeId = await insertChallenge(ctx, {
      attemptId: row.attemptId,
      phoneNormalized: base.phone,
      otp: '246810',
      status: 'PENDING',
      createdAgoSeconds: 5,
      expiresInSeconds: 300,
    });
    const state = adminData(ok(await getState(ctx.app, { cookie: row.cookie, csrf: '' })));
    if (input.phoneTaken === true) {
      await ctx.pool.query(
        `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
         VALUES ($1::uuid, $2, $3, now(), 'PHONE_VERIFIED', 'ACTIVE', 1, now(), now())`,
        [randomUUID(), base.phone, await new Argon2idPasswordHasher().hash('Another-Passw0rd-1')],
      );
    }
    return { ...base, attemptId: row.attemptId, challengeId, session: { cookie: row.cookie, csrf: String(state.csrf_token) } };
  }

  const auditTotal = async (): Promise<number> => Number((await ctx.pool.query<{ n: string }>('SELECT count(*)::text AS n FROM app.audit_logs')).rows[0]?.n);

  async function snapshot(s: Setup): Promise<unknown> {
    return {
      attempts: (await attemptsOf(ctx.pool, s.invitationId)).map((row) => [row.attempt_id, row.status, row.invalidated_reason, row.xmin]),
      challenges: (await challengesOf(ctx.pool, s.attemptId)).map((row) => [row.challenge_id, row.status, row.xmin]),
      invitation: await invitationStatus(ctx.pool, s.invitationId),
      audit: await auditTotal(),
    };
  }

  /**
   * Holds the live challenge like txn2 does, runs `request`, waits until it is blocked, lets the DB clock pass `expirySql`
   * (when given), and releases. Returns the response and a DB timestamp taken just BEFORE the release.
   */
  async function whileChallengeHeld<T>(
    s: Setup,
    request: () => Promise<T>,
    expirySql?: { sql: string; values: unknown[] },
  ): Promise<{ response: T; beforeRelease: Date }> {
    const held = await holdRowLock(ctx.pool, 'SELECT 1 FROM app.admin_activation_otp_challenges WHERE challenge_id = $1::uuid FOR UPDATE', [s.challengeId]);
    try {
      const pending = request();
      await waitForBlockedBackends(ctx.pool);
      if (expirySql !== undefined) {
        await waitUntilDbClockPast(ctx.pool, expirySql.sql, expirySql.values);
      }
      const beforeRelease = (await ctx.pool.query<{ t: Date }>('SELECT clock_timestamp() AS t')).rows[0]?.t as Date;
      await held.release();
      return { response: await pending, beforeRelease };
    } finally {
      await held.release();
    }
  }

  const invitationExpiry = (s: Setup): { sql: string; values: unknown[] } => ({
    sql: 'SELECT expires_at FROM app.admin_invitations WHERE invitation_id = $1::uuid',
    values: [s.invitationId],
  });
  const attemptExpiry = (s: Setup): { sql: string; values: unknown[] } => ({
    sql: 'SELECT expires_at FROM app.admin_activation_attempts WHERE attempt_id = $1::uuid',
    values: [s.attemptId],
  });
  const startCall = (s: Setup) => () => act(ctx.app, 'POST', '/start', { body: { token: s.token }, cookies: cookiesOf(s.session) });
  const restartCall = (s: Setup) => () => act(ctx.app, 'POST', '/restart', { body: {}, cookies: cookiesOf(s.session), csrf: s.session.csrf });

  it('start: the invitation expires while start waits for the challenge - 404, no new attempt, nothing superseded', async () => {
    const s = await setup({ invitationSeconds: 3, attemptSeconds: 600 });
    const before = await snapshot(s);
    const { response } = await whileChallengeHeld(s, startCall(s), invitationExpiry(s));
    expect(response.status).toBe(404);
    expect(adminErrorCode(response)).toBe('ADMIN_ACTIVATION_LINK_INVALID');
    expect(response.setCookie).toEqual([]);
    expect(await snapshot(s)).toEqual(before);
  });

  it('start: the cookie attempt expires while start waits, the invitation is still valid - the expired attempt is REPLACED (not resumed), with the new clock', async () => {
    const s = await setup({ attemptSeconds: 3 });
    const { response, beforeRelease } = await whileChallengeHeld(s, startCall(s), attemptExpiry(s));
    expect(response.status).toBe(201);
    const attempts = await attemptsOf(ctx.pool, s.invitationId);
    expect(attempts.map((row) => [row.status, row.invalidated_reason])).toEqual([
      ['INVALIDATED', 'SUPERSEDED'],
      ['STARTED', null],
    ]);
    expect((await challengesOf(ctx.pool, s.attemptId)).map((row) => row.status)).toEqual(['INVALIDATED']);
    const times = await ctx.pool.query<{ closed: boolean; challenge: boolean; created: boolean }>(
      `SELECT a.invalidated_at >= $2::timestamptz AS closed,
              (SELECT c.ended_at >= $2::timestamptz FROM app.admin_activation_otp_challenges c WHERE c.attempt_id = a.attempt_id) AS challenge,
              (SELECT n.created_at >= $2::timestamptz FROM app.admin_activation_attempts n WHERE n.invitation_id = a.invitation_id AND n.status = 'STARTED') AS created
         FROM app.admin_activation_attempts a WHERE a.attempt_id = $1::uuid`,
      [s.attemptId, beforeRelease],
    );
    expect(times.rows[0]).toEqual({ closed: true, challenge: true, created: true });
  });

  it('restart: the invitation expires while restart waits for the challenge - 404, no new attempt, nothing superseded', async () => {
    const s = await setup({ invitationSeconds: 3, attemptSeconds: 600 });
    const before = await snapshot(s);
    const { response } = await whileChallengeHeld(s, restartCall(s), invitationExpiry(s));
    expect(response.status).toBe(404);
    expect(adminErrorCode(response)).toBe('ADMIN_ACTIVATION_LINK_INVALID');
    expect(await snapshot(s)).toEqual(before);
  });

  it('restart: the COOKIE expires while restart waits - 401 (restart needs a valid cookie), no new attempt, nothing superseded', async () => {
    const s = await setup({ attemptSeconds: 3 });
    const before = await snapshot(s);
    const { response } = await whileChallengeHeld(s, restartCall(s), attemptExpiry(s));
    expect(response.status).toBe(401);
    expect(adminErrorCode(response)).toBe('ADMIN_ACTIVATION_SESSION_INVALID');
    expect(await snapshot(s)).toEqual(before);
  });

  it('start with the phone already taken: the invitation expires while waiting - 404, NOT PHONE_CONFLICT; nothing closed or audited', async () => {
    const s = await setup({ invitationSeconds: 3, attemptSeconds: 600, phoneTaken: true });
    const before = await snapshot(s);
    const { response } = await whileChallengeHeld(s, startCall(s), invitationExpiry(s));
    expect(response.status).toBe(404);
    expect(adminErrorCode(response)).toBe('ADMIN_ACTIVATION_LINK_INVALID');
    expect(await snapshot(s)).toEqual(before);
    expect(await invitationStatus(ctx.pool, s.invitationId)).toBe('PENDING');
  });

  it('restart with the phone already taken: the cookie expires while waiting - 401, NOT PHONE_CONFLICT; nothing closed or audited', async () => {
    const s = await setup({ attemptSeconds: 3, phoneTaken: true });
    const before = await snapshot(s);
    const { response } = await whileChallengeHeld(s, restartCall(s), attemptExpiry(s));
    expect(response.status).toBe(401);
    expect(await snapshot(s)).toEqual(before);
    expect(await invitationStatus(ctx.pool, s.invitationId)).toBe('PENDING');
  });

  it('start with the phone taken and NOTHING expiring: PHONE_CONFLICT closes attempt and challenge with a clock read after the wait', async () => {
    const s = await setup({ attemptSeconds: 600, phoneTaken: true });
    const { response, beforeRelease } = await whileChallengeHeld(s, startCall(s));
    expect(response.status).toBe(409);
    expect(adminErrorCode(response)).toBe('ADMIN_PHONE_CONFLICT');
    expect(await invitationStatus(ctx.pool, s.invitationId)).toBe('PHONE_CONFLICT');
    expect((await attemptsOf(ctx.pool, s.invitationId)).map((row) => [row.status, row.invalidated_reason])).toEqual([['INVALIDATED', 'PHONE_CONFLICT']]);
    expect((await challengesOf(ctx.pool, s.attemptId)).map((row) => row.status)).toEqual(['INVALIDATED']);
    const times = await ctx.pool.query<{ closed: boolean; challenge: boolean }>(
      `SELECT a.invalidated_at >= $2::timestamptz AS closed,
              (SELECT c.ended_at >= $2::timestamptz FROM app.admin_activation_otp_challenges c WHERE c.attempt_id = a.attempt_id) AS challenge
         FROM app.admin_activation_attempts a WHERE a.attempt_id = $1::uuid`,
      [s.attemptId, beforeRelease],
    );
    expect(times.rows[0]).toEqual({ closed: true, challenge: true });
  });

  it('1B revoke hook: waits for the challenge held by txn2, then closes attempt and challenge with a clock read after the wait', async () => {
    const s = await setup({ attemptSeconds: 600 });
    const operationId = await stepUp(ctx.app, system, 'REVOKE_INVITATION', { invitation_id: s.invitationId, expected_version: 1, reason: 'r' });
    const { response, beforeRelease } = await whileChallengeHeld(s, () =>
      api(ctx.app, 'POST', `/invitations/${s.invitationId}/revoke`, {
        body: { operation_id: operationId, expected_version: 1, reason: 'r' },
        headers: { 'idempotency-key': randomUUID() },
        ...sessionOf(system),
      }),
    );
    expect(response.status).toBe(200);
    expect((await attemptsOf(ctx.pool, s.invitationId)).map((row) => [row.status, row.invalidated_reason])).toEqual([['INVALIDATED', 'INVITATION_CLOSED']]);
    expect((await challengesOf(ctx.pool, s.attemptId)).map((row) => row.status)).toEqual(['INVALIDATED']);
    const times = await ctx.pool.query<{ closed: boolean; challenge: boolean }>(
      `SELECT a.invalidated_at >= $2::timestamptz AS closed,
              (SELECT c.ended_at >= $2::timestamptz FROM app.admin_activation_otp_challenges c WHERE c.attempt_id = a.attempt_id) AS challenge
         FROM app.admin_activation_attempts a WHERE a.attempt_id = $1::uuid`,
      [s.attemptId, beforeRelease],
    );
    expect(times.rows[0]).toEqual({ closed: true, challenge: true });
  });
});
