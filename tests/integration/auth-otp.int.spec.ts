import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { computeOtpDigest } from '../../apps/backend/src/auth/otp';
import { otpRequestLockKey } from '../../apps/backend/src/auth/otp-lane-lock';
import { eventually } from './support/async-helpers';
import {
  ageVerification,
  AuthApp,
  authTestConfig,
  countRows,
  dataOf,
  errorCode,
  obtainProof,
  randomPhone,
  registerUser,
  startAuthApp,
} from './support/auth-fixtures';

// M01-A1 — phone verification (OTP request and verify) on a REAL PostgreSQL through the REAL Nest pipeline.
describe('M01-A1 — OTP request and verification', () => {
  let app: AuthApp;

  beforeAll(async () => {
    app = await startAuthApp();
  });

  afterAll(async () => {
    await app.close();
  });

  interface VerificationRow {
    verification_id: string;
    status: string;
    attempt_count: number;
    otp_digest: string;
    phone_normalized: string;
    purpose: string;
  }

  async function rowsOf(normalized: string): Promise<VerificationRow[]> {
    const result = await app.pool.query<VerificationRow>(
      `SELECT verification_id, status, attempt_count, otp_digest, phone_normalized, purpose
         FROM app.phone_verifications WHERE phone_normalized = $1 ORDER BY created_at, verification_id`,
      [normalized],
    );
    return result.rows;
  }

  async function requestOtp(local: string, normalized: string) {
    app.track(normalized);
    return app.call('POST', '/auth/phone-verifications', { body: { phone: local, purpose: 'REGISTER' } });
  }

  it('creates a PENDING verification with an HMAC digest, delivers the OTP and never stores it', async () => {
    const phone = randomPhone();
    const response = await requestOtp(phone.local, phone.normalized);

    expect(response.status).toBe(201);
    const data = dataOf(response);
    expect(Object.keys(data).sort()).toEqual(['expires_in_seconds', 'resend_after_seconds', 'verification_id']);
    expect(data.expires_in_seconds).toBe(300);
    expect(data.resend_after_seconds).toBe(60);

    const rows = await rowsOf(phone.normalized);
    expect(rows).toHaveLength(1);
    const row = rows[0] as VerificationRow;
    expect(row.verification_id).toBe(data.verification_id);
    expect(row.status).toBe('PENDING');
    expect(row.purpose).toBe('REGISTER');
    expect(row.attempt_count).toBe(0);

    const otp = app.provider.lastOtpFor(phone.normalized) as string;
    expect(otp).toMatch(/^[0-9]{6}$/);
    // The digest is the locked HMAC over the canonical JSON array, bound to the verification id.
    expect(row.otp_digest).toBe(
      computeOtpDigest(app.config.auth!.otpHmacKey, row.verification_id, phone.normalized, 'REGISTER', otp),
    );
    const dump = await app.pool.query<{ dump: string }>(
      'SELECT t::text AS dump FROM app.phone_verifications t WHERE phone_normalized = $1',
      [phone.normalized],
    );
    expect(dump.rows.map((r) => r.dump).join('\n')).not.toContain(otp);
    // Neither the OTP nor the phone number reaches the application log.
    const logs = app.running.logs.join('\n');
    expect(logs).not.toContain(otp);
    expect(logs).not.toContain(phone.local);
  });

  it('accepts the three phone forms and treats them as ONE lane (cooldown applies across forms)', async () => {
    const phone = randomPhone();
    expect((await requestOtp(phone.local, phone.normalized)).status).toBe(201);
    const second = await requestOtp(phone.international, phone.normalized);
    expect(second.status).toBe(429);
    expect(errorCode(second)).toBe('OTP_RATE_LIMITED');
    const third = await requestOtp(`+${phone.international}`, phone.normalized);
    expect(third.status).toBe(429);
    expect(await rowsOf(phone.normalized)).toHaveLength(1);
  });

  it('refuses a malformed phone with INVALID_PHONE and a malformed body with a plain 400', async () => {
    for (const phone of ['', '12345', '0123456789012', '09abc4321', '０９８７６５４３２１', '+85987654321', '098 765 4321']) {
      const response = await app.call('POST', '/auth/phone-verifications', { body: { phone, purpose: 'REGISTER' } });
      expect([phone, response.status, errorCode(response)]).toEqual([phone, 400, 'INVALID_PHONE']);
    }
    const bodies: unknown[] = [
      { phone: '0987654321' },
      { phone: '0987654321', purpose: 'LOGIN' },
      { phone: '0987654321', purpose: 'REGISTER', role: 'ADMIN' },
      [],
      'text',
    ];
    for (const body of bodies) {
      const response = await app.call('POST', '/auth/phone-verifications', { body });
      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('BAD_REQUEST');
    }
    const malformed = await app.call('POST', '/auth/phone-verifications', { rawBody: '{"phone":' });
    expect(malformed.status).toBe(400);
  });

  it('enforces the 60 s cooldown per phone+purpose, then supersedes the older challenge', async () => {
    const phone = randomPhone();
    const first = await requestOtp(phone.local, phone.normalized);
    expect(first.status).toBe(201);
    const firstOtp = app.provider.lastOtpFor(phone.normalized) as string;
    const firstId = String(dataOf(first).verification_id);

    const blocked = await requestOtp(phone.local, phone.normalized);
    expect(blocked.status).toBe(429);
    expect(errorCode(blocked)).toBe('OTP_RATE_LIMITED');
    expect(await rowsOf(phone.normalized)).toHaveLength(1); // the refused request wrote nothing

    await ageVerification(app.pool, firstId, 61);
    const second = await requestOtp(phone.local, phone.normalized);
    expect(second.status).toBe(201);

    const rows = await rowsOf(phone.normalized);
    expect(rows.map((r) => r.status)).toEqual(['INVALIDATED', 'PENDING']);
    // The superseded challenge can no longer be verified, even with its own correct OTP.
    const stale = await app.call('POST', `/auth/phone-verifications/${firstId}/verify`, { body: { otp: firstOtp } });
    expect(stale.status).toBe(409);
    expect(errorCode(stale)).toBe('OTP_ALREADY_USED');
  });

  it('serializes concurrent requests of one lane: exactly one succeeds, the rest are rate limited', async () => {
    const phone = randomPhone();
    app.track(phone.normalized);
    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        app.call('POST', '/auth/phone-verifications', { body: { phone: phone.local, purpose: 'REGISTER' } }),
      ),
    );
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 429)).toHaveLength(3);
    const rows = await rowsOf(phone.normalized);
    expect(rows).toHaveLength(1);
    expect((rows[0] as VerificationRow).status).toBe('PENDING');
    expect(app.provider.sentCount()).toBeGreaterThanOrEqual(1);
  });

  it('verifies a correct OTP once: VERIFIED, one proof stored only as a SHA-256 digest', async () => {
    const phone = randomPhone();
    const { verificationId, proofToken } = await obtainProof(app, phone);

    expect(proofToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const verification = (await rowsOf(phone.normalized))[0] as VerificationRow;
    expect(verification.status).toBe('VERIFIED');

    const proofs = await app.pool.query<{ token_digest: string; purpose: string; phone_normalized: string }>(
      'SELECT token_digest, purpose, phone_normalized FROM app.verification_proofs WHERE verification_id = $1::uuid',
      [verificationId],
    );
    expect(proofs.rows).toEqual([
      {
        token_digest: createHash('sha256').update(proofToken, 'utf8').digest('hex'),
        purpose: 'REGISTER',
        phone_normalized: phone.normalized,
      },
    ]);
    const dump = await app.pool.query<{ dump: string }>(
      'SELECT t::text AS dump FROM app.verification_proofs t WHERE verification_id = $1::uuid',
      [verificationId],
    );
    expect(dump.rows.map((r) => r.dump).join('\n')).not.toContain(proofToken);

    // Single use: verifying again answers OTP_ALREADY_USED and creates no second proof.
    const otp = app.provider.lastOtpFor(phone.normalized) as string;
    const again = await app.call('POST', `/auth/phone-verifications/${verificationId}/verify`, { body: { otp } });
    expect(again.status).toBe(409);
    expect(errorCode(again)).toBe('OTP_ALREADY_USED');
    expect(await countRows(app.pool, 'SELECT 1 FROM app.verification_proofs WHERE verification_id = $1::uuid', [verificationId])).toBe(1);
  });

  it('response of a successful verify has exactly the contract fields', async () => {
    const phone = randomPhone();
    app.track(phone.normalized);
    const requested = await requestOtp(phone.local, phone.normalized);
    const id = String(dataOf(requested).verification_id);
    const otp = app.provider.lastOtpFor(phone.normalized) as string;
    const verified = await app.call('POST', `/auth/phone-verifications/${id}/verify`, { body: { otp } });
    expect(verified.status).toBe(200);
    const data = dataOf(verified);
    expect(Object.keys(data).sort()).toEqual(['expires_in_seconds', 'purpose', 'verification_token']);
    expect(data.purpose).toBe('REGISTER');
    expect(data.expires_in_seconds).toBe(600);
  });

  it('counts wrong attempts (committed), locks at the maximum and refuses even the right OTP afterwards', async () => {
    const phone = randomPhone();
    const requested = await requestOtp(phone.local, phone.normalized);
    const id = String(dataOf(requested).verification_id);
    const otp = app.provider.lastOtpFor(phone.normalized) as string;
    const wrong = otp === '000000' ? '111111' : '000000';

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const response = await app.call('POST', `/auth/phone-verifications/${id}/verify`, { body: { otp: wrong } });
      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe('OTP_INVALID');
      const row = (await rowsOf(phone.normalized))[0] as VerificationRow;
      expect([row.attempt_count, row.status]).toEqual([attempt, 'PENDING']); // the wrong attempt COMMITTED
    }
    const third = await app.call('POST', `/auth/phone-verifications/${id}/verify`, { body: { otp: wrong } });
    expect(third.status).toBe(429);
    expect(errorCode(third)).toBe('OTP_RATE_LIMITED');
    expect(((await rowsOf(phone.normalized))[0] as VerificationRow).status).toBe('LOCKED');

    const right = await app.call('POST', `/auth/phone-verifications/${id}/verify`, { body: { otp } });
    expect(right.status).toBe(429);
    expect(errorCode(right)).toBe('OTP_RATE_LIMITED');
    expect(await countRows(app.pool, 'SELECT 1 FROM app.verification_proofs WHERE verification_id = $1::uuid', [id])).toBe(0);

    // The locked attempt is recorded as a standalone DENIED audit row (best effort, after the fact).
    const audit = await app.pool.query<{ outcome: string; reason_code: string }>(
      `SELECT outcome, reason_code FROM app.audit_logs WHERE request_id = $1::uuid AND action = 'auth.otp_verify.v1'`,
      [third.requestId],
    );
    expect(audit.rows).toEqual([{ outcome: 'DENIED', reason_code: 'OTP_LOCKED' }]);
  });

  it('honours AUTH_OTP_MAX_ATTEMPTS from configuration', async () => {
    const strict = await startAuthApp({ otpMaxAttempts: 1 });
    try {
      const phone = randomPhone();
      strict.track(phone.normalized);
      const requested = await strict.call('POST', '/auth/phone-verifications', {
        body: { phone: phone.local, purpose: 'REGISTER' },
      });
      const id = String(dataOf(requested).verification_id);
      const otp = strict.provider.lastOtpFor(phone.normalized) as string;
      const wrong = otp === '000000' ? '111111' : '000000';
      const response = await strict.call('POST', `/auth/phone-verifications/${id}/verify`, { body: { otp: wrong } });
      expect([response.status, errorCode(response)]).toEqual([429, 'OTP_RATE_LIMITED']);
    } finally {
      await strict.close();
    }
  });

  it('refuses an expired OTP with OTP_EXPIRED and creates no proof', async () => {
    const phone = randomPhone();
    const requested = await requestOtp(phone.local, phone.normalized);
    const id = String(dataOf(requested).verification_id);
    const otp = app.provider.lastOtpFor(phone.normalized) as string;
    await ageVerification(app.pool, id, 301);

    const response = await app.call('POST', `/auth/phone-verifications/${id}/verify`, { body: { otp } });
    expect(response.status).toBe(400);
    expect(errorCode(response)).toBe('OTP_EXPIRED');
    expect(await countRows(app.pool, 'SELECT 1 FROM app.verification_proofs WHERE verification_id = $1::uuid', [id])).toBe(0);
  });

  it('treats an unknown or malformed verification id as OTP_INVALID and a malformed OTP as a plain 400 (no attempt counted)', async () => {
    const unknown = await app.call('POST', '/auth/phone-verifications/00000000-0000-4000-8000-000000000000/verify', {
      body: { otp: '123456' },
    });
    expect([unknown.status, errorCode(unknown)]).toEqual([400, 'OTP_INVALID']);
    const notUuid = await app.call('POST', '/auth/phone-verifications/not-a-uuid/verify', { body: { otp: '123456' } });
    expect([notUuid.status, errorCode(notUuid)]).toEqual([400, 'OTP_INVALID']);

    const phone = randomPhone();
    const requested = await requestOtp(phone.local, phone.normalized);
    const id = String(dataOf(requested).verification_id);
    for (const otp of ['12345', '1234567', 'abcdef', '12 456', 123456, null]) {
      const response = await app.call('POST', `/auth/phone-verifications/${id}/verify`, { body: { otp } });
      expect([response.status, errorCode(response)]).toEqual([400, 'BAD_REQUEST']);
    }
    expect(((await rowsOf(phone.normalized))[0] as VerificationRow).attempt_count).toBe(0);
  });

  it('delivery failure: sanitized 503, DELIVERY_FAILED, never verifiable, and an immediate retry works', async () => {
    const phone = randomPhone();
    app.provider.failNext(1);
    const failed = await requestOtp(phone.local, phone.normalized);
    expect(failed.status).toBe(503);
    expect(errorCode(failed)).toBe('SERVICE_UNAVAILABLE');
    expect(failed.text).not.toContain('fake provider failure');

    const rows = await rowsOf(phone.normalized);
    expect(rows.map((r) => r.status)).toEqual(['DELIVERY_FAILED']);
    const failedId = (rows[0] as VerificationRow).verification_id;
    const unusable = await app.call('POST', `/auth/phone-verifications/${failedId}/verify`, { body: { otp: '123456' } });
    expect([unusable.status, errorCode(unusable)]).toEqual([400, 'OTP_INVALID']);

    // No cooldown is held by the failed delivery: the retry is accepted at once.
    const retry = await requestOtp(phone.local, phone.normalized);
    expect(retry.status).toBe(201);
    expect((await rowsOf(phone.normalized)).map((r) => r.status)).toEqual(['DELIVERY_FAILED', 'PENDING']);
  });

  it('calls the provider OUTSIDE any transaction: the lane lock is free and the row is already committed', async () => {
    const phone = randomPhone();
    app.track(phone.normalized);
    const release = app.provider.holdSends();
    const started = app.provider.sendStarted();
    const pending = app.call('POST', '/auth/phone-verifications', { body: { phone: phone.local, purpose: 'REGISTER' } });
    try {
      await eventually(async () => app.provider.sendStarted() > started, 'provider call is in flight');

      const [first, second] = otpRequestLockKey(phone.normalized, 'REGISTER');
      const client = await app.pool.connect();
      try {
        await client.query('BEGIN');
        const lock = await client.query<{ got: boolean }>('SELECT pg_try_advisory_xact_lock($1::int, $2::int) AS got', [
          first,
          second,
        ]);
        expect(lock.rows[0]?.got).toBe(true); // no transaction of the request still holds the lane
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
      // The PENDING_DELIVERY row is committed and visible to another connection, but not yet verifiable.
      expect((await rowsOf(phone.normalized)).map((r) => r.status)).toEqual(['PENDING_DELIVERY']);
    } finally {
      release();
    }
    const response = await pending;
    expect(response.status).toBe(201);
    expect((await rowsOf(phone.normalized)).map((r) => r.status)).toEqual(['PENDING']);
  });

  it('refuses an OTP request for a phone that already has an account', async () => {
    const user = await registerUser(app);
    const response = await requestOtp(user.phone.local, user.phone.normalized);
    expect(response.status).toBe(409);
    expect(errorCode(response)).toBe('PHONE_ALREADY_REGISTERED');
  });

  it('uses configurable TTL and resend values in the response', async () => {
    const custom = await startAuthApp(authTestConfig({ otpTtlSeconds: 120, otpResendSeconds: 30 }));
    try {
      const phone = randomPhone();
      custom.track(phone.normalized);
      const response = await custom.call('POST', '/auth/phone-verifications', {
        body: { phone: phone.local, purpose: 'REGISTER' },
      });
      expect(dataOf(response).expires_in_seconds).toBe(120);
      expect(dataOf(response).resend_after_seconds).toBe(30);
    } finally {
      await custom.close();
    }
  });
});
