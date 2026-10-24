import { OrderRecorder } from '../../apps/backend/src/orders/order-recorder';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { DeliverySweeper } from '../../apps/backend/src/delivery/delivery-sweeper';
import { M14_ROUTING } from '../../apps/backend/src/delivery/m14-route-client';
import { NotificationRuntime } from '../../apps/backend/src/notifications/notification-runtime';
import { OrderSweeper } from '../../apps/backend/src/orders/order-sweeper';
import { ApiResponse, AuthApp, countRows, dataOf, loginUser, sessionIdOfToken, startAuthApp } from './support/auth-fixtures';
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
  // Accounts and shops made inside single tests: they are cleaned up with the rest.
  const extraShops: string[] = [];
  const extraUsers: string[] = [];
  const extraCustomers: string[] = [];

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
    await cleanupOrders(app, { shopIds: [shop.shopId, otherShop.shopId, ...extraShops], customerIds: [alice.userId, bob.userId, ...extraCustomers], drivers, userIds: [alice.userId, bob.userId, shop.userId, otherShop.userId, ...extraUsers], policyAdded: addedPolicy });
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
    // No pin: quote the system M06 entry tier, but NEVER invent a route distance or treat it as an agreed fee.
    const unpinned = ok(await asCustomer(alice, 'POST', '/customers/me/orders/preview', { ...body, address: { address_text: '5 Phố Cổ' } }));
    expect(unpinned).toMatchObject({ ok: true, fee: { status: 'ESTIMATE', estimate_vnd: 10_000, distance_m: null }, expected_total_vnd: 100_000 });
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
    extraShops.push(closed.shopId);
    extraUsers.push(closed.userId);
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

  it('there is no "Đã chuẩn bị xong" step: "Gọi shipper" itself means the dishes are ready, right after the shop confirms; a Shipper is not called before confirmation', async () => {
    const pending = await place(alice);
    expect(refused(await callShipper(pending))).toEqual({ status: 409, code: 'ORDER_STATE_CONFLICT' });
    expect(await deliveryOf(String(pending.order_id))).toHaveLength(0);
    const a = await confirm(pending);
    expect(a.can).not.toHaveProperty('ready');
    expect(a).not.toHaveProperty('ready_at');
    expect(a.can).toMatchObject({ call_shipper: true });
    // The APK built before this change still posts to /ready: the call is answered (shop rights and state checked), nothing is recorded and nothing is blocked by it.
    const oldCall = ok(await asShop('POST', `/shop/me/orders/${String(a.order_id)}/ready`, { expected_version: a.version }));
    expect(oldCall).toMatchObject({ order_id: a.order_id, status: 'PREPARING', version: a.version });
    expect(oldCall.can).not.toHaveProperty('ready');
    expect(refused(await asShop('POST', `/shop/me/orders/${String(a.order_id)}/ready`, { expected_version: Number(a.version) + 7 }))).toEqual({ status: 409, code: 'VERSION_CONFLICT' });
    expect(refused(await asShop('POST', `/shop/me/orders/${String(a.order_id)}/ready`, { expected_version: a.version }, undefined, otherShop)).status).toBe(404);
    expect(refused(await asCustomer(alice, 'POST', `/shop/me/orders/${String(a.order_id)}/ready`, { expected_version: a.version })).status).toBeGreaterThanOrEqual(400);
    const called = ok(await callShipper(a), 201);
    expect(called).toMatchObject({ display_status: 'SEARCHING_SHIPPER' });
    expect(called.delivery).toMatchObject({ state: 'waiting_driver', source: 'ORDER', order_id: a.order_id });
    expect(await countRows(app.pool, `SELECT 1 FROM app.order_events WHERE order_id = $1::uuid AND type = 'order.ready'`, [a.order_id])).toBe(0);
    expect((await orderRow(String(a.order_id))).ready_at).toBeNull();
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

  it('public sold quantities count only completed orders, final quantities and lines not removed, once per completion', async () => {
    const dish = await newDish(app, shop.token, `Món lượt bán ${randomUUID()}`, 20_000);
    const removed = await newDish(app, shop.token, `Món đã gỡ ${randomUUID()}`, 10_000);
    const counts = async (): Promise<number[]> => {
      const menu = ok(await app.call('GET', `/shops/${shop.shopId}`, {}));
      const items = (menu.categories as Json[]).flatMap((category) => category.items as Json[]);
      return [dish, removed].map((d) => Number(items.find((item) => item.item_id === d.itemId)?.sold_count));
    };
    const cancelled = await place(alice, [line(dish, 5)]);
    ok(await asCustomer(alice, 'POST', `/customers/me/orders/${String(cancelled.order_id)}/cancel`, { expected_version: 1 }));
    const order = await place(alice, [line(dish, 4), line(dish, 1, 'ít cay'), line(removed, 3)]);
    expect(await counts()).toEqual([0, 0]);
    const id = String(order.order_id);
    const first = (order.items as Json[]).find((item) => item.menu_item_id === dish.itemId && item.note == null);
    const gone = (order.items as Json[]).find((item) => item.menu_item_id === removed.itemId);
    const edited = ok(await asShop('POST', `/shop/me/orders/${id}/edit`, { expected_version: 1, changes: [{ line_id: first?.line_id, quantity: 2 }, { line_id: gone?.line_id, remove: true }] }));
    const prepared = ok(await asShop('POST', `/shop/me/orders/${id}/confirm`, { expected_version: edited.version, change_reason: 'Khách đồng ý bớt món' }));
    const driver = await shipper();
    const { did, version } = await toDelivering(driver, prepared);
    expect(await counts()).toEqual([0, 0]);
    const key = randomUUID();
    ok(await asShipper(driver, 'POST', `/driver/deliveries/${did}/complete`, { expected_version: version }, key));
    expect(await counts()).toEqual([3, 0]);
    ok(await asShipper(driver, 'POST', `/driver/deliveries/${did}/complete`, { expected_version: version }, key));
    expect(await counts()).toEqual([3, 0]);
    const found = ok(await app.call('GET', `/discovery/dishes?area_id=${shop.areaId}&q=${encodeURIComponent(dish.name)}`, {}));
    expect((found.dishes as Json[]).find((item) => item.item_id === dish.itemId)).toMatchObject({ sold_count: 3 });
  });

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

  it('Case "hoàn tất và khách hủy cùng lúc sau pickup": exactly one wins, the Order, the delivery and the commission agree with the winner', async () => {
    const s = await shipper();
    const order = await confirmed(alice);
    const { did, version } = await toDelivering(s, order);
    const oid = String(order.order_id);
    const current = await customerView(alice, oid);
    const [complete, cancel] = await Promise.all([
      asShipper(s, 'POST', `/driver/deliveries/${did}/complete`, { expected_version: version }),
      asCustomer(alice, 'POST', `/customers/me/orders/${oid}/cancel-after-pickup`, { expected_version: current.version, reason: 'Tôi không nhận nữa' }),
    ]);
    expect([complete.status, cancel.status].filter((status) => status === 200)).toHaveLength(1);
    const row = await orderRow(oid);
    expect(await countRows(app.pool, `SELECT 1 FROM app.order_events WHERE order_id = $1::uuid AND type = 'order.completed'`, [oid])).toBe(complete.status === 200 ? 1 : 0);
    if (complete.status === 200) {
      expect(row.status).toBe('COMPLETED');
      expect(await walletOf(app, s)).toEqual({ balance: 49_000, held: 0 });
    } else {
      expect(row.status).toBe('CANCELLED_BY_CUSTOMER');
      expect((await deliveryOf(oid)).map((d) => d.state)).toEqual(['cancelled_by_merchant']);
      expect(await walletOf(app, s)).toEqual({ balance: 50_000, held: 0 });
    }
  });

  it('after pickup the Shipper cannot cancel, give back or fail, and neither can the shop of a customer\'s order or another customer; only the customer who placed it can cancel', async () => {
    const s = await shipper();
    const order = await confirmed(alice);
    const { did, version } = await toDelivering(s, order);
    const oid = String(order.order_id);
    const seen = await customerView(alice, oid);
    expect(seen.can).toMatchObject({ cancel: false, cancel_after_pickup: true });
    expect((await shopView(oid)).can).toMatchObject({ cancel: false });
    expect(((await shopView(oid)).delivery as Json).can).toMatchObject({ cancel: false, cancel_after_pickup: false });
    // The Shipper: no failure report (even straight to the API), no give-back.
    expect(refused(await asShipper(s, 'POST', `/driver/deliveries/${did}/fail`, { expected_version: version, reason_code: 'OTHER', goods_condition: 'WITH_SHIPPER', note: 'x' }))).toEqual({ status: 403, code: 'SHIPPER_FAIL_NOT_ALLOWED' });
    expect(refused(await asShipper(s, 'POST', `/driver/deliveries/${did}/release`, { reason: 'x', expected_version: version }))).toEqual({ status: 409, code: 'AFTER_PICKUP_NO_CANCEL' });
    // The shop: neither the Order nor the request of a customer's order.
    expect(refused(await asShop('POST', `/shop/me/orders/${oid}/cancel`, { expected_version: seen.version, reason: 'x' }))).toEqual({ status: 409, code: 'AFTER_PICKUP_NO_CANCEL' });
    expect(refused(await asShop('POST', `/shop/me/deliveries/${did}/cancel`, { expected_version: version, reason: 'x' }))).toEqual({ status: 409, code: 'AFTER_PICKUP_NO_CANCEL' });
    // Another customer and a missing reason.
    expect(refused(await asCustomer(bob, 'POST', `/customers/me/orders/${oid}/cancel-after-pickup`, { expected_version: seen.version, reason: 'x' })).status).toBe(404);
    expect(refused(await asCustomer(alice, 'POST', `/customers/me/orders/${oid}/cancel-after-pickup`, { expected_version: seen.version })).status).toBe(400);
    expect(refused(await asCustomer(alice, 'POST', `/customers/me/orders/${oid}/cancel-after-pickup`, { expected_version: seen.version + 5, reason: 'x' }))).toEqual({ status: 409, code: 'VERSION_CONFLICT' });
    expect((await orderRow(oid)).status).toBe('PREPARING');
    expect((await deliveryOf(oid)).map((d) => d.state)).toEqual(['delivering']);
    expect(await walletOf(app, s)).toEqual({ balance: 50_000, held: 1000 });
  });

  it('the customer cancels after pickup: the Order and the request end, the commission is given back once, the goods stay with the Shipper until the shop settles them, nothing completes', async () => {
    const s = await shipper();
    const order = await confirmed(alice);
    const { did } = await toDelivering(s, order);
    const oid = String(order.order_id);
    const seen = await customerView(alice, oid);
    const cancelled = ok(await asCustomer(alice, 'POST', `/customers/me/orders/${oid}/cancel-after-pickup`, { expected_version: seen.version, reason: 'Tôi đổi ý, không cần nữa' }));
    expect(cancelled).toMatchObject({ status: 'CANCELLED_BY_CUSTOMER', end_actor: 'CUSTOMER', end_reason: 'Tôi đổi ý, không cần nữa' });
    expect(cancelled.delivery).toMatchObject({ state: 'cancelled_by_merchant', shipper: null, goods_custody: 'SHIPPER' });
    expect((await deliveryOf(oid)).map((d) => d.state)).toEqual(['cancelled_by_merchant']);
    expect(await walletOf(app, s)).toEqual({ balance: 50_000, held: 0 });
    expect(await countRows(app.pool, `SELECT 1 FROM app.wallet_ledger_entries WHERE wallet_id = $1::uuid AND entry_kind <> 'ADJUSTMENT_CREDIT'`, [s.walletId])).toBe(0);
    expect(await countRows(app.pool, `SELECT 1 FROM app.delivery_assignments WHERE delivery_id = $1::uuid AND status = 'CANCELLED_BY_CUSTOMER' AND end_actor = 'CUSTOMER'`, [did])).toBe(1);
    expect(await countRows(app.pool, `SELECT 1 FROM app.delivery_incidents WHERE delivery_id = $1::uuid AND status = 'OPEN' AND custody = 'SHIPPER'`, [did])).toBe(1);
    expect(await countRows(app.pool, `SELECT 1 FROM app.order_events WHERE order_id = $1::uuid AND type = 'order.completed'`, [oid])).toBe(0);
    // Repeating it, or the Shipper completing, changes nothing.
    expect(refused(await asCustomer(alice, 'POST', `/customers/me/orders/${oid}/cancel-after-pickup`, { expected_version: Number(cancelled.version), reason: 'Lần hai' })).status).toBe(409);
    expect((await asShipper(s, 'POST', `/driver/deliveries/${did}/complete`, { expected_version: 1 })).status).toBeGreaterThanOrEqual(400);
    expect(await walletOf(app, s)).toEqual({ balance: 50_000, held: 0 });
    // Audit and notices: who, why, and both sides hear of it.
    expect(await countRows(app.pool, `SELECT 1 FROM app.audit_logs WHERE resource_id = $1::text AND action = 'delivery.cancel_after_pickup.v1' AND metadata->>'actor_type' = 'CUSTOMER' AND metadata->>'reason' = 'Tôi đổi ý, không cần nữa'`, [did])).toBe(1);
    for (let pass = 0; pass < 200 && (await runtime().dispatcher.dispatchOnce()).claimed > 0; pass += 1) {
      // drained
    }
    const kindsOf = async (userId: string): Promise<string[]> => (await app.pool.query(`SELECT kind FROM app.notifications WHERE recipient_user_id = $1::uuid ORDER BY created_at`, [userId])).rows.map((r) => String(r.kind));
    expect(await kindsOf(shop.userId)).toContain('ORDER_CANCELLED_BY_CUSTOMER');
    expect(await kindsOf(s.userId)).toContain('DELIVERY_CANCELLED');
    // The shop settles the goods; the order stays ended.
    ok(await asShop('POST', `/shop/me/deliveries/${did}/custody`, { resolution: 'HANDLED_NO_RETURN', note: 'Shipper đã trả lại hàng cho quán' }));
    expect(await countRows(app.pool, `SELECT 1 FROM app.delivery_incidents WHERE delivery_id = $1::uuid AND status = 'CLOSED'`, [did])).toBe(1);
    expect((await orderRow(oid)).status).toBe('CANCELLED_BY_CUSTOMER');
  });

  it('before pickup the customer still asks the shop: cancelling after pickup is refused while the Shipper has not picked up, and a picked-up goods never time out', async () => {
    const s = await shipper();
    const order = await confirmed(alice);
    const called = ok(await callShipper(order), 201);
    const did = String((called.delivery as Json).delivery_id);
    ok(await asShipper(s, 'POST', `/driver/deliveries/${did}/accept`, {}));
    const seen = await customerView(alice, String(order.order_id));
    expect(seen.can).toMatchObject({ cancel: false, cancel_after_pickup: false });
    expect(refused(await asCustomer(alice, 'POST', `/customers/me/orders/${String(order.order_id)}/cancel-after-pickup`, { expected_version: seen.version, reason: 'x' }))).toEqual({ status: 409, code: 'ORDER_STATE_CONFLICT' });
    expect((await deliveryOf(String(order.order_id))).map((d) => d.state)).toEqual(['accepted']);
  });

  const counter = (s: Shipper, did: string, amount: number): Promise<ApiResponse> => asShipper(s, 'POST', `/driver/deliveries/${did}/fee/counter`, { amount_vnd: amount });
  const deliveryOfOrder = async (c: Customer, oid: string): Promise<Json> => (await customerView(c, oid)).delivery as Json;

  it('ORDER paid by the CUSTOMER: a Shipper\'s other fee is decided by the customer in 11Food (not the shop); a refusal keeps the Order and the earlier fee and the search goes on; an acceptance lets that Shipper take it', async () => {
    const s = await shipper();
    const s2 = await shipper();
    const order = await confirmed(alice);
    const oid = String(order.order_id);
    const called = ok(await callShipper(order, { fee_payer: 'CUSTOMER', agreed_fee: { reason_code: 'URGENT', amount_vnd: 14_000 } }), 201);
    const did = String((called.delivery as Json).delivery_id);
    expect(called.delivery).toMatchObject({ fee: { payer: 'CUSTOMER', decider: 'CUSTOMER' } });
    ok(await counter(s, did, 16_000));
    // The shop is told it waits for the payer and cannot answer in their place; the customer sees the question.
    expect(((await shopView(oid)).delivery as Json).can).toMatchObject({ decide_fee: false, wait_customer_fee: true });
    expect(refused(await asShop('POST', `/shop/me/deliveries/${did}/fee/counter-accept`, { expected_version: Number(((await shopView(oid)).delivery as Json).version) }))).toEqual({ status: 409, code: 'DELIVERY_STATE_CONFLICT' });
    const asked = await deliveryOfOrder(alice, oid);
    expect(asked.fee_decision).toMatchObject({ state: 'COUNTERED', current_vnd: 14_000, offered_vnd: 16_000, can_decline: true });
    expect(refused(await asCustomer(bob, 'POST', `/customers/me/orders/${oid}/delivery/fee`, { decision: 'REJECT', expected_version: asked.version })).status).toBe(404);
    expect(refused(await asCustomer(alice, 'POST', `/customers/me/orders/${oid}/delivery/fee`, { decision: 'REJECT', expected_version: Number(asked.version) + 3 }))).toEqual({ status: 409, code: 'VERSION_CONFLICT' });
    // Refused: the Order and the request stay, the fee stays, the search goes on.
    const rejected = ok(await asCustomer(alice, 'POST', `/customers/me/orders/${oid}/delivery/fee`, { decision: 'REJECT', expected_version: asked.version }));
    expect(rejected).toMatchObject({ status: 'PREPARING', display_status: 'SEARCHING_SHIPPER' });
    expect(rejected.delivery).toMatchObject({ state: 'waiting_driver', fee_decision: null });
    expect((await deliveryOf(oid)).map((d) => d.state)).toEqual(['waiting_driver']);
    expect(await countRows(app.pool, `SELECT 1 FROM app.shipping_fee_agreement_events e JOIN app.shipping_fee_agreements a USING (agreement_id) WHERE a.delivery_id = $1::uuid AND e.event_type = 'COUNTER_REJECTED' AND e.actor_type = 'CUSTOMER'`, [did])).toBe(1);
    for (let pass = 0; pass < 200 && (await runtime().dispatcher.dispatchOnce()).claimed > 0; pass += 1) {
      // drained: the refused Shipper hears the answer even though nothing binds them any more
    }
    expect((await app.pool.query(`SELECT kind FROM app.notifications WHERE recipient_user_id = $1::uuid AND target_id = $2::uuid`, [s.userId, did])).rows.map((r) => r.kind)).toContain('FEE_UPDATED');
    // The same Shipper cannot push the refused amount again; another Shipper must have the shop's earlier fee settled before taking the delivery.
    expect((await counter(s, did, 16_000)).status).toBeGreaterThanOrEqual(400);
    expect((await asShipper(s2, 'POST', `/driver/deliveries/${did}/accept`, {})).status).toBe(409);
    ok(await asShipper(s2, 'POST', `/driver/deliveries/${did}/fee/agree`, {}));
    const still = await deliveryOfOrder(alice, oid);
    expect(still.fee_decision).toMatchObject({ state: 'AWAITING_CUSTOMER', current_vnd: 14_000, offered_vnd: 14_000, can_decline: false });
    // Refusing the shop's own proposal is not offered; accepting lets s2 take it, and the other Shipper cannot.
    expect(refused(await asCustomer(alice, 'POST', `/customers/me/orders/${oid}/delivery/fee`, { decision: 'REJECT', expected_version: still.version })).status).toBe(409);
    ok(await asCustomer(alice, 'POST', `/customers/me/orders/${oid}/delivery/fee`, { decision: 'ACCEPT', expected_version: still.version }));
    const taken = ok(await asShipper(s2, 'POST', `/driver/deliveries/${did}/accept`, {}));
    expect(taken.fee).toMatchObject({ amount_vnd: 14_000, status: 'FINAL' });
    expect(taken.can).toMatchObject({ confirm_fee: false, pickup: true, fail: false });
    expect(await walletOf(app, s)).toEqual({ balance: 50_000, held: 0 }); // the Shipper whose counter-offer was refused holds nothing
    expect(await walletOf(app, s2)).toEqual({ balance: 50_000, held: 1000 });
    // One step: pickup, then the fee is locked and the delivery completes the Order once.
    const picked = ok(await asShipper(s2, 'POST', `/driver/deliveries/${did}/pickup`, { expected_version: taken.version }));
    ok(await asShipper(s2, 'POST', `/driver/deliveries/${did}/complete`, { expected_version: picked.version }));
    expect((await orderRow(oid)).status).toBe('COMPLETED');
    expect(await walletOf(app, s2)).toEqual({ balance: 49_000, held: 0 });
    // Notices: the customer hears the question, the shop the progress, the Shippers the result.
    for (let pass = 0; pass < 200 && (await runtime().dispatcher.dispatchOnce()).claimed > 0; pass += 1) {
      // drained
    }
    const kindsOf = async (userId: string): Promise<string[]> => (await app.pool.query(`SELECT kind FROM app.notifications WHERE recipient_user_id = $1::uuid AND target_id IN ($2::uuid, $3::uuid)`, [userId, oid, did])).rows.map((r) => String(r.kind));
    expect(await kindsOf(alice.userId)).toContain('FEE_COUNTERED');
    expect(await kindsOf(shop.userId)).toEqual(expect.arrayContaining(['FEE_COUNTERED', 'FEE_UPDATED']));
    expect(await kindsOf(s2.userId)).toContain('FEE_UPDATED');
  });

  it('ORDER paid by the SHOP: the shop decides the Shipper\'s other fee, the customer is not asked and cannot answer; refusing keeps the Order', async () => {
    const s = await shipper();
    const order = await confirmed(alice);
    const oid = String(order.order_id);
    const called = ok(await callShipper(order, { fee_payer: 'SHOP', agreed_fee: { reason_code: 'BAD_WEATHER', amount_vnd: 14_000 } }), 201);
    const did = String((called.delivery as Json).delivery_id);
    ok(await counter(s, did, 17_000));
    const v = (await shopView(oid)).delivery as Json;
    expect(v.can).toMatchObject({ decide_fee: true, wait_customer_fee: false });
    expect((await deliveryOfOrder(alice, oid)).fee_decision).toBeNull();
    expect(refused(await asCustomer(alice, 'POST', `/customers/me/orders/${oid}/delivery/fee`, { decision: 'ACCEPT', expected_version: v.version }))).toEqual({ status: 409, code: 'DELIVERY_STATE_CONFLICT' });
    const rejected = ok(await asShop('POST', `/shop/me/deliveries/${did}/fee/counter-reject`, { expected_version: v.version }));
    expect(rejected).toMatchObject({ state: 'waiting_driver' });
    expect((await orderRow(oid)).status).toBe('PREPARING');
    ok(await counter(s, did, 15_000));
    const accepted = ok(await asShop('POST', `/shop/me/deliveries/${did}/fee/counter-accept`, { expected_version: Number(((await shopView(oid)).delivery as Json).version) }));
    expect(accepted.fee).toMatchObject({ amount_vnd: 15_000, status: 'FINAL' });
    const taken = ok(await asShipper(s, 'POST', `/driver/deliveries/${did}/accept`, {}));
    expect(taken.fee.amount_vnd).toBe(15_000);
  });

  it('an ORDER whose fee cannot be priced is told so instead of creating a call no Shipper could take; the shop then proposes a fee, and an address-only order works with the checkout distance', async () => {
    const order = await confirmed(alice);
    // Reproduces "no route and no estimate": the order carries no distance and the fee table cannot price an unknown distance.
    await app.pool.query('ALTER TABLE app.orders DISABLE TRIGGER USER');
    await app.pool.query('UPDATE app.orders SET fee_estimate_distance_m = NULL, address_lat = NULL, address_lng = NULL WHERE order_id = $1::uuid', [order.order_id]);
    await app.pool.query('ALTER TABLE app.orders ENABLE TRIGGER USER');
    const fresh = await shopView(String(order.order_id));
    expect(refused(await callShipper(fresh))).toEqual({ status: 400, code: 'FEE_REQUIRED' });
    expect(await deliveryOf(String(order.order_id))).toHaveLength(0);
    const proposed = ok(await callShipper(fresh, { fee_payer: 'SHOP', agreed_fee: { reason_code: 'OUT_OF_PRICE_RANGE', amount_vnd: 25_000 } }), 201);
    expect(proposed.delivery).toMatchObject({ state: 'waiting_driver', recipient: { lat: null, lng: null }, fee: { mode: 'AGREED', status: 'PENDING_AGREEMENT' } });
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
    extraShops.push(night.shopId);
    extraUsers.push(night.userId);
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
    extraCustomers.push(carol.userId);
    extraUsers.push(carol.userId);
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
    extraCustomers.push(dana.userId);
    extraUsers.push(dana.userId);
    const order = await place(dana, [line(bun, 1)]);
    const oid = String(order.order_id);
    await confirm(order);
    const s = await shipper();
    const called = ok(await callShipper(await shopView(oid)), 201);
    ok(await asShipper(s, 'POST', `/driver/deliveries/${String((called.delivery as Json).delivery_id)}/accept`, {}));
    for (let pass = 0; pass < 200; pass += 1) {
      if ((await runtime().dispatcher.dispatchOnce()).claimed === 0) break;
    }
    const kinds = async (userId: string): Promise<string[]> => (await app.pool.query(`SELECT kind FROM app.notifications WHERE recipient_user_id = $1::uuid AND target_id = $2::uuid ORDER BY created_at, kind`, [userId, oid])).rows.map((r) => String(r.kind));
    // The shop's notice of its Shipper accepting opens the ORDER (one page per order), so it is filed under the order's id too.
    expect(await kinds(shop.userId)).toEqual(['ORDER_PLACED', 'DELIVERY_ACCEPTED']);
    expect((await kinds(dana.userId)).sort()).toEqual(['ORDER_CONFIRMED', 'ORDER_SHIPPER_ACCEPTED']);
    // The lock-screen text carries only the code.
    const bodies = (await app.pool.query(`SELECT title, body FROM app.notifications WHERE target_id = $1::uuid`, [oid])).rows.map((r) => `${String(r.title)} ${String(r.body)}`).join(' ');
    expect(order.display_code).toMatch(/^K\d{2,}-\d{4,}$/u);
    expect(bodies).toContain(String(order.display_code));
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
  // #153: move persisted test deadlines, never wait or alter the application clock.
  async function timeoutAge(table:'orders'|'deliveries'|'delivery_assignments',id:string,minutes:number):Promise<void>{
    const key=table==='orders'?'order_id':table==='deliveries'?'delivery_id':'assignment_id';
    const trigger=table==='orders'?'timeout_snapshot_orders':table==='deliveries'?'timeout_snapshot_deliveries':'timeout_snapshot_assignments';
    const c=await app.pool.connect();
    try{await c.query('BEGIN');await c.query(`ALTER TABLE app.${table} DISABLE TRIGGER ${trigger}`);
      await c.query(`UPDATE app.${table} SET timeout_snapshot=timeout_snapshot||jsonb_build_object(
        'warning_at',(timeout_snapshot->>'warning_at')::timestamptz-make_interval(mins=>$2::int),
        'cancel_at',(timeout_snapshot->>'cancel_at')::timestamptz-make_interval(mins=>$2::int)),
        ${table==='orders'?'timeout_next_reminder_at=timeout_next_reminder_at-make_interval(mins=>$2::int),':''}
        version=version+1 WHERE ${key}=$1::uuid`,[id,minutes]);
      await c.query('SET CONSTRAINTS ALL IMMEDIATE');
      await c.query(`ALTER TABLE app.${table} ENABLE TRIGGER ${trigger}`);await c.query('COMMIT');
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }
  async function timeoutDrain():Promise<void>{for(let i=0;i<200&&(await runtime().dispatcher.dispatchOnce()).claimed>0;i+=1){/* drain */}}
  async function activeAssignment(did:string):Promise<string>{return String((await app.pool.query(`SELECT assignment_id FROM app.delivery_assignments WHERE delivery_id=$1::uuid AND status='ACTIVE'`,[did])).rows[0].assignment_id);}

  it('#153: 15/20/25 reminders, one cancellation at 30, durable audit and reorder',async()=>{
    const o=await place(alice),oid=String(o.order_id);await timeoutAge('orders',oid,25);
    await Promise.all([orderSweeper().sweep(),orderSweeper().sweep()]);
    expect(await countRows(app.pool,`SELECT 1 FROM app.order_events WHERE order_id=$1::uuid AND type='order.confirmation_reminder'`,[oid])).toBe(3);
    await timeoutAge('orders',oid,5);await Promise.all([orderSweeper().sweep(),orderSweeper().sweep()]);
    expect(await orderRow(oid)).toMatchObject({status:'CANCELLED_BY_SYSTEM',end_actor:'SYSTEM',end_reason:'QUÁ HẠN QUÁN XÁC NHẬN'});
    expect(await countRows(app.pool,`SELECT 1 FROM app.order_events WHERE order_id=$1::uuid AND type='order.confirmation_timeout'`,[oid])).toBe(1);
    expect(await countRows(app.pool,`SELECT 1 FROM app.cancellation_transitions WHERE resource_id=$1::uuid AND before_state='PENDING_CONFIRMATION' AND after_state='CANCELLED_BY_SYSTEM' AND source='timeout' AND request_id IS NOT NULL`,[oid])).toBe(1);
    await timeoutDrain();expect((await app.pool.query(`SELECT recipient_user_id::text FROM app.notifications WHERE target_id=$1::uuid AND kind='ORDER_TIMEOUT'`,[oid])).rows).toEqual([{recipient_user_id:alice.userId}]);
    expect((await customerView(alice,oid)).display_status).toBe('CANCELLED_BY_SYSTEM');
    expect((await asCustomer(alice,'POST',`/customers/me/orders/${oid}/reorder`,{replace_cart:true})).status).toBe(200);
  });
  it('#153: stopped search warns both parties; 60 cancels the whole Order once',async()=>{
    const o=await confirmed(alice),called=ok(await callShipper(o),201),did=String((called.delivery as Json).delivery_id),oid=String(o.order_id);
    await ageDelivery(app,did,31);await deliverySweeper().sweep();expect((await orderRow(oid)).status).toBe('PREPARING');
    await timeoutDrain();const recipients=(await app.pool.query(`SELECT recipient_user_id::text FROM app.notifications WHERE kind='SEARCH_STOPPED' AND (target_id=$1::uuid OR target_id=$2::uuid)`,[oid,did])).rows.map(r=>r.recipient_user_id);
    expect(recipients.sort()).toEqual([alice.userId,shop.userId].sort());
    await timeoutAge('deliveries',did,60);await Promise.all([orderSweeper().sweep(),orderSweeper().sweep()]);
    expect((await orderRow(oid)).status).toBe('CANCELLED_BY_SYSTEM');expect((await deliveryOf(oid))[0].state).toBe('cancelled_by_system');
    await timeoutDrain();expect(await countRows(app.pool,`SELECT 1 FROM app.notifications WHERE kind='ORDER_TIMEOUT' AND target_id=$1::uuid`,[oid])).toBe(2);
  });
  it('#153: acceptance has an independent 30/60 clock; timeout releases commission and informs all parties',async()=>{
    const d=await shipper(),o=await confirmed(alice),called=ok(await callShipper(o),201),did=String((called.delivery as Json).delivery_id),oid=String(o.order_id);
    await timeoutAge('deliveries',did,60);ok(await asShipper(d,'POST',`/driver/deliveries/${did}/accept`,{}));await orderSweeper().sweep();expect((await orderRow(oid)).status).toBe('PREPARING');
    const aid=await activeAssignment(did);await timeoutAge('delivery_assignments',aid,30);await Promise.all([orderSweeper().sweep(),orderSweeper().sweep()]);await timeoutDrain();
    expect(await countRows(app.pool,`SELECT 1 FROM app.notifications WHERE kind='PICKUP_TIMEOUT_WARNING' AND (target_id=$1::uuid OR target_id=$2::uuid)`,[oid,did])).toBe(3);
    await timeoutAge('delivery_assignments',aid,30);await Promise.all([orderSweeper().sweep(),orderSweeper().sweep()]);
    expect((await orderRow(oid)).status).toBe('CANCELLED_BY_SYSTEM');expect(await walletOf(app,d)).toEqual({balance:50_000,held:0});
    expect((await app.pool.query('SELECT status,end_actor FROM app.delivery_assignments WHERE assignment_id=$1::uuid',[aid])).rows[0]).toMatchObject({status:'CANCELLED_BY_SYSTEM',end_actor:'SYSTEM'});
    await timeoutDrain();expect(await countRows(app.pool,`SELECT 1 FROM app.notifications WHERE kind='DELIVERY_CANCELLED' AND target_id=$1::uuid AND recipient_user_id=$2::uuid`,[did,d.userId])).toBe(1);
  });
  it('#153: pickup vs expiry has one winner; picked-up goods never auto-cancel',async()=>{
    const d=await shipper(),o=await confirmed(alice),called=ok(await callShipper(o),201),did=String((called.delivery as Json).delivery_id),oid=String(o.order_id);
    const accepted=ok(await asShipper(d,'POST',`/driver/deliveries/${did}/accept`,{}));
    const dest=await asShipper(d,'POST',`/driver/deliveries/${did}/destination`,{expected_version:accepted.version,lat:21,lng:105.82,fee_vnd:15_000});const current=dest.status===200?dataOf(dest) as Json:accepted;
    await timeoutAge('delivery_assignments',await activeAssignment(did),60);
    await Promise.all([orderSweeper().sweep(),asShipper(d,'POST',`/driver/deliveries/${did}/pickup`,{expected_version:current.version})]);
    const state=(await deliveryOf(oid))[0].state;expect(['delivering','cancelled_by_system']).toContain(state);await orderSweeper().sweep();
    expect((await orderRow(oid)).status).toBe(state==='delivering'?'PREPARING':'CANCELLED_BY_SYSTEM');expect((await walletOf(app,d)).held).toBe(state==='delivering'?1000:0);
  });
  it('#153: confirm vs deadline has one winner',async()=>{
    const o=await place(alice),oid=String(o.order_id);await timeoutAge('orders',oid,30);const version=Number((await orderRow(oid)).version);
    const [,r]=await Promise.all([orderSweeper().sweep(),asShop('POST',`/shop/me/orders/${oid}/confirm`,{expected_version:version})]);const row=await orderRow(oid);
    expect(['PREPARING','CANCELLED_BY_SYSTEM']).toContain(row.status);expect(r.status).toBe(row.status==='PREPARING'?200:409);
  });
  it('#153: a released assignment stops its old timer; the next driver has a fresh pickup deadline',async()=>{
    const a=await shipper(),b=await shipper(),o=await confirmed(alice),called=ok(await callShipper(o),201),did=String((called.delivery as Json).delivery_id),oid=String(o.order_id);
    const accepted=ok(await asShipper(a,'POST',`/driver/deliveries/${did}/accept`,{}));await timeoutAge('delivery_assignments',await activeAssignment(did),60);
    ok(await asShipper(a,'POST',`/driver/deliveries/${did}/release`,{expected_version:accepted.version,reason:'Bận đột xuất'}));ok(await asShipper(b,'POST',`/driver/deliveries/${did}/accept`,{}));
    await orderSweeper().sweep();expect((await orderRow(oid)).status).toBe('PREPARING');expect((await walletOf(app,a)).held).toBe(0);expect((await walletOf(app,b)).held).toBe(1000);
  });
  it('#153: audit failure rolls back order, assignment, hold and outbox atomically',async()=>{
    const d=await shipper(),o=await confirmed(alice),called=ok(await callShipper(o),201),did=String((called.delivery as Json).delivery_id),oid=String(o.order_id);
    ok(await asShipper(d,'POST',`/driver/deliveries/${did}/accept`,{}));await timeoutAge('delivery_assignments',await activeAssignment(did),60);
    const recorder=app.running.app.get(OrderRecorder),original=recorder.record.bind(recorder);const spy=jest.spyOn(recorder,'record').mockImplementation(async(c,change)=>{if(change.order.orderId===oid&&change.type==='delivery_timeout')throw new Error('forced timeout audit failure');await original(c,change);});
    try{await expect(orderSweeper().sweep()).rejects.toThrow('forced timeout audit failure');}finally{spy.mockRestore();}
    expect((await orderRow(oid)).status).toBe('PREPARING');expect((await deliveryOf(oid))[0].state).toBe('accepted');expect((await walletOf(app,d)).held).toBe(1000);
    expect(await countRows(app.pool,'SELECT 1 FROM app.cancellation_transitions WHERE resource_id=$1::uuid',[oid])).toBe(0);await orderSweeper().sweep();expect((await walletOf(app,d)).held).toBe(0);
  });
  it('#153: policy snapshots stay immutable; new delivery uses current policy; scheduled confirmation is exempt',async()=>{
    const o=await place(alice),oid=String(o.order_id),before=(await orderRow(oid)).timeout_snapshot;
    await expect(app.pool.query(`UPDATE app.orders SET timeout_snapshot=timeout_snapshot||'{"rule_version":999}',version=version+1 WHERE order_id=$1::uuid`,[oid])).rejects.toThrow(/TIMEOUT_SNAPSHOT_IMMUTABLE/u);
    await app.pool.query(`UPDATE app.order_timeout_policy SET parameters=jsonb_set(parameters,'{search_stop}','25'),version=version+1 WHERE id`);
    try{const co=await confirm(o);ok(await callShipper(co),201);const d=(await deliveryOf(oid))[0];expect((await orderRow(oid)).timeout_snapshot).toEqual(before);expect(new Date(d.search_expires_at).getTime()-new Date(d.search_started_at).getTime()).toBe(25*60_000);}
    finally{await app.pool.query(`UPDATE app.order_timeout_policy SET parameters=jsonb_set(parameters,'{search_stop}','30'),version=version+1 WHERE id`);}
    const scheduled=await place(alice,undefined,{scheduled_for:new Date(Date.now()+90*60_000).toISOString()});expect((await orderRow(String(scheduled.order_id))).timeout_snapshot).toBeNull();
  });

  // ---- one page per order: lists, notifications and the story ------------------------------------------------------------

  const directBody = (over: Json = {}): Json => ({ recipient_name: 'Khách gọi riêng', recipient_phone: '0912345678', dropoff_address_text: '12 Phố Huế, Hai Bà Trưng, Hà Nội', dropoff_lat: 21.0, dropoff_lng: 105.82, goods_description: 'Hộp quà', goods_value_vnd: 200_000, paid_vnd: 0, fee_payer: 'CUSTOMER', ...over });
  const listAll = async (query: string): Promise<Json[]> => {
    const rows: Json[] = [];
    for (let offset = 0; offset < 400; offset += 7) {
      const page = (ok(await asShop('GET', `/shop/me/deliveries?${query}&limit=7&offset=${String(offset)}`)).deliveries as Json[]);
      rows.push(...page);
      if (page.length < 7) break;
    }
    return rows;
  };

  it('"Giao hàng" lists only direct calls — active and history, every filter, search and page — and a call for an order never becomes a row of its own, even after calling again', async () => {
    const s = await shipper();
    const direct = ok(await asShop('POST', '/shop/me/deliveries', directBody()), 201);
    const history = ok(await asShop('POST', '/shop/me/deliveries', directBody({ recipient_name: 'Khách đã hủy' })), 201);
    ok(await asShop('POST', `/shop/me/deliveries/${String(history.delivery_id)}/cancel`, { reason: 'Đổi ý', expected_version: history.version }));
    // An order with two calls: the first ended (history), the second still searching (active); a third order is delivered and complete.
    const order = await confirmed(alice, [line(pho, 1)], { recipient_name: 'Người nhận đơn món' });
    const first = ok(await callShipper(order), 201);
    const firstDelivery = first.delivery as Json;
    ok(await asShop('POST', `/shop/me/deliveries/${String(firstDelivery.delivery_id)}/cancel`, { reason: 'Chờ lâu', expected_version: firstDelivery.version }));
    ok(await callShipper(await shopView(String(order.order_id))), 201);
    const done = await confirmed(alice, [line(tea, 1)], { recipient_name: 'Người nhận đơn món' });
    const { did, version } = await toDelivering(s, done);
    ok(await asShipper(s, 'POST', `/driver/deliveries/${did}/complete`, { expected_version: version }));
    const orderDeliveryIds = (await app.pool.query(`SELECT delivery_id::text FROM app.deliveries WHERE shop_id = $1::uuid AND source = 'ORDER'`, [shop.shopId])).rows.map((r) => String(r.delivery_id));
    expect(orderDeliveryIds.length).toBeGreaterThanOrEqual(3);
    const directIds = async (where = ''): Promise<string[]> => (await app.pool.query(`SELECT delivery_id::text FROM app.deliveries d WHERE shop_id = $1::uuid AND source = 'DIRECT' ${where} ORDER BY created_at DESC, delivery_id`, [shop.shopId])).rows.map((r) => String(r.delivery_id));
    const idsOf = (rows: Json[]): string[] => rows.map((r) => String(r.delivery_id));
    // Paged through the API 7 rows at a time: the same rows as the database holds for direct calls, no gap, no repeat, never an order's call.
    const all = idsOf(await listAll('scope=all'));
    expect(all).toEqual(await directIds());
    expect(new Set(all).size).toBe(all.length);
    expect(all).toEqual(expect.arrayContaining([String(direct.delivery_id), String(history.delivery_id)]));
    for (const id of orderDeliveryIds) expect(all).not.toContain(id);
    const active = idsOf(await listAll('scope=active'));
    const past = idsOf(await listAll('scope=history'));
    expect(active).toContain(String(direct.delivery_id));
    expect(past).toContain(String(history.delivery_id));
    expect([...active, ...past].sort()).toEqual([...all].sort());
    for (const id of orderDeliveryIds) expect([...active, ...past]).not.toContain(id);
    expect((await listAll('scope=all&filter=searching')).every((r) => r.source === 'DIRECT' && ['waiting_driver', 'search_stopped'].includes(String(r.state)))).toBe(true);
    expect(idsOf(await listAll('scope=all&filter=completed'))).toEqual(await directIds(`AND state = 'completed'`));
    // Search by what only an order's call has (its recipient, its code) finds nothing in this list.
    expect(await listAll('scope=all&q=' + encodeURIComponent('Người nhận đơn món'))).toEqual([]);
    expect(await listAll('scope=all&q=' + encodeURIComponent(String(order.display_code)))).toEqual([]);
    expect(idsOf(await listAll('scope=all&q=' + encodeURIComponent('Khách đã hủy')))).toEqual([String(history.delivery_id)]);
    // Calling again from the order adds no row to "Giao hàng".
    const before = (await listAll('scope=all')).length;
    const stopped = await shopView(String(order.order_id));
    expect(stopped.deliveries).toHaveLength(2);
    expect((await listAll('scope=all')).length).toBe(before);
    // The order page is where the calls are read: both calls, newest last, with the current one in full.
    expect(((await shopView(String(order.order_id))).delivery as Json).delivery_id).toBe((stopped.deliveries as Json[])[1]?.delivery_id);
    // The order list still holds the orders (and only orders).
    const orders = (ok(await asShop('GET', '/shop/me/orders?filter=all&limit=50')).orders) as Json[];
    expect(orders.map((o) => o.order_id)).toEqual(expect.arrayContaining([order.order_id, done.order_id]));
    expect(orders.every((o) => o.order_id !== undefined && o.delivery_id === undefined)).toBe(true);
  });

  it('every notice of one order opens that order: the shop\'s new notices, old ones that point at a delivery (any call of the order), and never another order or a stranger\'s', async () => {
    const s = await shipper();
    // The notification routes serve CLIENT sessions of the Food app: the shop owner signs in on the Food app (shop hat). One session per account, so the
    // staff-style session the other tests use is restored at the end.
    const food = await app.call('POST', '/client-auth/login', { headers: { 'idempotency-key': randomUUID() }, body: { phone: shop.user.phone.local, password: shop.user.password, device: { device_id: 'web-food-m10-link', platform: 'WEB', app: 'FOOD' } } });
    const foodToken = String(ok(food).access_token);
    ok(await app.call('POST', '/auth/role/select', { bearer: foodToken, body: { role: 'SHOP' } }));
    shop = { ...shop, token: foodToken };
    try {
      await everyNoticeOpensTheOrder(s, foodToken);
    } finally {
      const back = await loginUser(app, shop.user);
      const token = String(ok(back).access_token);
      ok(await app.call('POST', '/auth/role/select', { bearer: token, body: { role: 'SHOP' } }));
      shop = { ...shop, token, sessionId: await sessionIdOfToken(app.pool, token) };
    }
  });

  async function everyNoticeOpensTheOrder(s: Shipper, foodToken: string): Promise<void> {
    const asFoodShop = (method: Verb, path: string, body?: unknown): Promise<ApiResponse> => app.call(method, path, { bearer: foodToken, ...(body === undefined ? {} : { body }) });
    const order = await confirmed(alice, [line(pho, 1)]);
    const oid = String(order.order_id);
    const first = ok(await callShipper(order), 201);
    const firstId = String((first.delivery as Json).delivery_id);
    ok(await asShipper(s, 'POST', `/driver/deliveries/${firstId}/accept`, {}));
    const acceptedView = await shopView(oid);
    ok(await asShipper(s, 'POST', `/driver/deliveries/${firstId}/release`, { expected_version: Number((acceptedView.delivery as Json).version), reason: 'Bận đột xuất' }));
    const stopped = await shopView(oid);
    await ageDelivery(app, firstId, 31);
    await deliverySweeper().sweep();
    ok(await callShipper(await shopView(oid)), 201);
    for (let pass = 0; pass < 200; pass += 1) {
      if ((await runtime().dispatcher.dispatchOnce()).claimed === 0) break;
    }
    expect(stopped.status).toBe('PREPARING');
    const deliveryKinds = ['DELIVERY_ACCEPTED', 'DELIVERY_RELEASED', 'SEARCH_STOPPED'];
    const rows = (await app.pool.query(`SELECT notification_id::text, kind, target_type, target_id::text FROM app.notifications WHERE recipient_user_id = $1::uuid AND kind = ANY($2::text[]) AND app = 'FOOD' AND target_id = $3::uuid`, [shop.userId, deliveryKinds, oid])).rows;
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const orderDeliveries = (await deliveryOf(oid)).map((r) => String(r.delivery_id));
    expect(await countRows(app.pool, `SELECT 1 FROM app.notifications WHERE recipient_user_id = $1::uuid AND app = 'FOOD' AND target_type = 'DELIVERY' AND target_id = ANY($2::uuid[])`, [shop.userId, orderDeliveries])).toBe(0);
    // New notices: all point at the order id, never at a delivery.
    for (const row of rows) expect([row.target_type, row.target_id]).toEqual(['ORDER', oid]);
    for (const row of rows) {
      expect(ok(await asFoodShop('POST', `/notifications/${String(row.notification_id)}/open`, {}))).toMatchObject({ target: { type: 'ORDER', id: oid } });
    }
    // Old notices (made before this rule) point at a delivery: the first call and the current one both open the same order.
    const current = String(((await shopView(oid)).delivery as Json).delivery_id);
    expect(current).not.toBe(firstId);
    for (const legacy of [firstId, current]) {
      await app.pool.query(`UPDATE app.notifications SET target_type = 'DELIVERY', target_id = $2::uuid WHERE notification_id = $1::uuid`, [rows[0]?.notification_id, legacy]);
      const opened = ok(await asFoodShop('POST', `/notifications/${String(rows[0]?.notification_id)}/open`, {}));
      expect(opened).toMatchObject({ outcome: expect.stringMatching(/^(OK|ENDED)$/u), target: { type: 'ORDER', id: oid } });
    }
    // A delivery of another shop's order is not opened for this shop, and nothing is silently opened instead; a missing delivery likewise.
    const foreignShopOrder = await place(alice, [line(await newDish(app, otherShop.token, 'Món quán khác 2', 30_000), 1)], { shop_id: otherShop.shopId });
    const foreignConfirmed = ok(await asShop('POST', `/shop/me/orders/${String(foreignShopOrder.order_id)}/confirm`, { expected_version: foreignShopOrder.version }, undefined, otherShop));
    const foreignCall = ok(await asShop('POST', `/shop/me/orders/${String(foreignConfirmed.order_id)}/call-shipper`, { expected_version: foreignConfirmed.version }, undefined, otherShop), 201);
    for (const target of [String((foreignCall.delivery as Json).delivery_id), randomUUID()]) {
      await app.pool.query(`UPDATE app.notifications SET target_type = 'DELIVERY', target_id = $2::uuid WHERE notification_id = $1::uuid`, [rows[0]?.notification_id, target]);
      expect(ok(await asFoodShop('POST', `/notifications/${String(rows[0]?.notification_id)}/open`, {}))).toMatchObject({ outcome: 'NO_ACCESS', target: null });
    }
    // The customer's notices of the same order already open the order; a direct delivery's notice still opens that delivery.
    const customerRows = (await app.pool.query(`SELECT notification_id::text, target_type, target_id::text FROM app.notifications WHERE recipient_user_id = $1::uuid AND target_id = $2::uuid`, [alice.userId, oid])).rows;
    expect(customerRows.length).toBeGreaterThan(0);
    const direct = ok(await asShop('POST', '/shop/me/deliveries', directBody()), 201);
    ok(await asShipper(s, 'POST', `/driver/deliveries/${String(direct.delivery_id)}/accept`, {}));
    for (let pass = 0; pass < 200; pass += 1) {
      if ((await runtime().dispatcher.dispatchOnce()).claimed === 0) break;
    }
    const directNotice = (await app.pool.query(`SELECT notification_id::text, target_type FROM app.notifications WHERE recipient_user_id = $1::uuid AND target_id = $2::uuid AND app = 'FOOD'`, [shop.userId, direct.delivery_id])).rows[0] as Json;
    expect(directNotice.target_type).toBe('DELIVERY');
    expect(ok(await asFoodShop('POST', `/notifications/${String(directNotice.notification_id)}/open`, {}))).toMatchObject({ target: { type: 'DELIVERY', id: direct.delivery_id } });
    // 11Ship keeps opening the delivery of the Shipper.
    const shipRow = (await app.pool.query(`SELECT notification_id::text, target_type, target_id::text FROM app.notifications WHERE recipient_user_id = $1::uuid AND app = 'SHIP' AND target_type = 'DELIVERY'`, [s.userId])).rows;
    for (const row of shipRow) {
      expect(ok(await asShipper(s, 'POST', `/notifications/${String(row.notification_id)}/open`, {}))).toMatchObject({ target: { type: 'DELIVERY', id: row.target_id } });
    }
  }

  it('the order tells its story in plain words — one page for both calls — and the log underneath is kept whole', async () => {
    const s = await shipper();
    const order = await confirmed(alice, [line(pho, 1)]);
    const oid = String(order.order_id);
    const first = ok(await callShipper(order), 201);
    const firstDelivery = first.delivery as Json;
    const accepted = ok(await asShipper(s, 'POST', `/driver/deliveries/${String(firstDelivery.delivery_id)}/accept`, {}));
    await deliverySweeper().sweep();
    ok(await asShipper(s, 'POST', `/driver/deliveries/${String(firstDelivery.delivery_id)}/release`, { expected_version: accepted.version, reason: 'Xe hỏng' }));
    const searching = (await shopView(oid)).delivery as Json;
    ok(await asShop('POST', `/shop/me/deliveries/${String(searching.delivery_id)}/cancel`, { reason: 'Chờ lâu', expected_version: searching.version }));
    ok(await callShipper(await shopView(oid)), 201);
    const view = await shopView(oid);
    const story = view.story as { at: string; text: string }[];
    expect(story.map((e) => e.text)).toEqual(['Đã đặt đơn', 'Quán đã xác nhận', 'Đang tìm shipper', 'Shipper đã nhận đơn', 'Shipper đã hủy nhận đơn — Xe hỏng', 'Quán đã hủy yêu cầu giao — Chờ lâu', 'Quán gọi lại shipper, đang tìm shipper']);
    expect(view.status).toBe('PREPARING');
    expect(story.map((e) => Date.parse(e.at))).toEqual([...story.map((e) => Date.parse(e.at))].sort((a, b) => a - b));
    const customerStory = ((await customerView(alice, oid)).story as { text: string }[]).map((e) => e.text);
    expect(customerStory).toContain('Đang tìm shipper');
    const shown = JSON.stringify([view.story, (await customerView(alice, oid)).story]);
    expect(shown).not.toMatch(/delivery\.|order\.|_reminder|pickup_|search_|[0-9a-f]{8}-[0-9a-f]{4}-/u);
    // The full log is still there for the Admin tools: raw events, reminders included.
    expect(await countRows(app.pool, `SELECT 1 FROM app.delivery_events WHERE delivery_id = $1::uuid AND event_type = 'delivery.accepted'`, [firstDelivery.delivery_id])).toBe(1);
    expect((view.timeline as Json[]).some((e) => e.type === 'order.shipper_called_again')).toBe(true);
    // A late request is cancelled by the system: the call ends, and the story says so in words without calling the order cancelled by a person.
    const late = await confirmed(alice, [line(tea, 1)]);
    const lateCall = ok(await callShipper(late), 201);
    const lateId = String((lateCall.delivery as Json).delivery_id);
    ok(await asShipper(s, 'POST', `/driver/deliveries/${lateId}/accept`, {}));
    await timeoutAge('delivery_assignments', await activeAssignment(lateId), 60);
    await orderSweeper().sweep();
    const lateView = await shopView(String(late.order_id));
    const lateStory = (lateView.story as { text: string }[]).map((e) => e.text);
    expect(lateStory.slice(-1)).toEqual(['Đã hủy đơn — shipper chưa lấy hàng quá thời gian quy định']);
    expect(lateStory.filter((t) => t.startsWith('Đã hủy'))).toHaveLength(1);
    expect(lateView.end_reason).toBe('Shipper chưa lấy hàng quá thời gian quy định');
    expect(JSON.stringify(lateView.story)).not.toMatch(/QUÁ HẠN|cancelled_by|timeout/u);
  });

  it('customer cancellation after pickup reads once in the order story for both readers and opens the goods record', async () => {
    const s = await shipper();
    const order = await confirmed(alice, [line(bun, 1)]);
    const oid = String(order.order_id);
    const { did } = await toDelivering(s, order);
    const before = await customerView(alice, oid);
    ok(await asCustomer(alice, 'POST', `/customers/me/orders/${oid}/cancel-after-pickup`, { expected_version: before.version, reason: 'Tôi không nhận nữa' }));
    const seen = await shopView(oid);
    const texts = (seen.story as { text: string }[]).map((e) => e.text);
    expect(texts.slice(-1)).toEqual(['Khách đã hủy đơn — Tôi không nhận nữa']);
    expect(texts.filter((text) => text.includes('đã hủy'))).toHaveLength(1);
    const mine = seen.delivery as Json;
    const theirs = await customerView(alice, oid);
    expect(mine.delivery_id).toBe(did);
    expect(mine.incident).toMatchObject({ status: 'OPEN' });
    expect((theirs.story as { text: string }[]).map((entry) => entry.text).slice(-1)).toEqual(['Khách đã hủy đơn — Tôi không nhận nữa']);
    expect(seen.can).toMatchObject({ call_shipper: false });
  });

  // ---- 2026-10-24: the payer's own time to answer a fee proposal ---------------------------------------------------------------

  const eventsOfDelivery = (id: string, type: string): Promise<number> => countRows(app.pool, 'SELECT 1 FROM app.delivery_events WHERE delivery_id = $1::uuid AND event_type = $2', [id, type]);
  const agreementOf = async (did: string): Promise<Json> => (await app.pool.query('SELECT * FROM app.shipping_fee_agreements WHERE delivery_id = $1::uuid', [did])).rows[0] as Json;
  const agreementEvents = async (did: string, type?: string): Promise<Json[]> =>
    (await app.pool.query(`SELECT e.* FROM app.shipping_fee_agreement_events e JOIN app.shipping_fee_agreements a USING (agreement_id) WHERE a.delivery_id = $1::uuid ${type === undefined ? '' : 'AND e.event_type = $2'} ORDER BY e.seq`, type === undefined ? [did] : [did, type])).rows as Json[];
  const secondsUntil = async (column: 'answer_expires_at' | 'expires_at', did: string): Promise<number> =>
    Number((await app.pool.query(`SELECT extract(epoch FROM (${column} - clock_timestamp())) AS s FROM app.shipping_fee_agreements WHERE delivery_id = $1::uuid`, [did])).rows[0]?.s);
  /** Lets the answer time of the waiting offer run out (the clock cannot be moved, so the stored deadline is put in the past, as ageDelivery does for the search). */
  async function runOutAnswerTime(did: string): Promise<void> {
    await app.pool.query('ALTER TABLE app.shipping_fee_agreements DISABLE TRIGGER USER');
    try {
      await app.pool.query(`UPDATE app.shipping_fee_agreements SET answer_expires_at = created_at + interval '1 millisecond' WHERE delivery_id = $1::uuid AND answer_expires_at IS NOT NULL`, [did]);
    } finally {
      await app.pool.query('ALTER TABLE app.shipping_fee_agreements ENABLE TRIGGER USER');
    }
  }
  const setMinutes = (minutes: number): Promise<unknown> => app.pool.query(`UPDATE app.order_parameters SET int_value = $1::bigint, version = version + 1 WHERE param_key = 'fee_answer_minutes'`, [minutes]);
  const decide = (c: Customer, oid: string, decision: 'ACCEPT' | 'REJECT', version: unknown, key?: string): Promise<ApiResponse> => asCustomer(c, 'POST', `/customers/me/orders/${oid}/delivery/fee`, { decision, expected_version: version }, key);
  async function counteredOrder(minutes = 5, counterKey?: string): Promise<{ s: Shipper; oid: string; did: string }> {
    await setMinutes(minutes);
    const s = await shipper();
    const order = await confirmed(alice);
    const oid = String(order.order_id);
    const called = ok(await callShipper(order, { fee_payer: 'CUSTOMER', agreed_fee: { reason_code: 'URGENT', amount_vnd: 14_000 } }), 201);
    const did = String((called.delivery as Json).delivery_id);
    ok(await asShipper(s, 'POST', `/driver/deliveries/${did}/fee/counter`, { amount_vnd: 16_000 }, counterKey));
    return { s, oid, did };
  }

  it('a new counter-offer takes the configured minutes (5 by default) and stores its own deadline, never later than the search deadline; changing the setting moves only later offers', async () => {
    const first = await counteredOrder(5);
    const secondsFirst = await secondsUntil('answer_expires_at', first.did);
    expect(secondsFirst).toBeGreaterThan(280);
    expect(secondsFirst).toBeLessThanOrEqual(300);
    expect(secondsFirst).toBeLessThan(await secondsUntil('expires_at', first.did));
    const shown = await deliveryOfOrder(alice, first.oid);
    expect(shown.fee_decision).toMatchObject({ state: 'COUNTERED' });
    expect(new Date(String(shown.fee_decision.expires_at)).getTime()).toBeLessThan(new Date(String(shown.fee_decision.search_expires_at)).getTime());
    // The setting changes while the first offer waits: the first keeps its deadline, the next one takes the new duration.
    await setMinutes(12);
    expect(Math.abs((await secondsUntil('answer_expires_at', first.did)) - secondsFirst)).toBeLessThan(5);
    const second = await counteredOrder(12);
    const secondsSecond = await secondsUntil('answer_expires_at', second.did);
    expect(secondsSecond).toBeGreaterThan(700);
    expect(secondsSecond).toBeLessThanOrEqual(720);
    // The same Shipper's repeated request (same key) neither resets the clock nor makes a second offer.
    const key = randomUUID();
    const third = await counteredOrder(5, key);
    const before = await secondsUntil('answer_expires_at', third.did);
    await setMinutes(30);
    expect((await asShipper(third.s, 'POST', `/driver/deliveries/${third.did}/fee/counter`, { amount_vnd: 16_000 }, key)).status).toBe(200); // the retry of the same request
    expect((await asShipper(third.s, 'POST', `/driver/deliveries/${third.did}/fee/counter`, { amount_vnd: 16_000 }, randomUUID())).status).toBeGreaterThanOrEqual(400); // a new request while one is waiting
    expect(await agreementEvents(third.did, 'COUNTERED')).toHaveLength(1);
    expect(Math.abs((await secondsUntil('answer_expires_at', third.did)) - before)).toBeLessThan(5);
    await setMinutes(5);
  });

  it('the answer time never goes past the search deadline: with 2 minutes of search left a 5-minute setting gives 2', async () => {
    const { did } = await counteredOrderWithShortSearch();
    const answer = await secondsUntil('answer_expires_at', did);
    const search = await secondsUntil('expires_at', did);
    expect(answer).toBeLessThanOrEqual(search + 0.5);
    expect(search).toBeLessThan(130);
  });

  async function counteredOrderWithShortSearch(): Promise<{ did: string }> {
    await setMinutes(5);
    const s = await shipper();
    const order = await confirmed(alice);
    const called = ok(await callShipper(order, { fee_payer: 'CUSTOMER', agreed_fee: { reason_code: 'URGENT', amount_vnd: 14_000 } }), 201);
    const did = String((called.delivery as Json).delivery_id);
    await app.pool.query('ALTER TABLE app.shipping_fee_agreements DISABLE TRIGGER USER');
    try {
      await app.pool.query(`UPDATE app.shipping_fee_agreements SET expires_at = clock_timestamp() + interval '2 minutes' WHERE delivery_id = $1::uuid`, [did]);
    } finally {
      await app.pool.query('ALTER TABLE app.shipping_fee_agreements ENABLE TRIGGER USER');
    }
    ok(await counter(s, did, 16_000));
    return { did };
  }

  it('a late answer is refused with FEE_ANSWER_EXPIRED, yet the expiry is SAVED: the offer is dropped, the earlier fee and the search stay, and the Order is untouched', async () => {
    const { s, oid, did } = await counteredOrder(5);
    const asked = await deliveryOfOrder(alice, oid);
    const searchBefore = (await app.pool.query('SELECT search_expires_at FROM app.deliveries WHERE delivery_id = $1::uuid', [did])).rows[0]?.search_expires_at;
    await runOutAnswerTime(did);
    expect(refused(await decide(alice, oid, 'ACCEPT', asked.version))).toEqual({ status: 409, code: 'FEE_ANSWER_EXPIRED' });
    const agreement = await agreementOf(did);
    expect(agreement).toMatchObject({ status: 'PROPOSED', counter_fee_vnd: null, final_fee_vnd: null, answer_expires_at: null });
    expect(await agreementEvents(did, 'COUNTER_EXPIRED')).toHaveLength(1);
    expect(await agreementEvents(did, 'COUNTER_ACCEPTED')).toHaveLength(0);
    expect(await agreementEvents(did, 'CUSTOMER_CONFIRMED')).toHaveLength(0);
    expect(Number(agreement.proposed_fee_vnd)).toBe(14_000);
    expect(await eventsOfDelivery(did, 'delivery.fee_answer_expired')).toBe(1);
    expect((await deliveryOf(oid)).map((d) => d.state)).toEqual(['waiting_driver']);
    expect((await app.pool.query('SELECT search_expires_at FROM app.deliveries WHERE delivery_id = $1::uuid', [did])).rows[0]?.search_expires_at).toEqual(searchBefore);
    expect((await orderRow(oid)).status).toBe('PREPARING');
    // The same late answer again is refused again and does not write a second expiry; the question is gone from the customer's screen.
    expect(refused(await decide(alice, oid, 'REJECT', asked.version)).status).toBe(409);
    expect(await agreementEvents(did, 'COUNTER_EXPIRED')).toHaveLength(1);
    expect((await deliveryOfOrder(alice, oid)).fee_decision).toBeNull();
    // The search goes on: the Shipper whose offer expired can propose again, and the delivery is still takeable once the earlier fee is settled.
    ok(await counter(s, did, 17_000));
    expect(await agreementEvents(did, 'COUNTERED')).toHaveLength(2);
    expect(Number(await secondsUntil('answer_expires_at', did))).toBeGreaterThan(280);
  });

  it('an unanswered offer expires by itself (the sweeper), once; the Shipper and the shop are told; nothing is extended; an answer on time still works', async () => {
    const { oid, did } = await counteredOrder(5);
    await deliverySweeper().sweep();
    expect((await agreementOf(did)).status).toBe('COUNTERED'); // not due yet: untouched
    expect(await agreementEvents(did, 'COUNTER_EXPIRED')).toHaveLength(0);
    await runOutAnswerTime(did);
    const searchBefore = (await app.pool.query('SELECT search_expires_at FROM app.deliveries WHERE delivery_id = $1::uuid', [did])).rows[0]?.search_expires_at;
    await deliverySweeper().sweep();
    await deliverySweeper().sweep();
    expect(await agreementEvents(did, 'COUNTER_EXPIRED')).toHaveLength(1);
    expect(await eventsOfDelivery(did, 'delivery.fee_answer_expired')).toBe(1);
    expect(await agreementOf(did)).toMatchObject({ status: 'PROPOSED', answer_expires_at: null });
    expect((await app.pool.query('SELECT search_expires_at FROM app.deliveries WHERE delivery_id = $1::uuid', [did])).rows[0]?.search_expires_at).toEqual(searchBefore);
    expect((await deliveryOf(oid)).map((d) => d.state)).toEqual(['waiting_driver']);
    for (let pass = 0; pass < 200 && (await runtime().dispatcher.dispatchOnce()).claimed > 0; pass += 1) {
      // drained
    }
    const counterBy = String((await agreementEvents(did, 'COUNTERED'))[0]?.driver_id);
    const shipperUser = String((await app.pool.query('SELECT user_id FROM app.drivers WHERE driver_id = $1::uuid', [counterBy])).rows[0]?.user_id);
    const kinds = async (userId: string): Promise<string[]> => (await app.pool.query(`SELECT title FROM app.notifications WHERE recipient_user_id = $1::uuid AND target_id IN ($2::uuid, $3::uuid)`, [userId, did, oid])).rows.map((r) => String(r.title));
    expect(await kinds(shipperUser)).toContain('Đề xuất phí đã hết hạn');
    expect(await kinds(shop.userId)).toContain('Đề xuất phí đã hết hạn');
    // An offer answered ON TIME is not touched by the sweeper.
    const live = await counteredOrder(5);
    const asked = await deliveryOfOrder(alice, live.oid);
    ok(await decide(alice, live.oid, 'REJECT', asked.version));
    await deliverySweeper().sweep();
    expect(await agreementEvents(live.did, 'COUNTER_EXPIRED')).toHaveLength(0);
    expect(await agreementEvents(live.did, 'COUNTER_REJECTED')).toHaveLength(1);
  });

  it('the customer\'s answer and the sweeper at the same moment: one outcome only. Past the deadline the expiry wins once and the answer is refused; before it the answer wins and the sweeper does nothing', async () => {
    const late = await counteredOrder(5);
    const askedLate = await deliveryOfOrder(alice, late.oid);
    await runOutAnswerTime(late.did);
    const [answer] = await Promise.all([decide(alice, late.oid, 'ACCEPT', askedLate.version), deliverySweeper().sweep(), deliverySweeper().sweep()]);
    expect(refused(answer)).toEqual({ status: 409, code: 'FEE_ANSWER_EXPIRED' });
    expect(await agreementEvents(late.did, 'COUNTER_EXPIRED')).toHaveLength(1);
    expect(await agreementEvents(late.did, 'COUNTER_ACCEPTED')).toHaveLength(0);
    expect(await agreementEvents(late.did, 'CUSTOMER_CONFIRMED')).toHaveLength(0);
    expect(await agreementOf(late.did)).toMatchObject({ status: 'PROPOSED', final_fee_vnd: null });
    const early = await counteredOrder(5);
    const askedEarly = await deliveryOfOrder(alice, early.oid);
    const [accepted] = await Promise.all([decide(alice, early.oid, 'ACCEPT', askedEarly.version), deliverySweeper().sweep()]);
    expect(accepted.status).toBe(200);
    expect(await agreementEvents(early.did, 'COUNTER_EXPIRED')).toHaveLength(0);
    expect(await agreementOf(early.did)).toMatchObject({ status: 'ACCEPTED', final_fee_vnd: '16000' });
  });

  it('answering twice with the same key is answered, not applied twice; a late answer with a key is refused and a retry of it is refused again without a second expiry', async () => {
    const ontime = await counteredOrder(5);
    const asked = await deliveryOfOrder(alice, ontime.oid);
    const key = randomUUID();
    const first = await decide(alice, ontime.oid, 'ACCEPT', asked.version, key);
    const retry = await decide(alice, ontime.oid, 'ACCEPT', asked.version, key);
    expect([first.status, retry.status]).toEqual([200, 200]);
    expect(await agreementEvents(ontime.did, 'COUNTER_ACCEPTED')).toHaveLength(1);
    expect(await agreementEvents(ontime.did, 'CUSTOMER_CONFIRMED')).toHaveLength(1);
    const late = await counteredOrder(5);
    const askedLate = await deliveryOfOrder(alice, late.oid);
    await runOutAnswerTime(late.did);
    const lateKey = randomUUID();
    expect(refused(await decide(alice, late.oid, 'ACCEPT', askedLate.version, lateKey)).code).toBe('FEE_ANSWER_EXPIRED');
    expect(refused(await decide(alice, late.oid, 'ACCEPT', askedLate.version, lateKey)).code).toBe('FEE_ANSWER_EXPIRED');
    expect(await agreementEvents(late.did, 'COUNTER_EXPIRED')).toHaveLength(1);
  });

  it('the shop answering for a payer who has no app is recorded as the SHOP (actor), with the customer as who it stood in for and the payer apart, for a direct confirmation and for the confirmation after accepting the counter-offer; its late answer is refused too', async () => {
    await setMinutes(5);
    const s = await shipper();
    // A DIRECT call paid by the customer: the shop decides on the customer's behalf.
    const direct = async (): Promise<string> => {
      const created = ok(await asShop('POST', '/shop/me/deliveries', { recipient_name: 'Khách nhận', recipient_phone: '0912345678', dropoff_address_text: '12 Phố Huế, Hà Nội', dropoff_lat: 21.0, dropoff_lng: 105.82, goods_description: 'Hộp quà', goods_value_vnd: 200_000, paid_vnd: 0, fee_payer: 'CUSTOMER', agreed_fee: { reason_code: 'URGENT', amount_vnd: 14_000 } }), 201);
      return String(created.delivery_id);
    };
    const did = await direct();
    ok(await counter(s, did, 16_000));
    const view = (id: string): Promise<Json> => asShop('GET', `/shop/me/deliveries/${id}`).then((r) => ok(r));
    const accepted = ok(await asShop('POST', `/shop/me/deliveries/${did}/fee/counter-accept`, { expected_version: (await view(did)).version }));
    expect(accepted.fee).toMatchObject({ amount_vnd: 16_000, status: 'FINAL' });
    const confirmedEvent = (await agreementEvents(did, 'CUSTOMER_CONFIRMED'))[0] as Json;
    expect(confirmedEvent).toMatchObject({ actor_type: 'SHOP', actor_id: shop.userId, on_behalf_of: 'CUSTOMER', fee_payer: 'CUSTOMER' });
    expect((await agreementEvents(did, 'COUNTER_ACCEPTED'))[0]).toMatchObject({ actor_type: 'SHOP', actor_id: shop.userId, fee_payer: 'CUSTOMER' });
    expect((await agreementEvents(did)).filter((e) => e.actor_type === 'CUSTOMER')).toHaveLength(0);
    // The direct confirmation of an offer waiting for the customer (the shop's own proposal accepted by a Shipper).
    const did2 = await direct();
    ok(await asShipper(s, 'POST', `/driver/deliveries/${did2}/fee/agree`, {}));
    ok(await asShop('POST', `/shop/me/deliveries/${did2}/fee/customer-confirm`, { expected_version: (await view(did2)).version }));
    expect((await agreementEvents(did2, 'CUSTOMER_CONFIRMED'))[0]).toMatchObject({ actor_type: 'SHOP', actor_id: shop.userId, on_behalf_of: 'CUSTOMER', fee_payer: 'CUSTOMER' });
    // When the shop itself pays, its own acceptance is not "on behalf of" anybody.
    const own = ok(await asShop('POST', '/shop/me/deliveries', { recipient_name: 'Khách nhận', recipient_phone: '0912345678', dropoff_address_text: '12 Phố Huế, Hà Nội', dropoff_lat: 21.0, dropoff_lng: 105.82, goods_description: 'Hộp quà', goods_value_vnd: 200_000, paid_vnd: 0, fee_payer: 'SHOP', agreed_fee: { reason_code: 'URGENT', amount_vnd: 14_000 } }), 201);
    const did3 = String(own.delivery_id);
    const s3 = await shipper();
    ok(await counter(s3, did3, 15_000));
    ok(await asShop('POST', `/shop/me/deliveries/${did3}/fee/counter-accept`, { expected_version: (await view(did3)).version }));
    expect((await agreementEvents(did3, 'COUNTER_ACCEPTED'))[0]).toMatchObject({ actor_type: 'SHOP', on_behalf_of: null, fee_payer: 'SHOP' });
    expect(await agreementEvents(did3, 'CUSTOMER_CONFIRMED')).toHaveLength(0);
    // A late answer from the shop is refused and the expiry is saved.
    const s4 = await shipper();
    const did4 = await direct();
    ok(await counter(s4, did4, 16_000));
    const v4 = (await view(did4)).version;
    await runOutAnswerTime(did4);
    expect(refused(await asShop('POST', `/shop/me/deliveries/${did4}/fee/counter-accept`, { expected_version: v4 }))).toEqual({ status: 409, code: 'FEE_ANSWER_EXPIRED' });
    expect(await agreementEvents(did4, 'COUNTER_EXPIRED')).toHaveLength(1);
    expect(await agreementEvents(did4, 'COUNTER_ACCEPTED')).toHaveLength(0);
  });

  it('an ORDER the customer pays that was never priced (legacy STANDARD, no fee): the Shipper cannot fix the fee himself, whatever he types; the fee stays empty and pickup stays closed', async () => {
    const s = await shipper();
    const order = await confirmed(alice);
    const oid = String(order.order_id);
    const called = ok(await callShipper(order, { fee_payer: 'CUSTOMER' }), 201);
    const did = String((called.delivery as Json).delivery_id);
    // Reproduces the old data: a STANDARD fee that was never stored.
    for (const table of ['deliveries', 'shipping_fee_agreement_events', 'shipping_fee_agreements']) {
      await app.pool.query(`ALTER TABLE app.${table} DISABLE TRIGGER USER`);
    }
    await app.pool.query('UPDATE app.deliveries SET fee_vnd = NULL WHERE delivery_id = $1::uuid', [did]);
    await app.pool.query('DELETE FROM app.shipping_fee_agreement_events WHERE agreement_id IN (SELECT agreement_id FROM app.shipping_fee_agreements WHERE delivery_id = $1::uuid)', [did]);
    await app.pool.query('DELETE FROM app.shipping_fee_agreements WHERE delivery_id = $1::uuid', [did]);
    for (const table of ['deliveries', 'shipping_fee_agreement_events', 'shipping_fee_agreements']) {
      await app.pool.query(`ALTER TABLE app.${table} ENABLE TRIGGER USER`);
    }
    const accepted = await asShipper(s, 'POST', `/driver/deliveries/${did}/accept`, {});
    if (accepted.status === 200) {
      const view = dataOf(accepted) as Json;
      for (const typed of [18_000, 1, 0]) {
        expect(refused(await asShipper(s, 'POST', `/driver/deliveries/${did}/destination`, { expected_version: view.version, fee_vnd: typed }))).toEqual({ status: 409, code: 'FEE_NOT_CONFIRMED' });
      }
      expect((await asShipper(s, 'POST', `/driver/deliveries/${did}/pickup`, { expected_version: view.version })).status).toBe(409);
    } else {
      expect(accepted.status).toBe(409); // an unpriced delivery may not even be takeable; either way no fee was ever set by the Shipper
    }
    expect((await app.pool.query('SELECT fee_vnd, fee_confirmed_by FROM app.deliveries WHERE delivery_id = $1::uuid', [did])).rows[0]).toMatchObject({ fee_vnd: null, fee_confirmed_by: null });
    expect((await orderRow(oid)).status).toBe('PREPARING');
  });

});
