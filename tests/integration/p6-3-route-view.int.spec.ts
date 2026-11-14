import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { encodePolyline6, M14_ROUTING } from '../../apps/backend/src/delivery/m14-route-client';
import { ApiResponse, AuthApp, dataOf, startAuthApp } from './support/auth-fixtures';
import { cleanupOrders, codeOf, Customer, Dish, Json, newCustomer, newDish, newShipper, openAllWeek, PRIVACY, Shipper, TERMS } from './support/m10-fixtures';
import { createShopOwner, ShopOwner } from './support/shop-management-fixtures';
import { createLegacyDirectDelivery } from './support/legacy-direct-delivery';

// P6-3 (#294): the detail views of an Order and of its delivery carry `route` from the immutable snapshot (P6-2). Who sees the road (geometry):
// the customer of the Order, the shop of the Order, the Shipper while HOLDING the delivery; a Shipper who gave it back, another customer or shop, and
// every LIST never see it. An Order without a snapshot (before P6-2) gets route null and legacy_reference_only true.
describe('P6-3 route view: detail, lists, and who may see the road', () => {
  let app: AuthApp;
  let router: http.Server;
  let shop: ShopOwner;
  let alice: Customer;
  let bob: Customer;
  let pho: Dish;
  let shipper: Shipper;
  const drivers: string[] = [];
  let addedPolicy = false;
  let answer = { km: 2.5, version: 'valhalla-3.9.1/motorcycle-shortest/test-a', shape: '' };
  const SHAPE = encodePolyline6([{ lat: 21.0, lng: 105.82 }, { lat: 21.01, lng: 105.83 }, { lat: 21.02, lng: 105.84 }]);
  let addressCounter = 0;
  let orderId = '';
  let deliveryId = '';
  const LEGACY_ORDER = randomUUID();

  beforeAll(async () => {
    answer.shape = SHAPE;
    router = http.createServer((request, response) => {
      request.resume();
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ trip: { summary: { length: answer.km, time: 420 }, legs: [{ shape: answer.shape }] }, route_version: answer.version }));
    });
    await new Promise<void>((resolve) => router.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(router.address() as AddressInfo).port}`;
    app = await startAuthApp({}, { relaxTimeouts: true, configOverride: { clientAuth: { termsVersion: TERMS, privacyVersion: PRIVACY } }, overrides: [{ provide: M14_ROUTING, useValue: { origin, timeoutMs: 3000 } }] });
    shop = await createShopOwner(app);
    await openAllWeek(app, shop.shopId);
    alice = await newCustomer(app, 'Nguyễn Văn An');
    bob = await newCustomer(app, 'Trần Thị Bình');
    pho = await newDish(app, shop.token, 'Phở bò', 45_000);
    const existing = await app.pool.query('SELECT 1 FROM app.shipping_fee_policy_versions LIMIT 1');
    if ((existing.rowCount ?? 0) === 0) {
      await app.pool.query(
        `INSERT INTO app.shipping_fee_policy_versions (version_id, version_no, schema_version, tiers, applied_by, applied_at) VALUES ($1::uuid, 1, 2, $2::jsonb, $3::uuid, now())`,
        [randomUUID(), JSON.stringify([{ from_m: 0, to_m: 3000, fee_vnd: 10000 }, { from_m: 3000, to_m: 6000, fee_vnd: 15000 }, { from_m: 6000, to_m: 10000, fee_vnd: 20000 }]), shop.userId],
      );
      addedPolicy = true;
    }
    shipper = await newShipper(app, drivers, 50_000);
  });

  afterAll(async () => {
    await app.pool.query('ALTER TABLE app.address_change_requests DISABLE TRIGGER USER');
    await app.pool.query('DELETE FROM app.address_change_requests WHERE order_id IN (SELECT order_id FROM app.orders WHERE customer_user_id = ANY($1::uuid[]))', [[alice.userId, bob.userId]]);
    await app.pool.query('ALTER TABLE app.address_change_requests ENABLE TRIGGER USER');
    await cleanupOrders(app, { shopIds: [shop.shopId], customerIds: [alice.userId, bob.userId], drivers, userIds: [alice.userId, bob.userId, shop.userId, shipper.userId], policyAdded: addedPolicy });
    await app.close();
    await new Promise<void>((resolve) => router.close(() => resolve()));
  });

  // ---- helpers -------------------------------------------------------------------------------------------------------------------

  const ok = (response: ApiResponse, status = 200): Json => {
    expect([response.status, response.text.slice(0, 300)]).toEqual([status, response.text.slice(0, 300)]);
    return dataOf(response) as Json;
  };
  const asCustomer = (customer: Customer, method: 'POST' | 'GET', path: string, body?: unknown): Promise<ApiResponse> =>
    app.call(method, path, { bearer: customer.token, ...(method === 'POST' ? { headers: { 'idempotency-key': randomUUID() } } : {}), ...(body === undefined ? {} : { body }) });
  const asShop = (method: 'POST' | 'GET', path: string, body?: unknown): Promise<ApiResponse> =>
    app.call(method, path, { bearer: shop.token, ...(method === 'POST' ? { headers: { 'idempotency-key': randomUUID() } } : {}), ...(body === undefined ? {} : { body }) });
  const asShipper = (s: Shipper, method: 'POST' | 'GET', path: string, body?: unknown): Promise<ApiResponse> =>
    app.call(method, path, { bearer: s.token, ...(method === 'POST' ? { headers: { 'idempotency-key': randomUUID() } } : {}), ...(body === undefined ? {} : { body }) });
  const newAddress = (): Json => {
    addressCounter += 1;
    return { address_text: `Địa chỉ P6-3 ${addressCounter}`, lat: 21.0 + addressCounter * 0.0007, lng: 105.82 };
  };
  const line = (quantity: number): Json => ({ item_id: pho.itemId, quantity, unit_price_vnd: pho.price });
  const draft = (address: Json): Json => ({ shop_id: shop.shopId, lines: [{ item_id: pho.itemId, quantity: 1 }], recipient_name: 'An', recipient_phone: '0912345678', address });
  const orderRow = async (id: string): Promise<Json> => (await app.pool.query('SELECT * FROM app.orders WHERE order_id = $1::uuid', [id])).rows[0] as Json;
  /** The road must not appear anywhere in a response that is not allowed to carry it. */
  const hasRoad = (value: unknown): boolean => JSON.stringify(value).includes(SHAPE);

  // ---- the Order and its delivery exist (a priced checkout, confirmed by the shop, called to a Shipper) ----------------------

  it('setup: a priced Order with a snapshot is confirmed and called; its delivery points to the same snapshot', async () => {
    answer = { km: 2.5, version: 'valhalla-3.9.1/motorcycle-shortest/test-a', shape: SHAPE };
    const address = newAddress();
    const preview = ok(await asCustomer(alice, 'POST', '/customers/me/orders/preview', draft(address)));
    const fee = (preview.fee as Json);
    expect(fee).toMatchObject({ status: 'PRICED', distance_m: 2500, fee_vnd: 10_000 });
    const created = await asCustomer(alice, 'POST', '/customers/me/orders', {
      client_ref: randomUUID(),
      shop_id: shop.shopId,
      lines: [line(1)],
      items_total_vnd: pho.price,
      recipient_name: 'An',
      recipient_phone: '0912345678',
      address,
      expected_quote: { status: fee.status, distance_m: fee.distance_m, fee_vnd: fee.fee_vnd, reason: fee.reason, policy_version: fee.policy_version, snapshot: fee.snapshot, route_snapshot_id: fee.route_snapshot_id },
    });
    expect(created.status).toBe(201);
    orderId = String((dataOf(created) as Json).order_id);
    const confirmed = await app.call('POST', `/shop/me/orders/${orderId}/confirm`, { bearer: shop.token, headers: { 'idempotency-key': randomUUID() }, body: { expected_version: Number((await orderRow(orderId)).version) } });
    expect(confirmed.status).toBe(200);
    const called = await app.call('POST', `/shop/me/orders/${orderId}/call-shipper`, { bearer: shop.token, headers: { 'idempotency-key': randomUUID() }, body: { expected_version: Number((await orderRow(orderId)).version) } });
    expect(called.status).toBeLessThan(300);
    deliveryId = String((await app.pool.query('SELECT delivery_id::text AS id FROM app.deliveries WHERE order_id = $1::uuid', [orderId])).rows[0]?.id);
    expect(deliveryId).toMatch(/^[0-9a-f-]{36}$/);
    const pointers = (await app.pool.query('SELECT o.route_snapshot_id::text AS o_snap, d.route_snapshot_id::text AS d_snap FROM app.orders o JOIN app.deliveries d ON d.order_id = o.order_id WHERE o.order_id = $1::uuid', [orderId])).rows[0];
    expect(pointers?.o_snap).toBeTruthy();
    expect(pointers?.d_snap).toBe(pointers?.o_snap);
  });

  // ---- the customer -------------------------------------------------------------------------------------------------------------

  it('the customer of the Order gets route with distance equal to the fee, the time, the version and the road', async () => {
    const view = ok(await asCustomer(alice, 'GET', `/customers/me/orders/${orderId}`));
    expect(view.legacy_reference_only).toBe(false);
    expect((view.money as Json).fee).toMatchObject({ distance_m: 2500 });
    expect(view.route).toEqual({ status: 'ROUTE', distance_m: 2500, duration_s: 420, route_version: answer.version, geometry: SHAPE });
    expect((view.route as Json).distance_m).toBe(((view.money as Json).fee as Json).distance_m);
  });

  it('the customer of the Order gets the same route in the order\'s delivery; the delivery distance equals the route distance', async () => {
    // The order-derived delivery is read through the Order (GET /customers/me/deliveries/:id only serves calls the customer created themselves).
    const delivery = (ok(await asCustomer(alice, 'GET', `/customers/me/orders/${orderId}`)).delivery) as Json;
    expect(delivery.delivery_id).toBe(deliveryId);
    expect(delivery.legacy_reference_only).toBe(false);
    expect(delivery.route).toEqual({ status: 'ROUTE', distance_m: 2500, duration_s: 420, route_version: answer.version, geometry: SHAPE });
    expect((delivery.fee as Json).distance_m).toBe((delivery.route as Json).distance_m);
  });

  it('the customer LIST of deliveries carries no route key and no road (shape check: the customer list shows only calls the customer created)', async () => {
    const list = ok(await asCustomer(alice, 'GET', '/customers/me/deliveries'));
    for (const row of list.deliveries as Json[]) {
      expect('route' in row).toBe(false);
      expect('legacy_reference_only' in row).toBe(false);
    }
    expect(hasRoad(list)).toBe(false);
  });

  it('the customer LIST of orders carries no route and no road', async () => {
    const list = ok(await asCustomer(alice, 'GET', '/customers/me/orders'));
    expect(JSON.stringify(list)).not.toContain('"route"');
    expect(hasRoad(list)).toBe(false);
  });

  it('another customer cannot read the Order or its delivery: refused and no road in the body', async () => {
    const order = await asCustomer(bob, 'GET', `/customers/me/orders/${orderId}`);
    const delivery = await asCustomer(bob, 'GET', `/customers/me/deliveries/${deliveryId}`);
    expect(order.status).toBeGreaterThanOrEqual(400);
    expect(delivery.status).toBeGreaterThanOrEqual(400);
    expect(order.text.includes(SHAPE) || delivery.text.includes(SHAPE)).toBe(false);
    expect(codeOf(order)).toBeDefined();
  });

  // ---- the shop ---------------------------------------------------------------------------------------------------------------

  it('the shop of the Order gets the road in the order detail and the delivery detail', async () => {
    const order = ok(await asShop('GET', `/shop/me/orders/${orderId}`));
    expect(order.route).toEqual({ status: 'ROUTE', distance_m: 2500, duration_s: 420, route_version: answer.version, geometry: SHAPE });
    expect(order.legacy_reference_only).toBe(false);
    const delivery = ok(await asShop('GET', `/shop/me/deliveries/${deliveryId}`));
    expect(delivery.route).toMatchObject({ distance_m: 2500, geometry: SHAPE });
  });

  it('the shop LIST of deliveries carries no route key and no road', async () => {
    const list = ok(await asShop('GET', '/shop/me/deliveries'));
    for (const row of list.deliveries as Json[]) {
      expect('route' in row).toBe(false);
    }
    expect(hasRoad(list)).toBe(false);
  });

  // ---- the Shipper ----------------------------------------------------------------------------------------------------------

  it('the Shipper HOLDING the delivery gets the road in the detail; the delivery is accepted first', async () => {
    const accepted = await asShipper(shipper, 'POST', `/driver/deliveries/${deliveryId}/accept`, {});
    expect([accepted.status, accepted.text.slice(0, 200)]).toEqual([200, accepted.text.slice(0, 200)]);
    const detail = ok(await asShipper(shipper, 'GET', `/driver/deliveries/${deliveryId}`));
    expect(detail.route).toEqual({ status: 'ROUTE', distance_m: 2500, duration_s: 420, route_version: answer.version, geometry: SHAPE });
    expect(detail.legacy_reference_only).toBe(false);
  });

  it('the Shipper LIST of their deliveries carries no route key and no road', async () => {
    const list = ok(await asShipper(shipper, 'GET', '/driver/deliveries/mine?scope=active'));
    for (const row of list.deliveries as Json[]) {
      expect('route' in row).toBe(false);
    }
    expect(hasRoad(list)).toBe(false);
  });

  it('the Shipper who gave the delivery back keeps the distance but loses the road: no geometry key', async () => {
    const current = ok(await asShipper(shipper, 'GET', `/driver/deliveries/${deliveryId}`));
    const released = await asShipper(shipper, 'POST', `/driver/deliveries/${deliveryId}/release`, { reason: 'Xe hỏng', expected_version: current.version });
    expect([released.status, released.text.slice(0, 200)]).toEqual([200, released.text.slice(0, 200)]);
    const after = ok(await asShipper(shipper, 'GET', `/driver/deliveries/${deliveryId}`));
    expect(after.route).toEqual({ status: 'ROUTE', distance_m: 2500, duration_s: 420, route_version: answer.version });
    expect(hasRoad(after)).toBe(false);
  });

  // ---- a DIRECT call created by the shop (never through a checkout quote): route null, and the flag is FALSE (it is not a legacy customer record)

  it('a shop-created DIRECT call gets route null and legacy_reference_only false, in the shop detail; its distance is kept', async () => {
    const directId = await createLegacyDirectDelivery(app, { userId: shop.userId, shopId: shop.shopId }, {
      recipient_name: 'Khách trực tiếp',
      recipient_phone: '0912345678',
      dropoff_address_text: '12 Phố Huế, Hai Bà Trưng, Hà Nội',
      dropoff_lat: 21.0,
      dropoff_lng: 105.82,
      goods_description: 'Hộp quà',
      goods_value_vnd: 200_000,
      paid_vnd: 0,
      fee_payer: 'CUSTOMER',
      distance_m: 2500,
    });
    const view = ok(await asShop('GET', `/shop/me/deliveries/${directId}`));
    expect(view.source).toBe('DIRECT');
    expect(view.route).toBeNull();
    expect(view.legacy_reference_only).toBe(false);
    expect((view.fee as Json).distance_m).toBe(2500);
    expect(hasRoad(view)).toBe(false);
  });

  // ---- an Order without a snapshot (before P6-2) ------------------------------------------------------------------------------

  it('an Order written before P6-2 (no snapshot pointer) gets route null and legacy_reference_only true, and its distance stays', async () => {
    const client = await app.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE app.orders DISABLE TRIGGER USER');
      await client.query(
        `INSERT INTO app.orders (order_id, code, client_ref, customer_user_id, shop_id, status, shop_name, shop_phone, shop_address_text,
           recipient_name, recipient_phone, address_text, address_lat, address_lng, fee_estimate_vnd, fee_estimate_distance_m,
           items_original_total_vnd, items_total_vnd, paid_vnd, version, created_at, updated_at)
         VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5::uuid, 'PENDING_CONFIRMATION', 'Tiệm cũ', '+84900000001', '123 Phố Huế',
           'Người nhận cũ', '+84912345678', '456 Cầu Giấy', 21.03, 105.78, 10000, 2500, 45000, 45000, 0, 1, now(), now())`,
        [LEGACY_ORDER, `OD-${LEGACY_ORDER.slice(0, 8)}`, randomUUID(), alice.userId, shop.shopId],
      );
      await client.query('ALTER TABLE app.orders ENABLE TRIGGER USER');
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    const view = ok(await asCustomer(alice, 'GET', `/customers/me/orders/${LEGACY_ORDER}`));
    expect(view.route).toBeNull();
    expect(view.legacy_reference_only).toBe(true);
    expect((view.money as Json).fee).toMatchObject({ distance_m: 2500 });
    const shopView = ok(await asShop('GET', `/shop/me/orders/${LEGACY_ORDER}`));
    expect(shopView).toMatchObject({ route: null, legacy_reference_only: true });
  });
});
