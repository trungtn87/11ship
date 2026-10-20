import { randomBytes, randomUUID } from 'node:crypto';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ADMIN_SESSION_COOKIE } from '../../apps/backend/src/admin-auth/admin-auth-constants';
import { M14_ROUTING } from '../../apps/backend/src/delivery/m14-route-client';
import { NotificationRuntime } from '../../apps/backend/src/notifications/notification-runtime';
import { ADMIN_PASSWORD, AdminApp, adminData, adminErrorCode, AdminResponse, cookieFrom, loginStep, preauthCookies, rewindAcceptedStep, sessionCookies, startAdminApp, totpNow } from './support/admin-fixtures';
import { begin, ok as activationOk, post } from './support/activation-fixtures';
import { ApiResponse, AuthApp, dataOf, Phone, randomPhone, startAuthApp } from './support/auth-fixtures';
import { cleanupOrders, Customer, Dish, Json, newCustomer, newDish, openAllWeek, PRIVACY, TERMS } from './support/m10-fixtures';
import { createInvitation, createPayload, systemSession, SystemSession } from './support/provisioning-fixtures';
import { createShopOwner, ShopOwner } from './support/shop-management-fixtures';

// M10.05 Administration web on a REAL pipeline and PostgreSQL: the list and the detail by right (view on SHOP or DRIVER), the two exception actions with their own
// rights (lock / review on DRIVER), a mandatory reason, the version check, the same-key replay, and the audit row. There is no route that sets a status.

const tag = randomBytes(3).toString('hex').toUpperCase();
const permission = (app: string, view: boolean, review: boolean, lock: boolean): Record<string, unknown> => ({ app, can_view: view, can_review_profile: review, can_lock: lock });

interface AdminLogin {
  readonly cookie: string;
  readonly csrf: string;
}
interface ActivatedAdmin {
  readonly phone: Phone;
  readonly userId: string;
  readonly secret: string;
}

describe('M10.05 — Admin orders', () => {
  let app: AuthApp;
  let admin: AdminApp;
  let router: http.Server;
  let system: SystemSession;
  let shop: ShopOwner;
  let customer: Customer;
  let pho: Dish;
  let viewer: AdminLogin;
  let locker: AdminLogin;
  let outsider: AdminLogin;
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
    admin = await startAdminApp({ activationDisabledTest: true });
    system = await systemSession(admin);
    shop = await createShopOwner(app);
    await openAllWeek(app, shop.shopId);
    customer = await newCustomer(app, 'Khách Admin');
    pho = await newDish(app, shop.token, 'Phở admin', 45_000);
    const existing = await app.pool.query('SELECT 1 FROM app.shipping_fee_policy_versions LIMIT 1');
    if ((existing.rowCount ?? 0) === 0) {
      await app.pool.query(
        `INSERT INTO app.shipping_fee_policy_versions (version_id, version_no, schema_version, tiers, applied_by, applied_at) VALUES ($1::uuid, 1, 2, $2::jsonb, $3::uuid, now())`,
        [randomUUID(), JSON.stringify([{ from_m: 0, to_m: 3000, fee_vnd: 10000 }, { from_m: 3000, to_m: 6000, fee_vnd: 15000 }, { from_m: 6000, to_m: 10000, fee_vnd: 20000 }]), shop.userId],
      );
      addedPolicy = true;
    }
    viewer = await login(await activatedAdmin([permission('SHOP', true, false, false)], `Xem đơn ${tag}`));
    locker = await login(await activatedAdmin([permission('DRIVER', true, true, true)], `Khóa đơn ${tag}`));
    outsider = await login(await activatedAdmin([permission('CUSTOMER', true, false, false)], `Ngoài ${tag}`));
  });

  afterAll(async () => {
    // Whatever the outbox still holds from this suite is consumed first, so it neither lands in an inbox after the accounts are gone nor sits in the queue for
    // the next suite.
    for (let pass = 0; pass < 200 && (await app.running.app.get(NotificationRuntime).dispatcher.dispatchOnce()).claimed > 0; pass += 1) {
      // drained
    }
    await cleanupOrders(app, { shopIds: [shop.shopId], customerIds: [customer.userId], drivers: [], userIds: [customer.userId, shop.userId], policyAdded: addedPolicy });
    await app.close();
    await admin.close();
    await new Promise<void>((resolve) => router.close(() => resolve()));
  });

  async function activatedAdmin(permissions: Record<string, unknown>[], fullName: string): Promise<ActivatedAdmin> {
    const phone = randomPhone();
    admin.track(phone.normalized);
    const invitation = await createInvitation(admin, system, createPayload(phone.local, { full_name: fullName, permissions }));
    const token = invitation.link.split('#t=')[1] as string;
    const session = await begin(admin, { invitationId: invitation.invitationId, token, phone });
    activationOk(await post(admin, '/password', session, { password: ADMIN_PASSWORD }));
    const secret = String(adminData(activationOk(await post(admin, '/totp/enrollment', session))).secret);
    activationOk(await post(admin, '/complete', session, { code: totpNow(secret) }));
    const found = await admin.pool.query<{ user_id: string }>('SELECT user_id FROM app.users WHERE phone_normalized = $1', [phone.normalized]);
    return { phone, userId: (found.rows[0] as { user_id: string }).user_id, secret };
  }

  async function login(who: ActivatedAdmin): Promise<AdminLogin> {
    const preauth = await loginStep(admin, { phone: who.phone, password: ADMIN_PASSWORD, userId: who.userId });
    await rewindAcceptedStep(admin, who.userId);
    const verified = await admin.call('POST', '/totp/verify', { body: { code: totpNow(who.secret) }, cookies: preauthCookies(preauth), csrf: preauth.csrf });
    if (verified.status !== 200) {
      throw new Error(`admin login failed: ${verified.status} ${verified.text}`);
    }
    return { cookie: String(cookieFrom(verified, ADMIN_SESSION_COOKIE)), csrf: String(adminData(verified).csrf_token) };
  }

  const adminGet = (who: AdminLogin | undefined, path: string): Promise<AdminResponse> => admin.call('GET', path, { basePath: '/v1/admin', ...(who === undefined ? {} : { cookies: sessionCookies(who) }) });
  async function adminPost(who: AdminLogin, path: string, body: unknown, options: { key?: string } = {}): Promise<AdminResponse> {
    await admin.clearLimits();
    return admin.call('POST', path, { basePath: '/v1/admin', body, cookies: sessionCookies(who), csrf: who.csrf, headers: { 'idempotency-key': options.key ?? randomUUID() } });
  }
  const codeOf = (r: AdminResponse): { status: number; code: string | undefined } => ({ status: r.status, code: adminErrorCode(r) });
  const adminJson = (r: AdminResponse): Json => adminData(r) as Json;

  const asCustomer = (method: 'GET' | 'POST', path: string, body?: unknown): Promise<ApiResponse> =>
    app.call(method, path, { bearer: customer.token, ...(method === 'POST' ? { headers: { 'idempotency-key': randomUUID() } } : {}), ...(body === undefined ? {} : { body }) });
  async function confirmedOrder(): Promise<Json> {
    const lines = [{ item_id: pho.itemId, quantity: 2, unit_price_vnd: 45_000 }];
    const placed = await asCustomer('POST', '/customers/me/orders', {
      client_ref: randomUUID(), shop_id: shop.shopId, lines, items_total_vnd: 90_000, recipient_name: 'Người nhận', recipient_phone: '0912345678', address: { address_text: '12 Phố Huế, Hà Nội', lat: 21.0, lng: 105.82 },
    });
    expect(placed.status).toBe(201);
    const order = dataOf(placed) as Json;
    const confirm = await app.call('POST', `/shop/me/orders/${String(order.order_id)}/confirm`, { bearer: shop.token, headers: { 'idempotency-key': randomUUID() }, body: { expected_version: order.version } });
    expect(confirm.status).toBe(200);
    return dataOf(confirm) as Json;
  }

  it('lists and reads orders only with a right to view the shop or the Shipper side; no session or no such right is refused', async () => {
    const order = await confirmedOrder();
    const id = String(order.order_id);
    const list = adminJson(await adminGet(viewer, '/orders?limit=50'));
    expect((list.items as Json[]).some((row) => row.order_id === id)).toBe(true);
    const detail = adminJson(await adminGet(viewer, `/orders/${id}`));
    expect(JSON.stringify(detail)).toContain(id);
    expect(codeOf(await adminGet(outsider, '/orders'))).toMatchObject({ status: 403, code: 'ADMIN_FORBIDDEN' });
    expect((await adminGet(undefined, '/orders')).status).toBe(401);
    expect(codeOf(await adminGet(viewer, `/orders/${randomUUID()}`))).toMatchObject({ status: 404, code: 'ORDER_NOT_FOUND' });
  });

  it('cancelling needs the lock right and a reason; a stale version is refused; the same key replays; the audit row is written; nothing sets a status', async () => {
    const order = await confirmedOrder();
    const id = String(order.order_id);
    const path = `/orders/${id}/actions/cancel-order`;
    expect(codeOf(await adminPost(viewer, path, { expected_version: order.version, reason: 'Quán đóng cửa' }))).toMatchObject({ status: 403, code: 'ADMIN_FORBIDDEN' });
    expect((await adminPost(locker, path, { expected_version: order.version })).status).toBe(400);
    expect((await adminPost(locker, path, { expected_version: order.version, reason: '   ' })).status).toBe(400);
    expect(codeOf(await adminPost(locker, path, { expected_version: Number(order.version) + 5, reason: 'x' }))).toMatchObject({ status: 409, code: 'VERSION_CONFLICT' });
    const key = randomUUID();
    const done = adminJson(await adminPost(locker, path, { expected_version: order.version, reason: 'Quán đóng cửa' }, { key }));
    expect(JSON.stringify(done)).toContain('CANCELLED_BY_SHOP');
    const row = (await app.pool.query('SELECT status, end_actor, end_reason FROM app.orders WHERE order_id = $1::uuid', [id])).rows[0] as Json;
    expect(row).toMatchObject({ status: 'CANCELLED_BY_SHOP', end_reason: 'Quán đóng cửa' });
    const replay = await adminPost(locker, path, { expected_version: order.version, reason: 'Quán đóng cửa' }, { key });
    expect(replay.status).toBe(200);
    // Ended: another action is not allowed, and there is no route that sets a status.
    expect(codeOf(await adminPost(locker, path, { expected_version: Number(order.version) + 1, reason: 'again' })).status).toBe(409);
    expect((await adminPost(locker, `/orders/${id}/actions/set-status`, { expected_version: 1, reason: 'x' })).status).toBeGreaterThanOrEqual(400);
    expect((await app.pool.query(`SELECT 1 FROM app.order_events WHERE order_id = $1::uuid AND type = 'order.cancelled_by_admin'`, [id])).rowCount).toBe(1);
  });

  it('"Không hoàn tất" is only for a failed delivery that is settled, and needs the review right: a plain running order is refused', async () => {
    const order = await confirmedOrder();
    const path = `/orders/${String(order.order_id)}/actions/close-not-completed`;
    expect(codeOf(await adminPost(viewer, path, { expected_version: order.version, reason: 'x' }))).toMatchObject({ status: 403, code: 'ADMIN_FORBIDDEN' });
    const refused = await adminPost(locker, path, { expected_version: order.version, reason: 'Giao thất bại, hàng đã về' });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect((await app.pool.query('SELECT status FROM app.orders WHERE order_id = $1::uuid', [order.order_id])).rows[0]).toMatchObject({ status: 'PREPARING' });
  });
});
