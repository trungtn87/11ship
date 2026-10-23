import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { eventually } from './support/async-helpers';
import {
  advisoryWaiterExists,
  ageProof,
  ageVerification,
  api,
  ApiResponse,
  AuthApp,
  countRows,
  dataOf,
  errorCode,
  expireSession,
  grantRole,
  installFault,
  installRegisterAuditStall,
  obtainProof,
  PASSWORD,
  Phone,
  proofIdOfToken,
  randomPhone,
  removeFault,
  removeRegisterAuditStall,
  sessionIdOfToken,
  setUserStatus,
  startAuthApp,
  transactionWaiters,
  registerUser,
} from './support/auth-fixtures';
import { LockHolder } from './support/idempotency-fixtures';
import { containsCode, readOtp, startInboxAuthApp, InboxAuthApp } from './support/test-sms-fixtures';

// M01.03 — POST /v1/client-auth/register on the REAL Nest pipeline and a REAL PostgreSQL (TEST database only): CUSTOMER
// provisioning, strict input, device gate, consent, idempotency/replay, concurrency, rollback, namespace separation from the
// legacy route, and the TEST_INBOX (M01.22) path. Table of cases: docs/tasks/M01-03-customer-register-local-handoff.md section 6.

const TERMS = 'test-terms-20261011-v1';
const PRIVACY = 'test-privacy-20261011-v1';
const CONSENT = { terms_version: TERMS, privacy_version: PRIVACY };
const WEB_FOOD = { device_id: 'web-device-0001', platform: 'WEB', app: 'FOOD' };
const WEB_SHIP = { device_id: 'web-device-0002', platform: 'WEB', app: 'SHIP' };
const ANDROID_FOOD = { device_id: 'android-device-0001', platform: 'ANDROID', app: 'FOOD' };
const STALL_KEY: readonly [number, number] = [20261011, 3];

function body(phone: Phone, proofToken: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    phone: phone.local,
    password: PASSWORD,
    verification_token: proofToken,
    device: { ...WEB_FOOD },
    full_name: 'Nguyễn Văn An',
    consent: { ...CONSENT },
    ...overrides,
  };
}

describe('M01.03 — client register', () => {
  let app: AuthApp;

  beforeAll(async () => {
    app = await startAuthApp({}, { relaxTimeouts: true, configOverride: { clientAuth: { termsVersion: TERMS, privacyVersion: PRIVACY } } });
  });

  afterAll(async () => {
    await removeRegisterAuditStall(app.pool);
    await app.close();
  });

  function call(payload: Record<string, unknown>, key: string | null = randomUUID(), target: AuthApp = app) {
    return target.call('POST', '/client-auth/register', {
      ...(key === null ? {} : { headers: { 'idempotency-key': key } }),
      body: payload,
    });
  }

  async function userCount(phone: string): Promise<number> {
    return countRows(app.pool, 'SELECT 1 FROM app.users WHERE phone_normalized = $1', [phone]);
  }

  async function consumedCount(phone: string): Promise<number> {
    return countRows(app.pool, 'SELECT 1 FROM app.verification_proofs WHERE phone_normalized = $1 AND consumed_at IS NOT NULL', [phone]);
  }

  async function nothingCreated(phone: string): Promise<void> {
    expect(await userCount(phone)).toBe(0);
    expect(await consumedCount(phone)).toBe(0);
  }

  describe('R01 — FOOD and SHIP register through the OTP core', () => {
    for (const [label, device] of [
      ['FOOD', WEB_FOOD],
      ['SHIP', WEB_SHIP],
    ] as const) {
      it(`${label}: CUSTOMER user, profile v1, consent with database time, CUSTOMER session, exact response`, async () => {
        const phone = randomPhone();
        const proof = await obtainProof(app, phone);
        const response = await call(body(phone, proof.proofToken, { device: { ...device }, full_name: '  Trần   Thị\tBình ' }));
        expect(response.status).toBe(201);
        expect(response.headers.get('cache-control')).toBe('no-store');
        const data = dataOf(response);
        expect(Object.keys(data)).toEqual([
          'user_id',
          'phone_normalized',
          'available_roles',
          'active_role',
          'profile',
          'capabilities',
          'onboarding',
          'onboarding_required',
          'role_selection_required',
          'access_token',
          'session',
        ]);
        expect(data.phone_normalized).toBe(phone.normalized);
        expect(data.available_roles).toEqual(label === 'SHIP' ? ['CUSTOMER', 'DRIVER'] : ['CUSTOMER']);
        expect(data.active_role).toBe(label === 'SHIP' ? 'DRIVER' : 'CUSTOMER');
        expect(data.profile).toEqual({ full_name: 'Trần Thị Bình', version: 1 });
        expect(data.capabilities).toEqual({
          customer_access: true,
          shop_profile_read: false,
          shop_manage: false,
          driver_profile_read: label === 'SHIP',
        });
        expect(data.role_selection_required).toBe(false);
        expect(data.onboarding_required).toBe(false);
        expect(String(data.access_token).length).toBeGreaterThan(20);
        expect(Object.keys(data.session as object)).toEqual(['expires_at']);
        expect(Date.parse((data.session as { expires_at: string }).expires_at)).toBeGreaterThan(Date.now());

        const userId = String(data.user_id);
        const user = await app.pool.query<{ status: string; account_origin: string | null }>(
          'SELECT status, account_origin FROM app.users WHERE user_id = $1::uuid',
          [userId],
        );
        expect(user.rows[0]).toEqual({ status: 'ACTIVE', account_origin: 'PHONE_VERIFIED' });
        const roles = await app.pool.query<{ role: string }>('SELECT role FROM app.user_roles WHERE user_id = $1::uuid', [userId]);
        expect(roles.rows.map((r) => r.role).sort()).toEqual(label === 'SHIP' ? ['CUSTOMER', 'DRIVER'] : ['CUSTOMER']);
        const profile = await app.pool.query<{ full_name: string; version: string }>(
          'SELECT full_name, version::text FROM app.customer_profiles WHERE user_id = $1::uuid',
          [userId],
        );
        expect(profile.rows).toEqual([{ full_name: 'Trần Thị Bình', version: '1' }]);
        const consent = await app.pool.query<{ terms_version: string; privacy_version: string; client_app: string; fresh: boolean }>(
          `SELECT terms_version, privacy_version, client_app, abs(extract(epoch FROM clock_timestamp() - accepted_at)) < 120 AS fresh
             FROM app.user_consents WHERE user_id = $1::uuid`,
          [userId],
        );
        expect(consent.rows).toEqual([{ terms_version: TERMS, privacy_version: PRIVACY, client_app: label, fresh: true }]);
        const session = await app.pool.query<{ active_role: string | null; device_id: string; platform: string; app: string }>(
          'SELECT active_role, device_id, platform, app FROM app.sessions WHERE user_id = $1::uuid',
          [userId],
        );
        expect(session.rows).toEqual([{ active_role: label === 'SHIP' ? 'DRIVER' : 'CUSTOMER', device_id: device.device_id, platform: 'WEB', app: label }]);
        expect(await countRows(app.pool, "SELECT 1 FROM app.audit_logs WHERE actor_id = $1 AND action = 'client.auth.register.v1'", [userId])).toBe(1);
        expect(await countRows(app.pool, "SELECT 1 FROM app.outbox_events WHERE resource_id = $1 AND event_type = 'client.auth.user_registered.v1'", [userId])).toBe(1);
      });
    }
  });

  describe('R02 — proof rules', () => {
    it('refuses an unknown, malformed, wrong-phone, wrong-purpose, used, expired and invalidated proof without partial rows', async () => {
      const phone = randomPhone();
      const proof = await obtainProof(app, phone);

      const unknown = await call(body(phone, randomBytes(32).toString('base64url')));
      expect(errorCode(unknown)).toBe('VERIFICATION_PROOF_INVALID');
      const malformed = await call(body(phone, 'not a token'));
      expect(errorCode(malformed)).toBe('VERIFICATION_PROOF_INVALID');
      const other = randomPhone();
      app.track(other.normalized);
      const wrongPhone = await call(body(other, proof.proofToken));
      expect(errorCode(wrongPhone)).toBe('VERIFICATION_PROOF_INVALID');
      await nothingCreated(phone.normalized);
      await nothingCreated(other.normalized);

      await ageProof(app.pool, proof.proofToken, 3600);
      const expired = await call(body(phone, proof.proofToken));
      expect(errorCode(expired)).toBe('VERIFICATION_PROOF_INVALID');
      await nothingCreated(phone.normalized);

      const second = await obtainProof(app, randomPhone());
      const first = await call(body(second.phone, second.proofToken));
      expect(first.status).toBe(201);
      const reuse = await call(body(second.phone, second.proofToken));
      expect(errorCode(reuse)).toBe('VERIFICATION_PROOF_USED');
    });

    it('refuses a proof invalidated by a newer OTP of the same number', async () => {
      const phone = randomPhone();
      const proof = await obtainProof(app, phone);
      await app.pool.query('UPDATE app.verification_proofs SET invalidated_at = clock_timestamp() WHERE phone_normalized = $1', [phone.normalized]);
      const refused = await call(body(phone, proof.proofToken));
      expect(errorCode(refused)).toBe('VERIFICATION_PROOF_INVALID');
      await nothingCreated(phone.normalized);
    });
  });

  describe('F1 — proof purpose and replay after the proof changed (real API, real PostgreSQL)', () => {
    async function writeCounts(userId: string, proofId: string) {
      return {
        users: await countRows(app.pool, 'SELECT 1 FROM app.users WHERE user_id = $1::uuid', [userId]),
        roles: await countRows(app.pool, 'SELECT 1 FROM app.user_roles WHERE user_id = $1::uuid', [userId]),
        profiles: await countRows(app.pool, 'SELECT 1 FROM app.customer_profiles WHERE user_id = $1::uuid', [userId]),
        consents: await countRows(app.pool, 'SELECT 1 FROM app.user_consents WHERE user_id = $1::uuid', [userId]),
        sessions: await countRows(app.pool, 'SELECT 1 FROM app.sessions WHERE user_id = $1::uuid', [userId]),
        audit: await countRows(app.pool, "SELECT 1 FROM app.audit_logs WHERE actor_id = $1 AND action = 'client.auth.register.v1'", [userId]),
        outbox: await countRows(app.pool, "SELECT 1 FROM app.outbox_events WHERE resource_id = $1 AND event_type = 'client.auth.user_registered.v1'", [userId]),
        records: await countRows(app.pool, 'SELECT 1 FROM app.idempotency_records WHERE scope_id = $1', [proofId]),
      };
    }

    it('a proof issued for another purpose answers 400 VERIFICATION_PURPOSE_MISMATCH and creates/consumes nothing', async () => {
      const phone = randomPhone();
      const proof = await obtainProof(app, phone);
      const proofId = await proofIdOfToken(app.pool, proof.proofToken);
      // A proof of the same number and a still valid lifetime, issued for another lane (the purpose column is free-form
      // UPPER_SNAKE; the activation lane is the real one that exists).
      await app.pool.query("UPDATE app.verification_proofs SET purpose = 'ADMIN_ACTIVATION' WHERE proof_id = $1::uuid", [proofId]);
      const key = randomUUID();
      const refused = await call(body(phone, proof.proofToken), key);
      expect([refused.status, errorCode(refused)]).toEqual([400, 'VERIFICATION_PURPOSE_MISMATCH']);
      expect(refused.headers.get('cache-control')).toBe('no-store');
      await nothingCreated(phone.normalized);
      expect(await countRows(app.pool, 'SELECT 1 FROM app.idempotency_records WHERE scope_id = $1', [proofId])).toBe(0);
      expect(await countRows(app.pool, 'SELECT 1 FROM app.sessions s JOIN app.users u USING (user_id) WHERE u.phone_normalized = $1', [phone.normalized])).toBe(0);
      expect(await countRows(app.pool, "SELECT 1 FROM app.audit_logs WHERE request_id = $1::uuid AND action = 'client.auth.register.v1'", [refused.requestId])).toBe(0);
    });

    it('proof expires naturally after the commit: the same key and body still return the ORIGINAL token and expires_at with the CURRENT identity, and write nothing again', async () => {
      const phone = randomPhone();
      const proof = await obtainProof(app, phone);
      const proofId = await proofIdOfToken(app.pool, proof.proofToken);
      const key = randomUUID();
      const first = await call(body(phone, proof.proofToken), key);
      expect(first.status).toBe(201);
      const firstData = dataOf(first);
      const userId = String(firstData.user_id);
      const before = await writeCounts(userId, proofId);
      expect(before).toEqual({ users: 1, roles: 1, profiles: 1, consents: 1, sessions: 1, audit: 1, outbox: 1, records: 1 });

      // Time passes: the proof lifetime elapses (its own CHECK-safe shift), and the profile changes meanwhile.
      await ageProof(app.pool, proof.proofToken, 3600);
      expect(await countRows(app.pool, 'SELECT 1 FROM app.verification_proofs WHERE proof_id = $1::uuid AND expires_at < clock_timestamp()', [proofId])).toBe(1);
      await app.pool.query("UPDATE app.customer_profiles SET full_name = 'Tên Sau Hạn', version = version + 1 WHERE user_id = $1::uuid", [userId]);

      const replay = await call(body(phone, proof.proofToken), key);
      expect(replay.status).toBe(201);
      const data = dataOf(replay);
      expect(data.access_token).toBe(firstData.access_token);
      expect(data.session).toEqual(firstData.session);
      expect(data.user_id).toBe(userId);
      expect(data.profile).toEqual({ full_name: 'Tên Sau Hạn', version: 2 });
      expect(data.active_role).toBe('CUSTOMER');
      expect(await writeCounts(userId, proofId)).toEqual(before);
      // The session the replay returned still works for the legacy me route (it is the very session created at commit).
      expect((await app.call('GET', '/auth/me', { bearer: String(data.access_token) })).status).toBe(200);
    });

    it('proof invalidated after the commit: 409 AUTH_RESULT_NOT_REPLAYABLE, no token, no restored session, nothing written', async () => {
      const phone = randomPhone();
      const proof = await obtainProof(app, phone);
      const proofId = await proofIdOfToken(app.pool, proof.proofToken);
      const key = randomUUID();
      const first = await call(body(phone, proof.proofToken), key);
      expect(first.status).toBe(201);
      const firstData = dataOf(first);
      const userId = String(firstData.user_id);
      const sessionId = await sessionIdOfToken(app.pool, String(firstData.access_token));
      const before = await writeCounts(userId, proofId);

      await app.pool.query('UPDATE app.verification_proofs SET invalidated_at = clock_timestamp() WHERE proof_id = $1::uuid', [proofId]);
      // An already revoked session must also stay revoked (no restoration by a replay).
      await app.pool.query('UPDATE app.sessions SET revoked_at = clock_timestamp() WHERE session_id = $1::uuid', [sessionId]);

      const replay = await call(body(phone, proof.proofToken), key);
      expect([replay.status, errorCode(replay)]).toEqual([409, 'AUTH_RESULT_NOT_REPLAYABLE']);
      expect(replay.text).not.toContain(String(firstData.access_token));
      expect(replay.text).not.toContain('expires_at');
      expect(await writeCounts(userId, proofId)).toEqual(before);
      expect(await countRows(app.pool, 'SELECT 1 FROM app.sessions WHERE session_id = $1::uuid AND revoked_at IS NOT NULL', [sessionId])).toBe(1);
      expect((await app.call('GET', '/auth/me', { bearer: String(firstData.access_token) })).status).toBe(401);
    });

    it('proof invalidated after the commit alone (session untouched) is still not replayable and the session is not touched', async () => {
      const phone = randomPhone();
      const proof = await obtainProof(app, phone);
      const proofId = await proofIdOfToken(app.pool, proof.proofToken);
      const key = randomUUID();
      const first = await call(body(phone, proof.proofToken), key);
      const firstData = dataOf(first);
      const userId = String(firstData.user_id);
      const before = await writeCounts(userId, proofId);
      await app.pool.query('UPDATE app.verification_proofs SET invalidated_at = clock_timestamp() WHERE proof_id = $1::uuid', [proofId]);
      const replay = await call(body(phone, proof.proofToken), key);
      expect([replay.status, errorCode(replay)]).toEqual([409, 'AUTH_RESULT_NOT_REPLAYABLE']);
      expect(replay.text).not.toContain(String(firstData.access_token));
      expect(await writeCounts(userId, proofId)).toEqual(before);
    });
  });

  describe('R03 — strict parser, name and password boundaries', () => {
    async function fresh() {
      const phone = randomPhone();
      const proof = await obtainProof(app, phone);
      return { phone, proof };
    }

    it('refuses extra keys at every level, missing keys and non-object bodies with a plain 400', async () => {
      const { phone, proof } = await fresh();
      const cases: Array<Record<string, unknown> | string> = [
        body(phone, proof.proofToken, { role: 'DRIVER' }),
        body(phone, proof.proofToken, { permissions: ['x'] }),
        body(phone, proof.proofToken, { device: { ...WEB_FOOD, extra: 1 } }),
        body(phone, proof.proofToken, { consent: { ...CONSENT, accepted_at: '2020-01-01T00:00:00Z' } }),
        body(phone, proof.proofToken, { device: { ...WEB_FOOD, platform: 'IOS' } }),
        body(phone, proof.proofToken, { device: { ...WEB_FOOD, app: 'SHIP11' } }),
        { phone: phone.local },
        '[]',
      ];
      for (const candidate of cases) {
        const response =
          typeof candidate === 'string'
            ? await app.call('POST', '/client-auth/register', { headers: { 'idempotency-key': randomUUID() }, rawBody: candidate })
            : await call(candidate);
        expect([response.status, errorCode(response)]).toEqual([400, 'BAD_REQUEST']);
        expect(response.headers.get('cache-control')).toBe('no-store');
      }
      expect(await call(body(phone, proof.proofToken, { phone: 'abc' }))).toMatchObject({ status: 400 });
      await nothingCreated(phone.normalized);
    });

    it('normalizes the name (NFC, white space collapsed, trimmed) and refuses control/format/empty/too long', async () => {
      const nfd = 'Nguyễn';
      const accepted: Array<[string, string]> = [
        [nfd + ' 　Văn\n\tAn', 'Nguyễn Văn An'],
        ['a'.repeat(120), 'a'.repeat(120)],
        ['😀'.repeat(120), '😀'.repeat(120)],
        ['A', 'A'],
      ];
      for (const [input, expected] of accepted) {
        const { phone, proof } = await fresh();
        const response = await call(body(phone, proof.proofToken, { full_name: input }));
        expect([input.length, response.status]).toEqual([input.length, 201]);
        expect((dataOf(response).profile as { full_name: string }).full_name).toBe(expected.normalize('NFC'));
      }
      const refused = ['', '   ', 'a'.repeat(121), '😀'.repeat(121), 'An\u0000Binh', 'An​Binh', 'An﻿Binh', 'An\u0007', '\ud800x', 7];
      const { phone, proof } = await fresh();
      for (const name of refused) {
        const response = await call(body(phone, proof.proofToken, { full_name: name }));
        expect([String(name).length, response.status, errorCode(response)]).toEqual([String(name).length, 400, 'BAD_REQUEST']);
      }
      await nothingCreated(phone.normalized);
    });

    it('keeps the password exactly (no trim, no normalization) and enforces 8..128 code points', async () => {
      const spaced = '  Pass word 12  ';
      const { phone, proof } = await fresh();
      const ok = await call(body(phone, proof.proofToken, { password: spaced }));
      expect(ok.status).toBe(201);
      const login = await app.call('POST', '/auth/login', {
        body: { phone: phone.local, password: spaced, device: { device_id: 'device-test-0001', platform: 'ANDROID', app: 'SHIP11' } },
      });
      expect(login.status).toBe(200);
      const trimmed = await app.call('POST', '/auth/login', {
        body: { phone: phone.local, password: spaced.trim(), device: { device_id: 'device-test-0001', platform: 'ANDROID', app: 'SHIP11' } },
      });
      expect(trimmed.status).toBe(401);

      const other = await fresh();
      for (const bad of ['1234567', 'x'.repeat(129), 12345678]) {
        const response = await call(body(other.phone, other.proof.proofToken, { password: bad }));
        expect([response.status, errorCode(response)]).toEqual([400, 'BAD_REQUEST']);
      }
      const edge = await call(body(other.phone, other.proof.proofToken, { password: '😀'.repeat(8) }));
      expect(edge.status).toBe(201);
    });
  });

  describe('R04 — Idempotency-Key', () => {
    it('requires a well-formed key and refuses a changed body or a changed key on retry', async () => {
      const phone = randomPhone();
      const proof = await obtainProof(app, phone);
      expect(errorCode(await call(body(phone, proof.proofToken), null))).toBe('IDEMPOTENCY_KEY_REQUIRED');
      expect(errorCode(await call(body(phone, proof.proofToken), 'short key with spaces'))).toBe('INVALID_IDEMPOTENCY_KEY');
      await nothingCreated(phone.normalized);

      const key = randomUUID();
      const first = await call(body(phone, proof.proofToken), key);
      expect(first.status).toBe(201);
      const changed = await call(body(phone, proof.proofToken, { full_name: 'Someone Else' }), key);
      expect(errorCode(changed)).toBe('IDEMPOTENCY_KEY_REUSED');
      const otherKey = await call(body(phone, proof.proofToken), randomUUID());
      expect(errorCode(otherKey)).toBe('VERIFICATION_PROOF_USED');
      expect(await userCount(phone.normalized)).toBe(1);
      expect(await countRows(app.pool, 'SELECT 1 FROM app.user_consents WHERE user_id = $1::uuid', [String(dataOf(first).user_id)])).toBe(1);
    });
  });

  describe('replay (R05/R08/R15)', () => {
    it('replays the ORIGINAL token and expiry with the CURRENT identity, and writes nothing again', async () => {
      const phone = randomPhone();
      const proof = await obtainProof(app, phone);
      const key = randomUUID();
      const first = await call(body(phone, proof.proofToken), key);
      expect(first.status).toBe(201);
      const firstData = dataOf(first);
      const userId = String(firstData.user_id);

      const replay = await call(body(phone, proof.proofToken), key);
      expect(replay.status).toBe(201);
      expect(replay.text).toBe(first.text);

      // R15: rights and profile changed after registration -> the replay shows the CURRENT state, the same token/expiry.
      await app.pool.query("UPDATE app.customer_profiles SET full_name = 'Tên Mới', version = version + 1 WHERE user_id = $1::uuid", [userId]);
      await grantRole(app.pool, userId, 'DRIVER');
      const changed = await call(body(phone, proof.proofToken), key);
      expect(changed.status).toBe(201);
      const data = dataOf(changed);
      expect(data.access_token).toBe(firstData.access_token);
      expect(data.session).toEqual(firstData.session);
      expect(data.profile).toEqual({ full_name: 'Tên Mới', version: 2 });
      expect(data.available_roles).toEqual(['CUSTOMER', 'DRIVER']);
      expect(data.active_role).toBe('CUSTOMER');

      // A stray CUSTOMER removal: the active context is no longer selectable -> null, role selection required.
      await app.pool.query("DELETE FROM app.user_roles WHERE user_id = $1::uuid AND role = 'CUSTOMER'", [userId]);
      const noCustomer = dataOf(await call(body(phone, proof.proofToken), key));
      expect(noCustomer.active_role).toBeNull();
      expect((noCustomer.capabilities as { customer_access: boolean }).customer_access).toBe(false);

      expect(await countRows(app.pool, 'SELECT 1 FROM app.sessions WHERE user_id = $1::uuid', [userId])).toBe(1);
      expect(await countRows(app.pool, 'SELECT 1 FROM app.user_consents WHERE user_id = $1::uuid', [userId])).toBe(1);
      expect(await countRows(app.pool, "SELECT 1 FROM app.outbox_events WHERE resource_id = $1 AND event_type = 'client.auth.user_registered.v1'", [userId])).toBe(1);
    });

    it('answers AUTH_RESULT_NOT_REPLAYABLE (409) when the session is expired, revoked or the user disabled', async () => {
      const scenarios: Array<[string, (userId: string, token: string) => Promise<void>]> = [
        ['expired', async (_u, token) => expireSession(app.pool, await sessionIdOfToken(app.pool, token))],
        [
          'revoked',
          async (_u, token) => {
            await app.pool.query('UPDATE app.sessions SET revoked_at = clock_timestamp() WHERE session_id = $1::uuid', [await sessionIdOfToken(app.pool, token)]);
          },
        ],
        ['disabled', async (userId) => setUserStatus(app.pool, userId, 'DISABLED')],
      ];
      for (const [label, mutate] of scenarios) {
        const phone = randomPhone();
        const proof = await obtainProof(app, phone);
        const key = randomUUID();
        const first = await call(body(phone, proof.proofToken), key);
        const data = dataOf(first);
        await mutate(String(data.user_id), String(data.access_token));
        const replay = await call(body(phone, proof.proofToken), key);
        expect([label, replay.status, errorCode(replay)]).toEqual([label, 409, 'AUTH_RESULT_NOT_REPLAYABLE']);
        expect(replay.text).not.toContain(String(data.access_token));
      }
    });

    it('does not decrypt a replay for a different body (fingerprint) and never leaks the token in it', async () => {
      const phone = randomPhone();
      const proof = await obtainProof(app, phone);
      const key = randomUUID();
      const first = await call(body(phone, proof.proofToken), key);
      const other = await call(body(phone, proof.proofToken, { password: 'Another-Passw0rd-Entirely' }), key);
      expect(errorCode(other)).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(other.text).not.toContain(String(dataOf(first).access_token));
    });
  });

  describe('R05 — concurrency and lost response', () => {
    it('same key and intent in parallel: one commit, one token, one consent, one event; every winner/replay is identical', async () => {
      const phone = randomPhone();
      const proof = await obtainProof(app, phone);
      const key = randomUUID();
      const results = await Promise.all(Array.from({ length: 5 }, () => call(body(phone, proof.proofToken), key)));
      const created = results.filter((r) => r.status === 201);
      expect(created.length).toBeGreaterThanOrEqual(1);
      for (const r of results) {
        expect([201, 409]).toContain(r.status);
        if (r.status === 409) {
          expect(['IDEMPOTENCY_BUSY']).toContain(errorCode(r));
        }
      }
      expect(new Set(created.map((r) => r.text)).size).toBe(1);
      expect(await userCount(phone.normalized)).toBe(1);
      const userId = String(dataOf(created[0] as never).user_id);
      expect(await countRows(app.pool, 'SELECT 1 FROM app.sessions WHERE user_id = $1::uuid', [userId])).toBe(1);
      expect(await countRows(app.pool, 'SELECT 1 FROM app.user_consents WHERE user_id = $1::uuid', [userId])).toBe(1);
      expect(await countRows(app.pool, "SELECT 1 FROM app.outbox_events WHERE resource_id = $1 AND event_type = 'client.auth.user_registered.v1'", [userId])).toBe(1);
    });

    it('lost response: the retry with the same key gets the same 201', async () => {
      const phone = randomPhone();
      const proof = await obtainProof(app, phone);
      const key = randomUUID();
      const first = await call(body(phone, proof.proofToken), key);
      const retry = await call(body(phone, proof.proofToken), key);
      expect([first.status, retry.status, retry.text]).toEqual([201, 201, first.text]);
    });
  });

  describe('R06 — two proofs of one phone, legacy against new', () => {
    it('exactly one registration wins; the loser leaves no partial state and its proof is not consumed', async () => {
      const phone = randomPhone();
      const a = await obtainProof(app, phone);
      await ageVerification(app.pool, a.verificationId, 3600); // lets the same number request a second OTP
      const b = await obtainProof(app, phone);
      // The newer OTP may have invalidated the older proof; force both valid to exercise the user UNIQUE race.
      await app.pool.query('UPDATE app.verification_proofs SET invalidated_at = NULL WHERE phone_normalized = $1', [phone.normalized]);
      const [first, second] = await Promise.all([call(body(phone, a.proofToken)), call(body(phone, b.proofToken))]);
      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([201, 409]);
      const loser = first.status === 201 ? second : first;
      expect(errorCode(loser)).toBe('PHONE_ALREADY_REGISTERED');
      expect(await userCount(phone.normalized)).toBe(1);
      expect(await consumedCount(phone.normalized)).toBe(1);
      expect(await countRows(app.pool, 'SELECT 1 FROM app.user_consents WHERE user_id IN (SELECT user_id FROM app.users WHERE phone_normalized = $1)', [phone.normalized])).toBe(1);
    });

    it('legacy register already created the phone -> the new route answers PHONE_ALREADY_REGISTERED and keeps its proof', async () => {
      const phone = randomPhone();
      const a = await obtainProof(app, phone);
      await ageVerification(app.pool, a.verificationId, 3600);
      const b = await obtainProof(app, phone);
      await app.pool.query('UPDATE app.verification_proofs SET invalidated_at = NULL WHERE phone_normalized = $1', [phone.normalized]);
      const legacy = await app.call('POST', '/auth/register', {
        headers: { 'idempotency-key': randomUUID() },
        body: { phone: phone.local, password: PASSWORD, verification_token: a.proofToken, device: { device_id: 'device-test-0001', platform: 'ANDROID', app: 'SHIP11' } },
      });
      expect(legacy.status).toBe(201);
      const response = await call(body(phone, b.proofToken));
      expect(errorCode(response)).toBe('PHONE_ALREADY_REGISTERED');
      expect(await consumedCount(phone.normalized)).toBe(1);
      expect(await userCount(phone.normalized)).toBe(1);
    });

    it('the two routes use separate idempotency namespaces for the same proof', async () => {
      const phone = randomPhone();
      const proof = await obtainProof(app, phone);
      const key = randomUUID();
      const first = await call(body(phone, proof.proofToken), key);
      expect(first.status).toBe(201);
      const proofId = await proofIdOfToken(app.pool, proof.proofToken);
      const rows = await app.pool.query<{ scope_type: string; operation_id: string }>(
        'SELECT scope_type, operation_id FROM app.idempotency_records WHERE scope_id = $1',
        [proofId],
      );
      expect(rows.rows).toEqual([{ scope_type: 'client_verification_proof', operation_id: 'client.auth.register.v1' }]);
      const legacy = await app.call('POST', '/auth/register', {
        headers: { 'idempotency-key': key },
        body: { phone: phone.local, password: PASSWORD, verification_token: proof.proofToken, device: { device_id: 'device-test-0001', platform: 'ANDROID', app: 'SHIP11' } },
      });
      expect(errorCode(legacy)).toBe('VERIFICATION_PROOF_USED');
    });
  });

  describe('F2 — legacy /auth/register against /client-auth/register on one phone (deterministic overlap)', () => {
    const RACE_KEY: readonly [number, number] = [20261011, 4];
    const LEGACY_DEVICE = { device_id: 'device-test-0001', platform: 'ANDROID', app: 'SHIP11' };

    async function installRaceStall(): Promise<void> {
      await app.pool.query('DROP TRIGGER IF EXISTS test_stall_race_audit ON app.audit_logs');
      await app.pool.query('DROP FUNCTION IF EXISTS app.test_stall_race_audit()');
      await app.pool.query(
        `CREATE FUNCTION app.test_stall_race_audit() RETURNS trigger LANGUAGE plpgsql AS $$
         BEGIN
           IF NEW.action IN ('auth.register.v1', 'client.auth.register.v1') THEN
             PERFORM pg_advisory_xact_lock(${RACE_KEY[0]}, ${RACE_KEY[1]});
           END IF;
           RETURN NEW;
         END $$`,
      );
      await app.pool.query('CREATE TRIGGER test_stall_race_audit BEFORE INSERT ON app.audit_logs FOR EACH ROW EXECUTE FUNCTION app.test_stall_race_audit()');
    }

    async function removeRaceStall(): Promise<void> {
      await app.pool.query('DROP TRIGGER IF EXISTS test_stall_race_audit ON app.audit_logs');
      await app.pool.query('DROP FUNCTION IF EXISTS app.test_stall_race_audit()');
    }

    function legacyCall(phone: Phone, proofToken: string) {
      return app.call('POST', '/auth/register', {
        headers: { 'idempotency-key': randomUUID() },
        body: { phone: phone.local, password: PASSWORD, verification_token: proofToken, device: { ...LEGACY_DEVICE } },
      });
    }

    for (const winner of ['legacy', 'client'] as const) {
      it(`${winner} wins: exactly one user, only the winner consumes its proof, the loser leaves nothing, and every row belongs to the ${winner} endpoint`, async () => {
        const phone = randomPhone();
        const winnerProof = await obtainProof(app, phone);
        await ageVerification(app.pool, winnerProof.verificationId, 3600); // lets the same number request a second OTP
        const loserProof = await obtainProof(app, phone);
        // Two VALID proofs of one number (a newer OTP would normally invalidate the older one).
        await app.pool.query('UPDATE app.verification_proofs SET invalidated_at = NULL WHERE phone_normalized = $1', [phone.normalized]);
        const winnerProofId = await proofIdOfToken(app.pool, winnerProof.proofToken);
        const loserProofId = await proofIdOfToken(app.pool, loserProof.proofToken);

        await installRaceStall();
        const holder = await LockHolder.begin(app.pool);
        await holder.query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [RACE_KEY[0], RACE_KEY[1]]);
        let winnerResponse: ApiResponse;
        let loserResponse: ApiResponse;
        try {
          // 1. The winner starts and stops at its audit insert: its user row is inserted and UNCOMMITTED.
          const winning = winner === 'legacy' ? legacyCall(phone, winnerProof.proofToken) : call(body(phone, winnerProof.proofToken));
          await eventually(() => advisoryWaiterExists(app.pool, RACE_KEY), 'the winner is stalled at its audit insert with an uncommitted user');
          expect(await userCount(phone.normalized)).toBe(0);
          // 2. The OTHER endpoint starts now, with the other valid proof, and is blocked behind the uncommitted user row.
          const losing = winner === 'legacy' ? call(body(phone, loserProof.proofToken)) : legacyCall(phone, loserProof.proofToken);
          await eventually(async () => (await transactionWaiters(app.pool)) >= 1, 'the loser waits on the winner uncommitted user');
          // 3. Release: the winner commits, the loser is released into the unique-phone conflict.
          await holder.commit();
          [winnerResponse, loserResponse] = await Promise.all([winning, losing]);
        } finally {
          await holder.rollback();
          await removeRaceStall();
        }

        expect(winnerResponse.status).toBe(201);
        expect([loserResponse.status, errorCode(loserResponse)]).toEqual([409, 'PHONE_ALREADY_REGISTERED']);
        expect(loserResponse.text).not.toContain('access_token');

        // Exactly one user; only the winner's proof is consumed.
        expect(await userCount(phone.normalized)).toBe(1);
        const userId = String(dataOf(winnerResponse).user_id);
        expect(await countRows(app.pool, 'SELECT 1 FROM app.sessions WHERE user_id = $1::uuid', [userId])).toBe(1);
        const consumed = await app.pool.query<{ proof_id: string }>('SELECT proof_id FROM app.verification_proofs WHERE phone_normalized = $1 AND consumed_at IS NOT NULL', [phone.normalized]);
        expect(consumed.rows.map((r) => r.proof_id)).toEqual([winnerProofId]);

        // The loser left no record of any kind: idempotency, audit (by request id), outbox (by the user), no second session.
        expect(await countRows(app.pool, 'SELECT 1 FROM app.idempotency_records WHERE scope_id = $1', [loserProofId])).toBe(0);
        expect(await countRows(app.pool, 'SELECT 1 FROM app.audit_logs WHERE request_id = $1::uuid', [loserResponse.requestId])).toBe(0);
        expect(await countRows(app.pool, 'SELECT 1 FROM app.idempotency_records WHERE scope_id = $1', [winnerProofId])).toBe(1);

        const roles = (await app.pool.query<{ role: string }>('SELECT role FROM app.user_roles WHERE user_id = $1::uuid', [userId])).rows.map((r) => r.role);
        const profiles = await countRows(app.pool, 'SELECT 1 FROM app.customer_profiles WHERE user_id = $1::uuid', [userId]);
        const consents = await countRows(app.pool, 'SELECT 1 FROM app.user_consents WHERE user_id = $1::uuid', [userId]);
        const activeRole = (await app.pool.query<{ active_role: string | null }>('SELECT active_role FROM app.sessions WHERE user_id = $1::uuid', [userId])).rows[0]?.active_role;
        const legacyAudit = await countRows(app.pool, "SELECT 1 FROM app.audit_logs WHERE actor_id = $1 AND action = 'auth.register.v1'", [userId]);
        const clientAudit = await countRows(app.pool, "SELECT 1 FROM app.audit_logs WHERE actor_id = $1 AND action = 'client.auth.register.v1'", [userId]);
        const legacyOutbox = await countRows(app.pool, "SELECT 1 FROM app.outbox_events WHERE resource_id = $1 AND event_type = 'auth.user_registered.v1'", [userId]);
        const clientOutbox = await countRows(app.pool, "SELECT 1 FROM app.outbox_events WHERE resource_id = $1 AND event_type = 'client.auth.user_registered.v1'", [userId]);
        const scopes = (await app.pool.query<{ scope_type: string }>('SELECT scope_type FROM app.idempotency_records WHERE scope_id = $1', [winnerProofId])).rows.map((r) => r.scope_type);

        if (winner === 'client') {
          expect(roles).toEqual(['CUSTOMER']);
          expect([profiles, consents]).toEqual([1, 1]);
          expect(activeRole).toBe('CUSTOMER');
          expect([clientAudit, legacyAudit, clientOutbox, legacyOutbox]).toEqual([1, 0, 1, 0]);
          expect(scopes).toEqual(['client_verification_proof']);
        } else {
          expect(roles).toEqual([]);
          expect([profiles, consents]).toEqual([0, 0]);
          expect(activeRole).toBeNull();
          expect([clientAudit, legacyAudit, clientOutbox, legacyOutbox]).toEqual([0, 1, 0, 1]);
          expect(scopes).toEqual(['verification_proof']);
        }
        // The loser's proof is still usable by nobody else here, but it is intact (not consumed, not invalidated).
        expect(await countRows(app.pool, 'SELECT 1 FROM app.verification_proofs WHERE proof_id = $1::uuid AND consumed_at IS NULL AND invalidated_at IS NULL', [loserProofId])).toBe(1);
      });
    }
  });

  describe('R07 — rollback at every persistence step', () => {
    const faults = [
      { name: 'test_cfault_user', table: 'app.users', events: 'INSERT', condition: (m: string) => `NEW.phone_normalized = '${m}'` },
      { name: 'test_cfault_proof', table: 'app.verification_proofs', events: 'UPDATE', condition: (m: string) => `NEW.phone_normalized = '${m}' AND NEW.consumed_at IS NOT NULL` },
      { name: 'test_cfault_role', table: 'app.user_roles', events: 'INSERT', condition: () => "NEW.role = 'CUSTOMER'" },
      { name: 'test_cfault_profile', table: 'app.customer_profiles', events: 'INSERT', condition: () => "NEW.full_name = 'Fault Profile'" },
      { name: 'test_cfault_consent', table: 'app.user_consents', events: 'INSERT', condition: () => `NEW.terms_version = '${TERMS}'` },
      { name: 'test_cfault_session', table: 'app.sessions', events: 'INSERT', condition: () => "NEW.device_id = 'fault-device-0001'" },
      { name: 'test_cfault_audit', table: 'app.audit_logs', events: 'INSERT', condition: () => "NEW.action = 'client.auth.register.v1'" },
      { name: 'test_cfault_outbox', table: 'app.outbox_events', events: 'INSERT', condition: () => "NEW.event_type = 'client.auth.user_registered.v1'" },
      { name: 'test_cfault_idem', table: 'app.idempotency_records', events: 'INSERT', condition: () => "NEW.scope_type = 'client_verification_proof'" },
    ] as const;

    for (const fault of faults) {
      it(`fault at ${fault.table}: nothing remains and the same key then succeeds`, async () => {
        const phone = randomPhone();
        const proof = await obtainProof(app, phone);
        const key = randomUUID();
        const payload = body(phone, proof.proofToken, { full_name: 'Fault Profile', device: { device_id: 'fault-device-0001', platform: 'WEB', app: 'FOOD' } });
        const proofId = await proofIdOfToken(app.pool, proof.proofToken);
        const outboxBefore = await countRows(app.pool, "SELECT 1 FROM app.outbox_events WHERE event_type = 'client.auth.user_registered.v1'");
        await installFault(app.pool, fault.name, fault.table, fault.events, fault.condition(phone.normalized));
        let failed;
        try {
          failed = await call(payload, key);
        } finally {
          await removeFault(app.pool, fault.name, fault.table);
        }
        expect(failed.status).toBeGreaterThanOrEqual(500);
        expect(failed.text).not.toContain('injected fault');
        await nothingCreated(phone.normalized);
        expect(await countRows(app.pool, "SELECT 1 FROM app.sessions WHERE device_id = 'fault-device-0001'")).toBe(0);
        expect(await countRows(app.pool, 'SELECT 1 FROM app.idempotency_records WHERE scope_id = $1', [proofId])).toBe(0);
        expect(await countRows(app.pool, "SELECT 1 FROM app.audit_logs WHERE request_id = $1::uuid AND action = 'client.auth.register.v1'", [failed.requestId])).toBe(0);
        expect(await countRows(app.pool, "SELECT 1 FROM app.outbox_events WHERE event_type = 'client.auth.user_registered.v1'")).toBe(outboxBefore);
        const retry = await call(payload, key);
        expect(retry.status).toBe(201);
        await app.pool.query("DELETE FROM app.sessions WHERE device_id = 'fault-device-0001'");
      });
    }

    it('a register stalled at its audit insert shows no uncommitted state, then completes with everything', async () => {
      const phone = randomPhone();
      const proof = await obtainProof(app, phone);
      await removeRegisterAuditStall(app.pool);
      await installRegisterAuditStall(app.pool, STALL_KEY, 'client.auth.register.v1');
      const holder = await LockHolder.begin(app.pool);
      await holder.query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [STALL_KEY[0], STALL_KEY[1]]);
      try {
        const pending = call(body(phone, proof.proofToken));
        await eventually(() => advisoryWaiterExists(app.pool, STALL_KEY), 'the register is stalled at its audit insert');
        expect(await userCount(phone.normalized)).toBe(0); // uncommitted rows are not visible
        await holder.commit();
        expect((await pending).status).toBe(201);
      } finally {
        await holder.rollback();
        await removeRegisterAuditStall(app.pool);
      }
      expect(await userCount(phone.normalized)).toBe(1);
    });
  });

  describe('R09 — no privilege can be injected', () => {
    it('creates only CUSTOMER: no SHOP, DRIVER, ADMIN, membership or driver/shop row, whatever the body tries', async () => {
      const phone = randomPhone();
      const proof = await obtainProof(app, phone);
      const attempt = await call(body(phone, proof.proofToken, { role: 'ADMIN', driver_type: 'X' }));
      expect(attempt.status).toBe(400);
      const ok = await call(body(phone, proof.proofToken));
      const userId = String(dataOf(ok).user_id);
      expect(await countRows(app.pool, "SELECT 1 FROM app.user_roles WHERE user_id = $1::uuid AND role <> 'CUSTOMER'", [userId])).toBe(0);
      expect(await countRows(app.pool, 'SELECT 1 FROM app.shop_members WHERE user_id = $1::uuid', [userId])).toBe(0);
      expect(await countRows(app.pool, 'SELECT 1 FROM app.drivers WHERE user_id = $1::uuid', [userId])).toBe(0);
      expect(await countRows(app.pool, 'SELECT 1 FROM app.admin_memberships WHERE user_id = $1::uuid', [userId])).toBe(0);
      const origin = await app.pool.query<{ account_origin: string }>('SELECT account_origin FROM app.users WHERE user_id = $1::uuid', [userId]);
      expect(origin.rows[0]?.account_origin).toBe('PHONE_VERIFIED');
    });
  });

  describe('R11 — consent', () => {
    it('refuses a mismatching pair on a first execution (409) before any write, and a replay never rewrites consent', async () => {
      const phone = randomPhone();
      const proof = await obtainProof(app, phone);
      for (const consent of [
        { terms_version: 'test-terms-20261011-v2', privacy_version: PRIVACY },
        { terms_version: TERMS, privacy_version: 'other-privacy' },
        { terms_version: PRIVACY, privacy_version: TERMS },
      ]) {
        const refused = await call(body(phone, proof.proofToken, { consent }));
        expect([refused.status, errorCode(refused)]).toEqual([409, 'CONSENT_VERSION_UNSUPPORTED']);
      }
      expect(await call(body(phone, proof.proofToken, { consent: { terms_version: 'bad value!', privacy_version: PRIVACY } }))).toMatchObject({ status: 400 });
      await nothingCreated(phone.normalized);

      const key = randomUUID();
      const accepted = await call(body(phone, proof.proofToken), key);
      expect(accepted.status).toBe(201);
      const userId = String(dataOf(accepted).user_id);
      const before = await app.pool.query('SELECT id::text, accepted_at::text FROM app.user_consents WHERE user_id = $1::uuid', [userId]);

      // Config drift: a second app whose server pair moved on. The committed replay must neither fail nor rewrite.
      const drifted = await startAuthApp({}, { configOverride: { clientAuth: { termsVersion: 'drifted-terms-v9', privacyVersion: 'drifted-privacy-v9' } } });
      try {
        const replay = await call(body(phone, proof.proofToken), key, drifted);
        expect([replay.status, replay.text]).toEqual([201, accepted.text]);
        const fresh = await obtainProof(drifted, randomPhone());
        const old = await call(body(fresh.phone, fresh.proofToken), randomUUID(), drifted);
        expect(errorCode(old)).toBe('CONSENT_VERSION_UNSUPPORTED');
      } finally {
        await drifted.close();
      }
      const after = await app.pool.query('SELECT id::text, accepted_at::text FROM app.user_consents WHERE user_id = $1::uuid', [userId]);
      expect(after.rows).toEqual(before.rows);
    });

    it('fails closed (503, nothing written) when the server has no consent pair configured', async () => {
      const unconfigured = await startAuthApp();
      try {
        const proof = await obtainProof(unconfigured, randomPhone());
        const response = await call(body(proof.phone, proof.proofToken), randomUUID(), unconfigured);
        expect([response.status, errorCode(response)]).toEqual([503, 'SERVICE_UNAVAILABLE']);
        expect(await countRows(unconfigured.pool, 'SELECT 1 FROM app.users WHERE phone_normalized = $1', [proof.phone.normalized])).toBe(0);
        expect(await countRows(unconfigured.pool, 'SELECT 1 FROM app.verification_proofs WHERE phone_normalized = $1 AND consumed_at IS NOT NULL', [proof.phone.normalized])).toBe(0);
      } finally {
        await unconfigured.close();
      }
    });
  });

  describe('R12 — legacy API unchanged', () => {
    it('legacy register still returns a roleless session and the legacy wire shape; login/me work for a new-route user too', async () => {
      const legacy = await registerUser(app);
      const data = dataOf(legacy.response);
      // The legacy wire shape, byte for byte in its key set: nothing of the new identity block leaks into it.
      expect(Object.keys(data).sort()).toEqual(['access_token', 'active_role', 'available_roles', 'onboarding_required', 'phone_normalized', 'user_id']);
      expect(data.active_role).toBeNull();
      expect(data.available_roles).toEqual([]);
      expect(await countRows(app.pool, 'SELECT 1 FROM app.user_roles WHERE user_id = $1::uuid', [legacy.userId])).toBe(0);
      expect(await countRows(app.pool, 'SELECT 1 FROM app.sessions WHERE user_id = $1::uuid AND active_role IS NULL', [legacy.userId])).toBe(1);
      expect(await countRows(app.pool, 'SELECT 1 FROM app.user_consents WHERE user_id = $1::uuid', [legacy.userId])).toBe(0);
      const me = await app.call('GET', '/auth/me', { bearer: legacy.accessToken });
      expect(me.status).toBe(200);

      const phone = randomPhone();
      const proof = await obtainProof(app, phone);
      const created = await call(body(phone, proof.proofToken));
      const meNew = await app.call('GET', '/auth/me', { bearer: String(dataOf(created).access_token) });
      expect(meNew.status).toBe(200);
      // The legacy /auth/me is unchanged: it does not know the CUSTOMER context (that belongs to the later client me/context slice).
      expect(dataOf(meNew).available_roles).toEqual([]);
      const login = await app.call('POST', '/auth/login', {
        body: { phone: phone.local, password: PASSWORD, device: { device_id: 'device-test-0001', platform: 'ANDROID', app: 'SHIP11' } },
      });
      expect(login.status).toBe(200);
    });

    it('the legacy route does not accept the new body and the new route does not accept the legacy body', async () => {
      const phone = randomPhone();
      const proof = await obtainProof(app, phone);
      const legacyBody = { phone: phone.local, password: PASSWORD, verification_token: proof.proofToken, device: { device_id: 'device-test-0001', platform: 'ANDROID', app: 'SHIP11' } };
      expect(await app.call('POST', '/client-auth/register', { headers: { 'idempotency-key': randomUUID() }, body: legacyBody })).toMatchObject({ status: 400 });
      const mixed = await app.call('POST', '/auth/register', { headers: { 'idempotency-key': randomUUID() }, body: body(phone, proof.proofToken) });
      expect(mixed.status).toBe(400);
      await nothingCreated(phone.normalized);
    });
  });

  describe('R13 — device gate fails closed before any mutation', () => {
    it('Android registration needs OTP but no attestation, immediately serves me and safely replays', async () => {
      for (const appLabel of ['FOOD', 'SHIP']) {
        const phone = randomPhone();
        const proof = await obtainProof(app, phone);
        const key = randomUUID();
        const request = body(phone, proof.proofToken, { device: { ...ANDROID_FOOD, app: appLabel } });
        const response = await call(request, key);
        expect(response.status).toBe(201);
        const token = String(dataOf(response).access_token);
        expect((await app.call('GET', '/client-auth/me', { bearer: token })).status).toBe(200);
        const repeated = await call(request, key);
        expect(repeated.status).toBe(201);
        expect(dataOf(repeated).access_token).toBe(token);
        expect((await app.pool.query('SELECT auth_method FROM app.sessions WHERE user_id = $1', [dataOf(response).user_id])).rows[0].auth_method).toBe('PASSWORD');
      }
    });

    for (const [label, override] of [
      ['production', { appEnv: 'production' }],
      ['staging', { appEnv: 'staging' }],
      ['non-loopback bind in test', { host: '0.0.0.0' }],
    ] as const) {
      it(`WEB in ${label} answers DEVICE_PROOF_REQUIRED (403) before any mutation`, async () => {
        // The gate reads the validated configuration only, so a configuration object is enough; the database stays TEST.
        const gated = await startAuthApp({}, { configOverride: { clientAuth: { termsVersion: TERMS, privacyVersion: PRIVACY }, ...override } as never });
        try {
          const proof = await obtainProof(gated, randomPhone());
          const response = await call(body(proof.phone, proof.proofToken), randomUUID(), gated);
          expect([response.status, errorCode(response)]).toEqual([403, 'DEVICE_PROOF_REQUIRED']);
          expect(await countRows(gated.pool, 'SELECT 1 FROM app.users WHERE phone_normalized = $1', [proof.phone.normalized])).toBe(0);
          expect(await countRows(gated.pool, 'SELECT 1 FROM app.verification_proofs WHERE phone_normalized = $1 AND consumed_at IS NOT NULL', [proof.phone.normalized])).toBe(0);
        } finally {
          await gated.close();
        }
      });
    }
  });

  describe('transport and privacy', () => {
    it('sets no-store on success and on errors, and keeps secrets out of tables and logs', async () => {
      const secret = `Marker-Pw-${randomBytes(6).toString('hex')}!`;
      const phone = randomPhone();
      const proof = await obtainProof(app, phone);
      const key = randomUUID();
      const response = await call(body(phone, proof.proofToken, { password: secret }), key);
      expect(response.status).toBe(201);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const token = String(dataOf(response).access_token);
      await call(body(phone, proof.proofToken, { password: secret }), key);
      const bad = await call({ nonsense: true }, key);
      expect(bad.headers.get('cache-control')).toBe('no-store');
      const malformed = await app.call('POST', '/client-auth/register', { rawBody: '{"a":' });
      expect(malformed.status).toBe(400);
      expect(malformed.headers.get('cache-control')).toBe('no-store');

      const dumps = await Promise.all(
        [
          'SELECT t::text AS dump FROM app.users t WHERE phone_normalized = $1',
          'SELECT t::text AS dump FROM app.verification_proofs t WHERE phone_normalized = $1',
          'SELECT s::text AS dump FROM app.sessions s JOIN app.users u USING (user_id) WHERE u.phone_normalized = $1',
          'SELECT a::text AS dump FROM app.audit_logs a WHERE a.actor_id = (SELECT user_id::text FROM app.users WHERE phone_normalized = $1)',
          'SELECT o::text AS dump FROM app.outbox_events o WHERE o.resource_id = (SELECT user_id::text FROM app.users WHERE phone_normalized = $1)',
          `SELECT r::text AS dump FROM app.idempotency_records r WHERE r.scope_type = 'client_verification_proof'
              AND r.scope_id IN (SELECT proof_id::text FROM app.verification_proofs WHERE phone_normalized = $1)`,
        ].map(async (sql) => (await app.pool.query<{ dump: string }>(sql, [phone.normalized])).rows.map((row) => row.dump).join('\n')),
      );
      const everything = `${dumps.join('\n')}\n${app.running.logs.join('\n')}`;
      for (const [label, value] of [
        ['password', secret],
        ['proof token', proof.proofToken],
        ['access token', token],
      ] as const) {
        expect([label, everything.includes(value)]).toEqual([label, false]);
      }
      expect(await api(app.running.baseUrl, 'POST', '/client-auth/unknown', { body: {} })).toMatchObject({ status: 404 });
    });
  });
});

// R14 — the real M01.22 path: REGISTER OTP delivered into the private test inbox, read back like the PC tool does,
// verified, then registered through the NEW endpoint. Nothing is fixed, nothing auto-verifies, nothing is public or logged.
describe('M01.03 — R14 test inbox to client register', () => {
  let inbox: InboxAuthApp;

  beforeAll(async () => {
    inbox = await startInboxAuthApp({}, { clientAuth: { termsVersion: TERMS, privacyVersion: PRIVACY } });
  });

  afterAll(async () => {
    await inbox.close();
  });

  it('request OTP -> read through the PC-tool client -> verify -> register: 201, and the code is not in the responses or logs', async () => {
    const phone = randomPhone();
    inbox.track(phone.normalized);
    const requested = await inbox.call('POST', '/auth/phone-verifications', { body: { phone: phone.local, purpose: 'REGISTER' } });
    expect(requested.status).toBe(201);
    expect(containsCode(requested.text, '000000')).toBe(false);
    const verificationId = String(dataOf(requested).verification_id);
    const otp = await readOtp(inbox.harness, 'REGISTER', phone.normalized);
    expect(otp).toMatch(/^[0-9]{6}$/);
    expect(containsCode(requested.text, otp)).toBe(false);

    // A wrong code never verifies (no fixed or auto code).
    const wrong = await inbox.call('POST', `/auth/phone-verifications/${verificationId}/verify`, { body: { otp: otp === '123456' ? '654321' : '123456' } });
    expect(wrong.status).toBeGreaterThanOrEqual(400);

    const verified = await inbox.call('POST', `/auth/phone-verifications/${verificationId}/verify`, { body: { otp } });
    expect(verified.status).toBe(200);
    expect(containsCode(verified.text, otp)).toBe(false);
    const proofToken = String(dataOf(verified).verification_token);

    const registered = await inbox.call('POST', '/client-auth/register', {
      headers: { 'idempotency-key': randomUUID() },
      body: body(phone, proofToken),
    });
    expect(registered.status).toBe(201);
    expect(dataOf(registered).active_role).toBe('CUSTOMER');
    expect(containsCode(registered.text, otp)).toBe(false);
    expect(containsCode(inbox.running.logs.join('\n'), otp)).toBe(false);
    expect(inbox.running.logs.join('\n')).not.toContain(proofToken);
    const rows = await inbox.pool.query('SELECT 1 FROM app.user_consents WHERE user_id = $1::uuid', [String(dataOf(registered).user_id)]);
    expect(rows.rowCount).toBe(1);
  });
});
