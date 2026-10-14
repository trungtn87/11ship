import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { runSmsGatewayCli } from '../../apps/backend/src/sms-gateway/cli/sms-gateway-cli';
import { SmsGatewayConfig } from '../../apps/backend/src/config/sms-gateway-config';
import { adminTestEnv } from './support/admin-fixtures';
import { act, attemptsOf, begin, challengesOf, Invite, newInvite, post, ok, getState } from './support/activation-fixtures';
import { api, ApiResponse, dataOf } from './support/auth-fixtures';
import { startAdminApp, AdminApp } from './support/admin-fixtures';
import { SystemSession, systemSession } from './support/provisioning-fixtures';

// Owner decision 2026-10-14: the admin invitation activation OTP is delivered by the SAME SMS gateway queue as the account OTPs
// (purpose ADMIN_ACTIVATION). The "phone" is played by calls to /v1/sms-gateway with the credential the pairing tool printed.
// Test database only.

const OPEN: SmsGatewayConfig = {
  recipientMode: 'OPEN',
  allowlist: new Set(),
  limitPhonePerHour: 3,
  limitPhonePerDay: 5,
  limitGlobalPerDay: 1000,
  onlineWindowSeconds: 90,
  leaseSeconds: 60,
  pollSeconds: 5,
};
type Job = { job_id: string; attempt_id: string; to: string; text: string };

describe('admin activation OTP through the SMS gateway (ADMIN_ACTIVATION)', () => {
  let app: AdminApp;
  let system: SystemSession;
  let token: string;

  const ctl = async (...argv: string[]): Promise<{ code: number; out: string[] }> => {
    const out: string[] = [];
    const code = await runSmsGatewayCli({ env: adminTestEnv(), argv, out: (l) => out.push(l), err: () => undefined });
    return { code, out };
  };
  const gw = (path: string, body: unknown = {}): Promise<ApiResponse> => api(app.running.baseUrl, 'POST', `/sms-gateway${path}`, { bearer: token, body });
  const claim = async (): Promise<Job | null> => dataOf(await gw('/jobs/claim', { sms_permission: true, paused: false })).job as Job | null;
  const ackJob = (job: Job, result: string): Promise<ApiResponse> => gw(`/jobs/${job.job_id}/ack`, { attempt_id: job.attempt_id, result });
  const heartbeat = (): Promise<ApiResponse> => gw('/heartbeat', { app_version: '0.2.0', sms_permission: true, paused: false });
  const otpOf = (text: string): string => /([0-9]{6})/.exec(text)?.[1] as string;
  const jobs = async (): Promise<Array<{ status: string; purpose: string; has_payload: boolean; verification_id: string | null; activation_challenge_id: string | null }>> =>
    (await app.pool.query('SELECT status, purpose, (payload_ciphertext IS NOT NULL) AS has_payload, verification_id, activation_challenge_id FROM app.sms_jobs ORDER BY created_at')).rows;

  async function attemptOf(invite: Invite): Promise<string> {
    return String((await attemptsOf(app.pool, invite.invitationId))[0]?.attempt_id);
  }

  beforeAll(async () => {
    app = await startAdminApp({ smsGateway: OPEN, activationSms: true, activationConfig: { promoteGraceMs: 1000 } });
    system = await systemSession(app);
    await app.pool.query('DELETE FROM app.sms_jobs');
    await app.pool.query('DELETE FROM app.sms_gateway_devices');
    const paired = await ctl('pair', '--label', 'Test phone');
    token = /: ([A-Za-z0-9_-]{43})$/.exec(paired.out[1] ?? '')?.[1] as string;
    expect((await ctl('enable')).code).toBe(0);
    expect((await heartbeat()).status).toBe(200);
  });
  afterAll(async () => {
    try {
      await app.pool.query('DELETE FROM app.sms_jobs');
      await app.pool.query('DELETE FROM app.sms_gateway_devices');
      await app.pool.query('DELETE FROM app.sms_gateway_control');
    } finally {
      await app.close();
    }
  });
  beforeEach(async () => {
    await app.clearLimits();
    await app.pool.query('DELETE FROM app.sms_jobs');
    expect((await ctl('enable')).code).toBe(0);
    await heartbeat();
  });

  it('queues the OTP with its own purpose, keeps the challenge PENDING_DELIVERY (even past the grace) and verifies only after SENT', async () => {
    const invite = await newInvite(app, system);
    const session = await begin(app, invite);
    ok(await post(app, '/otp/request', session), 202);
    const attemptId = await attemptOf(invite);
    expect((await challengesOf(app.pool, attemptId))[0]?.status).toBe('PENDING_DELIVERY');
    const [row] = await jobs();
    expect(row).toMatchObject({ status: 'QUEUED', purpose: 'ADMIN_ACTIVATION', has_payload: true, verification_id: null });
    expect(row?.activation_challenge_id).toBe((await challengesOf(app.pool, attemptId))[0]?.challenge_id);

    // Nothing reached the phone yet: a code (even a guess) is not verifiable, and waiting past the grace does not promote it.
    await new Promise((resolve) => setTimeout(resolve, 1300));
    const early = await post(app, '/otp/verify', session, { code: '000000' });
    expect(early.status).toBeGreaterThanOrEqual(400);
    expect((await challengesOf(app.pool, attemptId))[0]?.status).toBe('PENDING_DELIVERY');

    const job = await claim();
    expect(job?.to).toBe(invite.phone.normalized);
    expect(job?.text).toMatch(/^11Ship: Ma kich hoat quan tri cua ban la [0-9]{6}\. Hieu luc 5 phut\. Khong chia se ma nay\.$/);
    expect((await ackJob(job as Job, 'SENT')).status).toBe(200);
    expect((await challengesOf(app.pool, attemptId))[0]?.status).toBe('PENDING');
    expect((await jobs())[0]).toMatchObject({ status: 'SENT', has_payload: false });

    const wrong = await post(app, '/otp/verify', session, { code: otpOf((job as Job).text) === '000000' ? '111111' : '000000' });
    expect(wrong.status).toBeGreaterThanOrEqual(400);
    ok(await post(app, '/otp/verify', session, { code: otpOf((job as Job).text) }));
    const state = await getState(app, session);
    expect(JSON.stringify(state.body)).not.toContain(otpOf((job as Job).text));
  });

  it('FAILED closes the challenge (DELIVERY_FAILED) and the OTP can be requested again; the failed one never verifies', async () => {
    const invite = await newInvite(app, system);
    const session = await begin(app, invite);
    ok(await post(app, '/otp/request', session), 202);
    const attemptId = await attemptOf(invite);
    const job = await claim();
    const code = otpOf((job as Job).text);
    expect((await ackJob(job as Job, 'FAILED')).status).toBe(200);
    expect((await challengesOf(app.pool, attemptId))[0]?.status).toBe('DELIVERY_FAILED');
    expect((await post(app, '/otp/verify', session, { code })).status).toBeGreaterThanOrEqual(400);
    expect((await challengesOf(app.pool, attemptId))[0]?.status).toBe('DELIVERY_FAILED');
  });

  it('a lost acknowledgement is UNKNOWN: the challenge becomes verifiable and the SMS is NOT sent again', async () => {
    const invite = await newInvite(app, system);
    const session = await begin(app, invite);
    ok(await post(app, '/otp/request', session), 202);
    const attemptId = await attemptOf(invite);
    const job = await claim();
    await app.pool.query(`UPDATE app.sms_jobs SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE job_id = $1::uuid`, [job?.job_id]);
    expect(await claim()).toBeNull();
    expect((await jobs())[0]).toMatchObject({ status: 'UNKNOWN', has_payload: false });
    expect((await challengesOf(app.pool, attemptId))[0]?.status).toBe('PENDING');
    expect(await claim()).toBeNull();
    ok(await post(app, '/otp/verify', session, { code: otpOf((job as Job).text) }));
  });

  it('refuses honestly when the gateway cannot take the message: nothing queued, challenge DELIVERY_FAILED, no success', async () => {
    expect((await ctl('disable')).code).toBe(0);
    const invite = await newInvite(app, system);
    const session = await begin(app, invite);
    const refused = await post(app, '/otp/request', session);
    expect(refused.status).toBe(503);
    expect(await jobs()).toHaveLength(0);
    expect((await challengesOf(app.pool, await attemptOf(invite)))[0]?.status).toBe('DELIVERY_FAILED');
  });

  it('a superseded challenge is never handed to the gateway (only the newest OTP is sent)', async () => {
    const invite = await newInvite(app, system);
    const session = await begin(app, invite);
    ok(await post(app, '/otp/request', session), 202);
    const attemptId = await attemptOf(invite);
    // The resend cool-down is a business rule: move the first challenge's window back instead of waiting.
    await app.pool.query(`ALTER TABLE app.admin_activation_otp_challenges DISABLE TRIGGER admin_activation_otp_challenge_transition_guard`);
    try {
      await app.pool.query(`UPDATE app.admin_activation_otp_challenges SET resend_not_before = created_at + interval '1 millisecond' WHERE attempt_id = $1::uuid`, [attemptId]);
    } finally {
      await app.pool.query(`ALTER TABLE app.admin_activation_otp_challenges ENABLE TRIGGER admin_activation_otp_challenge_transition_guard`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    ok(await post(app, '/otp/request', session), 202);
    const rows = await challengesOf(app.pool, attemptId);
    expect(rows.map((r) => r.status).sort()).toEqual(['INVALIDATED', 'PENDING_DELIVERY']);
    const job = await claim();
    expect(job).not.toBeNull();
    expect(await claim()).toBeNull();
    const live = rows.find((r) => r.status === 'PENDING_DELIVERY');
    expect((await jobs()).filter((j) => j.status === 'SENT' || j.status === 'CLAIMED')).toHaveLength(1);
    expect(live).toBeDefined();
  });

  it('does not open ADMIN creation for anyone else: the gateway has no route that creates a job, and the purpose is not accepted from a request', async () => {
    const response = await act(app, 'POST', '/otp/request', { body: { purpose: 'ADMIN_ACTIVATION', phone: '0900000000' } });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await jobs()).toHaveLength(0);
  });

  // Last on purpose: a second application bootstraps its own SYSTEM account, which ends the session of the first.
  it('refuses a number outside the recipient allowlist (default policy) without queueing', async () => {
    const restricted = await startAdminApp({ smsGateway: { ...OPEN, recipientMode: 'ALLOWLIST', allowlist: new Set(['+84900000000']) }, activationSms: true });
    try {
      const restrictedSystem = await systemSession(restricted);
      const invite = await newInvite(restricted, restrictedSystem);
      const session = await begin(restricted, invite);
      expect((await post(restricted, '/otp/request', session)).status).toBe(503);
      expect(await jobs()).toHaveLength(0);
    } finally {
      await restricted.close();
    }
  });
});
