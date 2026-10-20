import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { M14_ROUTING } from '../../apps/backend/src/delivery/m14-route-client';
import { NotificationRuntime } from '../../apps/backend/src/notifications/notification-runtime';
import { ApiResponse, AuthApp, countRows, dataOf, startAuthApp } from './support/auth-fixtures';
import { cleanupOrders, codeOf, Customer, Dish, Json, newCustomer, newDish, newShipper, openAllWeek, PRIVACY, Shipper, TERMS } from './support/m10-fixtures';
import { createShopOwner, ShopOwner } from './support/shop-management-fixtures';

// M11 on the REAL Orders module (M10): no stand-in port. A customer places an Order, the shop confirms and calls a Shipper, the Shipper delivers and the Order
// completes; only then does the customer rate the shop and the Shipper and file a complaint. Somebody else's Order, an Order that is not finished and a
// second rating are refused, and a retry never makes a second rating.

describe('M11 — ratings and complaints on real M10 orders', () => {
  let app: AuthApp;
  let router: http.Server;
  let shop: ShopOwner;
  let alice: Customer;
  let bob: Customer;
  let pho: Dish;
  const drivers: string[] = [];
  let addedPolicy = false;

  beforeAll(async () => {
    router = http.createServer((request, response) => {
      request.resume();
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ trip: { summary: { length: 2.5, time: 420 } } }));
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
  });

  afterAll(async () => {
    const runtime = app.running.app.get(NotificationRuntime);
    for (let pass = 0; pass < 200 && (await runtime.dispatcher.dispatchOnce()).claimed > 0; pass += 1) {
      // drained
    }
    const client = await app.pool.connect();
    try {
      await client.query('BEGIN');
      const m11 = ['complaint_adjustments', 'complaint_reconsiderations', 'complaint_attachments', 'complaint_messages', 'complaints', 'review_reply_history', 'review_replies', 'review_moderations', 'reviews'];
      for (const table of m11) {
        await client.query(`ALTER TABLE app.${table} DISABLE TRIGGER USER`);
      }
      for (const table of m11) {
        await client.query(`DELETE FROM app.${table}`);
      }
      for (const table of m11) {
        await client.query(`ALTER TABLE app.${table} ENABLE TRIGGER USER`);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    await cleanupOrders(app, { shopIds: [shop.shopId], customerIds: [alice.userId, bob.userId], drivers, userIds: [alice.userId, bob.userId, shop.userId], policyAdded: addedPolicy });
    await app.close();
    await new Promise<void>((resolve) => router.close(() => resolve()));
  });

  type Verb = 'GET' | 'POST' | 'PUT';
  const call = (token: string, method: Verb, path: string, body?: unknown, key: string = randomUUID()): Promise<ApiResponse> =>
    app.call(method, path, { bearer: token, ...(method !== 'GET' ? { headers: { 'idempotency-key': key } } : {}), ...(body === undefined ? {} : { body }) });
  const ok = (response: ApiResponse, status = 200): Json => {
    expect([response.status, response.text.slice(0, 300)]).toEqual([status, response.text.slice(0, 300)]);
    return dataOf(response) as Json;
  };
  const ADDRESS = { address_text: '12 Phố Huế, Hai Bà Trưng, Hà Nội', lat: 21.0, lng: 105.82 };

  async function placeAndConfirm(c: Customer): Promise<Json> {
    const lines = [{ item_id: pho.itemId, quantity: 2, unit_price_vnd: pho.price }];
    const placed = ok(await call(c.token, 'POST', '/customers/me/orders', { client_ref: randomUUID(), shop_id: shop.shopId, lines, items_total_vnd: 2 * pho.price, recipient_name: 'Người nhận', recipient_phone: '0912345678', address: ADDRESS }), 201);
    return ok(await call(shop.token, 'POST', `/shop/me/orders/${placed.order_id}/confirm`, { expected_version: placed.version }));
  }

  /** The Shipper takes the Order's delivery to the end ("completed"): the Order completes by itself. */
  async function deliver(s: Shipper, order: Json, finish: 'complete' | 'stop'): Promise<string> {
    const called = ok(await call(shop.token, 'POST', `/shop/me/orders/${order.order_id}/call-shipper`, { expected_version: order.version }), 201);
    const did = String((called.delivery as Json).delivery_id);
    const accepted = ok(await call(s.token, 'POST', `/driver/deliveries/${did}/accept`, {}));
    const dest = await call(s.token, 'POST', `/driver/deliveries/${did}/destination`, { expected_version: accepted.version, lat: 21.0, lng: 105.82, fee_vnd: 15_000 });
    const base = dest.status === 200 ? (dataOf(dest) as Json) : accepted;
    const picked = ok(await call(s.token, 'POST', `/driver/deliveries/${did}/pickup`, { expected_version: base.version }));
    if (finish === 'complete') {
      ok(await call(s.token, 'POST', `/driver/deliveries/${did}/complete`, { expected_version: picked.version }));
    }
    return did;
  }

  it('an Order that is not finished cannot be rated; the finished one is rated once (shop and Shipper), by its own customer only', async () => {
    const s = await newShipper(app, drivers);
    const order = await placeAndConfirm(alice);
    const oid = String(order.order_id);

    // Not finished: the state says so and a rating is refused.
    const early = ok(await call(alice.token, 'GET', `/customers/me/orders/${oid}/reviews`));
    expect(early.shop).toMatchObject({ can_review: false, review: null });
    expect(codeOf(await call(alice.token, 'POST', `/customers/me/orders/${oid}/reviews/shop`, { stars: 5 }))).toBe('REVIEW_NOT_ELIGIBLE');
    expect(await countRows(app.pool, 'SELECT 1 FROM app.reviews WHERE order_id = $1::uuid', [oid])).toBe(0);

    await deliver(s, order, 'complete');
    const state = ok(await call(alice.token, 'GET', `/customers/me/orders/${oid}/reviews`));
    expect(state.order).toMatchObject({ completed: true });
    expect(state.shop).toMatchObject({ can_review: true });
    expect(state.shipper).toMatchObject({ can_review: true });

    // Somebody else's Order reads like a missing one.
    expect(codeOf(await call(bob.token, 'POST', `/customers/me/orders/${oid}/reviews/shop`, { stars: 1 }))).toBe('REVIEW_TARGET_NOT_FOUND');

    const key = randomUUID();
    const first = await call(alice.token, 'POST', `/customers/me/orders/${oid}/reviews/shop`, { stars: 4, comment: 'Phở ngon' }, key);
    const replay = await call(alice.token, 'POST', `/customers/me/orders/${oid}/reviews/shop`, { stars: 4, comment: 'Phở ngon' }, key);
    expect([first.status, replay.status]).toEqual([201, 201]);
    expect(((dataOf(first) as Json).review as Json).review_id).toBe(((dataOf(replay) as Json).review as Json).review_id);
    expect(codeOf(await call(alice.token, 'POST', `/customers/me/orders/${oid}/reviews/shop`, { stars: 1 }))).toBe('REVIEW_ALREADY_EXISTS');
    ok(await call(alice.token, 'POST', `/customers/me/orders/${oid}/reviews/shipper`, { stars: 5 }), 201);
    expect(await countRows(app.pool, 'SELECT 1 FROM app.reviews WHERE order_id = $1::uuid', [oid])).toBe(2);

    // The public page shows the rating with the customer's display name only; the Shipper sees the SOURCE, not who wrote it.
    const page = dataOf(await app.call('GET', `/shops/${shop.shopId}/reviews`)) as Json;
    expect((page.items as Json[]).map((i) => [i.stars, i.reviewer_name])).toEqual([[4, 'Nguyễn Văn An']]);
    const mine = ok(await call(s.token, 'GET', '/driver/reviews'));
    expect((mine.items as Json[]).map((i) => [i.source, i.stars])).toEqual([['CUSTOMER', 5]]);
    expect(JSON.stringify(mine)).not.toContain('Nguyễn Văn An');
  });

  it('a complaint about a finished Order: its own customer files it, a repeat joins the open file, another customer is refused', async () => {
    const s = await newShipper(app, drivers);
    const order = await placeAndConfirm(bob);
    const oid = String(order.order_id);
    await deliver(s, order, 'complete');

    const body = { category: 'GOODS', body: 'Thiếu một bát phở', order_id: oid };
    expect(codeOf(await call(alice.token, 'POST', '/customers/me/complaints', body))).toBe('COMPLAINT_TARGET_NOT_FOUND');
    const first = ok(await call(bob.token, 'POST', '/customers/me/complaints', body), 201);
    expect(first.appended).toBe(false);
    const again = ok(await call(bob.token, 'POST', '/customers/me/complaints', { ...body, body: 'Bổ sung: còn thiếu cả trà đá' }));
    expect(again.appended).toBe(true);
    expect(((again.complaint as Json).complaint_id)).toBe((first.complaint as Json).complaint_id);
    expect(await countRows(app.pool, 'SELECT 1 FROM app.complaints WHERE order_id = $1::uuid', [oid])).toBe(1);
    const list = ok(await call(bob.token, 'GET', '/customers/me/complaints'));
    expect((list.items as Json[]).map((i) => i.status)).toEqual(['PENDING']);
    // Filing never touches the Order or its delivery.
    expect((await app.pool.query('SELECT status FROM app.orders WHERE order_id = $1::uuid', [oid])).rows[0]).toEqual({ status: 'COMPLETED' });
  });
});
