import { createHash, randomUUID } from 'node:crypto';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { AccountDeletionSweeper } from '../../apps/backend/src/account-deletion/account-deletion-sweeper';
import { AccountDeletionLimiter } from '../../apps/backend/src/account-deletion/account-deletion-limiter';
import { DEFAULT_ACCOUNT_DELETION_CONFIG } from '../../apps/backend/src/config/account-deletion-config';
import { M14_ROUTING } from '../../apps/backend/src/delivery/m14-route-client';
import { TransactionManager } from '../../apps/backend/src/transaction/transaction-manager';
import { ApiResponse, AuthApp, countRows, dataOf, errorCode, PASSWORD, rowLockWaitersRunning, startAuthApp } from './support/auth-fixtures';
import { insertDeliveryRow } from './support/delivery-fixtures';
import {
  cleanupOrders,
  codeOf,
  Customer,
  Dish,
  Json,
  newCustomer,
  newDish,
  newShipper,
  openAllWeek,
  PRIVACY,
  Shipper,
  TERMS,
  WEB_SHIP,
} from './support/m10-fixtures';
import { createShopOwner, ShopOwner } from './support/shop-management-fixtures';

// P5-6a (Owner decision OD-26) on the REAL Nest pipeline and a REAL PostgreSQL (TEST database only): the owner's public account deletion
// (POST /v1/account-deletion/confirm and the page /delete-account), its separate quota, the generic authentication error, the pending state
// (every entry that starts NEW work refuses, the running work is finished), the sweeper that finishes a pending request exactly once, and the
// races between the confirmation and the work it must not lose.

const PUBLIC_ORIGIN = 'https://delete.example.test';

describe('P5-6a public account deletion', () => {
  let app: AuthApp;
  let router: http.Server;
  let shop: ShopOwner;
  let dish: Dish;
  let addedPolicy = false;
  let policyVersion = 1;
  const drivers: string[] = [];
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
    app = await startAuthApp(
      {},
      {
        relaxTimeouts: true,
        configOverride: {
          clientAuth: { termsVersion: TERMS, privacyVersion: PRIVACY },
          // The address budget is lifted for the many requests of this suite (all from one loopback address); the phone budget is the default 5/15 min.
          accountDeletion: { ...DEFAULT_ACCOUNT_DELETION_CONFIG, publicOrigin: PUBLIC_ORIGIN, ip: { limit: 10_000, windowSeconds: 600 } },
        },
        overrides: [{ provide: M14_ROUTING, useValue: { origin, timeoutMs: 3000 } }],
      },
    );
    shop = await createShopOwner(app);
    await openAllWeek(app, shop.shopId);
    dish = await newDish(app, shop.token, 'Phở bò', 45_000);
    const existing = await app.pool.query('SELECT 1 FROM app.shipping_fee_policy_versions LIMIT 1');
    if ((existing.rowCount ?? 0) === 0) {
      await app.pool.query(
        `INSERT INTO app.shipping_fee_policy_versions (version_id, version_no, schema_version, tiers, applied_by, applied_at) VALUES ($1::uuid, 1, 2, $2::jsonb, $3::uuid, now())`,
        [randomUUID(), JSON.stringify([{ from_m: 0, to_m: 3000, fee_vnd: 10000 }, { from_m: 3000, to_m: 6000, fee_vnd: 15000 }, { from_m: 6000, to_m: 10000, fee_vnd: 20000 }]), shop.userId],
      );
      addedPolicy = true;
    }
    const activePolicy = await app.pool.query<{ version_no: string }>('SELECT version_no::text AS version_no FROM app.shipping_fee_policy_versions ORDER BY version_no DESC LIMIT 1');
    policyVersion = Number(activePolicy.rows[0]?.version_no ?? 1);
  }, 300_000);

  afterAll(async () => {
    try {
      await cleanupOrders(app, {
        shopIds: [shop.shopId, ...extraShops],
        customerIds: extraCustomers,
        drivers,
        userIds: [shop.userId, ...extraUsers, ...extraCustomers],
        policyAdded: addedPolicy,
      });
    } finally {
      await app.close();
      await new Promise<void>((resolve) => router.close(() => resolve()));
    }
  });

  beforeEach(async () => {
    await app.pool.query('DELETE FROM app.account_delete_limits');
  });

  // ---- helpers ---------------------------------------------------------------------------------------------------------------------

  const confirm = (phone: { local: string }, password: string = PASSWORD, key: string | null = randomUUID(), headers: Record<string, string> = {}): Promise<ApiResponse> =>
    app.call('POST', '/account-deletion/confirm', { headers: { ...(key === null ? {} : { 'idempotency-key': key }), ...headers }, body: { phone: phone.local, password } });
  const login = (phone: { local: string }, password: string = PASSWORD): Promise<ApiResponse> =>
    app.call('POST', '/client-auth/login', { headers: { 'idempotency-key': randomUUID() }, body: { phone: phone.local, password, device: { device_id: 'web-food-0010', platform: 'WEB', app: 'FOOD' } } });
  const me = (token: string): Promise<ApiResponse> => app.call('GET', '/client-auth/me', { bearer: token });
  const resultOf = (response: ApiResponse): unknown => response.body.data?.result;
  const refused = (response: ApiResponse): { status: number; code: string | undefined } => ({ status: response.status, code: codeOf(response) });
  const customer = async (): Promise<Customer> => {
    const created = await newCustomer(app);
    extraCustomers.push(created.userId);
    return created;
  };
  const userRow = async (id: string): Promise<{ status: string; version: string; lock_reason: string | null; pending: boolean } | undefined> =>
    (
      await app.pool.query<{ status: string; version: string; lock_reason: string | null; pending: boolean }>(
        'SELECT status, version::text, lock_reason, (delete_requested_at IS NOT NULL) AS pending FROM app.users WHERE user_id = $1::uuid',
        [id],
      )
    ).rows[0];
  const audits = (action: string, userId: string): Promise<number> => countRows(app.pool, 'SELECT 1 FROM app.audit_logs WHERE action = $1 AND resource_id = $2', [action, userId]);
  const liveSessions = (userId: string): Promise<number> => countRows(app.pool, 'SELECT 1 FROM app.sessions WHERE user_id = $1::uuid AND revoked_at IS NULL', [userId]);
  const attemptsTotal = async (): Promise<number> => Number((await app.pool.query<{ n: string }>('SELECT COALESCE(sum(attempts), 0)::text AS n FROM app.account_delete_limits')).rows[0]?.n ?? 0);
  const markPending = (userId: string): Promise<unknown> =>
    app.pool.query(`UPDATE app.users SET delete_requested_at = clock_timestamp(), version = version + 1 WHERE user_id = $1::uuid AND status = 'ACTIVE'`, [userId]);
  const sweeper = (): AccountDeletionSweeper => app.running.app.get(AccountDeletionSweeper);

  async function withoutTriggers<T>(tables: readonly string[], run: (q: { query(sql: string, values?: unknown[]): Promise<unknown> }) => Promise<T>): Promise<T> {
    const client = await app.pool.connect();
    try {
      await client.query('BEGIN');
      for (const table of tables) await client.query(`ALTER TABLE app.${table} DISABLE TRIGGER USER`);
      const result = await run(client);
      for (const table of tables) await client.query(`ALTER TABLE app.${table} ENABLE TRIGGER USER`);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  /** A made-up order row (the repository's usual fixture for rows owned by another module). */
  async function insertOrder(customerId: string, shopId: string, status: 'PENDING_CONFIRMATION' | 'PREPARING' | 'COMPLETED'): Promise<string> {
    const orderId = randomUUID();
    await withoutTriggers(['orders'], (q) =>
      q.query(
        `INSERT INTO app.orders (order_id, code, client_ref, customer_user_id, shop_id, status, shop_name, shop_phone, shop_address_text, recipient_name, recipient_phone, address_text,
           items_original_total_vnd, items_total_vnd, confirmed_at, ended_at, end_actor, created_at, updated_at)
         VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5::uuid, $6::varchar, 'Quán thử', '0900000000', 'Số 1', 'Người nhận', '0912345678', 'Số 2', 50000, 50000,
           CASE WHEN $6::varchar IN ('PREPARING','COMPLETED') THEN now() END, CASE WHEN $6::varchar = 'COMPLETED' THEN now() END, CASE WHEN $6::varchar = 'COMPLETED' THEN 'SHOP' END, now(), now())`,
        [orderId, `#D${orderId.slice(0, 6)}`, randomUUID(), customerId, shopId, status],
      ),
    );
    return orderId;
  }
  const finishOrder = (orderId: string): Promise<unknown> =>
    withoutTriggers(['orders'], (q) =>
      q.query(`UPDATE app.orders SET status = 'COMPLETED', confirmed_at = COALESCE(confirmed_at, now()), ended_at = now(), end_actor = 'SHOP', version = version + 1 WHERE order_id = $1::uuid`, [orderId]),
    );

  const ADDRESS = { address_text: '12 Phố Huế, Hai Bà Trưng, Hà Nội', lat: 21.0, lng: 105.82 };
  const checkoutBody = (shopId: string = shop.shopId, d: Dish = dish): Json => ({
    client_ref: randomUUID(),
    shop_id: shopId,
    lines: [{ item_id: d.itemId, quantity: 1, unit_price_vnd: d.price }],
    items_total_vnd: d.price,
    recipient_name: 'Người nhận',
    recipient_phone: '0912345678',
    address: ADDRESS,
    expected_quote: { status: 'PRICED', distance_m: 2500, fee_vnd: 10_000, reason: null, policy_version: policyVersion, snapshot: '21,105.8>21,105.82' },
  });
  const placeOrder = (c: Customer, body: Json = checkoutBody()): Promise<ApiResponse> =>
    app.call('POST', '/customers/me/orders', { bearer: c.token, headers: { 'idempotency-key': randomUUID() }, body });

  // ---- the separate quota, the generic error ------------------------------------------------------------------------------------

  it('a wrong password only spends the deletion budget: the sixth attempt is 429, the account is untouched and login (its own budget) still works', async () => {
    const c = await customer();
    const loginBudgetBefore = await countRows(app.pool, 'SELECT 1 FROM app.client_login_limits');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(refused(await confirm(c.phone, 'Wrong-Password-1'))).toEqual({ status: 401, code: 'INVALID_CREDENTIALS' });
    }
    // The budget of the phone is spent: even the CORRECT password is refused now, with the quota error (and nothing is deleted).
    expect(refused(await confirm(c.phone, PASSWORD))).toEqual({ status: 429, code: 'ACCOUNT_DELETE_RATE_LIMITED' });
    expect(await userRow(c.userId)).toMatchObject({ status: 'ACTIVE', lock_reason: null, pending: false });
    expect(await liveSessions(c.userId)).toBeGreaterThan(0);
    // Not a single row of the login quota was written by the deletion attempts, and the login still answers.
    expect(await countRows(app.pool, 'SELECT 1 FROM app.client_login_limits')).toBe(loginBudgetBefore);
    expect((await login(c.phone)).status).toBe(200);
  });

  it('the deletion quota and the login quota are separate tables and separate key spaces: login attempts never spend the deletion budget', async () => {
    const c = await customer();
    await app.pool.query('DELETE FROM app.account_delete_limits');
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await login(c.phone, 'Wrong-Password-1');
    }
    expect(await attemptsTotal()).toBe(0);
    // ... and eight login failures did not take the account's deletion away from its owner.
    expect(resultOf(await confirm(c.phone))).toBe('DELETED');
  });

  it('the two buckets are independent: the address bucket refuses on its own, and so does the phone bucket from many addresses', async () => {
    const transactions = app.running.app.get(TransactionManager);
    const key = { hmacSha256Hex: (message: string): string => createHash('sha256').update(message).digest('hex') };
    const limiter = new AccountDeletionLimiter(transactions, { auth: { otpHmacKey: key }, accountDeletion: { ...DEFAULT_ACCOUNT_DELETION_CONFIG, ip: { limit: 2, windowSeconds: 600 } } } as never);
    await limiter.reserve('10.0.0.1', '0911111111');
    await limiter.reserve('10.0.0.1', '0922222222');
    // The third request from the same address is refused although the phone numbers are new...
    await expect(limiter.reserve('10.0.0.1', '0933333333')).rejects.toMatchObject({ code: 'ACCOUNT_DELETE_RATE_LIMITED' });
    // ... another address is fine, until the PHONE budget (5) is spent from many addresses.
    for (let n = 0; n < 5; n += 1) {
      await limiter.reserve(`10.0.1.${n}`, '0944444444');
    }
    await expect(limiter.reserve('10.0.2.1', '0944444444')).rejects.toMatchObject({ code: 'ACCOUNT_DELETE_RATE_LIMITED' });
  });

  it('one generic answer for an unknown phone, a wrong password, a fixture account and an account locked for a violation, with the same counter writes', async () => {
    const wrong = await customer();
    const violation = await customer();
    await app.pool.query(`UPDATE app.users SET status = 'DISABLED', lock_reason = 'VIOLATION', locked_at = now(), version = version + 1 WHERE user_id = $1::uuid`, [violation.userId]);
    const fixture = await customer();
    await app.pool.query(`UPDATE app.users SET account_origin = 'STAGING_FIXTURE', phone_verified_at = NULL WHERE user_id = $1::uuid`, [fixture.userId]);
    const unknown = { local: '0987654321' };

    const answers: Array<{ status: number; code: string | undefined; message: string | undefined; delta: number }> = [];
    for (const [phone, password] of [
      [unknown, PASSWORD],
      [wrong.phone, 'Wrong-Password-1'],
      [fixture.phone, PASSWORD],
      [violation.phone, PASSWORD],
    ] as const) {
      const before = await attemptsTotal();
      const response = await confirm(phone, password);
      answers.push({ status: response.status, code: errorCode(response), message: response.body.error?.message, delta: (await attemptsTotal()) - before });
    }
    // Same status, same code, same message, and exactly two counter increments (address + phone) for every one of them.
    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
    expect(answers[0]).toEqual({ status: 401, code: 'INVALID_CREDENTIALS', message: 'The phone number or password is not correct', delta: 2 });
    // A violation lock is not undone, purged or even reported: the row is exactly as it was.
    expect(await userRow(violation.userId)).toMatchObject({ status: 'DISABLED', lock_reason: 'VIOLATION', pending: false });
  });

  it('refuses malformed input before the budget is touched, and a browser from another origin before anything is read', async () => {
    const c = await customer();
    expect((await app.call('POST', '/account-deletion/confirm', { headers: { 'idempotency-key': randomUUID() }, body: { phone: c.phone.local, password: PASSWORD, role: 'ADMIN' } })).status).toBe(400);
    expect((await app.call('POST', '/account-deletion/confirm', { headers: { 'idempotency-key': randomUUID() }, body: { phone: c.phone.local } })).status).toBe(400);
    expect((await confirm(c.phone, PASSWORD, null)).status).toBe(400);
    expect(await attemptsTotal()).toBe(0);
    expect(refused(await confirm(c.phone, PASSWORD, randomUUID(), { origin: 'https://evil.example.test' }))).toMatchObject({ status: 403 });
    expect(await attemptsTotal()).toBe(0);
    // The configured origin passes (here the wrong password answers the generic error), and so does a client that sends no Origin at all.
    expect(refused(await confirm(c.phone, 'Wrong-Password-1', randomUUID(), { origin: PUBLIC_ORIGIN }))).toEqual({ status: 401, code: 'INVALID_CREDENTIALS' });
    expect(await userRow(c.userId)).toMatchObject({ status: 'ACTIVE', pending: false });
  });

  // ---- the immediate outcomes ----------------------------------------------------------------------------------------------------

  it('nothing in progress and nothing to keep: the account is deleted for good at once, and the same Idempotency-Key answers again without a second effect', async () => {
    const c = await customer();
    expect((await me(c.token)).status).toBe(200);
    const key = randomUUID();
    const first = await confirm(c.phone, PASSWORD, key);
    expect([first.status, resultOf(first), first.headers.get('cache-control')]).toEqual([200, 'DELETED', 'no-store']);
    expect(await userRow(c.userId)).toBeUndefined();
    expect((await me(c.token)).status).toBe(401);
    expect(await audits('account.delete.finalized.v1', c.userId)).toBe(1);
    expect(await countRows(app.pool, `SELECT 1 FROM app.outbox_events WHERE event_type = 'user.account.deleted.v1' AND resource_id = $1`, [c.userId])).toBe(1);
    // The response was "lost": the retry with the same key gets the stored answer although the account no longer exists.
    const retry = await confirm(c.phone, PASSWORD, key);
    expect([retry.status, resultOf(retry)]).toEqual([200, 'DELETED']);
    expect(await audits('account.delete.finalized.v1', c.userId)).toBe(1);
    // Another key finds no account: the same generic error as an unknown phone, never "already deleted".
    expect(refused(await confirm(c.phone))).toEqual({ status: 401, code: 'INVALID_CREDENTIALS' });
    // The same key with ANOTHER password is not a replay of anything.
    expect((await confirm(c.phone, 'Other-Password-77', key)).status).not.toBe(200);
    expect(await login(c.phone)).toMatchObject({ status: 401 });
  });

  it('data that must be kept and nothing in progress: the account is locked with reason DELETE_REQUEST, every session revoked, the data stays', async () => {
    const c = await customer();
    const orderId = await insertOrder(c.userId, shop.shopId, 'COMPLETED');
    const key = randomUUID();
    const done = await confirm(c.phone, PASSWORD, key);
    expect([done.status, resultOf(done)]).toEqual([200, 'LOCKED']);
    expect(await userRow(c.userId)).toMatchObject({ status: 'DISABLED', lock_reason: 'DELETE_REQUEST', pending: false });
    expect(await liveSessions(c.userId)).toBe(0);
    expect((await me(c.token)).status).toBe(401);
    expect(await countRows(app.pool, 'SELECT 1 FROM app.orders WHERE order_id = $1::uuid', [orderId])).toBe(1);
    expect(await countRows(app.pool, `SELECT 1 FROM app.user_roles WHERE user_id = $1::uuid`, [c.userId])).toBeGreaterThan(0);
    expect(await audits('account.delete.finalized.v1', c.userId)).toBe(1);
    // A retry (same key, or a new one) is answered; nothing is written twice.
    expect(resultOf(await confirm(c.phone, PASSWORD, key))).toBe('LOCKED');
    expect(resultOf(await confirm(c.phone))).toBe('LOCKED');
    expect(await audits('account.delete.finalized.v1', c.userId)).toBe(1);
  });

  // ---- pending ------------------------------------------------------------------------------------------------------------------

  it('work in progress: PENDING at once; the session stays, NEW work is refused at every entry, the running work can still be finished', async () => {
    const c = await customer();
    // A real order, placed through the API, still waiting for the shop.
    const placed = await placeOrder(c);
    expect(placed.status).toBe(201);
    const orderId = String(dataOf(placed).order_id);
    const key = randomUUID();
    const done = await confirm(c.phone, PASSWORD, key);
    expect([done.status, resultOf(done)]).toEqual([200, 'PENDING']);
    expect(await userRow(c.userId)).toMatchObject({ status: 'ACTIVE', lock_reason: null, pending: true });
    expect(await audits('account.delete.requested.v1', c.userId)).toBe(1);
    expect(await audits('account.delete.finalized.v1', c.userId)).toBe(0);
    // The session is NOT revoked: the owner finishes the running work.
    expect((await me(c.token)).status).toBe(200);
    expect(await liveSessions(c.userId)).toBeGreaterThan(0);

    // NEW work: refused (the same word everywhere).
    expect(refused(await placeOrder(c))).toEqual({ status: 409, code: 'ACCOUNT_DELETE_PENDING' });
    expect(refused(await app.call('POST', `/customers/me/orders/${orderId}/reorder`, { bearer: c.token, headers: { 'idempotency-key': randomUUID() }, body: {} }))).toEqual({ status: 409, code: 'ACCOUNT_DELETE_PENDING' });
    expect(
      refused(
        await app.call('POST', '/customers/me/deliveries', {
          bearer: c.token,
          headers: { 'idempotency-key': randomUUID() },
          body: { recipient_name: 'An', recipient_phone: '0912345678', dropoff_address_text: '12 Phố Huế', goods_description: 'Hộp quà', pickup_address_text: '5 Phố Cổ', agreed_fee: { amount_vnd: 20_000 } },
        }),
      ),
    ).toEqual({ status: 409, code: 'ACCOUNT_DELETE_PENDING' });
    // A retry of the same confirmation is answered PENDING again, with no second audit entry.
    expect(resultOf(await confirm(c.phone, PASSWORD, key))).toBe('PENDING');
    expect(resultOf(await confirm(c.phone))).toBe('PENDING');
    expect(await audits('account.delete.requested.v1', c.userId)).toBe(1);

    // The RUNNING work is finished normally: the shop confirms the order of the pending customer, the customer can still read it.
    const shopView = await app.call('GET', `/shop/me/orders/${orderId}`, { bearer: shop.token });
    expect(shopView.status).toBe(200);
    const confirmed = await app.call('POST', `/shop/me/orders/${orderId}/confirm`, { bearer: shop.token, headers: { 'idempotency-key': randomUUID() }, body: { expected_version: dataOf(shopView).version } });
    expect(confirmed.status).toBe(200);
    expect((await app.call('GET', `/customers/me/orders/${orderId}`, { bearer: c.token })).status).toBe(200);
    // Still pending: the order is being prepared. Nothing finalizes it behind our back.
    expect(await sweeper().sweep()).toMatchObject({ failed: 0 });
    expect(await userRow(c.userId)).toMatchObject({ status: 'ACTIVE', pending: true });
  });

  it('the account of a pending SHOP OWNER takes no new orders, starts no delivery of its own; its existing orders are finished normally', async () => {
    const owner = await createShopOwner(app);
    extraShops.push(owner.shopId);
    extraUsers.push(owner.userId);
    await openAllWeek(app, owner.shopId);
    const ownerDish = await newDish(app, owner.token, 'Bún chả', 40_000);
    const buyer = await customer();
    const earlier = await placeOrder(buyer, checkoutBody(owner.shopId, ownerDish));
    expect(earlier.status).toBe(201);
    const earlierId = String(dataOf(earlier).order_id);
    await markPending(owner.userId);

    // Another customer cannot order from the shop any more (it reads like a locked owner) ...
    const other = await customer();
    expect(refused(await placeOrder(other, checkoutBody(owner.shopId, ownerDish)))).toEqual({ status: 409, code: 'ORDER_SHOP_NOT_OPEN' });
    // ... the shop cannot recall a delivery or open a payment request ...
    const recallable = await insertDeliveryRow(app.pool, { shopId: owner.shopId, userId: owner.userId });
    // (A shop-created DIRECT delivery cannot be recalled at all since OD-5; the gate is reached by an order-linked one.)
    await app.pool.query('ALTER TABLE app.deliveries DISABLE TRIGGER USER');
    await app.pool.query("UPDATE app.deliveries SET source = 'ORDER', order_id = $1::uuid WHERE delivery_id = $2::uuid", [earlierId, recallable]);
    await app.pool.query('ALTER TABLE app.deliveries ENABLE TRIGGER USER');
    expect(refused(await app.call('POST', `/shop/me/deliveries/${recallable}/recall`, { bearer: owner.token, headers: { 'idempotency-key': randomUUID() }, body: {} }))).toEqual({ status: 409, code: 'ACCOUNT_DELETE_PENDING' });
    // (The shop payment request route is wired with the Administration routes, not in this application: its gate is pinned by new-work-gate.spec.ts.)
    // ... but the order it already has is confirmed and read as usual.
    const view = await app.call('GET', `/shop/me/orders/${earlierId}`, { bearer: owner.token });
    expect(view.status).toBe(200);
    expect((await app.call('POST', `/shop/me/orders/${earlierId}/confirm`, { bearer: owner.token, headers: { 'idempotency-key': randomUUID() }, body: { expected_version: dataOf(view).version } })).status).toBe(200);
  });

  it('the account of a pending SHIPPER is offered nothing, takes no delivery, opens no top-up or withdrawal; a new role is not started', async () => {
    const shipper: Shipper = await newShipper(app, drivers);
    extraUsers.push(shipper.userId);
    const waiting = await insertDeliveryRow(app.pool, { shopId: shop.shopId, userId: shop.userId });
    await markPending(shipper.userId);

    const offers = await app.call('GET', '/driver/deliveries/offers', { bearer: shipper.token });
    expect([offers.status, dataOf(offers).offers]).toEqual([200, []]);
    expect(refused(await app.call('POST', `/driver/deliveries/${waiting}/accept`, { bearer: shipper.token, headers: { 'idempotency-key': randomUUID() }, body: {} }))).toEqual({ status: 409, code: 'ACCOUNT_DELETE_PENDING' });
    expect(refused(await app.call('POST', '/driver/wallet/topup-requests', { bearer: shipper.token, headers: { 'idempotency-key': randomUUID() }, body: { amount_vnd: 100_000 } }))).toEqual({ status: 409, code: 'ACCOUNT_DELETE_PENDING' });
    expect(refused(await app.call('POST', '/driver/wallet/withdrawals', { bearer: shipper.token, headers: { 'idempotency-key': randomUUID() }, body: { amount_vnd: 50_000 } }))).toEqual({ status: 409, code: 'ACCOUNT_DELETE_PENDING' });
    // The delivery stays free for everybody else.
    expect(await countRows(app.pool, `SELECT 1 FROM app.deliveries WHERE delivery_id = $1::uuid AND state = 'waiting_driver'`, [waiting])).toBe(1);

    // A pending account does not start a NEW role either.
    const fresh = await customer();
    const shipLogin = await app.call('POST', '/client-auth/login', { headers: { 'idempotency-key': randomUUID() }, body: { phone: fresh.phone.local, password: PASSWORD, device: { ...WEB_SHIP } } });
    expect(shipLogin.status).toBe(200);
    const shipToken = String(dataOf(shipLogin).access_token);
    await markPending(fresh.userId);
    expect(refused(await app.call('POST', '/onboarding/driver', { bearer: shipToken, headers: { 'idempotency-key': randomUUID() }, body: { full_name: 'Nguyễn Văn An', plate_number: '59X1-123.45' } }))).toEqual({ status: 409, code: 'ACCOUNT_DELETE_PENDING' });
    expect(await countRows(app.pool, 'SELECT 1 FROM app.drivers WHERE user_id = $1::uuid', [fresh.userId])).toBe(0);
  });

  // ---- the sweeper ----------------------------------------------------------------------------------------------------------------

  it('the sweeper leaves a pending request alone while work is in progress and finishes it exactly once when the work is over', async () => {
    const c = await customer();
    const orderId = await insertOrder(c.userId, shop.shopId, 'PREPARING');
    expect(resultOf(await confirm(c.phone))).toBe('PENDING');
    const version = (await userRow(c.userId))?.version;

    expect(await sweeper().sweep()).toMatchObject({ failed: 0 });
    expect(await userRow(c.userId)).toMatchObject({ status: 'ACTIVE', pending: true, version });
    expect(await audits('account.delete.finalized.v1', c.userId)).toBe(0);
    expect((await me(c.token)).status).toBe(200);

    await finishOrder(orderId);
    expect(await sweeper().sweep()).toMatchObject({ failed: 0 });
    expect(await userRow(c.userId)).toMatchObject({ status: 'DISABLED', lock_reason: 'DELETE_REQUEST', pending: false });
    expect(await liveSessions(c.userId)).toBe(0);
    expect((await me(c.token)).status).toBe(401);
    expect(await audits('account.delete.finalized.v1', c.userId)).toBe(1);
    expect(await countRows(app.pool, `SELECT 1 FROM app.outbox_events WHERE event_type = 'user.account.locked.v1' AND resource_id = $1`, [c.userId])).toBe(1);
    const finalizedAudit = await app.pool.query<{ actor_type: string; metadata: { trigger: string; result: string } }>(
      `SELECT actor_type, metadata FROM app.audit_logs WHERE action = 'account.delete.finalized.v1' AND resource_id = $1`,
      [c.userId],
    );
    expect(finalizedAudit.rows[0]).toMatchObject({ actor_type: 'SYSTEM', metadata: { trigger: 'SWEEPER', result: 'LOCKED' } });

    // A second sweep finds nothing to do for this account.
    await sweeper().sweep();
    expect(await audits('account.delete.finalized.v1', c.userId)).toBe(1);
  });

  it('several sweeps at once (several instances) finalize a pending account exactly once', async () => {
    const accounts: Customer[] = [];
    for (let n = 0; n < 3; n += 1) {
      const c = await customer();
      const orderId = await insertOrder(c.userId, shop.shopId, 'PREPARING');
      expect(resultOf(await confirm(c.phone))).toBe('PENDING');
      await finishOrder(orderId);
      accounts.push(c);
    }
    const results = await Promise.all([sweeper().sweep(), sweeper().sweep(), sweeper().sweep()]);
    expect(results.reduce((sum, r) => sum + r.failed, 0)).toBe(0);
    expect(results.reduce((sum, r) => sum + r.finalized, 0)).toBeGreaterThanOrEqual(3);
    for (const c of accounts) {
      expect(await userRow(c.userId)).toMatchObject({ status: 'DISABLED', lock_reason: 'DELETE_REQUEST', pending: false });
      expect(await audits('account.delete.finalized.v1', c.userId)).toBe(1);
      expect(await countRows(app.pool, `SELECT 1 FROM app.outbox_events WHERE event_type = 'user.account.locked.v1' AND resource_id = $1`, [c.userId])).toBe(1);
    }
  });

  it('a pending account that has nothing left to keep is deleted for good by the sweeper', async () => {
    const c = await customer();
    // The only "work" is a cart-free, data-free account whose flag was set while something ran: nothing remains once it ended.
    await markPending(c.userId);
    await sweeper().sweep();
    expect(await userRow(c.userId)).toBeUndefined();
    expect(await audits('account.delete.finalized.v1', c.userId)).toBe(1);
  });

  // ---- races ----------------------------------------------------------------------------------------------------------------------

  /**
   * Plays a command that is IN FLIGHT on the account: it holds the user row FOR UPDATE (what every writer takes first). `inside` runs in that
   * transaction (the work it commits); `release` commits and lets the queued requests go. Always released, even when the test fails.
   */
  async function holdUserRow(userId: string): Promise<{ inside: (sql: string, values?: unknown[]) => Promise<unknown>; release: () => Promise<void> }> {
    const client = await app.pool.connect();
    let open = true;
    await client.query('BEGIN');
    await client.query('SELECT 1 FROM app.users WHERE user_id = $1::uuid FOR UPDATE', [userId]);
    return {
      inside: (sql, values) => client.query(sql, values),
      release: async () => {
        if (!open) return;
        open = false;
        try {
          await client.query('COMMIT');
        } finally {
          client.release();
        }
      },
    };
  }
  /** Waits until `count` requests are blocked on a user row lock (a command's lockById, or the shared read before it), in the order they were started. */
  async function waitForWaiters(count: number): Promise<void> {
    for (let attempt = 0; attempt < 800; attempt += 1) {
      if ((await rowLockWaitersRunning(app.pool, '%FROM app.users WHERE user_id = $1::uuid FOR %')) >= count) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('the requests did not queue behind the lock');
  }

  it('race: an order that commits just BEFORE the confirmation is work in progress (PENDING, never deleted or locked); the next order is refused', async () => {
    const c = await customer();
    const hold = await holdUserRow(c.userId);
    try {
      // The order of this customer is being committed (it holds the user row), the confirmation arrives meanwhile and queues behind it.
      const confirming = confirm(c.phone);
      await waitForWaiters(1);
      await hold.inside('ALTER TABLE app.orders DISABLE TRIGGER USER');
      await hold.inside(
        `INSERT INTO app.orders (order_id, code, client_ref, customer_user_id, shop_id, status, shop_name, shop_phone, shop_address_text, recipient_name, recipient_phone, address_text,
           items_original_total_vnd, items_total_vnd, created_at, updated_at)
         VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5::uuid, 'PENDING_CONFIRMATION', 'Quán thử', '0900000000', 'Số 1', 'Người nhận', '0912345678', 'Số 2', 50000, 50000, now(), now())`,
        [randomUUID(), `#R${randomUUID().slice(0, 6)}`, randomUUID(), c.userId, shop.shopId],
      );
      await hold.inside('ALTER TABLE app.orders ENABLE TRIGGER USER');
      await hold.release();
      const confirmation = await confirming;
      expect(resultOf(confirmation)).toBe('PENDING');
      expect(await userRow(c.userId)).toMatchObject({ status: 'ACTIVE', pending: true });
      expect(await countRows(app.pool, `SELECT 1 FROM app.orders WHERE customer_user_id = $1::uuid AND status = 'PENDING_CONFIRMATION'`, [c.userId])).toBe(1);
      // ... and from now on nothing new is accepted.
      expect(refused(await placeOrder(c))).toEqual({ status: 409, code: 'ACCOUNT_DELETE_PENDING' });
    } finally {
      await hold.release();
    }
  });

  it('race: an order attempted just AFTER the confirmation (queued behind it) is refused, and no order exists for the deleted account', async () => {
    const c = await customer();
    const hold = await holdUserRow(c.userId);
    try {
      const confirming = confirm(c.phone);
      await waitForWaiters(1);
      const placing = placeOrder(c);
      await waitForWaiters(2);
      await hold.release();
      const [confirmation, order] = await Promise.all([confirming, placing]);
      // Nothing was in progress when the confirmation ran, so the account was deleted for good; the late order finds no valid session.
      expect(resultOf(confirmation)).toBe('DELETED');
      expect(order.status).toBeGreaterThanOrEqual(400);
      expect(await userRow(c.userId)).toBeUndefined();
      expect(await countRows(app.pool, 'SELECT 1 FROM app.orders WHERE customer_user_id = $1::uuid', [c.userId])).toBe(0);
    } finally {
      await hold.release();
    }
  });

  it('race: the same confirmation sent twice at once (a retry) makes one effect and one audit entry', async () => {
    const c = await customer();
    await insertOrder(c.userId, shop.shopId, 'PREPARING');
    const key = randomUUID();
    const [a, b] = await Promise.all([confirm(c.phone, PASSWORD, key), confirm(c.phone, PASSWORD, key)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect([resultOf(a), resultOf(b)]).toEqual(['PENDING', 'PENDING']);
    expect(await audits('account.delete.requested.v1', c.userId)).toBe(1);
    expect((await userRow(c.userId))?.pending).toBe(true);
  });

  it('race (stress): a confirmation and an order at the same moment never leave an order of an account that was deleted or locked', async () => {
    for (let round = 0; round < 6; round += 1) {
      const c = await customer();
      const [order, confirmation] = await Promise.all([placeOrder(c), confirm(c.phone)]);
      const row = await userRow(c.userId);
      const orders = await countRows(app.pool, `SELECT 1 FROM app.orders WHERE customer_user_id = $1::uuid AND status IN ('PENDING_CONFIRMATION', 'PREPARING')`, [c.userId]);
      if (order.status === 201) {
        // The order exists, so the account must still be there, ACTIVE and waiting for it.
        expect(orders).toBe(1);
        expect(row).toMatchObject({ status: 'ACTIVE', pending: true });
        expect(resultOf(confirmation)).toBe('PENDING');
      } else {
        // The order lost: no order exists at all, whatever became of the account.
        expect(orders).toBe(0);
        expect(['DELETED', 'LOCKED', 'PENDING']).toContain(resultOf(confirmation));
      }
    }
  });

  // ---- the page ---------------------------------------------------------------------------------------------------------------------

  it('the page /delete-account is served from the backend origin with its own two assets, a strict CSP, the consequences before the button and no host name', async () => {
    const base = app.running.baseUrl;
    const page = await fetch(`${base}/delete-account`);
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(page.headers.get('cache-control')).toBe('no-store');
    expect(page.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    // The consequences are shown, and they come BEFORE the confirm button.
    for (const phrase of ['Không thể hủy sau khi xác nhận', 'đăng xuất', 'dữ liệu phải lưu', 'không nhận hoặc tạo được việc mới', 'Số dư ví']) {
      expect(html).toContain(phrase);
    }
    expect(html.indexOf('Hậu quả khi bạn xác nhận')).toBeLessThan(html.indexOf('id="submit"'));
    expect(html).toContain('id="ack" type="checkbox"');
    expect(html).not.toMatch(/https?:\/\//);
    const script = await fetch(`${base}/delete-account/app.js`);
    const js = await script.text();
    expect([script.status, script.headers.get('content-type')]).toEqual([200, 'text/javascript; charset=utf-8']);
    expect(js).toContain("fetch('/v1/account-deletion/confirm'");
    expect(js).not.toMatch(/https?:\/\//);
    const css = await fetch(`${base}/delete-account/app.css`);
    expect([css.status, css.headers.get('content-type')]).toEqual([200, 'text/css; charset=utf-8']);
    expect((await fetch(`${base}/delete-account/other`)).status).toBe(404);
  });

  it('the private wrong-method / unknown routes stay closed: no GET on the confirm route, no Admin route to cancel a request', async () => {
    expect((await app.call('GET', '/account-deletion/confirm')).status).toBe(404);
    expect((await app.call('POST', '/account-deletion/cancel', { body: {} })).status).toBe(404);
  });
});
