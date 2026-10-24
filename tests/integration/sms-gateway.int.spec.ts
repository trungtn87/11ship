import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { SmsQueueService } from '../../apps/backend/src/sms-gateway/sms-queue-service';
import { SmsQueueSweeper } from '../../apps/backend/src/sms-gateway/sms-queue-sweeper';
import { runSmsGatewayCli } from '../../apps/backend/src/sms-gateway/cli/sms-gateway-cli';
import { SmsGatewayConfig } from '../../apps/backend/src/config/sms-gateway-config';
import { Argon2idPasswordHasher } from '../../apps/backend/src/auth/password-hasher';
import { digestToken } from '../../apps/backend/src/auth/tokens';
import {
  AdminApp,
  adminTestEnv,
  count,
  createAdminMember,
  createSystem,
  enrollAndLogin,
  loginBody,
  sessionCookies,
  startAdminApp,
} from './support/admin-fixtures';
import { api, ApiResponse, dataOf, errorCode, grantRole, PASSWORD, Phone, randomPhone } from './support/auth-fixtures';

// Issue #102 on the REAL Nest pipeline and a REAL PostgreSQL (TEST database only): the SMS gateway queue, the gateway API, the
// REGISTER delivery states and the RESET_PASSWORD (SMS_OTP) flow. The "phone" is played by calls to /v1/sms-gateway with the
// credential the pairing tool printed; the OTP is read from the claim response, exactly where a real phone gets it.

const NEW_PASSWORD = 'Brand-New-Passw0rd-7';
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

interface Paired {
  readonly deviceId: string;
  readonly token: string;
}

async function ctl(...argv: string[]): Promise<{ code: number; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runSmsGatewayCli({ env: adminTestEnv(), argv, out: (line) => out.push(line), err: (line) => err.push(line) });
  return { code, out, err };
}

async function pair(label = 'Test phone'): Promise<Paired> {
  const result = await ctl('pair', '--label', label);
  expect(result.code).toBe(0);
  const deviceId = /paired device ([0-9a-f-]{36})/.exec(result.out.join('\n'))?.[1];
  const token = /: ([A-Za-z0-9_-]{43})$/.exec(result.out[1] ?? '')?.[1];
  if (deviceId === undefined || token === undefined) {
    throw new Error('pairing output was not understood');
  }
  return { deviceId, token };
}

describe('issue #102 SMS gateway: queue, gateway API, REGISTER and RESET_PASSWORD OTP', () => {
  let app: AdminApp;
  let closed: AdminApp;
  let device: Paired;
  const hasher = new Argon2idPasswordHasher();

  const gw = (token: string, path: string, body: unknown = {}): Promise<ApiResponse> =>
    api(app.running.baseUrl, 'POST', `/sms-gateway${path}`, { bearer: token, body });
  const claim = async (token = device.token) => dataOf(await gw(token, '/jobs/claim', { sms_permission: true, paused: false })).job as
    | { job_id: string; attempt_id: string; to: string; text: string; lease_seconds: number }
    | null;
  const ack = (job: { job_id: string; attempt_id: string }, result: string, token = device.token, attemptId = job.attempt_id): Promise<ApiResponse> =>
    gw(token, `/jobs/${job.job_id}/ack`, { attempt_id: attemptId, result });
  const otpOf = (text: string): string => /([0-9]{6})/.exec(text)?.[1] as string;
  const heartbeat = (token = device.token, body: Record<string, unknown> = { app_version: '0.2.0', sms_permission: true, paused: false }) => gw(token, '/heartbeat', body);

  const requestRegisterOtp = (phone: Phone, target: AdminApp = app): Promise<ApiResponse> =>
    api(target.running.baseUrl, 'POST', '/auth/phone-verifications', { body: { phone: phone.local, purpose: 'REGISTER' } });
  const verifyRegister = (id: string, otp: string): Promise<ApiResponse> =>
    api(app.running.baseUrl, 'POST', `/auth/phone-verifications/${id}/verify`, { body: { otp } });
  const requestResetOtp = (phoneLocal: string, target: AdminApp = app, prefix = '/account-recovery'): Promise<ApiResponse> =>
    api(target.running.baseUrl, 'POST', `${prefix}/otp`, { body: { phone: phoneLocal } });
  const verifyReset = (id: string, otp: string, prefix = '/account-recovery'): Promise<ApiResponse> =>
    api(app.running.baseUrl, 'POST', `${prefix}/otp/${id}/verify`, { body: { otp } });
  const resetPassword = (token: string, password: string = NEW_PASSWORD, key: string = randomUUID(), prefix = '/account-recovery'): Promise<ApiResponse> =>
    api(app.running.baseUrl, 'POST', `${prefix}/reset`, { headers: { 'idempotency-key': key }, body: { verification_token: token, password } });
  const deliveryOf = async (id: string): Promise<string> => String(dataOf(await api(app.running.baseUrl, 'GET', `/auth/phone-verifications/${id}`)).delivery_status);

  const challenge = async (id: string) =>
    (await app.pool.query<{ status: string; attempt_count: number }>('SELECT status, attempt_count FROM app.phone_verifications WHERE verification_id = $1::uuid', [id])).rows[0];
  const jobOf = async (verificationId: string) =>
    (
      await app.pool.query<{ job_id: string; status: string; has_payload: boolean; result_code: string | null; purpose: string }>(
        'SELECT job_id, status, (payload_ciphertext IS NOT NULL) AS has_payload, result_code, purpose FROM app.sms_jobs WHERE verification_id = $1::uuid',
        [verificationId],
      )
    ).rows[0];

  async function seedUser(): Promise<{ phone: Phone; userId: string }> {
    const phone = randomPhone();
    app.track(phone.normalized);
    const userId = randomUUID();
    await app.pool.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
       VALUES ($1::uuid, $2, $3, now(), 'PHONE_VERIFIED', 'ACTIVE', 1, now(), now())`,
      [userId, phone.normalized, await hasher.hash(PASSWORD)],
    );
    await grantRole(app.pool, userId, 'CUSTOMER');
    return { phone, userId };
  }

  async function wipeQueue(pool = app.pool): Promise<void> {
    await pool.query('DELETE FROM app.sms_jobs');
  }

  beforeAll(async () => {
    app = await startAdminApp({ smsGateway: OPEN });
    closed = await startAdminApp();
    await wipeQueue();
    await app.pool.query('DELETE FROM app.sms_gateway_devices');
    device = await pair();
    expect((await ctl('enable')).code).toBe(0);
    expect((await heartbeat()).status).toBe(200);
  });

  afterAll(async () => {
    try {
      await wipeQueue();
      await app.pool.query('DELETE FROM app.sms_gateway_devices');
      await app.pool.query('DELETE FROM app.sms_gateway_control');
    } finally {
      await closed.close();
      await app.close();
    }
  });

  describe('pairing and device credential', () => {
    it('stores only the digest of the 256-bit credential and refuses every other credential with the same 401', async () => {
      expect(device.token).toHaveLength(43);
      const row = await app.pool.query<{ credential_digest: string }>('SELECT credential_digest FROM app.sms_gateway_devices WHERE device_id = $1::uuid', [device.deviceId]);
      expect(row.rows[0]?.credential_digest).toMatch(/^[0-9a-f]{64}$/);
      expect(row.rows[0]?.credential_digest).not.toContain(device.token);

      for (const bearer of ['A'.repeat(43), 'short', device.token.slice(0, 42), `${device.token}x`]) {
        const response = await gw(bearer, '/heartbeat');
        expect([response.status, errorCode(response)]).toEqual([401, 'GATEWAY_UNAUTHORIZED']);
      }
      const none = await api(app.running.baseUrl, 'POST', '/sms-gateway/heartbeat', { body: {} });
      expect([none.status, errorCode(none)]).toEqual([401, 'GATEWAY_UNAUTHORIZED']);
      expect((await heartbeat()).status).toBe(200);
    });

    it('does not accept a user session, and has no route that creates a job or takes a recipient or a text', async () => {
      const user = await seedUser();
      const login = await api(app.running.baseUrl, 'POST', '/client-auth/login', {
        headers: { 'idempotency-key': randomUUID() },
        body: { phone: user.phone.local, password: PASSWORD, device: { device_id: 'web-food-0001', platform: 'WEB', app: 'FOOD' } },
      });
      const sessionToken = String(login.body.data?.access_token ?? 'x'.repeat(43));
      expect((await gw(sessionToken, '/heartbeat')).status).toBe(401);
      for (const path of ['/jobs', '/jobs/send', '/send', '/sms']) {
        expect([404, 401]).toContain((await gw(device.token, path, { to: '+84900000000', text: 'hi' })).status);
      }
      const forged = await gw(device.token, '/jobs/claim', { to: '+84900000000', text: 'hi' });
      expect(forged.status).toBe(400);
    });

    it('a revoked credential stops working at once; pairing again gives a different credential', async () => {
      const other = await pair('Spare');
      expect((await heartbeat(other.token)).status).toBe(200);
      expect((await ctl('revoke', '--device-id', other.deviceId)).code).toBe(0);
      const refused = await heartbeat(other.token);
      expect([refused.status, errorCode(refused)]).toEqual([401, 'GATEWAY_UNAUTHORIZED']);
      expect((await ctl('revoke', '--device-id', other.deviceId)).code).toBe(1);
      expect((await heartbeat()).status).toBe(200);
      const listed = await ctl('list');
      expect(listed.out.join('\n')).not.toContain(device.token);
      expect(listed.out.join('\n')).toContain('sending ENABLED');
    });
  });

  describe('REGISTER through the queue', () => {
    it('queues first, cannot be verified until the phone reports SENT, and never keeps or logs the OTP in clear', async () => {
      const phone = randomPhone();
      app.track(phone.normalized);
      const requested = await requestRegisterOtp(phone);
      expect(requested.status).toBe(201);
      const data = dataOf(requested);
      expect(data.delivery_status).toBe('PENDING_DELIVERY');
      const id = String(data.verification_id);
      expect((await challenge(id))?.status).toBe('PENDING_DELIVERY');
      expect(await deliveryOf(id)).toBe('PENDING_DELIVERY');
      const queued = await jobOf(id);
      expect([queued?.status, queued?.has_payload, queued?.purpose]).toEqual(['QUEUED', true, 'REGISTER']);

      const job = await claim();
      expect(job).not.toBeNull();
      const message = job as NonNullable<typeof job>;
      expect(message.to).toBe(phone.normalized);
      expect(message.text).toMatch(/^11Ship: Ma xac thuc dang ky cua ban la [0-9]{6}\. Hieu luc 5 phut\. Khong chia se ma nay\.$/);
      const otp = otpOf(message.text);

      // Handed to the phone but not reported: still no way to verify, even with the right code.
      const early = await verifyRegister(id, otp);
      expect([early.status, errorCode(early)]).toEqual([400, 'OTP_INVALID']);
      expect((await challenge(id))?.attempt_count).toBe(0);

      const sent = await ack(message, 'SENT');
      expect([sent.status, dataOf(sent).status]).toEqual([200, 'SENT']);
      expect((await challenge(id))?.status).toBe('PENDING');
      expect(await deliveryOf(id)).toBe('SENT');
      const done = await jobOf(id);
      expect([done?.status, done?.has_payload]).toEqual(['SENT', false]);

      const wrong = await verifyRegister(id, otp === '000000' ? '111111' : '000000');
      expect([wrong.status, errorCode(wrong)]).toEqual([400, 'OTP_INVALID']);
      const verified = await verifyRegister(id, otp);
      expect(verified.status).toBe(200);
      expect(dataOf(verified).purpose).toBe('REGISTER');
      const again = await verifyRegister(id, otp);
      expect([again.status, errorCode(again)]).toEqual([409, 'OTP_ALREADY_USED']);

      // Nowhere at rest or in the logs: the sealed envelope is gone and the code was never written in clear.
      const tables = await app.pool.query<{ hit: boolean }>(
        `SELECT (
           EXISTS (SELECT 1 FROM app.sms_jobs WHERE row_to_json(sms_jobs)::text LIKE $1)
        OR EXISTS (SELECT 1 FROM app.audit_logs WHERE row_to_json(audit_logs)::text LIKE $1)
        OR EXISTS (SELECT 1 FROM app.outbox_events WHERE row_to_json(outbox_events)::text LIKE $1)
        ) AS hit`,
        [`%${otp}%`],
      );
      expect(tables.rows[0]?.hit).toBe(false);
      expect(app.running.logs.join('\n')).not.toContain(otp);
      expect(app.running.logs.join('\n')).not.toContain(phone.normalized);
    });

    it('seals the message at rest while it is waiting (no OTP, no number in the stored bytes)', async () => {
      const phone = randomPhone();
      app.track(phone.normalized);
      const id = String(dataOf(await requestRegisterOtp(phone)).verification_id);
      const raw = await app.pool.query<{ payload_ciphertext: Buffer; payload_iv: Buffer; payload_tag: Buffer; crypto_key_id: string }>(
        'SELECT payload_ciphertext, payload_iv, payload_tag, crypto_key_id FROM app.sms_jobs WHERE verification_id = $1::uuid',
        [id],
      );
      const row = raw.rows[0];
      expect(row?.payload_iv).toHaveLength(12);
      expect(row?.payload_tag).toHaveLength(16);
      expect(row?.payload_ciphertext.toString('latin1')).not.toContain(phone.normalized);
      expect(row?.payload_ciphertext.toString('latin1')).not.toContain('11Ship');
      expect(row?.crypto_key_id).toBe('k1');
      const job = (await claim()) as NonNullable<Awaited<ReturnType<typeof claim>>>;
      await ack(job, 'FAILED');
    });

    it('hands a job out at most once, even to concurrent claims, and an acknowledgement is idempotent', async () => {
      const phone = randomPhone();
      app.track(phone.normalized);
      const id = String(dataOf(await requestRegisterOtp(phone)).verification_id);
      const results = await Promise.all([claim(), claim(), claim(), claim()]);
      const got = results.filter((job) => job !== null) as Array<NonNullable<(typeof results)[number]>>;
      expect(got).toHaveLength(1);
      const job = got[0] as (typeof got)[number];
      expect(await claim()).toBeNull();

      expect((await ack(job, 'SENT')).status).toBe(200);
      const repeat = await ack(job, 'SENT');
      expect([repeat.status, dataOf(repeat).status]).toEqual([200, 'SENT']);
      const contradict = await ack(job, 'FAILED');
      expect([contradict.status, errorCode(contradict)]).toEqual([409, 'GATEWAY_ACK_CONFLICT']);
      expect((await jobOf(id))?.status).toBe('SENT');
      expect((await challenge(id))?.status).toBe('PENDING');
      // The delivery receipt is recorded once SENT is known.
      expect((await ack(job, 'DELIVERED')).status).toBe(200);
      expect(await count(app.pool, 'SELECT 1 FROM app.sms_jobs WHERE verification_id = $1::uuid AND delivered_at IS NOT NULL', [id])).toBe(1);
    });

    it('refuses an acknowledgement with another attempt, another job or another device (one uniform 404)', async () => {
      const phone = randomPhone();
      app.track(phone.normalized);
      await requestRegisterOtp(phone);
      const job = (await claim()) as NonNullable<Awaited<ReturnType<typeof claim>>>;
      const stranger = await pair('Stranger');
      expect((await heartbeat(stranger.token)).status).toBe(200);
      for (const response of [
        await ack(job, 'SENT', device.token, randomUUID()),
        await ack(job, 'SENT', stranger.token),
        await gw(device.token, `/jobs/${randomUUID()}/ack`, { attempt_id: job.attempt_id, result: 'SENT' }),
      ]) {
        expect([response.status, errorCode(response)]).toEqual([404, 'GATEWAY_JOB_NOT_FOUND']);
      }
      const malformed = await gw(device.token, `/jobs/${job.job_id}/ack`, { attempt_id: job.attempt_id, result: 'SENT', text: 'x' });
      expect(malformed.status).toBe(400);
      expect((await ack(job, 'FAILED')).status).toBe(200);
      await ctl('revoke', '--device-id', stranger.deviceId);
    });

    it('a lost acknowledgement becomes UNKNOWN: it is never resent, the code stays usable, and a late report refines it', async () => {
      const phone = randomPhone();
      app.track(phone.normalized);
      const id = String(dataOf(await requestRegisterOtp(phone)).verification_id);
      const job = (await claim()) as NonNullable<Awaited<ReturnType<typeof claim>>>;
      const otp = otpOf(job.text);
      await app.pool.query(`UPDATE app.sms_jobs SET lease_expires_at = now() - interval '1 second' WHERE verification_id = $1::uuid`, [id]);

      // The next poll closes the expired lease and does NOT hand the same job out again.
      expect(await claim()).toBeNull();
      const unknown = await jobOf(id);
      expect([unknown?.status, unknown?.has_payload, unknown?.result_code]).toEqual(['UNKNOWN', false, 'LEASE_EXPIRED']);
      expect(await claim()).toBeNull();
      expect(await deliveryOf(id)).toBe('UNCERTAIN');
      // The SMS may have arrived: the code can still be used (it was never shown to anybody else).
      expect((await challenge(id))?.status).toBe('PENDING');

      expect((await ack(job, 'SENT')).status).toBe(200);
      expect((await jobOf(id))?.status).toBe('SENT');
      expect((await verifyRegister(id, otp)).status).toBe(200);
    });

    it('an UNKNOWN job later reported FAILED closes the challenge', async () => {
      const phone = randomPhone();
      app.track(phone.normalized);
      const id = String(dataOf(await requestRegisterOtp(phone)).verification_id);
      const job = (await claim()) as NonNullable<Awaited<ReturnType<typeof claim>>>;
      expect((await ack(job, 'UNKNOWN')).status).toBe(200);
      expect((await challenge(id))?.status).toBe('PENDING');
      expect((await ack(job, 'FAILED')).status).toBe(200);
      expect((await challenge(id))?.status).toBe('DELIVERY_FAILED');
      expect(await deliveryOf(id)).toBe('FAILED');
    });

    it('FAILED closes the challenge so that the user can ask again at once; the new challenge supersedes nothing live', async () => {
      const phone = randomPhone();
      app.track(phone.normalized);
      const first = String(dataOf(await requestRegisterOtp(phone)).verification_id);
      const job = (await claim()) as NonNullable<Awaited<ReturnType<typeof claim>>>;
      expect((await ack(job, 'FAILED')).status).toBe(200);
      expect((await challenge(first))?.status).toBe('DELIVERY_FAILED');
      const second = await requestRegisterOtp(phone);
      expect(second.status).toBe(201);
      const retry = (await claim()) as NonNullable<Awaited<ReturnType<typeof claim>>>;
      await ack(retry, 'SENT');
      // A second request while the first is live is refused by the existing 60 s cooldown.
      const tooSoon = await requestRegisterOtp(phone);
      expect([tooSoon.status, errorCode(tooSoon)]).toEqual([429, 'OTP_RATE_LIMITED']);
    });

    it('an expired OTP is never sent: the job expires, the ciphertext is erased and the challenge is closed', async () => {
      const phone = randomPhone();
      app.track(phone.normalized);
      const id = String(dataOf(await requestRegisterOtp(phone)).verification_id);
      await app.pool.query(`UPDATE app.sms_jobs SET expires_at = created_at + interval '1 millisecond' WHERE verification_id = $1::uuid`, [id]);
      await app.pool.query(`UPDATE app.phone_verifications SET expires_at = created_at + interval '1 millisecond' WHERE verification_id = $1::uuid`, [id]);
      expect(await claim()).toBeNull();
      const expired = await jobOf(id);
      expect([expired?.status, expired?.has_payload, expired?.result_code]).toEqual(['EXPIRED', false, 'OTP_EXPIRED']);
      expect((await challenge(id))?.status).toBe('DELIVERY_FAILED');
      expect(await deliveryOf(id)).toBe('EXPIRED');
    });

    it('a wrong code three times locks the challenge, and a challenge verifies once', async () => {
      const phone = randomPhone();
      app.track(phone.normalized);
      const id = String(dataOf(await requestRegisterOtp(phone)).verification_id);
      const job = (await claim()) as NonNullable<Awaited<ReturnType<typeof claim>>>;
      await ack(job, 'SENT');
      const otp = otpOf(job.text);
      const wrong = otp === '000000' ? '111111' : '000000';
      for (let attempt = 0; attempt < 2; attempt += 1) {
        expect(errorCode(await verifyRegister(id, wrong))).toBe('OTP_INVALID');
      }
      const locked = await verifyRegister(id, wrong);
      expect([locked.status, errorCode(locked)]).toEqual([429, 'OTP_RATE_LIMITED']);
      const stillLocked = await verifyRegister(id, otp);
      expect([stillLocked.status, errorCode(stillLocked)]).toEqual([429, 'OTP_RATE_LIMITED']);
    });

    it('creates no account without the proof, and the proof from the queue registers exactly once', async () => {
      const phone = randomPhone();
      app.track(phone.normalized);
      const noProof = await api(app.running.baseUrl, 'POST', '/auth/register', {
        headers: { 'idempotency-key': randomUUID() },
        body: { phone: phone.local, password: PASSWORD, verification_token: 'A'.repeat(43), device: { device_id: 'dev-register-0001', platform: 'WEB', app: 'FOOD' } },
      });
      expect(noProof.status).toBe(400);
      expect(await count(app.pool, 'SELECT 1 FROM app.users WHERE phone_normalized = $1', [phone.normalized])).toBe(0);

      const id = String(dataOf(await requestRegisterOtp(phone)).verification_id);
      const job = (await claim()) as NonNullable<Awaited<ReturnType<typeof claim>>>;
      await ack(job, 'SENT');
      const token = String(dataOf(await verifyRegister(id, otpOf(job.text))).verification_token);
      const body = { phone: phone.local, password: PASSWORD, verification_token: token, device: { device_id: 'dev-register-0001', platform: 'WEB', app: 'FOOD' } };
      expect((await api(app.running.baseUrl, 'POST', '/auth/register', { headers: { 'idempotency-key': randomUUID() }, body })).status).toBe(201);
      const reused = await api(app.running.baseUrl, 'POST', '/auth/register', { headers: { 'idempotency-key': randomUUID() }, body });
      expect(reused.status).toBeGreaterThanOrEqual(400);
      expect(await count(app.pool, 'SELECT 1 FROM app.users WHERE phone_normalized = $1', [phone.normalized])).toBe(1);
    });
  });

  describe('cleanup without any gateway polling (review finding B2)', () => {
    const sealedOf = async (verificationId: string) =>
      (await app.pool.query<{ n: string }>('SELECT count(*)::text AS n FROM app.sms_jobs WHERE verification_id = $1::uuid AND payload_ciphertext IS NOT NULL', [verificationId])).rows[0]?.n;

    it('a QUEUED job whose OTP expired is closed by the sweep alone: ciphertext erased, challenge closed, nothing handed out later', async () => {
      const phone = randomPhone();
      app.track(phone.normalized);
      const id = String(dataOf(await requestRegisterOtp(phone)).verification_id);
      await app.pool.query(`UPDATE app.sms_jobs SET expires_at = created_at + interval '1 millisecond' WHERE verification_id = $1::uuid`, [id]);
      await app.pool.query(`UPDATE app.phone_verifications SET expires_at = created_at + interval '1 millisecond' WHERE verification_id = $1::uuid`, [id]);
      expect(await sealedOf(id)).toBe('1');

      // No claim, no heartbeat: only the sweep runs.
      const result = await app.running.app.get(SmsQueueService).sweep();
      expect(result.closed).toBeGreaterThanOrEqual(1);
      const job = await jobOf(id);
      expect([job?.status, job?.has_payload, job?.result_code]).toEqual(['EXPIRED', false, 'OTP_EXPIRED']);
      expect(await sealedOf(id)).toBe('0');
      expect((await challenge(id))?.status).toBe('DELIVERY_FAILED');
      expect(await deliveryOf(id)).toBe('EXPIRED');
      // Idempotent: a second sweep changes nothing, and the dead job is never claimable.
      expect((await app.running.app.get(SmsQueueService).sweep()).closed).toBe(0);
      expect(await claim()).toBeNull();
    });

    it('a CLAIMED job whose phone vanished becomes UNKNOWN by the sweep: ciphertext erased, never requeued, the code stays usable', async () => {
      const phone = randomPhone();
      app.track(phone.normalized);
      const id = String(dataOf(await requestRegisterOtp(phone)).verification_id);
      const job = (await claim()) as NonNullable<Awaited<ReturnType<typeof claim>>>;
      const otp = otpOf(job.text);
      await app.pool.query(`UPDATE app.sms_jobs SET lease_expires_at = now() - interval '1 second' WHERE verification_id = $1::uuid`, [id]);

      await app.running.app.get(SmsQueueService).sweep();
      const closed = await jobOf(id);
      expect([closed?.status, closed?.has_payload, closed?.result_code]).toEqual(['UNKNOWN', false, 'LEASE_EXPIRED']);
      expect(await sealedOf(id)).toBe('0');
      expect(await claim()).toBeNull();
      expect((await challenge(id))?.status).toBe('PENDING');
      expect(await deliveryOf(id)).toBe('UNCERTAIN');
      // A late report from the (returning) phone still refines it, as before.
      expect((await ack(job, 'SENT')).status).toBe(200);
      expect((await verifyRegister(id, otp)).status).toBe(200);
    });

    it('does not touch live work: a fresh QUEUED job and a CLAIMED job inside its lease survive the sweep', async () => {
      const phoneA = randomPhone();
      const phoneB = randomPhone();
      app.track(phoneA.normalized);
      app.track(phoneB.normalized);
      const queued = String(dataOf(await requestRegisterOtp(phoneA)).verification_id);
      const claimedId = String(dataOf(await requestRegisterOtp(phoneB)).verification_id);
      // The oldest QUEUED job is handed out first; make sure it is the second one by claiming twice and keeping the 2nd.
      const first = (await claim()) as NonNullable<Awaited<ReturnType<typeof claim>>>;
      await app.running.app.get(SmsQueueService).sweep();
      for (const id of [queued, claimedId]) {
        expect(await sealedOf(id)).toBe('1');
      }
      expect(['QUEUED', 'CLAIMED']).toContain((await jobOf(queued))?.status);
      expect((await ack(first, 'FAILED')).status).toBe(200);
      const second = (await claim()) as NonNullable<Awaited<ReturnType<typeof claim>>>;
      expect((await ack(second, 'FAILED')).status).toBe(200);
    });

    it('runs by itself: the module timer closes expired work with no request at all, and stops cleanly', async () => {
      const phone = randomPhone();
      app.track(phone.normalized);
      const id = String(dataOf(await requestRegisterOtp(phone)).verification_id);
      await app.pool.query(`UPDATE app.sms_jobs SET expires_at = created_at + interval '1 millisecond' WHERE verification_id = $1::uuid`, [id]);
      await app.pool.query(`UPDATE app.phone_verifications SET expires_at = created_at + interval '1 millisecond' WHERE verification_id = $1::uuid`, [id]);

      const sweeper = app.running.app.get(SmsQueueSweeper);
      sweeper.start(50);
      try {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline && (await jobOf(id))?.status !== 'EXPIRED') {
          await new Promise((resolve) => setTimeout(resolve, 60));
        }
      } finally {
        sweeper.stop();
      }
      expect((await jobOf(id))?.status).toBe('EXPIRED');
      expect(await sealedOf(id)).toBe('0');
      sweeper.start(30_000);
    });

    it('a flag-off application has no queue, no sweeper and therefore no timer', () => {
      expect(() => closed.running.app.get(SmsQueueSweeper)).toThrow();
    });
  });

  describe('fail-closed gates: kill switch, offline gateway, caps and recipient policy', () => {
    it('answers 503 and writes NO challenge when the kill switch is off, the gateway is stale, paused or without permission', async () => {
      const phone = randomPhone();
      app.track(phone.normalized);
      const noChallenge = (): Promise<number> => count(app.pool, 'SELECT 1 FROM app.phone_verifications WHERE phone_normalized = $1', [phone.normalized]);

      expect((await ctl('disable')).code).toBe(0);
      const killed = await requestRegisterOtp(phone);
      expect(killed.status).toBe(503);
      expect(await noChallenge()).toBe(0);
      // The phone is told too: the heartbeat answer carries the switch and a claim hands nothing out.
      expect(dataOf(await heartbeat()).sending_enabled).toBe(false);
      expect(dataOf(await gw(device.token, '/jobs/claim', { sms_permission: true, paused: false })).job).toBeNull();
      expect((await ctl('enable')).code).toBe(0);

      await app.pool.query(`UPDATE app.sms_gateway_devices SET last_seen_at = now() - interval '1 hour' WHERE device_id = $1::uuid`, [device.deviceId]);
      expect((await requestRegisterOtp(phone)).status).toBe(503);
      await heartbeat(device.token, { sms_permission: true, paused: true });
      expect((await requestRegisterOtp(phone)).status).toBe(503);
      await heartbeat(device.token, { sms_permission: false, paused: false });
      expect((await requestRegisterOtp(phone)).status).toBe(503);
      expect(await noChallenge()).toBe(0);
      await heartbeat(device.token, { sms_permission: true, paused: false });
      const back = await requestRegisterOtp(phone);
      expect(back.status).toBe(201);
      const job = (await claim()) as NonNullable<Awaited<ReturnType<typeof claim>>>;
      await ack(job, 'FAILED');
    });

    it('a paused or permission-less phone is handed no job even if a queued one exists', async () => {
      const phone = randomPhone();
      app.track(phone.normalized);
      const id = String(dataOf(await requestRegisterOtp(phone)).verification_id);
      expect(dataOf(await gw(device.token, '/jobs/claim', { sms_permission: true, paused: true })).job).toBeNull();
      expect(dataOf(await gw(device.token, '/jobs/claim', { sms_permission: false, paused: false })).job).toBeNull();
      expect((await jobOf(id))?.status).toBe('QUEUED');
      const job = (await claim()) as NonNullable<Awaited<ReturnType<typeof claim>>>;
      await ack(job, 'FAILED');
    });

    it('caps the challenges per phone per hour (429) with the configured limit', async () => {
      const phone = randomPhone();
      app.track(phone.normalized);
      for (let i = 0; i < OPEN.limitPhonePerHour; i += 1) {
        expect((await requestRegisterOtp(phone)).status).toBe(201);
        const job = (await claim()) as NonNullable<Awaited<ReturnType<typeof claim>>>;
        await ack(job, 'FAILED');
      }
      const capped = await requestRegisterOtp(phone);
      expect([capped.status, errorCode(capped)]).toEqual([429, 'OTP_RATE_LIMITED']);
    });

    it('caps the whole gateway per day and refuses outside the allowlist, with the default ALLOWLIST mode', async () => {
      const allowed = randomPhone();
      const blocked = randomPhone();
      for (const phone of [allowed, blocked]) {
        app.track(phone.normalized);
      }
      const strict = await startAdminApp({
        smsGateway: { ...OPEN, recipientMode: 'ALLOWLIST', allowlist: new Set([allowed.normalized]), limitGlobalPerDay: 2 },
      });
      try {
        await wipeQueue(strict.pool);
        const outside = await requestRegisterOtp(blocked, strict);
        expect([outside.status]).toEqual([503]);
        expect(await count(strict.pool, 'SELECT 1 FROM app.phone_verifications WHERE phone_normalized = $1', [blocked.normalized])).toBe(0);
        // Two jobs allowed by the daily cap of this application, the third is refused.
        for (let i = 0; i < 2; i += 1) {
          const response = await requestRegisterOtp(allowed, strict);
          expect(response.status).toBe(201);
          const job = (await claim()) as NonNullable<Awaited<ReturnType<typeof claim>>>;
          await ack(job, 'FAILED');
        }
        const globalCap = await requestRegisterOtp(allowed, strict);
        expect([globalCap.status, errorCode(globalCap)]).toEqual([429, 'OTP_RATE_LIMITED']);
      } finally {
        await wipeQueue(strict.pool);
        await strict.close();
      }
    });

    it('a default application (flag off) has no gateway routes and no SMS_OTP recovery; DISABLED_TEST stays closed here', async () => {
      const off = await api(closed.running.baseUrl, 'POST', '/sms-gateway/heartbeat', { bearer: device.token, body: {} });
      expect(off.status).toBe(404);
      const user = await seedUser();
      const closedOtp = await requestResetOtp(user.phone.local, closed);
      expect(closedOtp.status).toBe(503);
      const config = await api(closed.running.baseUrl, 'GET', '/account-recovery/config');
      expect(config.body).toEqual({ data: { mode: 'UNAVAILABLE' } });

      // The SMS application: its mode is SMS_OTP and the no-OTP test reset is NOT reachable (no bypass of the OTP).
      const on = await api(app.running.baseUrl, 'GET', '/account-recovery/config');
      expect(on.body).toEqual({ data: { mode: 'SMS_OTP' } });
      const bypass = await api(app.running.baseUrl, 'POST', '/account-recovery/reset-test', {
        headers: { 'idempotency-key': randomUUID() },
        body: { phone: user.phone.local, password: NEW_PASSWORD },
      });
      expect(bypass.status).toBe(503);
      const row = await app.pool.query<{ password_hash: string }>('SELECT password_hash FROM app.users WHERE user_id = $1::uuid', [user.userId]);
      expect(await hasher.verify(row.rows[0]?.password_hash as string, PASSWORD)).toBe(true);
    });
  });

  describe('RESET_PASSWORD through the queue', () => {
    async function deliverReset(phoneLocal: string, prefix = '/account-recovery'): Promise<{ id: string; otp: string; text: string }> {
      const requested = await requestResetOtp(phoneLocal, app, prefix);
      expect(requested.status).toBe(200);
      const id = String(dataOf(requested).verification_id);
      const job = (await claim()) as NonNullable<Awaited<ReturnType<typeof claim>>>;
      expect(job).not.toBeNull();
      expect((await ack(job, 'SENT')).status).toBe(200);
      return { id, otp: otpOf(job.text), text: job.text };
    }

    it('resets a USER: OTP -> one-use proof -> new password; sessions die; no auto login; roles stay', async () => {
      const user = await seedUser();
      const loginWith = (password: string) =>
        api(app.running.baseUrl, 'POST', '/client-auth/login', {
          headers: { 'idempotency-key': randomUUID() },
          body: { phone: user.phone.local, password, device: { device_id: 'web-food-0001', platform: 'WEB', app: 'FOOD' } },
        });
      const before = await loginWith(PASSWORD);
      expect(before.status).toBe(200);
      const oldToken = String(dataOf(before).access_token);

      const { id, otp, text } = await deliverReset(user.phone.local);
      expect(text).toMatch(/^11Ship: Ma dat lai mat khau cua ban la [0-9]{6}\. Hieu luc 5 phut\. Khong chia se ma nay\.$/);
      expect((await jobOf(id))?.purpose).toBe('RESET_PASSWORD');

      // A REGISTER verify route does not accept a RESET challenge, and the other way round.
      expect(errorCode(await verifyRegister(id, otp))).toBe('OTP_INVALID');
      expect((await challenge(id))?.attempt_count).toBe(0);
      const verified = await verifyReset(id, otp);
      expect(verified.status).toBe(200);
      expect(dataOf(verified).purpose).toBe('RESET_PASSWORD');
      const proof = String(dataOf(verified).verification_token);

      // The reset proof is useless for registration.
      const asRegister = await api(app.running.baseUrl, 'POST', '/auth/register', {
        headers: { 'idempotency-key': randomUUID() },
        body: { phone: user.phone.local, password: NEW_PASSWORD, verification_token: proof, device: { device_id: 'dev-register-0002', platform: 'WEB', app: 'FOOD' } },
      });
      expect(asRegister.status).toBeGreaterThanOrEqual(400);

      const key = randomUUID();
      const done = await resetPassword(proof, NEW_PASSWORD, key);
      expect([done.status, done.body]).toEqual([200, { data: { next: 'LOGIN' } }]);
      expect(done.text).not.toContain(NEW_PASSWORD);
      // Nothing logged the user in.
      expect(done.body.data).not.toHaveProperty('access_token');

      const me = await api(app.running.baseUrl, 'GET', '/client-auth/me', { bearer: oldToken });
      expect(me.status).toBe(401);
      expect((await loginWith(PASSWORD)).status).toBe(401);
      expect((await loginWith(NEW_PASSWORD)).status).toBe(200);
      expect(await count(app.pool, `SELECT 1 FROM app.user_roles WHERE user_id = $1::uuid AND role = 'CUSTOMER'`, [user.userId])).toBe(1);

      // Exact replay answers the same; a different request with a consumed proof is refused; the old OTP is spent.
      const replay = await resetPassword(proof, NEW_PASSWORD, key);
      expect([replay.status, replay.body]).toEqual([200, { data: { next: 'LOGIN' } }]);
      const second = await resetPassword(proof, 'Another-Passw0rd-Entirely');
      expect([second.status, errorCode(second)]).toEqual([409, 'VERIFICATION_PROOF_USED']);
      expect(errorCode(await verifyReset(id, otp))).toBe('OTP_ALREADY_USED');
      expect((await loginWith('Another-Passw0rd-Entirely')).status).toBe(401);

      const audit = await app.pool.query<{ metadata: Record<string, unknown> }>(
        `SELECT metadata FROM app.audit_logs WHERE action = 'account.password.reset_otp.v1' AND resource_id = $1`,
        [user.userId],
      );
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0]?.metadata).toMatchObject({ target_kind: 'USER', verification: 'SMS_OTP' });
      const logged = JSON.stringify(audit.rows[0]) + app.running.logs.join('\n');
      for (const secret of [otp, proof, NEW_PASSWORD, user.phone.normalized, user.phone.local]) {
        expect(logged).not.toContain(secret);
      }
    });

    it('answers the same for a registered number, an unknown number and SYSTEM, queues nothing for the last two and keeps one cooldown', async () => {
      const known = await seedUser();
      const unknown = randomPhone();
      app.track(unknown.normalized);
      const system = await createSystem(app);

      const answers: ApiResponse[] = [];
      for (const phone of [known.phone.local, unknown.local, system.phone.local]) {
        answers.push(await requestResetOtp(phone));
      }
      const shapes = answers.map((response) => [response.status, Object.keys(dataOf(response)).sort(), dataOf(response).expires_in_seconds, dataOf(response).resend_after_seconds, dataOf(response).delivery_status]);
      expect(shapes[1]).toEqual(shapes[0]);
      expect(shapes[2]).toEqual(shapes[0]);
      expect(await count(app.pool, 'SELECT 1 FROM app.sms_jobs WHERE phone_normalized = $1', [known.phone.normalized])).toBe(1);
      expect(await count(app.pool, 'SELECT 1 FROM app.sms_jobs WHERE phone_normalized = ANY($1::text[])', [[unknown.normalized, system.phone.normalized]])).toBe(0);
      const job = (await claim()) as NonNullable<Awaited<ReturnType<typeof claim>>>;
      expect(job.to).toBe(known.phone.normalized);
      await ack(job, 'SENT');

      // Same cooldown answer for every number, and a phone that was never sent anything can never be verified.
      for (const phone of [known.phone.local, unknown.local, system.phone.local]) {
        const again = await requestResetOtp(phone);
        expect([again.status, errorCode(again)]).toEqual([429, 'OTP_RATE_LIMITED']);
      }
      const unknownChallenge = String(dataOf(answers[1] as ApiResponse).verification_id);
      for (let i = 0; i < 6; i += 1) {
        const guess = await verifyReset(unknownChallenge, String(100000 + i));
        expect([guess.status, errorCode(guess)]).toEqual([400, 'OTP_INVALID']);
      }
      expect((await challenge(unknownChallenge))?.attempt_count).toBe(0);
    });

    it('never resets SYSTEM, even with a perfectly valid RESET_PASSWORD proof for its number', async () => {
      const system = await createSystem(app);
      const before = await app.pool.query('SELECT password_hash, version FROM app.users WHERE user_id = $1::uuid', [system.userId]);
      // Manufacture the strongest possible attack: a verified challenge and an unexpired proof row for the SYSTEM phone.
      const verificationId = randomUUID();
      const proofToken = 'S'.repeat(43);
      await app.pool.query(
        `INSERT INTO app.phone_verifications (verification_id, phone_normalized, purpose, otp_digest, status, attempt_count, expires_at, resend_not_before, verified_at, created_at)
         VALUES ($1::uuid, $2, 'RESET_PASSWORD', $3, 'VERIFIED', 0, now() + interval '5 minutes', now(), now(), now() - interval '1 second')`,
        [verificationId, system.phone.normalized, 'a'.repeat(64)],
      );
      await app.pool.query(
        `INSERT INTO app.verification_proofs (proof_id, verification_id, phone_normalized, purpose, token_digest, expires_at, created_at)
         VALUES ($1::uuid, $2::uuid, $3, 'RESET_PASSWORD', $4, now() + interval '5 minutes', now() - interval '1 second')`,
        [randomUUID(), verificationId, system.phone.normalized, digestToken(proofToken)],
      );
      const attempt = await resetPassword(proofToken);
      expect([attempt.status, errorCode(attempt)]).toEqual([400, 'VERIFICATION_PROOF_INVALID']);
      const after = await app.pool.query('SELECT password_hash, version FROM app.users WHERE user_id = $1::uuid', [system.userId]);
      expect(after.rows).toEqual(before.rows);
    });

    it('refuses a REGISTER proof, an expired proof and a malformed body for the reset, and writes nothing', async () => {
      const user = await seedUser();
      const phone = user.phone;
      const id = String(dataOf(await requestRegisterOtp(randomPhone())).verification_id);
      const job = (await claim()) as NonNullable<Awaited<ReturnType<typeof claim>>>;
      await ack(job, 'SENT');
      const registerProof = String(dataOf(await verifyRegister(id, otpOf(job.text))).verification_token);
      const mismatch = await resetPassword(registerProof);
      expect([mismatch.status, errorCode(mismatch)]).toEqual([400, 'VERIFICATION_PURPOSE_MISMATCH']);

      const { id: resetId, otp } = await deliverReset(phone.local);
      const proof = String(dataOf(await verifyReset(resetId, otp)).verification_token);
      await app.pool.query(`UPDATE app.verification_proofs SET expires_at = created_at + interval '1 millisecond' WHERE verification_id = $1::uuid`, [resetId]);
      const expired = await resetPassword(proof);
      expect([expired.status, errorCode(expired)]).toEqual([400, 'VERIFICATION_PROOF_INVALID']);

      for (const body of [
        { verification_token: proof },
        { password: NEW_PASSWORD },
        { verification_token: proof, password: NEW_PASSWORD, phone: phone.local },
        { verification_token: proof, password: 'short' },
        { verification_token: 'not-a-token', password: NEW_PASSWORD },
      ]) {
        const response = await api(app.running.baseUrl, 'POST', '/account-recovery/reset', { headers: { 'idempotency-key': randomUUID() }, body });
        expect(response.status).toBe(400);
        expect(response.text).not.toContain(NEW_PASSWORD);
      }
      const hash = await app.pool.query<{ password_hash: string }>('SELECT password_hash FROM app.users WHERE user_id = $1::uuid', [user.userId]);
      expect(await hasher.verify(hash.rows[0]?.password_hash as string, PASSWORD)).toBe(true);
    });

    it('resets an ADMIN with the same flow: the admin session is revoked and the account is not signed in again', async () => {
      const admin = await createAdminMember(app);
      const login = await enrollAndLogin(app, admin);
      expect((await app.call('GET', '/me', { cookies: sessionCookies(login) })).status).toBe(200);
      const factorBefore = await app.pool.query('SELECT factor_id, state FROM app.admin_totp_factors WHERE user_id = $1::uuid', [admin.userId]);

      const { id, otp } = await deliverReset(admin.phone.local, '/admin-recovery');
      const proof = String(dataOf(await verifyReset(id, otp, '/admin-recovery')).verification_token);
      expect((await resetPassword(proof, NEW_PASSWORD, randomUUID(), '/admin-recovery')).status).toBe(200);

      expect((await app.call('GET', '/me', { cookies: sessionCookies(login) })).status).toBe(401);
      expect(await count(app.pool, 'SELECT 1 FROM app.admin_sessions WHERE user_id = $1::uuid AND revoked_at IS NULL', [admin.userId])).toBe(0);
      expect((await app.call('POST', '/login', { body: loginBody(admin) })).status).toBe(401);
      const fresh = await app.call('POST', '/login', { body: loginBody(admin, { password: NEW_PASSWORD }) });
      expect(fresh.status).toBe(200);
      // The TOTP is still required and unchanged: the password alone never gives a session.
      expect(String(fresh.body.data?.next_step)).toBe('VERIFY_TOTP');
      expect((await app.pool.query('SELECT factor_id, state FROM app.admin_totp_factors WHERE user_id = $1::uuid', [admin.userId])).rows).toEqual(factorBefore.rows);
      const audit = await app.pool.query<{ metadata: Record<string, unknown> }>(
        `SELECT metadata FROM app.audit_logs WHERE action = 'account.password.reset_otp.v1' AND resource_id = $1`,
        [admin.userId],
      );
      expect(audit.rows[0]?.metadata).toMatchObject({ target_kind: 'ADMIN', admin_credentials_revoked: true, verification: 'SMS_OTP' });
    });

    it('stays generic when the gateway is down: the same 503 for every number, and no challenge', async () => {
      const known = await seedUser();
      const unknown = randomPhone();
      app.track(unknown.normalized);
      expect((await ctl('disable')).code).toBe(0);
      try {
        const a = await requestResetOtp(known.phone.local);
        const b = await requestResetOtp(unknown.local);
        expect([a.status, b.status]).toEqual([503, 503]);
        expect(errorCode(a)).toBe(errorCode(b));
        expect(a.body.error?.message).toBe(b.body.error?.message);
        expect(await count(app.pool, 'SELECT 1 FROM app.phone_verifications WHERE phone_normalized = ANY($1::text[])', [[known.phone.normalized, unknown.normalized]])).toBe(0);
      } finally {
        expect((await ctl('enable')).code).toBe(0);
      }
    });
  });
});
