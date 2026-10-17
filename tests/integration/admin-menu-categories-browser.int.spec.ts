import { createHash, randomBytes, randomUUID, X509Certificate } from 'node:crypto';
import { ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ADMIN_ORIGIN, ADMIN_PASSWORD, AdminApp, adminData, count, rewindAcceptedStep, startAdminApp, totpNow } from './support/admin-fixtures';
import { begin, ok, post } from './support/activation-fixtures';
import { freePort, repoRoot, runScript, startFront } from './support/admin-web-harness';
import { Browser, launchChrome, Page } from './support/cdp';
import { Phone, randomPhone } from './support/auth-fixtures';
import { createInvitation, createPayload, systemSession, SystemSession } from './support/provisioning-fixtures';

// M02 dish groups in a REAL Chrome against the real front, backend and PostgreSQL: the screen a SYSTEM or catalog-ADMIN uses (list, search,
// filter, paging, add, edit, switch off with its confirmation, switch on, duplicate refusal, a conflict with the SQL-made group), the menu entry an
// ADMIN without the right never sees, and a phone-sized layout. Screenshots of the real pages go to .test-results/admin-group-shots.

const tag = randomBytes(2).toString('hex').toUpperCase();
const NAMES = ['Ốc', 'Hải sản', 'Món nướng', 'Ăn vặt', 'Đồ uống', 'Món theo mùa'] as const;
const FILLER = 'Nhóm thử';

interface Shot {
  readonly name: string;
  readonly data: Buffer;
}

describe('admin dish groups (real browser)', () => {
  let app: AdminApp;
  let system: SystemSession;
  let front: ChildProcess | undefined;
  let browser: Browser | undefined;
  let origin = '';
  let tlsDir = '';
  const shots: Shot[] = [];
  let withRight: { phone: Phone; userId: string; secret: string };
  let without: { phone: Phone; userId: string; secret: string };

  async function activatedAdmin(permissions: Record<string, unknown>[], fullName: string): Promise<{ phone: Phone; userId: string; secret: string }> {
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

  async function groupRow(name: string): Promise<{ status: string; sort_order: number; version: number } | undefined> {
    const result = await app.pool.query<{ status: string; sort_order: number; version: string }>(
      'SELECT status, sort_order, version::text AS version FROM app.menu_categories WHERE name = $1',
      [name],
    );
    const found = result.rows[0];
    return found === undefined ? undefined : { status: found.status, sort_order: found.sort_order, version: Number(found.version) };
  }

  /** The groups this suite makes (and the ones it renames), removed when no dish uses them. */
  const cleanup = async (): Promise<void> => {
    await app.pool.query(
      `DELETE FROM app.menu_categories c
        WHERE (c.name = ANY($1::text[]) OR c.name LIKE $2 OR c.name LIKE $3 OR c.name LIKE $4)
          AND NOT EXISTS (SELECT 1 FROM app.menu_items i WHERE i.category_id = c.category_id)`,
      [[...NAMES, 'Hải Sản Đặc Biệt', 'Ăn vặt mới'], `${FILLER}%`, 'Món chay%', `%${tag}%`],
    );
  };

  beforeAll(async () => {
    runScript('admin-web-build.mjs');
    tlsDir = mkdtempSync(join(tmpdir(), 'admin-groups-tls-'));
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
    // The administrators exist before any browser login: a SYSTEM login in the page ends the earlier SYSTEM session.
    withRight = await activatedAdmin([{ app: 'SHOP', can_view: true, can_review_profile: false, can_lock: false, can_manage_catalog: true }], `Quản trị Nhóm món ${tag}`);
    without = await activatedAdmin([{ app: 'SHOP', can_view: true, can_review_profile: false, can_lock: false }], `Quản trị Quán ${tag}`);
    // Groups the way the operator made them before this screen existed: by SQL, with their own order and status.
    await cleanup();
    for (const [index, name] of NAMES.entries()) {
      await app.pool.query(
        `INSERT INTO app.menu_categories (category_id, name, status, sort_order, created_at, updated_at) VALUES ($1::uuid, $2, $3, $4, clock_timestamp(), clock_timestamp())`,
        [randomUUID(), name, name === 'Món theo mùa' ? 'INACTIVE' : 'ACTIVE', index + 1],
      );
    }
  }, 300_000);

  afterAll(async () => {
    const directory = join(repoRoot(), '.test-results', 'admin-group-shots');
    mkdirSync(directory, { recursive: true });
    for (const item of shots) {
      writeFileSync(join(directory, `${item.name}.webp`), item.data);
    }
    await browser?.close();
    front?.kill('SIGTERM');
    if (app !== undefined) {
      await cleanup();
      await app.close();
    }
    if (tlsDir !== '') {
      rmSync(tlsDir, { recursive: true, force: true });
    }
  });

  it('SYSTEM: list, search, filter, add, duplicate refusal, edit, switch off with the confirmation, switch on; phone layout', async () => {
    const page: Page = await (browser as Browser).newPage();
    await page.viewport(1280, 800, false);
    await page.send('Network.clearBrowserCookies');
    await signIn(page, { phone: system.account.phone, password: system.account.password, userId: system.account.userId, secret: system.login.secret });

    // The menu entry and the page.
    expect(await page.evaluate<boolean>(`!!document.querySelector('a[href="/catalog/categories"]') && document.body.innerText.includes('DANH MỤC')`)).toBe(true);
    await page.goto(`${origin}/catalog/categories`);
    await page.waitFor(`document.querySelector('#catalog-title') && document.querySelectorAll('.table tbody tr').length >= 6`);
    const first = await rowsText(page);
    expect(first.slice(0, 6)).toEqual([
      'Ốc | 1 | 0 | Đang dùng | SửaNgừng dùng',
      'Hải sản | 2 | 0 | Đang dùng | SửaNgừng dùng',
      'Món nướng | 3 | 0 | Đang dùng | SửaNgừng dùng',
      'Ăn vặt | 4 | 0 | Đang dùng | SửaNgừng dùng',
      'Đồ uống | 5 | 0 | Đang dùng | SửaNgừng dùng',
      'Món theo mùa | 6 | 0 | Ngừng dùng | SửaKích hoạt',
    ]);
    await shot(page, 'groups-list-desktop');

    // Search ignores case and marks; the filter narrows by status; clearing both restores the list.
    await page.fill('#catalog-search', 'AN VAT');
    await waitRows(page, `rows.length === 1 && rows[0].includes('Ăn vặt')`);
    await page.fill('#catalog-search', 'khong-co-nhom-nay');
    await page.waitFor(`document.body.innerText.includes('Không tìm thấy nhóm món')`);
    await page.fill('#catalog-search', '');
    await waitRows(page, `rows.length >= 6`);
    await page.evaluate(`(() => { const s = document.querySelector('#catalog-status'); s.value = 'INACTIVE'; s.dispatchEvent(new Event('change')); return true; })()`);
    await waitRows(page, `rows.length === 1 && rows[0].includes('Món theo mùa')`);
    await page.evaluate(`(() => { const s = document.querySelector('#catalog-status'); s.value = 'ALL'; s.dispatchEvent(new Event('change')); return true; })()`);
    await waitRows(page, `rows.length >= 6`);

    // Add: the popup opens with the next order, validation reports only, the form locks while saving.
    expect(await press(page, '+ Thêm nhóm')).toBe(true);
    await page.waitFor(`document.querySelector('#category-name') && document.querySelector('#category-order').value === '7'`);
    expect(await press(page, 'Lưu', 'document.querySelector(".dialog")')).toBe(true);
    await page.waitFor(`document.querySelector('#category-name-error').textContent.includes('Nhập tên nhóm')`);
    expect(await page.evaluate<string>(`document.querySelector('#category-name').value`)).toBe('');
    await shot(page, 'groups-add-validation-desktop');
    await page.fill('#category-name', '  Món   chay ');
    await page.fill('#category-order', 'abc');
    expect(await press(page, 'Lưu', 'document.querySelector(".dialog")')).toBe(true);
    await page.waitFor(`document.querySelector('#category-order-error').textContent.includes('số nguyên')`);
    expect(await page.evaluate<string>(`document.querySelector('#category-order').value`)).toBe('abc');
    expect(await groupRow('Món chay')).toBeUndefined();
    await page.fill('#category-order', '7');
    await shot(page, 'groups-add-desktop');
    expect(await press(page, 'Lưu', 'document.querySelector(".dialog")')).toBe(true);
    await page.waitFor(`!document.querySelector('.dialog') && document.body.innerText.includes('Đã thêm nhóm «Món chay».')`);
    await waitRows(page, `rows.some((r) => r.startsWith('Món chay'))`);
    expect(await groupRow('Món chay')).toEqual({ status: 'ACTIVE', sort_order: 7, version: 1 });
    expect(await count(app.pool, "SELECT 1 FROM app.audit_logs a JOIN app.menu_categories c ON c.category_id::text = a.resource_id WHERE a.action = 'admin.menu_category.create.v1' AND c.name = 'Món chay'")).toBe(1);

    // Duplicate: same name ignoring case and spaces is refused and the popup keeps what was typed; the inactive twin is named.
    expect(await press(page, '+ Thêm nhóm')).toBe(true);
    await page.waitFor(`document.querySelector('#category-name')`);
    await page.fill('#category-name', 'hải  SẢN');
    expect(await press(page, 'Lưu', 'document.querySelector(".dialog")')).toBe(true);
    await page.waitFor(`document.querySelector('#category-name-error').textContent.includes('trùng tên')`);
    expect(await page.evaluate<string>(`document.querySelector('#category-name').value`)).toBe('hải  SẢN');
    await shot(page, 'groups-add-duplicate-desktop');
    await page.fill('#category-name', 'món THEO mùa');
    expect(await press(page, 'Lưu', 'document.querySelector(".dialog")')).toBe(true);
    await page.waitFor(`document.querySelector('#category-twin') && document.querySelector('#category-name-error').textContent.includes('ngừng dùng')`);
    expect(await press(page, 'Hủy', 'document.querySelector(".dialog")')).toBe(true);
    await page.waitFor(`!document.querySelector('.dialog')`);
    // Marks distinguish: "Hai san" is a new group.
    expect(await groupRow('Hai san')).toBeUndefined();

    // Edit: rename and reorder.
    await page.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Sửa nhóm Hải sản'); b.click(); return true; })()`);
    await page.waitFor(`document.querySelector('#category-name') && document.querySelector('#category-name').value === 'Hải sản'`);
    await page.fill('#category-name', 'Hải Sản Đặc Biệt');
    await page.fill('#category-order', '2');
    await shot(page, 'groups-edit-desktop');
    expect(await press(page, 'Lưu', 'document.querySelector(".dialog")')).toBe(true);
    await page.waitFor(`!document.querySelector('.dialog') && document.body.innerText.includes('Đã lưu nhóm «Hải Sản Đặc Biệt».')`);
    expect(await groupRow('Hải Sản Đặc Biệt')).toEqual({ status: 'ACTIVE', sort_order: 2, version: 2 });

    // Switch off: the exact confirmation, nothing sent until confirmed, then the badge changes and the group moves after the active ones.
    await page.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Ngừng dùng nhóm Đồ uống'); b.click(); return true; })()`);
    await page.waitFor(`document.querySelector('#category-toggle-text')`);
    expect(await page.evaluate<string>(`document.querySelector('#category-toggle-text').textContent`)).toBe(
      'Ngừng dùng nhóm «Đồ uống»? Chủ quán sẽ không chọn được nhóm này cho món mới. Các món đang thuộc nhóm vẫn được giữ nguyên.',
    );
    await shot(page, 'groups-deactivate-desktop');
    expect(await press(page, 'Hủy', 'document.querySelector(".dialog")')).toBe(true);
    expect(await groupRow('Đồ uống')).toMatchObject({ status: 'ACTIVE', version: 1 });
    await page.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Ngừng dùng nhóm Đồ uống'); b.click(); return true; })()`);
    await page.waitFor(`document.querySelector('#category-toggle-text')`);
    expect(await press(page, 'Ngừng dùng', 'document.querySelector(".dialog")')).toBe(true);
    await page.waitFor(`!document.querySelector('.dialog') && document.body.innerText.includes('Đã ngừng dùng nhóm «Đồ uống».')`);
    expect(await groupRow('Đồ uống')).toMatchObject({ status: 'INACTIVE', version: 2 });
    await waitRows(page, `rows.findIndex((r) => r.startsWith('Đồ uống')) > rows.findIndex((r) => r.startsWith('Món chay'))`);
    await shot(page, 'groups-list-after-desktop');

    // Switch on again.
    await page.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Kích hoạt nhóm Đồ uống'); b.click(); return true; })()`);
    await page.waitFor(`document.querySelector('#category-toggle-text')`);
    expect(await press(page, 'Kích hoạt', 'document.querySelector(".dialog")')).toBe(true);
    await page.waitFor(`!document.querySelector('.dialog') && document.body.innerText.includes('Đã kích hoạt lại nhóm «Đồ uống».')`);
    expect(await groupRow('Đồ uống')).toMatchObject({ status: 'ACTIVE', version: 3 });

    // A stale popup: somebody else changed the group meanwhile -> conflict, the typed text stays, nothing is written.
    await page.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Sửa nhóm Ăn vặt'); b.click(); return true; })()`);
    await page.waitFor(`document.querySelector('#category-name')`);
    await app.pool.query(`UPDATE app.menu_categories SET version = version + 1, updated_at = clock_timestamp() WHERE name = 'Ăn vặt'`);
    await page.fill('#category-name', 'Ăn vặt mới');
    expect(await press(page, 'Lưu', 'document.querySelector(".dialog")')).toBe(true);
    await page.waitFor(`document.body.innerText.includes('Nhóm đã được thay đổi ở nơi khác')`);
    await shot(page, 'groups-conflict-desktop');
    expect(await groupRow('Ăn vặt')).toMatchObject({ version: 2 });
    expect(await press(page, 'Tải lại danh sách', 'document.querySelector(".dialog")')).toBe(true);
    await page.waitFor(`!document.querySelector('.dialog')`);
    // "Tải lại danh sách" closes the popup at once and reads the list again; the refresh button stays disabled until that read ends.
    await page.waitFor(`[...document.querySelectorAll('button')].some((x) => (x.textContent ?? '').trim() === 'Làm mới' && !x.disabled)`);

    // Paging: 12 more groups make 3 pages of 10.
    for (let index = 1; index <= 12; index += 1) {
      await app.pool.query(
        `INSERT INTO app.menu_categories (category_id, name, status, sort_order, created_at, updated_at) VALUES ($1::uuid, $2, 'ACTIVE', $3, clock_timestamp(), clock_timestamp())`,
        [randomUUID(), `${FILLER} ${String(index).padStart(2, '0')}`, 100 + index],
      );
    }
    expect(await press(page, 'Làm mới')).toBe(true);
    await page.waitFor(`document.querySelector('#catalog-count') && document.querySelector('#catalog-count').textContent.includes('/ 19 nhóm')`);
    expect(await page.evaluate<string>(`document.querySelector('#catalog-count').textContent`)).toBe('Hiển thị 1–10 / 19 nhóm');
    expect(await press(page, 'Sau', 'document.querySelector(".pager")')).toBe(true);
    await page.waitFor(`!!document.querySelector('#catalog-count') && document.querySelector('#catalog-count').textContent.startsWith('Hiển thị 11–19')`);
    expect(await page.evaluate<boolean>(`[...document.querySelectorAll('.pager button')].find((b) => b.textContent === 'Sau').disabled`)).toBe(true);
    await shot(page, 'groups-page2-desktop');

    // A phone-sized screen: no sideways scroll, every control named, the popup fits.
    await page.viewport(390, 844, true);
    await page.goto(`${origin}/catalog/categories`);
    await page.waitFor(`document.querySelectorAll('.table tbody tr').length >= 6`);
    expect(await page.evaluate<boolean>(`document.documentElement.scrollWidth <= window.innerWidth + 1`)).toBe(true);
    await shot(page, 'groups-list-mobile');
    expect(await press(page, '+ Thêm nhóm')).toBe(true);
    await page.waitFor(`document.querySelector('#category-name')`);
    expect(await page.evaluate<boolean>(`document.documentElement.scrollWidth <= window.innerWidth + 1 && document.querySelector('.dialog').getBoundingClientRect().right <= window.innerWidth + 1`)).toBe(true);
    await shot(page, 'groups-add-mobile');
    expect(await press(page, 'Hủy', 'document.querySelector(".dialog")')).toBe(true);
    expect(page.consoleErrors).toEqual([]);
    await page.close();
  }, 300_000);

  it('an ADMIN: the entry exists only with the catalog right, and a direct address without it is refused by the page and by the server', async () => {
    const page: Page = await (browser as Browser).newPage();
    await page.viewport(1280, 800, false);

    await page.send('Network.clearBrowserCookies');
    await signIn(page, { phone: withRight.phone, password: ADMIN_PASSWORD, userId: withRight.userId, secret: withRight.secret });
    await page.waitFor(`document.querySelector('a[href="/catalog/categories"]')`);
    expect(await page.evaluate<boolean>(`!document.querySelector('a[href="/accounts/administrators"]') && !document.querySelector('a[href="/system/settings"]')`)).toBe(true);
    await page.goto(`${origin}/catalog/categories`);
    await page.waitFor(`document.querySelector('#catalog-title') && document.querySelectorAll('.table tbody tr').length >= 6`);
    expect(await press(page, '+ Thêm nhóm')).toBe(true);
    await page.waitFor(`document.querySelector('#category-name')`);
    await page.fill('#category-name', `Nhóm ${tag} của ADMIN`);
    expect(await press(page, 'Lưu', 'document.querySelector(".dialog")')).toBe(true);
    await page.waitFor(`!document.querySelector('.dialog') && document.body.innerText.includes('Đã thêm nhóm')`);
    const audit = await app.pool.query<{ actor_type: string; actor_id: string }>(`SELECT actor_type, actor_id FROM app.audit_logs WHERE action = 'admin.menu_category.create.v1' AND metadata->>'to_name' = $1`, [`Nhóm ${tag} của ADMIN`]);
    expect(audit.rows).toEqual([{ actor_type: 'ADMIN', actor_id: withRight.userId }]);

    // Another ADMIN, same shop VIEW but no catalog right: no menu entry, the address shows "Không có quyền", the API says 403.
    await page.evaluate('fetch("/v1/admin-auth/logout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then(() => true)').catch(() => undefined);
    await app.pool.query('UPDATE app.admin_sessions SET revoked_at = clock_timestamp() WHERE user_id = $1::uuid AND revoked_at IS NULL', [withRight.userId]);
    await page.send('Network.clearBrowserCookies');
    await signIn(page, { phone: without.phone, password: ADMIN_PASSWORD, userId: without.userId, secret: without.secret });
    await page.waitFor(`document.querySelector('a[href="/accounts/users"]')`);
    expect(await page.evaluate<boolean>(`!document.querySelector('a[href="/catalog/categories"]')`)).toBe(true);
    await page.goto(`${origin}/catalog/categories`);
    await page.waitFor(`document.body.innerText.includes('Không có quyền')`);
    expect(await page.evaluate<number>(`fetch('/v1/admin/menu-categories').then((r) => r.status)`)).toBe(403);
    expect(await page.evaluate<boolean>(`!document.querySelector('#catalog-title')`)).toBe(true);
    await app.pool.query(`DELETE FROM app.menu_categories WHERE name = $1`, [`Nhóm ${tag} của ADMIN`]);
    await page.close();
  }, 300_000);
});
