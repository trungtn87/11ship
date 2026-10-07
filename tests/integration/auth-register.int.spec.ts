import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { eventually } from './support/async-helpers';
import {
  advisoryWaiterExists,
  ageProof,
  ageRegisterRecord,
  api,
  AuthApp,
  countRows,
  dataOf,
  DEVICE,
  errorCode,
  grantRole,
  installFault,
  installRegisterAuditStall,
  obtainProof,
  OTHER_PASSWORD,
  PASSWORD,
  proofIdOfToken,
  randomPhone,
  registerBody,
  registerRecordsOf,
  registerUser,
  removeFault,
  removeRegisterAuditStall,
  sessionIdOfToken,
  startAuthApp,
  transactionWaiters,
} from './support/auth-fixtures';
import { LockHolder } from './support/idempotency-fixtures';

// M01-A1 — roleless register through the M00-C1 IdempotencyExecutor, on a REAL PostgreSQL and the REAL Nest
// pipeline: effects, strict input, proof rules, the replay contract, concurrency with deterministic
// barriers, all-or-nothing atomicity under injected faults, and privacy of every stored byte.
describe('M01-A1 — register', () => {
  let app: AuthApp;

  beforeAll(async () => {
    app = await startAuthApp();
  });

  afterAll(async () => {
    await removeRegisterAuditStall(app.pool);
    await app.close();
  });

  async function register(
    phone: { local: string },
    proofToken: string,
    key: string,
    overrides: { password?: string; device?: Record<string, unknown>; extra?: Record<string, unknown> } = {},
    target: AuthApp = app,
  ) {
    return target.call('POST', '/auth/register', {
      headers: { 'idempotency-key': key },
      body: registerBody(phone as never, proofToken, overrides),
    });
  }

  async function userCount(normalized: string): Promise<number> {
    return countRows(app.pool, 'SELECT 1 FROM app.users WHERE phone_normalized = $1', [normalized]);
  }

  async function sessionCountOf(normalized: string): Promise<number> {
    return countRows(
      app.pool,
      `SELECT 1 FROM app.sessions s JOIN app.users u USING (user_id) WHERE u.phone_normalized = $1`,
      [normalized],
    );
  }

  describe('effects of a first execution', () => {
    it('creates a roleless ACTIVE user, consumes the proof, creates a roleless session, audits and emits one event', async () => {
      const user = await registerUser(app);
      const data = dataOf(user.response);

      expect(user.response.status).toBe(201);
      expect(Object.keys(data).sort()).toEqual([
        'access_token',
        'active_role',
        'available_roles',
        'onboarding_required',
        'phone_normalized',
        'user_id',
      ]);
      expect(data.phone_normalized).toBe(user.phone.normalized);
      expect(data.available_roles).toEqual([]);
      expect(data.active_role).toBeNull();
      expect(data.onboarding_required).toBe(true);
      expect(user.accessToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

      const row = await app.pool.query<{ status: string; version: string; password_hash: string; verified: boolean }>(
        'SELECT status, version, password_hash, phone_verified_at IS NOT NULL AS verified FROM app.users WHERE user_id = $1::uuid',
        [user.userId],
      );
      expect(row.rows[0]?.status).toBe('ACTIVE');
      expect(row.rows[0]?.version).toBe('1');
      expect(row.rows[0]?.verified).toBe(true);
      // Argon2id with the ADR-002 parameters, as a PHC string.
      expect(row.rows[0]?.password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);

      expect(await countRows(app.pool, 'SELECT 1 FROM app.user_roles WHERE user_id = $1::uuid', [user.userId])).toBe(0);

      const proof = await app.pool.query<{ consumed: boolean }>(
        'SELECT consumed_at IS NOT NULL AS consumed FROM app.verification_proofs WHERE phone_normalized = $1',
        [user.phone.normalized],
      );
      expect(proof.rows).toEqual([{ consumed: true }]);

      const session = await app.pool.query<{ active_role: string | null; revoked: boolean; device_id: string; abs_ttl: number }>(
        `SELECT active_role, revoked_at IS NOT NULL AS revoked, device_id,
                extract(epoch FROM (expires_at - created_at))::int AS abs_ttl
           FROM app.sessions WHERE user_id = $1::uuid`,
        [user.userId],
      );
      expect(session.rows).toEqual([{ active_role: null, revoked: false, device_id: DEVICE.device_id, abs_ttl: 604_800 }]);

      const audit = await app.pool.query<{ outcome: string; actor_id: string; resource_id: string; metadata: Record<string, unknown> }>(
        `SELECT outcome, actor_id, resource_id, metadata FROM app.audit_logs
          WHERE request_id = $1::uuid AND action = 'auth.register.v1'`,
        [user.response.requestId],
      );
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0]?.outcome).toBe('SUCCESS');
      expect(audit.rows[0]?.actor_id).toBe(user.userId);
      expect(audit.rows[0]?.resource_id).toBe(user.userId);
      expect(Object.keys(audit.rows[0]?.metadata ?? {})).toEqual(['session_id']);

      const events = await app.pool.query<{ event_type: string; event_schema_version: number; resource_type: string; resource_version: string; payload: unknown }>(
        `SELECT event_type, event_schema_version, resource_type, resource_version, payload
           FROM app.outbox_events WHERE resource_id = $1`,
        [user.userId],
      );
      expect(events.rows).toEqual([
        {
          event_type: 'auth.user_registered.v1',
          event_schema_version: 1,
          resource_type: 'user',
          resource_version: '1',
          payload: { user_id: user.userId },
        },
      ]);

      const proofId = await proofIdOfToken(app.pool, user.proofToken);
      const records = await registerRecordsOf(app.pool, proofId);
      expect(records).toHaveLength(1);
      expect(records[0]?.response_status).toBe(201);
      expect(Object.keys(records[0]?.replay_guard ?? {}).sort()).toEqual(['proof_id', 'session_id', 'user_id']);
    });
  });

  describe('strict input', () => {
    it('refuses security-sensitive and unknown fields without creating anything', async () => {
      const phone = randomPhone();
      const proof = await obtainProof(app, phone);
      for (const extra of [
        { role: 'ADMIN' },
        { roles: ['SHOP'] },
        { driver_type: 'PLATFORM' },
        { is_admin: true },
        { admin: true },
        { permissions: ['*'] },
        { anything_else: 1 },
      ]) {
        const response = await register(phone, proof.proofToken, randomUUID(), { extra });
        expect([extra, response.status, errorCode(response)]).toEqual([extra, 400, 'BAD_REQUEST']);
      }
      const nestedExtra = await register(phone, proof.proofToken, randomUUID(), {
        device: { ...DEVICE, role: 'ADMIN' },
      });
      expect(nestedExtra.status).toBe(400);
      expect(await userCount(phone.normalized)).toBe(0);
      expect(await countRows(app.pool, 'SELECT 1 FROM app.verification_proofs WHERE phone_normalized = $1 AND consumed_at IS NULL', [phone.normalized])).toBe(1);
    });

    it('validates password, device and phone shape', async () => {
      const phone = randomPhone();
      const proof = await obtainProof(app, phone);
      const bad: Array<[string, Parameters<typeof register>[3]]> = [
        ['short password', { password: 'short' }],
        ['too long password', { password: 'x'.repeat(129) }],
        ['lone surrogate', { password: `valid-prefix-${String.fromCharCode(0xd800)}-x` }],
        ['missing device id', { device: { platform: 'ANDROID', app: 'SHIP11' } }],
        ['lower-case platform', { device: { ...DEVICE, platform: 'android' } }],
        ['device id with space', { device: { ...DEVICE, device_id: 'bad id' } }],
        ['device id too long', { device: { ...DEVICE, device_id: 'd'.repeat(129) } }],
      ];
      for (const [label, overrides] of bad) {
        const response = await register(phone, proof.proofToken, randomUUID(), overrides);
        expect([label, response.status, errorCode(response)]).toEqual([label, 400, 'BAD_REQUEST']);
      }
      const invalidPhone = await app.call('POST', '/auth/register', {
        headers: { 'idempotency-key': randomUUID() },
        body: { ...registerBody(phone, proof.proofToken), phone: '12345' },
      });
      expect([invalidPhone.status, errorCode(invalidPhone)]).toEqual([400, 'INVALID_PHONE']);
      expect(await userCount(phone.normalized)).toBe(0);
    });

    it('does not trim or alter the password (leading and trailing spaces are part of it)', async () => {
      const user = await registerUser(app, { password: '  spaced password  ' });
      const login = await app.call('POST', '/auth/login', {
        body: { phone: user.phone.local, password: 'spaced password', device: { ...DEVICE } },
      });
      expect(errorCode(login)).toBe('INVALID_CREDENTIALS');
      const exact = await app.call('POST', '/auth/login', {
        body: { phone: user.phone.local, password: '  spaced password  ', device: { ...DEVICE } },
      });
      expect(exact.status).toBe(200);
    });

    it('requires a canonical Idempotency-Key', async () => {
      const phone = randomPhone();
      const proof = await obtainProof(app, phone);
      const missing = await app.call('POST', '/auth/register', { body: registerBody(phone, proof.proofToken) });
      expect([missing.status, errorCode(missing)]).toEqual([400, 'IDEMPOTENCY_KEY_REQUIRED']);
      // Hex case is NOT a validity criterion (ADR-003 3.1): only shape and the nil UUID are.
      // Only values the HTTP transport preserves belong here. Leading/trailing whitespace is deliberately
      // absent: the HTTP stack may strip a header's optional whitespace (OWS) before the application layer
      // sees it, so such a value never reaches parseIdempotencyKey intact over HTTP. The whitespace cases
      // (leading space, trailing space, trailing newline) are asserted at parser level in
      // apps/backend/src/idempotency/idempotency-key.spec.ts.
      const malformedKeys: ReadonlyArray<readonly [string, string]> = [
        ['empty', ''],
        ['not a uuid', 'not-a-uuid'],
        ['nil UUID', '00000000-0000-0000-0000-000000000000'],
        ['no hyphens (32 hex)', randomUUID().replace(/-/g, '')],
        ['non-hex digit', `${randomUUID().slice(0, 35)}g`],
      ];
      for (const [label, key] of malformedKeys) {
        const response = await register(phone, proof.proofToken, key);
        expect([label, response.status, errorCode(response)]).toEqual([label, 400, 'INVALID_IDEMPOTENCY_KEY']);
      }
      expect(await userCount(phone.normalized)).toBe(0);
    });

    it('accepts an upper-case UUID key and normalizes it: a lower-case replay of the same UUID is the SAME request', async () => {
      const phone = randomPhone();
      const proof = await obtainProof(app, phone);
      const uuid = randomUUID();
      const upper = uuid.toUpperCase();
      expect(upper).not.toBe(uuid); // the premise: the two spellings really differ

      const first = await register(phone, proof.proofToken, upper);
      expect(first.status).toBe(201);
      const proofId = await proofIdOfToken(app.pool, proof.proofToken);
      const recordsAfterFirst = await registerRecordsOf(app.pool, proofId);
      expect(recordsAfterFirst).toHaveLength(1);

      const replay = await register(phone, proof.proofToken, uuid);
      expect(replay.status).toBe(201);
      expect(dataOf(replay).access_token).toBe(dataOf(first).access_token);
      expect(replay.body).toEqual(first.body);

      // Same idempotency record (not a second one), and exactly one business execution.
      const recordsAfterReplay = await registerRecordsOf(app.pool, proofId);
      expect(recordsAfterReplay).toHaveLength(1);
      expect(recordsAfterReplay[0]?.record_id).toBe(recordsAfterFirst[0]?.record_id);
      expect(await userCount(phone.normalized)).toBe(1);
      expect(await sessionCountOf(phone.normalized)).toBe(1);
      const userId = String(dataOf(first).user_id);
      expect(await countRows(app.pool, 'SELECT 1 FROM app.outbox_events WHERE resource_id = $1', [userId])).toBe(1);
      expect(await countRows(app.pool, "SELECT 1 FROM app.audit_logs WHERE action = 'auth.register.v1' AND resource_id = $1", [userId])).toBe(1);
    });
  });

  describe('proof rules (checked under the proof row lock)', () => {
    it('malformed or unknown proof tokens are VERIFICATION_PROOF_INVALID', async () => {
      const phone = randomPhone();
      for (const token of ['', 'short', 'x'.repeat(43) + '=', '!'.repeat(43), randomBytes(32).toString('base64url')]) {
        const response = await register(phone, token, randomUUID());
        expect([token, response.status, errorCode(response)]).toEqual([token, 400, 'VERIFICATION_PROOF_INVALID']);
      }
    });

    it('a proof bound to another phone is VERIFICATION_PROOF_INVALID and stays unconsumed', async () => {
      const proof = await obtainProof(app);
      const other = randomPhone();
      const response = await register(other, proof.proofToken, randomUUID());
      expect([response.status, errorCode(response)]).toEqual([400, 'VERIFICATION_PROOF_INVALID']);
      expect(await userCount(other.normalized)).toBe(0);
      const ok = await register(proof.phone, proof.proofToken, randomUUID());
      expect(ok.status).toBe(201);
    });

    it('an expired proof is VERIFICATION_PROOF_INVALID', async () => {
      const proof = await obtainProof(app);
      await ageProof(app.pool, proof.proofToken, 601);
      const response = await register(proof.phone, proof.proofToken, randomUUID());
      expect([response.status, errorCode(response)]).toEqual([400, 'VERIFICATION_PROOF_INVALID']);
      expect(await userCount(proof.phone.normalized)).toBe(0);
    });

    it('an invalidated proof is VERIFICATION_PROOF_INVALID', async () => {
      const proof = await obtainProof(app);
      await app.pool.query(
        'UPDATE app.verification_proofs SET invalidated_at = clock_timestamp() WHERE phone_normalized = $1',
        [proof.phone.normalized],
      );
      const response = await register(proof.phone, proof.proofToken, randomUUID());
      expect([response.status, errorCode(response)]).toEqual([400, 'VERIFICATION_PROOF_INVALID']);
    });

    it('a proof issued for another purpose is VERIFICATION_PURPOSE_MISMATCH', async () => {
      const proof = await obtainProof(app);
      await app.pool.query("UPDATE app.verification_proofs SET purpose = 'RESET_PASSWORD' WHERE phone_normalized = $1", [
        proof.phone.normalized,
      ]);
      const response = await register(proof.phone, proof.proofToken, randomUUID());
      expect([response.status, errorCode(response)]).toEqual([400, 'VERIFICATION_PURPOSE_MISMATCH']);
      expect(await userCount(proof.phone.normalized)).toBe(0);
    });

    it('a consumed proof with a NEW key is VERIFICATION_PROOF_USED', async () => {
      const user = await registerUser(app);
      const response = await register(user.phone, user.proofToken, randomUUID());
      expect([response.status, errorCode(response)]).toEqual([409, 'VERIFICATION_PROOF_USED']);
      expect(await userCount(user.phone.normalized)).toBe(1);
      expect(await sessionCountOf(user.phone.normalized)).toBe(1);
    });
  });

  describe('idempotent replay (ADR-003 13.2)', () => {
    it('same key and same request: exact replay, the callback does not run again, no new token', async () => {
      const user = await registerUser(app);
      const replay = await register(user.phone, user.proofToken, user.key);

      expect(replay.status).toBe(201);
      expect(replay.body).toEqual(user.response.body); // byte-for-byte the same logical response
      expect(await userCount(user.phone.normalized)).toBe(1);
      expect(await sessionCountOf(user.phone.normalized)).toBe(1);
      expect(await countRows(app.pool, "SELECT 1 FROM app.outbox_events WHERE resource_id = $1", [user.userId])).toBe(1);
      expect(await countRows(app.pool, "SELECT 1 FROM app.audit_logs WHERE action = 'auth.register.v1' AND resource_id = $1", [user.userId])).toBe(1);
      // The replayed token is the original one, and it still authenticates.
      const me = await app.call('GET', '/auth/me', { bearer: String(dataOf(replay).access_token) });
      expect(me.status).toBe(200);
    });

    it('a lost first response is recovered by retrying (same behaviour as a replay, after a consumed proof)', async () => {
      const phone = randomPhone();
      const proof = await obtainProof(app, phone);
      const key = randomUUID();
      const first = await register(phone, proof.proofToken, key);
      expect(first.status).toBe(201);
      // the client "never saw" the response; it retries
      const retry = await register(phone, proof.proofToken, key);
      expect(retry.status).toBe(201);
      expect(dataOf(retry).access_token).toBe(dataOf(first).access_token);
      expect(await userCount(phone.normalized)).toBe(1);
    });

    it('natural expiry of the proof after commit does not deny the replay', async () => {
      const user = await registerUser(app);
      await ageProof(app.pool, user.proofToken, 100_000);
      const replay = await register(user.phone, user.proofToken, user.key);
      expect(replay.status).toBe(201);
      expect(dataOf(replay).access_token).toBe(user.accessToken);
    });

    it('the same key with a changed password, device or phone is IDEMPOTENCY_KEY_REUSED', async () => {
      const user = await registerUser(app);
      const changes: Array<[string, Parameters<typeof register>[3], { local: string }]> = [
        ['password', { password: OTHER_PASSWORD }, user.phone],
        ['device id', { device: { ...DEVICE, device_id: 'another-device' } }, user.phone],
        ['device platform', { device: { ...DEVICE, platform: 'IOS' } }, user.phone],
        ['device app', { device: { ...DEVICE, app: 'OTHER_APP' } }, user.phone],
        ['phone', {}, { local: user.phone.international }],
      ];
      for (const [label, overrides, phone] of changes) {
        const response = await register(phone, user.proofToken, user.key, overrides);
        if (label === 'phone') {
          // 84XXXXXXXXX normalizes to the same phone: it is the SAME logical request, so it replays.
          expect([label, response.status]).toEqual([label, 201]);
        } else {
          expect([label, response.status, errorCode(response)]).toEqual([label, 409, 'IDEMPOTENCY_KEY_REUSED']);
        }
      }
      const otherPhone = randomPhone();
      const different = await register(otherPhone, user.proofToken, user.key);
      expect([different.status, errorCode(different)]).toEqual([409, 'IDEMPOTENCY_KEY_REUSED']);
      expect(await userCount(otherPhone.normalized)).toBe(0);
    });

    it('a revoked session denies the replay with SESSION_REVOKED and discloses nothing', async () => {
      const user = await registerUser(app);
      await app.pool.query('UPDATE app.sessions SET revoked_at = clock_timestamp() WHERE user_id = $1::uuid', [user.userId]);
      const replay = await register(user.phone, user.proofToken, user.key);
      expect([replay.status, errorCode(replay)]).toEqual([401, 'SESSION_REVOKED']);
      expect(replay.text).not.toContain(user.accessToken);
    });

    it('an expired session denies the replay with SESSION_EXPIRED', async () => {
      const user = await registerUser(app);
      const sessionId = await sessionIdOfToken(app.pool, user.accessToken);
      await app.pool.query(
        `UPDATE app.sessions SET created_at = created_at - interval '2 days', updated_at = updated_at - interval '2 days',
                expires_at = clock_timestamp() - interval '1 second' WHERE session_id = $1::uuid`,
        [sessionId],
      );
      const replay = await register(user.phone, user.proofToken, user.key);
      expect([replay.status, errorCode(replay)]).toEqual([401, 'SESSION_EXPIRED']);
    });

    it('a disabled user denies the replay with ACCOUNT_DISABLED', async () => {
      const user = await registerUser(app);
      await app.pool.query("UPDATE app.users SET status = 'DISABLED' WHERE user_id = $1::uuid", [user.userId]);
      const replay = await register(user.phone, user.proofToken, user.key);
      expect([replay.status, errorCode(replay)]).toEqual([403, 'ACCOUNT_DISABLED']);
      expect(replay.text).not.toContain(user.accessToken);
    });

    it('an invalidated proof denies the replay with VERIFICATION_PROOF_INVALID', async () => {
      const user = await registerUser(app);
      await app.pool.query(
        'UPDATE app.verification_proofs SET invalidated_at = clock_timestamp() WHERE phone_normalized = $1',
        [user.phone.normalized],
      );
      const replay = await register(user.phone, user.proofToken, user.key);
      expect([replay.status, errorCode(replay)]).toEqual([400, 'VERIFICATION_PROOF_INVALID']);
    });

    it('an elapsed replay window is IDEMPOTENCY_REPLAY_EXPIRED and mutates nothing', async () => {
      const user = await registerUser(app);
      const proofId = await proofIdOfToken(app.pool, user.proofToken);
      await ageRegisterRecord(app.pool, proofId, 'replay');
      const replay = await register(user.phone, user.proofToken, user.key);
      expect([replay.status, errorCode(replay)]).toEqual([409, 'IDEMPOTENCY_REPLAY_EXPIRED']);
      expect(await userCount(user.phone.normalized)).toBe(1);
      expect(await sessionCountOf(user.phone.normalized)).toBe(1);
      expect(await registerRecordsOf(app.pool, proofId)).toHaveLength(1); // the tombstone stays
    });

    it('after the dedupe window the business invariants still hold: proof used, one user', async () => {
      const user = await registerUser(app);
      const proofId = await proofIdOfToken(app.pool, user.proofToken);
      await ageRegisterRecord(app.pool, proofId, 'dedupe');
      const again = await register(user.phone, user.proofToken, user.key);
      expect([again.status, errorCode(again)]).toEqual([409, 'VERIFICATION_PROOF_USED']);
      expect(await userCount(user.phone.normalized)).toBe(1);
      expect(await sessionCountOf(user.phone.normalized)).toBe(1);
    });

    it('key rotation: a record written under k1 still replays when k2 is the active key', async () => {
      const user = await registerUser(app);
      const rotated = await startAuthApp({}, { activeKeyId: 'k2' });
      try {
        const replay = await api(rotated.running.baseUrl, 'POST', '/auth/register', {
          headers: { 'idempotency-key': user.key },
          body: registerBody(user.phone, user.proofToken),
        });
        expect(replay.status).toBe(201);
        expect(dataOf(replay).access_token).toBe(user.accessToken);
      } finally {
        await rotated.close();
      }
    });
  });

  describe('concurrency (deterministic barriers)', () => {
    const STALL_KEY = [910_001, 910_002] as const;
    let slow: AuthApp;

    beforeAll(async () => {
      slow = await startAuthApp({}, { relaxTimeouts: true });
    });

    afterAll(async () => {
      await slow.close();
    });

    async function withAuditStall<T>(run: (waitForStall: () => Promise<void>, release: () => Promise<void>) => Promise<T>): Promise<T> {
      await removeRegisterAuditStall(app.pool);
      await installRegisterAuditStall(app.pool, STALL_KEY);
      const holder = await LockHolder.begin(app.pool);
      await holder.query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [STALL_KEY[0], STALL_KEY[1]]);
      let released = false;
      const release = async (): Promise<void> => {
        if (!released) {
          released = true;
          await holder.commit();
        }
      };
      try {
        return await run(
          () => eventually(() => advisoryWaiterExists(app.pool, STALL_KEY), 'a register is stalled at its audit insert'),
          release,
        );
      } finally {
        await release();
        await removeRegisterAuditStall(app.pool);
      }
    }

    it('same proof + different keys at once: one register wins, the loser sees VERIFICATION_PROOF_USED', async () => {
      const phone = randomPhone();
      const proof = await obtainProof(slow, phone);
      await withAuditStall(async (waitForStall, release) => {
        const winner = register(phone, proof.proofToken, randomUUID(), {}, slow);
        await waitForStall(); // the winner holds the proof row lock and an uncommitted user
        const waiters = await transactionWaiters(app.pool);
        const loser = register(phone, proof.proofToken, randomUUID(), {}, slow);
        await eventually(async () => (await transactionWaiters(app.pool)) > waiters, 'the second register waits on the proof row');
        await release();
        const [first, second] = await Promise.all([winner, loser]);
        expect(first.status).toBe(201);
        expect([second.status, errorCode(second)]).toEqual([409, 'VERIFICATION_PROOF_USED']);
      });
      expect(await userCount(phone.normalized)).toBe(1);
      expect(await sessionCountOf(phone.normalized)).toBe(1);
      expect(await countRows(app.pool, 'SELECT 1 FROM app.verification_proofs WHERE phone_normalized = $1 AND consumed_at IS NOT NULL', [phone.normalized])).toBe(1);
    });

    it('two valid proofs for the same phone + different keys: one user, the loser is PHONE_ALREADY_REGISTERED', async () => {
      const phone = randomPhone();
      const first = await obtainProof(slow, phone);
      // A second OTP for the same phone becomes possible after the cooldown; the first proof stays valid.
      await app.pool.query(
        `UPDATE app.phone_verifications
            SET created_at = created_at - interval '1 hour', expires_at = expires_at - interval '1 hour',
                resend_not_before = resend_not_before - interval '1 hour', verified_at = verified_at - interval '1 hour'
          WHERE phone_normalized = $1`,
        [phone.normalized],
      );
      const second = await obtainProof(slow, phone);
      expect(second.proofToken).not.toBe(first.proofToken);

      await withAuditStall(async (waitForStall, release) => {
        const winner = register(phone, first.proofToken, randomUUID(), {}, slow);
        await waitForStall(); // the winner inserted its user (uncommitted) and is stalled before commit
        const waiters = await transactionWaiters(app.pool);
        const loser = register(phone, second.proofToken, randomUUID(), {}, slow);
        await eventually(async () => (await transactionWaiters(app.pool)) > waiters, 'the second register waits on the unique phone');
        await release();
        const [a, b] = await Promise.all([winner, loser]);
        expect(a.status).toBe(201);
        expect([b.status, errorCode(b)]).toEqual([409, 'PHONE_ALREADY_REGISTERED']);
        expect(b.text).not.toMatch(/duplicate|constraint|users_phone/i); // no SQL detail leaks
      });
      expect(await userCount(phone.normalized)).toBe(1);
      expect(await sessionCountOf(phone.normalized)).toBe(1);
      // The loser's proof was NOT consumed (its transaction rolled back as a whole).
      expect(await countRows(app.pool, 'SELECT 1 FROM app.verification_proofs WHERE phone_normalized = $1 AND consumed_at IS NOT NULL', [phone.normalized])).toBe(1);
    });

    it('the same key + same request at once: one execution, the other replays or is told it is busy', async () => {
      const phone = randomPhone();
      const proof = await obtainProof(slow, phone);
      const key = randomUUID();
      const results = await Promise.all([
        register(phone, proof.proofToken, key, {}, slow),
        register(phone, proof.proofToken, key, {}, slow),
      ]);
      for (const response of results) {
        expect([201, 409]).toContain(response.status);
        if (response.status === 409) {
          expect(errorCode(response)).toBe('IDEMPOTENCY_BUSY');
        }
      }
      expect(results.some((r) => r.status === 201)).toBe(true);
      expect(await userCount(phone.normalized)).toBe(1);
      expect(await sessionCountOf(phone.normalized)).toBe(1);
    });
  });

  describe('atomicity: a failure at any persistence step leaves nothing behind', () => {
    interface Fault {
      readonly name: string;
      readonly table: string;
      readonly events: 'INSERT' | 'UPDATE';
      readonly condition: (marker: { phone: string; device: string }) => string;
    }

    const faults: Fault[] = [
      { name: 'test_fault_user', table: 'app.users', events: 'INSERT', condition: (m) => `NEW.phone_normalized = '${m.phone}'` },
      {
        name: 'test_fault_proof',
        table: 'app.verification_proofs',
        events: 'UPDATE',
        condition: (m) => `NEW.phone_normalized = '${m.phone}' AND NEW.consumed_at IS NOT NULL`,
      },
      { name: 'test_fault_session', table: 'app.sessions', events: 'INSERT', condition: (m) => `NEW.device_id = '${m.device}'` },
      { name: 'test_fault_audit', table: 'app.audit_logs', events: 'INSERT', condition: () => "NEW.action = 'auth.register.v1'" },
      { name: 'test_fault_outbox', table: 'app.outbox_events', events: 'INSERT', condition: () => "NEW.event_type = 'auth.user_registered.v1'" },
      {
        name: 'test_fault_idempotency',
        table: 'app.idempotency_records',
        events: 'INSERT',
        condition: () => "NEW.scope_type = 'verification_proof' AND NEW.operation_id = 'auth.register.v1'",
      },
    ];

    for (const fault of faults) {
      it(`fault at ${fault.table} (${fault.events}): no user, session, proof consumption, audit, outbox or record; the retry then succeeds`, async () => {
        const phone = randomPhone();
        const proof = await obtainProof(app, phone);
        const device = `fault-${randomBytes(4).toString('hex')}`;
        const key = randomUUID();
        const proofId = await proofIdOfToken(app.pool, proof.proofToken);
        const outboxBefore = await countRows(app.pool, "SELECT 1 FROM app.outbox_events WHERE event_type = 'auth.user_registered.v1'");

        await installFault(app.pool, fault.name, fault.table, fault.events, fault.condition({ phone: phone.normalized, device }));
        let failed;
        try {
          failed = await register(phone, proof.proofToken, key, { device: { ...DEVICE, device_id: device } });
        } finally {
          await removeFault(app.pool, fault.name, fault.table);
        }

        expect(failed.status).toBeGreaterThanOrEqual(500);
        expect(failed.text).not.toContain('injected fault');
        expect(await userCount(phone.normalized)).toBe(0);
        expect(await countRows(app.pool, 'SELECT 1 FROM app.sessions WHERE device_id = $1', [device])).toBe(0);
        expect(await countRows(app.pool, 'SELECT 1 FROM app.verification_proofs WHERE phone_normalized = $1 AND consumed_at IS NOT NULL', [phone.normalized])).toBe(0);
        expect(await countRows(app.pool, "SELECT 1 FROM app.audit_logs WHERE request_id = $1::uuid AND action = 'auth.register.v1'", [failed.requestId])).toBe(0);
        expect(await countRows(app.pool, "SELECT 1 FROM app.outbox_events WHERE event_type = 'auth.user_registered.v1'")).toBe(outboxBefore);
        expect(await registerRecordsOf(app.pool, proofId)).toHaveLength(0);

        // Nothing was consumed: the same key and the same request now succeed.
        const retry = await register(phone, proof.proofToken, key, { device: { ...DEVICE, device_id: device } });
        expect(retry.status).toBe(201);
        expect(await userCount(phone.normalized)).toBe(1);
      });
    }
  });

  describe('privacy: no secret is stored or logged in plaintext', () => {
    it('keeps the password, OTP, proof token and access token out of every table and out of the logs', async () => {
      const secretPassword = `Marker-Pw-${randomBytes(6).toString('hex')}!`;
      const phone = randomPhone();
      app.track(phone.normalized);
      const requested = await app.call('POST', '/auth/phone-verifications', { body: { phone: phone.local, purpose: 'REGISTER' } });
      const verificationId = String(dataOf(requested).verification_id);
      const otp = app.provider.lastOtpFor(phone.normalized) as string;
      const verified = await app.call('POST', `/auth/phone-verifications/${verificationId}/verify`, { body: { otp } });
      const proofToken = String(dataOf(verified).verification_token);
      const key = randomUUID();
      const registered = await register(phone, proofToken, key, { password: secretPassword });
      expect(registered.status).toBe(201);
      const accessToken = String(dataOf(registered).access_token);
      const userId = String(dataOf(registered).user_id);
      // a login too, and a replay, so those paths are covered
      await app.call('POST', '/auth/login', { body: { phone: phone.local, password: secretPassword, device: { ...DEVICE } } });
      await register(phone, proofToken, key, { password: secretPassword });

      const dumps = await Promise.all(
        [
          'SELECT t::text AS dump FROM app.users t WHERE phone_normalized = $1',
          'SELECT t::text AS dump FROM app.phone_verifications t WHERE phone_normalized = $1',
          'SELECT t::text AS dump FROM app.verification_proofs t WHERE phone_normalized = $1',
          'SELECT s::text AS dump FROM app.sessions s JOIN app.users u USING (user_id) WHERE u.phone_normalized = $1',
          `SELECT a::text AS dump FROM app.audit_logs a WHERE a.actor_id = (SELECT user_id::text FROM app.users WHERE phone_normalized = $1)`,
          `SELECT o::text AS dump FROM app.outbox_events o WHERE o.resource_id = (SELECT user_id::text FROM app.users WHERE phone_normalized = $1)`,
          `SELECT r::text AS dump FROM app.idempotency_records r WHERE r.scope_type = 'verification_proof'
              AND r.scope_id IN (SELECT proof_id::text FROM app.verification_proofs WHERE phone_normalized = $1)`,
        ].map(async (sql) => (await app.pool.query<{ dump: string }>(sql, [phone.normalized])).rows.map((row) => row.dump).join('\n')),
      );
      const everything = `${dumps.join('\n')}\n${app.running.logs.join('\n')}`;
      for (const [label, secret] of [
        ['password', secretPassword],
        ['otp', otp],
        ['proof token', proofToken],
        ['access token', accessToken],
      ] as const) {
        // A six-digit OTP can appear by chance inside a uuid or timestamp; search it as a quoted value only.
        const needle = label === 'otp' ? `"${secret}"` : secret;
        expect([label, everything.includes(needle)]).toEqual([label, false]);
      }
      expect(userId).toMatch(/^[0-9a-f-]{36}$/);
      expect(everything).not.toMatch(/authorization/i);
    });

    it('a user granted a role later is not influenced by register input (roleless at creation)', async () => {
      const user = await registerUser(app);
      expect(await countRows(app.pool, 'SELECT 1 FROM app.user_roles WHERE user_id = $1::uuid', [user.userId])).toBe(0);
      await grantRole(app.pool, user.userId, 'SHOP');
      const me = await app.call('GET', '/auth/me', { bearer: user.accessToken });
      expect(dataOf(me).available_roles).toEqual(['SHOP']);
      expect(PASSWORD).toBeDefined();
    });
  });
});
