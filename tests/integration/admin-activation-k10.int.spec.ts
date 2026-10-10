import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { AppError } from '../../apps/backend/src/common/app-errors';
import { DEFAULT_ACTIVATION_LIMITS } from '../../apps/backend/src/config/admin-activation-config';
import { adminData, adminErrorCode } from './support/admin-fixtures';
import {
  act,
  ActivationApp,
  attemptsOf,
  auditCount,
  begin,
  bucketFailures,
  challengesOf,
  directActivation,
  getState,
  invitationStatus,
  newInvite,
  ok,
  post,
  startActivationApp,
} from './support/activation-fixtures';
import { failureOf } from './support/async-helpers';
import { waitUntilDbClockPast } from './support/lock-fixtures';
import { SystemSession, systemSession } from './support/provisioning-fixtures';
import { faultySource } from './support/transaction-fixtures';

// M01-D-ADMIN-1C K10 for the routes that start, replace and send: start, restart and otp/request (verify, password,
// enrollment and complete are in admin-activation-faults.int.spec.ts). A BUSINESS transaction is the one that sets
// lock_timeout; the fault hits the COMMIT of the n-th business transaction of ONE service call:
//   ack-lost   - the server COMMITS, the acknowledgement is lost  => TRANSACTION_OUTCOME_UNKNOWN, the effect exists;
//   never-sent - the connection dies before COMMIT                => TRANSACTION_OUTCOME_UNKNOWN, the effect does NOT exist.
// Nothing retries by itself: every test counts COMMITs, provider calls and rows right after the unknown outcome and only then
// does what the CLIENT would do (read GET state, wait for resend_at, or open the link again).

const META = { requestId: randomUUID(), ip: '127.0.0.1' };
const UNKNOWN = 'TRANSACTION_OUTCOME_UNKNOWN';
const STEP_INVALID = 'ADMIN_ACTIVATION_STEP_INVALID';

describe('M01-D-ADMIN-1C - K10 for start, restart and otp/request', () => {
  let ctx: ActivationApp;
  let system: SystemSession;

  beforeAll(async () => {
    // cooldown 4 s and grace 3 s: long enough that the "too soon" / "inside the grace" assertions cannot flake on a slow runner, short
    // enough that "wait for resend_at" and "after the grace" are real DB-clock waits of a few seconds.
    ctx = await startActivationApp({
      activationConfig: { promoteGraceMs: 3000, limits: { ...DEFAULT_ACTIVATION_LIMITS, otpResendCooldownSeconds: 4 } },
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

  /** Fault on the COMMIT of the `nth` (1-based) business transaction of the call. Counts every business COMMIT it sees. */
  function faultAt(nth: number, mode: 'ack-lost' | 'never-sent'): { source: ReturnType<typeof faultySource>; commits: () => number } {
    let businessTransactions = 0;
    let currentIsBusiness = false;
    let commits = 0;
    const source = faultySource(ctx.pool, (text, real) => {
      if (/set_config\('lock_timeout'/.test(text)) {
        businessTransactions += 1;
        currentIsBusiness = true;
      }
      if (text !== 'COMMIT' || !currentIsBusiness) {
        return undefined;
      }
      currentIsBusiness = false;
      commits += 1;
      if (businessTransactions !== nth) {
        return undefined;
      }
      const lose = (statement: 'COMMIT' | 'ROLLBACK', reason: string) => real.query(statement).then(() => Promise.reject(Object.assign(new Error(reason), { code: 'ECONNRESET' })));
      return mode === 'ack-lost' ? lose('COMMIT', 'injected: ack lost') : lose('ROLLBACK', 'injected: connection lost');
    });
    return { source, commits: () => commits };
  }

  const unknownOf = async (run: () => Promise<unknown>): Promise<void> => {
    const error = await failureOf(run);
    expect((error as AppError).code).toBe(UNKNOWN);
  };

  const challengeStatuses = async (invitationId: string): Promise<string[]> => {
    const attempts = await attemptsOf(ctx.pool, invitationId);
    const out: string[] = [];
    for (const attempt of attempts) {
      out.push(...(await challengesOf(ctx.pool, attempt.attempt_id)).map((row) => row.status));
    }
    return out;
  };

  const statuses = async (invitationId: string): Promise<string[]> => (await attemptsOf(ctx.pool, invitationId)).map((row) => `${row.status}:${row.invalidated_reason ?? ''}`);

  // ----- start -------------------------------------------------------------------------------------------------------

  it('start, COMMIT acknowledged by the server but lost: UNKNOWN, one attempt exists but its cookie was never issued; no retry; opening the link again starts anew and supersedes it', async () => {
    const invite = await newInvite(ctx.app, system);
    const fault = faultAt(1, 'ack-lost');
    await unknownOf(() => directActivation(ctx, fault.source).start(undefined, invite.token, META));
    expect(fault.commits()).toBe(1); // exactly one COMMIT: nothing retried it
    expect(await statuses(invite.invitationId)).toEqual(['STARTED:']); // the effect exists...
    // ...but the cookie is only ever set from a SUCCESSFUL answer, so the client holds none: GET state has nothing to read.
    expect((await getState(ctx.app, undefined)).status).toBe(401);
    // Recovery of the contract (11.3): the link is still valid, opening it again starts a new attempt.
    const again = await begin(ctx.app, invite);
    expect(await statuses(invite.invitationId)).toEqual(['INVALIDATED:SUPERSEDED', 'STARTED:']);
    expect(adminData(ok(await getState(ctx.app, again))).state).toBe('STARTED');
  });

  it('start, connection lost before COMMIT: UNKNOWN and NO attempt at all; opening the link works at once', async () => {
    const invite = await newInvite(ctx.app, system);
    const fault = faultAt(1, 'never-sent');
    await unknownOf(() => directActivation(ctx, fault.source).start(undefined, invite.token, META));
    expect(fault.commits()).toBe(1);
    expect(await attemptsOf(ctx.pool, invite.invitationId)).toEqual([]);
    expect(await bucketFailures(ctx.pool, 'ACTIVATION_LINK_IP')).toBe(0);
    await begin(ctx.app, invite);
    expect(await statuses(invite.invitationId)).toEqual(['STARTED:']);
  });

  it('start, response (Set-Cookie) lost AFTER success: the client only has the link; the retry supersedes the first attempt, whose cookie then reads REPLACED', async () => {
    const invite = await newInvite(ctx.app, system);
    const first = await act(ctx.app, 'POST', '/start', { body: { token: invite.token } });
    expect(first.status).toBe(201);
    const lostCookie = first.setCookie.join(';').match(/__Host-11admin-act=([^;]+)/)?.[1] as string;
    const lostCsrf = String(adminData(first).csrf_token);
    // the response never reached the client: it starts again with the link alone
    const second = await act(ctx.app, 'POST', '/start', { body: { token: invite.token } });
    expect(second.status).toBe(201);
    expect(await statuses(invite.invitationId)).toEqual(['INVALIDATED:SUPERSEDED', 'STARTED:']);
    const old = await getState(ctx.app, { cookie: lostCookie, csrf: lostCsrf });
    expect(old.status).toBe(200);
    expect(adminData(old)).toMatchObject({ state: 'INVALIDATED', reason: 'REPLACED' });
  });

  // ----- restart -----------------------------------------------------------------------------------------------------

  it('restart, COMMIT ack lost: UNKNOWN, the old attempt reads REPLACED, the new cookie was never issued, the link starts a fresh attempt; no retry', async () => {
    const invite = await newInvite(ctx.app, system);
    const old = await begin(ctx.app, invite);
    const fault = faultAt(1, 'ack-lost');
    await unknownOf(() => directActivation(ctx, fault.source).restart(old.cookie, old.csrf, META));
    expect(fault.commits()).toBe(1);
    expect(await statuses(invite.invitationId)).toEqual(['INVALIDATED:SUPERSEDED', 'STARTED:']);
    expect(adminData(ok(await getState(ctx.app, old)))).toMatchObject({ state: 'INVALIDATED', reason: 'REPLACED' });
    // the replay of restart with the old cookie is the contract 409 (the attempt is final), never a second restart
    const replay = await post(ctx.app, '/restart', old);
    expect(replay.status).toBe(409);
    expect(adminErrorCode(replay)).toBe(STEP_INVALID);
    expect(await statuses(invite.invitationId)).toEqual(['INVALIDATED:SUPERSEDED', 'STARTED:']);
    await begin(ctx.app, invite);
    expect(await statuses(invite.invitationId)).toEqual(['INVALIDATED:SUPERSEDED', 'INVALIDATED:SUPERSEDED', 'STARTED:']);
  });

  it('restart, connection lost before COMMIT: UNKNOWN, the old attempt is untouched and a plain restart works', async () => {
    const invite = await newInvite(ctx.app, system);
    const old = await begin(ctx.app, invite);
    const fault = faultAt(1, 'never-sent');
    await unknownOf(() => directActivation(ctx, fault.source).restart(old.cookie, old.csrf, META));
    expect(await statuses(invite.invitationId)).toEqual(['STARTED:']);
    expect(adminData(ok(await getState(ctx.app, old))).state).toBe('STARTED');
    ok(await post(ctx.app, '/restart', old), 201);
    expect(await statuses(invite.invitationId)).toEqual(['INVALIDATED:SUPERSEDED', 'STARTED:']);
  });

  // ----- otp/request: txn1 / provider / txn2 -----------------------------------------------------------------------

  it('otp/request, txn1 COMMIT ack lost: the challenge exists, the provider was NEVER called, the resend is refused until resend_at, then it sends exactly once', async () => {
    const invite = await newInvite(ctx.app, system);
    const session = await begin(ctx.app, invite);
    const fault = faultAt(1, 'ack-lost');
    await unknownOf(() => directActivation(ctx, fault.source).requestOtp(session.cookie, session.csrf, META));
    expect(fault.commits()).toBe(1);
    expect(ctx.provider.sendStarted()).toBe(0); // the provider is called only after txn1 is known to have committed
    expect(await challengeStatuses(invite.invitationId)).toEqual(['PENDING_DELIVERY']);
    expect(await bucketFailures(ctx.pool, 'ACTIVATION_OTP_SEND')).toBe(1);
    const state = adminData(ok(await getState(ctx.app, session)));
    expect(state).toMatchObject({ state: 'STARTED', otp: { status: 'SUBMITTED' } });
    // inside the cooldown the client may NOT send again (and the server does not either)
    const tooSoon = await post(ctx.app, '/otp/request', session);
    expect(adminErrorCode(tooSoon)).toBe('OTP_RATE_LIMITED');
    expect(ctx.provider.sendStarted()).toBe(0);
    const [attempt] = await attemptsOf(ctx.pool, invite.invitationId);
    await waitUntilDbClockPast(ctx.pool, 'SELECT max(resend_not_before) FROM app.admin_activation_otp_challenges WHERE attempt_id = $1::uuid', [attempt?.attempt_id]);
    ok(await post(ctx.app, '/otp/request', session), 202);
    expect(ctx.provider.sendStarted()).toBe(1);
    expect(await challengeStatuses(invite.invitationId)).toEqual(['INVALIDATED', 'PENDING']);
    ok(await post(ctx.app, '/otp/verify', session, { code: ctx.provider.lastOtpFor(invite.phone.normalized) as string }));
  });

  it('otp/request, txn1 connection lost before COMMIT: nothing was written and nothing was sent; the plain retry sends once', async () => {
    const invite = await newInvite(ctx.app, system);
    const session = await begin(ctx.app, invite);
    const auditsBefore = await auditCount(ctx.pool);
    const fault = faultAt(1, 'never-sent');
    await unknownOf(() => directActivation(ctx, fault.source).requestOtp(session.cookie, session.csrf, META));
    expect(ctx.provider.sendStarted()).toBe(0);
    expect(await challengeStatuses(invite.invitationId)).toEqual([]);
    expect(await bucketFailures(ctx.pool, 'ACTIVATION_OTP_SEND')).toBe(0);
    expect(await auditCount(ctx.pool)).toBe(auditsBefore);
    ok(await post(ctx.app, '/otp/request', session), 202);
    expect(ctx.provider.sendStarted()).toBe(1);
  });

  it('otp/request, txn2 COMMIT ack lost (the SMS WAS sent and the promote committed): UNKNOWN, the code works, the resend is refused until resend_at, no second SMS', async () => {
    const invite = await newInvite(ctx.app, system);
    const session = await begin(ctx.app, invite);
    const fault = faultAt(2, 'ack-lost');
    await unknownOf(() => directActivation(ctx, fault.source).requestOtp(session.cookie, session.csrf, META));
    expect(fault.commits()).toBe(2);
    expect(ctx.provider.sendStarted()).toBe(1); // one provider call: txn2's failure did not repeat it
    expect(await challengeStatuses(invite.invitationId)).toEqual(['PENDING']);
    expect(adminData(ok(await getState(ctx.app, session)))).toMatchObject({ otp: { status: 'SUBMITTED' } });
    const tooSoon = await post(ctx.app, '/otp/request', session);
    expect(adminErrorCode(tooSoon)).toBe('OTP_RATE_LIMITED');
    expect(ctx.provider.sendStarted()).toBe(1);
    ok(await post(ctx.app, '/otp/verify', session, { code: ctx.provider.lastOtpFor(invite.phone.normalized) as string }));
    expect(await statuses(invite.invitationId)).toEqual(['OTP_VERIFIED:']);
  });

  it('otp/request, txn2 connection lost (the SMS WAS sent, the challenge stays PENDING_DELIVERY): inside the grace verify is refused uncounted, after it the lazy promote lets the real code verify', async () => {
    const invite = await newInvite(ctx.app, system);
    const session = await begin(ctx.app, invite);
    const fault = faultAt(2, 'never-sent');
    await unknownOf(() => directActivation(ctx, fault.source).requestOtp(session.cookie, session.csrf, META));
    expect(ctx.provider.sendStarted()).toBe(1);
    const code = ctx.provider.lastOtpFor(invite.phone.normalized) as string;
    expect(await challengeStatuses(invite.invitationId)).toEqual(['PENDING_DELIVERY']);
    const [attempt] = await attemptsOf(ctx.pool, invite.invitationId);
    const inside = await post(ctx.app, '/otp/verify', session, { code });
    expect(adminErrorCode(inside)).toBe(STEP_INVALID); // inside the 3 s grace (the request is immediate)
    expect((await challengesOf(ctx.pool, String(attempt?.attempt_id)))[0]).toMatchObject({ status: 'PENDING_DELIVERY', attempt_count: 0 });
    await waitUntilDbClockPast(
      ctx.pool,
      "SELECT max(created_at) + interval '3 seconds' FROM app.admin_activation_otp_challenges WHERE attempt_id = $1::uuid",
      [attempt?.attempt_id],
    );
    ok(await post(ctx.app, '/otp/verify', session, { code }));
    expect(await challengeStatuses(invite.invitationId)).toEqual(['VERIFIED']);
    expect(await invitationStatus(ctx.pool, invite.invitationId)).toBe('PENDING');
  });
});
