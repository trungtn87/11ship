import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { encodePolyline6, M14_ROUTING } from '../../apps/backend/src/delivery/m14-route-client';
import { ApiResponse, AuthApp, dataOf, startAuthApp } from './support/auth-fixtures';
import { cleanupOrders, codeOf, Customer, Dish, Json, newCustomer, newDish, openAllWeek, PRIVACY, TERMS } from './support/m10-fixtures';
import { createShopOwner, ShopOwner } from './support/shop-management-fixtures';

// P6-2 (#294): a checkout quote owns an immutable route snapshot; the Order and its delivery point to the snapshot the customer saw.
// The routing service is a REAL local HTTP server whose answer the test controls (distance, route_version, geometry).
describe('P6-2 route snapshots: quote, place, delivery, immutability', () => {
  let app: AuthApp;
  let router: http.Server;
  let shop: ShopOwner;
  let alice: Customer;
  let pho: Dish;
  let addedPolicy = false;
  // The fake routing answer: one leg, the given metres, version and road.
  let answer = { km: 2.5, version: 'valhalla-3.9.1/motorcycle-shortest/test-a', shape: '' };
  const SHAPE_A = encodePolyline6([{ lat: 21.0, lng: 105.82 }, { lat: 21.01, lng: 105.83 }, { lat: 21.02, lng: 105.84 }]);
  const SHAPE_B = encodePolyline6([{ lat: 21.0, lng: 105.82 }, { lat: 21.0, lng: 105.9 }, { lat: 21.02, lng: 105.84 }]);
  let addressCounter = 0;
  const SHAPE_C = encodePolyline6([{ lat: 21.0, lng: 105.82 }, { lat: 21.05, lng: 105.8 }, { lat: 21.02, lng: 105.84 }]);
  // The order of the first placed test: its delivery is used by the pair and race tests.
  let firstOrderId = '';

  beforeAll(async () => {
    answer.shape = SHAPE_A;
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
    pho = await newDish(app, shop.token, 'Phở bò', 45_000);
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
    // The address-change request this suite writes points at its Order: it is removed first (the table is never deleted by the app).
    await app.pool.query('ALTER TABLE app.address_change_requests DISABLE TRIGGER USER');
    await app.pool.query('DELETE FROM app.address_change_requests WHERE order_id IN (SELECT order_id FROM app.orders WHERE customer_user_id = $1::uuid)', [alice.userId]);
    await app.pool.query('ALTER TABLE app.address_change_requests ENABLE TRIGGER USER');
    await cleanupOrders(app, { shopIds: [shop.shopId], customerIds: [alice.userId], drivers: [], userIds: [alice.userId, shop.userId], policyAdded: addedPolicy });
    await app.close();
    await new Promise<void>((resolve) => router.close(() => resolve()));
  });

  // ---- helpers -------------------------------------------------------------------------------------------------------------------

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
    return { address_text: `Địa chỉ thử ${addressCounter}`, lat: 21.0 + addressCounter * 0.0007, lng: 105.82 };
  };
  const draft = (address: Json): Json => ({ shop_id: shop.shopId, lines: [{ item_id: pho.itemId, quantity: 1 }], recipient_name: 'An', recipient_phone: '0912345678', address });
  const preview = async (address: Json): Promise<Json> => ok(await asCustomer('POST', '/customers/me/orders/preview', draft(address)));
  const checkoutBody = (address: Json, fee: Json, extra: Json = {}): Json => ({
    client_ref: randomUUID(),
    shop_id: shop.shopId,
    lines: [line(1)],
    items_total_vnd: pho.price,
    recipient_name: 'An',
    recipient_phone: '0912345678',
    address,
    expected_quote: { status: fee.status, distance_m: fee.distance_m, fee_vnd: fee.fee_vnd, reason: fee.reason, policy_version: fee.policy_version, snapshot: fee.snapshot, ...extra },
  });
  const placeOn = async (address: Json, fee: Json, extra: Json = {}): Promise<ApiResponse> => {
    return asCustomer('POST', '/customers/me/orders', checkoutBody(address, fee, extra));
  };
  const orderRow = async (id: string): Promise<Json> => (await app.pool.query('SELECT * FROM app.orders WHERE order_id = $1::uuid', [id])).rows[0] as Json;
  const snapshotRow = async (id: string): Promise<Json | undefined> => (await app.pool.query('SELECT * FROM app.route_snapshots WHERE id = $1::uuid', [id])).rows[0] as Json | undefined;
  const expectNoOrderFor = async (clientRef: string): Promise<void> => {
    expect((await app.pool.query('SELECT 1 FROM app.orders WHERE client_ref = $1::uuid', [clientRef])).rowCount).toBe(0);
  };

  it('the preview writes the snapshot of its own route and returns its id', async () => {
    answer = { km: 2.5, version: 'valhalla-3.9.1/motorcycle-shortest/test-a', shape: SHAPE_A };
    const fee = await preview(newAddress());
    expect(fee.fee).toMatchObject({ status: 'PRICED', distance_m: 2500, fee_vnd: 10_000 });
    const id = String((fee.fee as Json).route_snapshot_id);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await snapshotRow(id)).toMatchObject({ route_version: answer.version, distance_m: 2500, duration_s: 420, geometry: SHAPE_A });
  });

  it('the Order and its delivery carry the snapshot the customer saw: one distance in the order, the delivery and the views', async () => {
    answer = { km: 2.5, version: 'valhalla-3.9.1/motorcycle-shortest/test-a', shape: SHAPE_A };
    const address = newAddress();
    const fee = await preview(address);
    const snapshotId = String((fee.fee as Json).route_snapshot_id);
    const created = await placeOn(address, fee.fee as Json, { route_snapshot_id: snapshotId });
    expect(created.status).toBe(201);
    const orderId = String((dataOf(created) as Json).order_id);
    firstOrderId = orderId;
    expect(await orderRow(orderId)).toMatchObject({ route_snapshot_id: snapshotId, fee_estimate_distance_m: 2500 });
    expect(ok(await asCustomer('GET', `/customers/me/orders/${orderId}`)).money).toMatchObject({ fee: { distance_m: 2500 } });

    const order = await orderRow(orderId);
    const confirmed = await app.call('POST', `/shop/me/orders/${orderId}/confirm`, { bearer: shop.token, headers: { 'idempotency-key': randomUUID() }, body: { expected_version: Number(order.version) } });
    expect(confirmed.status).toBe(200);
    const called = await app.call('POST', `/shop/me/orders/${orderId}/call-shipper`, { bearer: shop.token, headers: { 'idempotency-key': randomUUID() }, body: { expected_version: Number((await orderRow(orderId)).version) } });
    expect(called.status).toBeLessThan(300);
    const deliveries = (await app.pool.query('SELECT route_snapshot_id::text AS route_snapshot_id, route_distance_m FROM app.deliveries WHERE order_id = $1::uuid', [orderId])).rows as Json[];
    expect(deliveries).toEqual([{ route_snapshot_id: snapshotId, route_distance_m: 2500 }]);
  });

  it('a quote that names a snapshot of another route is ORDER_QUOTE_CHANGED and nothing is created (distance differs)', async () => {
    answer = { km: 2.5, version: 'valhalla-3.9.1/motorcycle-shortest/test-a', shape: SHAPE_A };
    const addressA = newAddress();
    const feeA = (await preview(addressA)).fee as Json;
    answer = { km: 4.0, version: 'valhalla-3.9.1/motorcycle-shortest/test-a', shape: SHAPE_A };
    const feeC = (await preview(newAddress())).fee as Json;
    const body = checkoutBody(addressA, feeA, { route_snapshot_id: String(feeC.route_snapshot_id) });
    expect(refused(await asCustomer('POST', '/customers/me/orders', body))).toEqual({ status: 409, code: 'ORDER_QUOTE_CHANGED' });
    await expectNoOrderFor(String(body.client_ref));
  });

  it('a snapshot with the same distance but another road is ORDER_QUOTE_CHANGED: the geometry is part of the quote', async () => {
    answer = { km: 2.5, version: 'valhalla-3.9.1/motorcycle-shortest/test-a', shape: SHAPE_A };
    const addressA = newAddress();
    const feeA = (await preview(addressA)).fee as Json;
    answer = { km: 2.5, version: 'valhalla-3.9.1/motorcycle-shortest/test-a', shape: SHAPE_B };
    const feeB = (await preview(newAddress())).fee as Json;
    answer = { km: 2.5, version: 'valhalla-3.9.1/motorcycle-shortest/test-a', shape: SHAPE_A };
    const body = checkoutBody(addressA, feeA, { route_snapshot_id: String(feeB.route_snapshot_id) });
    expect(refused(await asCustomer('POST', '/customers/me/orders', body))).toEqual({ status: 409, code: 'ORDER_QUOTE_CHANGED' });
    await expectNoOrderFor(String(body.client_ref));
  });

  it('a client from before snapshots (no id) still places: a fresh snapshot of the same leg is taken for the Order', async () => {
    answer = { km: 2.5, version: 'valhalla-3.9.1/motorcycle-shortest/test-a', shape: SHAPE_A };
    const address = newAddress();
    const fee = (await preview(address)).fee as Json;
    const created = await placeOn(address, fee);
    expect(created.status).toBe(201);
    const orderId = String((dataOf(created) as Json).order_id);
    const row = await orderRow(orderId);
    expect(row.route_snapshot_id).toEqual(expect.any(String));
    // Identical route: the same row (content identity), not a copy.
    expect(row.route_snapshot_id).toBe(fee.route_snapshot_id);
    expect(await snapshotRow(String(row.route_snapshot_id))).toMatchObject({ distance_m: 2500, geometry: SHAPE_A });
  });

  it('a later route profile or map version does not change the geometry or the distance of a placed Order', async () => {
    answer = { km: 2.5, version: 'valhalla-3.9.1/motorcycle-shortest/test-a', shape: SHAPE_A };
    const address = newAddress();
    const fee = (await preview(address)).fee as Json;
    const snapshotId = String(fee.route_snapshot_id);
    const created = await placeOn(address, fee, { route_snapshot_id: snapshotId });
    expect(created.status).toBe(201);
    const orderId = String((dataOf(created) as Json).order_id);
    // The routing profile and map data change; a new quote for another address gets the new version and road.
    answer = { km: 3.1, version: 'valhalla-4.0.0/motorcycle-shortest/test-b', shape: SHAPE_B };
    const later = (await preview(newAddress())).fee as Json;
    expect(later.distance_m).toBe(3100);
    expect(await snapshotRow(String(later.route_snapshot_id))).toMatchObject({ route_version: 'valhalla-4.0.0/motorcycle-shortest/test-b', geometry: SHAPE_B });
    expect(await snapshotRow(snapshotId)).toMatchObject({ route_version: 'valhalla-3.9.1/motorcycle-shortest/test-a', distance_m: 2500, geometry: SHAPE_A });
    expect(await orderRow(orderId)).toMatchObject({ route_snapshot_id: snapshotId, fee_estimate_distance_m: 2500 });
    answer = { km: 2.5, version: 'valhalla-3.9.1/motorcycle-shortest/test-a', shape: SHAPE_A };
  });

  it('an unpinned checkout has no snapshot and no distance; an Order without a route keeps NULL', async () => {
    const unpinned = { address_text: 'Không có ghim' };
    const fee = (await preview(unpinned)).fee as Json;
    expect(fee).toMatchObject({ status: 'UNAVAILABLE', distance_m: null, route_snapshot_id: null });
    const created = await placeOn(unpinned, fee);
    expect(created.status).toBe(201);
    const orderId = String((dataOf(created) as Json).order_id);
    expect(await orderRow(orderId)).toMatchObject({ route_snapshot_id: null, fee_estimate_distance_m: null });
  });

  it('an Order written without any snapshot pointer (before P6-2) keeps NULL and its distance', async () => {
    const orderId = randomUUID();
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
        [orderId, `OD-${orderId.slice(0, 8)}`, randomUUID(), alice.userId, shop.shopId],
      );
      await client.query('ALTER TABLE app.orders ENABLE TRIGGER USER');
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    expect(await orderRow(orderId)).toMatchObject({ route_snapshot_id: null, fee_estimate_distance_m: 2500 });
  });

  it('snapshot rows are append-only: UPDATE, DELETE and TRUNCATE are refused', async () => {
    answer = { km: 2.5, version: 'valhalla-3.9.1/motorcycle-shortest/test-a', shape: SHAPE_A };
    const fee = (await preview(newAddress())).fee as Json;
    const id = String(fee.route_snapshot_id);
    await expect(app.pool.query('UPDATE app.route_snapshots SET distance_m = 1 WHERE id = $1::uuid', [id])).rejects.toThrow(/append-only/);
    await expect(app.pool.query('DELETE FROM app.route_snapshots WHERE id = $1::uuid', [id])).rejects.toThrow(/append-only/);
    // TRUNCATE is refused too (by the append-only trigger, or earlier by the foreign key of the Orders that point at the rows).
    await expect(app.pool.query('TRUNCATE app.route_snapshots')).rejects.toThrow();
    expect(await snapshotRow(id)).toMatchObject({ distance_m: 2500 });
  });

  // ---- review round 2 (#346): content identity, retention, the pointer/distance pair, races -----------------------------------

  const countSnapshots = async (routeVersion: string): Promise<number> =>
    Number((await app.pool.query('SELECT count(*)::int AS n FROM app.route_snapshots WHERE route_version = $1', [routeVersion])).rows[0]?.n);
  const purge = async (olderThan: string): Promise<number> =>
    Number((await app.pool.query('SELECT app.purge_unreferenced_route_snapshots($1::interval)::int AS n', [olderThan])).rows[0]?.n);

  /** One change in its own transaction; returns 'OK' or the database message. `session` = an approved address-change session. */
  const attempt = async (sql: string, params: unknown[], session: boolean): Promise<string> => {
    const client = await app.pool.connect();
    try {
      await client.query('BEGIN');
      if (session) {
        await client.query("SELECT set_config('app.address_change_in_progress', 'on', true)");
      }
      await client.query(sql, params);
      await client.query('COMMIT');
      return 'OK';
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      return error instanceof Error ? error.message : String(error);
    } finally {
      client.release();
    }
  };

  it('an identical route repeated by preview reuses its row: no new rows', async () => {
    answer = { km: 2.5, version: 'valhalla-dedup', shape: SHAPE_B };
    const first = String(((await preview(newAddress())).fee as Json).route_snapshot_id);
    const before = await countSnapshots('valhalla-dedup');
    const again: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      again.push(String(((await preview(newAddress())).fee as Json).route_snapshot_id));
    }
    expect(again).toEqual([first, first, first]);
    expect(await countSnapshots('valhalla-dedup')).toBe(before);
  });

  it('the pair pointer + distance on an Order: pointer-only, distance-only and a mismatched pair are refused; a synced pair in an approved session is accepted', async () => {
    answer = { km: 2.5, version: 'valhalla-3.9.1/motorcycle-shortest/test-a', shape: SHAPE_A };
    const addressA = newAddress();
    const feeA = (await preview(addressA)).fee as Json;
    const placed = await placeOn(addressA, feeA, { route_snapshot_id: String(feeA.route_snapshot_id) });
    expect(placed.status).toBe(201);
    const orderId = String((dataOf(placed) as Json).order_id);
    answer = { km: 4.0, version: 'valhalla-3.9.1/motorcycle-shortest/test-a', shape: SHAPE_B };
    const snapB = String(((await preview(newAddress())).fee as Json).route_snapshot_id);
    const pointerOnly = 'UPDATE app.orders SET route_snapshot_id = $2::uuid, version = version + 1, updated_at = clock_timestamp() WHERE order_id = $1::uuid';
    const distanceOnly = 'UPDATE app.orders SET fee_estimate_distance_m = 4000, version = version + 1, updated_at = clock_timestamp() WHERE order_id = $1::uuid';
    const mismatched = 'UPDATE app.orders SET route_snapshot_id = $2::uuid, fee_estimate_distance_m = 2500, version = version + 1, updated_at = clock_timestamp() WHERE order_id = $1::uuid';
    const synced = 'UPDATE app.orders SET route_snapshot_id = $2::uuid, fee_estimate_distance_m = 4000, version = version + 1, updated_at = clock_timestamp() WHERE order_id = $1::uuid';
    expect(await attempt(pointerOnly, [orderId, snapB], true)).toMatch(/ROUTE_SNAPSHOT_MISMATCH/);
    expect(await attempt(distanceOnly, [orderId], true)).toMatch(/ROUTE_SNAPSHOT_MISMATCH/);
    expect(await attempt(mismatched, [orderId, snapB], true)).toMatch(/ROUTE_SNAPSHOT_MISMATCH/);
    expect(await attempt(pointerOnly, [orderId, snapB], false)).toMatch(/ROUTE_SNAPSHOT_IMMUTABLE/);
    expect(await orderRow(orderId)).toMatchObject({ route_snapshot_id: String(feeA.route_snapshot_id), fee_estimate_distance_m: 2500 });
    expect(await attempt(synced, [orderId, snapB], true)).toBe('OK');
    expect(await orderRow(orderId)).toMatchObject({ route_snapshot_id: snapB, fee_estimate_distance_m: 4000 });
  });

  it('the pair on a delivery: pointer-only, distance-only and a mismatched pair are refused; a synced pair in an approved session is accepted', async () => {
    const deliveryId = String((await app.pool.query('SELECT delivery_id::text AS id FROM app.deliveries WHERE order_id = $1::uuid', [firstOrderId])).rows[0]?.id);
    answer = { km: 4.0, version: 'valhalla-3.9.1/motorcycle-shortest/test-a', shape: SHAPE_B };
    const snapB = String(((await preview(newAddress())).fee as Json).route_snapshot_id);
    const pointerOnly = 'UPDATE app.deliveries SET route_snapshot_id = $2::uuid, version = version + 1, updated_at = clock_timestamp() WHERE delivery_id = $1::uuid';
    const distanceOnly = 'UPDATE app.deliveries SET route_distance_m = 4000, version = version + 1, updated_at = clock_timestamp() WHERE delivery_id = $1::uuid';
    const mismatched = 'UPDATE app.deliveries SET route_snapshot_id = $2::uuid, route_distance_m = 2500, version = version + 1, updated_at = clock_timestamp() WHERE delivery_id = $1::uuid';
    const synced = 'UPDATE app.deliveries SET route_snapshot_id = $2::uuid, route_distance_m = 4000, version = version + 1, updated_at = clock_timestamp() WHERE delivery_id = $1::uuid';
    expect(await attempt(pointerOnly, [deliveryId, snapB], true)).toMatch(/ROUTE_SNAPSHOT_MISMATCH/);
    expect(await attempt(distanceOnly, [deliveryId], true)).toMatch(/ROUTE_SNAPSHOT_MISMATCH/);
    expect(await attempt(mismatched, [deliveryId, snapB], true)).toMatch(/ROUTE_SNAPSHOT_MISMATCH/);
    expect(await attempt(synced, [deliveryId, snapB], true)).toBe('OK');
    expect((await app.pool.query('SELECT route_snapshot_id::text AS p, route_distance_m FROM app.deliveries WHERE delivery_id = $1::uuid', [deliveryId])).rows[0]).toEqual({ p: snapB, route_distance_m: 4000 });
  });

  it('retention: an unreferenced snapshot is purged; one an Order, a delivery or an address change points to is kept', async () => {
    answer = { km: 5.0, version: 'valhalla-orphan', shape: SHAPE_C };
    const orphan = String(((await preview(newAddress())).fee as Json).route_snapshot_id);
    answer = { km: 6.0, version: 'valhalla-ac', shape: SHAPE_C };
    const forAddressChange = String(((await preview(newAddress())).fee as Json).route_snapshot_id);
    const orderNow = await orderRow(firstOrderId);
    await app.pool.query(
      `INSERT INTO app.address_change_requests (change_request_id, order_id, delivery_id, source, requested_by, status, target_actor,
         original_recipient_name, original_recipient_phone, original_address_text, new_recipient_name, new_recipient_phone, new_address_text,
         expires_at, version, created_at, updated_at, order_version, new_route_snapshot_id)
       VALUES ($1::uuid, $2::uuid, NULL, 'ORDER', $3::uuid, 'PENDING', 'SHOP', 'a', '0912345678', 'x', 'a', '0912345678', 'y',
         now() + interval '1 day', 1, now(), now(), $4::bigint, $5::uuid)`,
      [randomUUID(), firstOrderId, alice.userId, orderNow.version, forAddressChange],
    );
    const pointedByOrder = String(orderNow.route_snapshot_id);
    const removed = await purge('0 seconds');
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await snapshotRow(orphan)).toBeUndefined();
    expect(await snapshotRow(forAddressChange)).toBeDefined();
    expect(await snapshotRow(pointedByOrder)).toBeDefined();
  });

  it('the row guard refuses a referenced snapshot even inside the purge session; a hand DELETE and UPDATE stay refused', async () => {
    const referenced = String((await orderRow(firstOrderId)).route_snapshot_id);
    const client = await app.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.route_snapshot_purge', 'on', true)");
      await expect(client.query('DELETE FROM app.route_snapshots WHERE id = $1::uuid', [referenced])).rejects.toThrow(/ROUTE_SNAPSHOT_REFERENCED/);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
    await expect(app.pool.query('DELETE FROM app.route_snapshots WHERE id = $1::uuid', [referenced])).rejects.toThrow(/append-only/);
    await expect(app.pool.query('UPDATE app.route_snapshots SET distance_m = 1 WHERE id = $1::uuid', [referenced])).rejects.toThrow(/append-only/);
    expect(await snapshotRow(referenced)).toBeDefined();
  });

  it('race, placement first: a snapshot a transaction has just pointed to survives a purge that runs meanwhile', async () => {
    answer = { km: 7.0, version: 'valhalla-race-1', shape: SHAPE_C };
    const raced = String(((await preview(newAddress())).fee as Json).route_snapshot_id);
    const deliveryId = String((await app.pool.query('SELECT delivery_id::text AS id FROM app.deliveries WHERE order_id = $1::uuid', [firstOrderId])).rows[0]?.id);
    const placement = await app.pool.connect();
    const janitor = await app.pool.connect();
    try {
      await placement.query('BEGIN');
      await placement.query("SELECT set_config('app.address_change_in_progress', 'on', true)");
      await placement.query('UPDATE app.deliveries SET route_snapshot_id = $2::uuid, route_distance_m = 7000, version = version + 1, updated_at = clock_timestamp() WHERE delivery_id = $1::uuid', [deliveryId, raced]);
      await janitor.query("SELECT app.purge_unreferenced_route_snapshots(interval '0')");
      await placement.query('COMMIT');
    } finally {
      placement.release();
      janitor.release();
    }
    expect(await snapshotRow(raced)).toBeDefined();
    expect(String((await app.pool.query('SELECT route_snapshot_id::text AS p FROM app.deliveries WHERE delivery_id = $1::uuid', [deliveryId])).rows[0]?.p)).toBe(raced);
  });

  it('race, purge first: a purge that locked the snapshot makes a concurrent placement fail; nothing points to a removed row', async () => {
    answer = { km: 8.0, version: 'valhalla-race-2', shape: SHAPE_C };
    const doomed = String(((await preview(newAddress())).fee as Json).route_snapshot_id);
    const deliveryId = String((await app.pool.query('SELECT delivery_id::text AS id FROM app.deliveries WHERE order_id = $1::uuid', [firstOrderId])).rows[0]?.id);
    const janitor = await app.pool.connect();
    const placement = await app.pool.connect();
    try {
      await janitor.query('BEGIN');
      await janitor.query("SELECT set_config('app.route_snapshot_purge', 'on', true)");
      await janitor.query('SELECT id FROM app.route_snapshots WHERE id = $1::uuid FOR UPDATE', [doomed]);
      await placement.query('BEGIN');
      await placement.query("SELECT set_config('app.address_change_in_progress', 'on', true)");
      const pending = placement
        .query('UPDATE app.deliveries SET route_snapshot_id = $2::uuid, route_distance_m = 8000, version = version + 1, updated_at = clock_timestamp() WHERE delivery_id = $1::uuid', [deliveryId, doomed])
        .then(() => 'OK', (error: unknown) => (error instanceof Error ? error.message : String(error)));
      await janitor.query('DELETE FROM app.route_snapshots WHERE id = $1::uuid', [doomed]);
      await janitor.query('COMMIT');
      expect(await pending).toMatch(/ROUTE_SNAPSHOT_MISMATCH|foreign key/);
      await placement.query('ROLLBACK').catch(() => undefined);
    } finally {
      janitor.release();
      placement.release();
    }
    expect(await snapshotRow(doomed)).toBeUndefined();
    expect(String((await app.pool.query('SELECT route_snapshot_id::text AS p FROM app.deliveries WHERE delivery_id = $1::uuid', [deliveryId])).rows[0]?.p)).not.toBe(doomed);
  });
});
