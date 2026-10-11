import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import {
  ageVerification,
  countRows,
  dataOf,
  errorCode,
  PASSWORD,
  randomPhone,
  registerBody,
} from './support/auth-fixtures';
import { containsCode, InboxAuthApp, readOtp, startInboxAuthApp } from './support/test-sms-fixtures';

// M01.22 (TS01, TS03, TS04, TS05-privacy) — REGISTER through the REAL Nest pipeline and REAL PostgreSQL with the OTP
// delivered into the TEST_INBOX and read back through the real private listener, as the PC tool reads it. The OTP core
// (digest, TTL, cooldown, attempts, one-use proof) must behave exactly as with the in-memory fake.
describe('M01.22 — REGISTER OTP through the test inbox', () => {
  let app: InboxAuthApp;

  beforeAll(async () => {
    app = await startInboxAuthApp();
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  interface VerificationRow {
    verification_id: string;
    status: string;
    attempt_count: number;
    expires_at: Date;
  }

  async function rowsOf(normalized: string): Promise<VerificationRow[]> {
    const result = await app.pool.query<VerificationRow>(
      `SELECT verification_id, status, attempt_count, expires_at
         FROM app.phone_verifications WHERE phone_normalized = $1 ORDER BY created_at, verification_id`,
      [normalized],
    );
    return result.rows;
  }

  function requestOtp(phone: { local: string; normalized: string }) {
    app.track(phone.normalized);
    return app.call('POST', '/auth/phone-verifications', { body: { phone: phone.local, purpose: 'REGISTER' } });
  }

  function verify(id: string, otp: string) {
    return app.call('POST', `/auth/phone-verifications/${id}/verify`, { body: { otp } });
  }

  it('TS01: request -> code only in the inbox -> verify -> proof -> register works end to end', async () => {
    const phone = randomPhone();
    const requested = await requestOtp(phone);
    expect(requested.status).toBe(201);
    const id = String(dataOf(requested).verification_id);
    expect(Object.keys(dataOf(requested)).sort()).toEqual(['expires_in_seconds', 'resend_after_seconds', 'verification_id']);

    const otp = await readOtp(app.harness, 'REGISTER', phone.normalized);
    expect(otp).toMatch(/^[0-9]{6}$/);
    // The product API never carries the code, not even in the request that caused it.
    expect(containsCode(requested.text, otp)).toBe(false);
    expect(requested.text).not.toContain('otp');

    const verified = await verify(id, otp);
    expect(verified.status).toBe(200);
    expect(containsCode(verified.text, otp)).toBe(false);
    const proofToken = String(dataOf(verified).verification_token);

    const registered = await app.call('POST', '/auth/register', {
      headers: { 'idempotency-key': randomUUID() },
      body: registerBody(phone as never, proofToken),
    });
    expect(registered.status).toBe(201);
    expect(await countRows(app.pool, 'SELECT 1 FROM app.users WHERE phone_normalized = $1', [phone.normalized])).toBe(1);
    expect((await rowsOf(phone.normalized)).map((row) => row.status)).toEqual(['VERIFIED']);
  });

  it('TS01: the inbox list never carries a code or the full phone; only the detail does', async () => {
    const phone = randomPhone();
    await requestOtp(phone);
    const list = await app.harness.client.list({ phone: phone.normalized });
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(phone.normalized);
    expect(list[0]?.purpose).toBe('REGISTER');
  });

  it('TS03: a wrong code is counted, five lock the challenge and then even the right code is refused', async () => {
    const phone = randomPhone();
    const id = String(dataOf(await requestOtp(phone)).verification_id);
    const otp = await readOtp(app.harness, 'REGISTER', phone.normalized);
    const wrong = otp === '000000' ? '111111' : '000000';
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const response = await verify(id, wrong);
      expect([response.status, errorCode(response)]).toEqual([400, 'OTP_INVALID']);
      expect((await rowsOf(phone.normalized))[0]?.attempt_count).toBe(attempt);
    }
    const fifth = await verify(id, wrong);
    expect([fifth.status, errorCode(fifth)]).toEqual([429, 'OTP_RATE_LIMITED']);
    const right = await verify(id, otp);
    expect([right.status, errorCode(right)]).toEqual([429, 'OTP_RATE_LIMITED']);
    expect((await rowsOf(phone.normalized))[0]?.status).toBe('LOCKED');
  });

  it('TS03: an expired code (the inbox still shows it) is OTP_EXPIRED and creates no proof', async () => {
    const phone = randomPhone();
    const id = String(dataOf(await requestOtp(phone)).verification_id);
    const otp = await readOtp(app.harness, 'REGISTER', phone.normalized);
    await ageVerification(app.pool, id, 301);
    const response = await verify(id, otp);
    expect([response.status, errorCode(response)]).toEqual([400, 'OTP_EXPIRED']);
    expect(await countRows(app.pool, 'SELECT 1 FROM app.verification_proofs WHERE verification_id = $1::uuid', [id])).toBe(0);
  });

  it('TS03: reading the inbox does not extend the TTL nor reset attempts or cooldown', async () => {
    const phone = randomPhone();
    const id = String(dataOf(await requestOtp(phone)).verification_id);
    const before = (await rowsOf(phone.normalized))[0] as VerificationRow;
    for (let read = 0; read < 3; read += 1) {
      await readOtp(app.harness, 'REGISTER', phone.normalized);
    }
    const after = (await rowsOf(phone.normalized))[0] as VerificationRow;
    expect(after.expires_at.getTime()).toBe(before.expires_at.getTime());
    expect(after.attempt_count).toBe(0);
    const blocked = await requestOtp(phone);
    expect([blocked.status, errorCode(blocked)]).toEqual([429, 'OTP_RATE_LIMITED']);
    expect(id).toBe(before.verification_id);
  });

  it('TS03: resend inside the cooldown is refused and delivers nothing; after it the new code works and the old one is superseded', async () => {
    const phone = randomPhone();
    const firstId = String(dataOf(await requestOtp(phone)).verification_id);
    const firstOtp = await readOtp(app.harness, 'REGISTER', phone.normalized);
    const before = app.harness.inbox.size();

    const blocked = await requestOtp(phone);
    expect([blocked.status, errorCode(blocked)]).toEqual([429, 'OTP_RATE_LIMITED']);
    expect(app.harness.inbox.size()).toBe(before); // a refused request wrote nothing into the inbox either

    await ageVerification(app.pool, firstId, 61);
    const second = await requestOtp(phone);
    expect(second.status).toBe(201);
    const secondId = String(dataOf(second).verification_id);
    const secondOtp = await readOtp(app.harness, 'REGISTER', phone.normalized);
    expect(app.harness.inbox.size()).toBe(before + 1);

    const stale = await verify(firstId, firstOtp);
    expect([stale.status, errorCode(stale)]).toEqual([409, 'OTP_ALREADY_USED']);
    expect((await verify(secondId, secondOtp)).status).toBe(200);
  });

  it('TS03: the proof is single-use: a second register with the same proof is refused and no second user appears', async () => {
    const phone = randomPhone();
    const id = String(dataOf(await requestOtp(phone)).verification_id);
    const verified = await verify(id, await readOtp(app.harness, 'REGISTER', phone.normalized));
    const proofToken = String(dataOf(verified).verification_token);
    const first = await app.call('POST', '/auth/register', { headers: { 'idempotency-key': randomUUID() }, body: registerBody(phone as never, proofToken) });
    expect(first.status).toBe(201);
    const second = await app.call('POST', '/auth/register', {
      headers: { 'idempotency-key': randomUUID() },
      body: registerBody(phone as never, proofToken, { password: `${PASSWORD}-2` }),
    });
    expect(second.status).toBeGreaterThanOrEqual(400);
    expect(await countRows(app.pool, 'SELECT 1 FROM app.users WHERE phone_normalized = $1', [phone.normalized])).toBe(1);
  });

  it('TS04: an inbox that rejects/throws is a sanitized 503, DELIVERY_FAILED, never verifiable, and an immediate retry works', async () => {
    const phone = randomPhone();
    app.provider.script('REJECT');
    const failed = await requestOtp(phone);
    expect([failed.status, errorCode(failed)]).toEqual([503, 'SERVICE_UNAVAILABLE']);
    expect(failed.text).not.toContain('scripted');
    const rows = await rowsOf(phone.normalized);
    expect(rows.map((row) => row.status)).toEqual(['DELIVERY_FAILED']);
    expect(app.harness.inbox.list({ limit: 20 }).filter((m) => m.phoneNormalized === phone.normalized)).toHaveLength(0);

    const retry = await requestOtp(phone);
    expect(retry.status).toBe(201);
    expect((await rowsOf(phone.normalized)).map((row) => row.status)).toEqual(['DELIVERY_FAILED', 'PENDING']);
  });

  it('TS04: a response lost AFTER the message reached the inbox still fails the request; that stray code verifies nothing', async () => {
    const phone = randomPhone();
    app.provider.script('LOST_RESPONSE');
    const failed = await requestOtp(phone);
    expect([failed.status, errorCode(failed)]).toEqual([503, 'SERVICE_UNAVAILABLE']);
    const [row] = await rowsOf(phone.normalized);
    expect(row?.status).toBe('DELIVERY_FAILED');
    const stray = await readOtp(app.harness, 'REGISTER', phone.normalized);
    const attempt = await verify(String(row?.verification_id), stray);
    expect([attempt.status, errorCode(attempt)]).toEqual([400, 'OTP_INVALID']);
    expect(await countRows(app.pool, 'SELECT 1 FROM app.verification_proofs WHERE verification_id = $1::uuid', [String(row?.verification_id)])).toBe(0);
  });

  it('TS04: a provider that never answers is cut by the timeout into a sanitized 503 (no hang)', async () => {
    const phone = randomPhone();
    app.provider.script('HANG');
    const failed = await requestOtp(phone);
    app.provider.releaseHang();
    expect([failed.status, errorCode(failed)]).toEqual([503, 'SERVICE_UNAVAILABLE']);
    expect((await rowsOf(phone.normalized)).map((row) => row.status)).toEqual(['DELIVERY_FAILED']);
  }, 30_000);

  it('TS05: no code reaches the database, the audit log, the outbox, the application log or any API answer', async () => {
    const phone = randomPhone();
    const requested = await requestOtp(phone);
    const id = String(dataOf(requested).verification_id);
    const otp = await readOtp(app.harness, 'REGISTER', phone.normalized);
    const verified = await verify(id, otp);
    const proofToken = String(dataOf(verified).verification_token);
    const registered = await app.call('POST', '/auth/register', {
      headers: { 'idempotency-key': randomUUID() },
      body: registerBody(phone as never, proofToken),
    });
    const userId = String(dataOf(registered).user_id);

    const tables = await app.pool.query<{ dump: string }>(
      `SELECT t::text AS dump FROM app.phone_verifications t WHERE phone_normalized = $1
       UNION ALL SELECT t::text FROM app.verification_proofs t WHERE phone_normalized = $1
       UNION ALL SELECT t::text FROM app.audit_logs t WHERE request_id = ANY($2::uuid[])
       UNION ALL SELECT t::text FROM app.outbox_events t WHERE resource_id = $3`,
      [phone.normalized, [requested.requestId, verified.requestId, registered.requestId], userId],
    );
    for (const row of tables.rows) {
      expect(containsCode(row.dump, otp)).toBe(false);
    }
    for (const text of [requested.text, verified.text, registered.text, ...app.running.logs]) {
      expect(containsCode(text, otp)).toBe(false);
    }
  });
});
