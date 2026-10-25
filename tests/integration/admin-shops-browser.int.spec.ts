import { createHash, randomBytes, randomUUID, X509Certificate } from 'node:crypto';
import { ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Argon2idPasswordHasher } from '../../apps/backend/src/auth/password-hasher';
import { ADMIN_ORIGIN, ADMIN_PASSWORD, AdminApp, adminData, count, rewindAcceptedStep, startAdminApp, totpNow } from './support/admin-fixtures';
import { begin, ok, post } from './support/activation-fixtures';
import { freePort, repoRoot, runScript, startFront } from './support/admin-web-harness';
import { Browser, launchChrome, Page } from './support/cdp';
import { AuthApp, createActiveShopFor, createServiceArea, Phone, randomPhone } from './support/auth-fixtures';
import { cleanupOrders } from './support/m10-fixtures';
import { createInvitation, createPayload, systemSession, SystemSession } from './support/provisioning-fixtures';

// M02 "Quản lý quán" on the Administration web in a REAL Chrome against the real front, backend and PostgreSQL: the list (search, filters, pages of 20,
// two separate statuses), the detail with its four tabs (profile, schedule, menu, management history), the customer preview, the disable / enable
// popups (reason required, the lock while the result is unknown, the retry with the SAME key, a version conflict that keeps the typed reason), the
// rights of SYSTEM / ADMIN, and the reload of both routes at 1280 px and 390 px. Screenshots of the real pages go to .test-results/admin-shop-shots.

const tag = `QL${randomBytes(3).toString('hex').toUpperCase()}`;
const NAME_A = `Phở Hà Nội ${tag}`;
const NAME_B = `Bún Chả Cao Bằng ${tag}`;

interface Shot {
  readonly name: string;
  readonly data: Buffer;
}
interface Person {
  readonly phone: Phone;
  readonly userId: string;
  readonly secret: string;
}

describe('admin shop management (real browser)', () => {
  let app: AdminApp;
  let system: SystemSession;
  let front: ChildProcess | undefined;
  let browser: Browser | undefined;
  let origin = '';
  let tlsDir = '';
  const shots: Shot[] = [];
  let viewerAdmin: Person;
  let managerAdmin: Person;
  let lockAdmin: Person;
  let idA = '';
  let areaId = '';
  const shopIds: string[] = [];
  const categoryIds: string[] = [];
  let ownerA = '';

  async function activatedAdmin(permissions: Record<string, unknown>[], fullName: string): Promise<Person> {
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

  async function seedShop(name: string, label: string): Promise<{ shopId: string; ownerId: string }> {
    const phone = randomPhone();
    app.track(phone.normalized);
    const ownerId = randomUUID();
    await app.pool.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
       VALUES ($1::uuid, $2, $3, clock_timestamp(), 'PHONE_VERIFIED', 'ACTIVE', 1, clock_timestamp(), clock_timestamp())`,
      [ownerId, phone.normalized, await new Argon2idPasswordHasher().hash(ADMIN_PASSWORD)],
    );
    const shopId = await createActiveShopFor(app.pool, ownerId, areaId);
    shopIds.push(shopId);
    await app.pool.query(`UPDATE app.shops SET name = $2, address_text = $3, zalo = '0900111222', facebook = 'fb.com/quan' WHERE shop_id = $1::uuid`, [shopId, name, `Số 9 phố ${label}, Cao Bằng`]);
    return { shopId, ownerId };
  }

  async function signIn(page: Page, who: { phone: { local: string }; password: string; userId: string; secret: string }): Promise<void> {
    await app.clearLimits();
    await page.goto(`${origin}/`);
    await page.waitFor(`document.querySelector('#login-title')`);
    await page.fill('#phone', who.phone.local);
    await page.fill('#password', who.password);
    await page.pressEnter();
    await page.waitFor(`document.querySelector('#verify-title')`);
    await rewindAcceptedStep(app, who.userId);
    await page.fill('#verify-code', totpNow(who.secret));
    await page.pressEnter();
    await page.waitFor(`document.querySelector('#shell-title')`);
  }

  const shot = async (page: Page, name: string): Promise<void> => {
    shots.push({ name, data: await page.screenshot() });
  };
  const press = (page: Page, text: string, within = 'document'): Promise<boolean> =>
    page.evaluate<boolean>(`(() => { const b = [...${within}.querySelectorAll('button')].find((x) => (x.textContent ?? '').trim() === ${JSON.stringify(text)} && !x.disabled); if (!b) return false; b.click(); return true; })()`);
  const rowsText = (page: Page): Promise<string[]> =>
    page.evaluate<string[]>(`[...document.querySelectorAll('.table tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()).join(' | '))`);
  const waitRows = (page: Page, predicate: string): Promise<void> => page.waitFor(`(() => { const rows = [...document.querySelectorAll('.table tbody tr')].map((tr) => tr.textContent); return ${predicate}; })()`);
  const pick = (page: Page, selector: string, value: string): Promise<boolean> =>
    page.evaluate<boolean>(`(() => { const s = document.querySelector(${JSON.stringify(selector)}); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change')); return true; })()`);
  const tab = async (page: Page, id: string): Promise<void> => {
    await page.evaluate(`document.querySelector('#shop-tab-${id}').click()`);
  };
  let customerId = '';
  async function addOrder(status: 'PENDING_CONFIRMATION' | 'PREPARING', code: string): Promise<void> {
    if (customerId === '') {
      customerId = randomUUID();
      const phone = randomPhone();
      app.track(phone.normalized);
      await app.pool.query(
        `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
         VALUES ($1::uuid, $2, $3, clock_timestamp(), 'PHONE_VERIFIED', 'ACTIVE', 1, clock_timestamp(), clock_timestamp())`,
        [customerId, phone.normalized, await new Argon2idPasswordHasher().hash(ADMIN_PASSWORD)],
      );
    }
    const client = await app.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE app.orders DISABLE TRIGGER USER');
      await client.query(
        `INSERT INTO app.orders (order_id, code, client_ref, customer_user_id, shop_id, status, shop_name, shop_phone, shop_address_text, recipient_name, recipient_phone, address_text, items_original_total_vnd, items_total_vnd, confirmed_at, created_at, updated_at)
         VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5::uuid, $6::varchar, 'Quán', '0900000000', 'Số 1', 'Người nhận', '0912345678', 'Số 2', 50000, 50000, CASE WHEN $6::varchar = 'PREPARING' THEN now() END, now(), now())`,
        [randomUUID(), code, randomUUID(), customerId, idA, status],
      );
      await client.query('ALTER TABLE app.orders ENABLE TRIGGER USER');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  async function finishOrders(): Promise<void> {
    const client = await app.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE app.orders DISABLE TRIGGER USER');
      await client.query(`UPDATE app.orders SET status = 'COMPLETED', confirmed_at = COALESCE(confirmed_at, now()), ended_at = now(), end_actor = 'SYSTEM' WHERE shop_id = $1::uuid`, [idA]);
      await client.query('ALTER TABLE app.orders ENABLE TRIGGER USER');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  const shopRow = async (id: string): Promise<{ status: string; version: number }> => {
    const result = await app.pool.query<{ status: string; version: string }>('SELECT status, version::text AS version FROM app.shops WHERE shop_id = $1::uuid', [id]);
    const found = result.rows[0] as { status: string; version: string };
    return { status: found.status, version: Number(found.version) };
  };
  const audits = (id: string, action: string): Promise<number> => count(app.pool, 'SELECT 1 FROM app.audit_logs WHERE resource_id = $1 AND action = $2', [id, action]);
  const noSideways = (page: Page): Promise<boolean> => page.evaluate<boolean>(`document.documentElement.scrollWidth <= window.innerWidth`);

  beforeAll(async () => {
    runScript('admin-web-build.mjs');
    tlsDir = mkdtempSync(join(tmpdir(), 'admin-shops-tls-'));
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
    system = await systemSession(app);
    viewerAdmin = await activatedAdmin([{ app: 'SHOP', can_view: true, can_review_profile: false, can_lock: false }], `Quản trị xem quán ${tag}`);
    managerAdmin = await activatedAdmin([{ app: 'SHOP', can_view: true, can_review_profile: false, can_lock: false, can_manage_shops: true }], `Quản trị quán ${tag}`);
    lockAdmin = await activatedAdmin([{ app: 'SHOP', can_view: true, can_review_profile: false, can_lock: true }], `Quản trị khóa ${tag}`);
    areaId = await createServiceArea(app.pool);
    await app.pool.query(`UPDATE app.service_areas SET name = $2 WHERE service_area_id = $1::uuid`, [areaId, `Thành phố Cao Bằng ${tag}`]);
    const a = await seedShop(NAME_A, 'Kim Đồng');
    const b = await seedShop(NAME_B, 'Hợp Giang');
    idA = a.shopId;
    ownerA = a.ownerId;
    void b;
    // A: open all week, an overnight evening slot on Friday as a second interval, dishes in an active and a switched-off group (one hidden, one deleted).
    await app.pool.query(`INSERT INTO app.shop_business_hours (shop_id, weekday, start_minute, end_minute, end_day_offset) SELECT $1::uuid, d, 0, 1440, 0 FROM generate_series(1, 4) d`, [idA]);
    await app.pool.query(
      `INSERT INTO app.shop_business_hours (shop_id, weekday, start_minute, end_minute, end_day_offset) VALUES ($1::uuid, 5, 360, 600, 0), ($1::uuid, 5, 1320, 120, 1), ($1::uuid, 6, 0, 1440, 0), ($1::uuid, 7, 0, 1440, 0)`,
      [idA],
    );
    const food = randomUUID();
    const drink = randomUUID();
    categoryIds.push(food, drink);
    await app.pool.query(`INSERT INTO app.menu_categories (category_id, name, status, sort_order, version, created_at, updated_at) VALUES ($1::uuid, $2, 'ACTIVE', 0, 1, clock_timestamp(), clock_timestamp()), ($3::uuid, $4, 'INACTIVE', 1, 1, clock_timestamp(), clock_timestamp())`, [food, `Món chính ${tag}`, drink, `Đồ uống ${tag}`]);
    for (const [name, category, price, status] of [
      [`Phở bò tái ${tag}`, food, 45000, 'VISIBLE'],
      [`Phở gà ẩn ${tag}`, food, 40000, 'HIDDEN'],
      [`Trà đá ${tag}`, drink, 5000, 'VISIBLE'],
      [`Món đã xóa ${tag}`, food, 1000, 'DELETED'],
    ] as const) {
      // Issue #190: a dish on sale carries a picture (a shop is set up only with one).
      const imageId = status === 'VISIBLE' ? randomUUID() : null;
      if (imageId !== null) {
        await app.pool.query(`INSERT INTO app.menu_images (image_id, shop_id, content_type, byte_size, data, created_at) VALUES ($1::uuid, $2::uuid, 'image/jpeg', 4, '\\xffd8ffe0'::bytea, clock_timestamp())`, [imageId, idA]);
      }
      await app.pool.query(
        `INSERT INTO app.menu_items (item_id, shop_id, category_id, name, price_vnd, status, image_id, version, created_at, updated_at, deleted_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::uuid, 1, clock_timestamp(), clock_timestamp(), CASE WHEN $6 = 'DELETED' THEN clock_timestamp() END)`,
        [randomUUID(), idA, category, name, price, status, imageId],
      );
    }
    // 21 more shops so the list has a second page.
    for (let index = 0; index < 21; index += 1) {
      const extra = await seedShop(`Quán phụ ${tag} ${String(index).padStart(2, '0')}`, `Phụ ${String(index)}`);
      void extra;
    }
  }, 300_000);

  afterAll(async () => {
    const directory = join(repoRoot(), '.test-results', 'admin-shop-shots');
    mkdirSync(directory, { recursive: true });
    for (const item of shots) {
      writeFileSync(join(directory, `${item.name}.png`), item.data);
    }
    await browser?.close();
    front?.kill('SIGTERM');
    if (app !== undefined) {
      await cleanupOrders({ pool: app.pool } as AuthApp, { shopIds, customerIds: [], drivers: [], userIds: [] });
      await app.pool.query('DELETE FROM app.menu_items WHERE shop_id = ANY($1::uuid[])', [shopIds]);
      await app.pool.query('DELETE FROM app.menu_images WHERE shop_id = ANY($1::uuid[])', [shopIds]);
      await app.pool.query('DELETE FROM app.menu_categories WHERE category_id = ANY($1::uuid[])', [categoryIds]);
      await app.close();
    }
    if (tlsDir !== '') {
      rmSync(tlsDir, { recursive: true, force: true });
    }
  });

  it('SYSTEM: list (two separate statuses, search, filters, pages), detail with four tabs, customer preview, reload of both routes, 1280 px and 390 px', async () => {
    const page: Page = await (browser as Browser).newPage();
    await page.viewport(1280, 900, false);
    await page.send('Network.clearBrowserCookies');
    await signIn(page, { phone: system.account.phone, password: system.account.password, userId: system.account.userId, secret: system.login.secret });
    expect(await page.evaluate<boolean>(`!!document.querySelector('a[href="/operations/shops"]')`)).toBe(true);
    await page.goto(`${origin}/operations/shops`);
    await page.waitFor(`document.querySelector('#shop-title') && document.querySelectorAll('.table tbody tr').length >= 1`);
    // 23 shops of this run: the first page holds 20, the second the rest.
    await page.fill('#shop-search', tag);
    await page.waitFor(`(document.querySelector('.pager-text')?.textContent ?? '').includes('1–20 / 23 quán')`);
    await waitRows(page, `rows.length === 20`);
    expect(await press(page, 'Sau')).toBe(true);
    await waitRows(page, `rows.length === 3`);
    expect(await press(page, 'Trước')).toBe(true);
    await waitRows(page, `rows.length === 20`);
    // Search by name without marks, then by the owner's phone digits.
    await page.fill('#shop-search', `pho ha noi ${tag.toLowerCase()}`);
    await waitRows(page, `rows.length === 1 && rows[0].includes(${JSON.stringify(NAME_A)})`);
    const listed = (await rowsText(page))[0] as string;
    // Profile status and "by schedule" are two different cells; the dishes are visible/total (the deleted one is not counted).
    expect(listed).toContain('Đang hoạt động');
    expect(listed).toMatch(/Đang mở|Đóng · ngoài giờ/);
    expect(listed).toContain('2/3');
    expect(listed).toContain(`Thành phố Cao Bằng ${tag}`);
    await shot(page, 'shops-list-desktop');
    await page.fill('#shop-search', 'khong-co-quan-nay');
    await page.waitFor(`document.body.innerText.includes('Không tìm thấy quán')`);
    await page.fill('#shop-search', `bun cha cao bang ${tag.toLowerCase()}`);
    await waitRows(page, `rows.length === 1 && rows[0].includes(${JSON.stringify(NAME_B)})`);
    // Filters: area + profile + schedule (the shop B has no schedule: closed).
    await page.fill('#shop-search', tag);
    await page.waitFor(`(document.querySelector('.pager-text')?.textContent ?? '').includes('/ 23 quán')`);
    await pick(page, '#shop-area', areaId);
    await pick(page, '#shop-profile', 'DISABLED');
    await page.waitFor(`document.body.innerText.includes('Không tìm thấy quán')`);
    await pick(page, '#shop-profile', 'ACTIVE');
    await pick(page, '#shop-schedule', 'CLOSED');
    await waitRows(page, `rows.length >= 1 && rows.every((r) => (r.includes('Đóng') || r.includes('Chưa thiết lập')))`);

    // Detail: header, the four tabs, reload of the route and of the tab.
    await page.goto(`${origin}/operations/shops/${idA}`);
    await page.waitFor(`document.querySelector('#shop-detail-title') && document.querySelector('#shop-tab-menu')`);
    const profile = await page.evaluate<string>(`document.body.innerText`);
    for (const expected of [NAME_A, 'Mã quán K', 'Đang hoạt động', 'Hồ sơ', 'Giờ hoạt động', 'Thực đơn', 'Lịch sử quản lý', 'SĐT đăng nhập của chủ quán', 'SĐT liên hệ của quán', '0900111222', 'fb.com/quan', '21, 105.8', 'Bản đồ trên Web Admin chưa được nối', 'Vô hiệu hóa quán']) {
      expect(profile).toContain(expected);
    }
    await page.reload();
    await page.waitFor(`document.querySelector('#shop-detail-title') && document.body.innerText.includes('SĐT đăng nhập của chủ quán')`);
    await shot(page, 'shop-detail-profile-desktop');
    await tab(page, 'hours');
    await page.waitFor(`document.body.innerText.includes('Giờ hoạt động trong tuần')`);
    const hours = await page.evaluate<string>(`document.body.innerText`);
    for (const expected of ['Cả ngày (24 giờ)', '06:00 – 10:00', '22:00 – 02:00 (hôm sau)', 'Asia/Ho_Chi_Minh']) {
      expect(hours).toContain(expected);
    }
    await shot(page, 'shop-detail-hours-desktop');
    await tab(page, 'menu');
    await page.waitFor(`document.querySelectorAll('.table tbody tr').length === 3`);
    const menu = await page.evaluate<string>(`document.body.innerText`);
    expect(menu).toContain(`Phở gà ẩn ${tag}`);
    expect(menu).toContain('Đang ẩn');
    expect(menu).toContain('(ngừng dùng)');
    expect(menu).not.toContain(`Món đã xóa ${tag}`);
    await shot(page, 'shop-detail-menu-desktop');
    await pick(page, '.tab-panel select[aria-label="Hiện hoặc ẩn"]', 'HIDDEN');
    await page.waitFor(`document.querySelectorAll('.table tbody tr').length === 1`);
    await pick(page, '.tab-panel select[aria-label="Hiện hoặc ẩn"]', 'ALL');
    await page.waitFor(`document.querySelectorAll('.table tbody tr').length === 3`);
    // Item detail, then the customer preview: hidden dishes are not in it.
    expect(await press(page, 'Chi tiết')).toBe(true);
    await page.waitFor(`document.querySelector('.dialog')`);
    expect(await page.evaluate<string>(`document.querySelector('.dialog').innerText`)).toContain('Web Admin không sửa món');
    expect(await press(page, 'Đóng', 'document.querySelector(".dialog")')).toBe(true);
    await page.waitFor(`!document.querySelector('.dialog')`);
    expect(await press(page, 'Xem như khách')).toBe(true);
    await page.waitFor(`document.querySelector('.dialog') && document.querySelector('.dialog').innerText.includes('Phở bò tái')`);
    const preview = await page.evaluate<string>(`document.querySelector('.dialog').innerText`);
    expect(preview).toContain('Trà đá');
    expect(preview).not.toContain('Phở gà ẩn');
    expect(preview).not.toContain('0900111222');
    await shot(page, 'shop-preview-desktop');
    expect(await press(page, 'Đóng', 'document.querySelector(".dialog")')).toBe(true);
    await tab(page, 'history');
    await page.waitFor(`document.body.innerText.includes('Chưa có lịch sử quản lý')`);
    await page.goto(`${origin}/operations/shops/${idA}?tab=menu`);
    await page.waitFor(`document.querySelectorAll('.table tbody tr').length === 3`);

    // The right "Quản lý hoạt động quán" in the screens that grant rights: its own switch next to "Khóa tài khoản" (label unchanged), off without VIEW.
    await page.goto(`${origin}/accounts/access`);
    await page.waitFor(`[...document.querySelectorAll('button')].some((b) => b.getAttribute('aria-label') === ${JSON.stringify(`Phân quyền cho Quản trị quán ${tag}`)})`);
    await page.evaluate(`[...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === ${JSON.stringify(`Phân quyền cho Quản trị quán ${tag}`)}).click()`);
    await page.waitFor(`document.querySelector('#access-editor') && !document.querySelector('#access-editor').hidden && document.querySelector('#access-editor').innerText.includes('Quản lý hoạt động quán')`);
    const editor = await page.evaluate<string>(`document.querySelector('#access-editor').innerText`);
    expect(editor).toContain('Khóa tài khoản');
    expect(editor).toContain('Quản lý nhóm món');
    expect(await page.evaluate<boolean>(`(() => { const box = [...document.querySelectorAll('#access-editor label')].find((l) => l.textContent.includes('Quản lý hoạt động quán')).querySelector('input'); return box.checked && !box.disabled; })()`)).toBe(true);
    await shot(page, 'access-shop-right-desktop');
    await page.goto(`${origin}/invitations/new`);
    await page.waitFor(`document.querySelector('#p-SHOP-canManageShops')`);
    expect(await page.evaluate<boolean>(`document.querySelector('#p-SHOP-canManageShops').checked === false`)).toBe(true);
    await page.evaluate(`document.querySelector('#p-SHOP-canManageShops').click()`);
    expect(await page.evaluate<boolean>(`document.querySelector('#p-SHOP-canManageShops').checked && document.querySelector('#p-SHOP-canView').checked && !document.querySelector('#p-SHOP-canLock').checked`)).toBe(true);
    await shot(page, 'invitation-shop-right-desktop');

    // Phone-sized: no sideways scroll on the list, the detail and the tabs.
    await page.viewport(390, 844, true);
    await page.goto(`${origin}/operations/shops`);
    await page.waitFor(`document.querySelector('#shop-title') && document.querySelectorAll('.table tbody tr').length >= 1`);
    expect(await noSideways(page)).toBe(true);
    await shot(page, 'shops-list-phone');
    await page.goto(`${origin}/operations/shops/${idA}`);
    await page.waitFor(`document.querySelector('#shop-detail-title')`);
    expect(await noSideways(page)).toBe(true);
    await shot(page, 'shop-detail-phone');
    await tab(page, 'menu');
    await page.waitFor(`document.querySelectorAll('.table tbody tr').length === 3`);
    expect(await noSideways(page)).toBe(true);
    await shot(page, 'shop-menu-phone');
    await page.close();
  }, 300_000);

  it('ADMIN with only VIEW reads but is offered no action; ADMIN without the SHOP right sees no entry', async () => {
    const page: Page = await (browser as Browser).newPage();
    await page.viewport(1280, 900, false);
    await page.send('Network.clearBrowserCookies');
    await signIn(page, { phone: viewerAdmin.phone, password: ADMIN_PASSWORD, userId: viewerAdmin.userId, secret: viewerAdmin.secret });
    await page.waitFor(`!!document.querySelector('a[href="/operations/shops"]')`);
    await page.goto(`${origin}/operations/shops/${idA}`);
    await page.waitFor(`document.querySelector('#shop-detail-title')`);
    expect(await page.evaluate<boolean>(`![...document.querySelectorAll('button')].some((b) => ['Vô hiệu hóa quán', 'Kích hoạt lại'].includes(b.textContent.trim()))`)).toBe(true);
    await shot(page, 'shop-detail-viewer-admin');
    await page.close();
    // The account-lock right alone gives no shop action either.
    const lockPage: Page = await (browser as Browser).newPage();
    await lockPage.viewport(1280, 900, false);
    await lockPage.send('Network.clearBrowserCookies');
    await signIn(lockPage, { phone: lockAdmin.phone, password: ADMIN_PASSWORD, userId: lockAdmin.userId, secret: lockAdmin.secret });
    await lockPage.waitFor(`!!document.querySelector('a[href="/operations/shops"]')`);
    await lockPage.goto(`${origin}/operations/shops/${idA}`);
    await lockPage.waitFor(`document.querySelector('#shop-detail-title')`);
    expect(await lockPage.evaluate<boolean>(`![...document.querySelectorAll('button')].some((b) => ['Vô hiệu hóa quán', 'Kích hoạt lại'].includes(b.textContent.trim()))`)).toBe(true);
    await lockPage.close();
  }, 120_000);

  it('ADMIN with the shop-management right: unfinished work blocks the disable (re-counted by the backend); disable needs a reason; a lost answer locks the popup and the retry is the SAME request; a conflict keeps the reason; enable does not force the shop open', async () => {
    const page: Page = await (browser as Browser).newPage();
    await page.viewport(1280, 900, false);
    await page.send('Network.clearBrowserCookies');
    await signIn(page, { phone: managerAdmin.phone, password: ADMIN_PASSWORD, userId: managerAdmin.userId, secret: managerAdmin.secret });
    await page.waitFor(`!!document.querySelector('a[href="/operations/shops"]')`);
    // A running order is added: the popup says so and refuses; disabling never touches the order.
    await addOrder('PREPARING', `#${tag}B1`);

    await page.goto(`${origin}/operations/shops/${idA}`);
    await page.waitFor(`document.querySelector('#shop-detail-title')`);
    expect(await press(page, 'Vô hiệu hóa quán')).toBe(true);
    await page.waitFor(`document.querySelector('.dialog')`);
    // Orders not finished: the popup says so with the figures and the confirm button is off; nothing can be sent.
    const blockedText = await page.evaluate<string>(`document.querySelector('.dialog').innerText`);
    expect(blockedText).toContain('Quán còn đơn hoặc giao hàng chưa kết thúc. Hãy xử lý xong trước khi vô hiệu hóa.');
    expect(blockedText).toContain('Đơn chưa kết thúc: 1 (chờ xác nhận 0, đang chuẩn bị 1). Lượt giao đang chạy: 0.');
    expect(await page.evaluate<boolean>(`[...document.querySelectorAll('.dialog button')].find((b) => b.textContent.trim() === 'Vô hiệu hóa').disabled`)).toBe(true);
    await shot(page, 'shop-disable-blocked-desktop');
    expect(await press(page, 'Hủy', 'document.querySelector(".dialog")')).toBe(true);
    await page.waitFor(`!document.querySelector('.dialog')`);
    expect((await shopRow(idA)).status).toBe('ACTIVE');
    // The order ends; the page is read again and offers the disable. A NEW order appears before the person confirms: the backend counts again under
    // the lock, refuses, the popup reads the shop again and shows what blocks it now. The order is not touched.
    await finishOrders();
    await page.goto(`${origin}/operations/shops/${idA}`);
    await page.waitFor(`document.querySelector('#shop-detail-title')`);
    expect(await press(page, 'Vô hiệu hóa quán')).toBe(true);
    await page.waitFor(`document.querySelector('.dialog') && document.querySelector('.dialog').innerText.includes('Hiện không còn đơn hoặc giao hàng chưa kết thúc')`);
    await page.fill('#shop-reason', 'Quán vi phạm quy định bán hàng');
    await addOrder('PENDING_CONFIRMATION', `#${tag}B2`);
    const sameBefore = await shopRow(idA);
    expect(await press(page, 'Vô hiệu hóa', 'document.querySelector(".dialog")')).toBe(true);
    await page.waitFor(`document.querySelector('#shop-command-status').textContent.includes('Quán còn đơn hoặc giao hàng chưa kết thúc')`);
    await page.waitFor(`document.querySelector('.dialog').innerText.includes('Đơn chưa kết thúc: 1 (chờ xác nhận 1, đang chuẩn bị 0)')`);
    expect(await shopRow(idA)).toEqual(sameBefore);
    expect(await audits(idA, 'admin.shop.disable.v1')).toBe(0);
    expect(await page.evaluate<string>(`document.querySelector('#shop-reason').value`)).toBe('Quán vi phạm quy định bán hàng');
    expect((await app.pool.query<{ status: string }>(`SELECT status FROM app.orders WHERE code = $1`, [`#${tag}B2`])).rows[0]?.status).toBe('PENDING_CONFIRMATION');
    expect(await press(page, 'Hủy', 'document.querySelector(".dialog")')).toBe(true);
    await finishOrders();
    await page.goto(`${origin}/operations/shops/${idA}`);
    await page.waitFor(`document.querySelector('#shop-detail-title')`);
    expect(await press(page, 'Vô hiệu hóa quán')).toBe(true);
    await page.waitFor(`document.querySelector('.dialog') && document.querySelector('.dialog').innerText.includes('Hiện không còn đơn hoặc giao hàng chưa kết thúc')`);
    await shot(page, 'shop-disable-dialog-desktop');
    // No reason: refused on the page, nothing is sent.
    const before = await shopRow(idA);
    expect(await press(page, 'Vô hiệu hóa', 'document.querySelector(".dialog")')).toBe(true);
    await page.waitFor(`document.querySelector('#shop-reason-error').textContent.includes('Lý do là bắt buộc')`);
    expect(await shopRow(idA)).toEqual(before);
    // The answer is lost (the browser goes offline): the popup freezes, Cancel and Esc do nothing, the reason cannot be edited, the page behind is locked.
    await page.fill('#shop-reason', 'Quán vi phạm quy định bán hàng');
    await page.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    expect(await press(page, 'Vô hiệu hóa', 'document.querySelector(".dialog")')).toBe(true);
    await page.waitFor(`[...document.querySelectorAll('.dialog button')].some((b) => b.textContent.trim() === 'Thử lại')`);
    expect(await page.evaluate<boolean>(`document.querySelector('#shop-reason').disabled && [...document.querySelectorAll('.dialog button')].find((b) => b.textContent.trim() === 'Hủy').disabled`)).toBe(true);
    expect(await page.evaluate<boolean>(`[...document.querySelectorAll('.tabs button, .detail-actions button')].every((b) => b.disabled)`)).toBe(true);
    expect(await page.evaluate<string>(`document.querySelector('#shop-command-status').textContent`)).toContain('Chưa xác nhận được kết quả');
    await page.evaluate(`document.querySelector('.dialog-overlay').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    expect(await page.evaluate<boolean>(`!!document.querySelector('.dialog')`)).toBe(true);
    await shot(page, 'shop-disable-unknown-desktop');
    expect(await shopRow(idA)).toEqual(before);
    // Back online: the retry is the same request (one change, one audit row), then the page shows the new state.
    await page.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    expect(await press(page, 'Thử lại', 'document.querySelector(".dialog")')).toBe(true);
    await page.waitFor(`!document.querySelector('.dialog') && document.body.innerText.includes('Đã vô hiệu hóa')`);
    expect(await shopRow(idA)).toEqual({ status: 'DISABLED', version: before.version + 1 });
    expect(await audits(idA, 'admin.shop.disable.v1')).toBe(1);
    expect((await app.pool.query<{ status: string }>(`SELECT status FROM app.orders WHERE shop_id = $1::uuid AND code = $2`, [idA, `#${tag}B1`])).rows[0]?.status).toBe('COMPLETED');
    expect((await app.pool.query<{ status: string }>('SELECT status FROM app.users WHERE user_id = $1::uuid', [ownerA])).rows[0]?.status).toBe('ACTIVE');
    await shot(page, 'shop-disabled-desktop');
    // The history tab shows who, when, the reason, before / after and the version.
    await tab(page, 'history');
    await page.waitFor(`document.body.innerText.includes('Quản trị viên vô hiệu hóa quán')`);
    const history = await page.evaluate<string>(`document.body.innerText`);
    for (const expected of ['Quán vi phạm quy định bán hàng', `Quản trị quán ${tag}`, 'Đang hoạt động → Đã vô hiệu hóa', `phiên bản ${String(before.version + 1)}`]) {
      expect(history).toContain(expected);
    }
    await shot(page, 'shop-history-desktop');
    // The customer preview of a disabled shop says customers cannot see it.
    await tab(page, 'menu');
    await page.waitFor(`document.querySelectorAll('.table tbody tr').length === 3`);
    expect(await press(page, 'Xem như khách')).toBe(true);
    await page.waitFor(`document.querySelector('.dialog') && document.querySelector('.dialog').innerText.includes('Khách hiện không xem được quán này')`);
    expect(await press(page, 'Đóng', 'document.querySelector(".dialog")')).toBe(true);

    // Enable: another administrator changes the shop while the popup is open -> conflict, the typed reason stays, the new state must be read first.
    await app.pool.query(`UPDATE app.shops SET version = version + 1 WHERE shop_id = $1::uuid`, [idA]);
    expect(await press(page, 'Kích hoạt lại')).toBe(true);
    await page.waitFor(`document.querySelector('.dialog')`);
    await app.pool.query(`UPDATE app.shops SET version = version + 1 WHERE shop_id = $1::uuid`, [idA]);
    await page.fill('#shop-reason', 'Đã bổ sung hồ sơ');
    expect(await press(page, 'Kích hoạt lại', 'document.querySelector(".dialog")')).toBe(true);
    await page.waitFor(`[...document.querySelectorAll('.dialog button')].some((b) => b.textContent.trim() === 'Đọc trạng thái mới')`);
    expect(await page.evaluate<string>(`document.querySelector('#shop-reason').value`)).toBe('Đã bổ sung hồ sơ');
    expect(await shopRow(idA)).toMatchObject({ status: 'DISABLED' });
    expect(await audits(idA, 'admin.shop.enable.v1')).toBe(0);
    expect(await press(page, 'Đọc trạng thái mới', 'document.querySelector(".dialog")')).toBe(true);
    await page.waitFor(`[...document.querySelectorAll('.dialog button')].some((b) => b.textContent.trim() === 'Kích hoạt lại' && !b.disabled)`);
    expect(await page.evaluate<string>(`document.querySelector('#shop-reason').value`)).toBe('Đã bổ sung hồ sơ');
    // The schedule has no interval covering "now" for sure? Make it closed all week to prove the enable does not force the shop open.
    await app.pool.query(`DELETE FROM app.shop_business_hours WHERE shop_id = $1::uuid`, [idA]);
    expect(await press(page, 'Kích hoạt lại', 'document.querySelector(".dialog")')).toBe(true);
    await page.waitFor(`!document.querySelector('.dialog') && document.body.innerText.includes('Đã kích hoạt lại quán')`);
    expect((await shopRow(idA)).status).toBe('ACTIVE');
    expect(await page.evaluate<string>(`document.querySelector('.detail-status').innerText`)).toContain('Chưa thiết lập · chưa có lịch');
    expect(await audits(idA, 'admin.shop.enable.v1')).toBe(1);
    await page.close();
  }, 300_000);
});
