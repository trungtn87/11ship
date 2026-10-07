import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { eventually } from './support/async-helpers';
import {
  advisoryWaiterExists,
  ApiResponse,
  AuthApp,
  countRows,
  createServiceArea,
  dataOf,
  errorCode,
  installShopActivateStall,
  registerUser,
  Registered,
  removeShopActivateStall,
  rowLockWaiters,
  shopProfileBody,
  startAuthApp,
} from './support/auth-fixtures';
import { LockHolder } from './support/idempotency-fixtures';

// M01-A2S — deterministic race proofs. No sleeps: every overlap is forced with a PostgreSQL barrier (a held row
// lock or a held advisory lock behind a test-only trigger) and observed in pg_locks before it is released, so
// "the requests really overlapped" is a fact of the server, not a hope about timing.
describe('M01-A2S — Shop onboarding concurrency', () => {
  let app: AuthApp;
  const STALL_KEY = [910_201, 910_202] as const;

  beforeAll(async () => {
    // Tests hold locks on purpose: roomier lock budgets than the production defaults.
    app = await startAuthApp({}, { relaxTimeouts: true });
  });

  afterAll(async () => {
    await removeShopActivateStall(app.pool);
    await app.close();
  });

  const put = (token: string, body: unknown, key: string = randomUUID()): Promise<ApiResponse> =>
    app.call('PUT', '/onboarding/shop/profile', { bearer: token, body, headers: { 'idempotency-key': key } });
  const post = (token: string, body: unknown, key: string = randomUUID()): Promise<ApiResponse> =>
    app.call('POST', '/onboarding/shop/complete', { bearer: token, body, headers: { 'idempotency-key': key } });

  async function draft(): Promise<{ user: Registered; shopId: string; areaId: string; version: number }> {
    const user = await registerUser(app);
    const areaId = await createServiceArea(app.pool);
    const saved = await put(user.accessToken, shopProfileBody({ pickup_lat: 21.03, pickup_lng: 105.85, service_area_id: areaId }));
    expect(saved.status).toBe(201);
    return { user, shopId: String(dataOf(saved).shop_id), areaId, version: Number(dataOf(saved).version) };
  }

  async function lockUserRow(userId: string): Promise<LockHolder> {
    const holder = await LockHolder.begin(app.pool);
    await holder.query('SELECT 1 FROM app.users WHERE user_id = $1::uuid FOR UPDATE', [userId]);
    return holder;
  }

  const waiters = (atLeast: number) => async (): Promise<boolean> => (await rowLockWaiters(app.pool)) >= atLeast;

  const count = (sql: string, values: unknown[]): Promise<number> => countRows(app.pool, sql, values);

  it('two profile creates of one user (different keys) overlap on the user lock: exactly one shop, one 201 and one SHOP_ONBOARDING_EXISTS', async () => {
    const user = await registerUser(app);
    const holder = await lockUserRow(user.userId);
    let released = false;
    try {
      const first = put(user.accessToken, shopProfileBody({ name: 'First' }));
      const second = put(user.accessToken, shopProfileBody({ name: 'Second' }));
      // Both requests are inside their transactions and blocked behind the user row: a real overlap.
      await eventually(waiters(2), 'two creates blocked on the user row lock');
      await holder.commit();
      released = true;

      const results = await Promise.all([first, second]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(results.filter((r) => r.status === 409).map(errorCode)).toEqual(['SHOP_ONBOARDING_EXISTS']);
      expect(await count('SELECT 1 FROM app.shop_members WHERE user_id = $1::uuid', [user.userId])).toBe(1);
      expect(
        await count('SELECT 1 FROM app.shops s JOIN app.shop_members m USING (shop_id) WHERE m.user_id = $1::uuid', [user.userId]),
      ).toBe(1);
      expect(
        await count("SELECT 1 FROM app.audit_logs WHERE actor_id = $1 AND action = 'onboarding.shop.profile.save.v1'", [user.userId]),
      ).toBe(1);
    } finally {
      if (!released) {
        await holder.rollback();
      }
    }
  });

  it('two completions (different keys, same version) overlap: one ACTIVE transition, one role grant, one event', async () => {
    const { user, version } = await draft();
    const holder = await lockUserRow(user.userId);
    let released = false;
    try {
      const first = post(user.accessToken, { expected_version: version });
      const second = post(user.accessToken, { expected_version: version });
      await eventually(waiters(2), 'two completions blocked on the user row lock');
      await holder.commit();
      released = true;

      const results = await Promise.all([first, second]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(results.filter((r) => r.status === 409).map(errorCode)).toEqual(['SHOP_ONBOARDING_EXISTS']);
      expect(await count('SELECT 1 FROM app.user_roles WHERE user_id = $1::uuid AND role = $2', [user.userId, 'SHOP'])).toBe(1);
      expect(await count("SELECT 1 FROM app.outbox_events WHERE event_type = 'shop.onboarded.v1' AND payload->>'user_id' = $1", [user.userId])).toBe(1);
      expect(await count("SELECT 1 FROM app.audit_logs WHERE actor_id = $1 AND action = 'onboarding.shop.complete.v1'", [user.userId])).toBe(1);
      const shop = await app.pool.query<{ version: string; status: string }>(
        'SELECT s.version, s.status FROM app.shops s JOIN app.shop_members m USING (shop_id) WHERE m.user_id = $1::uuid',
        [user.userId],
      );
      expect(shop.rows[0]?.status).toBe('ACTIVE');
      expect(Number(shop.rows[0]?.version)).toBe(version + 1);
    } finally {
      if (!released) {
        await holder.rollback();
      }
    }
  });

  it('the same key sent twice at once executes once (the M00 advisory and record locks decide)', async () => {
    const { user, version } = await draft();
    const key = randomUUID();
    const holder = await lockUserRow(user.userId);
    let released = false;
    try {
      const first = post(user.accessToken, { expected_version: version }, key);
      await eventually(waiters(1), 'the first completion blocked on the user row lock');
      const second = post(user.accessToken, { expected_version: version }, key);
      // The second is not executing the business work: it waits on the M00 per-key advisory lock (or answers
      // IDEMPOTENCY_BUSY). Either way it never produces a second effect.
      await holder.commit();
      released = true;
      const results = await Promise.all([first, second]);
      expect(results.filter((r) => r.status === 200).length).toBeGreaterThanOrEqual(1);
      for (const result of results) {
        expect([200, 409]).toContain(result.status);
        if (result.status === 409) {
          expect(errorCode(result)).toBe('IDEMPOTENCY_BUSY');
        }
      }
      expect(await count("SELECT 1 FROM app.outbox_events WHERE event_type = 'shop.onboarded.v1' AND payload->>'user_id' = $1", [user.userId])).toBe(1);
      expect(await count('SELECT 1 FROM app.user_roles WHERE user_id = $1::uuid', [user.userId])).toBe(1);
    } finally {
      if (!released) {
        await holder.rollback();
      }
    }
  });

  it('service area deactivated BEFORE completion reads it: the completion waits, then sees INACTIVE and refuses', async () => {
    const { user, areaId, version } = await draft();
    const operator = await LockHolder.begin(app.pool);
    let released = false;
    try {
      await operator.query(
        "UPDATE app.service_areas SET status = 'INACTIVE', version = version + 1, updated_at = clock_timestamp() WHERE service_area_id = $1::uuid",
        [areaId],
      );
      const pending = post(user.accessToken, { expected_version: version });
      await eventually(waiters(1), 'the completion blocked on the service area row (FOR SHARE vs the uncommitted UPDATE)');
      await operator.commit();
      released = true;

      const response = await pending;
      expect([response.status, errorCode(response)]).toEqual([400, 'INVALID_SERVICE_AREA']);
      const shop = await app.pool.query<{ status: string }>(
        'SELECT s.status FROM app.shops s JOIN app.shop_members m USING (shop_id) WHERE m.user_id = $1::uuid',
        [user.userId],
      );
      expect(shop.rows[0]?.status).toBe('INCOMPLETE');
      expect(await count('SELECT 1 FROM app.user_roles WHERE user_id = $1::uuid', [user.userId])).toBe(0);
      expect(await count("SELECT 1 FROM app.outbox_events WHERE event_type = 'shop.onboarded.v1' AND payload->>'user_id' = $1", [user.userId])).toBe(0);
    } finally {
      if (!released) {
        await operator.rollback();
      }
    }
  });

  it('profile save with an area being deactivated: waits for the operator, then INVALID_SERVICE_AREA and nothing written', async () => {
    const user = await registerUser(app);
    const areaId = await createServiceArea(app.pool);
    const operator = await LockHolder.begin(app.pool);
    let released = false;
    try {
      await operator.query(
        "UPDATE app.service_areas SET status = 'INACTIVE', version = version + 1, updated_at = clock_timestamp() WHERE service_area_id = $1::uuid",
        [areaId],
      );
      const pending = put(user.accessToken, shopProfileBody({ service_area_id: areaId }));
      await eventually(waiters(1), 'the save blocked on the service area row');
      await operator.commit();
      released = true;
      const response = await pending;
      expect([response.status, errorCode(response)]).toEqual([400, 'INVALID_SERVICE_AREA']);
      expect(await count('SELECT 1 FROM app.shop_members WHERE user_id = $1::uuid', [user.userId])).toBe(0);
    } finally {
      if (!released) {
        await operator.rollback();
      }
    }
  });

  it('service area deactivation AFTER completion took its FOR SHARE lock: the operator waits until the completion commits', async () => {
    const { user, areaId, version } = await draft();
    await removeShopActivateStall(app.pool);
    await installShopActivateStall(app.pool, STALL_KEY);
    const gate = await LockHolder.begin(app.pool);
    let gateOpen = true;
    try {
      await gate.advisory({ first: STALL_KEY[0], second: STALL_KEY[1] });
      const completion = post(user.accessToken, { expected_version: version });
      // The completion is stalled right before it turns the shop ACTIVE: it holds user, membership, shop and the
      // service-area row FOR SHARE.
      await eventually(() => advisoryWaiterExists(app.pool, STALL_KEY), 'the completion stalled inside its transaction');

      let operatorDone = false;
      const operator = app.pool
        .query(
          "UPDATE app.service_areas SET status = 'INACTIVE', version = version + 1, updated_at = clock_timestamp() WHERE service_area_id = $1::uuid",
          [areaId],
        )
        .then(() => {
          operatorDone = true;
        });
      await eventually(waiters(1), 'the operator UPDATE blocked behind the completion FOR SHARE lock');
      expect(operatorDone).toBe(false);

      await gate.commit();
      gateOpen = false;
      const response = await completion;
      expect(response.status).toBe(200);
      await operator;

      const shop = await app.pool.query<{ status: string }>(
        'SELECT s.status FROM app.shops s JOIN app.shop_members m USING (shop_id) WHERE m.user_id = $1::uuid',
        [user.userId],
      );
      expect(shop.rows[0]?.status).toBe('ACTIVE');
      const area = await app.pool.query<{ status: string }>('SELECT status FROM app.service_areas WHERE service_area_id = $1::uuid', [areaId]);
      expect(area.rows[0]?.status).toBe('INACTIVE');
    } finally {
      if (gateOpen) {
        await gate.rollback();
      }
      await removeShopActivateStall(app.pool);
    }
  });

  it('a popular area does not serialize shops: completions of two users run while a third transaction holds FOR SHARE on the area', async () => {
    const areaId = await createServiceArea(app.pool);
    const owners: Array<{ user: Registered; version: number }> = [];
    for (let i = 0; i < 2; i++) {
      const user = await registerUser(app);
      const saved = await put(user.accessToken, shopProfileBody({ pickup_lat: 21.03, pickup_lng: 105.85, service_area_id: areaId }));
      expect(saved.status).toBe(201);
      owners.push({ user, version: Number(dataOf(saved).version) });
    }
    const sharer = await LockHolder.begin(app.pool);
    try {
      await sharer.query('SELECT 1 FROM app.service_areas WHERE service_area_id = $1::uuid FOR SHARE', [areaId]);
      // Both finish while the share lock is still held: FOR SHARE does not conflict with FOR SHARE.
      const results = await Promise.all(owners.map((owner) => post(owner.user.accessToken, { expected_version: owner.version })));
      expect(results.map((r) => r.status)).toEqual([200, 200]);
    } finally {
      await sharer.rollback();
    }
  });
});
