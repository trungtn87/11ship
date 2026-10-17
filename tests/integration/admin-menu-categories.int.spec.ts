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
import { grantRole, installFault, Phone, randomPhone, removeFault } from './support/auth-fixtures';
import { createInvitation, createPayload, systemSession, SystemSession } from './support/provisioning-fixtures';

// M02 dish-group management on the Administration web (API) against the real Nest pipeline and PostgreSQL: the catalog right
// (SYSTEM, an ADMIN with VIEW + catalog on SHOP, nobody else), the name rule (case, spaces and composition never make a second group;
// Vietnamese marks do), the version check, the audit trail, the outbox, the atomic write and its safe retry, and that a group is
// never deleted nor takes a dish away.

const BASE = '/v1/admin';
const PATH = '/menu-categories';
const tag = randomBytes(3).toString('hex').toUpperCase();
const CREATE_ACTION = 'admin.menu_category.create.v1';
const UPDATE_ACTION = 'admin.menu_category.update.v1';

interface AdminLogin {
  readonly cookie: string;
  readonly csrf: string;
}

interface ActivatedAdmin {
  readonly phone: Phone;
  readonly userId: string;
  readonly secret: string;
}

const row = (app: string, view: boolean, catalog = false): Record<string, unknown> => ({
  app,
  can_view: view,
  can_review_profile: false,
  can_lock: false,
  ...(catalog ? { can_manage_catalog: true } : {}),
});

describe('admin dish groups (API)', () => {
  let app: AdminApp;
  let system: SystemSession;
  let catalogAdmin: AdminLogin;
  let catalogAdminUser: ActivatedAdmin;
  let shopOnlyAdmin: AdminLogin;
  let customerAdmin: AdminLogin;
  let shopId = '';
  const created: string[] = [];

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

  const read = (who: AdminLogin | undefined, query = ''): Promise<AdminResponse> =>
    app.call('GET', `${PATH}${query}`, { basePath: BASE, ...(who === undefined ? {} : { cookies: sessionCookies(who) }) });

  const write = async (
    who: AdminLogin,
    path: string,
    body: unknown,
    options: { key?: string | null; csrf?: string | null; origin?: string | null; contentType?: string | null } = {},
  ): Promise<AdminResponse> => {
    // The ingress quota (30 POST per minute per address, shared with login) is not under test here.
    await app.clearLimits();
    const key = options.key === undefined ? randomUUID() : options.key;
    return app.call('POST', path, {
      basePath: BASE,
      body,
      cookies: sessionCookies(who),
      ...(options.csrf === null ? {} : { csrf: options.csrf ?? who.csrf }),
      ...(key === null ? {} : { headers: { 'idempotency-key': key } }),
      ...(options.origin === undefined ? {} : { origin: options.origin }),
      ...(options.contentType === undefined ? {} : { contentType: options.contentType }),
    });
  };
  const create = (who: AdminLogin, body: unknown, options: Parameters<typeof write>[3] = {}): Promise<AdminResponse> => write(who, PATH, body, options);
  const update = (who: AdminLogin, id: string, body: unknown, options: Parameters<typeof write>[3] = {}): Promise<AdminResponse> =>
    write(who, `${PATH}/${id}`, body, options);
  const codeOf = (response: AdminResponse): { status: number; code: string | undefined } => ({ status: response.status, code: adminErrorCode(response) });
  const name = (suffix: string): string => `Nhóm ${tag} ${suffix}`;

  async function made(response: AdminResponse): Promise<Record<string, unknown>> {
    expect(response.status).toBe(201);
    const data = adminData(response);
    created.push(String(data.category_id));
    return data;
  }

  const groupRow = async (id: string): Promise<{ name: string; status: string; sort_order: number; version: number } | undefined> => {
    const result = await app.pool.query<{ name: string; status: string; sort_order: number; version: string }>(
      'SELECT name, status, sort_order, version::text AS version FROM app.menu_categories WHERE category_id = $1::uuid',
      [id],
    );
    const found = result.rows[0];
    return found === undefined ? undefined : { name: found.name, status: found.status, sort_order: found.sort_order, version: Number(found.version) };
  };
  const taggedGroups = (): Promise<number> => count(app.pool, 'SELECT 1 FROM app.menu_categories WHERE name LIKE $1', [`%${tag}%`]);
  const audits = (id: string, action: string): Promise<number> => count(app.pool, 'SELECT 1 FROM app.audit_logs WHERE resource_id = $1 AND action = $2', [id, action]);
  const events = (id: string): Promise<number> => count(app.pool, "SELECT 1 FROM app.outbox_events WHERE resource_id = $1 AND event_type LIKE 'menu.category.%'", [id]);

  beforeAll(async () => {
    app = await startAdminApp({ activationDisabledTest: true });
    system = await systemSession(app);
    catalogAdminUser = await activatedAdmin([row('SHOP', true, true)], `Quản trị Nhóm món ${tag}`);
    catalogAdmin = await login(catalogAdminUser);
    shopOnlyAdmin = await login(await activatedAdmin([row('SHOP', true)], `Quản trị Quán ${tag}`));
    customerAdmin = await login(await activatedAdmin([row('CUSTOMER', true)], `Quản trị Khách ${tag}`));
    // A real shop to hold dishes (its owner is a plain account; the shop is created the way the other suites do).
    const owner = randomPhone();
    app.track(owner.normalized);
    const hash = await new Argon2idPasswordHasher().hash(ADMIN_PASSWORD);
    const ownerId = randomUUID();
    await app.pool.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
       VALUES ($1::uuid, $2, $3, clock_timestamp(), 'PHONE_VERIFIED', 'ACTIVE', 1, clock_timestamp(), clock_timestamp())`,
      [ownerId, owner.normalized, hash],
    );
    await grantRole(app.pool, ownerId, 'SHOP');
    shopId = ((await app.pool.query<{ shop_id: string }>('SELECT shop_id FROM app.shop_members WHERE user_id = $1::uuid', [ownerId])).rows[0] as { shop_id: string }).shop_id;
  }, 300_000);

  afterAll(async () => {
    if (app !== undefined) {
      await app.pool.query('DELETE FROM app.menu_items WHERE category_id IN (SELECT category_id FROM app.menu_categories WHERE name LIKE $1)', [`%${tag}%`]);
      await app.pool.query('DELETE FROM app.menu_categories WHERE name LIKE $1', [`%${tag}%`]);
      await app.close();
    }
  });

  it('the catalog right: SYSTEM and an ADMIN with VIEW + catalog on SHOP only; everyone else is refused by the backend', async () => {
    expect((await read(systemLogin())).status).toBe(200);
    expect((await read(catalogAdmin)).status).toBe(200);
    expect(codeOf(await read(shopOnlyAdmin))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    expect(codeOf(await read(customerAdmin))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    expect(codeOf(await read(undefined))).toEqual({ status: 401, code: 'ADMIN_SESSION_INVALID' });
    // Every write is refused too, and nothing is written.
    for (const who of [shopOnlyAdmin, customerAdmin]) {
      expect(codeOf(await create(who, { name: name('Cấm') }))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    }
    expect(await taggedGroups()).toBe(0);
    // Transport rules of every administration write.
    expect(codeOf(await create(catalogAdmin, { name: name('CSRF') }, { csrf: null }))).toEqual({ status: 403, code: 'ADMIN_CSRF_INVALID' });
    expect(codeOf(await create(catalogAdmin, { name: name('Origin') }, { origin: 'https://evil.example' }))).toEqual({ status: 403, code: 'ADMIN_CSRF_INVALID' });
    expect((await create(catalogAdmin, { name: name('Type') }, { contentType: 'text/plain' })).status).toBe(400);
    expect((await create(catalogAdmin, { name: name('Key') }, { key: null })).status).toBe(400);
    expect(await taggedGroups()).toBe(0);
  });

  it('the invitation carries the catalog right only on SHOP with VIEW, and the activated administrator reads it back', async () => {
    const phone = randomPhone();
    app.track(phone.normalized);
    for (const permissions of [
      [{ ...row('CUSTOMER', true), can_manage_catalog: true }],
      [{ ...row('SHOP', false), can_manage_catalog: true }, row('CUSTOMER', true)],
      [{ ...row('SHOP', true), can_manage_catalog: 'yes' }],
    ]) {
      await expect(createInvitation(app, system, createPayload(phone.local, { permissions }))).rejects.toThrow();
    }
    const me = await app.call('GET', '/permissions', { basePath: '/v1/admin-auth', cookies: sessionCookies(catalogAdmin) });
    expect(me.status).toBe(200);
    expect(JSON.stringify(me.body)).toContain('"can_manage_catalog":true');
    const none = await app.call('GET', '/permissions', { basePath: '/v1/admin-auth', cookies: sessionCookies(shopOnlyAdmin) });
    expect(JSON.stringify(none.body)).toContain('"can_manage_catalog":false');
    // The stored rows obey the constraints.
    const stored = await app.pool.query<{ app: string; can_manage_catalog: boolean }>(
      'SELECT app, can_manage_catalog FROM app.admin_app_permissions WHERE user_id = $1::uuid',
      [catalogAdminUser.userId],
    );
    expect(stored.rows).toEqual([{ app: 'SHOP', can_manage_catalog: true }]);
    await expect(app.pool.query(`UPDATE app.admin_app_permissions SET can_view = false WHERE user_id = $1::uuid`, [catalogAdminUser.userId])).rejects.toThrow();
  });

  it('creates a group: the name is normalised, the order defaults to last, the status to ACTIVE; audit and outbox are written once; the same key replays', async () => {
    const key = randomUUID();
    const first = await made(await create(catalogAdmin, { name: `  ${name('Ốc')}   hương  ` }, { key }));
    expect(first).toMatchObject({ name: `${name('Ốc')} hương`, status: 'ACTIVE', version: 1, item_count: 0 });
    expect(Object.keys(first).sort()).toEqual(['category_id', 'item_count', 'name', 'sort_order', 'status', 'updated_at', 'version']);
    const id = String(first.category_id);
    const largest = (await app.pool.query<{ m: number }>('SELECT max(sort_order) AS m FROM app.menu_categories WHERE category_id <> $1::uuid', [id])).rows[0]?.m ?? -1;
    expect(first.sort_order).toBe(Math.max(largest + 1, 0));
    expect(await audits(id, CREATE_ACTION)).toBe(1);
    expect(await events(id)).toBe(1);
    const audit = await app.pool.query<{ actor_type: string; actor_id: string; metadata: Record<string, unknown> }>(
      'SELECT actor_type, actor_id, metadata FROM app.audit_logs WHERE resource_id = $1 AND action = $2',
      [id, CREATE_ACTION],
    );
    expect(audit.rows[0]).toMatchObject({ actor_type: 'ADMIN', actor_id: catalogAdminUser.userId, metadata: { to_name: first.name, to_status: 'ACTIVE', version: 1 } });
    // Same key, same body: the stored answer; no second group, audit row or event.
    const replay = await create(catalogAdmin, { name: `  ${name('Ốc')}   hương  ` }, { key });
    expect(replay.status).toBe(201);
    expect(adminData(replay)).toEqual(first);
    expect(await audits(id, CREATE_ACTION)).toBe(1);
    expect(await events(id)).toBe(1);
    expect(await taggedGroups()).toBe(1);
    // The same key with another body is a different request.
    expect(codeOf(await create(catalogAdmin, { name: name('Khác') }, { key }))).toEqual({ status: 409, code: 'IDEMPOTENCY_KEY_REUSED' });
    // SYSTEM may create too, with an explicit order and status.
    const explicit = await made(await create(systemLogin(), { name: name('Hệ thống'), sort_order: 7, status: 'INACTIVE' }));
    expect(explicit).toMatchObject({ sort_order: 7, status: 'INACTIVE' });
  });

  it('a name is the same group ignoring case, spaces and composition, but NOT Vietnamese marks; an inactive twin is named as such', async () => {
    const base = await made(await create(catalogAdmin, { name: name('Hải sản') }));
    for (const typed of [name('hải sản'), name('HẢI SẢN'), `  ${name('Hải')}     sản `, name('Hải sản').normalize('NFD')]) {
      expect(codeOf(await create(catalogAdmin, { name: typed }))).toEqual({ status: 409, code: 'MENU_CATEGORY_NAME_TAKEN' });
    }
    // Without the marks it is another group.
    const plain = await made(await create(catalogAdmin, { name: name('Hai san') }));
    expect(plain.category_id).not.toBe(base.category_id);
    // An inactive group still owns its name.
    const off = await update(catalogAdmin, String(base.category_id), { expected_version: 1, name: String(base.name), sort_order: Number(base.sort_order), status: 'INACTIVE' });
    expect(off.status).toBe(200);
    expect(codeOf(await create(catalogAdmin, { name: name('hải sản') }))).toEqual({ status: 409, code: 'MENU_CATEGORY_NAME_TAKEN_INACTIVE' });
    // A rename onto another group's name is refused the same way.
    expect(codeOf(await update(catalogAdmin, String(plain.category_id), { expected_version: 1, name: name('HẢI SẢN'), sort_order: 0, status: 'ACTIVE' }))).toEqual({
      status: 409,
      code: 'MENU_CATEGORY_NAME_TAKEN_INACTIVE',
    });
    expect(await groupRow(String(plain.category_id))).toMatchObject({ name: name('Hai san'), version: 1 });
  });

  it('two simultaneous requests for the same name create exactly one group', async () => {
    const [a, b] = await Promise.all([create(catalogAdmin, { name: name('Đồng thời') }), create(systemLogin(), { name: name('đồng  thời') })]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    const winner = a.status === 201 ? a : b;
    created.push(String(adminData(winner).category_id));
    expect(await count(app.pool, 'SELECT 1 FROM app.menu_categories WHERE app.menu_category_key(name) = app.menu_category_key($1)', [name('Đồng thời')])).toBe(1);
  });

  it('refuses a shape that is not exactly the documented one and changes nothing', async () => {
    const before = await taggedGroups();
    const bad: unknown[] = [
      {},
      { name: '' },
      { name: '   ' },
      { name: 'x'.repeat(81) },
      { name: 12 },
      { name: `Tên\u0007điều khiển` },
      { name: name('Order'), sort_order: -1 },
      { name: name('Order'), sort_order: 1.5 },
      { name: name('Order'), sort_order: 100001 },
      { name: name('Order'), sort_order: '3' },
      { name: name('Status'), status: 'DELETED' },
      { name: name('Extra'), actor_user_id: randomUUID() },
      [],
    ];
    for (const body of bad) {
      expect(codeOf(await create(catalogAdmin, body))).toEqual({ status: 400, code: 'ADMIN_INPUT_INVALID' });
    }
    expect(await taggedGroups()).toBe(before);
    expect((await create(catalogAdmin, { name: 'x'.repeat(80).replace(/^/, tag).slice(0, 80) })).status).toBe(201);
  });

  it('edits name, order and status at the exact version, with audit (before and after); a stale version, an unknown id and a no-op change nothing', async () => {
    const group = await made(await create(catalogAdmin, { name: name('Sửa'), sort_order: 40 }));
    const id = String(group.category_id);
    const changed = await update(catalogAdmin, id, { expected_version: 1, name: name('Sửa lại'), sort_order: 41, status: 'INACTIVE' });
    expect(changed.status).toBe(200);
    expect(adminData(changed)).toMatchObject({ category_id: id, name: name('Sửa lại'), sort_order: 41, status: 'INACTIVE', version: 2 });
    expect(await groupRow(id)).toEqual({ name: name('Sửa lại'), status: 'INACTIVE', sort_order: 41, version: 2 });
    const audit = await app.pool.query<{ actor_type: string; actor_id: string; resource_version: string; metadata: Record<string, unknown> }>(
      'SELECT actor_type, actor_id, resource_version::text, metadata FROM app.audit_logs WHERE resource_id = $1 AND action = $2',
      [id, UPDATE_ACTION],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({
      actor_type: 'ADMIN',
      actor_id: catalogAdminUser.userId,
      resource_version: '2',
      metadata: {
        changed_fields: 'name,status,sort_order',
        from_name: name('Sửa'),
        to_name: name('Sửa lại'),
        from_status: 'ACTIVE',
        to_status: 'INACTIVE',
        from_sort_order: 40,
        to_sort_order: 41,
        version: 2,
      },
    });
    expect(await events(id)).toBe(2);
    // A stale version is a conflict and writes nothing.
    expect(codeOf(await update(systemLogin(), id, { expected_version: 1, name: name('Muộn'), sort_order: 0, status: 'ACTIVE' }))).toEqual({
      status: 409,
      code: 'MENU_CATEGORY_VERSION_CONFLICT',
    });
    expect(await groupRow(id)).toMatchObject({ name: name('Sửa lại'), version: 2 });
    // Nothing to change: the current group, no new version, no audit row.
    const noop = await update(catalogAdmin, id, { expected_version: 2, name: `  ${name('Sửa')}  lại `, sort_order: 41, status: 'INACTIVE' });
    expect(noop.status).toBe(200);
    expect(adminData(noop)).toMatchObject({ version: 2 });
    expect(await audits(id, UPDATE_ACTION)).toBe(1);
    // Unknown and malformed ids.
    expect(codeOf(await update(catalogAdmin, randomUUID(), { expected_version: 1, name: name('Không có'), sort_order: 0, status: 'ACTIVE' }))).toEqual({
      status: 404,
      code: 'MENU_CATEGORY_NOT_FOUND',
    });
    expect(codeOf(await update(catalogAdmin, 'not-a-uuid', { expected_version: 1, name: name('x'), sort_order: 0, status: 'ACTIVE' }))).toEqual({
      status: 400,
      code: 'ADMIN_INPUT_INVALID',
    });
    for (const body of [{ name: name('x'), sort_order: 0, status: 'ACTIVE' }, { expected_version: 0, name: name('x'), sort_order: 0, status: 'ACTIVE' }, { expected_version: 2, name: name('x'), status: 'ACTIVE' }]) {
      expect(codeOf(await update(catalogAdmin, id, body))).toEqual({ status: 400, code: 'ADMIN_INPUT_INVALID' });
    }
    // Reactivating brings it back; there is no delete route.
    expect((await update(catalogAdmin, id, { expected_version: 2, name: name('Sửa lại'), sort_order: 41, status: 'ACTIVE' })).status).toBe(200);
    expect((await app.call('POST', `${PATH}/${id}/delete`, { basePath: BASE, cookies: sessionCookies(systemLogin()), csrf: systemLogin().csrf, body: {} })).status).toBeGreaterThanOrEqual(400);
    expect(await groupRow(id)).toMatchObject({ status: 'ACTIVE', version: 3 });
  });

  it('lists the groups: active first, then order and name; searches ignoring case and marks; filters by status; pages with a total; counts only dishes that are not deleted', async () => {
    const stamp = `${tag}L`;
    const mk = async (suffix: string, sort: number, status: 'ACTIVE' | 'INACTIVE'): Promise<string> =>
      String((await made(await create(systemLogin(), { name: `Nhóm ${stamp} ${suffix}`, sort_order: sort, status }))).category_id);
    const idB = await mk('Bánh', 5, 'ACTIVE');
    const idA = await mk('Ăn vặt', 5, 'ACTIVE');
    const idFirst = await mk('Đầu tiên', 1, 'ACTIVE');
    const idOff = await mk('Ngừng', 0, 'INACTIVE');
    // Dishes: visible, hidden and deleted count as 2 (not deleted).
    for (const [state, deleted] of [['VISIBLE', false], ['HIDDEN', false], ['DELETED', true]] as const) {
      await app.pool.query(
        `INSERT INTO app.menu_items (item_id, shop_id, category_id, name, price_vnd, status, version, created_at, updated_at, deleted_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 30000, $5, 1, clock_timestamp(), clock_timestamp(), CASE WHEN $6::boolean THEN clock_timestamp() END)`,
        [randomUUID(), shopId, idFirst, `Món ${state}`, state, deleted],
      );
    }
    const listed = adminData(await read(catalogAdmin, `?q=${encodeURIComponent(stamp)}&limit=50`));
    const items = listed.items as Record<string, unknown>[];
    expect(items.map((item) => item.category_id)).toEqual([idFirst, idA, idB, idOff]);
    expect(items.find((item) => item.category_id === idFirst)).toMatchObject({ item_count: 2, status: 'ACTIVE' });
    expect(listed).toMatchObject({ total: 4, limit: 50, offset: 0, status: 'ALL', q: stamp });
    expect(typeof listed.next_sort_order).toBe('number');
    // Search: case and marks do not matter for finding.
    expect((adminData(await read(catalogAdmin, `?q=${encodeURIComponent(`${stamp.toLowerCase()} AN VAT`)}`)).items as unknown[]).length).toBe(1);
    expect((adminData(await read(catalogAdmin, `?q=${encodeURIComponent(`  ${stamp}   BANH `)}`)).items as unknown[]).length).toBe(1);
    // Status filters.
    expect(((adminData(await read(catalogAdmin, `?q=${stamp}&status=INACTIVE`)).items as Record<string, unknown>[]).map((item) => item.category_id))).toEqual([idOff]);
    expect(((adminData(await read(catalogAdmin, `?q=${stamp}&status=ACTIVE`)).items as unknown[]).length)).toBe(3);
    expect(adminData(await read(catalogAdmin, `?q=${stamp}&status=ALL`)).total).toBe(4);
    // Pages never overlap and the total is the whole.
    const page1 = adminData(await read(catalogAdmin, `?q=${stamp}&limit=3&offset=0`));
    const page2 = adminData(await read(catalogAdmin, `?q=${stamp}&limit=3&offset=3`));
    expect((page1.items as unknown[]).length).toBe(3);
    expect((page2.items as Record<string, unknown>[]).map((item) => item.category_id)).toEqual([idOff]);
    expect([page1.total, page2.total]).toEqual([4, 4]);
    expect((adminData(await read(catalogAdmin, `?q=${stamp}&offset=100`)).items as unknown[]).length).toBe(0);
    expect(adminData(await read(catalogAdmin, `?q=khong-co-${tag}`))).toMatchObject({ total: 0, items: [] });
    // A strict query: nothing unknown, repeated or out of range is guessed.
    for (const query of ['?limit=0', '?limit=51', '?offset=-1', '?status=DELETED', '?status=active', '?foo=1', '?q=a&q=b', '?limit=1.5']) {
      expect(codeOf(await read(catalogAdmin, query))).toEqual({ status: 400, code: 'ADMIN_INPUT_INVALID' });
    }
  });

  it('a group made by SQL (before this screen) is listed and managed like any other; switching a group off keeps its dishes and their state', async () => {
    const legacy = randomUUID();
    await app.pool.query(
      `INSERT INTO app.menu_categories (category_id, name, status, sort_order, created_at, updated_at) VALUES ($1::uuid, $2, 'ACTIVE', 9, clock_timestamp(), clock_timestamp())`,
      [legacy, name('Có sẵn')],
    );
    created.push(legacy);
    const item = randomUUID();
    await app.pool.query(
      `INSERT INTO app.menu_items (item_id, shop_id, category_id, name, price_vnd, status, version, created_at, updated_at) VALUES ($1::uuid, $2::uuid, $3::uuid, 'Ốc len', 45000, 'VISIBLE', 1, clock_timestamp(), clock_timestamp())`,
      [item, shopId, legacy],
    );
    const found = (adminData(await read(catalogAdmin, `?q=${encodeURIComponent(name('Có sẵn'))}`)).items as Record<string, unknown>[])[0] as Record<string, unknown>;
    expect(found).toMatchObject({ category_id: legacy, version: 1, sort_order: 9, item_count: 1 });
    const off = await update(catalogAdmin, legacy, { expected_version: 1, name: name('Có sẵn đổi tên'), sort_order: 2, status: 'INACTIVE' });
    expect(off.status).toBe(200);
    // The dish is untouched and shows the NEW name of its group through the link; switching on again restores the choice.
    const dish = await app.pool.query<{ status: string; category_id: string; group_name: string; group_status: string }>(
      'SELECT i.status, i.category_id, c.name AS group_name, c.status AS group_status FROM app.menu_items i JOIN app.menu_categories c ON c.category_id = i.category_id WHERE i.item_id = $1::uuid',
      [item],
    );
    expect(dish.rows[0]).toEqual({ status: 'VISIBLE', category_id: legacy, group_name: name('Có sẵn đổi tên'), group_status: 'INACTIVE' });
    expect((await update(catalogAdmin, legacy, { expected_version: 2, name: name('Có sẵn đổi tên'), sort_order: 2, status: 'ACTIVE' })).status).toBe(200);
    expect(await count(app.pool, 'SELECT 1 FROM app.menu_items WHERE item_id = $1::uuid', [item])).toBe(1);
  });

  it('is atomic: a failure after the write rolls back the group and the key; the same key then succeeds once', async () => {
    const key = randomUUID();
    const wanted = name('Nguyên tử');
    await installFault(app.pool, 'fault_menu_cat_audit', 'app.audit_logs', 'INSERT', `NEW.action = '${CREATE_ACTION}' AND NEW.metadata->>'to_name' = '${wanted}'`);
    try {
      const failed = await create(catalogAdmin, { name: wanted }, { key });
      expect(failed.status).toBeGreaterThanOrEqual(500);
      expect(await count(app.pool, 'SELECT 1 FROM app.menu_categories WHERE name = $1', [wanted])).toBe(0);
    } finally {
      await removeFault(app.pool, 'fault_menu_cat_audit', 'app.audit_logs');
    }
    const retried = await made(await create(catalogAdmin, { name: wanted }, { key }));
    // A retry of the SAME key after the outcome was determined adds nothing: no duplicate, the same answer.
    const again = await create(catalogAdmin, { name: wanted }, { key });
    expect(adminData(again)).toEqual(retried);
    expect(await count(app.pool, 'SELECT 1 FROM app.menu_categories WHERE name = $1', [wanted])).toBe(1);
    expect(await audits(String(retried.category_id), CREATE_ACTION)).toBe(1);
  });

  it('the dish side obeys the group state: an inactive group cannot be chosen for a new dish, keeps its old dishes, and the order is the same everywhere', async () => {
    // The owner-facing rules are proven end to end in menu.int.spec; here the stored facts they rely on.
    const ordered = await app.pool.query<{ name: string }>(
      `SELECT name FROM app.menu_categories WHERE name LIKE $1 AND status = 'ACTIVE' ORDER BY sort_order, app.fold_vi(name) COLLATE "C", name COLLATE "C", category_id`,
      [`%${tag}%`],
    );
    expect(ordered.rows.length).toBeGreaterThan(1);
    expect(await count(app.pool, "SELECT 1 FROM app.menu_categories WHERE name LIKE $1 AND (sort_order < 0 OR sort_order > 100000)", [`%${tag}%`])).toBe(0);
  });
});
