import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { AppError } from '../../apps/backend/src/common/app-errors';
import { RouteLeg, encodePolyline6 } from '../../apps/backend/src/delivery/m14-route-client';
import { newOrderCode } from '../../apps/backend/src/orders/order-rules';
import { NewOrder, OrderRepository } from '../../apps/backend/src/orders/order-repository';
import { RouteSnapshotRepository } from '../../apps/backend/src/orders/route-snapshot-repository';
import { AuthApp, startAuthApp } from './support/auth-fixtures';
import { cleanupOrders, Customer, newCustomer, PRIVACY, TERMS } from './support/m10-fixtures';
import { asRuntimeRole, rolledBack } from './support/runtime-role';
import { createShopOwner, ShopOwner } from './support/shop-management-fixtures';

// P6-2 route snapshots read WITHOUT a row lock (no FOR KEY SHARE). Each test runs its route-snapshot work with the runtime matrix on
// app.route_snapshots (SELECT, INSERT: ops/selfhosted/02-runtime-grants.sql). Without it a lock that needs UPDATE would pass here and fail on the VPS
// with "permission denied for table route_snapshots". The transactions are rolled back; see support/runtime-role.ts for the limits.

const ROUTE_TABLE = 'app.route_snapshots';
const ROUTE_GRANTS = 'SELECT, INSERT';

function leg(): RouteLeg {
  const lat = 21 + Math.random() / 10;
  const lng = 105.8 + Math.random() / 10;
  return {
    distanceM: 1000 + Math.floor(Math.random() * 90000),
    seconds: 300,
    geometry: encodePolyline6([{ lat, lng }, { lat: lat + 0.01, lng: lng + 0.01 }]),
    routeVersion: `lockfree-${randomUUID()}`,
  };
}

describe('P6-2 route snapshots under the runtime privileges (no row lock)', () => {
  let app: AuthApp;
  let shop: ShopOwner;
  let customer: Customer;

  beforeAll(async () => {
    app = await startAuthApp({}, { relaxTimeouts: true, configOverride: { clientAuth: { termsVersion: TERMS, privacyVersion: PRIVACY } } });
    shop = await createShopOwner(app);
    customer = await newCustomer(app, 'Khách lock-free');
  });

  afterAll(async () => {
    await cleanupOrders(app, { shopIds: [shop.shopId], customerIds: [customer.userId], drivers: [], userIds: [customer.userId, shop.userId] });
    await app.close();
  });

  const asRoute = <T>(work: Parameters<typeof asRuntimeRole<T>>[3]): Promise<T> => asRuntimeRole(app, ROUTE_TABLE, ROUTE_GRANTS, work);

  it('(a) find() returns undefined for a snapshot that does not exist, and the stored row when it does (no UPDATE privilege needed)', async () => {
    const snapshots = app.running.app.get(RouteSnapshotRepository);
    const missing = await asRoute((context) => snapshots.find(context, randomUUID()));
    expect(missing).toBeUndefined();

    const found = await asRoute(async (context) => {
      const id = await snapshots.create(context, leg());
      return snapshots.find(context, id);
    });
    expect(found).toMatchObject({ distanceM: expect.any(Number), routeVersion: expect.stringMatching(/^lockfree-/) });
  });

  it('(b) create() with an identical route the second time (content_key conflict) returns the SAME snapshot id and stores one row', async () => {
    const snapshots = app.running.app.get(RouteSnapshotRepository);
    const route = leg();
    const outcome = await asRoute(async (context) => {
      const first = await snapshots.create(context, route);
      const second = await snapshots.create(context, route);
      const rows = await context.query<{ n: string }>('SELECT count(*)::text AS n FROM app.route_snapshots WHERE route_version = $1', [route.routeVersion]);
      return { first, second, rows: rows.rows[0]?.n };
    });
    expect(outcome.second).toBe(outcome.first);
    expect(outcome.rows).toBe('1');
  });

  it('(c) an Order that points to a snapshot which no longer exists fails with ORDER_QUOTE_CHANGED (the pair guard refuses it first), not a generic database error', async () => {
    const orders = app.running.app.get(OrderRepository);
    // The Order's distance must equal the snapshot's distance (the pair guard); the missing-snapshot case uses any distance.
    const order = (routeSnapshotId: string | null, distanceM = 2500): NewOrder => ({
      orderId: randomUUID(),
      code: newOrderCode(),
      clientRef: randomUUID(),
      customerUserId: customer.userId,
      shopId: shop.shopId,
      shopName: 'Quán lock-free',
      shopPhone: '0900000001',
      shopAddressText: 'Hà Nội',
      recipientName: 'Khách',
      recipientPhone: '0900000002',
      addressText: 'Hà Nội',
      addressLat: null,
      addressLng: null,
      sourceAddressId: null,
      note: null,
      deliveryNote: null,
      scheduledForMs: null,
      itemsTotalVnd: 45000,
      feeEstimateVnd: 10000,
      feeEstimateDistanceM: distanceM,
      routeSnapshotId,
    });

    const error = await asRoute((context) => orders.insert(context, order(randomUUID()), []).then(
      () => undefined,
      (caught: unknown) => caught,
    ));
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('ORDER_QUOTE_CHANGED');

    // Control: an Order that points to an existing snapshot is stored. It runs as the OWNER, not the restricted role: the foreign-key check on
    // orders.route_snapshot_id runs with the referenced table owner's privileges (the migrator in production), and revoking the owner's own UPDATE
    // here would break that check and tell us nothing about the runtime role. The restricted-role cases are the ones above and in (a) and (b).
    const stored = await rolledBack(app, async (context) => {
      const snapshots = app.running.app.get(RouteSnapshotRepository);
      const route = leg();
      const id = await snapshots.create(context, route);
      return orders.insert(context, order(id, route.distanceM), []);
    });
    expect(stored).toBe(true);
  });
});
