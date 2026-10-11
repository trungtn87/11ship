import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { AdminActivationService } from '../../apps/backend/src/admin-activation/admin-activation-service';
import { poolClientSource } from '../../apps/backend/src/transaction/pg-client-source';
import { eventually } from './support/async-helpers';
import {
  ActivationApp,
  answerOf,
  attemptsOf,
  auditCount,
  begin,
  challengesOf,
  codeOf,
  directActivation,
  insertChallenge,
  Invite,
  newInvite,
  schedule,
  startActivationApp,
} from './support/activation-fixtures';
import { waitUntilDbClockPast } from './support/lock-fixtures';
import { SystemSession, systemSession } from './support/provisioning-fixtures';

// M01-D-ADMIN-1C - K18 (a verify that promotes a PENDING_DELIVERY challenge races the late delivery outcome of the SAME
// challenge, both orders, decided by barriers) and K27 (the whole table "newest challenge in any status" for verify).

const META = { requestId: randomUUID(), ip: '127.0.0.1' };
const STEP_INVALID = 'ADMIN_ACTIVATION_STEP_INVALID';
const PROMOTED = 'admin_activation.otp_delivery_promoted.v1';
const ANOMALY = 'admin_activation.anomaly.v1';
const WRONG = '111111';

describe('M01-D-ADMIN-1C - K18 promote vs late delivery outcome (grace 1 s), both orders', () => {
  let ctx: ActivationApp;
  let system: SystemSession;
  const svc = (source = poolClientSource(ctx.pool)): AdminActivationService => directActivation(ctx, source);

  beforeAll(async () => {
    ctx = await startActivationApp({ activationConfig: { promoteGraceMs: 1000 } });
    system = await systemSession(ctx.app);
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await ctx.app.clearLimits();
    ctx.provider.clear();
  });

  const auditOf = async (action: string, resourceId: string): Promise<number> =>
    Number(
      (await ctx.pool.query<{ n: string }>('SELECT count(*)::text AS n FROM app.audit_logs WHERE action = $1 AND resource_id = $2', [action, resourceId])).rows[0]?.n,
    );

  const pastGrace = (attemptId: string): Promise<void> =>
    waitUntilDbClockPast(
      ctx.pool,
      `SELECT max(created_at) + interval '1 second' FROM app.admin_activation_otp_challenges WHERE attempt_id = $1::uuid`,
      [attemptId],
    );

  it('order 1 - the verify promotes while the delivery is still at the provider; the late outcome then finds the challenge already PENDING', async () => {
    const invite = await newInvite(ctx.app, system);
    const session = await begin(ctx.app, invite);
    const [attempt] = await attemptsOf(ctx.pool, invite.invitationId);
    const attemptId = String(attempt?.attempt_id);
    const release = ctx.provider.holdSends();
    let released = false;
    const unhold = (): void => {
      if (!released) {
        released = true;
        release();
      }
    };
    try {
      const delivery = svc().requestOtp(session.cookie, session.csrf, META).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      // The first transaction committed and the request waits INSIDE provider.send (the barrier).
      await eventually(async () => Promise.resolve(ctx.provider.sendStarted() >= 1 && (await challengesOf(ctx.pool, attemptId)).length === 1), 'the delivery parked at the provider');
      expect((await challengesOf(ctx.pool, attemptId))[0]?.status).toBe('PENDING_DELIVERY');
      await pastGrace(attemptId);
      const verify = await svc()
        .verifyOtp(session.cookie, session.csrf, WRONG, META)
        .then(
          () => undefined,
          (error: unknown) => error,
        );
      expect(verify).toMatchObject({ code: 'OTP_INVALID' });
      const [challenge] = await challengesOf(ctx.pool, attemptId);
      expect(challenge).toMatchObject({ status: 'PENDING', attempt_count: 1 });
      expect(await auditOf(PROMOTED, String(challenge?.challenge_id))).toBe(1);
      unhold();
      const late = await delivery;
      expect(late.ok).toBe(true);
      // The late outcome did not overwrite anything: still PENDING with the counted wrong code; one anomaly is recorded.
      const [after] = await challengesOf(ctx.pool, attemptId);
      expect(after).toMatchObject({ status: 'PENDING', attempt_count: 1 });
      expect(await auditOf(ANOMALY, String(challenge?.challenge_id))).toBe(1);
      expect(await auditOf(PROMOTED, String(challenge?.challenge_id))).toBe(1);
    } finally {
      unhold();
    }
  });

  it('order 2 - the delivery outcome (txn2) promotes first; the verify, blocked on the challenge lock, then sees PENDING and counts the wrong code without promoting', async () => {
    const invite = await newInvite(ctx.app, system);
    const session = await begin(ctx.app, invite);
    const [attempt] = await attemptsOf(ctx.pool, invite.invitationId);
    const attemptId = String(attempt?.attempt_id);
    // Park txn2 of the delivery right after it locked ITS challenge by id (L9b); not the newest-challenge lock of txn1.
    const run = await schedule(
      ctx,
      /c\.challenge_id = \$1::uuid FOR UPDATE/,
      (gated) => svc(gated).requestOtp(session.cookie, session.csrf, META),
      (plain) => svc(plain).verifyOtp(session.cookie, session.csrf, WRONG, META),
    );
    // The verify is blocked on the same row; the DB clock passes the grace while both are parked (no sleep orders anything).
    await pastGrace(attemptId);
    run.release();
    expect((await run.first).ok).toBe(true);
    expect(codeOf(await run.second)).toBe('OTP_INVALID');
    const [challenge] = await challengesOf(ctx.pool, attemptId);
    expect(challenge).toMatchObject({ status: 'PENDING', attempt_count: 1 });
    expect(await auditOf(PROMOTED, String(challenge?.challenge_id))).toBe(0);
    expect(await auditOf(ANOMALY, String(challenge?.challenge_id))).toBe(0);
    expect(ctx.provider.sentCount()).toBe(1);
  });
});

describe('M01-D-ADMIN-1C - K27: verify against the NEWEST challenge in every status', () => {
  let ctx: ActivationApp;
  let system: SystemSession;
  const svc = (): AdminActivationService => directActivation(ctx, poolClientSource(ctx.pool));

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

  type Spec = {
    readonly name: string;
    readonly build: (attemptId: string, phone: string) => Promise<void>;
    readonly code: string | undefined;
  };
  const challenge = (
    status: 'PENDING_DELIVERY' | 'PENDING' | 'LOCKED' | 'INVALIDATED' | 'DELIVERY_FAILED',
    createdAgoSeconds: number,
    expiresInSeconds: number,
  ) => async (attemptId: string, phone: string): Promise<void> => {
    await insertChallenge(ctx, { attemptId, phoneNormalized: phone, otp: '246810', status, createdAgoSeconds, expiresInSeconds });
  };

  const table: Spec[] = [
    { name: 'no challenge at all', build: async () => undefined, code: STEP_INVALID },
    { name: 'PENDING_DELIVERY inside the grace (2 s old, grace 10 s)', build: challenge('PENDING_DELIVERY', 2, 598), code: STEP_INVALID },
    { name: 'PENDING expired', build: challenge('PENDING', 650, -50), code: 'OTP_EXPIRED' },
    { name: 'DELIVERY_FAILED', build: challenge('DELIVERY_FAILED', 30, 570), code: STEP_INVALID },
    { name: 'INVALIDATED', build: challenge('INVALIDATED', 30, 570), code: STEP_INVALID },
    { name: 'LOCKED', build: challenge('LOCKED', 30, 570), code: 'OTP_RATE_LIMITED' },
    {
      name: 'an older PENDING and a NEWER LOCKED one: the newest decides, the old one is untouched',
      build: async (attemptId, phone) => {
        await insertChallenge(ctx, { attemptId, phoneNormalized: phone, otp: '246810', status: 'PENDING', createdAgoSeconds: 300, expiresInSeconds: 300 });
        await insertChallenge(ctx, { attemptId, phoneNormalized: phone, otp: '135790', status: 'LOCKED', createdAgoSeconds: 100, expiresInSeconds: 500 });
      },
      code: 'OTP_RATE_LIMITED',
    },
  ];

  async function started(): Promise<{ invite: Invite; cookie: string; csrf: string; attemptId: string }> {
    const invite = await newInvite(ctx.app, system);
    const session = await begin(ctx.app, invite);
    const [attempt] = await attemptsOf(ctx.pool, invite.invitationId);
    return { invite, ...session, attemptId: String(attempt?.attempt_id) };
  }

  const snapshot = async (invite: Invite, attemptId: string): Promise<unknown> => ({
    attempts: (await attemptsOf(ctx.pool, invite.invitationId)).map((row) => [row.attempt_id, row.status, row.xmin]),
    challenges: (await challengesOf(ctx.pool, attemptId)).map((row) => [row.challenge_id, row.status, row.attempt_count, row.xmin]),
    audit: await auditCount(ctx.pool),
  });

  it.each(table)('$name -> $code, nothing written', async (row) => {
    const { invite, cookie, csrf, attemptId } = await started();
    await row.build(attemptId, invite.phone.normalized);
    const before = await snapshot(invite, attemptId);
    const result = await svc()
      .verifyOtp(cookie, csrf, '246810', META)
      .then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      );
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : (result.error as { code?: string }).code).toBe(row.code);
    expect(await snapshot(invite, attemptId)).toEqual(before);
  });

  it('PENDING_DELIVERY OUTSIDE the grace (20 s old): promoted (audited), then the code is compared - right code verifies', async () => {
    const { invite, cookie, csrf, attemptId } = await started();
    const challengeId = await insertChallenge(ctx, {
      attemptId,
      phoneNormalized: invite.phone.normalized,
      otp: '246810',
      status: 'PENDING_DELIVERY',
      createdAgoSeconds: 20,
      expiresInSeconds: 580,
    });
    const answer = answerOf(await svc().verifyOtp(cookie, csrf, '246810', META).then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error })));
    expect(answer.status).toBe(200);
    expect((await challengesOf(ctx.pool, attemptId))[0]?.status).toBe('VERIFIED');
    const promoted = await ctx.pool.query('SELECT 1 FROM app.audit_logs WHERE action = $1 AND resource_id = $2', [PROMOTED, challengeId]);
    expect(promoted.rowCount).toBe(1);
  });

  it('PENDING_DELIVERY OUTSIDE the grace, wrong code: promoted and counted once (commit-then-throw)', async () => {
    const { invite, cookie, csrf, attemptId } = await started();
    const challengeId = await insertChallenge(ctx, {
      attemptId,
      phoneNormalized: invite.phone.normalized,
      otp: '246810',
      status: 'PENDING_DELIVERY',
      createdAgoSeconds: 20,
      expiresInSeconds: 580,
    });
    const error = await svc().verifyOtp(cookie, csrf, WRONG, META).then(() => undefined, (failure: unknown) => failure);
    expect(error).toMatchObject({ code: 'OTP_INVALID' });
    expect((await challengesOf(ctx.pool, attemptId))[0]).toMatchObject({ status: 'PENDING', attempt_count: 1 });
    const promoted = await ctx.pool.query('SELECT 1 FROM app.audit_logs WHERE action = $1 AND resource_id = $2', [PROMOTED, challengeId]);
    expect(promoted.rowCount).toBe(1);
  });
});
