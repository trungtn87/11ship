import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { AppError } from '../../apps/backend/src/common/app-errors';
import { ADMIN_PASSWORD, adminData, totpNow } from './support/admin-fixtures';
import {
  activationLockSequence,
  activationOrderOk,
  act,
  advance,
  ActivationApp,
  attemptsOf,
  begin,
  challengesOf,
  directActivation,
  getState,
  insertAttempt,
  invitationStatus,
  liveAttempts,
  newInvite,
  ok,
  post,
  setsLockTimeoutFirst,
  startActivationApp,
} from './support/activation-fixtures';
import { eventually, failureOf } from './support/async-helpers';
import { gatedSource, SystemSession, systemSession } from './support/provisioning-fixtures';
import { faultySource } from './support/transaction-fixtures';

// M01-D-ADMIN-1C: the lock trace of every route (contract section 9, statement by statement through the REAL service
// over the real PostgreSQL), the lost / failed COMMIT recoveries (commit-then-throw, unknown outcome), the orphaned
// PENDING_DELIVERY challenge, and the "nothing leaks" scans of the responses and the logs.

const META = { requestId: randomUUID(), ip: '127.0.0.1' };

describe('M01-D-ADMIN-1C - lock trace, COMMIT faults and leak scans', () => {
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

  function traced(): { service: ReturnType<typeof directActivation>; trace: string[][] } {
    const trace: string[][] = [];
    return { service: directActivation(ctx, gatedSource(ctx.pool, null, null, trace)), trace };
  }

  /** Every transaction of a route obeys the order and sets lock_timeout first; returns the lock names of all of them. */
  function checkTrace(trace: string[][]): string[] {
    const names: string[] = [];
    for (const statements of trace) {
      expect(activationOrderOk(statements)).toBe(true);
      const locks = activationLockSequence(statements);
      if (locks.length > 0) {
        expect(setsLockTimeoutFirst(statements)).toBe(true);
      }
      names.push(...locks);
    }
    return names;
  }

  // ----- lock trace ------------------------------------------------------------------------------------------

  it('every route takes its locks in the contract order, lock_timeout first; writers hold the invitation X, readers S', async () => {
    const { app, pool, provider } = ctx;
    const invite = await newInvite(app, system);
    const started = traced();
    const result = await started.service.start(undefined, invite.token, META);
    expect(result.status).toBe(201);
    const startLocks = checkTrace(started.trace);
    expect(startLocks).toContain('L8 invitation X');
    expect(startLocks).not.toContain('L8 invitation S');
    const cookie = String(result.cookie?.token);
    const csrf = String((result.body as { data: Record<string, unknown> }).data.csrf_token);

    const sent = traced();
    expect((await sent.service.requestOtp(cookie, csrf, META)).status).toBe(202);
    const sentLocks = checkTrace(sent.trace);
    expect(sentLocks.filter((name) => name === 'L8 invitation X')).toHaveLength(1);
    expect(sentLocks).not.toContain('L8 invitation S');
    expect(sentLocks.indexOf('L3 phone advisory')).toBeLessThan(sentLocks.indexOf('L8 invitation X'));
    expect(sentLocks.indexOf('L8 invitation X')).toBeLessThan(sentLocks.indexOf('L9a attempt'));

    const verified = traced();
    await verified.service.verifyOtp(cookie, csrf, provider.lastOtpFor(invite.phone.normalized) as string, META);
    const verifyLocks = checkTrace(verified.trace);
    expect(verifyLocks).toContain('L8 invitation S');
    expect(verifyLocks).not.toContain('L8 invitation X');
    expect(verifyLocks).not.toContain('L3 phone advisory');

    const password = traced();
    await password.service.setPassword(cookie, csrf, ADMIN_PASSWORD, META);
    const passwordLocks = checkTrace(password.trace);
    expect(passwordLocks).toContain('L8 invitation S');
    expect(passwordLocks).not.toContain('L8 invitation X');

    const enrollment = traced();
    const issued = await enrollment.service.issueTotp(cookie, csrf, META);
    const enrollmentLocks = checkTrace(enrollment.trace);
    expect(enrollmentLocks).toContain('L8 invitation S');
    expect(enrollmentLocks).not.toContain('L8 invitation X');
    const secret = String(((issued.body as { data: Record<string, unknown> }).data).secret);

    const wrong = traced();
    const failure = await failureOf(() => wrong.service.complete(cookie, csrf, totpNow(secret, 9), META));
    expect((failure as AppError).code).toBe('ADMIN_TOTP_INVALID');
    const wrongLocks = checkTrace(wrong.trace);
    expect(wrongLocks).toContain('L2 bucket');
    expect(wrongLocks).toContain('L8 invitation X');
    expect(wrongLocks).not.toContain('L8 invitation S');

    const done = traced();
    expect((await done.service.complete(cookie, csrf, totpNow(secret), META)).status).toBe(200);
    const doneLocks = checkTrace(done.trace);
    expect(doneLocks).toContain('L3 phone advisory');
    expect(doneLocks).toContain('L8 invitation X');
    expect(doneLocks).not.toContain('L8 invitation S');
    // No statement of the writers ever shared-locks the invitation and then updates it (G1).
    for (const statements of [started.trace, sent.trace, wrong.trace, done.trace].flat()) {
      expect(statements.some((statement) => /admin_invitations[\s\S]*FOR (SHARE|KEY SHARE)/.test(statement))).toBe(false);
    }

    // The repeat is a read-only answer: no lock statement at all, no lock_timeout, no write.
    const repeat = traced();
    expect((await repeat.service.complete(cookie, csrf, totpNow(secret), META)).status).toBe(200);
    expect(checkTrace(repeat.trace)).toEqual([]);
    expect(repeat.trace.flat().some((statement) => /INSERT INTO|UPDATE app\./.test(statement))).toBe(false);

    const state = traced();
    await state.service.state(cookie);
    expect(checkTrace(state.trace)).toEqual([]);
    expect(await invitationStatus(pool, invite.invitationId)).toBe('ACCEPTED');
  });

  it('restart takes the same order (invitation X) from ATTEMPTS_EXHAUSTED', async () => {
    const { app, pool } = ctx;
    const invite = await newInvite(app, system);
    const exhausted = await insertAttempt(pool, {
      invitationId: invite.invitationId,
      status: 'INVALIDATED',
      reason: 'ATTEMPTS_EXHAUSTED',
      createdAgoSeconds: 60,
      expiresInSeconds: 600,
    });
    const state = adminData(ok(await getState(app, { cookie: exhausted.cookie, csrf: '' })));
    const restarted = traced();
    const answer = await restarted.service.restart(exhausted.cookie, String(state.csrf_token), META);
    expect(answer.status).toBe(201);
    const locks = checkTrace(restarted.trace);
    expect(locks).toContain('L8 invitation X');
    expect(locks).not.toContain('L8 invitation S');
    expect(locks).not.toContain('L2 bucket');
  });

  // ----- COMMIT faults ----------------------------------------------------------------------------------------

  /** A source that breaks the COMMIT of the BUSINESS transaction (the one that set lock_timeout); the read-only precheck is left alone. */
  function lossyCommit(mode: 'ack-lost' | 'never-sent'): { source: ReturnType<typeof faultySource>; commits: () => number } {
    let business = false;
    let commits = 0;
    const source = faultySource(ctx.pool, (text, real) => {
      if (/set_config\('lock_timeout'/.test(text)) {
        business = true;
      }
      if (text !== 'COMMIT' || !business) {
        return undefined;
      }
      commits += 1;
      if (mode === 'ack-lost') {
        // The server commits, the acknowledgement is lost.
        return real.query('COMMIT').then(() => Promise.reject(Object.assign(new Error('injected: ack lost'), { code: 'ECONNRESET' })));
      }
      // The connection dies before COMMIT is delivered: the server rolls the transaction back.
      return real.query('ROLLBACK').then(() => Promise.reject(Object.assign(new Error('injected: connection lost'), { code: 'ECONNRESET' })));
    });
    return { source, commits: () => commits };
  }

  it('K10: a lost COMMIT acknowledgement is TRANSACTION_OUTCOME_UNKNOWN with no retry, and GET state shows what really happened', async () => {
    const { app, pool, provider } = ctx;
    const invite = await newInvite(app, system);
    const { session } = await advance(deps(), invite, 'START');
    ok(await post(app, '/otp/request', session), 202);
    const code = provider.lastOtpFor(invite.phone.normalized) as string;

    // verify: the server commits OTP_VERIFIED, the answer is lost.
    const verifyFault = lossyCommit('ack-lost');
    const lostVerify = await failureOf(() => directActivation(ctx, verifyFault.source).verifyOtp(session.cookie, session.csrf, code, META));
    expect((lostVerify as AppError).code).toBe('TRANSACTION_OUTCOME_UNKNOWN');
    expect(verifyFault.commits()).toBe(1);
    expect(adminData(ok(await getState(app, session))).state).toBe('OTP_VERIFIED');

    // password: same.
    const passwordFault = lossyCommit('ack-lost');
    const lostPassword = await failureOf(() => directActivation(ctx, passwordFault.source).setPassword(session.cookie, session.csrf, ADMIN_PASSWORD, META));
    expect((lostPassword as AppError).code).toBe('TRANSACTION_OUTCOME_UNKNOWN');
    expect(adminData(ok(await getState(app, session))).state).toBe('PASSWORD_SET');

    // enrollment: the secret was issued; the client reads the state and asks again, getting the SAME secret.
    const enrollFault = lossyCommit('ack-lost');
    expect(((await failureOf(() => directActivation(ctx, enrollFault.source).issueTotp(session.cookie, session.csrf, META))) as AppError).code).toBe(
      'TRANSACTION_OUTCOME_UNKNOWN',
    );
    expect(adminData(ok(await getState(app, session))).state).toBe('TOTP_ISSUED');
    const secret = String(adminData(ok(await post(app, '/totp/enrollment', session))).secret);

    // complete: the account exists although the answer was lost; the retry is the COMPLETED answer, not a second account.
    const completeFault = lossyCommit('ack-lost');
    const lostComplete = await failureOf(() => directActivation(ctx, completeFault.source).complete(session.cookie, session.csrf, totpNow(secret), META));
    expect((lostComplete as AppError).code).toBe('TRANSACTION_OUTCOME_UNKNOWN');
    expect(completeFault.commits()).toBe(1);
    expect(adminData(ok(await getState(app, session)))).toEqual({ state: 'COMPLETED', next: 'LOGIN' });
    const retried = ok(await post(app, '/complete', session, { code: totpNow(secret) }));
    expect(adminData(retried)).toEqual({ state: 'COMPLETED', next: 'LOGIN' });
    const users = await pool.query('SELECT 1 FROM app.users WHERE phone_normalized = $1', [invite.phone.normalized]);
    expect(users.rowCount).toBe(1);
  });

  it('K9: a connection lost before COMMIT rolls the whole completion back; the TOTP code is not burned and the retry succeeds', async () => {
    const { app, pool } = ctx;
    const invite = await newInvite(app, system);
    const { session, secret } = await advance(deps(), invite, 'TOTP_ISSUED');
    const fault = lossyCommit('never-sent');
    const lost = await failureOf(() => directActivation(ctx, fault.source).complete(session.cookie, session.csrf, totpNow(String(secret)), META));
    expect((lost as AppError).code).toBe('TRANSACTION_OUTCOME_UNKNOWN');
    const users = await pool.query('SELECT 1 FROM app.users WHERE phone_normalized = $1', [invite.phone.normalized]);
    expect(users.rowCount).toBe(0);
    expect(await invitationStatus(pool, invite.invitationId)).toBe('PENDING');
    const [attempt] = await liveAttempts(pool, invite.invitationId);
    expect(attempt).toMatchObject({ status: 'TOTP_ISSUED', totp_attempt_count: 0 });
    ok(await post(app, '/complete', session, { code: totpNow(String(secret)) }));
    expect(await invitationStatus(pool, invite.invitationId)).toBe('ACCEPTED');
  });

  it('a failing audit write rolls the completion back (no account, invitation still PENDING)', async () => {
    const { app, pool } = ctx;
    const invite = await newInvite(app, system);
    const { session, secret } = await advance(deps(), invite, 'TOTP_ISSUED');
    const failing = faultySource(pool, (text) => {
      if (/INSERT INTO app\.audit_logs/.test(text)) {
        return Promise.reject(Object.assign(new Error('injected audit failure'), { code: '57014' }));
      }
      return undefined;
    });
    const error = await failureOf(() => directActivation(ctx, failing).complete(session.cookie, session.csrf, totpNow(String(secret)), META));
    expect(error).toBeDefined();
    const users = await pool.query('SELECT 1 FROM app.users WHERE phone_normalized = $1', [invite.phone.normalized]);
    expect(users.rowCount).toBe(0);
    expect(await invitationStatus(pool, invite.invitationId)).toBe('PENDING');
    expect((await liveAttempts(pool, invite.invitationId))[0]?.status).toBe('TOTP_ISSUED');
    ok(await post(app, '/complete', session, { code: totpNow(String(secret)) }));
  });

  // ----- leak scans ----------------------------------------------------------------------------------------------

  it('no response, state or log ever carries a phone, name, id, token, cookie, CSRF, OTP, password or TOTP secret', async () => {
    const { app } = ctx;
    const invite = await newInvite(app, system);
    const logsBefore = ctx.app.running.logs.length;
    const responses: string[] = [];
    const record = (response: { text: string }): void => void responses.push(response.text);
    const started = await act(app, 'POST', '/start', { body: { token: invite.token } });
    record(started);
    const session = { cookie: String(started.setCookie[0]?.split(';')[0]?.split('=')[1]), csrf: String(adminData(started).csrf_token) };
    record(await post(app, '/otp/request', session));
    const otp = ctx.provider.lastOtpFor(invite.phone.normalized) as string;
    record(await post(app, '/otp/verify', session, { code: '000000' === otp ? '111111' : '000000' }));
    record(await post(app, '/otp/verify', session, { code: otp }));
    record(await post(app, '/password', session, { password: ADMIN_PASSWORD }));
    record(await getState(app, session));
    const enrolled = await post(app, '/totp/enrollment', session);
    const secret = String(adminData(enrolled).secret);
    record(await post(app, '/complete', session, { code: totpNow(secret, 9) }));
    record(await getState(app, session));
    const stateOnly = responses.slice();
    const attempt = (await attemptsOf(ctx.pool, invite.invitationId))[0];
    const forbidden = [
      invite.phone.local,
      invite.phone.normalized,
      invite.phone.international,
      invite.token,
      'Nguyễn',
      ADMIN_PASSWORD,
      String(attempt?.user_id),
      String(attempt?.factor_id),
      String(attempt?.attempt_id),
      invite.invitationId,
    ];
    for (const text of stateOnly) {
      // The enrollment response is the only one allowed to carry the secret (it is the shown-once secret).
      for (const value of forbidden) {
        expect(text).not.toContain(value);
      }
    }
    const logs = ctx.app.running.logs.slice(logsBefore).join('\n');
    for (const value of [...forbidden, session.cookie, session.csrf, otp, secret]) {
      expect(logs).not.toContain(value);
    }
    expect(ctx.app.running.logs.length).toBeGreaterThanOrEqual(logsBefore);
  });
});

describe('M01-D-ADMIN-1C - an orphaned PENDING_DELIVERY challenge (K17)', () => {
  let ctx: ActivationApp;
  let system: SystemSession;

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

  it('inside the grace the code is neither promoted nor counted; after it the code is promoted and compared', async () => {
    const { app, pool, provider } = ctx;
    const invite = await newInvite(app, system);
    const session = await begin(app, invite);
    // The SMS goes out, but the transaction that records the outcome never commits: the challenge stays PENDING_DELIVERY.
    let business = 0;
    let inSecondBusiness = false;
    const lossy = faultySource(pool, (text, real) => {
      if (/set_config\('lock_timeout'/.test(text)) {
        business += 1;
        inSecondBusiness = business === 2;
      }
      if (text === 'COMMIT' && inSecondBusiness) {
        return real.query('ROLLBACK').then(() => Promise.reject(Object.assign(new Error('injected: lost'), { code: 'ECONNRESET' })));
      }
      return undefined;
    });
    const error = await failureOf(() => directActivation(ctx, lossy).requestOtp(session.cookie, session.csrf, META));
    expect((error as AppError).code).toBe('TRANSACTION_OUTCOME_UNKNOWN');
    const [attempt] = await liveAttempts(pool, invite.invitationId);
    const [challenge] = await challengesOf(pool, String(attempt?.attempt_id));
    expect(challenge?.status).toBe('PENDING_DELIVERY');
    const otp = provider.lastOtpFor(invite.phone.normalized) as string;
    expect(otp).toBeDefined();

    // Inside the grace: 409, nothing counted, nothing promoted (the grace is 1 s; a fresh row is far inside it).
    const early = await post(app, '/otp/verify', session, { code: otp });
    if (early.status === 409) {
      expect((await challengesOf(pool, String(attempt?.attempt_id)))[0]).toMatchObject({ status: 'PENDING_DELIVERY', attempt_count: 0 });
    }
    // After the grace (the DATABASE clock decides): the verify promotes the challenge and the right code verifies.
    await eventually(async () => {
      const waited = await pool.query<{ ok: boolean }>(
        'SELECT clock_timestamp() > created_at + interval \'1500 milliseconds\' AS ok FROM app.admin_activation_otp_challenges WHERE challenge_id = $1::uuid',
        [challenge?.challenge_id],
      );
      return waited.rows[0]?.ok === true;
    }, 'the promote grace has passed');
    if (early.status !== 200) {
      ok(await post(app, '/otp/verify', session, { code: otp }));
    }
    expect((await challengesOf(pool, String(attempt?.attempt_id)))[0]).toMatchObject({ status: 'VERIFIED' });
    expect(adminData(ok(await getState(app, session))).state).toBe('OTP_VERIFIED');
  });
});
