import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { base32Decode } from '../../apps/backend/src/admin-auth/base32';
import { hotp } from '../../apps/backend/src/admin-auth/totp';
import { canonicalPayload, parseOperationBody } from '../../apps/backend/src/admin-provisioning/admin-provisioning-validation';
import { fixtureKeyring } from '../../apps/backend/src/crypto/test-keys.fixture';
import {
  AdminApp,
  adminErrorCode,
  count,
  loginStep,
  preauthCookies,
  startAdminApp,
  wrongCode,
} from './support/admin-fixtures';
import { holdRowLock, waitForBlockedBackends, waitUntilDbClockPast } from './support/lock-fixtures';
import {
  api,
  createOperation,
  createPayload,
  operationRow,
  sessionOf,
  stepUp,
  SystemSession,
  systemSession,
  totpBucketFailures,
  verifyOperation,
} from './support/provisioning-fixtures';

// M01-D-ADMIN-1B step-up (contract 7.4, F6). A counter moves ONLY when a TOTP code was really compared and wrong; then
// the bucket (shared with login, Q5), attempt_count and the DENIED audit are COMMITTED before the error is returned.
// A locked bucket, an unusable/expired operation or a malformed body counts nothing and opens no secret. INVALIDATED is
// stored only for REPLACED and ATTEMPTS_EXHAUSTED; every other refusal leaves the stored row unchanged. Expiry is decided
// with the database clock read after the last lock (the test holds a lock while the deadline passes).

describe('M01-D-ADMIN-1B - step-up counters, commit-then-throw and expiry after locks', () => {
  let app: AdminApp;
  let system: SystemSession;

  beforeAll(async () => {
    app = await startAdminApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.clearLimits();
    system = await systemSession(app);
  });

  async function verifyWith(operationId: string, code: string) {
    return api(app, 'POST', `/operations/${operationId}/verify`, { body: { code }, ...sessionOf(system) });
  }

  async function deniedAudits(operationId: string): Promise<Array<{ reason_code: string; metadata: Record<string, unknown> }>> {
    const rows = await app.pool.query<{ reason_code: string; metadata: Record<string, unknown> }>(
      `SELECT reason_code, metadata FROM app.audit_logs
        WHERE action = 'admin_invitation.operation_verify_denied.v1' AND resource_id = $1 ORDER BY occurred_at, audit_id`,
      [operationId],
    );
    return rows.rows;
  }

  it('a wrong code is counted and COMMITTED (bucket, attempt_count, DENIED audit) before 400 is returned', async () => {
    const operationId = await createOperation(app, system, 'CREATE_INVITATION', createPayload());
    const response = await verifyWith(operationId, wrongCode(system.login.secret));
    expect(response.status).toBe(400);
    expect(adminErrorCode(response)).toBe('ADMIN_TOTP_INVALID');
    expect(await operationRow(app.pool, operationId)).toMatchObject({ status: 'PENDING', attempt_count: 1 });
    expect(await totpBucketFailures(app.pool)).toBe(1);
    const audits = await deniedAudits(operationId);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ reason_code: 'TOTP_INVALID', metadata: { operation_id: operationId, attempt_count: 1 } });
  });

  it('the fifth wrong code INVALIDATES the operation (ATTEMPTS_EXHAUSTED) and locks the bucket shared with login (Q5)', async () => {
    const operationId = await createOperation(app, system, 'CREATE_INVITATION', createPayload());
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      expect((await verifyWith(operationId, wrongCode(system.login.secret))).status).toBe(400);
    }
    const fifth = await verifyWith(operationId, wrongCode(system.login.secret));
    expect(fifth.status).toBe(429);
    expect(adminErrorCode(fifth)).toBe('ADMIN_AUTH_RATE_LIMITED');
    expect(Number(fifth.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(await operationRow(app.pool, operationId)).toMatchObject({
      status: 'INVALIDATED',
      attempt_count: 5,
      invalidated_reason: 'ATTEMPTS_EXHAUSTED',
    });
    expect((await deniedAudits(operationId)).map((row) => row.reason_code)).toEqual([
      'TOTP_INVALID',
      'TOTP_INVALID',
      'TOTP_INVALID',
      'TOTP_INVALID',
      'ATTEMPTS_EXHAUSTED',
    ]);
    expect(await totpBucketFailures(app.pool)).toBe(5);

    // The bucket is locked: a NEW operation with the RIGHT code is refused before anything is compared or counted.
    const next = await createOperation(app, system, 'CREATE_INVITATION', createPayload());
    const locked = await verifyOperation(app, system, next);
    expect(locked.status).toBe(429);
    expect(await operationRow(app.pool, next)).toMatchObject({ status: 'PENDING', attempt_count: 0 });
    expect(await totpBucketFailures(app.pool)).toBe(5);
    expect(await deniedAudits(next)).toHaveLength(0);

    // Q5: the same bucket guards the login TOTP step.
    const preauth = await loginStep(app, system.account);
    const login = await app.call('POST', '/totp/verify', { body: { code: '000000' }, cookies: preauthCookies(preauth), csrf: preauth.csrf });
    expect(login.status).toBe(429);
  });

  it('the code that was just accepted (login) is compared, refused and counted', async () => {
    const operationId = await createOperation(app, system, 'CREATE_INVITATION', createPayload());
    const factor = await app.pool.query<{ last_accepted_step: string }>(
      'SELECT last_accepted_step::text FROM app.admin_totp_factors WHERE user_id = $1::uuid',
      [system.account.userId],
    );
    const secret = base32Decode(system.login.secret) as Buffer;
    const used = hotp(secret, Number(factor.rows[0]?.last_accepted_step));
    const response = await verifyWith(operationId, used);
    expect(response.status).toBe(400);
    expect(adminErrorCode(response)).toBe('ADMIN_TOTP_INVALID');
    expect((await operationRow(app.pool, operationId))?.attempt_count).toBe(1);
  });

  it('counts nothing for an unknown, consumed, replaced or already verified operation (refused before any comparison)', async () => {
    const unknown = await verifyWith(randomUUID(), wrongCode(system.login.secret));
    expect(unknown.status).toBe(403);
    expect(adminErrorCode(unknown)).toBe('ADMIN_STEP_UP_REQUIRED');

    const replaced = await createOperation(app, system, 'CREATE_INVITATION', createPayload());
    const current = await createOperation(app, system, 'CREATE_INVITATION', createPayload());
    expect(await operationRow(app.pool, replaced)).toMatchObject({ status: 'INVALIDATED', invalidated_reason: 'REPLACED' });
    const onReplaced = await verifyWith(replaced, wrongCode(system.login.secret));
    expect(onReplaced.status).toBe(403);
    expect((await verifyOperation(app, system, current)).status).toBe(200);
    const onVerified = await verifyWith(current, wrongCode(system.login.secret));
    expect(onVerified.status).toBe(403);
    expect(adminErrorCode(onVerified)).toBe('ADMIN_STEP_UP_REQUIRED');

    expect(await operationRow(app.pool, replaced)).toMatchObject({ attempt_count: 0 });
    expect(await operationRow(app.pool, current)).toMatchObject({ status: 'VERIFIED', attempt_count: 0 });
    expect(await totpBucketFailures(app.pool)).toBe(0);
    expect(await count(app.pool, "SELECT 1 FROM app.audit_logs WHERE action = 'admin_invitation.operation_verify_denied.v1' AND actor_id = $1", [system.account.userId])).toBe(0);
  });

  // ----- expiry after locks ------------------------------------------------------------------------------------------

  async function currentBinding(): Promise<{ session_id: string; factor_id: string; factor_version: string; membership_version: string }> {
    const rows = await app.pool.query<{ session_id: string; factor_id: string; factor_version: string; membership_version: string }>(
      `SELECT session_id, factor_id, factor_version::text, membership_version::text FROM app.admin_sessions
        WHERE user_id = $1::uuid AND revoked_at IS NULL`,
      [system.account.userId],
    );
    const row = rows.rows[0];
    if (row === undefined) {
      throw new Error('no live session');
    }
    return row;
  }

  /** An operation written directly with only `secondsLeft` of its 120 s left (created_at is immutable, so chosen now). */
  async function nearlyExpiredOperation(status: 'PENDING' | 'VERIFIED', fingerprint: string, secondsLeft: number): Promise<string> {
    const binding = await currentBinding();
    const operationId = randomUUID();
    await app.pool.query(
      `INSERT INTO app.admin_sensitive_operations (operation_id, actor_user_id, actor_session_id, factor_id, factor_version,
         membership_version, action, payload_fingerprint, fingerprint_key_id, status, attempt_count, created_at, expires_at, verified_at)
       SELECT $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::bigint, $6::bigint, 'CREATE_INVITATION', $7::text, 'k1', $8::text, 0,
              c.t - make_interval(secs => 120 - $9::int), c.t + make_interval(secs => $9::int),
              CASE WHEN $8::text = 'VERIFIED' THEN c.t - make_interval(secs => 119 - $9::int) END
         FROM (SELECT date_trunc('milliseconds', clock_timestamp()) AS t) c`,
      [operationId, system.account.userId, binding.session_id, binding.factor_id, binding.factor_version, binding.membership_version, fingerprint, status, secondsLeft],
    );
    return operationId;
  }

  async function expiryOf(operationId: string): Promise<void> {
    await waitUntilDbClockPast(app.pool, 'SELECT expires_at FROM app.admin_sensitive_operations WHERE operation_id = $1::uuid', [operationId]);
  }

  it('verify: an operation that expires while the request waits for the user lock is refused, nothing counted', async () => {
    const operationId = await nearlyExpiredOperation('PENDING', 'a'.repeat(64), 3);
    const held = await holdRowLock(app.pool, 'SELECT 1 FROM app.users WHERE user_id = $1::uuid FOR UPDATE', [system.account.userId]);
    try {
      const pending = verifyOperation(app, system, operationId);
      await waitForBlockedBackends(app.pool);
      await expiryOf(operationId);
      await held.release();
      const response = await pending;
      expect(response.status).toBe(403);
      expect(adminErrorCode(response)).toBe('ADMIN_STEP_UP_REQUIRED');
    } finally {
      await held.release();
    }
    expect(await operationRow(app.pool, operationId)).toMatchObject({ status: 'PENDING', attempt_count: 0 });
    expect(await totpBucketFailures(app.pool)).toBe(0);
  });

  it('create: a VERIFIED operation that expires while the mutation waits for the user lock is not consumed; nothing is created', async () => {
    const body = { action: 'CREATE_INVITATION', payload: createPayload() };
    const request = parseOperationBody(body);
    const fingerprint = fixtureKeyring('k1').active().adminOperationFingerprint('CREATE_INVITATION', canonicalPayload(request));
    const operationId = await nearlyExpiredOperation('VERIFIED', fingerprint, 3);
    const key = randomUUID();
    const held = await holdRowLock(app.pool, 'SELECT 1 FROM app.users WHERE user_id = $1::uuid FOR UPDATE', [system.account.userId]);
    try {
      const pending = api(app, 'POST', '/invitations', {
        body: { operation_id: operationId, ...body.payload },
        headers: { 'idempotency-key': key },
        ...sessionOf(system),
      });
      await waitForBlockedBackends(app.pool);
      await expiryOf(operationId);
      await held.release();
      const response = await pending;
      expect(response.status).toBe(403);
      expect(adminErrorCode(response)).toBe('ADMIN_STEP_UP_REQUIRED');
    } finally {
      await held.release();
    }
    expect((await operationRow(app.pool, operationId))?.status).toBe('VERIFIED');
    expect(await count(app.pool, 'SELECT 1 FROM app.admin_invitations')).toBe(0);
    expect(await count(app.pool, 'SELECT 1 FROM app.idempotency_records WHERE idempotency_key = $1', [key])).toBe(0);
  });

  it('a session that expires while a GET waits for the user lock is refused (401)', async () => {
    await app.pool.query(
      `UPDATE app.admin_sessions SET expires_at = date_trunc('milliseconds', clock_timestamp()) + interval '3 seconds'
        WHERE user_id = $1::uuid AND revoked_at IS NULL`,
      [system.account.userId],
    );
    const held = await holdRowLock(app.pool, 'SELECT 1 FROM app.users WHERE user_id = $1::uuid FOR UPDATE', [system.account.userId]);
    try {
      const pending = api(app, 'GET', '/invitations', { cookies: sessionOf(system).cookies });
      await waitForBlockedBackends(app.pool);
      await waitUntilDbClockPast(
        app.pool,
        'SELECT expires_at FROM app.admin_sessions WHERE user_id = $1::uuid AND revoked_at IS NULL',
        [system.account.userId],
      );
      await held.release();
      const response = await pending;
      expect(response.status).toBe(401);
      expect(adminErrorCode(response)).toBe('ADMIN_SESSION_INVALID');
    } finally {
      await held.release();
    }
  });

  it('a mutation with a verified operation consumes it exactly once (CONSUMED), and it cannot be used again', async () => {
    const payload = createPayload();
    const operationId = await stepUp(app, system, 'CREATE_INVITATION', payload);
    const first = await api(app, 'POST', '/invitations', {
      body: { operation_id: operationId, ...payload },
      headers: { 'idempotency-key': randomUUID() },
      ...sessionOf(system),
    });
    expect(first.status).toBe(201);
    const second = await api(app, 'POST', '/invitations', {
      body: { operation_id: operationId, ...payload, phone: payload.phone },
      headers: { 'idempotency-key': randomUUID() },
      ...sessionOf(system),
    });
    expect(second.status).toBe(403);
    expect(adminErrorCode(second)).toBe('ADMIN_STEP_UP_REQUIRED');
    expect((await operationRow(app.pool, operationId))?.status).toBe('CONSUMED');
  });
});
