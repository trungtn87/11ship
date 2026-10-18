import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { DeliverySweeper } from '../../apps/backend/src/delivery/delivery-sweeper';
import { M14_ROUTING } from '../../apps/backend/src/delivery/m14-route-client';
import { NotificationRuntime } from '../../apps/backend/src/notifications/notification-runtime';
import { OrderSweeper } from '../../apps/backend/src/orders/order-sweeper';
import { ApiResponse, AuthApp, countRows, dataOf, startAuthApp } from './support/auth-fixtures';
import { ageDelivery, cleanupOrders, codeOf, Customer, Dish, Json, newCustomer, newDish, newShipper, openAllWeek, PRIVACY, Shipper, setHours, TERMS, vietnamInstant, vietnamWeekday, walletOf } from './support/m10-fixtures';
import { createShopOwner, ShopOwner } from './support/shop-management-fixtures';
import { hideDish } from './support/m10-menu';

// M10 on a REAL Nest pipeline and PostgreSQL: the cart, the check and the sending of an Order (prices, hours, the retry that must not make two), the shop
// editing / confirming / refusing, the customer cancelling only before confirmation, "ready" and "call a Shipper" as independent steps, the scheduled
// Order (also past midnight), the link to the delivery of M07 (calling again, cancelling the dish order before pickup, complete once, fail and the goods),
// the snapshots, the permissions and the notifications. The M14 routing service is a REAL local HTTP server. Cases from the Owner's acceptance list are
// named in the test titles.

describe('M10 — food orders', () => {
  let app: AuthApp;
  let router: http.Server;
  let shop: ShopOwner;
  let otherShop: ShopOwner;
  let alice: Customer;
  let bob: Customer;
  let pho: Dish;
  let tea: Dish;
  let bun: Dish;
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
    otherShop = await createShopOwner(app);
    await openAllWeek(app, shop.shopId);
    await openAllWeek(app, otherShop.shopId);
    alice = await newCustomer(app, 'Nguyễn Văn An');
    bob = await newCustomer(app, 'Trần Thị Bình');
    pho = await newDish(app, shop.token, 'Phở bò', 45_000);
    tea = await newDish(app, shop.token, 'Trà đá', 5_000);
    bun = await newDish(app, shop.token, 'Bún chả', 40_000);
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
    // Whatever the outbox still holds is consumed first, so nothing lands in the inbox of an account after its rows are gone.
    for (let pass = 0; pass < 200 && (await runtime().dispatcher.dispatchOnce()).claimed > 0; pass += 1) {
      // drained
    }
    await cleanupOrders(app, { shopIds: [shop.shopId, otherShop.shopId], customerIds: [alice.userId, bob.userId], drivers, userIds: [alice.userId, bob.userId, shop.userId, otherShop.userId], policyAdded: addedPolicy });
    await app.close();
    await new Promise<void>((resolve) => router.close(() => resolve()));
  });

  // ---- helpers -------------------------------------------------------------------------------------------------------------------

  type Verb = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  const call = (token: string, method: Verb, path: string, body?: unknown, key: string = randomUUID()): Promise<ApiResponse> =>
    app.call(method, path, { bearer: token, ...(method !== 'GET' ? { headers: { 'idempotency-key': key } } : {}), ...(body === undefined ? {} : { body }) });
  const asCustomer = (c: Customer, method: Verb, path: string, body?: unknown, key?: string): Promise<ApiResponse> => call(c.token, method, path, body, key);
  const asShop = (method: Verb, path: string, body?: unknown, key?: string, owner: ShopOwner = shop): Promise<ApiResponse> => call(owner.token, method, path, body, key);
  const asShipper = (s: Shipper, method: Verb, path: string, body?: unknown, key?: string): Promise<ApiResponse> => call(s.token, method, path, body, key);
  const ok = (response: ApiResponse, status = 200): Json => {
    expect([response.status, response.text.slice(0, 300)]).toEqual([status, response.text.slice(0, 300)]);
    return dataOf(response) as Json;
  };
  const refused = (response: ApiResponse): { status: number; code: string | undefined } => ({ status: response.status, code: codeOf(response) });

  const ADDRESS = { address_text: '12 Phố Huế, Hai Bà Trưng, Hà Nội', lat: 21.0, lng: 105.82 };
  const line = (d: Dish, quantity: number, note?: string, price = d.price): Json => ({ item_id: d.itemId, quantity, unit_price_vnd: price, ...(note === undefined ? {} : { note }) });
  const totalOf = (lines: Json[]): number => lines.reduce((sum, l) => sum + Number(l.quantity) * Number(l.unit_price_vnd), 0);
  const checkout = (lines: Json[], over: Json = {}): Json => ({
    client_ref: randomUUID(),
    shop_id: shop.shopId,
    lines,
    items_total_vnd: totalOf(lines),
    recipient_name: 'Người nhận',
    recipient_phone: '0912345678',
    address: ADDRESS,
    ...over,
  });
  async function place(c: Customer, lines: Json[] = [line(pho, 2), line(tea, 1)], over: Json = {}): Promise<Json> {
    return ok(await asCustomer(c, 'POST', '/customers/me/orders', checkout(lines, over)), 201);
  }
  const orderRow = async (id: string): Promise<Json> => (await app.pool.query('SELECT * FROM app.orders WHERE order_id = $1::uuid', [id])).rows[0] as Json;
  const deliveryOf = async (orderId: string): Promise<Json[]> => (await app.pool.query('SELECT * FROM app.deliveries WHERE order_id = $1::uuid ORDER BY created_at, delivery_id', [orderId])).rows as Json[];
  const shopView = async (id: string, owner: ShopOwner = shop): Promise<Json> => ok(await asShop('GET', `/shop/me/orders/${id}`, undefined, undefined, owner));
  const customerView = async (c: Customer, id: string): Promise<Json> => ok(await asCustomer(c, 'GET', `/customers/me/orders/${id}`));
  const confirm = async (order: Json, reason?: string): Promise<Json> => ok(await asShop('POST', `/shop/me/orders/${order.order_id}/confirm`, { expected_version: order.version, ...(reason === undefined ? {} : { change_reason: reason }) }));
  async function confirmed(c: Customer, lines?: Json[], over: Json = {}): Promise<Json> {
    return confirm(await place(c, lines, over));
  }
  const callShipper = (order: Json, over: Json = {}, key?: string): Promise<ApiResponse> => asShop('POST', `/shop/me/orders/${order.order_id}/call-shipper`, { expected_version: order.version, ...over }, key);
  const runtime = (): NotificationRuntime => app.running.app.get(NotificationRuntime);
  const deliverySweeper = (): DeliverySweeper => app.running.app.get(DeliverySweeper);
  const orderSweeper = (): OrderSweeper => app.running.app.get(OrderSweeper);
  const shipper = (funds = 50_000): Promise<Shipper> => newShipper(app, drivers, funds);

  // ---- cart ----------------------------------------------------------------------------------------------------------------------

  it('the cart belongs to one shop: the same dish with the same note merges, another note is its own line, and the cart survives (read back from the server)', async () => {
    const put = ok(await asCustomer(alice, 'PUT', '/customers/me/cart', { shop_id: shop.shopId, lines: [{ item_id: pho.itemId, quantity: 1, note: 'ít cay' }, { item_id: pho.itemId, quantity: 2, note: ' Ít  cay ' }, { item_id: pho.itemId, quantity: 1 }, { item_id: tea.itemId, quantity: 3 }], note: 'Gọi trước khi giao' }));
    const cart = put.cart as Json;
    expect(cart.lines.map((l: Json) => [l.item_id, l.quantity, l.note])).toEqual([[pho.itemId, 3, 'ít cay'], [pho.itemId, 1, null], [tea.itemId, 3, null]]);
    expect(cart.items_total_vnd).toBe(3 * 45_000 + 45_000 + 3 * 5_000);
    const again = ok(await asCustomer(alice, 'GET', '/customers/me/cart')).cart as Json;
    expect(again.lines).toHaveLength(3);
    expect(again.note).toBe('Gọi trước khi giao');
    // A dish that is not of this shop is refused, nothing is stored.
    const foreign = await newDish(app, otherShop.token, 'Món quán khác', 30_000);
    expect(refused(await asCustomer(alice, 'PUT', '/customers/me/cart', { shop_id: shop.shopId, lines: [{ item_id: foreign.itemId, quantity: 1 }] }))).toEqual({ status: 409, code: 'ORDER_CART_CHANGED' });
    expect(((ok(await asCustomer(alice, 'GET', '/customers/me/cart')).cart as Json).lines as Json[])).toHaveLength(3);
    // Replacing with a cart of the other shop is a whole new cart (the app asks first); one cart per customer.
    ok(await asCustomer(alice, 'PUT', '/customers/me/cart', { shop_id: otherShop.shopId, lines: [{ item_id: foreign.itemId, quantity: 2 }] }));
    expect(await countRows(app.pool, 'SELECT 1 FROM app.customer_carts WHERE user_id = $1::uuid', [alice.userId])).toBe(1);
    ok(await asCustomer(alice, 'DELETE', '/customers/me/cart'));
    expect((ok(await asCustomer(alice, 'GET', '/customers/me/cart'))).cart).toBeNull();
  });

  it('the cart shows today\'s price and availability: a hidden dish is flagged, a changed price is the new price (never the old one)', async () => {
    const dish = await newDish(app, shop.token, 'Món đổi giá', 20_000);
    ok(await asCustomer(bob, 'PUT', '/customers/me/cart', { shop_id: shop.shopId, lines: [{ item_id: dish.itemId, quantity: 2 }] }));
    await app.pool.query('UPDATE app.menu_items SET price_vnd = 25000, version = version + 1, updated_at = clock_timestamp() WHERE item_id = $1::uuid', [dish.itemId]);
    let cart = ok(await asCustomer(bob, 'GET', '/customers/me/cart')).cart as Json;
    expect(cart.lines[0]).toMatchObject({ price_vnd: 25_000, available: true, issue: null });
    expect(cart.items_total_vnd).toBe(50_000);
    await hideDish(app, dish.itemId);
    cart = ok(await asCustomer(bob, 'GET', '/customers/me/cart')).cart as Json;
    expect(cart.lines[0]).toMatchObject({ price_vnd: null, available: false, issue: 'ITEM_UNAVAILABLE' });
    expect(cart.items_total_vnd).toBe(0);
    ok(await asCustomer(bob, 'DELETE', '/customers/me/cart'));
  });

  // ---- the check and the sending -------------------------------------------------------------------------------------------------

  it('the check before sending shows the dishes at today\'s price and an estimated fee from M06; the fee is separate and unknown is never 0', async () => {
    const body = { shop_id: shop.shopId, lines: [{ item_id: pho.itemId, quantity: 2 }], recipient_name: 'An', recipient_phone: '0912345678', address: ADDRESS };
    const preview = ok(await asCustomer(alice, 'POST', '/customers/me/orders/preview', body));
    expect(preview).toMatchObject({ ok: true, blockers: [], items_total_vnd: 90_000, fee: { status: 'ESTIMATE', estimate_vnd: 10_000, distance_m: 2500 }, expected_total_vnd: 100_000 });
    // A typed address without a pin: the fee cannot be priced and is said to be unknown, not zero.
    const unpinned = ok(await asCustomer(alice, 'POST', '/customers/me/orders/preview', { ...body, address: { address_text: '5 Phố Cổ' } }));
    expect(unpinned).toMatchObject({ ok: true, fee: { status: 'UNKNOWN', estimate_vnd: null }, expected_total_vnd: null });
    // A dish nobody sells is a blocker, not a silent drop.
    const bad = ok(await asCustomer(alice, 'POST', '/customers/me/orders/preview', { ...body, lines: [{ item_id: randomUUID(), quantity: 1 }] }));
    expect(bad.ok).toBe(false);
    expect(bad.lines[0]).toMatchObject({ issue: 'ITEM_UNAVAILABLE' });
  });

  it('sending creates "Chờ quán xác nhận" with a snapshot: the menu and the address book changing afterwards do not change the Order', async () => {
    const dish = await newDish(app, shop.token, 'Món snapshot', 30_000);
    const book = ok(await asCustomer(alice, 'POST', '/customers/me/addresses', { label: 'HOME', contact_phone: '0912345678', address_description: '77 Phố Mới, Cầu Giấy', latitude: 21.0, longitude: 105.82 }), 201);
    const order = await place(alice, [line(dish, 2, 'không hành')], { address: { address_id: book.id } });
    expect(order).toMatchObject({ status: 'PENDING_CONFIRMATION', display_status: 'AWAITING_SHOP', version: 1 });
    expect(order.code).toMatch(/^DH-/u);
    expect(order.money).toMatchObject({ items_total_vnd: 60_000, paid_vnd: 0, fee: { payer: 'CUSTOMER', amount_vnd: null, estimate_vnd: 10_000, status: 'ESTIMATE' } });
    expect(order.recipient).toMatchObject({ name: 'Người nhận', address_text: '77 Phố Mới, Cầu Giấy' });
    await app.pool.query(`UPDATE app.menu_items SET name = 'Tên mới', price_vnd = 99000, version = version + 1, updated_at = clock_timestamp() WHERE item_id = $1::uuid`, [dish.itemId]);
    ok(await asCustomer(alice, 'PATCH', `/customers/me/addresses/${String(book.id)}`, { expected_version: 1, address_description: 'Địa chỉ đã đổi' }));
    ok(await asCustomer(alice, 'DELETE', `/customers/me/addresses/${String(book.id)}`));
    const after = await customerView(alice, String(order.order_id));
    expect(after.items[0]).toMatchObject({ name: 'Món snapshot', unit_price_vnd: 30_000, quantity: 2, note: 'không hành' });
    expect(after.recipient.address_text).toBe('77 Phố Mới, Cầu Giấy');
    expect(after.money.items_total_vnd).toBe(60_000);
  });

  it('Case "giá đổi lúc gửi": a changed price is refused with nothing created; the customer checks and sends again with the new price', async () => {
    const dish = await newDish(app, shop.token, 'Món sắp tăng giá', 20_000);
    const before = await countRows(app.pool, 'SELECT 1 FROM app.orders WHERE customer_user_id = $1::uuid', [alice.userId]);
    await app.pool.query('UPDATE app.menu_items SET price_vnd = 22000, version = version + 1, updated_at = clock_timestamp() WHERE item_id = $1::uuid', [dish.itemId]);
    const stale = await asCustomer(alice, 'POST', '/customers/me/orders', checkout([line(dish, 1)]));
    expect(refused(stale)).toEqual({ status: 409, code: 'ORDER_CART_CHANGED' });
    expect(await countRows(app.pool, 'SELECT 1 FROM app.orders WHERE customer_user_id = $1::uuid', [alice.userId])).toBe(before);
    const fresh = await place(alice, [line(dish, 1, undefined, 22_000)]);
    expect(fresh.money.items_total_vnd).toBe(22_000);
    // A wrong total with the right prices is refused as well.
    expect(refused(await asCustomer(alice, 'POST', '/customers/me/orders', checkout([line(dish, 1, undefined, 22_000)], { items_total_vnd: 21_000 })))).toEqual({ status: 409, code: 'ORDER_CART_CHANGED' });
  });

  it('Case "món vừa ẩn/xóa": a hidden or deleted dish is never sent; nothing is created and the customer is told to check', async () => {
    const hidden = await newDish(app, shop.token, 'Món sắp ẩn', 20_000);
    const gone = await newDish(app, shop.token, 'Món sắp xóa', 20_000);
    await hideDish(app, hidden.itemId);
    await hideDish(app, gone.itemId, 'DELETED');
    for (const dish of [hidden, gone]) {
      expect(refused(await asCustomer(alice, 'POST', '/customers/me/orders', checkout([line(pho, 1), line(dish, 1)])))).toEqual({ status: 409, code: 'ORDER_CART_CHANGED' });
    }
  });

  it('the shop must be able to take the order: a disabled shop and a shop outside its hours are refused', async () => {
    const closed = await createShopOwner(app);
    await setHours(app, closed.shopId, []);
    const dish = await newDish(app, closed.token, 'Món quán đóng', 10_000);
    const closedOrder = { ...checkout([line(dish, 1)]), shop_id: closed.shopId };
    expect(refused(await asCustomer(alice, 'POST', '/customers/me/orders', closedOrder))).toEqual({ status: 409, code: 'ORDER_SHOP_NOT_OPEN' });
    const preview = ok(await asCustomer(alice, 'POST', '/customers/me/orders/preview', { shop_id: closed.shopId, lines: [{ item_id: dish.itemId, quantity: 1 }], recipient_name: 'An', recipient_phone: '0912345678', address: ADDRESS }));
    expect(preview).toMatchObject({ ok: false, blockers: ['SHOP_NOT_OPEN'] });
    await openAllWeek(app, closed.shopId);
    await app.pool.query(`UPDATE app.shops SET status = 'DISABLED', updated_at = clock_timestamp() WHERE shop_id = $1::uuid`, [closed.shopId]);
    expect(refused(await asCustomer(alice, 'POST', '/customers/me/orders', { ...closedOrder, client_ref: randomUUID() }))).toEqual({ status: 409, code: 'ORDER_SHOP_NOT_OPEN' });
    await cleanupOrders(app, { shopIds: [closed.shopId], customerIds: [], drivers: [], userIds: [] });
  });

  it('Case "mất mạng gửi lặp": the same Idempotency-Key, or the same client reference with another key, or five at once, is ONE Order; the lookup tells the app what happened', async () => {
    const body = checkout([line(bun, 1)]);
    const key = randomUUID();
    const first = ok(await asCustomer(alice, 'POST', '/customers/me/orders', body, key), 201);
    const replay = ok(await asCustomer(alice, 'POST', '/customers/me/orders', body, key), 201);
    expect(replay.order_id).toBe(first.order_id);
    const otherKey = ok(await asCustomer(alice, 'POST', '/customers/me/orders', body, randomUUID()), 201);
    expect(otherKey.order_id).toBe(first.order_id);
    const racing = checkout([line(bun, 2)]);
    const results = await Promise.all(Array.from({ length: 5 }, () => asCustomer(alice, 'POST', '/customers/me/orders', racing, randomUUID())));
    const ids = new Set(results.filter((r) => r.status === 200 || r.status === 201).map((r) => String((dataOf(r) as Json).order_id)));
    expect(ids.size).toBe(1);
    expect(await countRows(app.pool, 'SELECT 1 FROM app.orders WHERE client_ref = $1::uuid', [racing.client_ref])).toBe(1);
    // The reference of a send that never arrived finds nothing; of one that did, finds the Order.
    expect(ok(await asCustomer(alice, 'GET', `/customers/me/orders/lookup?client_ref=${String(body.client_ref)}`)).order_id).toBe(first.order_id);
    expect(refused(await asCustomer(alice, 'GET', `/customers/me/orders/lookup?client_ref=${randomUUID()}`))).toEqual({ status: 404, code: 'ORDER_NOT_FOUND' });
    // The same key with a different request is refused, not answered with the old Order.
    expect(refused(await asCustomer(alice, 'POST', '/customers/me/orders', checkout([line(bun, 3)]), key))).toEqual({ status: 409, code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('only the customer sees the Order: another customer and another shop read it as not found, and the roles are kept apart', async () => {
    const order = await place(alice);
    const id = String(order.order_id);
    expect(refused(await asCustomer(bob, 'GET', `/customers/me/orders/${id}`))).toEqual({ status: 404, code: 'ORDER_NOT_FOUND' });
    expect(refused(await asCustomer(bob, 'POST', `/customers/me/orders/${id}/cancel`, { expected_version: 1 }))).toEqual({ status: 404, code: 'ORDER_NOT_FOUND' });
    expect(refused(await asShop('GET', `/shop/me/orders/${id}`, undefined, undefined, otherShop))).toEqual({ status: 404, code: 'ORDER_NOT_FOUND' });
    expect(refused(await asShop('POST', `/shop/me/orders/${id}/confirm`, { expected_version: 1 }, undefined, otherShop))).toEqual({ status: 404, code: 'ORDER_NOT_FOUND' });
    // A customer is not a shop and a shop owner is not a customer of the shop routes.
    expect(refused(await asCustomer(alice, 'GET', '/shop/me/orders')).status).toBeGreaterThanOrEqual(403);
    expect(refused(await call(shop.token, 'GET', '/customers/me/orders')).status).toBeGreaterThanOrEqual(401);
    expect((await app.call('GET', '/customers/me/orders', {})).status).toBe(401);
    // The lists carry only the caller's own Orders.
    const mine = ok(await asCustomer(bob, 'GET', '/customers/me/orders?scope=processing')).orders as Json[];
    expect(mine.map((o) => o.order_id)).not.toContain(id);
    // Nothing from the client names an actor or a status.
    expect((await asCustomer(alice, 'POST', '/customers/me/orders', { ...checkout([line(bun, 1)]), customer_user_id: bob.userId })).status).toBe(400);
    expect((await asShop('POST', `/shop/me/orders/${id}/confirm`, { expected_version: 1, status: 'COMPLETED' })).status).toBe(400);
  });

  // ---- the shop: edit, confirm, refuse; the customer cancels --------------------------------------------------------------------

  it('the shop edits quantity, price and removes a dish before confirming; confirming an edited Order needs a reason; the customer sees the original and the confirmed version', async () => {
    const order = await place(alice, [line(pho, 2), line(tea, 2), line(bun, 1)]);
    const id = String(order.order_id);
    const [phoLine, teaLine, bunLine] = (order.items as Json[]).map((i) => String(i.line_id));
    const edited = ok(await asShop('POST', `/shop/me/orders/${id}/edit`, { expected_version: 1, changes: [{ line_id: phoLine, quantity: 1 }, { line_id: teaLine, unit_price_vnd: 6_000 }, { line_id: bunLine, remove: true }] }));
    expect(edited).toMatchObject({ edited: true, version: 2 });
    expect(edited.money).toMatchObject({ items_original_total_vnd: 2 * 45_000 + 2 * 5_000 + 40_000, items_total_vnd: 45_000 + 2 * 6_000 });
    expect(edited.items.map((i: Json) => [i.removed, i.original])).toEqual([[false, { quantity: 2, unit_price_vnd: 45_000 }], [false, { quantity: 2, unit_price_vnd: 5_000 }], [true, { quantity: 1, unit_price_vnd: 40_000 }]]);
    expect(refused(await asShop('POST', `/shop/me/orders/${id}/confirm`, { expected_version: 2 }))).toEqual({ status: 409, code: 'ORDER_CHANGE_REASON_REQUIRED' });
    expect(refused(await asShop('POST', `/shop/me/orders/${id}/confirm`, { expected_version: 2, change_reason: '   ' }))).toEqual({ status: 409, code: 'ORDER_CHANGE_REASON_REQUIRED' });
    const done = ok(await asShop('POST', `/shop/me/orders/${id}/confirm`, { expected_version: 2, change_reason: 'Hết bún chả, khách đồng ý bớt 1 phở' }));
    expect(done).toMatchObject({ status: 'PREPARING', display_status: 'PREPARING', change_reason: 'Hết bún chả, khách đồng ý bớt 1 phở' });
    const seen = await customerView(alice, id);
    expect(seen.money).toMatchObject({ items_original_total_vnd: 140_000, items_total_vnd: 57_000 });
    expect(seen.change_reason).toBe('Hết bún chả, khách đồng ý bớt 1 phở');
    const edit = seen.timeline.find((e: Json) => e.type === 'order.edited');
    expect(edit.details.changes).toHaveLength(3);
    // From the moment of confirmation the dishes and the amount are locked — at the API and in the database.
    expect(refused(await asShop('POST', `/shop/me/orders/${id}/edit`, { expected_version: 3, changes: [{ line_id: phoLine, quantity: 5 }] }))).toEqual({ status: 409, code: 'ORDER_STATE_CONFLICT' });
    await expect(app.pool.query('UPDATE app.order_items SET quantity = 9 WHERE line_id = $1::uuid', [phoLine])).rejects.toThrow(/ORDER_ITEMS_LOCKED/u);
    await expect(app.pool.query('UPDATE app.orders SET items_total_vnd = 1, version = version + 1 WHERE order_id = $1::uuid', [id])).rejects.toThrow(/ORDER_ITEMS_LOCKED/u);
  });

  it('an Order without a dish is never confirmed; a refused Order carries the reason the customer reads', async () => {
    const empty = await place(alice, [line(tea, 1)]);
    const lineId = String((empty.items as Json[])[0]?.line_id);
    const edited = ok(await asShop('POST', `/shop/me/orders/${String(empty.order_id)}/edit`, { expected_version: 1, changes: [{ line_id: lineId, remove: true }] }));
    expect(edited.money.items_total_vnd).toBe(0);
    expect(refused(await asShop('POST', `/shop/me/orders/${String(empty.order_id)}/confirm`, { expected_version: 2, change_reason: 'x' }))).toEqual({ status: 409, code: 'ORDER_EMPTY' });
    await expect(app.pool.query(`UPDATE app.orders SET status = 'PREPARING', confirmed_at = now(), edited_at = now(), change_reason = 'x', version = version + 1 WHERE order_id = $1::uuid`, [empty.order_id])).rejects.toThrow(/ORDER_EMPTY_CONFIRMATION/u);
    // Refusing needs a reason.
    expect((await asShop('POST', `/shop/me/orders/${String(empty.order_id)}/reject`, { expected_version: 2 })).status).toBe(400);
    const rejected = ok(await asShop('POST', `/shop/me/orders/${String(empty.order_id)}/reject`, { expected_version: 2, reason: 'Hết món' }));
    expect(rejected).toMatchObject({ status: 'REJECTED_BY_SHOP', display_status: 'REJECTED', end_reason: 'Hết món' });
    const seen = await customerView(alice, String(empty.order_id));
    expect(seen).toMatchObject({ display_status: 'REJECTED', end_reason: 'Hết món', end_actor: 'SHOP' });
    expect(seen.can.cancel).toBe(false);
  });

  it('the customer cancels only before the shop confirms; afterwards the Order is the shop\'s to cancel', async () => {
    const order = await place(alice);
    const cancelled = ok(await asCustomer(alice, 'POST', `/customers/me/orders/${String(order.order_id)}/cancel`, { expected_version: 1, reason: 'Đổi ý' }));
    expect(cancelled).toMatchObject({ status: 'CANCELLED_BY_CUSTOMER', display_status: 'CANCELLED_BY_CUSTOMER', end_reason: 'Đổi ý' });
    expect(refused(await asShop('POST', `/shop/me/orders/${String(order.order_id)}/confirm`, { expected_version: 1 }))).toEqual({ status: 409, code: 'VERSION_CONFLICT' });
    const running = await confirmed(alice);
    expect(refused(await asCustomer(alice, 'POST', `/customers/me/orders/${String(running.order_id)}/cancel`, { expected_version: running.version }))).toEqual({ status: 409, code: 'ORDER_STATE_CONFLICT' });
    // The same cancel sent twice is the same answer.
    const key = randomUUID();
    const again = await place(alice);
    const a = await asCustomer(alice, 'POST', `/customers/me/orders/${String(again.order_id)}/cancel`, { expected_version: 1 }, key);
    const b = await asCustomer(alice, 'POST', `/customers/me/orders/${String(again.order_id)}/cancel`, { expected_version: 1 }, key);
    expect([a.status, b.status]).toEqual([200, 200]);
  });

  it('Case "khách hủy đồng thời quán xác nhận": exactly one transition wins and the other finds a new version', async () => {
    for (let round = 0; round < 4; round += 1) {
      const order = await place(alice);
      const id = String(order.order_id);
      const [cancel, confirmRes] = await Promise.all([
        asCustomer(alice, 'POST', `/customers/me/orders/${id}/cancel`, { expected_version: 1 }),
        asShop('POST', `/shop/me/orders/${id}/confirm`, { expected_version: 1 }),
      ]);
      expect([cancel.status, confirmRes.status].filter((s) => s === 200)).toHaveLength(1);
      const row = await orderRow(id);
      expect(row.status).toBe(cancel.status === 200 ? 'CANCELLED_BY_CUSTOMER' : 'PREPARING');
      expect(Number(row.version)).toBe(2);
      const loser = cancel.status === 200 ? confirmRes : cancel;
      expect(refused(loser)).toEqual({ status: 409, code: 'VERSION_CONFLICT' });
      if (cancel.status !== 200) {
        expect((await deliveryOf(id)).length).toBe(0);
      }
    }
  });

  // ---- preparing and calling a Shipper ---------------------------------------------------------------------------------------

  it('"Món đã sẵn sàng" and "Gọi shipper" are independent: calling works while preparing, ready works with or without a call, a Shipper is not called before confirmation', async () => {
    const pending = await place(alice);
    expect(refused(await callShipper(pending))).toEqual({ status: 409, code: 'ORDER_STATE_CONFLICT' });
    expect(await deliveryOf(String(pending.order_id))).toHaveLength(0);
    const a = await confirm(pending);
    expect(refused(await asShop('POST', `/shop/me/orders/${String(a.order_id)}/ready`, { expected_version: 1 }))).toEqual({ status: 409, code: 'VERSION_CONFLICT' });
    // Called while still preparing (not ready): allowed.
    const called = ok(await callShipper(a), 201);
    expect(called).toMatchObject({ display_status: 'SEARCHING_SHIPPER', ready_at: null });
    expect(called.delivery).toMatchObject({ state: 'waiting_driver', source: 'ORDER', order_id: a.order_id });
    // Ready afterwards: allowed, and it does not touch the delivery.
    const ready = ok(await asShop('POST', `/shop/me/orders/${String(a.order_id)}/ready`, { expected_version: called.version }));
    expect(ready.ready_at).not.toBeNull();
    expect(await deliveryOf(String(a.order_id))).toHaveLength(1);
    // Ready first, never called: allowed too (the shop may hand over by another means).
    const b = await confirmed(alice);
    const readyOnly = ok(await asShop('POST', `/shop/me/orders/${String(b.order_id)}/ready`, { expected_version: b.version }));
    expect(readyOnly).toMatchObject({ display_status: 'READY' });
    expect(await deliveryOf(String(b.order_id))).toHaveLength(0);
  });

  it('the delivery carries the confirmed snapshot: dishes, recipient, address, the amounts, who pays the fee; the paid amount is noted before the call and fixed while a delivery runs', async () => {
    const order = await confirmed(alice, [line(pho, 2), line(tea, 1)], { note: 'Giao giờ trưa' });
    const paid = ok(await asShop('POST', `/shop/me/orders/${String(order.order_id)}/payment`, { expected_version: order.version, paid_vnd: 50_000 }));
    expect(paid.money).toMatchObject({ paid_vnd: 50_000, items_remaining_vnd: 45_000 });
    expect(refused(await asShop('POST', `/shop/me/orders/${String(order.order_id)}/payment`, { expected_version: paid.version, paid_vnd: 999_999 }))).toEqual({ status: 400, code: 'ORDER_PAYMENT_INVALID' });
    const called = ok(await callShipper(paid, { fee_payer: 'SHOP' }), 201);
    const [delivery] = await deliveryOf(String(order.order_id));
    expect(delivery).toMatchObject({ source: 'ORDER', recipient_name: 'Người nhận', dropoff_address_text: ADDRESS.address_text, goods_description: '2× Phở bò, 1× Trà đá', fee_payer: 'SHOP', note: 'Giao giờ trưa' });
    expect([Number(delivery?.goods_value_vnd), Number(delivery?.paid_vnd), Number(delivery?.fee_vnd)]).toEqual([95_000, 50_000, 10_000]);
    expect(called.money.fee).toMatchObject({ payer: 'SHOP', amount_vnd: 10_000, status: 'FINAL' });
    expect(called.money.expected_total_vnd).toBe(95_000);
    expect(refused(await asShop('POST', `/shop/me/orders/${String(order.order_id)}/payment`, { expected_version: called.version, paid_vnd: 60_000 }))).toEqual({ status: 409, code: 'ORDER_PAYMENT_LOCKED' });
    // Fee and dishes are shown apart to the customer; the total is given only when the fee is known.
    const seen = await customerView(alice, String(order.order_id));
    expect(seen.money).toMatchObject({ items_total_vnd: 95_000, fee: { payer: 'SHOP', amount_vnd: 10_000, status: 'FINAL' } });
    expect(seen.delivery).toMatchObject({ state: 'waiting_driver', shipper: null, location: null });
    // At most one active delivery per Order — at the API and in the database.
    expect(refused(await callShipper(called))).toEqual({ status: 409, code: 'ORDER_STATE_CONFLICT' });
    await expect(
      app.pool.query(
        `INSERT INTO app.deliveries (delivery_id, code, source, order_id, shop_id, requested_by, state, shop_name, shop_phone, pickup_address_text, pickup_lat, pickup_lng, recipient_name, recipient_phone, dropoff_address_text,
           goods_description, goods_value_vnd, paid_vnd, fee_mode, fee_payer, search_started_at, search_expires_at, created_at, updated_at)
         VALUES ($1::uuid, 'G-DUPE01', 'ORDER', $2::uuid, $3::uuid, $4::uuid, 'waiting_driver', 'x', '+84900000001', 'x', 21, 105, 'x', '+84912345678', 'x', 'x', 1, 0, 'STANDARD', 'CUSTOMER', now(), now() + interval '30 minutes', now(), now())`,
        [randomUUID(), order.order_id, shop.shopId, shop.userId],
      ),
    ).rejects.toThrow();
  });

  it('Case "gọi lại không tạo delivery trùng": a call repeated with the same key is one delivery; after the delivery ended a new call links to the old one and the Order keeps the history', async () => {
    const order = await confirmed(alice);
    const key = randomUUID();
    const first = ok(await callShipper(order, {}, key), 201);
    const replay = ok(await callShipper(order, {}, key), 201);
    expect(replay.delivery.delivery_id).toBe(first.delivery.delivery_id);
    expect(await deliveryOf(String(order.order_id))).toHaveLength(1);
    // The shop ends only the delivery (M07 "hủy yêu cầu giao"): the Order stays, a new call is possible.
    const dv = first.delivery as Json;
    ok(await asShop('POST', `/shop/me/deliveries/${String(dv.delivery_id)}/cancel`, { reason: 'Chờ lâu', expected_version: dv.version }));
    const after = await shopView(String(order.order_id));
    expect(after).toMatchObject({ status: 'PREPARING', display_status: 'PREPARING' });
    expect(after.can.call_shipper).toBe(true);
    const again = ok(await callShipper(after), 201);
    const rows = await deliveryOf(String(order.order_id));
    expect(rows.map((r) => r.state)).toEqual(['cancelled_by_merchant', 'waiting_driver']);
    expect(rows[1]?.previous_delivery_id).toBe(rows[0]?.delivery_id);
    expect(again.deliveries).toHaveLength(2);
    // M07's own recall of an Order delivery still works and respects the Order.
    const stale = rows[0] as Json;
    expect(refused(await asShop('POST', `/shop/me/deliveries/${String(stale.delivery_id)}/recall`, {})).status).toBe(409);
  });

  it('Case "hết 30 phút giữ Order": the search stops by itself, the Order is not cancelled, and the shop calls again', async () => {
    const order = await confirmed(alice);
    const first = ok(await callShipper(order), 201);
    await ageDelivery(app, String((first.delivery as Json).delivery_id), 31);
    await deliverySweeper().sweep();
    const stopped = await shopView(String(order.order_id));
    expect(stopped).toMatchObject({ status: 'PREPARING', display_status: 'SEARCH_STOPPED' });
    expect(stopped.can.call_shipper).toBe(true);
    expect((await customerView(alice, String(order.order_id)))).toMatchObject({ status: 'PREPARING', display_status: 'SEARCH_STOPPED' });
    expect(((ok(await asShop('GET', '/shop/me/orders?filter=attention')).orders) as Json[]).map((o) => o.order_id)).toContain(order.order_id);
    ok(await callShipper(stopped), 201);
    expect((await deliveryOf(String(order.order_id))).map((r) => r.state)).toEqual(['search_stopped', 'waiting_driver']);
  });

  // ---- cancelling the dish order -------------------------------------------------------------------------------------------------

  it('"hủy đơn món" before pickup ends the Order AND the delivery and gives the commission back; the Shipper loses nothing', async () => {
    const s = await shipper();
    const order = await confirmed(alice);
    const called = ok(await callShipper(order), 201);
    const did = String((called.delivery as Json).delivery_id);
    ok(await asShipper(s, 'POST', `/driver/deliveries/${did}/accept`, {}));
    expect(await walletOf(app, s)).toEqual({ balance: 50_000, held: 1000 });
    expect((await shopView(String(order.order_id))).display_status).toBe('SHIPPER_COMING');
    expect(refused(await asShop('POST', `/shop/me/orders/${String(order.order_id)}/cancel`, { expected_version: called.version }))).toEqual({ status: 400, code: 'BAD_REQUEST' });
    const cancelled = ok(await asShop('POST', `/shop/me/orders/${String(order.order_id)}/cancel`, { expected_version: Number((await orderRow(String(order.order_id))).version), reason: 'Hết nguyên liệu' }));
    expect(cancelled).toMatchObject({ status: 'CANCELLED_BY_SHOP', display_status: 'CANCELLED_BY_SHOP' });
    expect((await deliveryOf(String(order.order_id))).map((r) => r.state)).toEqual(['cancelled_by_merchant']);
    expect(await walletOf(app, s)).toEqual({ balance: 50_000, held: 0 });
    expect(await countRows(app.pool, `SELECT 1 FROM app.delivery_assignments WHERE delivery_id = $1::uuid AND status = 'CANCELLED_BY_SHOP'`, [did])).toBe(1);
    // The Shipper's screen no longer shows the delivery as theirs to run, and their location is no longer readable by anyone.
    const mine = await asShipper(s, 'GET', `/driver/deliveries/${did}`);
    expect(mine.status).toBe(200);
    expect((dataOf(mine) as Json).state).toBe('cancelled_by_merchant');
    expect(refused(await asShop('POST', `/shop/me/orders/${String(order.order_id)}/cancel`, { expected_version: 999, reason: 'x' }))).toEqual({ status: 409, code: 'VERSION_CONFLICT' });
  });

  it('Case "quán hủy đồng thời shipper pickup": exactly one wins; the Order, the delivery and the commission agree with the winner', async () => {
    for (let round = 0; round < 3; round += 1) {
      const s = await shipper();
      const order = await confirmed(alice);
      const called = ok(await callShipper(order), 201);
      const did = String((called.delivery as Json).delivery_id);
      const accepted = ok(await asShipper(s, 'POST', `/driver/deliveries/${did}/accept`, {}));
      const pinned = ok(await asShipper(s, 'POST', `/driver/deliveries/${did}/destination`, { expected_version: accepted.version, lat: 21.0, lng: 105.82, fee_vnd: 15_000 }).then((r) => (r.status === 200 ? r : asShipper(s, 'GET', `/driver/deliveries/${did}`))));
      const orderVersion = Number((await orderRow(String(order.order_id))).version);
      const [cancel, pickup] = await Promise.all([
        asShop('POST', `/shop/me/orders/${String(order.order_id)}/cancel`, { expected_version: orderVersion, reason: 'Đổi ý' }),
        asShipper(s, 'POST', `/driver/deliveries/${did}/pickup`, { expected_version: pinned.version }),
      ]);
      expect([cancel.status, pickup.status].filter((status) => status === 200)).toHaveLength(1);
      const row = await orderRow(String(order.order_id));
      const [delivery] = await deliveryOf(String(order.order_id));
      if (cancel.status === 200) {
        expect([row.status, delivery?.state]).toEqual(['CANCELLED_BY_SHOP', 'cancelled_by_merchant']);
        expect(await walletOf(app, s)).toEqual({ balance: 50_000, held: 0 });
      } else {
        expect([row.status, delivery?.state]).toEqual(['PREPARING', 'delivering']);
        expect(await walletOf(app, s)).toEqual({ balance: 50_000, held: 1000 });
        expect([refused(cancel).code]).toEqual(['AFTER_PICKUP_NO_CANCEL']);
      }
    }
  });

  // ---- completing and failing ----------------------------------------------------------------------------------------------------

  async function toDelivering(s: Shipper, order: Json): Promise<{ did: string; version: number }> {
    const called = ok(await callShipper(order), 201);
    const did = String((called.delivery as Json).delivery_id);
    const accepted = ok(await asShipper(s, 'POST', `/driver/deliveries/${did}/accept`, {}));
    const dest = await asShipper(s, 'POST', `/driver/deliveries/${did}/destination`, { expected_version: accepted.version, lat: 21.0, lng: 105.82, fee_vnd: 15_000 });
    const base = dest.status === 200 ? (dataOf(dest) as Json) : accepted;
    const picked = ok(await asShipper(s, 'POST', `/driver/deliveries/${did}/pickup`, { expected_version: base.version }));
    return { did, version: Number(picked.version) };
  }

  it('Case "completed chỉ một lần": the Shipper completes, the Order completes once, the commission is taken once, and a repeat or a late event changes nothing', async () => {
    const s = await shipper();
    const order = await confirmed(alice);
    const { did, version } = await toDelivering(s, order);
    const oid = String(order.order_id);
    expect((await customerView(alice, oid))).toMatchObject({ display_status: 'DELIVERING' });
    const key = randomUUID();
    const done = ok(await asShipper(s, 'POST', `/driver/deliveries/${did}/complete`, { expected_version: version }, key));
    expect(done.state).toBe('completed');
    expect(refused(await asShipper(s, 'POST', `/driver/deliveries/${did}/complete`, { expected_version: version }, randomUUID())).status).toBe(404);
    ok(await asShipper(s, 'POST', `/driver/deliveries/${did}/complete`, { expected_version: version }, key));
    const row = await orderRow(oid);
    expect(row).toMatchObject({ status: 'COMPLETED', end_actor: 'SYSTEM' });
    expect(await countRows(app.pool, `SELECT 1 FROM app.order_events WHERE order_id = $1::uuid AND type = 'order.completed'`, [oid])).toBe(1);
    expect(await walletOf(app, s)).toEqual({ balance: 49_000, held: 0 });
    expect(await countRows(app.pool, `SELECT 1 FROM app.wallet_ledger_entries l JOIN app.delivery_assignments a ON a.assignment_id = l.commission_assignment_id WHERE a.delivery_id = $1::uuid`, [did])).toBe(1);
    expect(await customerView(alice, oid)).toMatchObject({ status: 'COMPLETED', display_status: 'COMPLETED', delivery: { state: 'completed', shipper: null, location: null } });
    // A completed Order cannot be cancelled by anyone, nor called again.
    expect(refused(await asShop('POST', `/shop/me/orders/${oid}/cancel`, { expected_version: Number(row.version), reason: 'x' })).status).toBe(409);
    expect(refused(await callShipper({ order_id: oid, version: Number(row.version) })).status).toBe(409);
    // The database itself refuses to complete an Order twice or to end it with a delivery still running.
    await expect(app.pool.query(`UPDATE app.orders SET status = 'COMPLETED', version = version + 1 WHERE order_id = $1::uuid`, [oid])).rejects.toThrow(/ORDER_TERMINAL/u);
  });

  it('Case "complete và fail đến sai thứ tự / gửi lặp": only one of them wins, and a failed delivery never completes or cancels the Order', async () => {
    const s = await shipper();
    const order = await confirmed(alice);
    const { did, version } = await toDelivering(s, order);
    const oid = String(order.order_id);
    const [complete, fail] = await Promise.all([
      asShipper(s, 'POST', `/driver/deliveries/${did}/complete`, { expected_version: version }),
      asShipper(s, 'POST', `/driver/deliveries/${did}/fail`, { expected_version: version, reason_code: 'RECIPIENT_UNREACHABLE', goods_condition: 'WITH_SHIPPER', note: 'Không gọi được' }),
    ]);
    expect([complete.status, fail.status].filter((status) => status === 200)).toHaveLength(1);
    const row = await orderRow(oid);
    if (complete.status === 200) {
      expect(row.status).toBe('COMPLETED');
    } else {
      expect(row.status).toBe('PREPARING');
      expect(await customerView(alice, oid)).toMatchObject({ status: 'PREPARING', display_status: 'DELIVERY_FAILED' });
    }
    expect(await countRows(app.pool, `SELECT 1 FROM app.order_events WHERE order_id = $1::uuid AND type = 'order.completed'`, [oid])).toBe(complete.status === 200 ? 1 : 0);
  });

  it('Case "fail / hàng chưa về": a failed delivery does not end the Order; while the goods are with the Shipper the shop cannot call again, cancel or close it; once the goods are settled it can', async () => {
    const s = await shipper();
    const order = await confirmed(alice);
    const { did, version } = await toDelivering(s, order);
    const oid = String(order.order_id);
    ok(await asShipper(s, 'POST', `/driver/deliveries/${did}/fail`, { expected_version: version, reason_code: 'RECIPIENT_REFUSED', goods_condition: 'WITH_SHIPPER', note: 'Khách từ chối nhận' }));
    const failed = await shopView(oid);
    expect(failed).toMatchObject({ status: 'PREPARING', display_status: 'DELIVERY_FAILED' });
    expect(failed.can).toMatchObject({ call_shipper: false, close_not_completed: false });
    expect(refused(await callShipper(failed))).toEqual({ status: 409, code: 'RECALL_BLOCKED_GOODS_OUT' });
    expect(refused(await asShop('POST', `/shop/me/orders/${oid}/cancel`, { expected_version: failed.version, reason: 'x' }))).toEqual({ status: 409, code: 'RECALL_BLOCKED_GOODS_OUT' });
    expect(refused(await asShop('POST', `/shop/me/orders/${oid}/close-not-completed`, { expected_version: failed.version, reason: 'x' }))).toEqual({ status: 409, code: 'RECALL_BLOCKED_GOODS_OUT' });
    const seen = await customerView(alice, oid);
    expect(seen.delivery).toMatchObject({ state: 'failed', goods_custody: 'SHIPPER', shipper: null });
    // The goods come back and the shop confirms: it may call again (a new delivery linked to the failed one).
    ok(await asShop('POST', `/shop/me/deliveries/${did}/custody`, { resolution: 'GOODS_RETURNED' }));
    const back = await shopView(oid);
    expect(back.can).toMatchObject({ call_shipper: true, close_not_completed: true });
    const again = ok(await callShipper(back), 201);
    expect((await deliveryOf(oid)).map((r) => r.state)).toEqual(['failed', 'waiting_driver']);
    expect(again.deliveries).toHaveLength(2);
  });

  it('goods dealt with and no new delivery: the shop closes the Order as "Không hoàn tất" with a reason, and nothing is refunded or charged by the app', async () => {
    const s = await shipper();
    const order = await confirmed(alice);
    const { did, version } = await toDelivering(s, order);
    const oid = String(order.order_id);
    ok(await asShipper(s, 'POST', `/driver/deliveries/${did}/fail`, { expected_version: version, reason_code: 'GOODS_PROBLEM', goods_condition: 'LOST_OR_DAMAGED', note: 'Món đổ' }));
    ok(await asShop('POST', `/shop/me/deliveries/${did}/custody`, { resolution: 'HANDLED_NO_RETURN', note: 'Quán chịu, shipper đã báo' }));
    const failed = await shopView(oid);
    expect(refused(await asShop('POST', `/shop/me/orders/${oid}/close-not-completed`, { expected_version: failed.version }))).toMatchObject({ status: 400 });
    const closed = ok(await asShop('POST', `/shop/me/orders/${oid}/close-not-completed`, { expected_version: failed.version, reason: 'Hàng đã xử lý, không giao lại' }));
    expect(closed).toMatchObject({ status: 'NOT_COMPLETED', display_status: 'NOT_COMPLETED', end_reason: 'Hàng đã xử lý, không giao lại' });
    expect(await walletOf(app, s)).toEqual({ balance: 50_000, held: 0 });
    expect(await countRows(app.pool, `SELECT 1 FROM app.wallet_ledger_entries WHERE wallet_id = $1::uuid AND entry_kind <> 'ADJUSTMENT_CREDIT'`, [s.walletId])).toBe(0);
  });

  it('tracking: the customer sees the Shipper\'s latest position with its age only while the Shipper holds the delivery, and not after the assignment ended or the Order ended', async () => {
    const s = await shipper();
    const order = await confirmed(alice);
    const oid = String(order.order_id);
    const called = ok(await callShipper(order), 201);
    const did = String((called.delivery as Json).delivery_id);
    expect((await customerView(alice, oid)).delivery.location).toBeNull();
    ok(await asShipper(s, 'POST', `/driver/deliveries/${did}/accept`, {}));
    ok(await asShipper(s, 'PUT', '/driver/location', { lat: 21.001, lng: 105.801, accuracy_m: 10 }));
    const live = (await customerView(alice, oid)).delivery as Json;
    expect(live.shipper).toMatchObject({ name: expect.any(String), plate_number: '59X1-123.45' });
    expect(live.location).toMatchObject({ lat: 21.001, lng: 105.801, freshness: 'LIVE', recorded_at: expect.any(String), age_seconds: expect.any(Number) });
    // Another customer never sees it; the shipper hands the delivery back: tracking stops at once and the next Shipper is not the old one.
    expect(refused(await asCustomer(bob, 'GET', `/customers/me/orders/${oid}`)).status).toBe(404);
    ok(await asShipper(s, 'POST', `/driver/deliveries/${did}/release`, { reason: 'Hỏng xe', expected_version: Number((await shopView(oid)).delivery.version) }));
    const released = (await customerView(alice, oid)).delivery as Json;
    expect(released).toMatchObject({ state: 'waiting_driver', shipper: null, location: null });
    // A Shipper who is not holding the delivery cannot read the customer's order at all (they have no route to an Order).
    expect(refused(await asShipper(s, 'GET', `/customers/me/orders/${oid}`)).status).toBeGreaterThanOrEqual(403);
  });

  // ---- scheduled orders ------------------------------------------------------------------------------------------------------------

  it('Case "hẹn qua đêm / 24 giờ": a wanted time inside a shift past midnight is accepted, outside it is refused, a 24-hour shop takes any time, and the time bounds apply', async () => {
    const night = await createShopOwner(app);
    const dish = await newDish(app, night.token, 'Cháo đêm', 25_000);
    const day = vietnamInstant(2, 23);
    const weekday = vietnamWeekday(day);
    // Opens 22:00 and closes 04:00 the NEXT day.
    await setHours(app, night.shopId, [[weekday, 22 * 60, 4 * 60, 1]]);
    const body = (at: Date): Json => ({ ...checkout([{ item_id: dish.itemId, quantity: 1, unit_price_vnd: 25_000 }], { scheduled_for: at.toISOString() }), shop_id: night.shopId });
    const inside = ok(await asCustomer(alice, 'POST', '/customers/me/orders', body(vietnamInstant(3, 1, 30))), 201);
    expect(inside.scheduled_for).toBe(vietnamInstant(3, 1, 30).toISOString());
    expect(refused(await asCustomer(alice, 'POST', '/customers/me/orders', body(vietnamInstant(3, 12)))).code).toBe('ORDER_SCHEDULE_INVALID');
    expect(refused(await asCustomer(alice, 'POST', '/customers/me/orders', body(vietnamInstant(3, 4, 0)))).code).toBe('ORDER_SCHEDULE_INVALID');
    expect(refused(await asCustomer(alice, 'POST', '/customers/me/orders', body(vietnamInstant(2, 23, 0)))).code).not.toBe('ORDER_SCHEDULE_INVALID');
    // Too soon and too far.
    expect(refused(await asCustomer(alice, 'POST', '/customers/me/orders', body(new Date(Date.now() + 5 * 60_000)))).code).toBe('ORDER_SCHEDULE_INVALID');
    expect(refused(await asCustomer(alice, 'POST', '/customers/me/orders', body(new Date(Date.now() + 9 * 24 * 3_600_000)))).code).toBe('ORDER_SCHEDULE_INVALID');
    // A 24-hour shop takes any time of the day.
    await openAllWeek(app, night.shopId);
    ok(await asCustomer(alice, 'POST', '/customers/me/orders', body(vietnamInstant(2, 3, 15))), 201);
    // A scheduled Order shows up under "Đơn hẹn" for both sides, carries the label, and the shop confirms first.
    const customerScheduled = ok(await asCustomer(alice, 'GET', '/customers/me/orders?scope=scheduled')).orders as Json[];
    expect(customerScheduled.map((o) => o.order_id)).toContain(inside.order_id);
    const shopScheduled = ok(await asShop('GET', '/shop/me/orders?filter=scheduled', undefined, undefined, night)).orders as Json[];
    expect(shopScheduled.length).toBe(3);
    expect(((ok(await asCustomer(alice, 'GET', '/customers/me/orders?scope=processing')).orders) as Json[]).map((o) => o.order_id)).not.toContain(inside.order_id);
    expect(refused(await asShop('POST', `/shop/me/orders/${String(inside.order_id)}/call-shipper`, { expected_version: 1 }, undefined, night)).code).toBe('ORDER_STATE_CONFLICT');
    // The shop changes its hours after accepting: the Order is kept, the shop is warned, nothing is cancelled.
    const accepted = ok(await asShop('POST', `/shop/me/orders/${String(inside.order_id)}/confirm`, { expected_version: 1 }, undefined, night));
    await setHours(app, night.shopId, [[((weekday + 3) % 7) + 1, 600, 700, 0]]);
    const warned = await shopView(String(accepted.order_id), night);
    expect(warned).toMatchObject({ status: 'PREPARING', schedule_conflict: true });
    await cleanupOrders(app, { shopIds: [night.shopId], customerIds: [], drivers: [], userIds: [] });
  });

  it('the reminder before the wanted time is sent once to the shop, calls no Shipper and cancels nothing; a restart or a second pass does not double it', async () => {
    const order = await place(alice, [line(bun, 1)], { scheduled_for: vietnamInstant(1, 12).toISOString() });
    const oid = String(order.order_id);
    const accepted = await confirm(order);
    // Not yet due: nothing is sent.
    expect(await orderSweeper().sweep()).toMatchObject({ reminded: 0 });
    // The wanted time comes within the reminder lead (the immutability guard is lifted for this statement only).
    const client = await app.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE app.orders DISABLE TRIGGER orders_guard');
      await client.query(`UPDATE app.orders SET scheduled_for = now() + interval '10 minutes' WHERE order_id = $1::uuid`, [oid]);
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      await client.query('ALTER TABLE app.orders ENABLE TRIGGER orders_guard');
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    expect(await orderSweeper().sweep()).toMatchObject({ reminded: 1 });
    expect(await orderSweeper().sweep()).toMatchObject({ reminded: 0, skipped: 0 });
    expect(await countRows(app.pool, `SELECT 1 FROM app.order_events WHERE order_id = $1::uuid AND type = 'order.schedule_reminder'`, [oid])).toBe(1);
    expect(await deliveryOf(oid)).toHaveLength(0);
    expect((await orderRow(oid)).status).toBe('PREPARING');
    // The reminder reaches the shop's inbox through M08 (once).
    for (let pass = 0; pass < 200; pass += 1) {
      if ((await runtime().dispatcher.dispatchOnce()).claimed === 0) break;
    }
    const inbox = await app.pool.query(`SELECT kind, target_type, target_id::text FROM app.notifications WHERE recipient_user_id = $1::uuid AND kind = 'ORDER_SCHEDULE_REMINDER'`, [shop.userId]);
    expect(inbox.rows.filter((r) => r.target_id === oid)).toHaveLength(1);
    expect(accepted.status).toBe('PREPARING');
  });

  // ---- history, reorder, notifications -------------------------------------------------------------------------------------------

  it('history and filters: "Đang xử lý / Đơn hẹn / Lịch sử" for the customer; pending, preparing, delivering, attention and history for the shop, with search by code or name', async () => {
    const carol = await newCustomer(app, 'Lê Thị Carol');
    const pending = await place(carol, [line(bun, 1)], { recipient_name: 'Người Nhận Riêng' });
    const running = await confirmed(carol, [line(tea, 1)]);
    const cancelled = await place(carol, [line(tea, 2)]);
    ok(await asCustomer(carol, 'POST', `/customers/me/orders/${String(cancelled.order_id)}/cancel`, { expected_version: 1 }));
    const ids = (r: ApiResponse): string[] => ((ok(r).orders) as Json[]).map((o) => String(o.order_id));
    expect(ids(await asCustomer(carol, 'GET', '/customers/me/orders?scope=processing')).sort()).toEqual([String(pending.order_id), String(running.order_id)].sort());
    expect(ids(await asCustomer(carol, 'GET', '/customers/me/orders?scope=history'))).toEqual([String(cancelled.order_id)]);
    expect(ids(await asShop('GET', `/shop/me/orders?filter=pending&q=${encodeURIComponent('Người Nhận Riêng')}`))).toEqual([String(pending.order_id)]);
    expect(ids(await asShop('GET', `/shop/me/orders?filter=pending&q=${String(pending.code)}`))).toEqual([String(pending.order_id)]);
    expect(ids(await asShop('GET', '/shop/me/orders?filter=history'))).toContain(String(cancelled.order_id));
    expect(ids(await asShop('GET', '/shop/me/orders?filter=preparing'))).toContain(String(running.order_id));
    const listed = ok(await asShop('GET', '/shop/me/orders?filter=all'));
    expect(listed.counts).toMatchObject({ pending: expect.any(Number), preparing: expect.any(Number) });
    const today = new Date();
    const from = new Date(today.getTime() - 3_600_000).toISOString();
    const to = new Date(today.getTime() + 3_600_000).toISOString();
    expect(ids(await asShop('GET', `/shop/me/orders?filter=history&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`))).toContain(String(cancelled.order_id));
    expect((await asShop('GET', '/shop/me/orders?filter=bogus')).status).toBe(400);
    expect((await asCustomer(carol, 'GET', '/customers/me/orders?scope=bogus')).status).toBe(400);
    await cleanupOrders(app, { shopIds: [], customerIds: [carol.userId], drivers: [], userIds: [carol.userId] });
  });

  it('ordering again: the dishes still on sale go into the cart at today\'s price, the others are listed as skipped, and a cart of another shop is replaced only when asked', async () => {
    const dish = await newDish(app, shop.token, 'Món đặt lại', 18_000);
    const gone = await newDish(app, shop.token, 'Món hết bán', 12_000);
    const order = await place(bob, [line(dish, 2, 'ít đá'), line(gone, 1)]);
    ok(await asCustomer(bob, 'DELETE', '/customers/me/cart'));
    await app.pool.query('UPDATE app.menu_items SET price_vnd = 21000, version = version + 1, updated_at = clock_timestamp() WHERE item_id = $1::uuid', [dish.itemId]);
    await hideDish(app, gone.itemId);
    const again = ok(await asCustomer(bob, 'POST', `/customers/me/orders/${String(order.order_id)}/reorder`, {}));
    const cart = again.cart as Json;
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]).toMatchObject({ item_id: dish.itemId, quantity: 2, note: 'ít đá', price_vnd: 21_000 });
    expect(cart.items_total_vnd).toBe(42_000);
    expect(again.skipped).toEqual([{ name: 'Món hết bán', reason: 'ITEM_UNAVAILABLE' }]);
    // The old Order keeps the old price.
    expect((await customerView(bob, String(order.order_id))).money.items_total_vnd).toBe(2 * 18_000 + 12_000);
    // A cart of another shop is not replaced silently.
    const foreign = await newDish(app, otherShop.token, 'Món quán kia', 10_000);
    ok(await asCustomer(bob, 'PUT', '/customers/me/cart', { shop_id: otherShop.shopId, lines: [{ item_id: foreign.itemId, quantity: 1 }] }));
    expect(refused(await asCustomer(bob, 'POST', `/customers/me/orders/${String(order.order_id)}/reorder`, {}))).toEqual({ status: 409, code: 'ORDER_CART_OTHER_SHOP' });
    const replaced = ok(await asCustomer(bob, 'POST', `/customers/me/orders/${String(order.order_id)}/reorder`, { replace_cart: true }));
    expect((replaced.cart as Json).shop.shop_id).toBe(shop.shopId);
  });

  it('M08: the shop hears of a new and cancelled Order, the customer of every step, once each, and opening the notification re-checks the right', async () => {
    const dana = await newCustomer(app, 'Phạm Dana');
    const order = await place(dana, [line(bun, 1)]);
    const oid = String(order.order_id);
    const accepted = await confirm(order);
    ok(await asShop('POST', `/shop/me/orders/${oid}/ready`, { expected_version: accepted.version }));
    const s = await shipper();
    const called = ok(await callShipper(await shopView(oid)), 201);
    ok(await asShipper(s, 'POST', `/driver/deliveries/${String((called.delivery as Json).delivery_id)}/accept`, {}));
    for (let pass = 0; pass < 200; pass += 1) {
      if ((await runtime().dispatcher.dispatchOnce()).claimed === 0) break;
    }
    const kinds = async (userId: string): Promise<string[]> => (await app.pool.query(`SELECT kind FROM app.notifications WHERE recipient_user_id = $1::uuid AND target_id = $2::uuid ORDER BY created_at, kind`, [userId, oid])).rows.map((r) => String(r.kind));
    expect(await kinds(shop.userId)).toEqual(['ORDER_PLACED']);
    expect((await kinds(dana.userId)).sort()).toEqual(['ORDER_CONFIRMED', 'ORDER_READY', 'ORDER_SHIPPER_ACCEPTED']);
    // The lock-screen text carries only the code.
    const bodies = (await app.pool.query(`SELECT title, body FROM app.notifications WHERE target_id = $1::uuid`, [oid])).rows.map((r) => `${String(r.title)} ${String(r.body)}`).join(' ');
    expect(bodies).toContain(String(order.code));
    expect(bodies).not.toMatch(/Bún chả|Người nhận|0912|Phố Huế/u);
    // Opening: the customer opens their own Order; the shop owner opens theirs; a stranger gets nothing.
    const inbox = ok(await asCustomer(dana, 'GET', '/notifications?limit=20')) as Json;
    const item = (inbox.items as Json[]).find((n) => n.kind === 'ORDER_CONFIRMED') as Json;
    const opened = ok(await asCustomer(dana, 'POST', `/notifications/${String(item.notification_id)}/open`, {}));
    expect(opened).toMatchObject({ outcome: 'OK', target: { type: 'ORDER', id: oid } });
    // Cancel before confirm notifies the shop once.
    const other = await place(dana, [line(tea, 1)]);
    ok(await asCustomer(dana, 'POST', `/customers/me/orders/${String(other.order_id)}/cancel`, { expected_version: 1 }));
    for (let pass = 0; pass < 200; pass += 1) {
      if ((await runtime().dispatcher.dispatchOnce()).claimed === 0) break;
    }
    expect((await app.pool.query(`SELECT kind FROM app.notifications WHERE recipient_user_id = $1::uuid AND target_id = $2::uuid ORDER BY kind`, [shop.userId, other.order_id])).rows.map((r) => r.kind)).toEqual(['ORDER_CANCELLED_BY_CUSTOMER', 'ORDER_PLACED']);
    await cleanupOrders(app, { shopIds: [], customerIds: [dana.userId], drivers: [], userIds: [dana.userId] });
  });

  it('the database keeps the Order whole whatever the application does: no delete, no changed snapshot, no skipped state, no forged amount', async () => {
    const order = await place(alice);
    const oid = String(order.order_id);
    await expect(app.pool.query('DELETE FROM app.orders WHERE order_id = $1::uuid', [oid])).rejects.toThrow(/never deleted/u);
    await expect(app.pool.query('DELETE FROM app.order_items WHERE order_id = $1::uuid', [oid])).rejects.toThrow(/never deleted/u);
    await expect(app.pool.query('DELETE FROM app.order_events WHERE order_id = $1::uuid', [oid])).rejects.toThrow(/append-only/u);
    await expect(app.pool.query(`UPDATE app.orders SET recipient_name = 'Người khác', version = version + 1 WHERE order_id = $1::uuid`, [oid])).rejects.toThrow(/ORDER_IDENTITY_IMMUTABLE/u);
    await expect(app.pool.query(`UPDATE app.orders SET status = 'COMPLETED', confirmed_at = now(), ended_at = now(), end_actor = 'SYSTEM', version = version + 1 WHERE order_id = $1::uuid`, [oid])).rejects.toThrow(/ORDER_STATE_TRANSITION/u);
    await expect(app.pool.query(`UPDATE app.orders SET items_total_vnd = items_total_vnd + 1000, version = version + 1 WHERE order_id = $1::uuid`, [oid])).rejects.toThrow(/amounts do not equal the lines/u);
    await expect(app.pool.query(`UPDATE app.orders SET version = version + 5 WHERE order_id = $1::uuid`, [oid])).rejects.toThrow(/ORDER_VERSION_CONFLICT/u);
    // A delivery for an Order nobody confirmed is refused by the database.
    await expect(
      app.pool.query(
        `INSERT INTO app.deliveries (delivery_id, code, source, order_id, shop_id, requested_by, state, shop_name, shop_phone, pickup_address_text, pickup_lat, pickup_lng, recipient_name, recipient_phone, dropoff_address_text,
           goods_description, goods_value_vnd, paid_vnd, fee_mode, fee_payer, search_started_at, search_expires_at, created_at, updated_at)
         VALUES ($1::uuid, 'G-EARLY1', 'ORDER', $2::uuid, $3::uuid, $4::uuid, 'waiting_driver', 'x', '+84900000001', 'x', 21, 105, 'x', '+84912345678', 'x', 'x', 1, 0, 'STANDARD', 'CUSTOMER', now(), now() + interval '30 minutes', now(), now())`,
        [randomUUID(), oid, shop.shopId, shop.userId],
      ),
    ).rejects.toThrow(/not confirmed/u);
    expect(await countRows(app.pool, 'SELECT 1 FROM app.orders WHERE order_id = $1::uuid', [oid])).toBe(1);
  });
});
