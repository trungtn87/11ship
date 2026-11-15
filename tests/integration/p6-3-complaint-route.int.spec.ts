import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { RouteSnapshotRepository } from '../../apps/backend/src/orders/route-snapshot-repository';
import { dataOf } from './support/auth-fixtures';
import { adminData } from './support/admin-fixtures';
import { encodePolyline6 } from '../../apps/backend/src/delivery/m14-route-client';
import { AdminLogin, Json, M11World, Shipper } from './support/m11-harness';

// P6-3 (#294), regression: the Admin COMPLAINT detail reads a delivery through DeliveryViews.forAdmin. It is not a delivery detail, so it must carry no
// route, no legacy flag and must not read the route snapshot. The Admin DELIVERY detail keeps the route (positive control).
describe('P6-3 route view: the Admin complaint detail stays without a route', () => {
  let w: M11World;
  let system: AdminLogin;
  let shipper: Shipper;
  let deliveryId = '';
  let complaintId = '';
  const SNAPSHOT_ID = randomUUID();
  const ROUTE_VERSION = 'valhalla-test/p6-3-complaint-' + SNAPSHOT_ID;
  const SHAPE = encodePolyline6([{ lat: 21.0, lng: 105.82 }, { lat: 21.02, lng: 105.84 }]);

  beforeAll(async () => {
    w = await M11World.start({ admin: true });
    system = w.systemLogin();
    shipper = await w.newShipper();
    deliveryId = await w.failed(shipper);
    // A snapshot pointer on the delivery, set the way P6-2 does it: inside an approved session with the distance synced to the snapshot.
    await w.app.pool.query(
      `INSERT INTO app.route_snapshots (id, route_version, distance_m, duration_s, geometry) VALUES ($1::uuid, $2, 2500, 420, $3)`,
      [SNAPSHOT_ID, ROUTE_VERSION, SHAPE],
    );
    const client = await w.app.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.address_change_in_progress', 'on', true)`);
      // The delivery of a shop-created call (source DIRECT) never reads a snapshot, so the fixture makes it a customer-created record (source CUSTOMER,
      // no Order). The user triggers are disabled for this one statement only (test data), so the record is the one the route rule is about.
      await client.query('ALTER TABLE app.deliveries DISABLE TRIGGER USER');
      await client.query(
        `UPDATE app.deliveries SET source = 'CUSTOMER', route_snapshot_id = $2::uuid, route_distance_m = 2500, version = version + 1, updated_at = clock_timestamp() WHERE delivery_id = $1::uuid`,
        [deliveryId, SNAPSHOT_ID],
      );
      await client.query('ALTER TABLE app.deliveries ENABLE TRIGGER USER');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    const created = await w.asShop('POST', '/shop/me/complaints', { category: 'GOODS', body: 'Hàng chưa về quán', delivery_id: deliveryId });
    expect([created.status, created.text.slice(0, 300)]).toEqual([201, created.text.slice(0, 300)]);
    complaintId = String(((dataOf(created) as Json).complaint as Json).complaint_id);
  });

  afterAll(async () => {
    const client = await w.app.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE app.admin_finance_grants DISABLE TRIGGER USER');
      await client.query(`DELETE FROM app.admin_finance_grants WHERE permission_key = 'wallet.adjustment.post'`);
      await client.query('ALTER TABLE app.admin_finance_grants ENABLE TRIGGER USER');
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    await w.close();
  });

  it('the Admin complaint detail gives its delivery with NO route key, NO legacy flag and NO geometry', async () => {
    const response = await w.adminGet(system, `/complaints/${complaintId}`);
    expect([response.status, response.text.slice(0, 200)]).toEqual([200, response.text.slice(0, 200)]);
    const delivery = (adminData(response) as Json).delivery as Json;
    expect(delivery).not.toBeNull();
    expect(delivery.delivery_id).toBe(deliveryId);
    expect('route' in delivery).toBe(false);
    expect('legacy_reference_only' in delivery).toBe(false);
    expect(response.text.includes(SHAPE)).toBe(false);
  });

  it('serving the Admin complaint detail reads NO route snapshot (spy on the repository)', async () => {
    const repo = w.app.running.app.get(RouteSnapshotRepository, { strict: false });
    const read = jest.spyOn(repo, 'read');
    try {
      const response = await w.adminGet(system, `/complaints/${complaintId}`);
      expect(response.status).toBe(200);
      expect(read).toHaveBeenCalledTimes(0);
    } finally {
      read.mockRestore();
    }
  });

  it('positive control: the Admin DELIVERY detail keeps the route and its geometry for the same delivery', async () => {
    const response = await w.adminGet(system, `/deliveries/${deliveryId}`);
    expect([response.status, response.text.slice(0, 200)]).toEqual([200, response.text.slice(0, 200)]);
    const view = adminData(response) as Json;
    expect(view.route).toEqual({ status: 'ROUTE', distance_m: 2500, duration_s: 420, route_version: ROUTE_VERSION, geometry: SHAPE });
    expect(view.legacy_reference_only).toBe(false);
  });
});
