import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { AdminApp, adminData, adminErrorCode, count, startAdminApp } from './support/admin-fixtures';
import { eventually } from './support/async-helpers';
import { LockHolder, lockPairOf } from './support/idempotency-fixtures';
import { api, createPayload, operationRow, sessionOf, SystemSession, systemSession } from './support/provisioning-fixtures';

// OD-2 item 1 — POST /v1/admin/operations carries an Idempotency-Key. Same key + same request = the operation created the
// first time (nothing replaced, nothing inserted); same key + another request = IDEMPOTENCY_KEY_REUSED; a new key is a new
// user action and replaces the live operation as before; no key = 400. Two concurrent requests with one key create one row.

describe('OD-2.1 — create-operation idempotency', () => {
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

  const create = (payload: Record<string, unknown>, key: string | undefined, action = 'CREATE_INVITATION') =>
    api(app, 'POST', '/operations', {
      body: { action, payload },
      ...sessionOf(system),
      headers: key === undefined ? {} : { 'idempotency-key': key },
    });
  const operations = () =>
    count(app.pool, 'SELECT 1 FROM app.admin_sensitive_operations WHERE actor_user_id = $1::uuid', [system.account.userId]);

  it('a retry with the same key and request returns the first operation: no second row, nothing replaced', async () => {
    const payload = createPayload();
    const key = randomUUID();
    const first = await create(payload, key);
    expect(first.status).toBe(201);
    const retry = await create(payload, key);
    expect([retry.status, adminData(retry)]).toEqual([201, adminData(first)]);
    expect(await operations()).toBe(1);
    expect(await operationRow(app.pool, String(adminData(first).operation_id))).toMatchObject({ status: 'PENDING' });
  });

  it('a retry after a later action replaced the operation still returns the first one and leaves both rows alone', async () => {
    const payload = createPayload();
    const key = randomUUID();
    const first = await create(payload, key);
    const second = await create(createPayload(), randomUUID());
    expect(second.status).toBe(201);
    const retry = await create(payload, key);
    expect([retry.status, adminData(retry)]).toEqual([201, adminData(first)]);
    expect(await operationRow(app.pool, String(adminData(first).operation_id))).toMatchObject({ status: 'INVALIDATED', invalidated_reason: 'REPLACED' });
    expect(await operationRow(app.pool, String(adminData(second).operation_id))).toMatchObject({ status: 'PENDING' });
    expect(await operations()).toBe(2);
  });

  it('the same key with another request is IDEMPOTENCY_KEY_REUSED and creates nothing', async () => {
    const key = randomUUID();
    expect((await create(createPayload(), key)).status).toBe(201);
    const other = await create(createPayload(), key);
    expect([other.status, adminErrorCode(other)]).toEqual([409, 'IDEMPOTENCY_KEY_REUSED']);
    expect(await operations()).toBe(1);
  });

  it('a new key is a new action: the live operation is replaced as before', async () => {
    const first = await create(createPayload(), randomUUID());
    const second = await create(createPayload(), randomUUID());
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(await operationRow(app.pool, String(adminData(first).operation_id))).toMatchObject({ status: 'INVALIDATED', invalidated_reason: 'REPLACED' });
    expect(await operationRow(app.pool, String(adminData(second).operation_id))).toMatchObject({ status: 'PENDING' });
  });

  it('a missing or malformed key is 400', async () => {
    const missing = await create(createPayload(), undefined);
    expect([missing.status, adminErrorCode(missing)]).toEqual([400, 'IDEMPOTENCY_KEY_REQUIRED']);
    const malformed = await create(createPayload(), 'not a key');
    expect(malformed.status).toBe(400);
    expect(await operations()).toBe(0);
  });

  it('two concurrent requests with one key create one operation and answer alike', async () => {
    const payload = createPayload();
    const key = randomUUID();
    // Barrier: an outside transaction holds the key's advisory lock until BOTH requests are provably waiting for it, so the two
    // really overlap (the second one cannot arrive after the first has finished).
    const holder = await LockHolder.begin(app.pool);
    await holder.advisory(lockPairOf('admin_user', system.account.userId, 'admin.operation.create.v1', key));
    const both = Promise.all([create(payload, key), create(payload, key)]);
    await eventually(
      async () => {
        const waiting = await app.pool.query(
          "SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND objsubid = 2",
        );
        return (waiting.rows[0]?.n ?? 0) >= 2;
      },
      'both requests wait for the advisory lock of the key',
    );
    await holder.commit();
    const [a, b] = await both;
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(adminData(a)).toEqual(adminData(b));
    expect(await operations()).toBe(1);
  });
});
