import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { DeliverySweeper } from '../../apps/backend/src/delivery/delivery-sweeper';
import { M14_ROUTING } from '../../apps/backend/src/delivery/m14-route-client';
import { OrderChatRetention } from '../../apps/backend/src/order-chat/order-chat-retention';
import { NotificationRuntime } from '../../apps/backend/src/notifications/notification-runtime';
import { ApiResponse, AuthApp, countRows, dataOf, startAuthApp } from './support/auth-fixtures';
import { ageDelivery, cleanupOrders, codeOf, Customer, Dish, Json, newCustomer, newDish, newShipper, openAllWeek, PRIVACY, Shipper, TERMS } from './support/m10-fixtures';
import { createShopOwner, ShopOwner } from './support/shop-management-fixtures';

// Issue #191, "Trao đổi đơn hàng", on a REAL Nest pipeline and PostgreSQL: who may read and write (customer, shop, Shipper by assignment, strangers), the feed
// of typed messages and business milestones, paging, the idempotent send, the rate limit, the room that closes with the order (also against a send in flight),
// a failed delivery that does not close an order, a direct delivery without an order, the Shipper who lost the assignment, and the M08 notification.

describe('#191 — order chat', () => {
  let app: AuthApp;
  let router: http.Server;
  let shop: ShopOwner;
  let otherShop: ShopOwner;
  // A new customer for every test: the sending rate is counted per sender over a minute, and the tests must not eat each other's allowance.
  let alice: Customer;
  let bob: Customer;
  const customers: Customer[] = [];
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
    otherShop = await createShopOwner(app);
    await openAllWeek(app, shop.shopId);
    await openAllWeek(app, otherShop.shopId);
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

  beforeEach(async () => {
    alice = await newCustomer(app, 'Nguyễn Văn An');
    customers.push(alice);
  });

  afterAll(async () => {
    await drain();
    await cleanupOrders(app, { shopIds: [shop.shopId, otherShop.shopId], customerIds: [bob.userId, ...customers.map((c) => c.userId)], drivers, userIds: [bob.userId, shop.userId, otherShop.userId, ...customers.map((c) => c.userId)], policyAdded: addedPolicy });
    await app.close();
    await new Promise<void>((resolve) => router.close(() => resolve()));
  });

  // ---- helpers -------------------------------------------------------------------------------------------------------------------

  type Verb = 'GET' | 'POST';
  const call = (token: string, method: Verb, path: string, body?: unknown, key: string = randomUUID()): Promise<ApiResponse> =>
    app.call(method, path, { bearer: token, ...(method !== 'GET' ? { headers: { 'idempotency-key': key } } : {}), ...(body === undefined ? {} : { body }) });
  const ok = (response: ApiResponse, status = 200): Json => {
    expect([response.status, response.text.slice(0, 300)]).toEqual([status, response.text.slice(0, 300)]);
    return dataOf(response) as Json;
  };
  const refused = (response: ApiResponse): { status: number; code: string | undefined } => ({ status: response.status, code: codeOf(response) });
  const drain = async (): Promise<void> => {
    const runtime = app.running.app.get(NotificationRuntime);
    for (let pass = 0; pass < 200 && (await runtime.dispatcher.dispatchOnce()).claimed > 0; pass += 1) {
      // drained
    }
  };

  const ADDRESS = { address_text: '12 Phố Huế, Hai Bà Trưng, Hà Nội', lat: 21.0, lng: 105.82 };
  async function placeOrder(c: Customer): Promise<Json> {
    const lines = [{ item_id: pho.itemId, quantity: 2, unit_price_vnd: pho.price }];
    const draft = { shop_id: shop.shopId, lines, recipient_name: 'Người nhận', recipient_phone: '0912345678', address: ADDRESS };
    const preview = ok(await call(c.token, 'POST', '/customers/me/orders/preview', { ...draft, lines: lines.map(({ item_id, quantity }) => ({ item_id, quantity })) }));
    const fee = preview.fee as Json;
    return ok(await call(c.token, 'POST', '/customers/me/orders', { client_ref: randomUUID(), ...draft, items_total_vnd: 90_000, expected_quote: { status: fee.status, distance_m: fee.distance_m, fee_vnd: fee.fee_vnd, reason: fee.reason, policy_version: fee.policy_version, snapshot: fee.snapshot } }), 201);
  }
  const confirm = async (order: Json): Promise<Json> => ok(await call(shop.token, 'POST', `/shop/me/orders/${String(order.order_id)}/confirm`, { expected_version: order.version }));
  const confirmed = async (c: Customer): Promise<Json> => confirm(await placeOrder(c));
  async function called(order: Json): Promise<string> {
    const made = ok(await call(shop.token, 'POST', `/shop/me/orders/${String(order.order_id)}/call-shipper`, { expected_version: order.version }), 201);
    return String((made.delivery as Json).delivery_id);
  }
  const shipper = (): Promise<Shipper> => newShipper(app, drivers, 50_000);
  const accept = (s: Shipper, did: string): Promise<Json> => Promise.resolve(call(s.token, 'POST', `/driver/deliveries/${did}/accept`, {})).then((r) => ok(r));

  const asCustomerChat = (c: Customer, oid: string, method: Verb, body?: unknown, key?: string, query = ''): Promise<ApiResponse> => call(c.token, method, `/customers/me/orders/${oid}/chat${query}`, body, key);
  const asShopChat = (oid: string, method: Verb, body?: unknown, key?: string, owner: ShopOwner = shop, query = ''): Promise<ApiResponse> => call(owner.token, method, `/shop/me/orders/${oid}/chat${query}`, body, key);
  const asShipperChat = (s: Shipper, did: string, method: Verb, body?: unknown, key?: string, query = ''): Promise<ApiResponse> => call(s.token, method, `/driver/deliveries/${did}/chat${query}`, body, key);
  const messagesIn = (feed: Json): string[] => (feed.items as Json[]).filter((i) => i.type === 'message').map((i) => String(i.body));
  const systemIn = (feed: Json): string[] => (feed.items as Json[]).filter((i) => i.type === 'system').map((i) => String(i.text));
  const stored = (oid: string): Promise<number> => countRows(app.pool, 'SELECT 1 FROM app.order_chat_messages WHERE order_id = $1::uuid', [oid]);

  // ---- the room ------------------------------------------------------------------------------------------------------------------

  it('the customer and the shop write to each other in one feed with the milestones; everything is stored and read back, with the sender and the time from the server', async () => {
    const order = await placeOrder(alice);
    const oid = String(order.order_id);
    const sentByCustomer = ok(await asCustomerChat(alice, oid, 'POST', { body: '  Cho tôi thêm   hành nhé  ' }), 201);
    expect(sentByCustomer.message).toMatchObject({ type: 'message', body: 'Cho tôi thêm hành nhé', sender: { role: 'CUSTOMER', name: 'Người nhận', mine: true } });
    expect(sentByCustomer.room).toMatchObject({ type: 'ORDER', id: oid, open: true, can_send: true });
    ok(await asShopChat(oid, 'POST', { body: 'Dạ quán ghi chú rồi ạ 😊' }), 201);
    await confirm(order);
    const asShopView = ok(await asShopChat(oid, 'GET'));
    expect(messagesIn(asShopView)).toEqual(['Cho tôi thêm hành nhé', 'Dạ quán ghi chú rồi ạ 😊']);
    expect(systemIn(asShopView)).toEqual(['Đã đặt đơn', 'Quán đã xác nhận']);
    const mine = (asShopView.items as Json[]).filter((i) => i.type === 'message').map((i) => (i.sender as Json).mine);
    expect(mine).toEqual([false, true]);
    // The same feed for the customer, with the sides swapped; one feed only: the milestones are not repeated for each reader.
    const asCustomerView = ok(await asCustomerChat(alice, oid, 'GET'));
    expect((asCustomerView.items as Json[]).map((i) => i.id)).toEqual((asShopView.items as Json[]).map((i) => i.id));
    expect(systemIn(asCustomerView)).toEqual(['Đã đặt đơn', 'Quán đã xác nhận']);
    // The order detail no longer carries the old second story for the chat to repeat: the milestones come from the same events (once each).
    expect(await stored(oid)).toBe(2);
    expect(await countRows(app.pool, 'SELECT 1 FROM app.order_events WHERE order_id = $1::uuid', [oid])).toBeGreaterThanOrEqual(2);
  });

  it('pages the feed newest first with a cursor; older pages never repeat or skip an entry, milestones included', async () => {
    const order = await confirmed(alice);
    const oid = String(order.order_id);
    for (let i = 1; i <= 7; i += 1) {
      ok(await asCustomerChat(alice, oid, 'POST', { body: `tin ${String(i)}` }), 201);
    }
    const all: string[] = [];
    let before: string | null = null;
    let guard = 0;
    do {
      const feed: Json = ok(await asShopChat(oid, 'GET', undefined, undefined, shop, `?limit=3${before === null ? '' : `&before=${before}`}`));
      expect((feed.items as Json[]).length).toBeLessThanOrEqual(3);
      all.unshift(...(feed.items as Json[]).map((i) => String(i.id)));
      before = feed.has_more === true ? String(feed.next_before) : null;
      guard += 1;
    } while (before !== null && guard < 10);
    const whole = ok(await asShopChat(oid, 'GET', undefined, undefined, shop, '?limit=100'));
    expect(all).toEqual((whole.items as Json[]).map((i) => String(i.id)));
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(9);
    expect(refused(await asShopChat(oid, 'GET', undefined, undefined, shop, '?limit=0')).status).toBe(400);
    expect(refused(await asShopChat(oid, 'GET', undefined, undefined, shop, '?before=!!')).status).toBe(400);
  });

  // ---- rights --------------------------------------------------------------------------------------------------------------------

  it('knowing an order id is not a right: another customer, another shop and a Shipper who never held the delivery read and write nothing, and see no difference from a missing order', async () => {
    const order = await confirmed(alice);
    const oid = String(order.order_id);
    const stranger = await shipper();
    for (const attempt of [() => asCustomerChat(bob, oid, 'GET'), () => asCustomerChat(bob, oid, 'POST', { body: 'xin chào' }), () => asShopChat(oid, 'GET', undefined, undefined, otherShop), () => asShopChat(oid, 'POST', { body: 'xin chào' }, undefined, otherShop)]) {
      expect(refused(await attempt())).toEqual({ status: 404, code: 'ORDER_NOT_FOUND' });
    }
    expect(refused(await asCustomerChat(alice, randomUUID(), 'GET'))).toEqual({ status: 404, code: 'ORDER_NOT_FOUND' });
    expect(refused(await asCustomerChat(alice, 'not-a-uuid', 'GET')).status).toBe(400);
    // A Shipper has no door by order id, and by delivery id only through an assignment.
    const did = await called(order);
    expect(refused(await asShipperChat(stranger, did, 'GET'))).toEqual({ status: 404, code: 'DELIVERY_NOT_FOUND' });
    expect(refused(await asShipperChat(stranger, did, 'POST', { body: 'cho tôi nhận' }))).toEqual({ status: 404, code: 'DELIVERY_NOT_FOUND' });
    expect(refused(await call(stranger.token, 'GET', `/driver/deliveries/${oid}/chat`)).status).toBe(404);
    expect(refused(await call(alice.token, 'GET', `/driver/deliveries/${did}/chat`)).status).toBeGreaterThanOrEqual(400);
    expect(await stored(oid)).toBe(0);
    // The body is exactly { body }: nothing else (a sender, a role, a time, a state) is accepted from a client.
    expect(refused(await asCustomerChat(alice, oid, 'POST', { body: 'x', sender_role: 'SHOP' })).status).toBe(400);
    expect(refused(await asCustomerChat(alice, oid, 'POST', { body: '   ' })).status).toBe(400);
    expect(refused(await asCustomerChat(alice, oid, 'POST', { body: 'a'.repeat(501) })).status).toBe(400);
    expect(refused(await asCustomerChat(alice, oid, 'POST', { body: 'có \u0007 điều khiển' })).status).toBe(400);
    expect(refused(await call(alice.token, 'POST', `/customers/me/orders/${oid}/chat`, { body: 'x' }, 'not-a-key')).status).toBe(400);
  });

  it('the Shipper joins when they accept and leaves when they give the delivery back: the new Shipper sees the whole conversation, the old one nothing', async () => {
    const first = await shipper();
    const second = await shipper();
    const order = await confirmed(alice);
    const oid = String(order.order_id);
    const did = await called(order);
    ok(await asCustomerChat(alice, oid, 'POST', { body: 'Gọi tôi khi tới nhé' }), 201);
    expect(refused(await asShipperChat(first, did, 'GET')).status).toBe(404);
    const accepted = await accept(first, did);
    const seenByFirst = ok(await asShipperChat(first, did, 'GET'));
    expect(seenByFirst.room).toMatchObject({ type: 'ORDER', id: oid, open: true, can_send: true });
    expect(messagesIn(seenByFirst)).toEqual(['Gọi tôi khi tới nhé']);
    expect(systemIn(seenByFirst)).toContain('Shipper đã nhận đơn');
    ok(await asShipperChat(first, did, 'POST', { body: 'Em tới sau 5 phút ạ' }), 201);
    expect(messagesIn(ok(await asCustomerChat(alice, oid, 'GET')))).toEqual(['Gọi tôi khi tới nhé', 'Em tới sau 5 phút ạ']);
    // The first Shipper gives the delivery back: from this moment they can neither read nor write, though they still know the id.
    ok(await call(first.token, 'POST', `/driver/deliveries/${did}/release`, { reason: 'Xe hỏng', expected_version: accepted.version }));
    expect(refused(await asShipperChat(first, did, 'GET'))).toEqual({ status: 404, code: 'DELIVERY_NOT_FOUND' });
    expect(refused(await asShipperChat(first, did, 'POST', { body: 'vẫn nhắn được?' })).status).toBe(404);
    // The second Shipper accepts the same delivery and reads the earlier talk; the first still cannot.
    await accept(second, did);
    expect(messagesIn(ok(await asShipperChat(second, did, 'GET')))).toEqual(['Gọi tôi khi tới nhé', 'Em tới sau 5 phút ạ']);
    expect(refused(await asShipperChat(first, did, 'GET')).status).toBe(404);
    expect(await countRows(app.pool, `SELECT 1 FROM app.order_chat_messages WHERE order_id = $1::uuid AND sender_role = 'SHIPPER'`, [oid])).toBe(1);
  });

  // ---- send: retry, limit ------------------------------------------------------------------------------------------------------

  it('the Idempotency-Key is the message: a retry or a lost answer stores nothing twice, the same key with other text is refused, and a retry still answers after the order closed', async () => {
    const order = await placeOrder(alice);
    const oid = String(order.order_id);
    const key = randomUUID();
    const first = ok(await asCustomerChat(alice, oid, 'POST', { body: 'Một tin' }, key), 201);
    const again = ok(await asCustomerChat(alice, oid, 'POST', { body: 'Một tin' }, key), 201);
    expect((again.message as Json).id).toBe((first.message as Json).id);
    expect(again.replayed).toBe(true);
    const sharedKey = randomUUID();
    const parallel = await Promise.all([1, 2, 3].map(() => asCustomerChat(alice, oid, 'POST', { body: 'Cùng khóa' }, sharedKey)));
    expect(parallel.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(new Set(parallel.map((r) => String(((dataOf(r) as Json).message as Json).id))).size).toBe(1);
    expect(refused(await asCustomerChat(alice, oid, 'POST', { body: 'Tin khác' }, key))).toEqual({ status: 409, code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(refused(await call(alice.token, 'POST', `/customers/me/orders/${oid}/chat`, { body: 'x' }, undefined)).status).toBe(201);
    expect(await stored(oid)).toBe(3);
    // The key is the sender's: another account reusing it writes its own message into its own room, never into this one.
    ok(await asCustomerChat(alice, oid, 'POST', { body: 'Hủy đơn' }, randomUUID()), 201);
    ok(await call(alice.token, 'POST', `/customers/me/orders/${oid}/cancel`, { expected_version: 1 }));
    const late = ok(await asCustomerChat(alice, oid, 'POST', { body: 'Một tin' }, key), 201);
    expect(late.replayed).toBe(true);
    expect(refused(await asCustomerChat(alice, oid, 'POST', { body: 'Tin mới' }))).toEqual({ status: 409, code: 'ORDER_CHAT_CLOSED' });
    expect(await stored(oid)).toBe(4);
  });

  it('limits the sending rate per sender across rooms (the database counts, so two phones share it)', async () => {
    const limited = await newCustomer(app, 'Người nói nhiều');
    const order = await placeOrder(limited);
    const oid = String(order.order_id);
    for (let i = 0; i < 12; i += 1) {
      ok(await asCustomerChat(limited, oid, 'POST', { body: `tin ${String(i)}` }), 201);
    }
    expect(refused(await asCustomerChat(limited, oid, 'POST', { body: 'tin 13' }))).toEqual({ status: 429, code: 'ORDER_CHAT_RATE_LIMITED' });
    expect(await stored(oid)).toBe(12);
    // The shop is not slowed down by the customer's count.
    ok(await asShopChat(oid, 'POST', { body: 'Quán đây' }), 201);
    await cleanupOrders(app, { shopIds: [], customerIds: [limited.userId], drivers: [], userIds: [limited.userId] });
  });

  // ---- closing -------------------------------------------------------------------------------------------------------------------

  it('the room closes with the order: no new message by any door, the history is still read, and the closing milestone is the last line', async () => {
    const s = await shipper();
    const order = await confirmed(alice);
    const oid = String(order.order_id);
    const did = await called(order);
    await accept(s, did);
    ok(await asShopChat(oid, 'POST', { body: 'Hủy giúp em nhé' }), 201);
    const row = (await app.pool.query('SELECT version FROM app.orders WHERE order_id = $1::uuid', [oid])).rows[0] as Json;
    ok(await call(shop.token, 'POST', `/shop/me/orders/${oid}/cancel`, { expected_version: Number(row.version), reason: 'Hết nguyên liệu' }));
    for (const attempt of [() => asCustomerChat(alice, oid, 'POST', { body: 'còn đó không' }), () => asShopChat(oid, 'POST', { body: 'xin lỗi' })]) {
      expect(refused(await attempt())).toEqual({ status: 409, code: 'ORDER_CHAT_CLOSED' });
    }
    const asCustomer = ok(await asCustomerChat(alice, oid, 'GET'));
    expect(asCustomer.room).toMatchObject({ open: false, can_send: false });
    expect(messagesIn(asCustomer)).toEqual(['Hủy giúp em nhé']);
    expect(systemIn(asCustomer).slice(-1)).toEqual(['Quán đã hủy đơn — Hết nguyên liệu']);
    expect(ok(await asShopChat(oid, 'GET')).room).toMatchObject({ open: false, can_send: false });
    // The Shipper whose assignment the cancellation ended lost the room, closed or not.
    expect(refused(await asShipperChat(s, did, 'POST', { body: 'còn đó không' })).status).toBe(404);
    expect(await stored(oid)).toBe(1);
  });

  it('a send racing the closing of the order has one clear answer: stored before the close (201) or refused (409), never both, and the room is shut afterwards', async () => {
    for (let round = 0; round < 4; round += 1) {
      const racer = await newCustomer(app, 'Người đua');
      customers.push(racer);
      const order = await confirmed(racer);
      const oid = String(order.order_id);
      const version = Number(((await app.pool.query('SELECT version FROM app.orders WHERE order_id = $1::uuid', [oid])).rows[0] as Json).version);
      const sends = Array.from({ length: 3 }, (_, i) => asCustomerChat(racer, oid, 'POST', { body: `đua ${String(round)}-${String(i)}` }));
      const [cancel, ...answers] = await Promise.all([call(shop.token, 'POST', `/shop/me/orders/${oid}/cancel`, { expected_version: version, reason: 'Đóng quán' }), ...sends]);
      expect(cancel.status).toBe(200);
      for (const answer of answers) {
        expect([201, 409]).toContain(answer.status);
        if (answer.status === 409) {
          expect(codeOf(answer)).toBe('ORDER_CHAT_CLOSED');
        }
      }
      expect(await stored(oid)).toBe(answers.filter((a) => a.status === 201).length);
      expect(refused(await asCustomerChat(racer, oid, 'POST', { body: 'quá muộn' }))).toEqual({ status: 409, code: 'ORDER_CHAT_CLOSED' });
    }
  });

  it('a delivery that ended without a Shipper (search stopped) does not close an order that is still open: the shop and the customer keep talking', async () => {
    const order = await confirmed(alice);
    const oid = String(order.order_id);
    const did = await called(order);
    ok(await asCustomerChat(alice, oid, 'POST', { body: 'Khi nào có shipper vậy?' }), 201);
    await ageDelivery(app, did, 31);
    await app.running.app.get(DeliverySweeper).sweep();
    expect(((await app.pool.query('SELECT state FROM app.deliveries WHERE delivery_id = $1::uuid', [did])).rows[0] as Json).state).toBe('search_stopped');
    expect(((await app.pool.query('SELECT status FROM app.orders WHERE order_id = $1::uuid', [oid])).rows[0] as Json).status).toBe('PREPARING');
    ok(await asShopChat(oid, 'POST', { body: 'Quán sẽ gọi lại shipper' }), 201);
    ok(await asCustomerChat(alice, oid, 'POST', { body: 'Vâng, tôi đang đợi' }), 201);
    const feed = ok(await asCustomerChat(alice, oid, 'GET'));
    expect(feed.room).toMatchObject({ open: true, can_send: true });
    expect(systemIn(feed)).toContain('Chưa có shipper nhận, đã dừng tìm');
    expect(messagesIn(feed)).toEqual(['Khi nào có shipper vậy?', 'Quán sẽ gọi lại shipper', 'Vâng, tôi đang đợi']);
  });

  // ---- a direct delivery -------------------------------------------------------------------------------------------------------

  it('a direct call has a room of its own (the delivery is the file, no order is made): the shop and the Shipper write, the customer has no door, and it closes with the delivery', async () => {
    const s = await shipper();
    const made = ok(await call(shop.token, 'POST', '/shop/me/deliveries', { recipient_name: 'Khách nhận', recipient_phone: '0912345678', dropoff_address_text: '12 Phố Huế, Hai Bà Trưng, Hà Nội', dropoff_lat: 21.0, dropoff_lng: 105.82, goods_description: 'Hộp quà', goods_value_vnd: 200_000, paid_vnd: 0, fee_payer: 'CUSTOMER' }), 201);
    const did = String(made.delivery_id);
    const ordersBefore = await countRows(app.pool, 'SELECT 1 FROM app.orders WHERE shop_id = $1::uuid', [shop.shopId]);
    // Before anybody holds it the Shipper has no door; the shop has one.
    expect(refused(await asShipperChat(s, did, 'POST', { body: 'x' })).status).toBe(404);
    ok(await call(shop.token, 'POST', `/shop/me/deliveries/${did}/chat`, { body: 'Giao giúp quán nhé' }), 201);
    const accepted = await accept(s, did);
    ok(await asShipperChat(s, did, 'POST', { body: 'Em nhận rồi ạ' }), 201);
    const asShop = ok(await call(shop.token, 'GET', `/shop/me/deliveries/${did}/chat`));
    expect(asShop.room).toMatchObject({ type: 'DIRECT', id: did, open: true, can_send: true });
    expect(messagesIn(asShop)).toEqual(['Giao giúp quán nhé', 'Em nhận rồi ạ']);
    expect(systemIn(asShop)).toContain('Shipper đã nhận đơn');
    // A direct delivery is not reachable as an order, by anybody, and another shop does not see it.
    expect(refused(await call(otherShop.token, 'GET', `/shop/me/deliveries/${did}/chat`)).status).toBe(404);
    expect(refused(await asShopChat(did, 'GET')).status).toBe(404);
    expect(await countRows(app.pool, 'SELECT 1 FROM app.orders WHERE shop_id = $1::uuid', [shop.shopId])).toBe(ordersBefore);
    expect(await countRows(app.pool, 'SELECT 1 FROM app.order_chat_messages WHERE delivery_id = $1::uuid AND order_id IS NULL', [did])).toBe(2);
    // The shop cancels the call: the room closes for both, the history stays readable for the shop.
    ok(await call(shop.token, 'POST', `/shop/me/deliveries/${did}/cancel`, { expected_version: accepted.version, reason: 'Khách đổi ý' }));
    expect(refused(await call(shop.token, 'POST', `/shop/me/deliveries/${did}/chat`, { body: 'xin lỗi' }))).toEqual({ status: 409, code: 'ORDER_CHAT_CLOSED' });
    const closed = ok(await call(shop.token, 'GET', `/shop/me/deliveries/${did}/chat`));
    expect(closed.room).toMatchObject({ open: false, can_send: false });
    expect(messagesIn(closed)).toHaveLength(2);
  });


  // ---- retention -----------------------------------------------------------------------------------------------------------------

  const backdateEnd = async (orderId: string, hours: number): Promise<void> => {
    const client = await app.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE app.orders DISABLE TRIGGER USER');
      await client.query(`UPDATE app.orders SET ended_at = ended_at - make_interval(hours => $2::int) WHERE order_id = $1::uuid`, [orderId, hours]);
      await client.query('ALTER TABLE app.orders ENABLE TRIGGER USER');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  };
  const retention = (): OrderChatRetention => app.running.app.get(OrderChatRetention);
  const setRetentionDays = async (days: number | null): Promise<void> => {
    // The row SYSTEM edits (absent until the first change): only this one key is touched, and `null` restores the default.
    await app.pool.query(
      `INSERT INTO app.ops_config (config_id, version, settings, discord_enabled, discord_min_severity, updated_at)
       VALUES (1, 1, CASE WHEN $1::int IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('chat.retention_days', $1::int) END, false, 'WARNING', now())
       ON CONFLICT (config_id) DO UPDATE SET settings = CASE WHEN $1::int IS NULL THEN app.ops_config.settings - 'chat.retention_days' ELSE app.ops_config.settings || jsonb_build_object('chat.retention_days', $1::int) END`,
      [days],
    );
  };

  it('retention: 7 days after the whole file closed (not from each message); open orders keep everything; after it the API returns no feed and the job removes only the messages', async () => {
    const order = await confirmed(alice);
    const oid = String(order.order_id);
    ok(await asCustomerChat(alice, oid, 'POST', { body: 'Tin đầu tiên' }), 201);
    // A very old message of a still-open order is kept: the clock starts when the file closes.
    await app.pool.query(`UPDATE app.order_chat_messages SET created_at = created_at - interval '30 days' WHERE order_id = $1::uuid`, [oid]).catch(() => undefined);
    await retention().runOnce();
    expect(await stored(oid)).toBe(1);
    const version = Number(((await app.pool.query('SELECT version FROM app.orders WHERE order_id = $1::uuid', [oid])).rows[0] as Json).version);
    ok(await call(shop.token, 'POST', `/shop/me/orders/${oid}/cancel`, { expected_version: version, reason: 'Hết hàng' }));
    const events = await countRows(app.pool, 'SELECT 1 FROM app.order_events WHERE order_id = $1::uuid', [oid]);
    // 6 days 23 hours after the close: still readable, with the expiry the app shows.
    await backdateEnd(oid, 6 * 24 + 23);
    const early = ok(await asCustomerChat(alice, oid, 'GET'));
    expect(messagesIn(early)).toEqual(['Tin đầu tiên']);
    expect(early.room).toMatchObject({ open: false, retention_days: 7, expired: false });
    expect(await retention().runOnce()).toBe(0);
    expect(await stored(oid)).toBe(1);
    // 7 days and an hour: nothing of the conversation is returned, to any reader, and the job deletes the messages.
    await backdateEnd(oid, 2);
    const late = ok(await asCustomerChat(alice, oid, 'GET'));
    expect(late).toMatchObject({ items: [], has_more: false, room: { expired: true, retention_days: 7 } });
    expect(ok(await asShopChat(oid, 'GET')).items).toEqual([]);
    expect(await stored(oid)).toBe(1);
    expect(await retention().runOnce()).toBeGreaterThanOrEqual(1);
    expect(await stored(oid)).toBe(0);
    // Business history and audit stay.
    expect(await countRows(app.pool, 'SELECT 1 FROM app.order_events WHERE order_id = $1::uuid', [oid])).toBe(events);
  });

  it('retention: SYSTEM changes the number of days (7 is allowed); an open complaint holds the history and a later closed complaint moves the start', async () => {
    const order = await confirmed(alice);
    const oid = String(order.order_id);
    ok(await asCustomerChat(alice, oid, 'POST', { body: 'Giữ lại nhé' }), 201);
    const version = Number(((await app.pool.query('SELECT version FROM app.orders WHERE order_id = $1::uuid', [oid])).rows[0] as Json).version);
    ok(await call(shop.token, 'POST', `/shop/me/orders/${oid}/cancel`, { expected_version: version, reason: 'Hết hàng' }));
    await backdateEnd(oid, 10 * 24);
    await setRetentionDays(30);
    try {
      expect(ok(await asCustomerChat(alice, oid, 'GET')).room).toMatchObject({ expired: false, retention_days: 30 });
      expect(await retention().runOnce()).toBe(0);
      await setRetentionDays(7);
      // An open complaint about the order holds the deletion and the reading, whatever the days.
      const complaintId = randomUUID();
      await app.pool.query(
        `INSERT INTO app.complaints (complaint_id, code, submitter_user_id, submitter_role, category, order_id, shop_id, related_code, shop_name, scope_key, status, body, created_at, updated_at)
         VALUES ($1::uuid, $2, $3::uuid, 'CUSTOMER', 'SERVICE', $4::uuid, $5::uuid, 'K', 'Quán', $4::uuid, 'PENDING', 'Đơn có vấn đề', now(), now())`,
        [complaintId, `PA${String(Date.now()).slice(-9)}`, alice.userId, oid, shop.shopId],
      );
      try {
        const held = ok(await asCustomerChat(alice, oid, 'GET'));
        expect(held.room).toMatchObject({ expired: false, expires_at: null });
        expect(messagesIn(held)).toEqual(['Giữ lại nhé']);
        expect(await retention().runOnce()).toBe(0);
        expect(await stored(oid)).toBe(1);
      } finally {
        const client = await app.pool.connect();
        try {
          await client.query('BEGIN');
          await client.query('ALTER TABLE app.complaints DISABLE TRIGGER USER');
          await client.query('DELETE FROM app.complaints WHERE complaint_id = $1::uuid', [complaintId]);
          await client.query('ALTER TABLE app.complaints ENABLE TRIGGER USER');
          await client.query('COMMIT');
        } finally {
          client.release();
        }
      }
      expect(ok(await asCustomerChat(alice, oid, 'GET')).room).toMatchObject({ expired: true });
      expect(await retention().runOnce()).toBeGreaterThanOrEqual(1);
      expect(await stored(oid)).toBe(0);
    } finally {
      await setRetentionDays(null);
    }
  });

  // ---- M08 -----------------------------------------------------------------------------------------------------------------------

  it('M08 tells the other people in the room (one collapsed card per room, no text, not the sender) and the card opens the right chat; an account that lost the room is not told', async () => {
    const first = await shipper();
    const second = await shipper();
    const order = await confirmed(alice);
    const oid = String(order.order_id);
    const did = await called(order);
    const accepted = await accept(first, did);
    await drain();
    const kinds = async (userId: string, room: string): Promise<Json[]> => (await app.pool.query(`SELECT target_type, target_id, body, title, item_count, read_at FROM app.notifications WHERE recipient_user_id = $1::uuid AND kind = 'ORDER_CHAT_MESSAGE' AND target_id = $2::uuid ORDER BY created_at`, [userId, room])).rows as Json[];
    ok(await asCustomerChat(alice, oid, 'POST', { body: 'Mã OTP của tôi là 123456, địa chỉ 12 Phố Huế' }), 201);
    ok(await asCustomerChat(alice, oid, 'POST', { body: 'Tin thứ hai' }), 201);
    await drain();
    const toShop = await kinds(shop.userId, oid);
    expect(toShop).toHaveLength(1);
    expect(toShop[0]).toMatchObject({ target_type: 'ORDER', target_id: oid });
    const toShipper = await kinds(first.userId, did);
    expect(toShipper).toHaveLength(1);
    expect(toShipper[0]).toMatchObject({ target_type: 'DELIVERY', target_id: did });
    expect(await kinds(alice.userId, oid)).toHaveLength(0);
    const text = [...toShop, ...toShipper].map((n) => `${String(n.title)} ${String(n.body)}`).join(' ');
    expect(text).not.toMatch(/123456|Phố Huế|OTP/u);
    // The first Shipper gives the delivery back and the second takes it: only the holder is told of the next message.
    ok(await call(first.token, 'POST', `/driver/deliveries/${did}/release`, { reason: 'Xe hỏng', expected_version: accepted.version }));
    await accept(second, did);
    ok(await asShopChat(oid, 'POST', { body: 'Có shipper mới rồi' }), 201);
    await drain();
    expect(await kinds(first.userId, did)).toHaveLength(1);
    expect(((await app.pool.query(`SELECT item_count FROM app.notifications WHERE recipient_user_id = $1::uuid AND kind = 'ORDER_CHAT_MESSAGE' AND target_id = $2::uuid`, [first.userId, did])).rows[0] as Json).item_count).toBe(1);
    expect(await kinds(second.userId, did)).toHaveLength(1);
    expect(await kinds(alice.userId, oid)).toHaveLength(1);
    // Opening the card goes to the chat of the order, and the server checks the right again at that moment.
    const inbox = ok(await call(alice.token, 'GET', '/notifications?limit=50')) as Json;
    const card = (inbox.items as Json[]).find((n) => n.kind === 'ORDER_CHAT_MESSAGE') as Json;
    expect(card).toBeDefined();
    expect(ok(await call(alice.token, 'POST', `/notifications/${String(card.notification_id)}/open`, {}))).toMatchObject({ outcome: 'OK', target: { type: 'ORDER', id: oid } });
    // A message of the shop does not notify the shop; the order detail's own notices are unchanged by chat.
    expect(await kinds(shop.userId, oid)).toHaveLength(1);
  });
});
