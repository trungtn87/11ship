import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { parseReissueBody, parseRevokeBody } from '../../apps/backend/src/admin-provisioning/admin-provisioning-validation';
import { AdminActivationService } from '../../apps/backend/src/admin-activation/admin-activation-service';
import { poolClientSource } from '../../apps/backend/src/transaction/pg-client-source';
import { TransactionClientSource } from '../../apps/backend/src/transaction/transaction-manager';
import { Argon2idPasswordHasher } from '../../apps/backend/src/auth/password-hasher';
import { ADMIN_PASSWORD, adminData, totpNow } from './support/admin-fixtures';
import {
  ATTEMPT_X,
  advance,
  ActivationApp,
  answerOf,
  attemptsOf,
  auditCount,
  begin,
  bucketFailures,
  challengesOf,
  codeOf,
  directActivation,
  getState,
  insertAttempt,
  insertChallenge,
  INVITATION_X,
  invitationStatus,
  liveAttempts,
  newInvite,
  ok,
  post,
  schedule,
  sendOtp,
  Settled,
  startActivationApp,
  Stage,
  Act,
  Invite,
} from './support/activation-fixtures';
import { directServices, invitationRow, stepUp, SystemSession, systemSession } from './support/provisioning-fixtures';

// M01-D-ADMIN-1C - the concurrent schedules the contract requires, decided by BARRIERS and run in BOTH orders.
// FIRST request is parked right after PostgreSQL granted the lock it needs to hold; SECOND starts only then and the
// schedule continues only when SECOND is really blocked on a lock (pg_stat_activity). The test releases FIRST. The
// Promise.all variants in admin-activation-concurrency.int.spec.ts are supplementary and prove nothing about lock order.

const META = { requestId: randomUUID(), ip: '127.0.0.1' };
const STEP_INVALID = 'ADMIN_ACTIVATION_STEP_INVALID';

describe('M01-D-ADMIN-1C - barrier schedules, both orders', () => {
  let ctx: ActivationApp;
  let system: SystemSession;
  const deps = (): { app: ActivationApp['app']; provider: ActivationApp['provider'] } => ({ app: ctx.app, provider: ctx.provider });
  const svc = (source: TransactionClientSource): AdminActivationService => directActivation(ctx, source);

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

  async function fresh(stage: Stage): Promise<{ invite: Invite; session: Act; secret?: string }> {
    const invite = await newInvite(ctx.app, system);
    const progress = await advance(deps(), invite, stage);
    return { invite, session: progress.session, ...(progress.secret === undefined ? {} : { secret: progress.secret }) };
  }

  const users = async (phone: string): Promise<number> =>
    Number((await ctx.pool.query<{ n: string }>('SELECT count(*)::text AS n FROM app.users WHERE phone_normalized = $1', [phone])).rows[0]?.n);

  const statusesOf = async (invitationId: string): Promise<string[]> => (await attemptsOf(ctx.pool, invitationId)).map((row) => `${row.status}:${row.invalidated_reason ?? ''}`);

  function expectAnswer(result: Settled<{ status: number; body: unknown }>, status: number): void {
    expect(result.ok).toBe(true);
    expect(answerOf(result).status).toBe(status);
  }

  // ----- K1, K22: complete ∥ complete ----------------------------------------------------------------------------

  it('K1: two completes with the same code - one account, both answers COMPLETED (the loser reads the result under the lock)', async () => {
    const { invite, session, secret } = await fresh('TOTP_ISSUED');
    const code = totpNow(String(secret));
    const run = await schedule(
      ctx,
      INVITATION_X,
      (gated) => svc(gated).complete(session.cookie, session.csrf, code, META),
      (plain) => svc(plain).complete(session.cookie, session.csrf, code, META),
    );
    run.release();
    const [first, second] = [await run.first, await run.second];
    expectAnswer(first, 200);
    expectAnswer(second, 200);
    expect(adminDataOf(answerOf(second))).toEqual({ state: 'COMPLETED', next: 'LOGIN' });
    expect(await users(invite.phone.normalized)).toBe(1);
    expect(await invitationStatus(ctx.pool, invite.invitationId)).toBe('ACCEPTED');
  });

  it.each(['wrong first', 'right first'] as const)('K22: wrong and right TOTP code, %s', async (order) => {
    const { invite, session, secret } = await fresh('TOTP_ISSUED');
    const right = totpNow(String(secret));
    const wrong = totpNow(String(secret), 9);
    const wrongFirst = order === 'wrong first';
    const run = await schedule(
      ctx,
      INVITATION_X,
      (gated) => svc(gated).complete(session.cookie, session.csrf, wrongFirst ? wrong : right, META),
      (plain) => svc(plain).complete(session.cookie, session.csrf, wrongFirst ? right : wrong, META),
    );
    run.release();
    const [first, second] = [await run.first, await run.second];
    const [wrongResult, rightResult] = wrongFirst ? [first, second] : [second, first];
    expectAnswer(rightResult, 200);
    if (wrongFirst) {
      // The wrong code was decided first: counted once (commit-then-throw), then the right code completes.
      expect(codeOf(wrongResult)).toBe('ADMIN_TOTP_INVALID');
      expect((await attemptsOf(ctx.pool, invite.invitationId))[0]?.totp_attempt_count).toBe(1);
      expect(await bucketFailures(ctx.pool, 'ACTIVATION_TOTP')).toBe(1);
    } else {
      // The right code completed first: the wrong one only reads COMPLETED and counts nothing.
      expectAnswer(wrongResult, 200);
      expect((await attemptsOf(ctx.pool, invite.invitationId))[0]?.totp_attempt_count).toBe(0);
      expect(await bucketFailures(ctx.pool, 'ACTIVATION_TOTP')).toBe(0);
    }
    expect(await users(invite.phone.normalized)).toBe(1);
    expect(await statusesOf(invite.invitationId)).toEqual(['COMPLETED:']);
  });

  // ----- K5, K21: start ∥ start --------------------------------------------------------------------------------

  it('K5: two starts without a cookie - one live attempt, one SUPERSEDED, both answered 201', async () => {
    const invite = await newInvite(ctx.app, system);
    const run = await schedule(
      ctx,
      INVITATION_X,
      (gated) => svc(gated).start(undefined, invite.token, META),
      (plain) => svc(plain).start(undefined, invite.token, META),
    );
    run.release();
    expectAnswer(await run.first, 201);
    expectAnswer(await run.second, 201);
    expect((await statusesOf(invite.invitationId)).sort()).toEqual(['INVALIDATED:SUPERSEDED', 'STARTED:']);
  });

  it.each(['resume first', 'new start first'] as const)('K21: start with a valid cookie and a fresh start, %s - never two live attempts', async (order) => {
    const invite = await newInvite(ctx.app, system);
    const original = await begin(ctx.app, invite);
    const resumeFirst = order === 'resume first';
    const resume = (source: TransactionClientSource): Promise<{ status: number; body: unknown }> => svc(source).start(original.cookie, invite.token, META);
    const fresher = (source: TransactionClientSource): Promise<{ status: number; body: unknown }> => svc(source).start(undefined, invite.token, META);
    const run = await schedule(
      ctx,
      INVITATION_X,
      (gated) => (resumeFirst ? resume(gated) : fresher(gated)),
      (plain) => (resumeFirst ? fresher(plain) : resume(plain)),
    );
    run.release();
    const [first, second] = [await run.first, await run.second];
    expect(first.ok && second.ok).toBe(true);
    expect((await liveAttempts(ctx.pool, invite.invitationId)).length).toBe(1);
    const statuses = await statusesOf(invite.invitationId);
    if (resumeFirst) {
      // The resume saw its own live attempt (200), then the fresh start superseded it.
      expect(answerOf(first as Settled<{ status: number }>).status).toBe(200);
      expect(statuses).toEqual(['INVALIDATED:SUPERSEDED', 'STARTED:']);
    } else {
      // The fresh start won; the old cookie now names a SUPERSEDED attempt, so the second start is a new attempt too.
      expect(answerOf(second as Settled<{ status: number }>).status).toBe(201);
      expect(statuses).toEqual(['INVALIDATED:SUPERSEDED', 'INVALIDATED:SUPERSEDED', 'STARTED:']);
    }
  });

  // ----- K6: otp/request ∥ otp/request ---------------------------------------------------------------------------

  it('K6: two OTP requests - one code is sent, the other is OTP_RATE_LIMITED and sends nothing', async () => {
    const invite = await newInvite(ctx.app, system);
    const session = await begin(ctx.app, invite);
    const run = await schedule(
      ctx,
      INVITATION_X,
      (gated) => svc(gated).requestOtp(session.cookie, session.csrf, META),
      (plain) => svc(plain).requestOtp(session.cookie, session.csrf, META),
    );
    run.release();
    expectAnswer(await run.first, 202);
    expect(codeOf(await run.second)).toBe('OTP_RATE_LIMITED');
    expect(ctx.provider.sendStarted()).toBe(1);
    const [attempt] = await liveAttempts(ctx.pool, invite.invitationId);
    expect((await challengesOf(ctx.pool, String(attempt?.attempt_id))).map((row) => row.status)).toEqual(['PENDING']);
  });

  // ----- K7: verify ∥ verify at the fifth wrong code -----------------------------------------------------------

  it.each(['wrong first', 'right first'] as const)('K7: fifth wrong code and right code, %s - LOCKED is never overwritten', async (order) => {
    const invite = await newInvite(ctx.app, system);
    const session = await begin(ctx.app, invite);
    const otp = await sendOtp(deps(), invite, session);
    const wrong = otp === '000000' ? '111111' : '000000';
    for (let index = 0; index < 4; index += 1) {
      const miss = await settleVerify(svc(poolClientSource(ctx.pool)), session, wrong);
      expect(codeOf(miss)).toBe('OTP_INVALID');
    }
    const wrongFirst = order === 'wrong first';
    const run = await schedule(
      ctx,
      ATTEMPT_X,
      (gated) => svc(gated).verifyOtp(session.cookie, session.csrf, wrongFirst ? wrong : otp, META),
      (plain) => svc(plain).verifyOtp(session.cookie, session.csrf, wrongFirst ? otp : wrong, META),
    );
    run.release();
    const [first, second] = [await run.first, await run.second];
    const [attempt] = await attemptsOf(ctx.pool, invite.invitationId);
    const [challenge] = await challengesOf(ctx.pool, String(attempt?.attempt_id));
    if (wrongFirst) {
      expect(codeOf(first)).toBe('OTP_RATE_LIMITED');
      expect(codeOf(second)).toBe('OTP_RATE_LIMITED');
      expect(challenge).toMatchObject({ status: 'LOCKED', attempt_count: 5 });
      expect(attempt?.status).toBe('STARTED');
    } else {
      expectAnswer(first, 200);
      expect(codeOf(second)).toBe(STEP_INVALID);
      expect(challenge).toMatchObject({ status: 'VERIFIED', attempt_count: 4 });
      expect(attempt?.status).toBe('OTP_VERIFIED');
    }
  });

  // ----- K13: resend ∥ verify -----------------------------------------------------------------------------------

  async function startedWithOldChallenge(): Promise<{ invite: Invite; session: Act; attemptId: string; challengeId: string }> {
    const invite = await newInvite(ctx.app, system);
    const session = await begin(ctx.app, invite);
    const [attempt] = await liveAttempts(ctx.pool, invite.invitationId);
    // A code sent two minutes ago whose 60 s cooldown is over: a resend is legal and the code still verifies.
    const challengeId = await insertChallenge(ctx, {
      attemptId: String(attempt?.attempt_id),
      phoneNormalized: invite.phone.normalized,
      otp: '123456',
      status: 'PENDING',
      createdAgoSeconds: 120,
      expiresInSeconds: 180,
    });
    return { invite, session, attemptId: String(attempt?.attempt_id), challengeId };
  }

  it('K13 (verify first): the verify holds the invitation S and the attempt; the resend waits, then finds OTP_VERIFIED and sends nothing', async () => {
    const { invite, session, attemptId, challengeId } = await startedWithOldChallenge();
    const run = await schedule(
      ctx,
      ATTEMPT_X,
      (gated) => svc(gated).verifyOtp(session.cookie, session.csrf, '123456', META),
      (plain) => svc(plain).requestOtp(session.cookie, session.csrf, META),
    );
    run.release();
    expectAnswer(await run.first, 200);
    expect(codeOf(await run.second)).toBe(STEP_INVALID);
    expect(ctx.provider.sendStarted()).toBe(0);
    expect((await challengesOf(ctx.pool, attemptId)).map((row) => [row.challenge_id, row.status])).toEqual([[challengeId, 'VERIFIED']]);
    expect(await statusesOf(invite.invitationId)).toEqual(['OTP_VERIFIED:']);
  });

  it('K13 (resend first): the old challenge is INVALIDATED before the verify can look; the old code never verifies anything', async () => {
    const { invite, session, attemptId, challengeId } = await startedWithOldChallenge();
    const releaseProvider = ctx.provider.holdSends();
    let providerReleased = false;
    const unhold = (): void => {
      if (!providerReleased) {
        providerReleased = true;
        releaseProvider();
      }
    };
    try {
      const run = await schedule(
        ctx,
        INVITATION_X,
        (gated) => svc(gated).requestOtp(session.cookie, session.csrf, META),
        (plain) => svc(plain).verifyOtp(session.cookie, session.csrf, '123456', META),
      );
      run.release();
      // The resend committed its first transaction and now waits at the provider; the verify then sees the NEW challenge
      // (PENDING_DELIVERY, inside the grace) and is refused without being counted.
      expect(codeOf(await run.second)).toBe(STEP_INVALID);
      unhold();
      expectAnswer(await run.first, 202);
    } finally {
      unhold();
    }
    const challenges = await challengesOf(ctx.pool, attemptId);
    expect(challenges.map((row) => row.status)).toEqual(['INVALIDATED', 'PENDING']);
    expect(challenges[0]?.challenge_id).toBe(challengeId);
    expect(challenges[1]?.attempt_count).toBe(0);
    expect(await statusesOf(invite.invitationId)).toEqual(['STARTED:']);
  });

  // ----- K14: enrollment ∥ complete -----------------------------------------------------------------------------

  it('K14 (enrollment first): the replay returns the issued secret; the complete that waited uses exactly that secret', async () => {
    const { invite, session, secret } = await fresh('TOTP_ISSUED');
    const run = await schedule(
      ctx,
      ATTEMPT_X,
      (gated) => svc(gated).issueTotp(session.cookie, session.csrf, META),
      (plain) => svc(plain).complete(session.cookie, session.csrf, totpNow(String(secret)), META),
    );
    run.release();
    const replay = answerOf(await run.first);
    expect((replay.body as { data: { secret: string } }).data.secret).toBe(secret);
    expectAnswer(await run.second, 200);
    expect(await users(invite.phone.normalized)).toBe(1);
  });

  it('K14 (complete first): the complete finishes, the enrollment that waited is a 409 with the COMPLETED state and NO secret', async () => {
    const { invite, session, secret } = await fresh('TOTP_ISSUED');
    const run = await schedule(
      ctx,
      INVITATION_X,
      (gated) => svc(gated).complete(session.cookie, session.csrf, totpNow(String(secret)), META),
      (plain) => svc(plain).issueTotp(session.cookie, session.csrf, META),
    );
    run.release();
    expectAnswer(await run.first, 200);
    const refused = await run.second;
    expect(codeOf(refused)).toBe(STEP_INVALID);
    expect(JSON.stringify((!refused.ok && refused.error) || {})).not.toContain(String(secret));
    expect(await users(invite.phone.normalized)).toBe(1);
  });

  it('K14 (first enrollment, complete arrives): the complete is refused by the committed state at once (409 PASSWORD_SET), then completes on the issued secret', async () => {
    const { invite, session } = await fresh('PASSWORD_SET');
    const run = await schedule(
      ctx,
      ATTEMPT_X,
      (gated) => svc(gated).issueTotp(session.cookie, session.csrf, META),
      (plain) => svc(plain).complete(session.cookie, session.csrf, '123456', META),
      { expectBlocked: false },
    );
    // The complete reads the committed PASSWORD_SET snapshot and is refused without waiting for the parked enrollment.
    const early = await run.second;
    expect(codeOf(early)).toBe(STEP_INVALID);
    run.release();
    const issued = answerOf(await run.first);
    const secret = (issued.body as { data: { secret: string } }).data.secret;
    ok(await post(ctx.app, '/complete', session, { code: totpNow(secret) }));
    expect(await users(invite.phone.normalized)).toBe(1);
  });

  it('K14 (two first enrollments): both get the SAME secret and one is stored', async () => {
    const { session } = await fresh('PASSWORD_SET');
    const run = await schedule(
      ctx,
      ATTEMPT_X,
      (gated) => svc(gated).issueTotp(session.cookie, session.csrf, META),
      (plain) => svc(plain).issueTotp(session.cookie, session.csrf, META),
    );
    run.release();
    const a = answerOf(await run.first).body as { data: { secret: string } };
    const b = answerOf(await run.second).body as { data: { secret: string } };
    expect(a.data.secret).toBe(b.data.secret);
  });

  // ----- K3, K4, K20, K23(c): 1B hook and 1C ---------------------------------------------------------------------

  type Closer = 'revoke' | 'reissue';

  async function closer(kind: Closer, invitationId: string): Promise<(source: TransactionClientSource, executor?: TransactionClientSource) => Promise<unknown>> {
    const action = kind === 'revoke' ? 'REVOKE_INVITATION' : 'REISSUE_INVITATION';
    const operationId = await stepUp(ctx.app, system, action, { invitation_id: invitationId, expected_version: 1, reason: 'r' });
    const body = { operation_id: operationId, expected_version: 1, reason: 'r' };
    return (source, executor) => {
      const services = directServices(ctx.app, source, executor === undefined ? {} : { executorSource: executor });
      const key = randomUUID();
      const cookie = system.login.cookie;
      const csrf = system.login.csrf;
      return kind === 'revoke'
        ? services.invitations.revoke(cookie, csrf, parseRevokeBody(invitationId, body), key, { requestId: randomUUID() })
        : services.invitations.reissue(cookie, csrf, parseReissueBody(invitationId, body), key, { requestId: randomUUID() });
    };
  }

  describe.each(['revoke', 'reissue'] as const)('K3/K4: complete ∥ 1B %s', (kind) => {
    it(`${kind} first: the attempt is closed by the hook; the waiting complete is refused without counting; no account`, async () => {
      const { invite, session, secret } = await fresh('TOTP_ISSUED');
      const close = await closer(kind, invite.invitationId);
      const run = await schedule(
        ctx,
        INVITATION_X,
        (gated, plain) => close(plain, gated),
        (plain) => svc(plain).complete(session.cookie, session.csrf, totpNow(String(secret)), META),
      );
      run.release();
      expect((await run.first).ok).toBe(true);
      expect([STEP_INVALID, 'ADMIN_ACTIVATION_LINK_INVALID']).toContain(codeOf(await run.second));
      expect(await users(invite.phone.normalized)).toBe(0);
      expect(await statusesOf(invite.invitationId)).toEqual(['INVALIDATED:INVITATION_CLOSED']);
      expect(await bucketFailures(ctx.pool, 'ACTIVATION_TOTP')).toBe(0);
      expect((await invitationRow(ctx.pool, invite.invitationId))?.status).toBe(kind === 'revoke' ? 'REVOKED' : 'SUPERSEDED');
    });

    it(`complete first: the account exists and ${kind} is refused (the invitation is ACCEPTED)`, async () => {
      const { invite, session, secret } = await fresh('TOTP_ISSUED');
      const close = await closer(kind, invite.invitationId);
      const run = await schedule(
        ctx,
        INVITATION_X,
        (gated) => svc(gated).complete(session.cookie, session.csrf, totpNow(String(secret)), META),
        (plain) => close(plain),
      );
      run.release();
      expectAnswer(await run.first, 200);
      expect((await run.second).ok).toBe(false);
      expect(await users(invite.phone.normalized)).toBe(1);
      expect((await invitationRow(ctx.pool, invite.invitationId))?.status).toBe('ACCEPTED');
      expect(await statusesOf(invite.invitationId)).toEqual(['COMPLETED:']);
    });
  });

  describe('K20: 1B reissue ∥ verify / otp-request', () => {
    it('reissue first: the hook closes attempt and challenge; the waiting verify never verifies', async () => {
      const invite = await newInvite(ctx.app, system);
      const session = await begin(ctx.app, invite);
      const otp = await sendOtp(deps(), invite, session);
      const close = await closer('reissue', invite.invitationId);
      const run = await schedule(
        ctx,
        INVITATION_X,
        (gated, plain) => close(plain, gated),
        (plain) => svc(plain).verifyOtp(session.cookie, session.csrf, otp, META),
      );
      run.release();
      expect((await run.first).ok).toBe(true);
      expect([STEP_INVALID, 'ADMIN_ACTIVATION_LINK_INVALID']).toContain(codeOf(await run.second));
      const [attempt] = await attemptsOf(ctx.pool, invite.invitationId);
      expect((await challengesOf(ctx.pool, String(attempt?.attempt_id))).map((row) => row.status)).toEqual(['INVALIDATED']);
      expect(attempt).toMatchObject({ status: 'INVALIDATED', invalidated_reason: 'INVITATION_CLOSED' });
    });

    it('verify first: the code verifies, then the hook closes the attempt (the VERIFIED challenge stays a fact)', async () => {
      const invite = await newInvite(ctx.app, system);
      const session = await begin(ctx.app, invite);
      const otp = await sendOtp(deps(), invite, session);
      const close = await closer('reissue', invite.invitationId);
      const run = await schedule(
        ctx,
        ATTEMPT_X,
        (gated) => svc(gated).verifyOtp(session.cookie, session.csrf, otp, META),
        (plain) => close(plain),
      );
      run.release();
      expectAnswer(await run.first, 200);
      expect((await run.second).ok).toBe(true);
      const [attempt] = await attemptsOf(ctx.pool, invite.invitationId);
      expect(attempt).toMatchObject({ status: 'INVALIDATED', invalidated_reason: 'INVITATION_CLOSED' });
      expect((await challengesOf(ctx.pool, String(attempt?.attempt_id))).map((row) => row.status)).toEqual(['VERIFIED']);
    });

    it('reissue first: an OTP request that waited is refused and sends nothing', async () => {
      const invite = await newInvite(ctx.app, system);
      const session = await begin(ctx.app, invite);
      const close = await closer('reissue', invite.invitationId);
      const run = await schedule(
        ctx,
        INVITATION_X,
        (gated, plain) => close(plain, gated),
        (plain) => svc(plain).requestOtp(session.cookie, session.csrf, META),
      );
      run.release();
      expect((await run.first).ok).toBe(true);
      expect([STEP_INVALID, 'ADMIN_ACTIVATION_LINK_INVALID']).toContain(codeOf(await run.second));
      expect(ctx.provider.sendStarted()).toBe(0);
    });

    it('otp-request first: its challenge is written and committed, the hook invalidates it while the SMS call is pending, and the late outcome never revives it', async () => {
      const invite = await newInvite(ctx.app, system);
      const session = await begin(ctx.app, invite);
      const close = await closer('reissue', invite.invitationId);
      const releaseProvider = ctx.provider.holdSends();
      let released = false;
      const unhold = (): void => {
        if (!released) {
          released = true;
          releaseProvider();
        }
      };
      try {
        const run = await schedule(
          ctx,
          INVITATION_X,
          (gated) => svc(gated).requestOtp(session.cookie, session.csrf, META),
          (plain) => close(plain),
        );
        run.release();
        // The reissue runs to the end while the first request waits at the provider.
        expect((await run.second).ok).toBe(true);
        unhold();
        expect((await run.first).ok).toBe(true);
      } finally {
        unhold();
      }
      const [attempt] = await attemptsOf(ctx.pool, invite.invitationId);
      expect(attempt).toMatchObject({ status: 'INVALIDATED', invalidated_reason: 'INVITATION_CLOSED' });
      expect((await challengesOf(ctx.pool, String(attempt?.attempt_id))).map((row) => row.status)).toEqual(['INVALIDATED']);
    });
  });

  // ----- K23: PHONE_CONFLICT -------------------------------------------------------------------------------------

  async function takePhone(phone: string): Promise<void> {
    await ctx.pool.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
       VALUES ($1::uuid, $2, $3, now(), 'PHONE_VERIFIED', 'ACTIVE', 1, now(), now())`,
      [randomUUID(), phone, await new Argon2idPasswordHasher().hash(ADMIN_PASSWORD)],
    );
  }

  const phoneConflictAudits = async (): Promise<number> => auditCount(ctx.pool, 'admin_activation.phone_conflict');

  it.each(['otp-request first', 'start first'] as const)('K23(b): otp-request and start both reach the PHONE_CONFLICT branch, %s - one closure, no deadlock', async (order) => {
    const invite = await newInvite(ctx.app, system);
    const session = await begin(ctx.app, invite);
    await takePhone(invite.phone.normalized);
    const before = await phoneConflictAudits();
    const request = (source: TransactionClientSource): Promise<unknown> => svc(source).requestOtp(session.cookie, session.csrf, META);
    const start = (source: TransactionClientSource): Promise<unknown> => svc(source).start(session.cookie, invite.token, META);
    const requestFirst = order === 'otp-request first';
    const run = await schedule(
      ctx,
      INVITATION_X,
      (gated) => (requestFirst ? request(gated) : start(gated)),
      (plain) => (requestFirst ? start(plain) : request(plain)),
    );
    run.release();
    const results = [await run.first, await run.second];
    const codes = results.map((result) => codeOf(result));
    expect(codes).toContain('ADMIN_PHONE_CONFLICT');
    for (const code of codes) {
      expect(['ADMIN_PHONE_CONFLICT', STEP_INVALID, 'ADMIN_ACTIVATION_LINK_INVALID']).toContain(code);
    }
    expect(await invitationStatus(ctx.pool, invite.invitationId)).toBe('PHONE_CONFLICT');
    expect(await liveAttempts(ctx.pool, invite.invitationId)).toEqual([]);
    expect(await phoneConflictAudits()).toBe(before + 1);
    expect(ctx.provider.sendStarted()).toBe(0);
  });

  it('K23(c) revoke first: the revoke wins; the request that waited finds a closed link, not a conflict', async () => {
    const invite = await newInvite(ctx.app, system);
    const session = await begin(ctx.app, invite);
    await takePhone(invite.phone.normalized);
    const close = await closer('revoke', invite.invitationId);
    const run = await schedule(
      ctx,
      INVITATION_X,
      (gated, plain) => close(plain, gated),
      (plain) => svc(plain).requestOtp(session.cookie, session.csrf, META),
    );
    run.release();
    expect((await run.first).ok).toBe(true);
    expect([STEP_INVALID, 'ADMIN_ACTIVATION_LINK_INVALID']).toContain(codeOf(await run.second));
    expect(await invitationStatus(ctx.pool, invite.invitationId)).toBe('REVOKED');
    expect(await statusesOf(invite.invitationId)).toEqual(['INVALIDATED:INVITATION_CLOSED']);
  });

  it('K23(c) request first: the conflict closes the invitation once; the revoke that waited is refused', async () => {
    const invite = await newInvite(ctx.app, system);
    const session = await begin(ctx.app, invite);
    await takePhone(invite.phone.normalized);
    const close = await closer('revoke', invite.invitationId);
    const run = await schedule(
      ctx,
      INVITATION_X,
      (gated) => svc(gated).requestOtp(session.cookie, session.csrf, META),
      (plain) => close(plain),
    );
    run.release();
    expect(codeOf(await run.first)).toBe('ADMIN_PHONE_CONFLICT');
    expect((await run.second).ok).toBe(false);
    expect(await invitationStatus(ctx.pool, invite.invitationId)).toBe('PHONE_CONFLICT');
    expect(await statusesOf(invite.invitationId)).toEqual(['INVALIDATED:PHONE_CONFLICT']);
  });

  // ----- K11: an attempt replaced by a new one while both complete -----------------------------------------------

  it.each(['start first', 'complete first'] as const)('K11 (a): a new start races the complete of the live attempt, %s', async (order) => {
    const { invite, session, secret } = await fresh('TOTP_ISSUED');
    const startFirst = order === 'start first';
    const startNew = (source: TransactionClientSource): Promise<unknown> => svc(source).start(undefined, invite.token, META);
    const completeOld = (source: TransactionClientSource): Promise<unknown> => svc(source).complete(session.cookie, session.csrf, totpNow(String(secret)), META);
    const run = await schedule(
      ctx,
      INVITATION_X,
      (gated) => (startFirst ? startNew(gated) : completeOld(gated)),
      (plain) => (startFirst ? completeOld(plain) : startNew(plain)),
    );
    run.release();
    const [first, second] = [await run.first, await run.second];
    if (startFirst) {
      expect(first.ok).toBe(true);
      expect(codeOf(second)).toBe(STEP_INVALID);
      expect(await users(invite.phone.normalized)).toBe(0);
      expect((await statusesOf(invite.invitationId)).sort()).toEqual(['INVALIDATED:SUPERSEDED', 'STARTED:']);
      expect(await bucketFailures(ctx.pool, 'ACTIVATION_TOTP')).toBe(0);
    } else {
      expect(first.ok).toBe(true);
      expect(codeOf(second)).toBe('ADMIN_ACTIVATION_LINK_INVALID');
      expect(await users(invite.phone.normalized)).toBe(1);
      expect(await statusesOf(invite.invitationId)).toEqual(['COMPLETED:']);
    }
  });

  it.each(['old cookie first', 'new cookie first'] as const)('K11 (b): both attempts reach TOTP_ISSUED in turn, then both complete - %s', async (order) => {
    const invite = await newInvite(ctx.app, system);
    const old = await advance(deps(), invite, 'TOTP_ISSUED');
    // The second link opening replaces the first attempt, which had already issued its secret.
    const next = await advance(deps(), invite, 'TOTP_ISSUED');
    expect(next.session.cookie).not.toBe(old.session.cookie);
    expect(await statusesOf(invite.invitationId)).toEqual(['INVALIDATED:SUPERSEDED', 'TOTP_ISSUED:']);
    const completeOld = (source: TransactionClientSource): Promise<unknown> =>
      svc(source).complete(old.session.cookie, old.session.csrf, totpNow(String(old.secret)), META);
    const completeNew = (source: TransactionClientSource): Promise<unknown> =>
      svc(source).complete(next.session.cookie, next.session.csrf, totpNow(String(next.secret)), META);
    const oldFirst = order === 'old cookie first';
    const run = await schedule(
      ctx,
      INVITATION_X,
      (gated) => (oldFirst ? completeOld(gated) : completeNew(gated)),
      (plain) => (oldFirst ? completeNew(plain) : completeOld(plain)),
    );
    run.release();
    const [first, second] = [await run.first, await run.second];
    const [oldResult, newResult] = oldFirst ? [first, second] : [second, first];
    expect(newResult.ok).toBe(true);
    expect([STEP_INVALID, 'ADMIN_ACTIVATION_LINK_INVALID']).toContain(codeOf(oldResult));
    expect(await users(invite.phone.normalized)).toBe(1);
    expect(await statusesOf(invite.invitationId)).toEqual(['INVALIDATED:SUPERSEDED', 'COMPLETED:']);
    expect(await invitationStatus(ctx.pool, invite.invitationId)).toBe('ACCEPTED');
    expect(await bucketFailures(ctx.pool, 'ACTIVATION_TOTP')).toBe(0);
  });

  it('K11 (c): the schema itself makes a second live or a second COMPLETED attempt of one invitation, and a revived terminal one, impossible', async () => {
    const { invite } = await fresh('TOTP_ISSUED');
    const duplicateLive = insertAttempt(ctx.pool, { invitationId: invite.invitationId, status: 'STARTED', createdAgoSeconds: 5, expiresInSeconds: 600 });
    await expect(duplicateLive).rejects.toMatchObject({ code: '23505' });
    const done = await fresh('TOTP_ISSUED');
    ok(await post(ctx.app, '/complete', done.session, { code: totpNow(String(done.secret)) }));
    const secondCompleted = insertAttempt(ctx.pool, {
      invitationId: done.invite.invitationId,
      status: 'COMPLETED',
      createdAgoSeconds: 5,
      expiresInSeconds: 600,
    });
    await expect(secondCompleted).rejects.toMatchObject({ code: '23505' });
    const [completed] = await attemptsOf(ctx.pool, done.invite.invitationId);
    await expect(
      ctx.pool.query("UPDATE app.admin_activation_attempts SET status = 'STARTED' WHERE attempt_id = $1::uuid", [completed?.attempt_id]),
    ).rejects.toMatchObject({ code: '23001' });
    const superseded = await fresh('START');
    await begin(ctx.app, superseded.invite);
    const [old] = await attemptsOf(ctx.pool, superseded.invite.invitationId);
    expect(old?.status).toBe('INVALIDATED');
    await expect(
      ctx.pool.query("UPDATE app.admin_activation_attempts SET status = 'COMPLETED', completed_at = now() WHERE attempt_id = $1::uuid", [old?.attempt_id]),
    ).rejects.toMatchObject({ code: '23001' });
  });

  // ----- sanity: the GET state of a parked schedule is never blocked ----------------------------------------------

  it('GET state does not wait for a parked writer (pure read)', async () => {
    const { session } = await fresh('TOTP_ISSUED');
    const run = await schedule(
      ctx,
      INVITATION_X,
      (gated) => svc(gated).complete(session.cookie, session.csrf, '000000', META),
      async () => adminData(ok(await getState(ctx.app, session))),
      { expectBlocked: false },
    );
    const state = answerOf(await run.second);
    expect(state.state).toBe('TOTP_ISSUED');
    run.release();
    await run.first;
  });
});

function adminDataOf(answer: { body: unknown }): Record<string, unknown> {
  return (answer.body as { data: Record<string, unknown> }).data;
}

async function settleVerify(service: AdminActivationService, session: Act, code: string): Promise<Settled<unknown>> {
  try {
    return { ok: true, value: await service.verifyOtp(session.cookie, session.csrf, code, META) };
  } catch (error) {
    return { ok: false, error };
  }
}
