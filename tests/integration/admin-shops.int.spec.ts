import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Argon2idPasswordHasher } from '../../apps/backend/src/auth/password-hasher';
import {
  ADMIN_PASSWORD,
  AdminApp,
  adminData,
  adminErrorCode,
  AdminResponse,
  cookieFrom,
  count,
  loginStep,
  preauthCookies,
  rewindAcceptedStep,
  sessionCookies,
  startAdminApp,
  totpNow,
} from './support/admin-fixtures';
import { begin, ok, post } from './support/activation-fixtures';
import { ADMIN_SESSION_COOKIE } from '../../apps/backend/src/admin-auth/admin-auth-constants';
import { AuthApp, createActiveShopFor, createServiceArea, Phone, randomPhone } from './support/auth-fixtures';
import { cleanupOrders } from './support/m10-fixtures';
import { createInvitation, createPayload, systemSession, SystemSession } from './support/provisioning-fixtures';

// M02 shop management on the Administration web (API) against the real Nest pipeline and PostgreSQL: the rights (SYSTEM; an ADMIN with VIEW on SHOP reads, with
// the SHOP lock right also disables / enables; nobody else), the list (search, filters, pages, the counts of dishes), the detail, the menu (hidden dishes are
// seen by the administration only), the customer preview, the history, disable / enable (reason, version, audit, outbox, replay, orders untouched), and that the
// public API never shows what the administration shows.

const BASE = '/v1/admin';
const tag = randomBytes(3).toString('hex').toUpperCase();

interface AdminLogin {
  readonly cookie: string;
  readonly csrf: string;
}

interface ActivatedAdmin {
  readonly phone: Phone;
  readonly userId: string;
  readonly secret: string;
}

const row = (appName: string, view: boolean, lock = false): Record<string, unknown> => ({ app: appName, can_view: view, can_review_profile: false, can_lock: lock });

describe('admin shop management (API)', () => {
  let app: AdminApp;
  let system: SystemSession;
  let viewer: AdminLogin;
  let manager: AdminLogin;
  let manager2: AdminLogin;
  let customerAdmin: AdminLogin;
  const owners: string[] = [];
  const shops: string[] = [];
  const areas: string[] = [];
  const categories: string[] = [];
  let areaA = '';
  let areaB = '';
  let alpha = { shopId: '', ownerId: '', phone: '' };
  let beta = { shopId: '', ownerId: '', phone: '' };
  let gamma = { shopId: '', ownerId: '', phone: '' };
  let draft = { shopId: '', ownerId: '', phone: '' };
  let groupFood = '';
  let groupDrink = '';
  let hiddenItem = '';

  async function activatedAdmin(permissions: Record<string, unknown>[], fullName: string): Promise<ActivatedAdmin> {
    const phone = randomPhone();
    app.track(phone.normalized);
    const invitation = await createInvitation(app, system, createPayload(phone.local, { full_name: fullName, permissions }));
    const token = invitation.link.split('#t=')[1] as string;
    const session = await begin(app, { invitationId: invitation.invitationId, token, phone });
    ok(await post(app, '/password', session, { password: ADMIN_PASSWORD }));
    const secret = String(adminData(ok(await post(app, '/totp/enrollment', session))).secret);
    ok(await post(app, '/complete', session, { code: totpNow(secret) }));
    const found = await app.pool.query<{ user_id: string }>('SELECT user_id FROM app.users WHERE phone_normalized = $1', [phone.normalized]);
    return { phone, userId: (found.rows[0] as { user_id: string }).user_id, secret };
  }

  async function login(who: ActivatedAdmin): Promise<AdminLogin> {
    const preauth = await loginStep(app, { phone: who.phone, password: ADMIN_PASSWORD, userId: who.userId });
    await rewindAcceptedStep(app, who.userId);
    const verified = await app.call('POST', '/totp/verify', { body: { code: totpNow(who.secret) }, cookies: preauthCookies(preauth), csrf: preauth.csrf });
    if (verified.status !== 200) {
      throw new Error(`admin login failed: ${verified.status} ${verified.text}`);
    }
    return { cookie: String(cookieFrom(verified, ADMIN_SESSION_COOKIE)), csrf: String(adminData(verified).csrf_token) };
  }

  const systemLogin = (): AdminLogin => ({ cookie: system.login.cookie, csrf: system.login.csrf });
  const read = (who: AdminLogin | undefined, path: string): Promise<AdminResponse> => app.call('GET', path, { basePath: BASE, ...(who === undefined ? {} : { cookies: sessionCookies(who) }) });
  const codeOf = (response: AdminResponse): { status: number; code: string | undefined } => ({ status: response.status, code: adminErrorCode(response) });

  const write = async (who: AdminLogin, path: string, body: unknown, options: { key?: string | null; csrf?: string | null } = {}): Promise<AdminResponse> => {
    await app.clearLimits();
    const key = options.key === undefined ? randomUUID() : options.key;
    return app.call('POST', path, {
      basePath: BASE,
      body,
      cookies: sessionCookies(who),
      ...(options.csrf === null ? {} : { csrf: options.csrf ?? who.csrf }),
      ...(key === null ? {} : { headers: { 'idempotency-key': key } }),
    });
  };

  async function newShop(label: string, areaId: string): Promise<{ shopId: string; ownerId: string; phone: string }> {
    const phone = randomPhone();
    app.track(phone.normalized);
    const ownerId = randomUUID();
    await app.pool.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
       VALUES ($1::uuid, $2, $3, clock_timestamp(), 'PHONE_VERIFIED', 'ACTIVE', 1, clock_timestamp(), clock_timestamp())`,
      [ownerId, phone.normalized, await new Argon2idPasswordHasher().hash(ADMIN_PASSWORD)],
    );
    owners.push(ownerId);
    const shopId = await createActiveShopFor(app.pool, ownerId, areaId);
    shops.push(shopId);
    await app.pool.query(`UPDATE app.shops SET name = $2, address_text = $3, contact_phone_normalized = '+84911000222' WHERE shop_id = $1::uuid`, [shopId, `${label} ${tag}`, `Số 9 phố ${label}, Cao Bằng`]);
    return { shopId, ownerId, phone: phone.normalized };
  }

  async function addItem(shopId: string, categoryId: string, name: string, price: number, status: 'VISIBLE' | 'HIDDEN' | 'DELETED'): Promise<string> {
    const itemId = randomUUID();
    await app.pool.query(
      `INSERT INTO app.menu_items (item_id, shop_id, category_id, name, price_vnd, status, version, created_at, updated_at, deleted_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, 1, clock_timestamp(), clock_timestamp(), CASE WHEN $6 = 'DELETED' THEN clock_timestamp() END)`,
      [itemId, shopId, categoryId, name, price, status],
    );
    return itemId;
  }

  async function addGroup(name: string, status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE'): Promise<string> {
    const categoryId = randomUUID();
    await app.pool.query(`INSERT INTO app.menu_categories (category_id, name, status, sort_order, version, created_at, updated_at) VALUES ($1::uuid, $2, $3, 0, 1, clock_timestamp(), clock_timestamp())`, [categoryId, name, status]);
    categories.push(categoryId);
    return categoryId;
  }

  /** A waiting order of the shop (written straight to the table the way the order suites do; the order routes have their own suites). */
  async function addOrder(shopId: string, status: 'PENDING_CONFIRMATION' | 'PREPARING', customerId: string): Promise<{ orderId: string; version: number }> {
    const orderId = randomUUID();
    const client = await app.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE app.orders DISABLE TRIGGER USER');
      await client.query(
        `INSERT INTO app.orders (order_id, code, client_ref, customer_user_id, shop_id, status, shop_name, shop_phone, shop_address_text, recipient_name, recipient_phone, address_text,
           items_original_total_vnd, items_total_vnd, confirmed_at, created_at, updated_at)
         VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5::uuid, $6::varchar, 'Quán thử', '0900000000', 'Số 1', 'Người nhận', '0912345678', 'Số 2', 50000, 50000,
           CASE WHEN $6::varchar = 'PREPARING' THEN now() END, now(), now())`,
        [orderId, `#${tag}${orderId.slice(0, 4)}`, randomUUID(), customerId, shopId, status],
      );
      await client.query('ALTER TABLE app.orders ENABLE TRIGGER USER');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    return { orderId, version: 1 };
  }

  const shopRow = async (shopId: string): Promise<{ status: string; version: number; name: string; lat: number | null }> => {
    const result = await app.pool.query<{ status: string; version: string; name: string; pickup_lat: number | null }>('SELECT status, version::text AS version, name, pickup_lat FROM app.shops WHERE shop_id = $1::uuid', [shopId]);
    const found = result.rows[0] as { status: string; version: string; name: string; pickup_lat: number | null };
    return { status: found.status, version: Number(found.version), name: found.name, lat: found.pickup_lat };
  };
  const audits = (shopId: string, action: string): Promise<number> => count(app.pool, 'SELECT 1 FROM app.audit_logs WHERE resource_id = $1 AND action = $2', [shopId, action]);
  const events = (shopId: string, type: string): Promise<number> => count(app.pool, 'SELECT 1 FROM app.outbox_events WHERE resource_id = $1 AND event_type = $2', [shopId, type]);
  type Json = Record<string, unknown>;
  const items = (response: AdminResponse): Json[] => adminData(response).items as Json[];

  beforeAll(async () => {
    app = await startAdminApp({ activationDisabledTest: true });
    system = await systemSession(app);
    viewer = await login(await activatedAdmin([row('SHOP', true)], `Quản trị xem quán ${tag}`));
    manager = await login(await activatedAdmin([row('SHOP', true, true)], `Quản trị quán ${tag}`));
    manager2 = await login(await activatedAdmin([row('SHOP', true, true)], `Quản trị quán hai ${tag}`));
    customerAdmin = await login(await activatedAdmin([row('CUSTOMER', true)], `Quản trị Khách ${tag}`));
    areaA = await createServiceArea(app.pool);
    areaB = await createServiceArea(app.pool);
    areas.push(areaA, areaB);
    await app.pool.query(`UPDATE app.service_areas SET name = $2 WHERE service_area_id = $1::uuid`, [areaA, `Khu A ${tag}`]);
    await app.pool.query(`UPDATE app.service_areas SET name = $2 WHERE service_area_id = $1::uuid`, [areaB, `Khu B ${tag}`]);
    alpha = await newShop('Phở Ngon', areaA);
    beta = await newShop('Bún Chả', areaB);
    gamma = await newShop('Cơm Tấm', areaA);
    // A draft: an owner who has not finished the profile (no pickup point, no area).
    const draftPhone = randomPhone();
    app.track(draftPhone.normalized);
    const draftOwner = randomUUID();
    await app.pool.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
       VALUES ($1::uuid, $2, $3, clock_timestamp(), 'PHONE_VERIFIED', 'ACTIVE', 1, clock_timestamp(), clock_timestamp())`,
      [draftOwner, draftPhone.normalized, await new Argon2idPasswordHasher().hash(ADMIN_PASSWORD)],
    );
    owners.push(draftOwner);
    const draftShop = randomUUID();
    shops.push(draftShop);
    await app.pool.query(
      `INSERT INTO app.shops (shop_id, name, contact_phone_normalized, address_text, status, accepting_orders, version, created_at, updated_at)
       VALUES ($1::uuid, $2, '+84911000333', 'Nháp', 'INCOMPLETE', false, 1, clock_timestamp(), clock_timestamp())`,
      [draftShop, `Nháp ${tag}`],
    );
    await app.pool.query(`INSERT INTO app.shop_members (shop_id, user_id, member_role, created_at) VALUES ($1::uuid, $2::uuid, 'OWNER', clock_timestamp())`, [draftShop, draftOwner]);
    draft = { shopId: draftShop, ownerId: draftOwner, phone: draftPhone.normalized };
    // Schedules: alpha is open all week, beta has no schedule at all, gamma has a schedule that never contains "now" (a one-minute slot a week).
    await app.pool.query(`INSERT INTO app.shop_business_hours (shop_id, weekday, start_minute, end_minute, end_day_offset) SELECT $1::uuid, d, 0, 1440, 0 FROM generate_series(1, 7) d`, [alpha.shopId]);
    await app.pool.query(`INSERT INTO app.shop_business_hours (shop_id, weekday, start_minute, end_minute, end_day_offset) VALUES ($1::uuid, 1, 0, 1, 0)`, [gamma.shopId]);
    // Dishes: alpha has 2 visible, 1 hidden, 1 deleted; the groups include one that was switched off.
    groupFood = await addGroup(`Món chính ${tag}`);
    groupDrink = await addGroup(`Đồ uống ${tag}`, 'INACTIVE');
    await addItem(alpha.shopId, groupFood, `Phở bò ${tag}`, 45000, 'VISIBLE');
    await addItem(alpha.shopId, groupDrink, `Trà đá ${tag}`, 5000, 'VISIBLE');
    hiddenItem = await addItem(alpha.shopId, groupFood, `Phở đặc biệt ẩn ${tag}`, 60000, 'HIDDEN');
    await addItem(alpha.shopId, groupFood, `Món đã xóa ${tag}`, 10000, 'DELETED');
    await addItem(beta.shopId, groupFood, `Bún chả ${tag}`, 40000, 'VISIBLE');
  }, 300_000);

  afterAll(async () => {
    if (app !== undefined) {
      await cleanupOrders({ pool: app.pool } as AuthApp, { shopIds: shops, customerIds: [], drivers: [], userIds: [] });
      await app.pool.query('DELETE FROM app.menu_items WHERE shop_id = ANY($1::uuid[])', [shops]);
      await app.pool.query('DELETE FROM app.menu_categories WHERE category_id = ANY($1::uuid[])', [categories]);
      await app.close();
    }
  });

  it('rights: SYSTEM, and an ADMIN with VIEW on SHOP, read; only SYSTEM or the SHOP lock right writes; everyone else is refused by the backend', async () => {
    const id = alpha.shopId;
    for (const path of ['/shops', `/shops/${id}`, `/shops/${id}/menu`, `/shops/${id}/history`, `/shops/${id}/preview`]) {
      expect([path, (await read(systemLogin(), path)).status]).toEqual([path, 200]);
      expect([path, (await read(viewer, path)).status]).toEqual([path, 200]);
      expect([path, codeOf(await read(customerAdmin, path))]).toEqual([path, { status: 403, code: 'ADMIN_FORBIDDEN' }]);
      expect([path, codeOf(await read(undefined, path))]).toEqual([path, { status: 401, code: 'ADMIN_SESSION_INVALID' }]);
    }
    // The actions the page may offer follow the right, and the write itself is refused again.
    expect(adminData(await read(viewer, `/shops/${id}`)).allowed_actions).toEqual([]);
    expect(adminData(await read(manager, `/shops/${id}`)).allowed_actions).toEqual(['DISABLE']);
    expect(adminData(await read(systemLogin(), `/shops/${id}`)).allowed_actions).toEqual(['DISABLE']);
    const version = (await shopRow(id)).version;
    for (const who of [viewer, customerAdmin]) {
      expect(codeOf(await write(who, `/shops/${id}/disable`, { expected_version: version, reason: 'Thử' }))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    }
    expect(await shopRow(id)).toMatchObject({ status: 'ACTIVE', version });
    // Transport rules of every administration write.
    expect(codeOf(await write(manager, `/shops/${id}/disable`, { expected_version: version, reason: 'Thử' }, { csrf: null }))).toEqual({ status: 403, code: 'ADMIN_CSRF_INVALID' });
    expect((await write(manager, `/shops/${id}/disable`, { expected_version: version, reason: 'Thử' }, { key: null })).status).toBe(400);
    expect((await read(manager, '/shops/not-a-uuid')).status).toBe(400);
    expect(await shopRow(id)).toMatchObject({ status: 'ACTIVE', version });
  });

  it('list: search by name (marks or not), owner phone and shop code; filters; pages of 20; the counts of dishes; schedule state from the server', async () => {
    const found = async (query: string): Promise<string[]> => items(await read(viewer, `/shops?${query}`)).map((item) => String(item.shop_id)).sort();
    expect(await found(`q=${encodeURIComponent(`pho ngon ${tag}`)}`)).toEqual([alpha.shopId]);
    expect(await found(`q=${encodeURIComponent(`Phở Ngon ${tag}`)}`)).toEqual([alpha.shopId]);
    expect(await found(`q=${encodeURIComponent(beta.phone.slice(1))}`)).toEqual([beta.shopId]);
    expect(await found(`q=${encodeURIComponent(beta.phone.replace('+84', '0'))}`)).toEqual([beta.shopId]);
    expect(await found('q=%2B84911000222')).toContain(alpha.shopId);
    const code = String(adminData(await read(viewer, `/shops/${gamma.shopId}`)).code);
    expect(code).toMatch(/^K\d{2,}$/);
    expect(await found(`q=${code}`)).toContain(gamma.shopId);
    expect(await found(`q=${tag}`)).toEqual([alpha.shopId, beta.shopId, draft.shopId, gamma.shopId].sort());
    // Filters.
    expect(await found(`q=${tag}&area=${areaA}`)).toEqual([alpha.shopId, gamma.shopId].sort());
    expect(await found(`q=${tag}&profile=INCOMPLETE`)).toEqual([draft.shopId]);
    expect(await found(`q=${tag}&profile=ACTIVE&schedule=OPEN`)).toEqual([alpha.shopId]);
    expect(await found(`q=${tag}&schedule=CLOSED`)).toEqual([beta.shopId, draft.shopId, gamma.shopId].sort());
    expect(await found(`q=${tag}&profile=ALL&schedule=ALL&area=ALL`)).toHaveLength(4);
    // The row: profile status and schedule state are two different facts, both from the server.
    const rows = items(await read(viewer, `/shops?q=${tag}`));
    const alphaRow = rows.find((candidate) => candidate.shop_id === alpha.shopId) as Json;
    expect(alphaRow).toMatchObject({ name: `Phở Ngon ${tag}`, status: 'ACTIVE', items_visible: 2, items_total: 3, owner: { phone: alpha.phone, locked: false }, service_area: { name: `Khu A ${tag}` } });
    expect(alphaRow.availability).toMatchObject({ online: true, reason: 'ONLINE' });
    expect(rows.find((candidate) => candidate.shop_id === beta.shopId)?.availability).toMatchObject({ online: false, reason: 'NO_BUSINESS_HOURS' });
    expect(rows.find((candidate) => candidate.shop_id === gamma.shopId)?.availability).toMatchObject({ online: false, reason: 'OUTSIDE_BUSINESS_HOURS' });
    expect(rows.find((candidate) => candidate.shop_id === draft.shopId)?.availability).toMatchObject({ online: false, reason: 'SHOP_INCOMPLETE' });
    // Pages: 20 per page by default, `total` counts every match; a page past the end is empty with the right total.
    const bulk = Array.from({ length: 22 }, (_, index) => index);
    for (const index of bulk) {
      const extra = await newShop(`Quán trang ${String(index).padStart(2, '0')}`, areaB);
      await app.pool.query(`UPDATE app.shops SET name = $2 WHERE shop_id = $1::uuid`, [extra.shopId, `Trang ${tag} ${String(index).padStart(2, '0')}`]);
    }
    const first = adminData(await read(viewer, `/shops?q=${encodeURIComponent(`Trang ${tag}`)}`));
    expect(first).toMatchObject({ total: 22, limit: 20, offset: 0 });
    expect(first.items as unknown[]).toHaveLength(20);
    const second = adminData(await read(viewer, `/shops?q=${encodeURIComponent(`Trang ${tag}`)}&offset=20`));
    expect(second.items as unknown[]).toHaveLength(2);
    expect(adminData(await read(viewer, `/shops?q=${encodeURIComponent(`Trang ${tag}`)}&offset=40`))).toMatchObject({ total: 22, items: [] });
    expect((await read(viewer, '/shops?limit=0')).status).toBe(400);
    expect((await read(viewer, '/shops?profile=BOGUS')).status).toBe(400);
    expect((await read(viewer, '/shops?x=1')).status).toBe(400);
    // The area filter offers every area, active or not.
    expect((adminData(await read(viewer, '/shops?limit=1')).areas as { service_area_id: string }[]).map((area) => area.service_area_id)).toEqual(expect.arrayContaining([areaA, areaB]));
  });

  it('detail: profile, owner, areas, coordinates, schedule and counts; the list and the detail agree on the schedule state', async () => {
    const detail = adminData(await read(viewer, `/shops/${alpha.shopId}`));
    expect(detail).toMatchObject({
      shop_id: alpha.shopId,
      name: `Phở Ngon ${tag}`,
      status: 'ACTIVE',
      owner: { phone: alpha.phone, locked: false },
      profile: { contact_phone: '+84911000222', pickup_lat: 21, pickup_lng: 105.8, service_area: { name: `Khu A ${tag}`, status: 'ACTIVE' } },
      menu: { visible: 2, hidden: 1 },
      open_work: { orders_pending_confirmation: 0, orders_preparing: 0, active_deliveries: 0 },
      enable_blockers: [],
      timezone: 'Asia/Ho_Chi_Minh',
    });
    expect((detail.hours as unknown[]).length).toBe(7);
    expect(detail.availability).toMatchObject({ online: true, reason: 'ONLINE' });
    const gammaDetail = adminData(await read(viewer, `/shops/${gamma.shopId}`));
    expect(gammaDetail.availability).toMatchObject({ online: false, reason: 'OUTSIDE_BUSINESS_HOURS' });
    expect(gammaDetail.hours).toEqual([{ weekday: 1, start_minute: 0, end_minute: 1, end_day_offset: 0 }]);
    expect(codeOf(await read(viewer, `/shops/${randomUUID()}`))).toEqual({ status: 404, code: 'SHOP_NOT_FOUND' });
    // A locked owner account makes the schedule state read SHOP_DISABLED while the profile status stays ACTIVE (existing rule, shown as it is).
    await app.pool.query(`UPDATE app.users SET status = 'DISABLED' WHERE user_id = $1::uuid`, [beta.ownerId]);
    const locked = adminData(await read(viewer, `/shops/${beta.shopId}`));
    expect(locked).toMatchObject({ status: 'ACTIVE', owner: { locked: true }, availability: { online: false, reason: 'SHOP_DISABLED' } });
    expect(items(await read(viewer, `/shops?q=${encodeURIComponent(`Bún Chả ${tag}`)}&profile=ACTIVE`)).find((candidate) => candidate.shop_id === beta.shopId)?.availability).toMatchObject({ reason: 'SHOP_DISABLED' });
    await app.pool.query(`UPDATE app.users SET status = 'ACTIVE' WHERE user_id = $1::uuid`, [beta.ownerId]);
  });

  it('menu: the administration sees hidden dishes (never deleted ones) and groups that were switched off; filters work; the preview shows visible dishes only', async () => {
    const menu = adminData(await read(viewer, `/shops/${alpha.shopId}/menu`));
    const names = (menu.items as { name: string }[]).map((item) => item.name).sort();
    expect(names).toEqual([`Phở bò ${tag}`, `Phở đặc biệt ẩn ${tag}`, `Trà đá ${tag}`].sort());
    expect(menu.total).toBe(3);
    expect((menu.categories as { category_id: string; item_count: number }[]).find((group) => group.category_id === groupDrink)).toMatchObject({ status: 'INACTIVE', item_count: 1 });
    const hidden = adminData(await read(viewer, `/shops/${alpha.shopId}/menu?status=HIDDEN`));
    expect((hidden.items as { item_id: string }[]).map((item) => item.item_id)).toEqual([hiddenItem]);
    expect((adminData(await read(viewer, `/shops/${alpha.shopId}/menu?category=${groupDrink}`)).items as unknown[]).length).toBe(1);
    expect((adminData(await read(viewer, `/shops/${alpha.shopId}/menu?q=pho`)).items as unknown[]).length).toBe(2);
    expect((adminData(await read(viewer, `/shops/${alpha.shopId}/menu?limit=1&offset=1`)).items as unknown[]).length).toBe(1);
    // "Xem như khách": visible dishes only, grouped, no phone / Zalo / GPS, same data as the public view.
    const preview = adminData(await read(viewer, `/shops/${alpha.shopId}/preview`));
    expect(preview).toMatchObject({ visible_to_customers: true, name: `Phở Ngon ${tag}` });
    const previewNames = (preview.categories as { items: { name: string }[] }[]).flatMap((group) => group.items.map((item) => item.name)).sort();
    expect(previewNames).toEqual([`Phở bò ${tag}`, `Trà đá ${tag}`].sort());
    expect(JSON.stringify(preview)).not.toMatch(/pickup|contact_phone|zalo|facebook|911000222|"owner"/);
    const publicView = await app.call('GET', `/shops/${alpha.shopId}`, { basePath: '/v1' });
    expect(publicView.status).toBe(200);
    const publicNames = (adminData(publicView).categories as { items: { name: string }[] }[]).flatMap((group) => group.items.map((item) => item.name)).sort();
    expect(publicNames).toEqual(previewNames);
    // A draft, and a shop customers cannot see, get an honest "not visible" answer, not an invented preview.
    expect(adminData(await read(viewer, `/shops/${draft.shopId}/preview`))).toMatchObject({ visible_to_customers: false, reason: 'SHOP_INCOMPLETE' });
    expect(codeOf(await read(viewer, `/shops/${randomUUID()}/menu`))).toEqual({ status: 404, code: 'SHOP_NOT_FOUND' });
  });

  it('the public API never shows what the administration shows', async () => {
    const publicView = await app.call('GET', `/shops/${alpha.shopId}`, { basePath: '/v1' });
    const text = JSON.stringify(publicView.body);
    expect(text).not.toMatch(/911000222|pickup_|zalo|facebook|owner|HIDDEN|ẩn/);
    const publicAdmin = await app.call('GET', '/shops', { basePath: BASE });
    expect(publicAdmin.status).toBe(401);
  });

  it('disable: reason and version are mandatory, one audit row and one outbox event, nothing else changes (owner account, profile, schedule, dishes, running orders)', async () => {
    const id = alpha.shopId;
    const customer = owners[0] as string;
    const pending = await addOrder(id, 'PENDING_CONFIRMATION', customer);
    const preparing = await addOrder(id, 'PREPARING', customer);
    const before = await shopRow(id);
    const detail = adminData(await read(manager, `/shops/${id}`));
    expect(detail.open_work).toMatchObject({ orders_pending_confirmation: 1, orders_preparing: 1 });
    // Invalid bodies write nothing.
    for (const body of [{ expected_version: before.version }, { expected_version: before.version, reason: '' }, { expected_version: before.version, reason: '   ' }, { expected_version: before.version, reason: 'x'.repeat(501) }, { expected_version: 'one', reason: 'Lý do' }, { expected_version: before.version, reason: 'Lý do', status: 'ACTIVE' }]) {
      expect(codeOf(await write(manager, `/shops/${id}/disable`, body))).toEqual({ status: 400, code: 'ADMIN_INPUT_INVALID' });
    }
    expect(await shopRow(id)).toEqual(before);
    // A stale version is a conflict and writes nothing.
    expect(codeOf(await write(manager, `/shops/${id}/disable`, { expected_version: before.version + 5, reason: 'Lý do' }))).toEqual({ status: 409, code: 'VERSION_CONFLICT' });
    expect(await shopRow(id)).toEqual(before);
    // The command, with a reason of exactly 500 characters.
    const reason = 'Vi phạm quy định bán hàng. '.padEnd(500, 'x');
    const key = randomUUID();
    const done = await write(manager, `/shops/${id}/disable`, { expected_version: before.version, reason }, { key });
    expect(done.status).toBe(200);
    expect(adminData(done)).toMatchObject({ shop_id: id, status: 'DISABLED', version: before.version + 1, allowed_actions: ['ENABLE'], availability: { online: false, reason: 'SHOP_DISABLED' } });
    expect(await shopRow(id)).toMatchObject({ status: 'DISABLED', version: before.version + 1, name: before.name, lat: before.lat });
    expect(await audits(id, 'admin.shop.disable.v1')).toBe(1);
    expect(await events(id, 'shop.disabled_by_admin.v1')).toBe(1);
    const audit = await app.pool.query<{ metadata: Record<string, unknown>; actor_type: string; resource_version: string }>(
      `SELECT metadata, actor_type, resource_version::text AS resource_version FROM app.audit_logs WHERE resource_id = $1 AND action = 'admin.shop.disable.v1'`,
      [id],
    );
    expect(audit.rows[0]).toMatchObject({ actor_type: 'ADMIN', resource_version: String(before.version + 1) });
    expect(audit.rows[0]?.metadata).toMatchObject({ reason, from_status: 'ACTIVE', to_status: 'DISABLED', from_version: before.version, version: before.version + 1, open_orders: 2 });
    // The outbox payload carries no reason, no name and no phone.
    const outbox = await app.pool.query<{ payload: Record<string, unknown> }>(`SELECT payload FROM app.outbox_events WHERE resource_id = $1 AND event_type = 'shop.disabled_by_admin.v1'`, [id]);
    expect(outbox.rows[0]?.payload).toEqual({ shop_id: id, status: 'DISABLED', version: before.version + 1 });
    // Nothing else was touched: the owner account, the schedule, the dishes and the running orders keep their state.
    expect((await app.pool.query<{ status: string }>('SELECT status FROM app.users WHERE user_id = $1::uuid', [alpha.ownerId])).rows[0]?.status).toBe('ACTIVE');
    expect(await count(app.pool, 'SELECT 1 FROM app.shop_business_hours WHERE shop_id = $1::uuid', [id])).toBe(7);
    expect(await count(app.pool, `SELECT 1 FROM app.menu_items WHERE shop_id = $1::uuid AND status <> 'DELETED'`, [id])).toBe(3);
    const orders = await app.pool.query<{ order_id: string; status: string; version: string }>('SELECT order_id, status, version::text AS version FROM app.orders WHERE shop_id = $1::uuid ORDER BY status', [id]);
    expect(orders.rows.map((order) => [order.order_id, order.status, order.version]).sort()).toEqual([[pending.orderId, 'PENDING_CONFIRMATION', '1'], [preparing.orderId, 'PREPARING', '1']].sort());
    expect(adminData(await read(viewer, `/shops/${id}`)).open_work).toMatchObject({ orders_pending_confirmation: 1, orders_preparing: 1 });
    // A retry with the same key replays the stored answer: no second audit row, no second event, no new version.
    const replay = await write(manager, `/shops/${id}/disable`, { expected_version: before.version, reason }, { key });
    expect(replay.status).toBe(200);
    expect(adminData(replay).version).toBe(before.version + 1);
    expect(await audits(id, 'admin.shop.disable.v1')).toBe(1);
    expect(await shopRow(id)).toMatchObject({ version: before.version + 1 });
    // The same key from ANOTHER administrator is not a replay: it is a new request, refused because the version moved on.
    expect(codeOf(await write(manager2, `/shops/${id}/disable`, { expected_version: before.version, reason }, { key }))).toEqual({ status: 409, code: 'VERSION_CONFLICT' });
    // Disabling a shop that is already disabled (current version) is a state conflict, not a second change.
    expect(codeOf(await write(manager, `/shops/${id}/disable`, { expected_version: before.version + 1, reason: 'Lần hai' }))).toEqual({ status: 409, code: 'SHOP_STATE_CONFLICT' });
    // The shop is no longer public, and the administration still reads it with its dishes and history.
    expect((await app.call('GET', `/shops/${id}`, { basePath: '/v1' })).status).not.toBe(200);
    expect(adminData(await read(viewer, `/shops/${id}/preview`))).toMatchObject({ visible_to_customers: false, reason: 'SHOP_DISABLED' });
    expect((adminData(await read(viewer, `/shops/${id}/menu`)).items as unknown[]).length).toBe(3);
    const history = items(await read(viewer, `/shops/${id}/history`));
    expect(history[0]).toMatchObject({ action: 'admin.shop.disable.v1', version: before.version + 1, reason, from_status: 'ACTIVE', to_status: 'DISABLED', actor: { type: 'ADMIN', name: `Quản trị quán ${tag}` } });
    expect(JSON.stringify(history)).not.toContain(alpha.phone);
  });

  it('enable: the profile is checked again, nothing forces the shop open, the draft goes through the owner flow', async () => {
    const id = alpha.shopId;
    const current = await shopRow(id);
    expect(current.status).toBe('DISABLED');
    // Missing pickup point: refused with the exact blocker listed on the detail.
    await app.pool.query('UPDATE app.shops SET pickup_lat = NULL, pickup_lng = NULL WHERE shop_id = $1::uuid', [id]);
    expect(adminData(await read(manager, `/shops/${id}`)).enable_blockers).toEqual(['PICKUP_POINT_MISSING']);
    expect(codeOf(await write(manager, `/shops/${id}/enable`, { expected_version: current.version, reason: 'Mở lại' }))).toEqual({ status: 409, code: 'SHOP_PROFILE_INCOMPLETE' });
    await app.pool.query('UPDATE app.shops SET pickup_lat = 21.0, pickup_lng = 105.8 WHERE shop_id = $1::uuid', [id]);
    // An area that was switched off.
    await app.pool.query(`UPDATE app.service_areas SET status = 'INACTIVE' WHERE service_area_id = $1::uuid`, [areaA]);
    expect(adminData(await read(manager, `/shops/${id}`)).enable_blockers).toEqual(['SERVICE_AREA_INACTIVE']);
    expect(codeOf(await write(manager, `/shops/${id}/enable`, { expected_version: current.version, reason: 'Mở lại' }))).toEqual({ status: 400, code: 'INVALID_SERVICE_AREA' });
    await app.pool.query(`UPDATE app.service_areas SET status = 'ACTIVE' WHERE service_area_id = $1::uuid`, [areaA]);
    expect(await shopRow(id)).toMatchObject({ status: 'DISABLED', version: current.version });
    // A viewer cannot enable; the manager can. Make the schedule closed now to prove nothing forces it open.
    expect(codeOf(await write(viewer, `/shops/${id}/enable`, { expected_version: current.version, reason: 'Mở lại' }))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    await app.pool.query('DELETE FROM app.shop_business_hours WHERE shop_id = $1::uuid', [id]);
    const done = await write(manager, `/shops/${id}/enable`, { expected_version: current.version, reason: 'Đã khắc phục' });
    expect(done.status).toBe(200);
    expect(adminData(done)).toMatchObject({ status: 'ACTIVE', version: current.version + 1, allowed_actions: ['DISABLE'], availability: { online: false, reason: 'NO_BUSINESS_HOURS' } });
    expect(await audits(id, 'admin.shop.enable.v1')).toBe(1);
    expect(await events(id, 'shop.enabled_by_admin.v1')).toBe(1);
    const history = items(await read(viewer, `/shops/${id}/history`));
    expect(history.slice(0, 2).map((entry) => entry.action)).toEqual(['admin.shop.enable.v1', 'admin.shop.disable.v1']);
    expect(history[0]).toMatchObject({ reason: 'Đã khắc phục', from_status: 'DISABLED', to_status: 'ACTIVE' });
    // The draft is finished by its owner (onboarding), never by the administration.
    const draftVersion = (await shopRow(draft.shopId)).version;
    for (const name of ['disable', 'enable']) {
      expect(codeOf(await write(manager, `/shops/${draft.shopId}/${name}`, { expected_version: draftVersion, reason: 'Nháp' }))).toEqual({ status: 409, code: 'SHOP_STATE_CONFLICT' });
    }
    expect(adminData(await read(manager, `/shops/${draft.shopId}`)).allowed_actions).toEqual([]);
    expect(await shopRow(draft.shopId)).toMatchObject({ status: 'INCOMPLETE', version: draftVersion });
    // An unknown shop.
    expect(codeOf(await write(manager, `/shops/${randomUUID()}/disable`, { expected_version: 1, reason: 'Không có' }))).toEqual({ status: 404, code: 'SHOP_NOT_FOUND' });
  });

  it('two administrators disabling the same shop at once: exactly one wins, the other gets a conflict', async () => {
    const id = gamma.shopId;
    const version = (await shopRow(id)).version;
    const results = await Promise.all([
      write(manager, `/shops/${id}/disable`, { expected_version: version, reason: 'A' }),
      write(manager2, `/shops/${id}/disable`, { expected_version: version, reason: 'B' }),
    ]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await audits(id, 'admin.shop.disable.v1')).toBe(1);
    expect(await shopRow(id)).toMatchObject({ status: 'DISABLED', version: version + 1 });
  });
});
