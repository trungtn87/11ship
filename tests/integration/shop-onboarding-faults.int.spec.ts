import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import {
  ApiResponse,
  AuthApp,
  countRows,
  createServiceArea,
  dataOf,
  installFault,
  randomPhone,
  registerUser,
  removeFault,
  shopProfileBody,
  startAuthApp,
} from './support/auth-fixtures';

// M01-A2S fault matrix: a failure at ANY persistence step of profile save or completion leaves nothing behind
// (no shop, membership, role, audit, outbox event or idempotency record), reveals nothing, and does not consume
// the Idempotency-Key: the same key and request succeeds afterwards. Faults are PostgreSQL triggers that raise
// a non-application server error for the rows of ONE test user only.
describe('M01-A2S — Shop onboarding fault matrix', () => {
  let app: AuthApp;

  beforeAll(async () => {
    app = await startAuthApp();
  });

  afterAll(async () => {
    await app.close();
  });

  interface Marker {
    readonly userId: string;
    readonly contact: string;
  }

  interface Fault {
    readonly name: string;
    readonly table: string;
    readonly events: 'INSERT' | 'UPDATE';
    readonly condition: (marker: Marker) => string;
  }

  const SAVE = 'onboarding.shop.profile.save.v1';
  const COMPLETE = 'onboarding.shop.complete.v1';

  const saveFaults: Fault[] = [
    {
      name: 'fault_save_shop',
      table: 'app.shops',
      events: 'INSERT',
      condition: (m) => `NEW.contact_phone_normalized = '${m.contact}'`,
    },
    {
      name: 'fault_save_membership',
      table: 'app.shop_members',
      events: 'INSERT',
      condition: (m) => `NEW.user_id = '${m.userId}'`,
    },
    {
      name: 'fault_save_audit',
      table: 'app.audit_logs',
      events: 'INSERT',
      condition: (m) => `NEW.actor_id = '${m.userId}' AND NEW.action = '${SAVE}'`,
    },
    {
      name: 'fault_save_idempotency',
      table: 'app.idempotency_records',
      events: 'INSERT',
      condition: (m) => `NEW.scope_id = '${m.userId}' AND NEW.operation_id = '${SAVE}'`,
    },
  ];

  const completeFaults: Fault[] = [
    {
      name: 'fault_complete_shop',
      table: 'app.shops',
      events: 'UPDATE',
      condition: (m) => `NEW.status = 'ACTIVE' AND NEW.contact_phone_normalized = '${m.contact}'`,
    },
    {
      name: 'fault_complete_role',
      table: 'app.user_roles',
      events: 'INSERT',
      condition: (m) => `NEW.user_id = '${m.userId}' AND NEW.role = 'SHOP'`,
    },
    {
      name: 'fault_complete_audit',
      table: 'app.audit_logs',
      events: 'INSERT',
      condition: (m) => `NEW.actor_id = '${m.userId}' AND NEW.action = '${COMPLETE}'`,
    },
    {
      name: 'fault_complete_outbox',
      table: 'app.outbox_events',
      events: 'INSERT',
      condition: (m) => `NEW.event_type = 'shop.onboarded.v1' AND NEW.payload->>'user_id' = '${m.userId}'`,
    },
    {
      name: 'fault_complete_idempotency',
      table: 'app.idempotency_records',
      events: 'INSERT',
      condition: (m) => `NEW.scope_id = '${m.userId}' AND NEW.operation_id = '${COMPLETE}'`,
    },
  ];

  async function withFault<T>(fault: Fault, marker: Marker, run: () => Promise<T>): Promise<T> {
    await installFault(app.pool, fault.name, fault.table, fault.events, fault.condition(marker));
    try {
      return await run();
    } finally {
      await removeFault(app.pool, fault.name, fault.table);
    }
  }

  const put = (token: string, body: unknown, key: string): Promise<ApiResponse> =>
    app.call('PUT', '/onboarding/shop/profile', { bearer: token, body, headers: { 'idempotency-key': key } });
  const post = (token: string, body: unknown, key: string): Promise<ApiResponse> =>
    app.call('POST', '/onboarding/shop/complete', { bearer: token, body, headers: { 'idempotency-key': key } });

  const count = (sql: string, values: unknown[]): Promise<number> => countRows(app.pool, sql, values);

  for (const fault of saveFaults) {
    it(`save: fault at ${fault.table} (${fault.events}, ${fault.name}) leaves nothing; the same key then succeeds`, async () => {
      const user = await registerUser(app);
      const contact = randomPhone();
      const body = shopProfileBody({ contact_phone: contact.local });
      const key = randomUUID();
      const marker: Marker = { userId: user.userId, contact: contact.normalized };

      const failed = await withFault(fault, marker, () => put(user.accessToken, body, key));

      expect(failed.status).toBeGreaterThanOrEqual(500);
      expect(failed.text).not.toContain('injected fault');
      expect(failed.text).not.toContain(contact.normalized);
      expect(await count('SELECT 1 FROM app.shop_members WHERE user_id = $1::uuid', [user.userId])).toBe(0);
      expect(await count('SELECT 1 FROM app.shops WHERE contact_phone_normalized = $1', [contact.normalized])).toBe(0);
      expect(await count('SELECT 1 FROM app.audit_logs WHERE request_id = $1::uuid AND action = $2', [failed.requestId, SAVE])).toBe(0);
      expect(
        await count("SELECT 1 FROM app.idempotency_records WHERE scope_type = 'user' AND scope_id = $1 AND operation_id = $2", [user.userId, SAVE]),
      ).toBe(0);

      const retry = await put(user.accessToken, body, key);
      expect(retry.status).toBe(201);
      expect(await count('SELECT 1 FROM app.shop_members WHERE user_id = $1::uuid', [user.userId])).toBe(1);
    });
  }

  for (const fault of completeFaults) {
    it(`complete: fault at ${fault.table} (${fault.events}, ${fault.name}) leaves the draft untouched; the same key then succeeds`, async () => {
      const user = await registerUser(app);
      const contact = randomPhone();
      const areaId = await createServiceArea(app.pool);
      const saved = await put(
        user.accessToken,
        shopProfileBody({ contact_phone: contact.local, pickup_lat: 21.03, pickup_lng: 105.85, service_area_id: areaId }),
        randomUUID(),
      );
      expect(saved.status).toBe(201);
      const shopId = String(dataOf(saved).shop_id);
      const version = Number(dataOf(saved).version);
      const key = randomUUID();
      const marker: Marker = { userId: user.userId, contact: contact.normalized };

      const failed = await withFault(fault, marker, () => post(user.accessToken, { expected_version: version }, key));

      expect(failed.status).toBeGreaterThanOrEqual(500);
      expect(failed.text).not.toContain('injected fault');
      const shop = await app.pool.query<{ status: string; accepting_orders: boolean; version: string }>(
        'SELECT status, accepting_orders, version FROM app.shops WHERE shop_id = $1::uuid',
        [shopId],
      );
      expect(shop.rows[0]).toMatchObject({ status: 'INCOMPLETE', accepting_orders: false });
      expect(Number(shop.rows[0]?.version)).toBe(version);
      expect(await count('SELECT 1 FROM app.user_roles WHERE user_id = $1::uuid', [user.userId])).toBe(0);
      expect(await count('SELECT 1 FROM app.audit_logs WHERE request_id = $1::uuid AND action = $2', [failed.requestId, COMPLETE])).toBe(0);
      expect(await count("SELECT 1 FROM app.outbox_events WHERE event_type = 'shop.onboarded.v1' AND payload->>'user_id' = $1", [user.userId])).toBe(0);
      expect(
        await count("SELECT 1 FROM app.idempotency_records WHERE scope_type = 'user' AND scope_id = $1 AND operation_id = $2", [user.userId, COMPLETE]),
      ).toBe(0);

      const retry = await post(user.accessToken, { expected_version: version }, key);
      expect(retry.status).toBe(200);
      expect(dataOf(retry)).toMatchObject({ shop_id: shopId, status: 'ACTIVE', role_granted: true, version: version + 1 });
      expect(await count('SELECT 1 FROM app.user_roles WHERE user_id = $1::uuid', [user.userId])).toBe(1);
      expect(await count("SELECT 1 FROM app.outbox_events WHERE event_type = 'shop.onboarded.v1' AND payload->>'user_id' = $1", [user.userId])).toBe(1);
    });
  }
});
