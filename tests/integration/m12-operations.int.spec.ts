import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { AdminApp, adminData, adminErrorCode, startAdminApp } from './support/admin-fixtures';
import { createActiveShopFor } from './support/auth-fixtures';
import { ActivatedAdmin, activatedAdmin, changeGrant, getAs, permission, purgeDeliveriesOfShops, purgeGrants, seedDelivery, systemLoginOf } from './support/m12-fixtures';
import { systemSession, SystemSession } from './support/provisioning-fixtures';

// M12-B on a REAL PostgreSQL: the delivery list (source, wait time, signals, groups, time basis) and the detail (places, links, the contact gate, the
// money gate, the position state). Figures are checked on the rows this suite seeded.

const tag = randomBytes(3).toString('hex').toUpperCase();
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('M12-B — operations', () => {
  let admin: AdminApp;
  let system: SystemSession;
  let viewer: ActivatedAdmin;
  let reviewer: ActivatedAdmin;
  let shopId = '';
  let waiting = '';
  let stopped = '';
  let recall = '';

  beforeAll(async () => {
    admin = await startAdminApp({ activationDisabledTest: true });
    system = await systemSession(admin);
    viewer = await activatedAdmin(admin, system, [permission('DRIVER')], `Xem giao hàng ${tag}`);
    reviewer = await activatedAdmin(admin, system, [permission('DRIVER', { view: true, review: true })], `Duyệt giao hàng ${tag}`);
    shopId = await createActiveShopFor(admin.pool, system.account.userId);
    const user = system.account.userId;
    waiting = await seedDelivery(admin.pool, { shopId, userId: user, createdAtIso: new Date(Date.now() - 600_000).toISOString() });
    stopped = await seedDelivery(admin.pool, { shopId, userId: user, state: 'search_stopped', createdAtIso: new Date(Date.now() - 3_600_000).toISOString() });
    recall = await seedDelivery(admin.pool, { shopId, userId: user, previousDeliveryId: stopped });
  });

  afterAll(async () => {
    try {
      await purgeDeliveriesOfShops(admin.pool, [shopId]);
      await purgeGrants(admin.pool);
      await admin.pool.query('DELETE FROM app.shop_members WHERE shop_id = $1::uuid', [shopId]);
      await admin.pool.query('DELETE FROM app.shops WHERE shop_id = $1::uuid', [shopId]);
    } finally {
      await admin.close();
    }
  });

  const list = async (query: string): Promise<Json> => {
    const response = await getAs(admin, systemLoginOf(system), `/deliveries?shop_id=${shopId}&${query}`);
    expect([response.status, response.text.slice(0, 200)]).toEqual([200, response.text.slice(0, 200)]);
    return adminData(response) as Json;
  };

  it('list: wait time only while waiting, signals from the stored state, source and shop filters, the stopped group ignores a called-again search', async () => {
    const all = await list('limit=50');
    expect(all.total).toBe(3);
    const byId = new Map((all.items as Json[]).map((item) => [item.delivery_id, item]));
    expect(byId.get(waiting)?.wait_seconds).toBeGreaterThanOrEqual(600);
    expect(byId.get(waiting)?.signals).toEqual(['FEE_UNKNOWN']);
    expect(byId.get(stopped)?.wait_seconds).toBeNull();
    expect(byId.get(stopped)?.signals).toEqual([]); // called again: nothing left to do on it
    expect(byId.get(recall)?.source).toBe('DIRECT');
    expect((await list('group=stopped')).total).toBe(0);
    expect((await list('group=searching')).total).toBe(2);
    expect((await list('source=ORDER')).total).toBe(0);
    expect((await list('source=DIRECT')).total).toBe(3);
    // The time basis: nothing ended among these rows except the stopped search.
    const ended = await list(`basis=ended&from=2020-01-01&to=2999-01-01`);
    expect((ended.items as Json[]).map((item) => item.delivery_id)).toEqual([stopped]);
    for (const bad of ['source=X', 'group=X', 'basis=X', 'shop_id=nope']) {
      const response = await getAs(admin, systemLoginOf(system), `/deliveries?${bad}`);
      expect([response.status, adminErrorCode(response)]).toEqual([400, 'ADMIN_INPUT_INVALID']);
    }
  });

  it('detail: places, links and the position state; contact and money are gated by CURRENT rights, and a right taken back applies to the next call', async () => {
    const asSystem = adminData(await getAs(admin, systemLoginOf(system), `/deliveries/${stopped}`)) as Json;
    expect(asSystem.pickup).toMatchObject({ address_text: 'Fixture address', lat: 21, lng: 105.8 });
    expect(asSystem.links.next_delivery).toMatchObject({ delivery_id: recall });
    expect(asSystem.location_state).toBe('NO_SHIPPER');
    expect(asSystem.money).toEqual({ status: 'OK', commissions: [] });
    expect((adminData(await getAs(admin, systemLoginOf(system), `/deliveries/${recall}`)) as Json).links.previous_delivery_id).toBe(stopped);

    // View only: no recipient contact, no drop-off address, no money.
    const limited = adminData(await getAs(admin, viewer.login, `/deliveries/${waiting}`)) as Json;
    expect(limited.recipient).toEqual({ name: null, phone: null, address_text: null });
    expect(limited.dropoff).toMatchObject({ address_text: null, lat: null, lng: null });
    expect(limited.money).toEqual({ status: 'FORBIDDEN' });
    // Review right: the contact, still no money.
    const reviewed = adminData(await getAs(admin, reviewer.login, `/deliveries/${waiting}`)) as Json;
    expect(reviewed.recipient.name).toBe('Khách');
    expect(reviewed.dropoff.address_text).toBe('12 Phố Huế');
    expect(reviewed.money.status).toBe('FORBIDDEN');
    // wallet.read adds the money facts only.
    expect((await changeGrant(admin, system, 'grant', reviewer.userId, 'wallet.read', 0)).status).toBe(200);
    expect(((adminData(await getAs(admin, reviewer.login, `/deliveries/${waiting}`)) as Json).money as Json).status).toBe('OK');
    expect((await changeGrant(admin, system, 'revoke', reviewer.userId, 'wallet.read', 1)).status).toBe(200);
    expect(((adminData(await getAs(admin, reviewer.login, `/deliveries/${waiting}`)) as Json).money as Json).status).toBe('FORBIDDEN');
    // A session without the right app is refused on the list and the detail alike.
    const none = await activatedAdmin(admin, system, [permission('CUSTOMER')], `Không giao hàng ${tag}`);
    expect(adminErrorCode(await getAs(admin, none.login, '/deliveries'))).toBe('ADMIN_FORBIDDEN');
    expect(adminErrorCode(await getAs(admin, none.login, `/deliveries/${waiting}`))).toBe('ADMIN_FORBIDDEN');
  });
});
