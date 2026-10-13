import { createHash, randomBytes, randomUUID, X509Certificate } from 'node:crypto';
import { ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ADMIN_SESSION_COOKIE } from '../../apps/backend/src/admin-auth/admin-auth-constants';
import { Argon2idPasswordHasher } from '../../apps/backend/src/auth/password-hasher';
import {
  ADMIN_ORIGIN,
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
import { freePort, runScript, startFront } from './support/admin-web-harness';
import { grantRole, grantStrayRole, Phone, randomPhone } from './support/auth-fixtures';
import { Browser, launchChrome, Page } from './support/cdp';
import { createInvitation, createPayload, permissions, systemSession, SystemSession } from './support/provisioning-fixtures';

// M01 account read (2026-10-13): GET /v1/admin-auth/permissions, /v1/admin/users, /v1/admin/users/:id and
// /v1/admin/administrators against the real Nest pipeline and PostgreSQL, then ONE real-Chrome smoke through the local HTTPS
// front. ADMIN accounts are made by the real invitation -> activation -> TOTP flow (local DISABLED_TEST phone mode); USER
// accounts are inserted the way the onboarding suites do. Nothing here changes an account: reads write no audit, outbox or
// idempotency row.

const ADMIN_BASE = '/v1/admin';
const tag = randomBytes(3).toString('hex').toUpperCase();

interface Seeded {
  readonly id: string;
  readonly phone: Phone;
}

interface AdminLogin {
  readonly cookie: string;
  readonly csrf: string;
}

interface ActivatedAdmin {
  readonly phone: Phone;
  readonly userId: string;
  readonly secret: string;
  readonly fullName: string;
}

describe('admin account read (API + one real browser smoke)', () => {
  let app: AdminApp;
  let system: SystemSession;
  let front: ChildProcess | undefined;
  let browser: Browser | undefined;
  let origin = '';
  let tlsDir = '';
  let hash = '';

  // USER fixtures (names carry `tag` so a shared database cannot confuse the expectations).
  let customer: Seeded; // CUSTOMER
  let owner: Seeded; // SHOP
  let driver: Seeded; // DRIVER
  let multi: Seeded; // CUSTOMER + DRIVER
  let locked: Seeded; // CUSTOMER, DISABLED
  let legacy: Seeded; // no role at all
  // ADMIN fixtures.
  let adminCustomer: ActivatedAdmin; // CUSTOMER view
  let adminShopDriver: ActivatedAdmin; // SHOP + DRIVER view
  let pendingName = '';
  let customerAdmin: AdminLogin;
  let shopDriverAdmin: AdminLogin;

  const NAMES = {
    customer: `Nguyễn Thị Hoa ${tag}`,
    owner: `Quán Phở Bò ${tag}`,
    driver: `Trần Văn Xế ${tag}`,
    multiCustomer: `Hoa Mai ${tag}`,
    multiDriver: `Lan Anh ${tag}`,
    locked: `Lê Khóa ${tag}`,
  };

  async function seedUser(options: {
    readonly roles: readonly ('CUSTOMER' | 'SHOP' | 'DRIVER')[];
    readonly customerName?: string;
    readonly shopName?: string;
    readonly driverName?: string;
    readonly status?: 'ACTIVE' | 'DISABLED';
    readonly ageSeconds: number;
  }): Promise<Seeded> {
    const phone = randomPhone();
    app.track(phone.normalized);
    const id = randomUUID();
    await app.pool.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
       VALUES ($1::uuid, $2, $3, clock_timestamp(), 'PHONE_VERIFIED', $4, 1,
               clock_timestamp() - make_interval(secs => $5::int), clock_timestamp() - make_interval(secs => $5::int))`,
      [id, phone.normalized, hash, options.status ?? 'ACTIVE', options.ageSeconds],
    );
    for (const role of options.roles) {
      if (role === 'CUSTOMER') {
        await grantStrayRole(app.pool, id, 'CUSTOMER');
      } else {
        await grantRole(app.pool, id, role);
      }
    }
    if (options.customerName !== undefined) {
      await app.pool.query('INSERT INTO app.customer_profiles (user_id, full_name) VALUES ($1::uuid, $2)', [id, options.customerName]);
    }
    if (options.shopName !== undefined) {
      await app.pool.query('UPDATE app.shops SET name = $2 WHERE shop_id IN (SELECT shop_id FROM app.shop_members WHERE user_id = $1::uuid)', [id, options.shopName]);
    }
    if (options.driverName !== undefined) {
      await app.pool.query('UPDATE app.drivers SET full_name = $2 WHERE user_id = $1::uuid', [id, options.driverName]);
    }
    return { id, phone };
  }

  async function activatedAdmin(apps: readonly ('CUSTOMER' | 'SHOP' | 'DRIVER')[], fullName: string): Promise<ActivatedAdmin> {
    const phone = randomPhone();
    app.track(phone.normalized);
    const created = await createInvitation(app, system, createPayload(phone.local, { full_name: fullName, permissions: permissions(...apps) }));
    const token = created.link.split('#t=')[1] as string;
    const session = await begin(app, { invitationId: created.invitationId, token, phone });
    ok(await post(app, '/password', session, { password: ADMIN_PASSWORD }));
    const secret = String(adminData(ok(await post(app, '/totp/enrollment', session))).secret);
    ok(await post(app, '/complete', session, { code: totpNow(secret) }));
    const row = await app.pool.query<{ user_id: string }>('SELECT user_id FROM app.users WHERE phone_normalized = $1', [phone.normalized]);
    return { phone, userId: (row.rows[0] as { user_id: string }).user_id, secret, fullName };
  }

  /** Password, then the TOTP (a later 30-second step is simulated like every login suite does). A new login revokes the previous session. */
  async function login(who: ActivatedAdmin): Promise<AdminLogin> {
    const preauth = await loginStep(app, { phone: who.phone, password: ADMIN_PASSWORD, userId: who.userId });
    await rewindAcceptedStep(app, who.userId);
    const verified = await app.call('POST', '/totp/verify', { body: { code: totpNow(who.secret) }, cookies: preauthCookies(preauth), csrf: preauth.csrf });
    if (verified.status !== 200) {
      throw new Error(`admin login failed: ${verified.status} ${verified.text}`);
    }
    return { cookie: String(cookieFrom(verified, ADMIN_SESSION_COOKIE)), csrf: String(adminData(verified).csrf_token) };
  }

  const get = (path: string, who?: { cookie: string }, base: string = ADMIN_BASE): Promise<AdminResponse> =>
    app.call('GET', path, { basePath: base, ...(who === undefined ? {} : { cookies: sessionCookies(who) }) });
  const itemsOf = (response: AdminResponse): Array<Record<string, unknown>> => adminData(response).items as Array<Record<string, unknown>>;
  const idsOf = (response: AdminResponse): string[] => itemsOf(response).map((item) => String(item.user_id));
  const systemLogin = (): { cookie: string } => system.login;

  beforeAll(async () => {
    runScript('admin-web-build.mjs');
    tlsDir = mkdtempSync(join(tmpdir(), 'admin-account-read-tls-'));
    runScript('admin-web-cert.mjs', [tlsDir, '1']);
    const certPath = join(tlsDir, 'cert.pem');
    const spki = new X509Certificate(readFileSync(certPath)).publicKey.export({ type: 'spki', format: 'der' });
    const spkiHash = createHash('sha256').update(spki).digest('base64');
    const port = await freePort();
    origin = `https://localhost:${String(port)}`;
    app = await startAdminApp({ allowedOrigins: [origin, ADMIN_ORIGIN], activationDisabledTest: true });
    front = await startFront({
      ADMIN_WEB_PORT: String(port),
      ADMIN_WEB_HOST: 'localhost',
      ADMIN_WEB_BACKEND: app.running.baseUrl,
      ADMIN_WEB_TLS_CERT: certPath,
      ADMIN_WEB_TLS_KEY: join(tlsDir, 'key.pem'),
    });
    browser = await launchChrome(spkiHash);

    hash = await new Argon2idPasswordHasher().hash(ADMIN_PASSWORD);
    system = await systemSession(app);
    customer = await seedUser({ roles: ['CUSTOMER'], customerName: NAMES.customer, ageSeconds: 500 });
    owner = await seedUser({ roles: ['SHOP'], shopName: NAMES.owner, ageSeconds: 400 });
    driver = await seedUser({ roles: ['DRIVER'], driverName: NAMES.driver, ageSeconds: 300 });
    multi = await seedUser({ roles: ['CUSTOMER', 'DRIVER'], customerName: NAMES.multiCustomer, driverName: NAMES.multiDriver, ageSeconds: 200 });
    locked = await seedUser({ roles: ['CUSTOMER'], customerName: NAMES.locked, status: 'DISABLED', ageSeconds: 100 });
    legacy = await seedUser({ roles: [], ageSeconds: 600 });
    adminCustomer = await activatedAdmin(['CUSTOMER'], `Quản trị Khách ${tag}`);
    adminShopDriver = await activatedAdmin(['SHOP', 'DRIVER'], `Quản trị Quán Xế ${tag}`);
    // An invitation that is still waiting: it must never show in the administrators list.
    pendingName = `Quản trị Chờ ${tag}`;
    const pendingPhone = randomPhone();
    app.track(pendingPhone.normalized);
    await createInvitation(app, system, createPayload(pendingPhone.local, { full_name: pendingName }));
    customerAdmin = await login(adminCustomer);
    shopDriverAdmin = await login(adminShopDriver);
  }, 300_000);

  afterAll(async () => {
    await browser?.close();
    front?.kill('SIGTERM');
    await app?.close();
    if (tlsDir !== '') {
      rmSync(tlsDir, { recursive: true, force: true });
    }
  });

  it('permissions: SYSTEM gets the three apps with every right; an ADMIN gets its own rows; no-store; a session cookie is required', async () => {
    const sys = await get('/permissions', systemLogin(), '/v1/admin-auth');
    expect(sys.status).toBe(200);
    expect(sys.headers['cache-control']).toBe('no-store');
    expect(adminData(sys)).toEqual({
      admin_role: 'SYSTEM',
      permissions: ['CUSTOMER', 'SHOP', 'DRIVER'].map((appName) => ({ app: appName, can_view: true, can_review_profile: true, can_lock: true })),
    });
    const scoped = await get('/permissions', customerAdmin, '/v1/admin-auth');
    expect(scoped.status).toBe(200);
    expect(adminData(scoped).admin_role).toBe('ADMIN');
    const rows = adminData(scoped).permissions as Array<Record<string, unknown>>;
    expect(rows.filter((row) => row.can_view === true).map((row) => row.app)).toEqual(['CUSTOMER']);

    const noCookie = await get('/permissions', undefined, '/v1/admin-auth');
    expect({ status: noCookie.status, code: adminErrorCode(noCookie) }).toEqual({ status: 401, code: 'ADMIN_SESSION_INVALID' });
    for (const path of ['/users', `/users/${customer.id}`, '/administrators']) {
      const none = await get(path);
      expect({ path, status: none.status, code: adminErrorCode(none) }).toEqual({ path, status: 401, code: 'ADMIN_SESSION_INVALID' });
      const bearer = await app.call('GET', path, { basePath: ADMIN_BASE, headers: { authorization: 'Bearer abc' } });
      expect(bearer.status).toBe(401);
    }
  });

  it('SYSTEM lists every USER fixture newest first and never an ADMIN, even one whose name matches; no secret and no full phone leave', async () => {
    const before = await sideEffects();
    const response = await get(`/users?q=${tag}`, systemLogin());
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(idsOf(response)).toEqual([locked.id, multi.id, driver.id, owner.id, customer.id]);
    const byId = new Map(itemsOf(response).map((item) => [String(item.user_id), item]));
    expect(byId.get(customer.id)).toMatchObject({ display_name: NAMES.customer, roles_visible: ['CUSTOMER'], account_status: 'ACTIVE' });
    expect(byId.get(owner.id)).toMatchObject({ display_name: NAMES.owner, roles_visible: ['SHOP_OWNER'] });
    expect(byId.get(driver.id)).toMatchObject({ display_name: NAMES.driver, roles_visible: ['DRIVER'] });
    // CUSTOMER wins the display name for SYSTEM; both roles are shown.
    expect(byId.get(multi.id)).toMatchObject({ display_name: NAMES.multiCustomer, roles_visible: ['CUSTOMER', 'DRIVER'] });
    expect(byId.get(locked.id)).toMatchObject({ account_status: 'DISABLED' });
    expect(adminData(response).available_role_filters).toEqual(['CUSTOMER', 'SHOP_OWNER', 'DRIVER']);
    for (const item of itemsOf(response)) {
      expect(Object.keys(item).sort()).toEqual(['account_status', 'created_at', 'display_name', 'phone_masked', 'roles_visible', 'user_id']);
    }
    const text = response.text;
    for (const phone of [customer.phone, owner.phone, driver.phone]) {
      expect(text).not.toContain(phone.normalized);
      expect(text).not.toContain(phone.local);
    }
    expect(text).not.toMatch(/password|otp|totp|token|secret|argon2/i);
    expect(text).not.toContain(adminCustomer.fullName);
    expect(await sideEffects()).toEqual(before);

    // SYSTEM also sees a legacy account without any role (found by its phone).
    const old = await get(`/users?q=${legacy.phone.local}`, systemLogin());
    expect(itemsOf(old)).toHaveLength(1);
    expect(itemsOf(old)[0]).toMatchObject({ user_id: legacy.id, display_name: null, roles_visible: [] });
  });

  it('detail: SYSTEM sees every profile; the shape is fixed; allowed_actions stays empty; an unknown id and a hidden id look the same', async () => {
    const detail = await get(`/users/${multi.id}`, systemLogin());
    expect(detail.status).toBe(200);
    const data = adminData(detail);
    expect(Object.keys(data).sort()).toEqual(['account_status', 'allowed_actions', 'created_at', 'display_name', 'phone_masked', 'profiles', 'roles_visible', 'updated_at', 'user_id', 'version']);
    expect(data.allowed_actions).toEqual([]);
    expect(data.profiles).toEqual({ customer: { full_name: NAMES.multiCustomer }, driver: { status: 'PENDING' } });
    expect(detail.text).not.toContain(multi.phone.normalized);

    const unknown = await get(`/users/${randomUUID()}`, systemLogin());
    const hidden = await get(`/users/${adminCustomer.userId}`, systemLogin()); // an ADMIN account is never a USER
    for (const missing of [unknown, hidden]) {
      expect({ status: missing.status, code: adminErrorCode(missing) }).toEqual({ status: 404, code: 'USER_NOT_AVAILABLE' });
    }
    const malformed = await get('/users/not-a-uuid', systemLogin());
    expect(malformed.status).toBe(400);
  });

  it('an ADMIN with CUSTOMER view sees only customer accounts, only their customer part, and is refused everything else', async () => {
    const list = await get(`/users?q=${tag}`, customerAdmin);
    expect(list.status).toBe(200);
    expect(idsOf(list)).toEqual([locked.id, multi.id, customer.id]);
    expect(adminData(list).available_role_filters).toEqual(['CUSTOMER']);
    const byId = new Map(itemsOf(list).map((item) => [String(item.user_id), item]));
    // The driver name and role of the multi-role account are not this admin's to see.
    expect(byId.get(multi.id)).toMatchObject({ display_name: NAMES.multiCustomer, roles_visible: ['CUSTOMER'] });
    expect(list.text).not.toContain(NAMES.multiDriver);

    // Search is limited to the scope in SQL: the driver-side name does not find the account.
    expect(itemsOf(await get(`/users?q=${encodeURIComponent('lan anh')}`, customerAdmin))).toEqual([]);
    expect(itemsOf(await get(`/users?q=${legacy.phone.local}`, customerAdmin))).toEqual([]);

    const detail = adminData(await get(`/users/${multi.id}`, customerAdmin));
    expect(detail.profiles).toEqual({ customer: { full_name: NAMES.multiCustomer } });
    expect(detail.roles_visible).toEqual(['CUSTOMER']);

    for (const hiddenId of [driver.id, owner.id, legacy.id, randomUUID()]) {
      const refused = await get(`/users/${hiddenId}`, customerAdmin);
      expect({ status: refused.status, code: adminErrorCode(refused) }).toEqual({ status: 404, code: 'USER_NOT_AVAILABLE' });
    }
    for (const role of ['SHOP_OWNER', 'DRIVER']) {
      const refused = await get(`/users?role=${role}`, customerAdmin);
      expect({ status: refused.status, code: adminErrorCode(refused) }).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    }
    const administrators = await get('/administrators', customerAdmin);
    expect({ status: administrators.status, code: adminErrorCode(administrators) }).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
  });

  it('an ADMIN with SHOP + DRIVER view sees shop owners and drivers with their own display name, and no customer data', async () => {
    const list = await get(`/users?q=${tag}`, shopDriverAdmin);
    expect(idsOf(list)).toEqual([multi.id, driver.id, owner.id]);
    expect(adminData(list).available_role_filters).toEqual(['SHOP_OWNER', 'DRIVER']);
    const byId = new Map(itemsOf(list).map((item) => [String(item.user_id), item]));
    expect(byId.get(multi.id)).toMatchObject({ display_name: NAMES.multiDriver, roles_visible: ['DRIVER'] });
    expect(list.text).not.toContain(NAMES.multiCustomer);
    expect(itemsOf(await get(`/users?q=${encodeURIComponent('hoa mai')}`, shopDriverAdmin))).toEqual([]);
    expect(idsOf(await get(`/users?role=DRIVER&q=${tag}`, shopDriverAdmin))).toEqual([multi.id, driver.id]);
    const refused = await get(`/users/${customer.id}`, shopDriverAdmin);
    expect({ status: refused.status, code: adminErrorCode(refused) }).toEqual({ status: 404, code: 'USER_NOT_AVAILABLE' });
    expect(adminData(await get(`/users/${multi.id}`, shopDriverAdmin)).profiles).toEqual({ driver: { status: 'PENDING' } });
  });

  it('administrators: SYSTEM only; activated ADMINs with their permissions; never SYSTEM, never a pending invitation', async () => {
    const list = await get(`/administrators?q=${tag}`, systemLogin());
    expect(list.status).toBe(200);
    const items = itemsOf(list);
    expect(items.map((item) => item.user_id)).toEqual([adminShopDriver.userId, adminCustomer.userId]);
    expect(items[1]).toMatchObject({ full_name: adminCustomer.fullName, admin_role: 'ADMIN', status: 'ACTIVE' });
    expect((items[1] as { permissions: Array<{ app: string; can_view: boolean }> }).permissions.filter((row) => row.can_view).map((row) => row.app)).toEqual(['CUSTOMER']);
    expect((items[0] as { permissions: Array<{ app: string; can_view: boolean }> }).permissions.filter((row) => row.can_view).map((row) => row.app)).toEqual(['SHOP', 'DRIVER']);
    expect(list.text).not.toContain(pendingName);
    expect(list.text).not.toContain(adminCustomer.phone.normalized);
    expect(items.map((item) => item.user_id)).not.toContain(system.account.userId);

    // An identity that was disabled shows as DISABLED (effective status).
    await app.pool.query("UPDATE app.users SET status = 'DISABLED', updated_at = clock_timestamp() WHERE user_id = $1::uuid", [adminCustomer.userId]);
    try {
      const after = await get(`/administrators?q=${tag}&status=DISABLED`, systemLogin());
      expect(itemsOf(after).map((item) => item.user_id)).toEqual([adminCustomer.userId]);
      expect(itemsOf(after)[0]).toMatchObject({ status: 'DISABLED' });
    } finally {
      await app.pool.query("UPDATE app.users SET status = 'ACTIVE', updated_at = clock_timestamp() WHERE user_id = $1::uuid", [adminCustomer.userId]);
    }
    for (const who of [customerAdmin, shopDriverAdmin]) {
      const refused = await get('/administrators', who);
      expect({ status: refused.status, code: adminErrorCode(refused) }).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    }
  });

  it('pagination is a bound keyset: pages join into the full list; a forged, foreign or re-filtered cursor is 400', async () => {
    const first = await get(`/users?q=${tag}&limit=2`, systemLogin());
    const seen = idsOf(first);
    let cursor = adminData(first).next_cursor as string | null;
    expect(seen).toHaveLength(2);
    expect(typeof cursor).toBe('string');
    const firstCursor = String(cursor);
    while (cursor !== null) {
      const page = await get(`/users?q=${tag}&limit=2&cursor=${encodeURIComponent(cursor)}`, systemLogin());
      expect(page.status).toBe(200);
      seen.push(...idsOf(page));
      cursor = adminData(page).next_cursor as string | null;
    }
    expect(seen).toEqual([locked.id, multi.id, driver.id, owner.id, customer.id]);

    const bad = async (response: Promise<AdminResponse>): Promise<unknown> => {
      const answer = await response;
      return { status: answer.status, code: adminErrorCode(answer) };
    };
    const refused = { status: 400, code: 'ADMIN_INPUT_INVALID' };
    const forged = `${firstCursor.slice(0, -2)}${firstCursor.endsWith('AA') ? 'BB' : 'AA'}`;
    expect(await bad(get(`/users?q=${tag}&limit=2&cursor=${encodeURIComponent(forged)}`, systemLogin()))).toEqual(refused);
    expect(await bad(get(`/users?q=${tag}&limit=2&cursor=garbage`, systemLogin()))).toEqual(refused);
    // Another filter, a different limit is allowed, another endpoint, another actor: not the cursor that was issued.
    expect(await bad(get(`/users?q=${tag}&role=DRIVER&limit=2&cursor=${encodeURIComponent(firstCursor)}`, systemLogin()))).toEqual(refused);
    expect(await bad(get(`/administrators?q=${tag}&cursor=${encodeURIComponent(firstCursor)}`, systemLogin()))).toEqual(refused);
    expect(await bad(get(`/users?q=${tag}&limit=2&cursor=${encodeURIComponent(firstCursor)}`, customerAdmin))).toEqual(refused);
    for (const limit of ['0', '51', 'x']) {
      expect((await get(`/users?limit=${limit}`, systemLogin())).status).toBe(400);
    }
  });

  it('search ignores case and Vietnamese diacritics, treats % and _ literally, and finds a phone by its digits', async () => {
    for (const q of ['nguyen thi hoa', 'NGUYỄN THỊ HOA', 'nguyễn thi HOA']) {
      expect(idsOf(await get(`/users?q=${encodeURIComponent(`${q} ${tag}`)}`, systemLogin()))).toEqual([customer.id]);
    }
    expect(idsOf(await get(`/users?q=${encodeURIComponent('quan pho bo')}&role=SHOP_OWNER`, systemLogin()))).toContain(owner.id);
    expect(itemsOf(await get(`/users?q=${encodeURIComponent('%')}`, systemLogin()))).toEqual([]);
    expect(itemsOf(await get(`/users?q=${encodeURIComponent(`${tag}_`)}`, systemLogin()))).toEqual([]);
    expect(idsOf(await get(`/users?q=${customer.phone.local}`, systemLogin()))).toEqual([customer.id]);
    expect(idsOf(await get(`/users?q=${encodeURIComponent(customer.phone.international)}`, systemLogin()))).toEqual([customer.id]);
    const longQuery = await get(`/users?q=${'a'.repeat(121)}`, systemLogin());
    expect(longQuery.status).toBe(400);
  });

  it('every read dies with the session: a revoked session gets 401 on all four routes', async () => {
    const throwaway = await login(adminShopDriver);
    expect((await get('/users', throwaway)).status).toBe(200);
    await app.pool.query('UPDATE app.admin_sessions SET revoked_at = clock_timestamp() WHERE user_id = $1::uuid AND revoked_at IS NULL', [adminShopDriver.userId]);
    for (const [path, base] of [
      ['/permissions', '/v1/admin-auth'],
      ['/users', ADMIN_BASE],
      [`/users/${multi.id}`, ADMIN_BASE],
    ] as const) {
      const gone = await get(path, throwaway, base);
      expect({ path, status: gone.status, code: adminErrorCode(gone) }).toEqual({ path, status: 401, code: 'ADMIN_SESSION_INVALID' });
    }
  });

  it('real browser: SYSTEM reads users and administrators; losing the session clears the data; an ADMIN is held to its scope', async () => {
    const page: Page = await (browser as Browser).newPage();
    await page.viewport(1280, 800, false);
    await page.send('Network.clearBrowserCookies');
    const rows = `document.querySelectorAll('.table tbody tr:not(.row-panel)').length`;

    // SYSTEM signs in.
    await page.goto(`${origin}/`);
    await page.waitFor(`document.querySelector('#login-title')`);
    await page.fill('#phone', system.account.phone.local);
    await page.fill('#password', system.account.password);
    await page.pressEnter();
    await page.waitFor(`document.querySelector('#verify-title')`);
    await rewindAcceptedStep(app, system.account.userId);
    await page.fill('#verify-code', totpNow(system.login.secret));
    await page.pressEnter();
    await page.waitFor(`document.querySelector('#shell-title')`);
    expect(await page.evaluate<boolean>(`Boolean(document.querySelector('a[href="/accounts/administrators"]')) && Boolean(document.querySelector('a[href="/invitations"]'))`)).toBe(true);

    // Users: real rows, server-side search, masked phones only.
    await page.goto(`${origin}/accounts/users`);
    await page.waitFor(`document.querySelector('#users-search')`);
    await page.fill('#users-search', tag);
    await page.waitFor(`${rows} === 5 && document.body.innerText.includes(${JSON.stringify(NAMES.customer)})`);
    const body = await page.evaluate<string>('document.body.innerText');
    expect(body).not.toContain(customer.phone.local);
    expect(body).not.toContain(adminCustomer.fullName);
    await page.fill('#users-search', NAMES.driver.toUpperCase());
    await page.waitFor(`${rows} === 1 && document.body.innerText.includes(${JSON.stringify(NAMES.driver)})`);
    await page.goto(`${origin}/accounts/users/${driver.id}`);
    await page.waitFor(`document.body.innerText.includes(${JSON.stringify(NAMES.driver)})`);
    expect(await page.evaluate<boolean>(`[...document.querySelectorAll('button')].filter((button) => /Khóa|Mở khóa/.test(button.textContent ?? '')).every((button) => button.disabled)`)).toBe(true);

    // Administrators: activated accounts only; no "waiting" filter.
    await page.goto(`${origin}/accounts/administrators`);
    await page.waitFor(`document.querySelector('#admins-search')`);
    await page.fill('#admins-search', tag);
    await page.waitFor(`${rows} === 2 && document.body.innerText.includes(${JSON.stringify(adminCustomer.fullName)})`);
    expect(await page.evaluate<string[]>(`[...document.querySelectorAll('#admins-status option')].map((option) => option.value)`)).toEqual(['ALL', 'ACTIVE', 'LOCKED']);
    expect(await page.evaluate<boolean>('document.body.innerText.includes(' + JSON.stringify(pendingName) + ')')).toBe(false);

    // The session ends on the server: the next read sends the page to login and nothing that was read stays on screen.
    await app.pool.query('UPDATE app.admin_sessions SET revoked_at = clock_timestamp() WHERE user_id = $1::uuid AND revoked_at IS NULL', [system.account.userId]);
    await page.click('.toolbar .btn-secondary');
    await page.waitFor(`document.querySelector('#login-title')`);
    const afterLoss = await page.evaluate<string>('document.body.innerText');
    expect(afterLoss).not.toContain(adminCustomer.fullName);
    expect(afterLoss).not.toContain(tag);

    // An ADMIN with CUSTOMER view: the menu is the granted part, and direct calls outside the scope are refused.
    await page.fill('#phone', adminCustomer.phone.local);
    await page.fill('#password', ADMIN_PASSWORD);
    await page.pressEnter();
    await page.waitFor(`document.querySelector('#verify-title')`);
    await rewindAcceptedStep(app, adminCustomer.userId);
    await page.fill('#verify-code', totpNow(adminCustomer.secret));
    await page.pressEnter();
    // The address is still the administrators page: an ADMIN lands on it with "no permission", never on a blank area.
    await page.waitFor(`document.querySelector('a[href="/accounts/users"]')`);
    await page.waitFor(`document.body.innerText.includes('Không có quyền')`);
    expect(await page.evaluate<boolean>(`!document.querySelector('a[href="/accounts/administrators"]') && !document.querySelector('a[href="/invitations"]')`)).toBe(true);
    const statuses = await page.evaluate<number[]>(`Promise.all([
      '/v1/admin/users/${driver.id}',
      '/v1/admin/users?role=DRIVER',
      '/v1/admin/administrators',
    ].map((url) => fetch(url).then((response) => response.status)))`);
    expect(statuses).toEqual([404, 403, 403]);
    await page.goto(`${origin}/accounts/users`);
    await page.waitFor(`document.querySelector('#users-search')`);
    expect(await page.evaluate<string[]>(`[...document.querySelectorAll('#users-role option')].map((option) => option.value)`)).toEqual(['ALL', 'CUSTOMER']);
    await page.fill('#users-search', tag);
    await page.waitFor(`${rows} === 3 && document.body.innerText.includes(${JSON.stringify(NAMES.multiCustomer)})`);
    expect(await page.evaluate<boolean>(`document.body.innerText.includes(${JSON.stringify(NAMES.driver)}) || document.body.innerText.includes(${JSON.stringify(NAMES.multiDriver)})`)).toBe(false);
    // Its own screen for a forbidden area: the page for administrators says there is no permission.
    await page.goto(`${origin}/accounts/administrators`);
    await page.waitFor(`document.body.innerText.includes('Không có quyền')`);
    expect(page.consoleErrors).toEqual([]);
    await page.close();
  }, 300_000);

  async function sideEffects(): Promise<number[]> {
    return [
      await count(app.pool, 'SELECT 1 FROM app.audit_logs'),
      await count(app.pool, 'SELECT 1 FROM app.outbox_events'),
      await count(app.pool, 'SELECT 1 FROM app.idempotency_records'),
    ];
  }
});
