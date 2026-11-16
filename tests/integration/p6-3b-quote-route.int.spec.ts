import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { encodePolyline6, M14_ROUTING } from '../../apps/backend/src/delivery/m14-route-client';
import { ApiResponse, AuthApp, dataOf, startAuthApp } from './support/auth-fixtures';
import { cleanupOrders, codeOf, Customer, Dish, Json, newCustomer, newDish, openAllWeek, PRIVACY, TERMS } from './support/m10-fixtures';
import { createShopOwner, ShopOwner } from './support/shop-management-fixtures';

// P6-3b (#294): the checkout preview (the quote) carries `fee.route` read from the immutable snapshot the quote points to (P6-2), with the same shape
// as the P6-3 route view. The routing service is a REAL local HTTP server whose answer the test controls. No other endpoint carries a route in its fee.
describe('P6-3b quote route: preview fee.route from the quote snapshot', () => {
  let app: AuthApp;
  let router: http.Server;
  let shop: ShopOwner;
  let alice: Customer;
  let pho: Dish;
  let addedPolicy = false;
  // The fake routing answer. `fail` makes M14 answer 500 (no route for the quote).
  let answer: { km: number; version: string; shape: string; fail: boolean } = { km: 2.5, version: 'valhalla-3.9.1/motorcycle-shortest/test-p63b-a', shape: '', fail: false };
  // Answers handed out before `answer`, one per M14 call (empty in every test but the one that counts calls), and the number of M14 calls received.
  let queued: Array<{ km: number; version: string; shape: string }> = [];
  let routerCalls = 0;
  const VERSION_A = 'valhalla-3.9.1/motorcycle-shortest/test-p63b-a';
  const VERSION_B = 'valhalla-3.9.1/motorcycle-shortest/test-p63b-b';
  const SHAPE_A = encodePolyline6([{ lat: 21.0, lng: 105.82 }, { lat: 21.01, lng: 105.83 }, { lat: 21.02, lng: 105.84 }]);
  const SHAPE_B = encodePolyline6([{ lat: 21.0, lng: 105.82 }, { lat: 21.0, lng: 105.9 }, { lat: 21.02, lng: 105.84 }]);
  let addressCounter = 0;

  beforeAll(async () => {
    answer.shape = SHAPE_A;
    router = http.createServer((request, response) => {
      request.resume();
      routerCalls += 1;
      response.setHeader('content-type', 'application/json');
      if (answer.fail) {
        response.statusCode = 500;
        response.end('{}');
        return;
      }
      const reply = queued.shift() ?? answer;
      response.end(JSON.stringify({ trip: { summary: { length: reply.km, time: 420 }, legs: [{ shape: reply.shape }] }, route_version: reply.version }));
    });
    await new Promise<void>((resolve) => router.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(router.address() as AddressInfo).port}`;
    app = await startAuthApp({}, { relaxTimeouts: true, configOverride: { clientAuth: { termsVersion: TERMS, privacyVersion: PRIVACY } }, overrides: [{ provide: M14_ROUTING, useValue: { origin, timeoutMs: 3000 } }] });
    shop = await createShopOwner(app);
    await openAllWeek(app, shop.shopId);
    alice = await newCustomer(app, 'Nguyễn Văn Bình');
    pho = await newDish(app, shop.token, 'Phở gà', 45_000);
    const existing = await app.pool.query('SELECT 1 FROM app.shipping_fee_policy_versions LIMIT 1');
    if ((existing.rowCount ?? 0) === 0) {
      await app.pool.query(
        `INSERT INTO app.shipping_fee_policy_versions (version_id, version_no, schema_version, tiers, applied_by, applied_at) VALUES ($1::uuid, 1, 2, $2::jsonb, $3::uuid, now())`,
        [randomUUID(), JSON.stringify([{ from_m: 0, to_m: 3000, fee_vnd: 10000 }, { from_m: 3000, to_m: 6000, fee_vnd: 15000 }, { from_m: 6000, to_m: 10000, fee_vnd: 20000 }]), shop.userId],
      );
      addedPolicy = true;
    }
  });

  afterAll(async () => {
    await app.pool.query('ALTER TABLE app.address_change_requests DISABLE TRIGGER USER');
    await app.pool.query('DELETE FROM app.address_change_requests WHERE order_id IN (SELECT order_id FROM app.orders WHERE customer_user_id = $1::uuid)', [alice.userId]);
    await app.pool.query('ALTER TABLE app.address_change_requests ENABLE TRIGGER USER');
    await cleanupOrders(app, { shopIds: [shop.shopId], customerIds: [alice.userId], drivers: [], userIds: [alice.userId, shop.userId], policyAdded: addedPolicy });
    await app.close();
    await new Promise<void>((resolve) => router.close(() => resolve()));
  });

  // ---- helpers -------------------------------------------------------------------------------------------------------------

  const ok = (response: ApiResponse, status = 200): Json => {
    expect([response.status, response.text.slice(0, 300)]).toEqual([status, response.text.slice(0, 300)]);
    return dataOf(response) as Json;
  };
  const refused = (response: ApiResponse): { status: number; code: string | undefined } => ({ status: response.status, code: codeOf(response) });
  const asCustomer = (method: 'POST' | 'GET', path: string, body?: unknown): Promise<ApiResponse> =>
    app.call(method, path, { bearer: alice.token, ...(method === 'POST' ? { headers: { 'idempotency-key': randomUUID() } } : {}), ...(body === undefined ? {} : { body }) });
  const line = (quantity: number): Json => ({ item_id: pho.itemId, quantity, unit_price_vnd: pho.price });
  /** A fresh address per call: each one is a new M14 leg (the route client caches legs by their exact endpoints). */
  const newAddress = (): Json => {
    addressCounter += 1;
    return { address_text: `Địa chỉ P6-3b ${addressCounter}`, lat: 21.0 + addressCounter * 0.0007, lng: 105.82 };
  };
  const draft = (address: Json): Json => ({ shop_id: shop.shopId, lines: [{ item_id: pho.itemId, quantity: 1 }], recipient_name: 'Bình', recipient_phone: '0912345678', address });
  const previewRaw = (address: Json): Promise<ApiResponse> => asCustomer('POST', '/customers/me/orders/preview', draft(address));
  const preview = async (address: Json): Promise<Json> => ok(await previewRaw(address));
  const checkoutBody = (address: Json, fee: Json, extra: Json = {}): Json => ({
    client_ref: randomUUID(),
    shop_id: shop.shopId,
    lines: [line(1)],
    items_total_vnd: pho.price,
    recipient_name: 'Bình',
    recipient_phone: '0912345678',
    address,
    expected_quote: { status: fee.status, distance_m: fee.distance_m, fee_vnd: fee.fee_vnd, reason: fee.reason, policy_version: fee.policy_version, snapshot: fee.snapshot, ...extra },
  });
  const snapshotRow = async (id: string): Promise<Json | undefined> => (await app.pool.query('SELECT * FROM app.route_snapshots WHERE id = $1::uuid', [id])).rows[0] as Json | undefined;
  const expectNoOrderFor = async (clientRef: string): Promise<void> => {
    expect((await app.pool.query('SELECT 1 FROM app.orders WHERE client_ref = $1::uuid', [clientRef])).rowCount).toBe(0);
  };

  it('the preview fee.route is the road of the snapshot the quote points to: same metres, time, version and geometry', async () => {
    answer = { km: 2.5, version: VERSION_A, shape: SHAPE_A, fail: false };
    const fee = await preview(newAddress());
    const quote = fee.fee as Json;
    expect(quote).toMatchObject({ status: 'PRICED', distance_m: 2500, fee_vnd: 10_000 });
    const id = String(quote.route_snapshot_id);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const route = quote.route as Json;
    // The same shape as the P6-3 route view: status, distance_m, duration_s, route_version, geometry.
    expect(route).toEqual({ status: 'ROUTE', distance_m: 2500, duration_s: 420, route_version: VERSION_A, geometry: SHAPE_A });
    expect(route.distance_m).toBe(quote.distance_m);
    expect(await snapshotRow(id)).toMatchObject({ route_version: route.route_version, distance_m: route.distance_m, duration_s: route.duration_s, geometry: route.geometry });
  });

  it('one preview asks M14 once and fee.route is the stored snapshot byte for byte, never a second answer', async () => {
    // The first M14 answer is the road the quote stores. A second answer (a route measured again) is a different road, so it can be told apart.
    answer = { km: 2.5, version: VERSION_A, shape: SHAPE_A, fail: false };
    queued = [
      { km: 2.5, version: VERSION_A, shape: SHAPE_A },
      { km: 3.9, version: VERSION_B, shape: SHAPE_B },
    ];
    const callsBefore = routerCalls;
    try {
      const fee = await preview(newAddress());
      const quote = fee.fee as Json;
      // Exactly one M14 call for the preview, as before P6-3b: fee.route adds no call, and the second answer is never asked for.
      expect(routerCalls - callsBefore).toBe(1);
      expect(queued).toHaveLength(1);
      expect(quote).toMatchObject({ status: 'PRICED', distance_m: 2500 });
      // The route of the preview equals the stored row the quote points to, field by field, and not the second answer.
      const row = await snapshotRow(String(quote.route_snapshot_id));
      expect(row).toMatchObject({ route_version: VERSION_A, distance_m: 2500, duration_s: 420, geometry: SHAPE_A });
      expect(quote.route).toEqual({ status: 'ROUTE', distance_m: row?.distance_m, duration_s: row?.duration_s, route_version: row?.route_version, geometry: row?.geometry });
      expect((quote.route as Json).geometry).not.toBe(SHAPE_B);
    } finally {
      queued = [];
      answer = { km: 2.5, version: VERSION_A, shape: SHAPE_A, fail: false };
    }
  });

  it('no snapshot (the route could not be measured) gives fee.route null and no route_snapshot_id', async () => {
    answer = { km: 2.5, version: VERSION_A, shape: SHAPE_A, fail: true };
    try {
      const fee = await preview(newAddress());
      const quote = fee.fee as Json;
      expect(quote).toMatchObject({ status: 'UNAVAILABLE', reason: 'ROUTE_UNAVAILABLE', route_snapshot_id: null });
      expect(quote).toHaveProperty('route', null);
    } finally {
      answer = { km: 2.5, version: VERSION_A, shape: SHAPE_A, fail: false };
    }
  });

  it('a route version change afterwards does not change the route of a quote already issued', async () => {
    answer = { km: 2.5, version: VERSION_A, shape: SHAPE_A, fail: false };
    const addressX = newAddress();
    const quoteX = (await preview(addressX)).fee as Json;
    const idX = String(quoteX.route_snapshot_id);
    const routeX = quoteX.route as Json;
    expect(routeX).toMatchObject({ route_version: VERSION_A, geometry: SHAPE_A });

    // M14 now answers with another engine version and another road. A new quote for another address gets the new road.
    answer = { km: 2.5, version: VERSION_B, shape: SHAPE_B, fail: false };
    const quoteY = (await preview(newAddress())).fee as Json;
    expect(quoteY.route).toMatchObject({ route_version: VERSION_B, geometry: SHAPE_B });
    expect(String(quoteY.route_snapshot_id)).not.toBe(idX);

    // The quote issued before the change keeps its stored road, and the object the customer already holds does not change.
    expect(await snapshotRow(idX)).toMatchObject({ route_version: VERSION_A, geometry: SHAPE_A, distance_m: 2500 });
    expect(routeX).toMatchObject({ route_version: VERSION_A, geometry: SHAPE_A });

    // Placing with the old quote is refused: the fresh road for that address is the new one, so the Order is not created on the old quote.
    const body = checkoutBody(addressX, quoteX, { route_snapshot_id: idX });
    expect(refused(await asCustomer('POST', '/customers/me/orders', body))).toEqual({ status: 409, code: 'ORDER_QUOTE_CHANGED' });
    await expectNoOrderFor(String(body.client_ref));
    answer = { km: 2.5, version: VERSION_A, shape: SHAPE_A, fail: false };
  });

  it('no other endpoint carries a route in its fee: place, the Order detail money, the lists', async () => {
    answer = { km: 2.5, version: VERSION_A, shape: SHAPE_A, fail: false };
    const address = newAddress();
    const fee = await preview(address);
    const quote = fee.fee as Json;
    expect(quote.route).not.toBeNull();
    const placed = await asCustomer('POST', '/customers/me/orders', checkoutBody(address, quote, { route_snapshot_id: String(quote.route_snapshot_id) }));
    expect(placed.status).toBe(201);
    const placedData = dataOf(placed) as Json;
    const orderId = String(placedData.order_id);
    // The place response (an Order view, which carries the P6-3 top-level route) and the Order detail: the money fee block never carries a road.
    expect(placedData).toHaveProperty('money');
    expect((placedData.money as Json).fee).toMatchObject({ distance_m: 2500 });
    expect((placedData.money as Json).fee).not.toHaveProperty('route');
    const detail = ok(await asCustomer('GET', `/customers/me/orders/${orderId}`));
    expect((detail.money as Json).fee).toMatchObject({ distance_m: 2500 });
    expect((detail.money as Json).fee).not.toHaveProperty('route');
    // List views never carry a route at all.
    const list = await asCustomer('GET', '/customers/me/orders');
    expect(list.status).toBe(200);
    expect(list.text).not.toContain('"route"');
    // A later preview still gets its own road: the placed Order does not change what a new quote shows.
    const again = (await preview(newAddress())).fee as Json;
    expect(again.route).toMatchObject({ status: 'ROUTE' });
  });
});
