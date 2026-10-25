import { randomBytes, randomUUID } from 'node:crypto';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ADMIN_SESSION_COOKIE } from '../../apps/backend/src/admin-auth/admin-auth-constants';
import { OrderChatRetention } from '../../apps/backend/src/order-chat/order-chat-retention';
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

  // ---- #191: the conversation of an order, seen from the Administration -------------------------------------------------------

  const chatAsCustomer = (id: string, method: 'GET' | 'POST', body?: unknown): Promise<ApiResponse> => asCustomer(method, `/customers/me/orders/${id}/chat`, body);
  const backdate = async (table: 'orders' | 'order_chat_holds', column: string, key: string, id: string, days: number): Promise<void> => {
    const client = await app.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`ALTER TABLE app.${table} DISABLE TRIGGER USER`);
      await client.query(`UPDATE app.${table} SET ${column} = ${column} - make_interval(days => $2::int)${table === 'order_chat_holds' ? ', placed_at = placed_at - make_interval(days => $2::int + 2)' : ''} WHERE ${key} = $1::uuid`, [id, days]);
      await client.query(`ALTER TABLE app.${table} ENABLE TRIGGER USER`);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  };

  it('#191 chat: staff reach a conversation only with the current right to view the file; they can write while it is open, with their own label; SYSTEM too; an ended file is read-only', async () => {
    const order = await confirmedOrder();
    const id = String(order.order_id);
    expect((await chatAsCustomer(id, 'POST', { body: 'Cho mình hỏi thêm' })).status).toBe(201);
    const seen = adminJson(await adminGet(viewer, `/orders/${id}/chat`));
    expect((seen.items as Json[]).filter((i) => i.type === 'message').map((i) => i.body)).toEqual(['Cho mình hỏi thêm']);
    expect(seen.room).toMatchObject({ type: 'ORDER', open: true, can_send: true });
    expect(codeOf(await adminGet(outsider, `/orders/${id}/chat`))).toMatchObject({ status: 403, code: 'ADMIN_FORBIDDEN' });
    expect((await adminGet(undefined, `/orders/${id}/chat`)).status).toBe(401);
    expect(codeOf(await adminGet(viewer, `/orders/${randomUUID()}/chat`))).toMatchObject({ status: 404, code: 'ORDER_NOT_FOUND' });
    expect(codeOf(await adminPost(outsider, `/orders/${id}/chat`, { body: 'xin chào' }))).toMatchObject({ status: 403, code: 'ADMIN_FORBIDDEN' });
    // A write with the right: stored with the staff label, the customer reads it, a retry with the same key writes nothing.
    const key = randomUUID();
    expect((await adminPost(viewer, `/orders/${id}/chat`, { body: 'Bộ phận hỗ trợ đang xem đơn' }, { key })).status).toBe(201);
    expect((await adminPost(viewer, `/orders/${id}/chat`, { body: 'Bộ phận hỗ trợ đang xem đơn' }, { key })).status).toBe(201);
    expect((await adminPost(system.login, `/orders/${id}/chat`, { body: 'Hệ thống ghi nhận' })).status).toBe(201);
    const asCustomerView = dataOf(await chatAsCustomer(id, 'GET')) as Json;
    const staff = (asCustomerView.items as Json[]).filter((i) => i.type === 'message' && ['ADMIN', 'SYSTEM'].includes(String((i.sender as Json).role)));
    expect(staff.map((i) => [(i.sender as Json).role, (i.sender as Json).name, i.body])).toEqual([['ADMIN', 'Quản trị', 'Bộ phận hỗ trợ đang xem đơn'], ['SYSTEM', 'Hệ thống', 'Hệ thống ghi nhận']]);
    // The file ends: staff read, and cannot write any more.
    expect((await adminPost(locker, `/orders/${id}/actions/cancel-order`, { expected_version: order.version, reason: 'Quán đóng cửa' })).status).toBe(200);
    expect(codeOf(await adminPost(viewer, `/orders/${id}/chat`, { body: 'quá muộn' }))).toMatchObject({ status: 409, code: 'ORDER_CHAT_CLOSED' });
    const closed = adminJson(await adminGet(viewer, `/orders/${id}/chat`));
    expect(closed.room).toMatchObject({ open: false, can_send: false });
    expect((closed.items as Json[]).filter((i) => i.type === 'message')).toHaveLength(3);
  });

  it('#191 evidence hold: only SYSTEM or the review right place and release it (with a reason, audited); a held conversation is neither deleted nor expired, and counts 7 days again from the release', async () => {
    const order = await confirmedOrder();
    const id = String(order.order_id);
    expect((await chatAsCustomer(id, 'POST', { body: 'Bằng chứng cần giữ' })).status).toBe(201);
    expect((await adminPost(locker, `/orders/${id}/actions/cancel-order`, { expected_version: order.version, reason: 'Khiếu nại' })).status).toBe(200);
    // Who may: not a viewer, not an outsider; a reason is required; nothing else is accepted.
    expect(codeOf(await adminPost(viewer, `/orders/${id}/chat-hold/place`, { reason: 'Giữ chứng cứ' }))).toMatchObject({ status: 403, code: 'ADMIN_FORBIDDEN' });
    expect(codeOf(await adminPost(outsider, `/orders/${id}/chat-hold/place`, { reason: 'Giữ chứng cứ' })).status).toBe(403);
    expect((await adminPost(locker, `/orders/${id}/chat-hold/place`, {})).status).toBe(400);
    expect((await adminPost(locker, `/orders/${id}/chat-hold/place`, { reason: 'x' })).status).toBe(400);
    expect((await adminPost(locker, `/orders/${id}/chat-hold/place`, { reason: 'Giữ chứng cứ', extra: 1 })).status).toBe(400);
    expect((await adminPost(locker, `/orders/${id}/chat-hold/destroy`, { reason: 'Giữ chứng cứ' })).status).toBe(404);
    expect(adminJson(await adminGet(viewer, `/orders/${id}/chat-hold`))).toMatchObject({ held: false });
    const key = randomUUID();
    expect(adminJson(await adminPost(locker, `/orders/${id}/chat-hold/place`, { reason: 'Giữ chứng cứ khiếu nại' }, { key }))).toMatchObject({ held: true });
    expect((await adminPost(locker, `/orders/${id}/chat-hold/place`, { reason: 'Giữ chứng cứ khiếu nại' }, { key })).status).toBe(200);
    expect(codeOf(await adminPost(system.login, `/orders/${id}/chat-hold/place`, { reason: 'Giữ lần hai' }))).toMatchObject({ status: 409 });
    expect(adminJson(await adminGet(viewer, `/orders/${id}/chat-hold`))).toMatchObject({ held: true, reason: 'Giữ chứng cứ khiếu nại' });
    expect(await auditCount('admin.order_chat.hold.v1', id)).toBe(1);
    // Ten days after the close the conversation is still served and the job leaves it alone.
    await backdate('orders', 'ended_at', 'order_id', id, 10);
    const retention = app.running.app.get(OrderChatRetention);
    await retention.runOnce();
    expect(await storedMessages(id)).toBe(1);
    const held = dataOf(await chatAsCustomer(id, 'GET')) as Json;
    expect(held.room).toMatchObject({ expired: false, expires_at: null });
    expect((held.items as Json[]).filter((i) => i.type === 'message')).toHaveLength(1);
    // Released: the 7 days run from the release, not from the old close.
    expect(codeOf(await adminPost(viewer, `/orders/${id}/chat-hold/release`, { reason: 'Đã giải quyết' })).status).toBe(403);
    expect(adminJson(await adminPost(system.login, `/orders/${id}/chat-hold/release`, { reason: 'Đã giải quyết xong' }))).toMatchObject({ held: false });
    expect(codeOf(await adminPost(system.login, `/orders/${id}/chat-hold/release`, { reason: 'Lần hai' })).status).toBe(409);
    expect(await auditCount('admin.order_chat.release.v1', id)).toBe(1);
    await retention.runOnce();
    expect(await storedMessages(id)).toBe(1);
    expect(((dataOf(await chatAsCustomer(id, 'GET')) as Json).room as Json).expired).toBe(false);
    await backdate('order_chat_holds', 'released_at', 'order_id', id, 8);
    expect(((dataOf(await chatAsCustomer(id, 'GET')) as Json).room as Json).expired).toBe(true);
    await retention.runOnce();
    expect(await storedMessages(id)).toBe(0);
    // The hold rows and the audit stay.
    expect((await app.pool.query('SELECT 1 FROM app.order_chat_holds WHERE order_id = $1::uuid', [id])).rowCount).toBe(1);
  });

  it('#191 contact: the customer\'s order carries the shop\'s public contact while it runs and nothing once it ended', async () => {
    const order = await confirmedOrder();
    const id = String(order.order_id);
    const running = (dataOf(await asCustomer('GET', `/customers/me/orders/${id}`)) as Json).shop as Json;
    expect(running.contact).toMatchObject({ phone: expect.stringMatching(/^\+84[0-9]{9}$/u) });
    expect((await adminPost(locker, `/orders/${id}/actions/cancel-order`, { expected_version: order.version, reason: 'Hết hàng' })).status).toBe(200);
    expect(((dataOf(await asCustomer('GET', `/customers/me/orders/${id}`)) as Json).shop as Json).contact).toBeNull();
  });

  const storedMessages = async (id: string): Promise<number> => (await app.pool.query('SELECT 1 FROM app.order_chat_messages WHERE order_id = $1::uuid', [id])).rowCount ?? 0;
  const auditCount = async (action: string, id: string): Promise<number> => (await app.pool.query('SELECT 1 FROM app.audit_logs WHERE action = $1 AND resource_id = $2', [action, id])).rowCount ?? 0;

  it('#153: settings enforce permissions, validation, versions and idempotent audit history',async()=>{
    const path='/system-settings/order-timeouts';
    expect((await adminGet(undefined,path)).status).toBe(401);expect((await adminGet(viewer,path)).status).toBe(403);expect((await adminGet(outsider,path)).status).toBe(403);
    const original=adminJson(await adminGet(locker,path)),parameters={...original.parameters as Json,search_stop:25};
    expect((await adminPost(locker,path,{expected_version:original.version,parameters:{...parameters,pickup_warning:60,pickup_cancel:60}})).status).toBe(400);
    const key=randomUUID(),body={expected_version:original.version,parameters};
    try{
      const updated=await adminPost(locker,path,body,{key});expect(updated.status).toBe(200);expect(adminJson(updated).version).toBe(Number(original.version)+1);
      expect((await adminPost(locker,path,body,{key})).status).toBe(200);expect((await adminPost(locker,path,body)).status).toBe(409);expect((await adminGet(system.login,path)).status).toBe(200);
      const history=(await app.pool.query('SELECT old_values,new_values FROM app.order_timeout_policy_changes WHERE version=$1',[Number(original.version)+1])).rows;
      expect(history).toHaveLength(1);expect(history[0].new_values.search_stop).toBe(25);
      await expect(app.pool.query('DELETE FROM app.order_timeout_policy_changes WHERE version=$1',[Number(original.version)+1])).rejects.toThrow(/append-only/u);
    }finally{
      await app.pool.query('UPDATE app.order_timeout_policy SET parameters=$1::jsonb,updated_by=NULL,version=version+1 WHERE id',[JSON.stringify(original.parameters)]);
      const c=await app.pool.connect();try{await c.query('BEGIN');await c.query('ALTER TABLE app.order_timeout_policy_changes DISABLE TRIGGER timeout_policy_changes_immutable');await c.query('DELETE FROM app.order_timeout_policy_changes WHERE version=$1',[Number(original.version)+1]);await c.query('ALTER TABLE app.order_timeout_policy_changes ENABLE TRIGGER timeout_policy_changes_immutable');await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
    }
  });

});
