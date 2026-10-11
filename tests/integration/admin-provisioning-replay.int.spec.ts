import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { parseCreateInvitationBody } from '../../apps/backend/src/admin-provisioning/admin-provisioning-validation';
import { AppError, TechnicalError } from '../../apps/backend/src/common/app-errors';
import { Keyring } from '../../apps/backend/src/crypto/keyring';
import { FIXTURE_MASTER_K1, FIXTURE_MASTER_K2, fixtureKeyring } from '../../apps/backend/src/crypto/test-keys.fixture';
import { poolClientSource } from '../../apps/backend/src/transaction/pg-client-source';
import { AdminApp, adminData, adminErrorCode, count, startAdminApp } from './support/admin-fixtures';
import { failureOf } from './support/async-helpers';
import { randomPhone } from './support/auth-fixtures';
import { waitUntilDbClockPast } from './support/lock-fixtures';
import {
  api,
  createInvitation,
  createOperation,
  createPayload,
  directServices,
  insertRawInvitation,
  invitationRow,
  operationRow,
  relogin,
  sessionOf,
  stepUp,
  SystemSession,
  systemSession,
  verifyOperation,
} from './support/provisioning-fixtures';
import { faultySource } from './support/transaction-fixtures';

// M01-D-ADMIN-1B idempotency and replay (contract section 9, F2). Replay window 900 s, dedupe 86400 s. A replay never
// consumes an operation and never needs a new code; it is authorized under shared locks BEFORE anything is decrypted:
// the current session must be a live SYSTEM session of the same actor and, for create/reissue, the invitation behind the
// stored link must still be PENDING and before its expires_at. Corrupting the stored ciphertext proves the order: a
// refused replay answers with the authorization error, never with a crypto failure.

describe('M01-D-ADMIN-1B - idempotency, replay before decryption, unknown COMMIT and fail-closed keys', () => {
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

  async function postCreate(session: SystemSession, body: Record<string, unknown>, key: string) {
    return api(app, 'POST', '/invitations', { body, headers: { 'idempotency-key': key }, ...sessionOf(session) });
  }

  async function corruptCiphertext(key: string): Promise<void> {
    const updated = await app.pool.query(
      "UPDATE app.idempotency_records SET replay_ciphertext = decode('00ff00ff', 'hex') WHERE idempotency_key = $1",
      [key],
    );
    expect(updated.rowCount).toBe(1);
  }

  async function revokeDirectly(invitationId: string): Promise<void> {
    await app.pool.query(
      "UPDATE app.admin_invitations SET status = 'REVOKED', version = version + 1, terminal_at = now() WHERE invitation_id = $1::uuid",
      [invitationId],
    );
  }

  async function createdWithKey(): Promise<{ key: string; body: Record<string, unknown>; first: Awaited<ReturnType<typeof api>> }> {
    const payload = createPayload();
    const operationId = await stepUp(app, system, 'CREATE_INVITATION', payload);
    const key = randomUUID();
    const body = { operation_id: operationId, ...payload };
    const first = await postCreate(system, body, key);
    expect(first.status).toBe(201);
    return { key, body, first };
  }

  it('same key + same body replays the SAME result (same link), creates nothing new and needs no new code', async () => {
    const { key, body, first } = await createdWithKey();
    const again = await postCreate(system, body, key);
    expect(again.status).toBe(201);
    expect(again.body.data).toEqual(first.body.data);
    expect(await count(app.pool, 'SELECT 1 FROM app.admin_invitations')).toBe(1);
    expect(await count(app.pool, "SELECT 1 FROM app.audit_logs WHERE action = 'admin_invitation.created.v1' AND actor_id = $1", [system.account.userId])).toBe(1);
  });

  it('same key + a different body is IDEMPOTENCY_KEY_REUSED', async () => {
    const { key, body } = await createdWithKey();
    const reused = await postCreate(system, { ...body, note: 'khác' }, key);
    expect(reused.status).toBe(409);
    expect(adminErrorCode(reused)).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('after the replay window the link is never shown again (IDEMPOTENCY_REPLAY_EXPIRED)', async () => {
    const { key, body } = await createdWithKey();
    await app.pool.query(
      "UPDATE app.idempotency_records SET replay_expires_at = created_at + interval '1 second' WHERE idempotency_key = $1",
      [key],
    );
    await waitUntilDbClockPast(app.pool, 'SELECT replay_expires_at FROM app.idempotency_records WHERE idempotency_key = $1', [key]);
    const expired = await postCreate(system, body, key);
    expect(expired.status).toBe(409);
    expect(adminErrorCode(expired)).toBe('IDEMPOTENCY_REPLAY_EXPIRED');
  });

  it('a new session of the same SYSTEM may replay; the revoked old session may not (refused before decryption)', async () => {
    const { key, body, first } = await createdWithKey();
    await app.clearLimits();
    const second = await relogin(app, system);
    const replayed = await postCreate(second, body, key);
    expect(replayed.status).toBe(201);
    expect(replayed.body.data).toEqual(first.body.data);

    await corruptCiphertext(key);
    const old = await postCreate(system, body, key);
    expect(old.status).toBe(401);
    expect(adminErrorCode(old)).toBe('ADMIN_SESSION_INVALID');
  });

  it('a membership that was disabled cannot replay: 401, and the corrupted ciphertext is never touched (no 503)', async () => {
    const { key, body } = await createdWithKey();
    await corruptCiphertext(key);
    await app.pool.query("UPDATE app.admin_memberships SET status = 'DISABLED' WHERE user_id = $1::uuid", [system.account.userId]);
    const refused = await postCreate(system, body, key);
    expect(refused.status).toBe(401);
    expect(adminErrorCode(refused)).toBe('ADMIN_SESSION_INVALID');
  });

  it('create: a replay of an invitation that is no longer PENDING is 409 ADMIN_INVITATION_NOT_REPLAYABLE before decryption', async () => {
    const { key, body, first } = await createdWithKey();
    const invitationId = String((adminData(first).invitation as Record<string, unknown>).invitation_id);
    await corruptCiphertext(key);
    await revokeDirectly(invitationId);
    const refused = await postCreate(system, body, key);
    expect(refused.status).toBe(409);
    expect(adminErrorCode(refused)).toBe('ADMIN_INVITATION_NOT_REPLAYABLE');
  });

  it('create: a replay whose invitation is PENDING but past expires_at is NOT_REPLAYABLE before decryption', async () => {
    const { key, body } = await createdWithKey();
    // expires_at is immutable, so the stored guard is pointed at a PENDING invitation that is already expired. The
    // guard is part of the encryption's associated data: had the payload been decrypted, this would be a crypto failure.
    const expired = await insertRawInvitation(app.pool, { createdBy: system.account.userId, phoneNormalized: randomPhone().normalized, expired: true });
    await app.pool.query(
      `UPDATE app.idempotency_records SET replay_guard = jsonb_set(replay_guard, '{invitation_id}', to_jsonb($2::text))
        WHERE idempotency_key = $1`,
      [key, expired],
    );
    const refused = await postCreate(system, body, key);
    expect(refused.status).toBe(409);
    expect(adminErrorCode(refused)).toBe('ADMIN_INVITATION_NOT_REPLAYABLE');
  });

  it('reissue: replay returns the same successor and link; once the successor is gone it is NOT_REPLAYABLE', async () => {
    const created = await createInvitation(app, system);
    await app.clearLimits();
    const payload = { expected_version: 1, reason: 'mất link' };
    const operationId = await stepUp(app, system, 'REISSUE_INVITATION', { invitation_id: created.invitationId, ...payload });
    const key = randomUUID();
    const send = () =>
      api(app, 'POST', `/invitations/${created.invitationId}/reissue`, {
        body: { operation_id: operationId, ...payload },
        headers: { 'idempotency-key': key },
        ...sessionOf(system),
      });
    const first = await send();
    expect(first.status).toBe(201);
    const again = await send();
    expect(again.status).toBe(201);
    expect(again.body.data).toEqual(first.body.data);
    expect(await count(app.pool, 'SELECT 1 FROM app.admin_invitations')).toBe(2);
    await revokeDirectly(String((adminData(first).invitation as Record<string, unknown>).invitation_id));
    const refused = await send();
    expect(refused.status).toBe(409);
    expect(adminErrorCode(refused)).toBe('ADMIN_INVITATION_NOT_REPLAYABLE');
  });

  it('revoke: replay returns the stored 200 result (there is no link to protect)', async () => {
    const created = await createInvitation(app, system);
    await app.clearLimits();
    const payload = { expected_version: 1, reason: 'r' };
    const operationId = await stepUp(app, system, 'REVOKE_INVITATION', { invitation_id: created.invitationId, ...payload });
    const key = randomUUID();
    const send = () =>
      api(app, 'POST', `/invitations/${created.invitationId}/revoke`, {
        body: { operation_id: operationId, ...payload },
        headers: { 'idempotency-key': key },
        ...sessionOf(system),
      });
    const first = await send();
    expect(first.status).toBe(200);
    const again = await send();
    expect(again.status).toBe(200);
    expect(again.body.data).toEqual(first.body.data);
  });

  it('two requests with the same key at once: one execution, one invitation', async () => {
    const payload = createPayload();
    const operationId = await stepUp(app, system, 'CREATE_INVITATION', payload);
    const key = randomUUID();
    const body = { operation_id: operationId, ...payload };
    const results = await Promise.all([postCreate(system, body, key), postCreate(system, body, key)]);
    for (const result of results) {
      expect([201, 409]).toContain(result.status);
      if (result.status === 409) {
        expect(adminErrorCode(result)).toBe('IDEMPOTENCY_BUSY');
      }
    }
    expect(results.some((result) => result.status === 201)).toBe(true);
    expect(await count(app.pool, 'SELECT 1 FROM app.admin_invitations')).toBe(1);
  });

  it('unknown COMMIT: TRANSACTION_OUTCOME_UNKNOWN, no server retry; the same key afterwards replays the one invitation', async () => {
    const payload = createPayload();
    const operationId = await stepUp(app, system, 'CREATE_INVITATION', payload);
    const key = randomUUID();
    const input = parseCreateInvitationBody({ operation_id: operationId, ...payload });
    let commits = 0;
    const lossy = directServices(app, poolClientSource(app.pool), {
      executorSource: faultySource(app.pool, (text, real) => {
        if (text !== 'COMMIT') {
          return undefined;
        }
        commits += 1;
        // The server commits, the acknowledgement is lost.
        return real.query('COMMIT').then(() => Promise.reject(Object.assign(new Error('injected: ack lost'), { code: 'ECONNRESET' })));
      }),
    });
    const lost = await failureOf(() =>
      lossy.invitations.create(system.login.cookie, system.login.csrf, input, key, { requestId: randomUUID() }),
    );
    expect(lost).toBeInstanceOf(AppError);
    expect((lost as AppError).code).toBe('TRANSACTION_OUTCOME_UNKNOWN');
    expect(commits).toBe(1);
    expect(await count(app.pool, 'SELECT 1 FROM app.admin_invitations')).toBe(1);
    expect((await operationRow(app.pool, operationId))?.status).toBe('CONSUMED');

    const retried = await postCreate(system, { operation_id: operationId, ...payload }, key);
    expect(retried.status).toBe(201);
    const invitationId = String((adminData(retried).invitation as Record<string, unknown>).invitation_id);
    expect(await invitationRow(app.pool, invitationId)).toMatchObject({ status: 'PENDING', version: '1' });
    expect(await count(app.pool, 'SELECT 1 FROM app.admin_invitations')).toBe(1);
  });

  it('an audit failure rolls everything back: no invitation, the operation stays VERIFIED, the key is not consumed', async () => {
    const payload = createPayload();
    const operationId = await stepUp(app, system, 'CREATE_INVITATION', payload);
    const existing = await app.pool.query<{ audit_id: string }>('SELECT audit_id::text FROM app.audit_logs ORDER BY occurred_at DESC LIMIT 1');
    const collidingId = existing.rows[0]?.audit_id as string;
    const broken = directServices(app, poolClientSource(app.pool), { audit: { idGenerator: () => collidingId } });
    const key = randomUUID();
    const input = parseCreateInvitationBody({ operation_id: operationId, ...payload });
    const failure = await failureOf(() => broken.invitations.create(system.login.cookie, system.login.csrf, input, key, { requestId: randomUUID() }));
    expect(failure).toBeDefined();
    expect(await count(app.pool, 'SELECT 1 FROM app.admin_invitations')).toBe(0);
    expect((await operationRow(app.pool, operationId))?.status).toBe('VERIFIED');
    expect(await count(app.pool, 'SELECT 1 FROM app.idempotency_records WHERE idempotency_key = $1', [key])).toBe(0);
    // The same key then executes normally.
    const ok = await postCreate(system, { operation_id: operationId, ...payload }, key);
    expect(ok.status).toBe(201);
  });

  it('a replay whose historical idempotency key is gone fails closed (IDEMPOTENCY_KEY_UNAVAILABLE, 503)', async () => {
    const { key, body } = await createdWithKey();
    const withoutK1 = new Keyring([{ id: 'k2', master: FIXTURE_MASTER_K2 }], 'k2');
    const services = directServices(app, poolClientSource(app.pool), { executorKeyring: withoutK1 });
    const input = parseCreateInvitationBody(body);
    const failure = await failureOf(() => services.invitations.create(system.login.cookie, system.login.csrf, input, key, { requestId: randomUUID() }));
    expect(failure).toBeInstanceOf(AppError);
    expect((failure as AppError).code).toBe('IDEMPOTENCY_KEY_UNAVAILABLE');
  });

  it('an operation fingerprinted with a key that is no longer in the keyring fails closed (503), never the active key', async () => {
    const payload = createPayload();
    // The operation is created while k2 is active (fingerprint_key_id = k2); the session itself was issued under k1.
    const k2Active = directServices(app, poolClientSource(app.pool), { keyring: fixtureKeyring('k2') });
    const request = { action: 'CREATE_INVITATION' as const, payload: parseCreateInvitationBody({ operation_id: randomUUID(), ...payload }).payload };
    const created = await k2Active.operations.createOperation(system.login.cookie, system.login.csrf, request, { requestId: randomUUID() });
    const row = await app.pool.query<{ fingerprint_key_id: string }>(
      'SELECT fingerprint_key_id FROM app.admin_sensitive_operations WHERE operation_id = $1::uuid',
      [created.operation_id],
    );
    expect(row.rows[0]?.fingerprint_key_id).toBe('k2');
    expect((await verifyOperation(app, system, created.operation_id)).status).toBe(200);

    const onlyK1 = directServices(app, poolClientSource(app.pool), { keyring: new Keyring([{ id: 'k1', master: FIXTURE_MASTER_K1 }], 'k1') });
    const input = parseCreateInvitationBody({ operation_id: created.operation_id, ...payload });
    const failure = await failureOf(() => onlyK1.invitations.create(system.login.cookie, system.login.csrf, input, randomUUID(), { requestId: randomUUID() }));
    expect(failure).toBeInstanceOf(TechnicalError);
    expect((failure as TechnicalError).kind).toBe('unavailable');
    expect((await operationRow(app.pool, created.operation_id))?.status).toBe('VERIFIED');
    expect(await count(app.pool, 'SELECT 1 FROM app.admin_invitations')).toBe(0);
  });

  it('a create-operation is safe to repeat after a lost response: the earlier one is REPLACED, nothing else changes', async () => {
    const first = await createOperation(app, system, 'CREATE_INVITATION', createPayload());
    const second = await createOperation(app, system, 'CREATE_INVITATION', createPayload());
    expect(await operationRow(app.pool, first)).toMatchObject({ status: 'INVALIDATED', invalidated_reason: 'REPLACED' });
    expect(await operationRow(app.pool, second)).toMatchObject({ status: 'PENDING' });
  });
});
