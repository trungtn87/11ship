import { createHash, randomBytes, X509Certificate } from 'node:crypto';
import { purgeShopDisplayCodes } from './support/shop-display-fixtures';
import { ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ADMIN_ORIGIN, AdminApp, rewindAcceptedStep, startAdminApp, totpNow } from './support/admin-fixtures';
import { freePort, repoRoot, runScript, startFront } from './support/admin-web-harness';
import { Browser, launchChrome, Page } from './support/cdp';
import { createActiveShopFor } from './support/auth-fixtures';
import { AdminReportService } from '../../apps/backend/src/admin-reports/admin-report-service';
import { ActivatedAdmin, activatedAdmin, permission, purgeDeliveriesOfShops, purgeExportJobs, purgeGrants, seedDelivery } from './support/m12-fixtures';
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
      await purgeExportJobs(app.pool, [system.account.userId, viewer.userId]);
      await purgeGrants(app.pool);
      await app.pool.query('DELETE FROM app.shipper_wallet_parameter_changes');
      await app.pool.query('UPDATE app.shipper_wallet_parameters SET updated_by = NULL');
      await app.pool.query('DELETE FROM app.shop_members WHERE shop_id = $1::uuid', [shopId]);
      await purgeShopDisplayCodes(app.pool, [shopId]);
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
    for (const expected of ['Phát sinh trong kỳ', 'Trạng thái hiện tại', 'Việc cần xử lý', 'Order phát sinh', 'Delivery tạo mới', 'Quán đang nhận đơn', 'Tổng số dư ví', 'giờ Việt Nam', 'Hồ sơ quán không có bước duyệt']) {
      expect(text).toContain(expected);
    }
    // The stamp names the Vietnam clock and a time.
    expect(await page.text('#overview-stamp')).toMatch(/^Cập nhật lúc \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2} \(giờ Việt Nam\)$/);
    await shot(page, 'm12a-overview-desktop');

    // A figure that does not exist (the shop review step) is a dash with its reason, never 0.
    const shopReview = await page.evaluate<string>(`[...document.querySelectorAll('.ov-todo-row')].find((r) => r.textContent.includes('Hồ sơ quán')).textContent`);
    expect(shopReview).toContain('Hồ sơ quán không có bước duyệt');
    expect(shopReview).not.toMatch(/\b0\b/);

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

  it('M12-D: the configuration hub shows the owners\' values and the fixed rules; SYSTEM changes a value with a compared old/new and a reason, then reverts it as a new version; an ADMIN sees no edit', async () => {
    const page: Page = await (browser as Browser).newPage();
    await page.viewport(1440, 900, false);
    await page.send('Network.clearBrowserCookies');
    await signIn(page, { phone: system.account.phone, password: system.account.password, userId: system.account.userId, secret: system.login.secret });
    await page.goto(`${origin}/system/config`);
    await page.waitFor(`document.querySelector('#config-title') && document.querySelectorAll('.cfg-card').length === 6`);
    const text = await page.evaluate<string>(`document.body.innerText`);
    for (const expected of ['Bảo mật, OTP và chống spam', 'Quy tắc cố định (không phải tham số, không chỉnh được)', 'Bán kính tìm shipper', '3.000 m', 'Chờ gửi lại mã OTP', 'Bản đồ và GPS', 'Lưu trữ và sao lưu']) {
      expect(text).toContain(expected);
    }
    await shot(page, 'm12d-config-desktop');
    const before = (await app.pool.query(`SELECT int_value::text AS v FROM app.shipper_wallet_parameters WHERE param_key = 'topup_min_vnd'`)).rows[0].v as string;
    expect(await page.evaluate<boolean>(`(() => { const card = [...document.querySelectorAll('.cfg-card')].find((c) => c.textContent.includes('Shipper, ví và hoa hồng')); [...card.querySelectorAll('button')].find((b) => b.textContent === 'Sửa').click(); return true; })()`)).toBe(true);
    await page.waitFor(`document.querySelector('.dialog #cfg-f-topup_min_vnd')`);
    expect(await page.evaluate<boolean>(`document.querySelector('.dialog .btn-primary').disabled`)).toBe(true); // nothing changed yet
    await page.fill('#cfg-f-topup_min_vnd', String(Number(before) + 5000));
    await page.waitFor(`document.querySelector('.dialog .plain-list').textContent.includes('→')`);
    await shot(page, 'm12d-config-edit-compare');
    await press(page, 'Xác nhận lưu', "document.querySelector('.dialog')");
    await page.waitFor(`document.querySelector('.dialog .message-error') && !document.querySelector('.dialog .message-error').hidden`); // no reason: nothing sent
    expect((await app.pool.query(`SELECT int_value::text AS v FROM app.shipper_wallet_parameters WHERE param_key = 'topup_min_vnd'`)).rows[0].v).toBe(before);
    await page.fill('.dialog textarea', `Điều chỉnh mức nạp tối thiểu ${tag}`);
    await press(page, 'Xác nhận lưu', "document.querySelector('.dialog')");
    await page.waitFor(`!document.querySelector('.dialog') && document.body.innerText.includes('Đã lưu cấu hình')`);
    expect((await app.pool.query(`SELECT int_value::text AS v FROM app.shipper_wallet_parameters WHERE param_key = 'topup_min_vnd'`)).rows[0].v).toBe(String(Number(before) + 5000));
    // History with the reason, then revert as a new version.
    await page.evaluate(`(() => { const card = [...document.querySelectorAll('.cfg-card')].find((c) => c.textContent.includes('Shipper, ví và hoa hồng')); [...card.querySelectorAll('button')].find((b) => b.textContent === 'Lịch sử thay đổi').click(); return true; })()`);
    await page.waitFor(`document.body.innerText.includes('Lý do: Điều chỉnh mức nạp tối thiểu')`);
    await shot(page, 'm12d-config-history');
    await press(page, 'Hoàn nguyên giá trị này');
    await page.waitFor(`document.querySelector('.dialog #cfg-f-topup_min_vnd') && document.querySelector('.dialog').textContent.includes('Hoàn nguyên')`);
    expect(await page.evaluate<string>(`document.querySelector('#cfg-f-topup_min_vnd').value`)).toBe(before);
    await page.fill('.dialog textarea', `Hoàn nguyên mức nạp ${tag}`);
    await press(page, 'Xác nhận lưu', "document.querySelector('.dialog')");
    await page.waitFor(`!document.querySelector('.dialog') && document.body.innerText.includes('Đã lưu cấu hình')`);
    expect((await app.pool.query(`SELECT int_value::text AS v FROM app.shipper_wallet_parameters WHERE param_key = 'topup_min_vnd'`)).rows[0].v).toBe(before);
    expect((await app.pool.query(`SELECT count(*)::int AS n FROM app.audit_logs WHERE action = 'admin.shipper_wallet_parameters.update.v1' AND metadata ->> 'reason' IN ($1, $2)`, [`Điều chỉnh mức nạp tối thiểu ${tag}`, `Hoàn nguyên mức nạp ${tag}`])).rows[0].n).toBe(2);
    await page.close();

    const adminPage: Page = await (browser as Browser).newPage();
    await adminPage.viewport(1440, 900, false);
    await adminPage.send('Network.clearBrowserCookies');
    await signIn(adminPage, { phone: viewer.phone, password: 'Correct-Horse-Battery-9', userId: viewer.userId, secret: viewer.secret });
    await adminPage.goto(`${origin}/system/config`);
    await adminPage.waitFor(`document.querySelectorAll('.cfg-card').length === 6`);
    expect(await adminPage.evaluate<boolean>(`[...document.querySelectorAll('.cfg-card button')].every((b) => b.textContent !== 'Sửa')`)).toBe(true);
    await adminPage.close();
  }, 120_000);
  it('M12-E: SYSTEM reads each report with its moment and denominators, a number opens the list, exports a CSV in the background and downloads it; an ADMIN with the report right only cannot export', async () => {
    const page: Page = await (browser as Browser).newPage();
    await page.viewport(1440, 900, false);
    await page.send('Network.clearBrowserCookies');
    await signIn(page, { phone: system.account.phone, password: system.account.password, userId: system.account.userId, secret: system.login.secret });
    expect(await page.evaluate<boolean>(`!!document.querySelector('a[href="/reports"]')`)).toBe(true);
    await page.goto(`${origin}/reports`);
    await page.waitFor(`document.querySelector('#report-title') && document.querySelector('#report-stamp') && document.querySelectorAll('.ov-card').length >= 10`);
    const text = await page.evaluate<string>(`document.body.innerText`);
    for (const expected of ['Order trong kỳ', 'Tỷ lệ giao thành công', 'đã giao xong', 'Tiền giữa các bên, không phải doanh thu nền tảng', 'giờ Việt Nam', 'Theo ngày tạo delivery']) {
      expect(text).toContain(expected);
    }
    await shot(page, 'm12e-reports-deliveries-desktop');

    // A delivery count opens the delivery list with the same period and basis.
    await page.evaluate(`[...document.querySelectorAll('.ov-link')].find((b) => b.textContent.startsWith('Ngừng tìm shipper')).click()`);
    await page.waitFor(`location.pathname === '/operations/deliveries' && location.search.includes('state=search_stopped') && document.querySelector('#delivery-count')`);
    await page.goto(`${origin}/reports`);
    await page.waitFor(`document.querySelectorAll('.ov-card').length >= 10`);

    // The money report states the ledger moment and the reconciliation difference.
    await press(page, 'Tiền và đối soát', "document.querySelector('[aria-label=\"Loại báo cáo\"]')");
    await page.waitFor(`document.body.innerText.includes('Đối soát: chênh lệch') && document.body.innerText.includes('Theo ngày ghi sổ cái')`);
    expect(await page.evaluate<string>(`document.body.innerText`)).toContain('Nạp ví đã duyệt');
    await shot(page, 'm12e-reports-money-desktop');
    await press(page, 'Shipper', "document.querySelector('[aria-label=\"Loại báo cáo\"]')");
    await page.waitFor(`document.body.innerText.includes('Số shipper nhận đơn trong kỳ')`);

    // An invalid custom range is refused before any request.
    await page.evaluate(`[...document.querySelectorAll('.ov-range')].find((b) => b.textContent === 'Tùy chọn').click()`);
    await page.evaluate(`(() => { document.querySelector('#report-from').value = '2020-01-01'; document.querySelector('#report-to').value = '2020-12-31'; return true; })()`);
    await page.evaluate(`[...document.querySelectorAll('.ov-custom button')].find((b) => b.textContent === 'Áp dụng').click()`);
    await page.waitFor(`document.body.innerText.includes('Khoảng thời gian tối đa là 92 ngày')`);
    await press(page, 'Hôm nay', "document.querySelector('[aria-label=\"Khoảng thời gian\"]')");
    await press(page, 'Quán', "document.querySelector('[aria-label=\"Loại báo cáo\"]')");
    await page.waitFor(`document.body.innerText.includes('Số quán có delivery trong kỳ')`);

    // Export: accepted at once, finished by the background run, downloaded from the list.
    const jobs = async (): Promise<number> => (await app.pool.query(`SELECT count(*)::int AS n FROM app.report_export_jobs WHERE requested_by = $1::uuid`, [system.account.userId])).rows[0].n as number;
    const jobsBefore = await jobs();
    await page.evaluate(`document.querySelector('#report-export-csv').click()`);
    await page.waitFor(`document.body.innerText.includes('Đã nhận yêu cầu xuất')`);
    expect(await jobs()).toBe(jobsBefore + 1);
    await page.waitFor(`document.body.innerText.includes('Đang chờ') || document.body.innerText.includes('Đang tạo')`);
    const service = app.running.app.get(AdminReportService, { strict: false });
    while (await service.processNext()) {
      // drain
    }
    await page.waitFor(`[...document.querySelectorAll('.rp-job button')].some((b) => b.textContent === 'Tải về')`, 20_000);
    await shot(page, 'm12e-reports-export-done');
    await page.evaluate(`[...document.querySelectorAll('.rp-job button')].find((b) => b.textContent === 'Tải về').click()`);
    await page.waitFor(`document.body.innerText.includes('Đã tải 11ship-shops-')`);
    const audited = await app.pool.query(`SELECT action FROM app.audit_logs WHERE resource_type = 'report_export' AND actor_id = $1 ORDER BY action`, [system.account.userId]);
    expect(audited.rows.map((r) => r.action)).toEqual(['admin.report.export.create.v1', 'admin.report.export.download.v1']);

    // Narrow screen: no horizontal scroll.
    await page.viewport(390, 844, true);
    await page.waitFor(`document.documentElement.clientWidth <= 400`);
    expect(await page.evaluate<boolean>(`document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1`)).toBe(true);
    await shot(page, 'm12e-reports-phone');
    await page.close();

    // The ADMIN of test M12-C holds report.read but not report.export: the report opens, the export is refused by the server, the money report is refused.
    const adminPage: Page = await (browser as Browser).newPage();
    await adminPage.viewport(1440, 900, false);
    await adminPage.send('Network.clearBrowserCookies');
    await signIn(adminPage, { phone: viewer.phone, password: 'Correct-Horse-Battery-9', userId: viewer.userId, secret: viewer.secret });
    await adminPage.goto(`${origin}/reports`);
    await adminPage.waitFor(`document.querySelectorAll('.ov-card').length >= 10 && document.body.innerText.includes('Tài khoản này không có quyền xuất báo cáo')`);
    await adminPage.evaluate(`document.querySelector('#report-export-csv').click()`);
    await adminPage.waitFor(`document.querySelector('.notice') && !document.querySelector('.notice').hidden && document.querySelector('.notice').textContent.length > 0`);
    expect(await adminPage.evaluate<string>(`document.querySelector('.notice').textContent`)).not.toContain('Đã nhận yêu cầu');
    await shot(adminPage, 'm12e-reports-admin-no-export');
    await press(adminPage, 'Tiền và đối soát', "document.querySelector('[aria-label=\"Loại báo cáo\"]')");
    await adminPage.waitFor(`document.body.innerText.includes('Không có quyền')`);
    await shot(adminPage, 'm12e-reports-admin-money-forbidden');
    await adminPage.close();
  }, 180_000);
});
