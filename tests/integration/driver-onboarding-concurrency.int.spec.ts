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
  driverBody,
  errorCode,
  installDriverInsertStall,
  registerUser,
  Registered,
  removeDriverInsertStall,
  rowLockWaiters,
  rowLockWaitersRunning,
  shopProfileBody,
  startAuthApp,
} from './support/auth-fixtures';
import { LockHolder } from './support/idempotency-fixtures';

// M01-A2D — deterministic race proofs. No sleeps: every overlap is forced with a PostgreSQL barrier (a held row
// lock or a held advisory lock behind a test-only trigger) and observed in pg_locks before it is released, so
// "the requests really overlapped" is a fact of the server, not a hope about timing.
describe('M01-A2D — Driver onboarding concurrency', () => {
  let app: AuthApp;
  const STALL_KEY = [910_301, 910_302] as const;

  beforeAll(async () => {
    // Tests hold locks on purpose: roomier lock budgets than the production defaults.
    app = await startAuthApp({}, { relaxTimeouts: true });
  });

  afterAll(async () => {
    await removeDriverInsertStall(app.pool);
    await app.close();
  });

  const create = (token: string, body: unknown, key: string = randomUUID()): Promise<ApiResponse> =>
    app.call('POST', '/onboarding/driver', { bearer: token, body, headers: { 'idempotency-key': key } });
  const me = (token: string): Promise<ApiResponse> => app.call('GET', '/auth/me', { bearer: token });

  async function lockUserRow(userId: string): Promise<LockHolder> {
    const holder = await LockHolder.begin(app.pool);
    await holder.query('SELECT 1 FROM app.users WHERE user_id = $1::uuid FOR UPDATE', [userId]);
    return holder;
  }

  const waiters = (atLeast: number) => async (): Promise<boolean> => (await rowLockWaiters(app.pool)) >= atLeast;
  const count = (sql: string, values: unknown[]): Promise<number> => countRows(app.pool, sql, values);

  const driverCount = (userId: string): Promise<number> => count('SELECT 1 FROM app.drivers WHERE user_id = $1::uuid', [userId]);
  const roleCount = (userId: string, role: string): Promise<number> =>
    count('SELECT 1 FROM app.user_roles WHERE user_id = $1::uuid AND role = $2', [userId, role]);
  const eventCount = (userId: string): Promise<number> =>
    count("SELECT 1 FROM app.outbox_events WHERE event_type = 'driver.onboarded.v1' AND payload->>'user_id' = $1", [userId]);
  const auditCount = (userId: string): Promise<number> =>
    count("SELECT 1 FROM app.audit_logs WHERE actor_id = $1 AND action = 'onboarding.driver.create.v1'", [userId]);

  it('two creates of one user (different keys) overlap on the user lock: exactly one Driver, one 201 and one DRIVER_PROFILE_EXISTS', async () => {
    const user = await registerUser(app);
    const holder = await lockUserRow(user.userId);
    let released = false;
    try {
      const first = create(user.accessToken, driverBody({ full_name: 'First' }));
      const second = create(user.accessToken, driverBody({ full_name: 'Second' }));
      // Both requests are inside their transactions and blocked behind the user row: a real overlap.
      await eventually(waiters(2), 'two creates blocked on the user row lock');
      await holder.commit();
      released = true;

      const results = await Promise.all([first, second]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(results.filter((r) => r.status === 409).map(errorCode)).toEqual(['DRIVER_PROFILE_EXISTS']);
      expect(await driverCount(user.userId)).toBe(1);
      expect(await roleCount(user.userId, 'DRIVER')).toBe(1);
      expect(await eventCount(user.userId)).toBe(1);
      expect(await auditCount(user.userId)).toBe(1);
    } finally {
      if (!released) {
        await holder.rollback();
      }
    }
  });

  it('the same key sent twice at once executes once (the M00 advisory and record locks decide)', async () => {
    const user = await registerUser(app);
    const key = randomUUID();
    const holder = await lockUserRow(user.userId);
    let released = false;
    try {
      const first = create(user.accessToken, driverBody(), key);
      await eventually(waiters(1), 'the first create blocked on the user row lock');
      const second = create(user.accessToken, driverBody(), key);
      await holder.commit();
      released = true;
      const results = await Promise.all([first, second]);
      expect(results.filter((r) => r.status === 201).length).toBeGreaterThanOrEqual(1);
      for (const result of results) {
        expect([201, 409]).toContain(result.status);
        if (result.status === 409) {
          expect(errorCode(result)).toBe('IDEMPOTENCY_BUSY');
        }
      }
      expect(await driverCount(user.userId)).toBe(1);
      expect(await eventCount(user.userId)).toBe(1);
      expect(await roleCount(user.userId, 'DRIVER')).toBe(1);
    } finally {
      if (!released) {
        await holder.rollback();
      }
    }
  });

  describe('one user, Shop and Driver at once', () => {
    const put = (token: string, body: unknown): Promise<ApiResponse> =>
      app.call('PUT', '/onboarding/shop/profile', { bearer: token, body, headers: { 'idempotency-key': randomUUID() } });
    const complete = (token: string, body: unknown): Promise<ApiResponse> =>
      app.call('POST', '/onboarding/shop/complete', { bearer: token, body, headers: { 'idempotency-key': randomUUID() } });

    it('Shop completion and Driver creation overlap on the user lock: both succeed, two roles, one event each', async () => {
      const user = await registerUser(app);
      const shopArea = await createServiceArea(app.pool);
      const saved = await put(user.accessToken, shopProfileBody({ pickup_lat: 21.03, pickup_lng: 105.85, service_area_id: shopArea }));
      expect(saved.status).toBe(201);
      const version = Number(dataOf(saved).version);

      const holder = await lockUserRow(user.userId);
      let released = false;
      try {
        const shop = complete(user.accessToken, { expected_version: version });
        const driver = create(user.accessToken, driverBody());
        await eventually(waiters(2), 'completion and Driver creation blocked on the user row lock');
        await holder.commit();
        released = true;

        const [completed, created] = await Promise.all([shop, driver]);
        expect([completed.status, created.status]).toEqual([200, 201]);
        expect(await roleCount(user.userId, 'SHOP')).toBe(1);
        expect(await roleCount(user.userId, 'DRIVER')).toBe(1);
        expect(await driverCount(user.userId)).toBe(1);
        expect(await eventCount(user.userId)).toBe(1);
        expect(await count("SELECT 1 FROM app.outbox_events WHERE event_type = 'shop.onboarded.v1' AND payload->>'user_id' = $1", [user.userId])).toBe(1);
        expect(dataOf(await me(user.accessToken)).available_roles).toEqual(['DRIVER', 'SHOP']);
      } finally {
        if (!released) {
          await holder.rollback();
        }
      }
    });
  });

  describe('/auth/me is one coherent snapshot against a concurrent Driver creation', () => {
    // The statement /auth/me blocks on: the shared lock of the user row.
    const ME_SHARE_LOCK = '%FROM app.users WHERE user_id = $1::uuid FOR SHARE%';
    const meWaiters = (): Promise<number> => rowLockWaitersRunning(app.pool, ME_SHARE_LOCK);

    it('/auth/me started while the create holds the user row WAITS for it, then reports DRIVER available and PENDING_APPROVAL', async () => {
      const user: Registered = await registerUser(app);
      expect(dataOf(await me(user.accessToken))).toMatchObject({
        available_roles: [],
        onboarding: { shop: 'NOT_STARTED', driver: 'NOT_STARTED' },
        onboarding_required: true,
      });

      await removeDriverInsertStall(app.pool);
      await installDriverInsertStall(app.pool, STALL_KEY, user.userId);
      const gate = await LockHolder.begin(app.pool);
      let gateOpen = true;
      try {
        await gate.advisory({ first: STALL_KEY[0], second: STALL_KEY[1] });
        const creation = create(user.accessToken, driverBody());
        // Stalled on the Driver INSERT, BEFORE the role grant and before COMMIT: the create holds the user row
        // FOR UPDATE and nothing it did is visible to anyone else yet.
        await eventually(() => advisoryWaiterExists(app.pool, STALL_KEY), 'the create stalled inside its write transaction');
        expect(await meWaiters()).toBe(0);
        expect(await roleCount(user.userId, 'DRIVER')).toBe(0);

        let meSettled = false;
        const pending = me(user.accessToken).finally(() => {
          meSettled = true;
        });
        await eventually(async () => (await meWaiters()) === 1, '/auth/me blocked on the user row behind the create');
        expect(meSettled).toBe(false);
        expect(await advisoryWaiterExists(app.pool, STALL_KEY)).toBe(true);

        await gate.commit();
        gateOpen = false;
        const [created, response] = await Promise.all([creation, pending]);
        expect(created.status).toBe(201);
        expect(response.status).toBe(200);

        // The coherent final projection: never "profile exists but role not listed" or the reverse.
        const data = dataOf(response);
        expect(data.available_roles).toEqual(['DRIVER']);
        expect(data.onboarding).toEqual({ shop: 'NOT_STARTED', driver: 'PENDING_APPROVAL' });
        expect(data.onboarding_required).toBe(false);
        expect(data.role_selection_required).toBe(true);
        expect(data.active_role).toBeNull();
        expect(await meWaiters()).toBe(0);
      } finally {
        if (gateOpen) {
          await gate.rollback();
        }
        await removeDriverInsertStall(app.pool);
      }
    });

    it('the shared lock does not serialize readers: /auth/me answers while another transaction holds the user row FOR SHARE', async () => {
      const user = await registerUser(app);
      const sharer = await LockHolder.begin(app.pool);
      try {
        await sharer.query('SELECT 1 FROM app.users WHERE user_id = $1::uuid FOR SHARE', [user.userId]);
        const responses = await Promise.all([me(user.accessToken), me(user.accessToken)]);
        expect(responses.map((r) => r.status)).toEqual([200, 200]);
        expect(dataOf(responses[0] as ApiResponse).onboarding).toEqual({ shop: 'NOT_STARTED', driver: 'NOT_STARTED' });
      } finally {
        await sharer.rollback();
      }
    });
  });
});
