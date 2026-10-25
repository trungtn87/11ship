import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { dataOf, errorCode } from './support/auth-fixtures';
import { createShopOwner, completeSetup } from './support/shop-management-fixtures';
import { Json, M11World, PNG_BASE64, Shipper } from './support/m11-harness';

// M11.01 (ratings) and M11.02 (complaints) on a REAL Nest pipeline and PostgreSQL: the actors and subjects, the eligibility of each rating, one rating per
// actor and subject under retries and races, the shop's reply with its history, the public page and the Shipper's separate sources, complaints with
// evidence pictures, duplicates, access to pictures, and the 7-day reconsideration window. Deliveries go through the REAL M07 routes; the only stand-in is
// the M10 order adapter (M10 is not built).

describe('M11.01 ratings', () => {
  let w: M11World;

  beforeAll(async () => {
    w = await M11World.start();
  });
  afterAll(async () => {
    await w.close();
  });

  const body = (stars = 5, comment: string | undefined = 'Rất ngon') => ({ stars, ...(comment === undefined ? {} : { comment }) });
  const reviewsOf = (sql: string, values: unknown[] = []): Promise<number> => w.count(sql, values);

  // ---- customer -> shop --------------------------------------------------------------------------------------------------------------

  it('rates the shop once the order is completed; wrong person, other account, unfinished order and bad input are refused', async () => {
    const customer = await w.newCustomer('Trần Minh Hà');
    const other = await w.newCustomer();
    const done = w.newOrder(customer);
    const open = w.newOrder(customer, { completed: false });

    expect(errorCode(await w.asCustomer(other, 'POST', `/customers/me/orders/${done.orderId}/reviews/shop`, body()))).toBe('REVIEW_TARGET_NOT_FOUND');
    expect(errorCode(await w.asCustomer(customer, 'POST', `/customers/me/orders/${randomUUID()}/reviews/shop`, body()))).toBe('REVIEW_TARGET_NOT_FOUND');
    expect(errorCode(await w.asCustomer(customer, 'POST', `/customers/me/orders/${open.orderId}/reviews/shop`, body()))).toBe('REVIEW_NOT_ELIGIBLE');
    // A shop owner or a Shipper session is not the customer role of the route.
    expect((await w.asShop('POST', `/customers/me/orders/${done.orderId}/reviews/shop`, body())).status).toBeGreaterThanOrEqual(400);
    for (const bad of [{ stars: 0 }, { stars: 6 }, { stars: 3.5 }, { stars: '5' }, {}, { stars: 5, comment: 5 }, { stars: 5, shop_id: w.shop.shopId }, { stars: 5, reviewer_user_id: customer.userId }]) {
      expect([JSON.stringify(bad), (await w.asCustomer(customer, 'POST', `/customers/me/orders/${done.orderId}/reviews/shop`, bad)).status]).toEqual([JSON.stringify(bad), 400]);
    }
    expect(await reviewsOf('SELECT 1 FROM app.reviews WHERE order_id IN ($1::uuid, $2::uuid)', [done.orderId, open.orderId])).toBe(0);

    const ok = await w.asCustomer(customer, 'POST', `/customers/me/orders/${done.orderId}/reviews/shop`, body(4, '  Ốc rất ngon, đậm vị  '));
    expect([ok.status, ok.text.slice(0, 200)]).toEqual([201, ok.text.slice(0, 200)]);
    const row = (await w.app.pool.query('SELECT kind, stars, comment, reviewer_name, visibility, shop_id FROM app.reviews WHERE order_id = $1::uuid', [done.orderId])).rows[0] as Json;
    expect(row).toMatchObject({ kind: 'SHOP_BY_CUSTOMER', stars: 4, comment: 'Ốc rất ngon, đậm vị', reviewer_name: 'Trần Minh Hà', visibility: 'VISIBLE', shop_id: w.shop.shopId });
  });

  it('one rating per order: a second request (new key) is refused; the same key replays; two at once create exactly one', async () => {
    const customer = await w.newCustomer();
    const order = w.newOrder(customer);
    const path = `/customers/me/orders/${order.orderId}/reviews/shop`;
    const key = randomUUID();
    const first = await w.asCustomer(customer, 'POST', path, body(5), key);
    const replay = await w.asCustomer(customer, 'POST', path, body(5), key);
    const again = await w.asCustomer(customer, 'POST', path, body(1, 'đổi ý'));
    expect([first.status, replay.status, errorCode(again)]).toEqual([201, 201, 'REVIEW_ALREADY_EXISTS']);
    expect((dataOf(first).review as Json).review_id).toBe((dataOf(replay).review as Json).review_id);
    expect(await reviewsOf('SELECT 1 FROM app.reviews WHERE order_id = $1::uuid', [order.orderId])).toBe(1);

    const racing = w.newOrder(customer);
    const results = await Promise.all([1, 2, 3].map((n) => w.asCustomer(customer, 'POST', `/customers/me/orders/${racing.orderId}/reviews/shop`, body(n))));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(await reviewsOf('SELECT 1 FROM app.reviews WHERE order_id = $1::uuid', [racing.orderId])).toBe(1);
  });

  it('a rating is immutable: no route edits, deletes or reports it, and the database refuses a direct change', async () => {
    const customer = await w.newCustomer();
    const order = w.newOrder(customer);
    await w.asCustomer(customer, 'POST', `/customers/me/orders/${order.orderId}/reviews/shop`, body(2, 'Tạm'));
    const id = String((await w.app.pool.query('SELECT review_id FROM app.reviews WHERE order_id = $1::uuid', [order.orderId])).rows[0]?.review_id);
    for (const [method, path] of [['PUT', `/shop/me/reviews/${id}`], ['POST', `/shop/me/reviews/${id}/report`], ['POST', `/shop/me/reviews/${id}/delete`], ['PUT', `/customers/me/orders/${order.orderId}/reviews/shop`]] as const) {
      expect([method, path, (await w.as(w.shop.token, method, path, { stars: 5 })).status]).toEqual([method, path, 404]);
    }
    await expect(w.app.pool.query(`UPDATE app.reviews SET stars = 5 WHERE review_id = $1::uuid`, [id])).rejects.toThrow(/REVIEW_IMMUTABLE/);
    await expect(w.app.pool.query(`UPDATE app.reviews SET comment = 'x' WHERE review_id = $1::uuid`, [id])).rejects.toThrow(/REVIEW_IMMUTABLE/);
    await expect(w.app.pool.query(`DELETE FROM app.reviews WHERE review_id = $1::uuid`, [id])).rejects.toThrow(/never deleted/);
  });

  // ---- shop's reply, the public page -----------------------------------------------------------------------------------------------------

  it('the shop answers a customer rating once, updates it with its version, and every text is kept', async () => {
    const customer = await w.newCustomer('Lê Thu Trang');
    const order = w.newOrder(customer);
    await w.asCustomer(customer, 'POST', `/customers/me/orders/${order.orderId}/reviews/shop`, body(5, 'Rất hài lòng'));
    const id = String((await w.app.pool.query('SELECT review_id FROM app.reviews WHERE order_id = $1::uuid', [order.orderId])).rows[0]?.review_id);

    const first = await w.asShop('PUT', `/shop/me/reviews/${id}/reply`, { body: 'Cảm ơn bạn nhé!' });
    expect([first.status, first.text.slice(0, 200)]).toEqual([200, first.text.slice(0, 200)]);
    expect((dataOf(first).reply as Json).version).toBe(1);
    // A reply replaces the version it names; a missing or stale version is a conflict and changes nothing.
    expect((await w.asShop('PUT', `/shop/me/reviews/${id}/reply`, { body: 'Cảm ơn bạn đã ủng hộ quán', expected_version: 1 })).status).toBe(200);
    expect(errorCode(await w.asShop('PUT', `/shop/me/reviews/${id}/reply`, { body: 'Lại cảm ơn' }))).toBe('VERSION_CONFLICT');
    expect(errorCode(await w.asShop('PUT', `/shop/me/reviews/${id}/reply`, { body: 'Cũ', expected_version: 1 }))).toBe('VERSION_CONFLICT');
    expect(errorCode(await w.asShop('PUT', `/shop/me/reviews/${id}/reply`, { body: 'Mới', expected_version: 9 }))).toBe('VERSION_CONFLICT');
    const updated = await w.asShop('PUT', `/shop/me/reviews/${id}/reply`, { body: 'Hẹn gặp lại bạn!', expected_version: 2 });
    expect(updated.status).toBe(200);
    const history = dataOf(await w.asShop('GET', `/shop/me/reviews/${id}/reply/history`)).history as Json[];
    expect(history.map((h) => [h.version, h.body])).toEqual([[1, 'Cảm ơn bạn nhé!'], [2, 'Cảm ơn bạn đã ủng hộ quán'], [3, 'Hẹn gặp lại bạn!']]);
    expect(await reviewsOf('SELECT 1 FROM app.review_replies WHERE review_id = $1::uuid', [id])).toBe(1);
    // The rating itself is untouched.
    expect((await w.app.pool.query('SELECT stars, comment FROM app.reviews WHERE review_id = $1::uuid', [id])).rows[0]).toEqual({ stars: 5, comment: 'Rất hài lòng' });
    // Another account cannot answer it.
    expect((await w.as(customer.token, 'PUT', `/shop/me/reviews/${id}/reply`, { body: 'tôi' })).status).toBeGreaterThanOrEqual(400);
  });

  it('the public shop page: average, count, newest first, star filter, the reply, no personal data; with no rating it says so', async () => {
    // A shop of its own, so the totals are exactly this test's.
    const fresh = await createShopOwner(w.app);
    await completeSetup(w.app, fresh);
    const empty = await w.app.call('GET', `/shops/${fresh.shopId}/reviews`);
    expect(empty.status).toBe(200);
    const none = dataOf(empty) as Json;
    expect(none.summary).toMatchObject({ average: null, count: 0 });
    expect(none.items).toEqual([]);

    const names = ['Trần Minh Hà', 'Lê Thu Trang', 'Hoàng Quốc Bảo'];
    const stars = [5, 4, 3];
    for (let i = 0; i < 3; i += 1) {
      const customer = await w.newCustomer(names[i]);
      const order = w.newOrder(customer, { shopId: fresh.shopId });
      expect((await w.asCustomer(customer, 'POST', `/customers/me/orders/${order.orderId}/reviews/shop`, body(stars[i] ?? 5, `Nhận xét ${i}`))).status).toBe(201);
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    const page = dataOf(await w.app.call('GET', `/shops/${fresh.shopId}/reviews`)) as Json;
    expect(page.summary).toMatchObject({ average: 4, count: 3 });
    expect((page.items as Json[]).map((r) => r.reviewer_name)).toEqual(['Hoàng Quốc Bảo', 'Lê Thu Trang', 'Trần Minh Hà']);
    const text = JSON.stringify(page);
    expect(text).not.toMatch(/\+84|user_id|phone|order_id|reviewer_user_id/);
    const four = dataOf(await w.app.call('GET', `/shops/${fresh.shopId}/reviews?stars=4`)) as Json;
    expect((four.items as Json[]).map((r) => r.stars)).toEqual([4]);
    expect(four.summary).toMatchObject({ count: 3 });
    expect((await w.app.call('GET', `/shops/${fresh.shopId}/reviews?stars=9`)).status).toBe(400);
    expect((await w.app.call('GET', `/shops/${randomUUID()}/reviews`)).status).toBe(404);
  });

  // ---- shop -> Shipper -----------------------------------------------------------------------------------------------------------------

  it('the shop rates the Shipper after a successful OR failed delivery, once; not while the delivery is not finished or was given back', async () => {
    const s = await w.newShipper();
    const ok = await w.completed(s);
    const bad = await w.failed(s);
    const back = await w.givenBack(s);
    const running = (await w.deliver(s)).id;

    const state = dataOf(await w.asShop('GET', `/shop/me/deliveries/${ok}/review`)) as Json;
    expect(state).toMatchObject({ can_review: true, review: null });
    expect((state.shipper as Json).rating).toMatchObject({ average: null, count: 0 });
    for (const id of [back, running]) {
      expect([id, errorCode(await w.asShop('POST', `/shop/me/deliveries/${id}/review`, body()))]).toEqual([id, 'REVIEW_NOT_ELIGIBLE']);
      expect(dataOf(await w.asShop('GET', `/shop/me/deliveries/${id}/review`)).can_review).toBe(false);
    }
    expect(errorCode(await w.asShop('POST', `/shop/me/deliveries/${randomUUID()}/review`, body()))).toBe('DELIVERY_NOT_FOUND');
    // Not the shop: the Shipper and a customer have no such route.
    expect((await w.asShipper(s, 'POST', `/shop/me/deliveries/${ok}/review`, body())).status).toBeGreaterThanOrEqual(400);

    expect((await w.asShop('POST', `/shop/me/deliveries/${ok}/review`, body(4, 'Giao đúng giờ'))).status).toBe(201);
    expect((await w.asShop('POST', `/shop/me/deliveries/${bad}/review`, body(3, 'Không giao được'))).status).toBe(201);
    expect(errorCode(await w.asShop('POST', `/shop/me/deliveries/${ok}/review`, body(1)))).toBe('REVIEW_ALREADY_EXISTS');
    const rows = (await w.app.pool.query('SELECT delivery_id, kind, driver_id, assignment_id FROM app.reviews WHERE kind = $1 AND driver_id = $2::uuid ORDER BY stars', ['SHIPPER_BY_SHOP', s.driverId])).rows as Json[];
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.driver_id === s.driverId && r.assignment_id !== null)).toBe(true);
    // The assignment rated is the one that carried the delivery to its end.
    const carried = (await w.app.pool.query(`SELECT a.assignment_id FROM app.delivery_assignments a WHERE a.delivery_id = $1::uuid AND a.status = 'COMPLETED'`, [ok])).rows[0]?.assignment_id as string;
    expect((await w.app.pool.query('SELECT assignment_id FROM app.reviews WHERE delivery_id = $1::uuid', [ok])).rows[0]?.assignment_id).toBe(carried);
  });

  it('a Shipper who gave the delivery back before pickup receives no rating for that run, and a later Shipper is the one rated', async () => {
    const first = await w.newShipper();
    const second = await w.newShipper();
    const delivery = await w.newDelivery();
    const id = String(delivery.delivery_id);
    const accepted = await w.asShipper(first, 'POST', `/driver/deliveries/${id}/accept`, {});
    expect((await w.asShipper(first, 'POST', `/driver/deliveries/${id}/release`, { reason: 'Kẹt xe', expected_version: (dataOf(accepted) as Json).version })).status).toBe(200);
    const next = await w.asShipper(second, 'POST', `/driver/deliveries/${id}/accept`, {});
    let current = dataOf(next) as Json;
    const dest = await w.asShipper(second, 'POST', `/driver/deliveries/${id}/destination`, { expected_version: current.version, lat: 21.0, lng: 105.82, fee_vnd: 15_000 });
    if (dest.status === 200) {
      current = dataOf(dest) as Json;
    }
    const picked = dataOf(await w.asShipper(second, 'POST', `/driver/deliveries/${id}/pickup`, { expected_version: current.version })) as Json;
    expect((await w.asShipper(second, 'POST', `/driver/deliveries/${id}/complete`, { expected_version: picked.version })).status).toBe(200);
    expect((await w.asShop('POST', `/shop/me/deliveries/${id}/review`, body(5))).status).toBe(201);
    expect((await w.app.pool.query('SELECT driver_id FROM app.reviews WHERE delivery_id = $1::uuid', [id])).rows[0]?.driver_id).toBe(second.driverId);
    const mine = dataOf(await w.asShipper(first, 'GET', '/driver/reviews')) as Json;
    expect((mine.summary as Json).all).toMatchObject({ count: 0, average: null });
  });

  // ---- customer -> Shipper -------------------------------------------------------------------------------------------------------------

  it('the customer rates the Shipper only for a delivery of their own order that succeeded', async () => {
    const s = await w.newShipper();
    const customer = await w.newCustomer();
    const stranger = await w.newCustomer();
    const okDelivery = await w.completed(s);
    const failedDelivery = await w.failed(s);
    const okOrder = await w.linkToOrder(okDelivery, customer);
    const failedOrder = await w.linkToOrder(failedDelivery, customer);
    const noDelivery = w.newOrder(customer);

    const state = dataOf(await w.asCustomer(customer, 'GET', `/customers/me/orders/${okOrder.orderId}/reviews`)) as Json;
    expect(state.shop).toMatchObject({ can_review: true });
    expect(state.shipper).toMatchObject({ can_review: true, review: null });
    expect(JSON.stringify(state)).not.toMatch(/\+84|user_id|plate/);

    expect(errorCode(await w.asCustomer(stranger, 'POST', `/customers/me/orders/${okOrder.orderId}/reviews/shipper`, body()))).toBe('REVIEW_TARGET_NOT_FOUND');
    expect(errorCode(await w.asCustomer(customer, 'POST', `/customers/me/orders/${failedOrder.orderId}/reviews/shipper`, body()))).toBe('REVIEW_NOT_ELIGIBLE');
    expect(errorCode(await w.asCustomer(customer, 'POST', `/customers/me/orders/${noDelivery.orderId}/reviews/shipper`, body()))).toBe('REVIEW_NOT_ELIGIBLE');
    expect(dataOf(await w.asCustomer(customer, 'GET', `/customers/me/orders/${failedOrder.orderId}/reviews`)).shipper).toBeNull();

    const key = randomUUID();
    expect((await w.asCustomer(customer, 'POST', `/customers/me/orders/${okOrder.orderId}/reviews/shipper`, body(5, 'Thân thiện'), key)).status).toBe(201);
    expect((await w.asCustomer(customer, 'POST', `/customers/me/orders/${okOrder.orderId}/reviews/shipper`, body(5, 'Thân thiện'), key)).status).toBe(201);
    expect(errorCode(await w.asCustomer(customer, 'POST', `/customers/me/orders/${okOrder.orderId}/reviews/shipper`, body(1)))).toBe('REVIEW_ALREADY_EXISTS');
    expect(await reviewsOf(`SELECT 1 FROM app.reviews WHERE kind = 'SHIPPER_BY_CUSTOMER' AND delivery_id = $1::uuid`, [okDelivery])).toBe(1);
    // The shop's rating of the same delivery is a separate one: both stand.
    expect((await w.asShop('POST', `/shop/me/deliveries/${okDelivery}/review`, body(4))).status).toBe(201);
  });

  it('a direct call (an order outside the app) is rated by the shop only', async () => {
    const s = await w.newShipper();
    const id = await w.completed(s);
    expect((await w.asShop('POST', `/shop/me/deliveries/${id}/review`, body(5))).status).toBe(201);
    expect(await reviewsOf(`SELECT 1 FROM app.reviews WHERE delivery_id = $1::uuid AND kind = 'SHIPPER_BY_CUSTOMER'`, [id])).toBe(0);
    expect((await w.app.pool.query('SELECT order_id FROM app.reviews WHERE delivery_id = $1::uuid', [id])).rows[0]?.order_id).toBeNull();
  });

  // ---- the Shipper's own score -----------------------------------------------------------------------------------------------------------

  it('the Shipper sees the score split by source without the writer, and a low score restricts nothing', async () => {
    const s = await w.newShipper();
    const customer = await w.newCustomer('Người Viết Bí Mật');
    const id = await w.completed(s);
    const order = await w.linkToOrder(id, customer);
    expect((await w.asCustomer(customer, 'POST', `/customers/me/orders/${order.orderId}/reviews/shipper`, body(1, 'Rất tệ'))).status).toBe(201);
    expect((await w.asShop('POST', `/shop/me/deliveries/${id}/review`, body(3, 'Tạm được'))).status).toBe(201);

    const mine = dataOf(await w.asShipper(s, 'GET', '/driver/reviews')) as Json;
    const summary = mine.summary as Json;
    expect(summary.customer).toMatchObject({ count: 1, average: 1 });
    expect(summary.shop).toMatchObject({ count: 1, average: 3 });
    expect(summary.all).toMatchObject({ count: 2, average: 2 });
    const items = mine.items as Json[];
    expect(items.map((i) => i.source).sort()).toEqual(['CUSTOMER', 'SHOP']);
    expect(JSON.stringify(mine)).not.toMatch(/Người Viết|reviewer|user_id|order_id|shop_id|delivery_id/);
    expect(((dataOf(await w.asShipper(s, 'GET', '/driver/reviews?source=SHOP')) as Json).items as Json[]).map((i) => i.stars)).toEqual([3]);
    // No automatic penalty, lock or restriction.
    expect((await w.app.pool.query('SELECT status, accepting_deliveries FROM app.drivers WHERE driver_id = $1::uuid', [s.driverId])).rows[0]).toEqual({ status: 'ACTIVE', accepting_deliveries: true });
    const next = await w.newDelivery();
    expect((await w.asShipper(s, 'POST', `/driver/deliveries/${next.delivery_id}/accept`, {})).status).toBe(200);
    // A customer or a shop session has no route to the Shipper's list.
    expect((await w.asCustomer(customer, 'GET', '/driver/reviews')).status).toBeGreaterThanOrEqual(400);
    expect((await w.asShop('GET', '/driver/reviews')).status).toBeGreaterThanOrEqual(400);
  });
});

// =====================================================================================================================================
// M11.02 complaints
// =====================================================================================================================================

describe('M11.02 complaints', () => {
  let w: M11World;
  let s: Shipper;

  beforeAll(async () => {
    w = await M11World.start();
    s = await w.newShipper();
  });
  afterAll(async () => {
    await w.close();
  });

  const complaint = (over: Json = {}): Json => ({ category: 'DELIVERY_RESULT', body: 'Đơn báo giao thành công nhưng tôi chưa nhận được hàng.', ...over });
  const upload = (token: string, family: string, base64 = PNG_BASE64, type = 'image/png') => w.app.call('POST', `/${family}/complaints/attachments`, { bearer: token, body: { content_type: type, data_base64: base64 } });
  const q = (sql: string, values: unknown[] = []): Promise<Json[]> => w.app.pool.query(sql, values).then((r) => r.rows as Json[]);

  /** Test-only: closes a complaint the way the Administration will (the guard of the database still applies), `ago` before now. */
  async function close(id: string, ago: string, status: 'RESOLVED' | 'CLOSED_NO_ACTION' = 'CLOSED_NO_ACTION'): Promise<void> {
    if (status === 'RESOLVED') {
      // A file is received before it is concluded.
      await w.app.pool.query(`UPDATE app.complaints SET status = 'IN_PROGRESS', received_at = now(), version = version + 1 WHERE complaint_id = $1::uuid`, [id]);
    }
    await w.app.pool.query(
      `UPDATE app.complaints SET status = $2::text, received_at = COALESCE(received_at, now()), close_reason = CASE WHEN $2::text = 'CLOSED_NO_ACTION' THEN 'Không đủ căn cứ' ELSE close_reason END,
              conclusion = CASE WHEN $2::text = 'RESOLVED' THEN 'Đã xử lý' ELSE conclusion END, closed_at = now() - $3::interval, closure_no = closure_no + 1, version = version + 1 WHERE complaint_id = $1::uuid`,
      [id, status, ago],
    );
  }

  it('the shop opens a complaint about its own delivery; a stranger\'s delivery, a wrong group and a customer subject are refused', async () => {
    const id = await w.completed(s);
    const stranger = await w.newShipper();
    const ok = await w.asShop('POST', '/shop/me/complaints', complaint({ category: 'GOODS', delivery_id: id }));
    expect([ok.status, ok.text.slice(0, 300)]).toEqual([201, ok.text.slice(0, 300)]);
    const data = dataOf(ok) as Json;
    expect(data.appended).toBe(false);
    const view = data.complaint as Json;
    expect(view).toMatchObject({ status: 'PENDING', category: 'GOODS', relation: 'SUBMITTER', can_supplement: true, can_request_reconsideration: false });
    expect(String(view.code)).toMatch(/^PA\d{5}$/);
    expect((view.messages as Json[]).map((m) => [m.kind, m.author])).toEqual([['SUBMITTED', 'YOU']]);
    expect(JSON.stringify(view)).not.toMatch(/\+84|user_id|submitter_user_id|internal/i);
    // Another Shipper (never held it), a random delivery: "not found", and no row.
    expect(errorCode(await w.asShipper(stranger, 'POST', '/driver/complaints', complaint({ delivery_id: id })))).toBe('COMPLAINT_TARGET_NOT_FOUND');
    expect(errorCode(await w.asShop('POST', '/shop/me/complaints', complaint({ delivery_id: randomUUID() })))).toBe('COMPLAINT_TARGET_NOT_FOUND');
    // A subject must be exactly one; a rating complaint needs a rating and the Shipper.
    for (const bad of [complaint({ delivery_id: id, order_id: randomUUID() }), complaint(), complaint({ category: 'SHIPPER_REVIEW', delivery_id: id }), complaint({ category: 'NOPE', delivery_id: id }), complaint({ body: '', delivery_id: id }), complaint({ delivery_id: id, submitter_role: 'ADMIN' })]) {
      expect([JSON.stringify(bad).slice(0, 60), (await w.asShop('POST', '/shop/me/complaints', bad)).status]).toEqual([JSON.stringify(bad).slice(0, 60), 400]);
    }
    expect(errorCode(await w.asShop('POST', '/shop/me/complaints', complaint({ category: 'SHIPPER_REVIEW', review_id: randomUUID() })))).toBe('COMPLAINT_TARGET_NOT_FOUND');
    expect(await w.count('SELECT 1 FROM app.complaints WHERE delivery_id = $1::uuid', [id])).toBe(1);
  });

  it('the same open issue on the same delivery is one file: the second request adds to it; another group is another file; a retry changes nothing', async () => {
    const id = await w.completed(s);
    const first = dataOf(await w.asShop('POST', '/shop/me/complaints', complaint({ category: 'MONEY_FEE', delivery_id: id, body: 'Thu khác phí chốt' }))) as Json;
    const code = (first.complaint as Json).code;
    const second = await w.asShop('POST', '/shop/me/complaints', complaint({ category: 'MONEY_FEE', delivery_id: id, body: 'Bổ sung: thu thêm 20.000đ' }));
    expect(second.status).toBe(200);
    const merged = dataOf(second) as Json;
    expect(merged.appended).toBe(true);
    expect((merged.complaint as Json).code).toBe(code);
    expect(((merged.complaint as Json).messages as Json[]).map((m) => m.kind)).toEqual(['SUBMITTED', 'APPENDED']);
    const other = dataOf(await w.asShop('POST', '/shop/me/complaints', complaint({ category: 'SERVICE', delivery_id: id }))) as Json;
    expect((other.complaint as Json).code).not.toBe(code);
    expect(await w.count('SELECT 1 FROM app.complaints WHERE delivery_id = $1::uuid AND submitter_user_id = $2::uuid', [id, w.shop.userId])).toBe(2);

    // A retry with the same key (a lost answer) returns the stored answer and writes nothing; two at once leave one file.
    const key = randomUUID();
    const sameBody = complaint({ category: 'OTHER', delivery_id: id, body: 'Khác' });
    const a = await w.asShop('POST', '/shop/me/complaints', sameBody, key);
    const b = await w.asShop('POST', '/shop/me/complaints', sameBody, key);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(((dataOf(a) as Json).complaint as Json).code).toBe(((dataOf(b) as Json).complaint as Json).code);
    const racing = await w.completed(s);
    const results = await Promise.all([1, 2, 3].map((n) => w.asShop('POST', '/shop/me/complaints', complaint({ delivery_id: racing, body: `Lần ${n}` }))));
    expect(results.every((r) => r.status === 200 || r.status === 201)).toBe(true);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await w.count('SELECT 1 FROM app.complaints WHERE delivery_id = $1::uuid', [racing])).toBe(1);
    expect(await w.count(`SELECT 1 FROM app.complaint_messages m JOIN app.complaints c USING (complaint_id) WHERE c.delivery_id = $1::uuid`, [racing])).toBe(3);
  });

  it('a Shipper complains about a delivery it carried and about a rating of it; a rating of another Shipper is not theirs to dispute', async () => {
    const other = await w.newShipper();
    const id = await w.completed(s);
    expect((await w.asShop('POST', `/shop/me/deliveries/${id}/review`, body(1, 'Không tốt'))).status).toBe(201);
    const review = String((await q('SELECT review_id FROM app.reviews WHERE delivery_id = $1::uuid', [id]))[0]?.review_id);
    const mine = dataOf(await w.asShipper(s, 'POST', '/driver/complaints', complaint({ category: 'SHIPPER_REVIEW', review_id: review, body: 'Đánh giá nhầm đơn' }))) as Json;
    expect(mine.complaint).toMatchObject({ category: 'SHIPPER_REVIEW', status: 'PENDING' });
    const line = ((dataOf(await w.asShipper(s, 'GET', '/driver/reviews')) as Json).items as Json[]).find((i) => i.review_id === review) as Json;
    expect(line.complaint).toMatchObject({ code: (mine.complaint as Json).code, status: 'PENDING' });
    expect(errorCode(await w.asShipper(other, 'POST', '/driver/complaints', complaint({ category: 'SHIPPER_REVIEW', review_id: review })))).toBe('COMPLAINT_TARGET_NOT_FOUND');
    expect(errorCode(await w.asShipper(other, 'POST', '/driver/complaints', complaint({ delivery_id: id })))).toBe('COMPLAINT_TARGET_NOT_FOUND');
    expect(dataOf(await w.asShipper(s, 'POST', '/driver/complaints', complaint({ delivery_id: id }))).complaint).toMatchObject({ category: 'DELIVERY_RESULT' });
    // The shop does not file the Shipper-only group.
    expect(errorCode(await w.asShop('POST', '/shop/me/complaints', complaint({ category: 'SHIPPER_REVIEW', review_id: review })))).toBe('COMPLAINT_TARGET_NOT_FOUND');
  });

  it('the customer complains only about the order their ACCOUNT placed; the order module not connected is said honestly', async () => {
    const customer = await w.newCustomer();
    const other = await w.newCustomer();
    const order = w.newOrder(customer);
    expect(errorCode(await w.asCustomer(other, 'POST', '/customers/me/complaints', complaint({ order_id: order.orderId })))).toBe('COMPLAINT_TARGET_NOT_FOUND');
    expect(errorCode(await w.asCustomer(customer, 'POST', '/customers/me/complaints', complaint({ delivery_id: randomUUID() })))).toBe('COMPLAINT_TARGET_NOT_FOUND');
    expect(errorCode(await w.asCustomer(customer, 'POST', '/customers/me/complaints', complaint({ category: 'SHIPPER_REVIEW', review_id: randomUUID() })))).toBe('COMPLAINT_TARGET_NOT_FOUND');
    const ok = await w.asCustomer(customer, 'POST', '/customers/me/complaints', complaint({ category: 'GOODS', order_id: order.orderId, body: 'Thiếu món' }));
    expect(ok.status).toBe(201);
    expect(((dataOf(ok) as Json).complaint as Json).related).toMatchObject({ code: order.code, order_id: order.orderId });
  });

  it('evidence pictures: up to 5 of 5 MB, a real image only, never somebody else\'s, readable only by those who may read the line', async () => {
    const id = await w.completed(s);
    // Validation: shape, signature mismatch, wrong type, not base64, too big.
    expect((await upload(w.shop.token, 'shop/me', PNG_BASE64, 'image/jpeg')).status).toBe(400);
    expect(errorCode(await upload(w.shop.token, 'shop/me', PNG_BASE64, 'image/jpeg'))).toBe('COMPLAINT_ATTACHMENT_INVALID');
    expect(errorCode(await upload(w.shop.token, 'shop/me', Buffer.from('GIF89a....').toString('base64'), 'image/gif'))).toBe('COMPLAINT_ATTACHMENT_INVALID');
    expect(errorCode(await upload(w.shop.token, 'shop/me', Buffer.from('<svg xmlns="x"/>').toString('base64'), 'image/png'))).toBe('COMPLAINT_ATTACHMENT_INVALID');
    expect(errorCode(await upload(w.shop.token, 'shop/me', '@@@@', 'image/png'))).toBe('COMPLAINT_ATTACHMENT_INVALID');
    const header = Buffer.from(PNG_BASE64, 'base64');
    const limit = 5 * 1024 * 1024;
    const justOver = Buffer.concat([header, Buffer.alloc(limit + 1 - header.length)]);
    const exactly = Buffer.concat([header, Buffer.alloc(limit - header.length)]);
    expect(errorCode(await upload(w.shop.token, 'shop/me', justOver.toString('base64')))).toBe('COMPLAINT_ATTACHMENT_INVALID');
    const big = await upload(w.shop.token, 'shop/me', exactly.toString('base64'));
    expect([big.status, big.text.slice(0, 120)]).toEqual([201, big.text.slice(0, 120)]);
    expect((dataOf(big) as Json).byte_size).toBe(limit);

    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const up = await upload(w.shop.token, 'shop/me');
      expect(up.status).toBe(201);
      ids.push(String((dataOf(up) as Json).attachment_id));
    }
    const six = [...ids, String((dataOf(await upload(w.shop.token, 'shop/me')) as Json).attachment_id)];
    expect(errorCode(await w.asShop('POST', '/shop/me/complaints', complaint({ delivery_id: id, attachment_ids: six })))).toBe('COMPLAINT_ATTACHMENT_LIMIT');
    // Somebody else's picture, a picture that does not exist: the same answer, and nothing is created or attached.
    const theirs = String((dataOf(await upload(s.token, 'driver')) as Json).attachment_id);
    expect(errorCode(await w.asShop('POST', '/shop/me/complaints', complaint({ delivery_id: id, attachment_ids: [theirs] })))).toBe('COMPLAINT_ATTACHMENT_NOT_FOUND');
    expect(errorCode(await w.asShop('POST', '/shop/me/complaints', complaint({ delivery_id: id, attachment_ids: [randomUUID()] })))).toBe('COMPLAINT_ATTACHMENT_NOT_FOUND');
    expect(await w.count('SELECT 1 FROM app.complaints WHERE delivery_id = $1::uuid', [id])).toBe(0);

    const created = await w.asShop('POST', '/shop/me/complaints', complaint({ delivery_id: id, attachment_ids: ids }));
    expect(created.status).toBe(201);
    const complaintId = String(((dataOf(created) as Json).complaint as Json).complaint_id);
    const message = (((dataOf(created) as Json).complaint as Json).messages as Json[])[0] as Json;
    expect((message.attachments as Json[]).map((a) => a.attachment_id).sort()).toEqual([...ids].sort());
    // Attached once: the same picture cannot be attached to a second file.
    expect(errorCode(await w.asShop('POST', `/shop/me/complaints`, complaint({ category: 'OTHER', delivery_id: id, attachment_ids: [ids[0]] })))).toBe('COMPLAINT_ATTACHMENT_NOT_FOUND');
    await expect(w.app.pool.query(`UPDATE app.complaint_attachments SET data = 'x'::bytea WHERE attachment_id = $1::uuid`, [ids[0]])).rejects.toThrow();

    // Who may read it: the submitter yes; the Shipper of that delivery (a party, nothing shown to it) and every other account no.
    const read = (token: string, family: string, pic: string) => fetch(`${w.app.running.baseUrl}/v1/${family}/complaints/attachments/${pic}`, { headers: { authorization: `Bearer ${token}` } });
    const mineRes = await read(w.shop.token, 'shop/me', ids[0] as string);
    expect(mineRes.status).toBe(200);
    expect(mineRes.headers.get('content-type')).toBe('image/png');
    expect(mineRes.headers.get('cache-control')).toBe('private, no-store');
    expect(mineRes.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await mineRes.arrayBuffer()).equals(Buffer.from(PNG_BASE64, 'base64'))).toBe(true);
    expect((await read(s.token, 'driver', ids[0] as string)).status).toBe(404);
    expect((await read(w.shop.token, 'shop/me', theirs)).status).toBe(404);
    expect((await read(w.shop.token, 'shop/me', randomUUID())).status).toBe(404);
    const noSession = await fetch(`${w.app.running.baseUrl}/v1/shop/me/complaints/attachments/${ids[0]}`);
    expect(noSession.status).toBe(401);
    expect((await w.asShop('GET', `/shop/me/complaints/${complaintId}`)).status).toBe(200);
  });

  it('"Phản ánh của tôi": own files with counts, only the submitter reads them, others get not found; pictures, line breaks and the thread are kept', async () => {
    const id = await w.completed(s);
    const created = dataOf(await w.asShop('POST', '/shop/me/complaints', complaint({ category: 'OTHER', delivery_id: id, body: 'Dòng một\n\n\n\nDòng hai' }))) as Json;
    const complaintId = String((created.complaint as Json).complaint_id);
    expect(await w.count('SELECT 1 FROM app.complaints WHERE complaint_id = $1::uuid AND body = $2', [complaintId, 'Dòng một\n\nDòng hai'])).toBe(1);
    const list = dataOf(await w.asShop('GET', '/shop/me/complaints?scope=open')) as Json;
    expect((list.items as Json[]).map((i) => i.complaint_id)).toContain(complaintId);
    expect(list.counts).toMatchObject({ closed: 0 });
    expect((list.counts as Json).open).toBeGreaterThan(0);
    expect(((dataOf(await w.asShop('GET', '/shop/me/complaints?scope=closed')) as Json).items as Json[])).toEqual([]);
    expect((await w.asShop('GET', '/shop/me/complaints?scope=other')).status).toBe(400);
    expect((await w.asShop('GET', '/shop/me/complaints?limit=0')).status).toBe(400);
    // Not the submitter: another role, another account, the other route family.
    expect(errorCode(await w.asShipper(s, 'GET', `/driver/complaints/${complaintId}`))).toBe('COMPLAINT_NOT_FOUND');
    expect((await w.asShipper(s, 'GET', `/shop/me/complaints/${complaintId}`)).status).toBeGreaterThanOrEqual(400);
    const customer = await w.newCustomer();
    expect((await w.asCustomer(customer, 'GET', `/customers/me/complaints/${complaintId}`)).status).toBe(404);
    expect((await w.asShop('GET', `/shop/me/complaints/${randomUUID()}`)).status).toBe(404);
    expect((await w.app.call('GET', `/shop/me/complaints/${complaintId}`)).status).toBe(401);
    // No route lets the submitter change the status, the code or the file itself.
    for (const [method, path] of [['PUT', `/shop/me/complaints/${complaintId}`], ['POST', `/shop/me/complaints/${complaintId}/close`], ['POST', `/shop/me/complaints/${complaintId}/status`]] as const) {
      expect([path, (await w.as(w.shop.token, method, path, { status: 'RESOLVED' })).status]).toEqual([path, 404]);
    }
  });

  it('the submitter adds text and pictures to an open file; an empty addition, a stranger and a retry are handled; the file stays the same file', async () => {
    const id = await w.completed(s);
    const created = dataOf(await w.asShop('POST', '/shop/me/complaints', complaint({ delivery_id: id }))) as Json;
    const complaintId = String((created.complaint as Json).complaint_id);
    const pic = String((dataOf(await upload(w.shop.token, 'shop/me')) as Json).attachment_id);
    const path = `/shop/me/complaints/${complaintId}/supplement`;
    expect((await w.asShop('POST', path, {})).status).toBe(400);
    expect((await w.asShop('POST', path, { body: '' })).status).toBe(400);
    const key = randomUUID();
    const added = await w.asShop('POST', path, { body: 'Thêm ảnh chụp màn hình', attachment_ids: [pic] }, key);
    const replay = await w.asShop('POST', path, { body: 'Thêm ảnh chụp màn hình', attachment_ids: [pic] }, key);
    expect([added.status, replay.status]).toEqual([200, 200]);
    const view = dataOf(added) as Json;
    expect((view.messages as Json[]).map((m) => m.kind)).toEqual(['SUBMITTED', 'SUPPLEMENT']);
    expect(await w.count('SELECT 1 FROM app.complaint_messages WHERE complaint_id = $1::uuid', [complaintId])).toBe(2);
    expect(await w.count('SELECT 1 FROM app.complaint_attachments WHERE complaint_id = $1::uuid', [complaintId])).toBe(1);
    expect(errorCode(await w.asShipper(s, 'POST', `/driver/complaints/${complaintId}/supplement`, { body: 'tôi' }))).toBe('COMPLAINT_NOT_FOUND');
    // Version moves with each addition so an app that held the old one reads again.
    expect(Number(view.version)).toBeGreaterThan(Number(((created.complaint as Json).version)));
    expect((await w.asShop('GET', `/shop/me/complaints/${complaintId}`)).status).toBe(200);
  });

  it('after the file is closed: no supplement; the reconsideration is open for 7 days by the SERVER clock, once per closing', async () => {
    const id = await w.completed(s);
    const created = dataOf(await w.asShop('POST', '/shop/me/complaints', complaint({ delivery_id: id }))) as Json;
    const complaintId = String((created.complaint as Json).complaint_id);
    const reconsider = (reason = 'Tôi có thêm bằng chứng') => w.asShop('POST', `/shop/me/complaints/${complaintId}/reconsideration`, { reason });
    // Open: nothing to reconsider.
    expect(errorCode(await reconsider())).toBe('RECONSIDERATION_NOT_AVAILABLE');
    await close(complaintId, '6 days 23 hours');
    const closed = dataOf(await w.asShop('GET', `/shop/me/complaints/${complaintId}`)) as Json;
    expect(closed).toMatchObject({ status: 'CLOSED_NO_ACTION', can_supplement: false, can_request_reconsideration: true, close_reason: 'Không đủ căn cứ' });
    expect(String(closed.reconsideration_expires_at)).toMatch(/^20/);
    const listed = ((dataOf(await w.asShop('GET', '/shop/me/complaints?scope=closed')) as Json).items as Json[]).find((i) => i.complaint_id === complaintId) as Json;
    expect(listed).toMatchObject({ status: 'CLOSED_NO_ACTION', can_request_reconsideration: true });
    expect(errorCode(await w.asShop('POST', `/shop/me/complaints/${complaintId}/supplement`, { body: 'muộn' }))).toBe('COMPLAINT_STATE_CONFLICT');
    expect((await w.asShop('POST', `/shop/me/complaints/${complaintId}/reconsideration`, {})).status).toBe(400);
    const key = randomUUID();
    const asked = await w.asShop('POST', `/shop/me/complaints/${complaintId}/reconsideration`, { reason: 'Tôi có thêm bằng chứng' }, key);
    expect([asked.status, asked.text.slice(0, 200)]).toEqual([200, asked.text.slice(0, 200)]);
    expect((await w.asShop('POST', `/shop/me/complaints/${complaintId}/reconsideration`, { reason: 'Tôi có thêm bằng chứng' }, key)).status).toBe(200);
    expect(errorCode(await reconsider('lần hai'))).toBe('RECONSIDERATION_NOT_AVAILABLE');
    expect(await w.count('SELECT 1 FROM app.complaint_reconsiderations WHERE complaint_id = $1::uuid', [complaintId])).toBe(1);
    expect(((dataOf(await w.asShop('GET', `/shop/me/complaints/${complaintId}`)) as Json).can_request_reconsideration)).toBe(false);
    expect(errorCode(await w.asShipper(s, 'POST', `/driver/complaints/${complaintId}/reconsideration`, { reason: 'tôi' }))).toBe('COMPLAINT_NOT_FOUND');

    // 7 days and a second: expired for the next file, in the list and in the detail alike, and the request is refused.
    const late = dataOf(await w.asShop('POST', '/shop/me/complaints', complaint({ category: 'GOODS', delivery_id: id }))) as Json;
    const lateId = String((late.complaint as Json).complaint_id);
    await close(lateId, '7 days 1 second', 'RESOLVED');
    const expired = dataOf(await w.asShop('GET', `/shop/me/complaints/${lateId}`)) as Json;
    expect(expired).toMatchObject({ status: 'RESOLVED', can_request_reconsideration: false, conclusion: 'Đã xử lý' });
    expect(((dataOf(await w.asShop('GET', '/shop/me/complaints?scope=closed')) as Json).items as Json[]).find((i) => i.complaint_id === lateId)).toMatchObject({ can_request_reconsideration: false });
    expect(errorCode(await w.asShop('POST', `/shop/me/complaints/${lateId}/reconsideration`, { reason: 'muộn' }))).toBe('RECONSIDERATION_EXPIRED');
    expect(await w.count('SELECT 1 FROM app.complaint_reconsiderations WHERE complaint_id = $1::uuid', [lateId])).toBe(0);
  });

  it('a complaint changes nothing about the delivery, its custody, the Shipper\'s wallet or the ratings', async () => {
    const id = await w.failed(s);
    const before = {
      delivery: (await q('SELECT state, version, fee_vnd FROM app.deliveries WHERE delivery_id = $1::uuid', [id]))[0],
      incident: (await q('SELECT status, custody, version FROM app.delivery_incidents WHERE delivery_id = $1::uuid', [id]))[0],
      wallet: await w.wallet(s),
      ledger: await w.ledgerCount(s),
    };
    const created = await w.asShop('POST', '/shop/me/complaints', complaint({ category: 'GOODS', delivery_id: id, body: 'Hàng chưa về quán' }));
    expect(created.status).toBe(201);
    await close(String(((dataOf(created) as Json).complaint as Json).complaint_id), '1 minute');
    expect({
      delivery: (await q('SELECT state, version, fee_vnd FROM app.deliveries WHERE delivery_id = $1::uuid', [id]))[0],
      incident: (await q('SELECT status, custody, version FROM app.delivery_incidents WHERE delivery_id = $1::uuid', [id]))[0],
      wallet: await w.wallet(s),
      ledger: await w.ledgerCount(s),
    }).toEqual(before);
    expect(before.incident).toMatchObject({ status: 'OPEN', custody: 'SHIPPER' });
  });
});

const body = (stars = 5, comment: string | undefined = 'Rất ngon') => ({ stars, ...(comment === undefined ? {} : { comment }) });
