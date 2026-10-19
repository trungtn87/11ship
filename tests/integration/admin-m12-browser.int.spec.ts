import { createHash, randomBytes, X509Certificate } from 'node:crypto';
import { ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ADMIN_ORIGIN, AdminApp, rewindAcceptedStep, startAdminApp, totpNow } from './support/admin-fixtures';
import { freePort, repoRoot, runScript, startFront } from './support/admin-web-harness';
import { Browser, launchChrome, Page } from './support/cdp';
import { createActiveShopFor } from './support/auth-fixtures';
import { ActivatedAdmin, activatedAdmin, permission, purgeDeliveriesOfShops, purgeGrants, seedDelivery } from './support/m12-fixtures';
import { systemSession, SystemSession } from './support/provisioning-fixtures';

// M12 on the Administration web in a REAL Chrome against the real front, backend and PostgreSQL (desktop size 1440x900 and a narrow check at 390 wide).
// Screenshots of the real pages go to .test-results/admin-m12-shots.

const tag = randomBytes(2).toString('hex').toUpperCase();

describe('M12 administration web (real browser)', () => {
  let app: AdminApp;
  let system: SystemSession;
  let front: ChildProcess | undefined;
  let browser: Browser | undefined;
  let origin = '';
  let tlsDir = '';
  let shopId = '';
  let viewer: ActivatedAdmin;
  const shots: Array<{ name: string; data: Buffer }> = [];

  const shot = async (page: Page, name: string): Promise<void> => {
    shots.push({ name, data: await page.screenshot() });
  };

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

  beforeAll(async () => {
    runScript('admin-web-build.mjs');
    tlsDir = mkdtempSync(join(tmpdir(), 'admin-m12-tls-'));
    runScript('admin-web-cert.mjs', [tlsDir, '1']);
    const certPath = join(tlsDir, 'cert.pem');
    const spki = new X509Certificate(readFileSync(certPath)).publicKey.export({ type: 'spki', format: 'der' });
    const spkiHash = createHash('sha256').update(spki).digest('base64');
    const port = await freePort();
    origin = `https://localhost:${String(port)}`;
    app = await startAdminApp({ allowedOrigins: [origin, ADMIN_ORIGIN], activationDisabledTest: true });
    front = await startFront({ ADMIN_WEB_PORT: String(port), ADMIN_WEB_HOST: 'localhost', ADMIN_WEB_BACKEND: app.running.baseUrl, ADMIN_WEB_TLS_CERT: certPath, ADMIN_WEB_TLS_KEY: join(tlsDir, 'key.pem') });
    browser = await launchChrome(spkiHash);
    system = await systemSession(app);
    // Administrators exist before any browser login: a SYSTEM login in the page ends the earlier SYSTEM session.
    viewer = await activatedAdmin(app, system, [permission('DRIVER')], `Xem điều hành ${tag}`);
    shopId = await createActiveShopFor(app.pool, system.account.userId);
    await seedDelivery(app.pool, { shopId, userId: system.account.userId });
    await seedDelivery(app.pool, { shopId, userId: system.account.userId, state: 'search_stopped' });
  }, 300_000);

  afterAll(async () => {
    const directory = join(repoRoot(), '.test-results', 'admin-m12-shots');
    mkdirSync(directory, { recursive: true });
    for (const item of shots) {
      writeFileSync(join(directory, `${item.name}.png`), item.data);
    }
    await browser?.close();
    front?.kill('SIGTERM');
    if (app !== undefined) {
      await purgeDeliveriesOfShops(app.pool, [shopId]);
      await purgeGrants(app.pool);
      await app.pool.query('DELETE FROM app.shop_members WHERE shop_id = $1::uuid', [shopId]);
      await app.pool.query('DELETE FROM app.shops WHERE shop_id = $1::uuid', [shopId]);
      await app.close();
    }
    if (tlsDir !== '') {
      rmSync(tlsDir, { recursive: true, force: true });
    }
  });

  const cards = (page: Page): Promise<string[]> => page.evaluate<string[]>(`[...document.querySelectorAll('.ov-card')].map((c) => c.textContent.replace(/\\s+/g, ' ').trim())`);

  it('M12-A: the overview shows period and current figures, honest "not built" and "no right" cards, and its tiles open the matching list', async () => {
    const page: Page = await (browser as Browser).newPage();
    await page.viewport(1440, 900, false);
    await page.send('Network.clearBrowserCookies');
    await signIn(page, { phone: system.account.phone, password: system.account.password, userId: system.account.userId, secret: system.login.secret });
    expect(await page.evaluate<boolean>(`!!document.querySelector('a[href="/overview"]')`)).toBe(true);
    await page.goto(`${origin}/overview`);
    await page.waitFor(`document.querySelector('#overview-title') && document.querySelectorAll('.ov-card').length >= 10`);
    const text = await page.evaluate<string>(`document.body.innerText`);
    for (const expected of ['Phát sinh trong kỳ', 'Trạng thái hiện tại', 'Việc cần xử lý', 'Order phát sinh', 'Delivery tạo mới', 'Quán đang nhận đơn', 'Tổng số dư ví', 'giờ Việt Nam', 'Order (M10) chưa được xây dựng', 'Rút tiền (M04-C) chưa được xây dựng', 'Phản ánh (M11) chưa được xây dựng']) {
      expect(text).toContain(expected);
    }
    // The stamp names the Vietnam clock and a time.
    expect(await page.text('#overview-stamp')).toMatch(/^Cập nhật lúc \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2} \(giờ Việt Nam\)$/);
    await shot(page, 'm12a-overview-desktop');

    // A figure that is not built is a dash with its reason, never 0.
    const order = (await cards(page)).find((card) => card.startsWith('Order phát sinh')) as string;
    expect(order).toContain('—');
    expect(order).not.toMatch(/\b0\b/);

    // The "stopped" work item opens the delivery list already filtered, and the list's own total is the tile's number.
    const stoppedCount = await page.evaluate<number>(`Number([...document.querySelectorAll('.ov-todo-row')].find((r) => r.textContent.includes('ngừng tìm')).querySelector('.ov-todo-count').textContent.replace(/\\D/g, ''))`);
    expect(stoppedCount).toBeGreaterThanOrEqual(1);
    await page.evaluate(`[...document.querySelectorAll('.ov-todo-row')].find((r) => r.textContent.includes('ngừng tìm')).querySelector('button').click()`);
    await page.waitFor(`location.pathname === '/operations/deliveries' && location.search.includes('group=stopped') && document.querySelector('#delivery-count')`);
    expect(await page.text('#delivery-count')).toContain(`/ ${String(stoppedCount)} yêu cầu giao`);
    expect(await page.evaluate<string>(`document.querySelector('.linked-filter').textContent`)).toContain('Đã ngừng tìm, chưa gọi lại');
    await shot(page, 'm12a-overview-link-to-list');

    // Range switch: "Hôm qua" and a custom range reload; an invalid custom range is refused before any request.
    await page.goto(`${origin}/overview`);
    await page.waitFor(`document.querySelectorAll('.ov-card').length >= 10`);
    expect(await page.evaluate<boolean>(`(() => { [...document.querySelectorAll('.ov-range')].find((b) => b.textContent === 'Hôm qua').click(); return true; })()`)).toBe(true);
    await page.waitFor(`document.querySelector('#ov-period-title') && document.body.innerText.includes('Kỳ: ') && document.querySelector('.ov-range[aria-pressed="true"]').textContent === 'Hôm qua'`);
    await page.evaluate(`[...document.querySelectorAll('.ov-range')].find((b) => b.textContent === 'Tùy chọn').click()`);
    await page.waitFor(`!document.querySelector('.ov-custom').hidden`);
    await page.evaluate(`(() => { const f = document.querySelector('#overview-from'); f.value = '2020-01-01'; const t = document.querySelector('#overview-to'); t.value = '2020-12-31'; return true; })()`);
    await page.evaluate(`[...document.querySelectorAll('.ov-custom button')].find((b) => b.textContent === 'Áp dụng').click()`);
    await page.waitFor(`document.body.innerText.includes('Khoảng thời gian tối đa là 92 ngày')`);
    await shot(page, 'm12a-overview-custom-range-error');
    await page.close();
  }, 120_000);

  it('M12-A: an ADMIN with only DRIVER view sees deliveries and Shipper figures, and the money and shop figures say they are not allowed (not 0)', async () => {
    const page: Page = await (browser as Browser).newPage();
    await page.viewport(1440, 900, false);
    await page.send('Network.clearBrowserCookies');
    await signIn(page, { phone: viewer.phone, password: 'Correct-Horse-Battery-9', userId: viewer.userId, secret: viewer.secret });
    await page.goto(`${origin}/overview`);
    await page.waitFor(`document.querySelector('#overview-title') && document.querySelectorAll('.ov-card').length >= 10`);
    const all = await cards(page);
    const find = (label: string): string => all.find((card) => card.startsWith(label)) as string;
    expect(find('Tổng số dư ví')).toContain('Bạn không có quyền xem số này');
    expect(find('Quán đang nhận đơn')).toContain('Bạn không có quyền xem số này');
    expect(find('Hoa hồng đã thu')).toContain('Bạn không có quyền xem số này');
    expect(find('Delivery tạo mới')).not.toContain('không có quyền');
    expect(find('Shipper bật nhận đơn')).not.toContain('không có quyền');
    await shot(page, 'm12a-overview-admin-limited');
    // Narrow screen: no horizontal scroll, cards stack.
    await page.viewport(390, 844, true);
    await page.waitFor(`document.documentElement.clientWidth <= 400`);
    expect(await page.evaluate<boolean>(`document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1`)).toBe(true);
    await shot(page, 'm12a-overview-phone');
    await page.close();
  }, 120_000);

  const press = (page: Page, text: string, within = 'document'): Promise<boolean> =>
    page.evaluate<boolean>(`(() => { const b = [...${within}.querySelectorAll('button')].find((x) => (x.textContent ?? '').trim() === ${JSON.stringify(text)} && !x.disabled); if (!b) return false; b.click(); return true; })()`);

  it('M12-C: SYSTEM changes a right and an application permission from the matrix with a reason; the change is stored and audited; an ADMIN cannot open the page', async () => {
    const page: Page = await (browser as Browser).newPage();
    await page.viewport(1440, 900, false);
    await page.send('Network.clearBrowserCookies');
    await signIn(page, { phone: system.account.phone, password: system.account.password, userId: system.account.userId, secret: system.login.secret });
    await page.goto(`${origin}/accounts/access`);
    await page.waitFor(`document.querySelector('#access-title') && [...document.querySelectorAll('.table tbody tr')].some((r) => r.textContent.includes(${JSON.stringify(`Xem điều hành ${tag}`)}))`);
    await shot(page, 'm12c-access-matrix-desktop');
    expect(await page.evaluate<boolean>(`(() => { const row = [...document.querySelectorAll('.table tbody tr')].find((r) => r.textContent.includes(${JSON.stringify(`Xem điều hành ${tag}`)})); row.querySelector('button').click(); return true; })()`)).toBe(true);
    await page.waitFor(`document.querySelector('#access-editor') && !document.querySelector('#access-editor').hidden && document.querySelector('#access-save')`);
    expect(await page.evaluate<boolean>(`document.querySelector('#access-save').disabled`)).toBe(true); // nothing changed yet
    // Switch on "Xem báo cáo" and the DRIVER "Khóa" switch.
    await page.evaluate(`(() => { const click = (label) => { const l = [...document.querySelectorAll('#access-editor label.check')].find((x) => x.textContent.includes(label)); l.querySelector('input').click(); }; click('Xem báo cáo'); click('Khóa: khóa shipper'); return true; })()`);
    await page.waitFor(`!document.querySelector('#access-save').disabled`);
    await shot(page, 'm12c-access-editor-desktop');
    await press(page, 'Xem lại và lưu');
    await page.waitFor(`document.querySelector('.dialog')`);
    // A reason is required: confirming without it sends nothing.
    await press(page, 'Xác nhận lưu', "document.querySelector('.dialog')");
    await page.waitFor(`document.querySelector('.dialog .message-error') && !document.querySelector('.dialog .message-error').hidden`);
    expect(await app.pool.query(`SELECT 1 FROM app.admin_finance_grants WHERE user_id = $1::uuid`, [viewer.userId]).then((r) => r.rowCount)).toBe(0);
    await page.fill('.dialog textarea', 'Phụ trách báo cáo và khóa shipper vi phạm');
    await press(page, 'Xác nhận lưu', "document.querySelector('.dialog')");
    await page.waitFor(`!document.querySelector('.dialog') && document.body.innerText.includes('Đã lưu quyền')`);
    const grant = await app.pool.query(`SELECT state FROM app.admin_finance_grants WHERE user_id = $1::uuid AND permission_key = 'report.read'`, [viewer.userId]);
    expect(grant.rows).toEqual([{ state: 'GRANTED' }]);
    const permissions = await app.pool.query(`SELECT can_lock FROM app.admin_app_permissions WHERE user_id = $1::uuid AND app = 'DRIVER'`, [viewer.userId]);
    expect(permissions.rows).toEqual([{ can_lock: true }]);
    expect((await app.pool.query(`SELECT metadata FROM app.audit_logs WHERE action = 'admin.access.permissions.update.v1' AND resource_id = $1`, [viewer.userId])).rows[0].metadata.reason).toBe('Phụ trách báo cáo và khóa shipper vi phạm');
    await shot(page, 'm12c-access-saved');
    await page.close();

    const adminPage: Page = await (browser as Browser).newPage();
    await adminPage.viewport(1440, 900, false);
    await adminPage.send('Network.clearBrowserCookies');
    await signIn(adminPage, { phone: viewer.phone, password: 'Correct-Horse-Battery-9', userId: viewer.userId, secret: viewer.secret });
    expect(await adminPage.evaluate<boolean>(`!!document.querySelector('a[href="/accounts/access"]')`)).toBe(false);
    await adminPage.goto(`${origin}/accounts/access`);
    await adminPage.waitFor(`document.body.innerText.includes('Không có quyền')`);
    await adminPage.close();
  }, 120_000);
});
