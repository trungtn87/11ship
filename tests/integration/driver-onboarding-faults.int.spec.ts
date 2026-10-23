import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import {
  ApiResponse,
  AuthApp,
  countRows,
  dataOf,
  driverBody,
  installFault,
  registerUser,
  removeFault,
  startAuthApp,
} from './support/auth-fixtures';

// M01-A2D fault matrix: a failure at ANY persistence step of Driver creation leaves nothing behind (no driver,
// role, audit, outbox event or idempotency record), reveals nothing, and does not consume the
// Idempotency-Key: the same key and request succeeds afterwards. Faults are PostgreSQL triggers that raise a
// non-application server error for the rows of ONE test user only.
describe('M01-A2D — Driver onboarding fault matrix', () => {
  let app: AuthApp;

  beforeAll(async () => {
    app = await startAuthApp();
  });

  afterAll(async () => {
    await app.close();
  });

  interface Fault {
    readonly name: string;
    readonly table: string;
    readonly condition: (userId: string) => string;
  }

  const OPERATION = 'onboarding.driver.create.v1';

  const faults: Fault[] = [
    {
      name: 'fault_driver_row',
      table: 'app.drivers',
      condition: (u) => `NEW.user_id = '${u}'::uuid`,
    },
    {
      name: 'fault_driver_role',
      table: 'app.user_roles',
      condition: (u) => `NEW.user_id = '${u}'::uuid AND NEW.role = 'DRIVER'`,
    },
    {
      name: 'fault_driver_audit',
      table: 'app.audit_logs',
      condition: (u) => `NEW.actor_id = '${u}' AND NEW.action = '${OPERATION}'`,
    },
    {
      name: 'fault_driver_outbox',
      table: 'app.outbox_events',
      condition: (u) => `NEW.event_type = 'driver.onboarded.v1' AND NEW.payload->>'user_id' = '${u}'`,
    },
    {
      name: 'fault_driver_idempotency',
      table: 'app.idempotency_records',
      condition: (u) => `NEW.scope_id = '${u}' AND NEW.operation_id = '${OPERATION}'`,
    },
  ];

  const post = (token: string, body: unknown, key: string): Promise<ApiResponse> =>
    app.call('POST', '/onboarding/driver', { bearer: token, body, headers: { 'idempotency-key': key } });
  const count = (sql: string, values: unknown[]): Promise<number> => countRows(app.pool, sql, values);

  for (const fault of faults) {
    it(`fault at ${fault.table} (${fault.name}) leaves nothing; the same key then succeeds`, async () => {
      const user = await registerUser(app);
      const body = driverBody({ full_name: `Fault ${fault.name}` });
      const key = randomUUID();

      await installFault(app.pool, fault.name, fault.table, 'INSERT', fault.condition(user.userId));
      let failed: ApiResponse;
      try {
        failed = await post(user.accessToken, body, key);
      } finally {
        await removeFault(app.pool, fault.name, fault.table);
      }

      expect(failed.status).toBeGreaterThanOrEqual(500);
      expect(failed.text).not.toContain('injected fault');
      expect(failed.text).not.toContain(`Fault ${fault.name}`);
      expect(await count('SELECT 1 FROM app.drivers WHERE user_id = $1::uuid', [user.userId])).toBe(0);
      expect(await count('SELECT 1 FROM app.user_roles WHERE user_id = $1::uuid', [user.userId])).toBe(0);
      expect(await count('SELECT 1 FROM app.audit_logs WHERE request_id = $1::uuid AND action = $2', [failed.requestId, OPERATION])).toBe(0);
      expect(await count("SELECT 1 FROM app.outbox_events WHERE event_type = 'driver.onboarded.v1' AND payload->>'user_id' = $1", [user.userId])).toBe(0);
      expect(
        await count("SELECT 1 FROM app.idempotency_records WHERE scope_type = 'user' AND scope_id = $1 AND operation_id = $2", [user.userId, OPERATION]),
      ).toBe(0);

      const retry = await post(user.accessToken, body, key);
      expect(retry.status).toBe(201);
      expect(dataOf(retry)).toMatchObject({ status: 'ACTIVE', role_granted: true, version: 1 });
      expect(await count('SELECT 1 FROM app.drivers WHERE user_id = $1::uuid', [user.userId])).toBe(1);
      expect(await count('SELECT 1 FROM app.user_roles WHERE user_id = $1::uuid AND role = $2', [user.userId, 'DRIVER'])).toBe(1);
      expect(await count("SELECT 1 FROM app.outbox_events WHERE event_type = 'driver.onboarded.v1' AND payload->>'user_id' = $1", [user.userId])).toBe(1);
    });
  }
});
