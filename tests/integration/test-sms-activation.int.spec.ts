import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import {
  attemptsOf,
  begin,
  challengesOf,
  liveAttempts,
  newInvite,
  ok,
  post,
} from './support/activation-fixtures';
import { adminData, adminErrorCode, AdminApp, startAdminApp } from './support/admin-fixtures';
import { SystemSession, systemSession } from './support/provisioning-fixtures';
import { containsCode, InboxHarness, readOtp, ScriptedActivationInbox, startInboxHarness } from './support/test-sms-fixtures';

// M01.22 (TS02, TS03, TS04, TS06-privacy) — ADMIN_ACTIVATION through the REAL Nest pipeline and REAL PostgreSQL with
// ADMIN_ACTIVATION_OTP_MODE=TEST_INBOX: the code goes to the inbox only, never to the HTTP answer (unlike
// TEST_DISPLAY), and the activation OTP rules are untouched.
describe('M01.22 — ADMIN_ACTIVATION OTP through the test inbox', () => {
  let app: AdminApp;
  let harness: InboxHarness;
  let provider: ScriptedActivationInbox;
  let system: SystemSession;

  beforeAll(async () => {
    harness = await startInboxHarness();
    provider = new ScriptedActivationInbox(harness.inbox);
    app = await startAdminApp({
      activationProvider: provider,
      // A short hard timeout so the "provider never answers" case is quick and deterministic.
      activationConfig: { otpMode: 'TEST_INBOX', providerTimeoutMs: 600 },
    });
    system = await systemSession(app);
  }, 90_000);

  afterAll(async () => {
    provider.releaseHang();
    await app.close();
    await harness.stop();
  });

  beforeEach(async () => {
    await app.clearLimits();
  });

  it('TS02: request -> code only in the inbox -> wrong code counted -> right code verifies -> the step cannot be replayed', async () => {
    const invite = await newInvite(app, system);
    const session = await begin(app, invite);
    const requested = ok(await post(app, '/otp/request', session), 202);

    // TEST_INBOX never uses the HTTP answer to hand out the code (that is TEST_DISPLAY).
    expect(Object.keys(adminData(requested)).sort()).toEqual(['delivery', 'resend_at']);
    expect(requested.text).not.toContain('displayed_code');

    const otp = await readOtp(harness, 'ADMIN_ACTIVATION', invite.phone.normalized);
    expect(otp).toMatch(/^[0-9]{6}$/);
    expect(containsCode(requested.text, otp)).toBe(false);

    const wrong = otp === '000000' ? '111111' : '000000';
    const bad = await post(app, '/otp/verify', session, { code: wrong });
    expect([bad.status, adminErrorCode(bad)]).toEqual([400, 'OTP_INVALID']);

    const good = ok(await post(app, '/otp/verify', session, { code: otp }));
    expect(containsCode(good.text, otp)).toBe(false);

    // The OTP step is over: using the same code again is a state error, not a second success.
    const again = await post(app, '/otp/verify', session, { code: otp });
    expect([again.status, adminErrorCode(again)]).toEqual([409, 'ADMIN_ACTIVATION_STEP_INVALID']);
  });

  it('TS03: a resend inside the cooldown is refused and writes nothing into the inbox; five wrong codes lock the challenge', async () => {
    const invite = await newInvite(app, system);
    const session = await begin(app, invite);
    ok(await post(app, '/otp/request', session), 202);
    const otp = await readOtp(harness, 'ADMIN_ACTIVATION', invite.phone.normalized);
    const size = harness.inbox.size();

    const early = await post(app, '/otp/request', session);
    expect(adminErrorCode(early)).toBe('OTP_RATE_LIMITED');
    expect(harness.inbox.size()).toBe(size);

    const wrong = otp === '000000' ? '111111' : '000000';
    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect(adminErrorCode(await post(app, '/otp/verify', session, { code: wrong }))).toBe('OTP_INVALID');
    }
    expect(adminErrorCode(await post(app, '/otp/verify', session, { code: wrong }))).toBe('OTP_RATE_LIMITED');
    // Even the right code is refused once the challenge is locked; reading the inbox again changes nothing.
    expect(adminErrorCode(await post(app, '/otp/verify', session, { code: await readOtp(harness, 'ADMIN_ACTIVATION', invite.phone.normalized) }))).toBe(
      'OTP_RATE_LIMITED',
    );
  });

  it('TS04: REJECTED is 503 with the challenge DELIVERY_FAILED and nothing in the inbox; an immediate retry works', async () => {
    const invite = await newInvite(app, system);
    const session = await begin(app, invite);
    const before = harness.inbox.size();
    provider.script('REJECT');
    const rejected = await post(app, '/otp/request', session);
    expect(rejected.status).toBe(503);
    expect(harness.inbox.size()).toBe(before);
    const [attempt] = await liveAttempts(app.pool, invite.invitationId);
    expect((await challengesOf(app.pool, String(attempt?.attempt_id))).map((row) => row.status)).toEqual(['DELIVERY_FAILED']);

    ok(await post(app, '/otp/request', session), 202);
    expect((await challengesOf(app.pool, String(attempt?.attempt_id))).map((row) => row.status)).toEqual(['DELIVERY_FAILED', 'PENDING']);
    ok(await post(app, '/otp/verify', session, { code: await readOtp(harness, 'ADMIN_ACTIVATION', invite.phone.normalized) }));
  });

  it('TS04: an exception is UNKNOWN (202, never retried blindly): nothing was stored, so there is no code to read', async () => {
    const invite = await newInvite(app, system);
    const session = await begin(app, invite);
    const started = provider.started;
    provider.script('THROW');
    ok(await post(app, '/otp/request', session), 202);
    expect(provider.started).toBe(started + 1);
    await expect(readOtp(harness, 'ADMIN_ACTIVATION', invite.phone.normalized)).rejects.toThrow();
  });

  it('TS04: a response lost AFTER the append is UNKNOWN too, and the stored code is the real one and verifies', async () => {
    const invite = await newInvite(app, system);
    const session = await begin(app, invite);
    provider.script('LOST_RESPONSE');
    ok(await post(app, '/otp/request', session), 202);
    const otp = await readOtp(harness, 'ADMIN_ACTIVATION', invite.phone.normalized);
    ok(await post(app, '/otp/verify', session, { code: otp }));
  });

  it('TS04: a provider that never answers is cut by the timeout into UNKNOWN (202), exactly one send', async () => {
    const invite = await newInvite(app, system);
    const session = await begin(app, invite);
    const started = provider.started;
    provider.script('HANG');
    const answered = await post(app, '/otp/request', session);
    provider.releaseHang();
    expect(answered.status).toBe(202);
    expect(provider.started).toBe(started + 1);
    const [attempt] = await attemptsOf(app.pool, invite.invitationId);
    expect((await challengesOf(app.pool, String(attempt?.attempt_id))).map((row) => row.status)).toEqual(['PENDING']);
  });

  it('TS06: the code is in no database row, audit row, application log or API answer', async () => {
    const invite = await newInvite(app, system);
    const session = await begin(app, invite);
    const requested = ok(await post(app, '/otp/request', session), 202);
    const otp = await readOtp(harness, 'ADMIN_ACTIVATION', invite.phone.normalized);
    const verified = ok(await post(app, '/otp/verify', session, { code: otp }));

    const [attempt] = await attemptsOf(app.pool, invite.invitationId);
    const dump = await app.pool.query<{ dump: string }>(
      `SELECT t::text AS dump FROM app.admin_activation_otp_challenges t WHERE attempt_id = $1::uuid
       UNION ALL SELECT t::text FROM app.admin_activation_attempts t WHERE attempt_id = $1::uuid
       UNION ALL SELECT t::text FROM app.audit_logs t WHERE request_id = ANY($2::uuid[])`,
      [String(attempt?.attempt_id), [requested.requestId, verified.requestId]],
    );
    for (const row of dump.rows) {
      expect(containsCode(row.dump, otp)).toBe(false);
    }
    for (const text of [requested.text, verified.text, ...app.running.logs]) {
      expect(containsCode(text, otp)).toBe(false);
    }
  });
});
