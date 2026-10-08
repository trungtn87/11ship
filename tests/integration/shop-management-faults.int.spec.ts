import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { AuthApp, errorCode, installFault, removeFault, startAuthApp } from './support/auth-fixtures';
import {
  createShopOwner,
  hoursBody,
  installDeleteFault,
  interval,
  profileBody,
  putHours,
  putProfile,
  ShopOwner,
  shopState,
} from './support/shop-management-fixtures';

// M02-A acceptance A13 — fault matrix. A failure at ANY persistence step of a mutation (delete, insert, version,
// audit, outbox, idempotency record) rolls the whole transaction back: the previous schedule and profile are intact,
// nothing is audited, published or recorded, the response reveals nothing, and the Idempotency-Key is not consumed
// (the same key and request succeeds once the fault is removed). Faults are PostgreSQL triggers that raise a
// non-application server error for the rows of ONE test owner only.
describe('M02-A — Shop management fault matrix', () => {
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
    readonly install: (owner: ShopOwner) => Promise<void>;
  }

  const insertFault = (name: string, table: string, condition: (owner: ShopOwner) => string): Fault => ({
    name,
    table,
    install: (owner) => installFault(app.pool, name, table, 'INSERT', condition(owner)),
  });
  const updateFault = (name: string, table: string, condition: (owner: ShopOwner) => string): Fault => ({
    name,
    table,
    install: (owner) => installFault(app.pool, name, table, 'UPDATE', condition(owner)),
  });
  const deleteFault = (name: string, table: string, condition: (owner: ShopOwner) => string): Fault => ({
    name,
    table,
    install: (owner) => installDeleteFault(app.pool, name, table, condition(owner)),
  });

  const common = (action: string, operation: string): Fault[] => [
    insertFault('fault_shopmgmt_audit', 'app.audit_logs', (o) => `NEW.actor_id::text = '${o.userId}' AND NEW.action = '${action}'`),
    insertFault('fault_shopmgmt_outbox', 'app.outbox_events', (o) => `NEW.resource_id::text = '${o.shopId}' AND NEW.event_type LIKE 'shop.%'`),
    insertFault('fault_shopmgmt_record', 'app.idempotency_records', (o) => `NEW.scope_id = '${o.userId}' AND NEW.operation_id = '${operation}'`),
  ];

  const HOURS_FAULTS: Fault[] = [
    deleteFault('fault_shopmgmt_hours_delete', 'app.shop_business_hours', (o) => `OLD.shop_id = '${o.shopId}'::uuid`),
    insertFault('fault_shopmgmt_hours_insert', 'app.shop_business_hours', (o) => `NEW.shop_id = '${o.shopId}'::uuid`),
    updateFault('fault_shopmgmt_hours_version', 'app.shops', (o) => `NEW.shop_id = '${o.shopId}'::uuid`),
    ...common('shop.business_hours.replace.v1', 'shop.business_hours.replace.v1'),
  ];

  const PROFILE_FAULTS: Fault[] = [
    updateFault('fault_shopmgmt_profile_update', 'app.shops', (o) => `NEW.shop_id = '${o.shopId}'::uuid`),
    ...common('shop.profile.update.v1', 'shop.profile.update.v1'),
  ];

  const OLD_SCHEDULE = [interval(1, 480, 720), interval(2, 480, 720)];
  const NEW_SCHEDULE = [interval(3, 600, 900), interval(4, 1080, 120, 1), interval(6, 0, 1440)];

  describe('business hours replacement', () => {
    for (const fault of HOURS_FAULTS) {
      it(`${fault.name}: everything rolls back, the old schedule survives, the key is not consumed`, async () => {
        const owner = await createShopOwner(app);
        expect((await putHours(app, owner.token, hoursBody(OLD_SCHEDULE))).status).toBe(200);
        const before = await shopState(app.pool, owner);
        const key = randomUUID();
        const body = hoursBody(NEW_SCHEDULE, 3);

        await fault.install(owner);
        try {
          const failed = await putHours(app, owner.token, body, key);
          expect([failed.status, errorCode(failed)]).toEqual([500, 'INTERNAL_ERROR']);
          expect(failed.text).not.toMatch(/injected|XX001|shop_business_hours|trigger/i);
          expect(await shopState(app.pool, owner)).toEqual(before);
          expect(before.hours).toEqual(OLD_SCHEDULE);
        } finally {
          await removeFault(app.pool, fault.name, fault.table);
        }

        const retried = await putHours(app, owner.token, body, key);
        expect(retried.status).toBe(200);
        const after = await shopState(app.pool, owner);
        expect(after.hours).toEqual(NEW_SCHEDULE);
        expect([after.version - before.version, after.audits - before.audits, after.events - before.events, after.records - before.records]).toEqual([1, 1, 1, 1]);
      });
    }
  });

  describe('profile update', () => {
    for (const fault of PROFILE_FAULTS) {
      it(`${fault.name}: everything rolls back, the old profile survives, the key is not consumed`, async () => {
        const owner = await createShopOwner(app);
        const before = await shopState(app.pool, owner);
        const key = randomUUID();
        const body = profileBody(owner);

        await fault.install(owner);
        try {
          const failed = await putProfile(app, owner.token, body, key);
          expect([failed.status, errorCode(failed)]).toEqual([500, 'INTERNAL_ERROR']);
          expect(failed.text).not.toMatch(/injected|XX001|trigger/i);
          expect(await shopState(app.pool, owner)).toEqual(before);
        } finally {
          await removeFault(app.pool, fault.name, fault.table);
        }

        const retried = await putProfile(app, owner.token, body, key);
        expect(retried.status).toBe(200);
        const after = await shopState(app.pool, owner);
        expect(after).toMatchObject({ name: 'Quán Mới', version: before.version + 1 });
        expect([after.audits - before.audits, after.events - before.events, after.records - before.records]).toEqual([1, 1, 1]);
      });
    }
  });
});
