import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { buildAdminWeb, buildAdminWebDesign } from '../../scripts/admin-web-build.mjs';
import { makeServer } from '../../scripts/ui-preview.mjs';

// M01-UI web administration: menu by permission, "coming soon" never blank, real build free of preview data, preview server
// read-only. Pure Node (no database, no browser).

let out;
let real;
let design;
const load = async (dist, name) => import(pathToFileURL(join(dist, 'js', name)).href);

before(() => {
  out = mkdtempSync(join(tmpdir(), 'admin-web-'));
  real = buildAdminWeb({ outDir: join(out, 'real'), quiet: true });
  design = buildAdminWebDesign({ outDir: join(out, 'design'), quiet: true }).dist;
});
after(() => rmSync(out, { recursive: true, force: true }));

const ids = (groups) => groups.flatMap((group) => group.items.flatMap((item) => [item.id, ...(item.children ?? []).map((child) => child.id)]));

describe('menu by permission', () => {
  it('ADMIN without grants sees Tổng quan and the (read-only) system parameters, nothing else', async () => {
    const m = await load(real, 'core/menu.js');
    // Owner decision 2026-10-17: every administrator may READ the system parameters (SYSTEM alone edits them).
    assert.deepEqual(ids(m.visibleMenu('ADMIN', m.NO_GRANTS)), ['home', 'parameters', 'parameters-shipper-wallet', 'shipping-policy']);
  });
  it('ADMIN with a grant sees that entry, never administrators, invitations or the system settings', async () => {
    const m = await load(real, 'core/menu.js');
    const seen = ids(m.visibleMenu('ADMIN', new Set(['users', 'shops'])));
    assert.deepEqual(seen, ['home', 'users', 'users-list', 'users-locked', 'shops', 'parameters', 'parameters-shipper-wallet', 'shipping-policy']);
    assert.ok(!seen.includes('administrators') && !seen.includes('invitations') && !seen.includes('system-settings'));
  });
  it('"Danh mục › Nhóm món" needs the catalog grant (SHOP VIEW + the catalog right); SYSTEM always sees it', async () => {
    const m = await load(real, 'core/menu.js');
    assert.deepEqual(ids(m.visibleMenu('ADMIN', new Set(['catalog']))), ['home', 'catalog', 'catalog-categories', 'parameters', 'parameters-shipper-wallet', 'shipping-policy']);
    assert.ok(!ids(m.visibleMenu('ADMIN', new Set(['users', 'shops', 'drivers']))).includes('catalog-categories'));
    assert.ok(ids(m.visibleMenu('SYSTEM')).includes('catalog-categories'));
    assert.equal(m.canOpenRoute('ADMIN', new Set(['users', 'shops']), { name: 'categories' }), false);
    assert.equal(m.canOpenRoute('ADMIN', new Set(['catalog']), { name: 'categories' }), true);
    assert.equal(m.canOpenRoute('SYSTEM', m.NO_GRANTS, { name: 'categories' }), true);
    assert.equal(m.activeMenuId({ name: 'categories' }), 'catalog-categories');
    assert.deepEqual(m.breadcrumb({ name: 'categories' }), ['Danh mục', 'Nhóm món']);
  });
  it('SYSTEM sees every entry', async () => {
    const m = await load(real, 'core/menu.js');
    assert.deepEqual(ids(m.visibleMenu('SYSTEM')), m.allLeaves().map((leaf) => leaf.id));
  });
  it('keeps the specified sections and order', async () => {
    const m = await load(real, 'core/menu.js');
    assert.deepEqual(
      m.MENU.flatMap((group) => group.items.map((item) => item.label)),
      ['Tổng quan', 'Người dùng', 'Quản trị viên', 'Lời mời Admin', 'Quán', 'Shipper', 'Đơn hàng', 'Giao hàng', 'Thông báo', 'Đánh giá', 'Phản ánh', 'Danh mục', 'Tài chính', 'Vận hành hệ thống', 'Cài đặt hệ thống', 'Thời hạn xử lý đơn', 'Vùng hoạt động', 'Tham số hệ thống', 'Phí & điều kiện giao', 'Nhật ký', 'Giám sát'],
    );
  });
  it('M04 "Tài chính": six ready entries in the approved order and the SYSTEM-only receiving accounts (B3a); SYSTEM sees them, an ADMIN only with the matching grant; parameters sit under the system group', async () => {
    const m = await load(real, 'core/menu.js');
    const finance = m.MENU.find((group) => group.id === 'finance').items[0];
    assert.deepEqual(
      finance.children.map((child) => child.label),
      ['Tổng quan', 'Ví Shipper', 'Nạp tiền', 'Rút tiền', 'Giao dịch', 'Đối soát', 'Tài khoản nhận tiền'],
    );
    assert.ok(finance.children.every((child) => child.ready && child.route !== undefined));
    assert.ok(ids(m.visibleMenu('SYSTEM')).includes('finance-reconciliation'));
    assert.ok(!ids(m.visibleMenu('ADMIN', m.NO_GRANTS)).includes('finance-topups'));
    const topupsOnly = ids(m.visibleMenu('ADMIN', new Set(['driver-wallets', 'topups'])));
    assert.ok(topupsOnly.includes('finance-topups') && !topupsOnly.includes('finance-withdrawals'));
    assert.equal(m.canOpenRoute('ADMIN', new Set(['driver-wallets']), { name: 'finance-topups' }), false);
    // B3a: an ADMIN with only the finance READ right ('topups') sees the top-up entry and no other finance entry; the receiving accounts are SYSTEM only.
    const readOnly = ids(m.visibleMenu('ADMIN', new Set(['topups'])));
    assert.deepEqual(readOnly.filter((id) => id.startsWith('finance')), ['finance', 'finance-topups']);
    assert.ok(!ids(m.visibleMenu('ADMIN', new Set(['topups', 'driver-wallets', 'withdrawals', 'drivers']))).includes('finance-bank-accounts'));
    assert.ok(ids(m.visibleMenu('SYSTEM')).includes('finance-bank-accounts'));
    assert.equal(m.canOpenRoute('ADMIN', new Set(['topups']), { name: 'finance-bank-accounts' }), false);
    assert.equal(m.canOpenRoute('SYSTEM', m.NO_GRANTS, { name: 'finance-bank-accounts' }), true);
    // The application permissions never open the money pages (a Shipper view right is not a finance right).
    assert.equal(m.canOpenRoute('ADMIN', new Set(['users', 'shops', 'drivers']), { name: 'finance-topup', id: 'x' }), false);
    assert.equal(m.canOpenRoute('ADMIN', new Set(['withdrawals']), { name: 'finance-withdrawal', id: 'x' }), true);
    assert.equal(m.canOpenRoute('ADMIN', m.NO_GRANTS, { name: 'wallet-params' }), false);
    assert.equal(m.canOpenRoute('SYSTEM', m.NO_GRANTS, { name: 'wallet-params' }), true);
    assert.deepEqual(m.breadcrumb({ name: 'wallet-params' }), ['Cài đặt', 'Tham số hệ thống', 'Ví Shipper']);
    assert.equal(m.activeMenuId({ name: 'finance-withdrawal', id: 'x' }), 'finance-withdrawals');
  });
  it('a ready entry has a route; an entry that is not built has none (shown as "Sắp có")', async () => {
    const m = await load(real, 'core/menu.js');
    for (const leaf of m.allLeaves()) {
      if (leaf.children !== undefined) continue;
      assert.equal(leaf.route !== undefined, leaf.ready, leaf.id);
    }
  });
  it('page access: administrators and invitations are SYSTEM only; users need the grant', async () => {
    const m = await load(real, 'core/menu.js');
    const none = m.NO_GRANTS;
    assert.equal(m.canOpenRoute('ADMIN', none, { name: 'administrators' }), false);
    assert.equal(m.canOpenRoute('ADMIN', none, { name: 'invitations' }), false);
    assert.equal(m.canOpenRoute('ADMIN', none, { name: 'users' }), false);
    // Owner decision 2026-10-14: the system settings are SYSTEM only, whatever an ADMIN was granted.
    assert.equal(m.canOpenRoute('ADMIN', new Set(['users', 'shops', 'drivers']), { name: 'settings' }), false);
    assert.equal(m.canOpenRoute('SYSTEM', none, { name: 'settings' }), true);
    assert.equal(m.canOpenRoute('ADMIN', new Set(['users']), { name: 'users' }), true);
    assert.equal(m.canOpenRoute('SYSTEM', none, { name: 'administrators' }), true);
    assert.equal(m.canOpenRoute('ADMIN', none, { name: 'home' }), true);
  });
});

describe('M13 "Vận hành hệ thống" menu and pages', () => {
  const OPS = ['sysops', 'sysops-overview', 'sysops-incidents', 'sysops-gateway', 'sysops-logs', 'sysops-releases', 'sysops-config'];
  it('SYSTEM sees all six entries; an ADMIN sees them only with the server-given "ops" access, never from application grants', async () => {
    const m = await load(real, 'core/menu.js');
    assert.deepEqual(ids(m.visibleMenu('SYSTEM')).filter((id) => id.startsWith('sysops')), OPS);
    assert.deepEqual(ids(m.visibleMenu('ADMIN', new Set(['users', 'shops', 'drivers', 'deliveries', 'notifications']))).filter((id) => id.startsWith('sysops')), []);
    assert.deepEqual(ids(m.visibleMenu('ADMIN', new Set(['ops']))).filter((id) => id.startsWith('sysops')), OPS);
    assert.deepEqual(m.MENU.find((g) => g.id === 'sysops').items[0].children.map((c) => c.label), ['Tổng quan', 'Sự cố', 'SMS Gateway', 'Nhật ký', 'Phiên bản & cập nhật', 'Cấu hình']);
  });
  it('routes parse, format and are guarded like the menu', async () => {
    const m = await load(real, 'core/menu.js');
    const r = await load(real, 'core/routes.js');
    for (const [path, name] of [['/system-ops', 'ops'], ['/system-ops/incidents', 'ops-incidents'], ['/system-ops/gateway', 'ops-gateway'], ['/system-ops/logs', 'ops-logs'], ['/system-ops/releases', 'ops-releases'], ['/system-ops/config', 'ops-config']]) {
      const route = r.parseRoute(path);
      assert.equal(route.name, name);
      assert.equal(r.formatRoute(route), path);
      assert.equal(m.canOpenRoute('ADMIN', m.NO_GRANTS, route), false, path);
      assert.equal(m.canOpenRoute('ADMIN', new Set(['ops']), route), true, path);
      assert.equal(m.canOpenRoute('SYSTEM', m.NO_GRANTS, route), true, path);
    }
    assert.deepEqual(r.parseRoute('/system-ops/incidents/SC-013'), { name: 'ops-incident', ref: 'SC-013' });
    assert.equal(r.parseRoute('/system-ops/incidents/not-a-code').name, 'home');
    assert.equal(r.formatRoute({ name: 'ops-incident', ref: 'SC-013' }), '/system-ops/incidents/SC-013');
    assert.equal(m.activeMenuId({ name: 'ops-incident', ref: 'SC-013' }), 'sysops-incidents');
    assert.deepEqual(m.breadcrumb({ name: 'ops-releases' }), ['Vận hành hệ thống', 'Phiên bản & cập nhật']);
  });
  it('the real build carries no sample operations data and no way to run a command, a path or a deploy', () => {
    for (const file of ['core/ops.js', 'core/ops-api.js', 'dom/ops-view.js']) {
      const text = readFileSync(join(real, 'js', file), 'utf8');
      assert.ok(!/SC-01[0-9]|Gateway 01|Dữ liệu minh họa|localStorage|sessionStorage|innerHTML|eval\(/.test(text.replace(/SC-013/g, '')), file);
      assert.ok(!/\/admin\/ops\/deploy|\/admin\/ops\/exec|\/admin\/ops\/shell/.test(text), file);
    }
    const view = readFileSync(join(real, 'js', 'dom/ops-view.js'), 'utf8');
    assert.ok(!view.includes('Đăng nhập'), 'the OTP queue is for "Đăng ký / Quên mật khẩu" only');
  });
});

describe('sidebar modes (F1)', () => {
  it('the collapsed rail is desktop-only: the drawer is never compact, and the choice survives a round trip', async () => {
    const m = await load(real, 'core/menu.js');
    assert.equal(m.compactSidebar(true, false), true, 'desktop + collapsed -> rail');
    assert.equal(m.compactSidebar(true, true), false, 'phone + collapsed choice -> full drawer');
    assert.equal(m.compactSidebar(false, true), false);
    assert.equal(m.compactSidebar(true, false), true, 'back on desktop the rail returns');
  });
  it('the drawer breakpoint of the script matches the stylesheet', async () => {
    const m = await load(real, 'core/menu.js');
    const css = readFileSync(join(real, 'styles.css'), 'utf8');
    assert.equal(m.DRAWER_QUERY, '(max-width: 900px)');
    assert.ok(css.includes('@media (max-width: 900px)'));
    const layout = readFileSync(join(real, 'js', 'dom', 'shell-layout.js'), 'utf8');
    assert.match(layout, /compactSidebar\(collapsed/);
    assert.match(layout, /addEventListener\('change'/);
  });
});

describe('accounts source', () => {
  it('is not wired: no screen can report data or success', async () => {
    const a = await load(real, 'core/accounts.js');
    for (const call of [() => a.NOT_WIRED_SOURCE.users({}), () => a.NOT_WIRED_SOURCE.user('id'), () => a.NOT_WIRED_SOURCE.administrators()]) {
      const state = await call();
      assert.equal(state.kind, 'not-wired');
      assert.ok(state.reason.length > 0);
    }
    assert.equal(a.validateReason('').ok, false);
  });
});

describe('real build', () => {
  it('has no design preview, sample data or banner', () => {
    assert.equal(existsSync(join(real, 'design.html')), false);
    assert.equal(existsSync(join(real, 'js', 'design')), false);
    const html = readFileSync(join(real, 'index.html'), 'utf8');
    assert.ok(!html.includes('Dữ liệu minh họa'));
  });
  it('M04: carries no sample wallet, shipper or request (those exist only in the design preview) and no money-moving call', () => {
    for (const file of ['core/finance.js', 'core/finance-controller.js', 'dom/finance-view.js', 'dom/shell-app.js']) {
      const text = readFileSync(join(real, 'js', file), 'utf8');
      assert.ok(!/Nguyễn Văn A|Trần Thị B|SHP00|NP2026|RT2026|MINHHOA|SAMPLE_/.test(text), file);
      if (file.includes('finance')) {
        assert.ok(!/\bfetch\(|XMLHttpRequest|localStorage|sessionStorage/.test(text), `${file} must not call a server or store anything in the UI phase`);
      }
    }
  });
  it('has no persona picker and no way to grant rights from the page', () => {
    for (const file of ['dom/main.js', 'dom/shell-app.js', 'dom/view.js', 'core/menu.js']) {
      const text = readFileSync(join(real, 'js', file), 'utf8');
      assert.ok(!/admin-granted|admin-empty|persona|SAMPLE_GRANTS/.test(text), file);
    }
  });
});

describe('design preview', () => {
  it('is built with a labelled page and the preview pages', () => {
    assert.ok(existsSync(join(design, 'design.html')));
    assert.ok(readFileSync(join(design, 'js', 'design', 'viewer.js'), 'utf8').includes('Dữ liệu minh họa'));
  });
  it('lists every catalog screen with its code (an import failure FAILS this test)', async () => {
    const screens = await load(design, 'design/screens.js');
    const byCode = new Map(screens.SCREENS.map((screen) => [screen.code, screen]));
    const expected = ['D00', 'D01', 'D02', 'D03', 'D04', 'D05', 'D06', 'D07', 'D08', 'D09', 'D81', 'D86', 'D87', 'D88', 'D89', 'D90', 'D91', 'D92', 'M04-A01', 'M04-A02', 'M04-A03', 'M04-A04', 'M04-A05', 'M04-A06', 'M04-A07', 'C01–C10'];
    for (const code of expected) {
      assert.ok(byCode.has(code), `missing screen code ${code}`);
    }
    assert.equal(byCode.get('D89').id, 'administrators');
    assert.match(byCode.get('D89').title, /Quản trị viên/);
    assert.equal(byCode.get('D89').group, 'Tài khoản');
    assert.equal(byCode.get('D90').id, 'user-delete');
    assert.equal(byCode.get('D91').id, 'settings');
    assert.equal(byCode.get('D91').group, 'Hệ thống');
    assert.equal(byCode.get('D92').id, 'categories');
    assert.equal(byCode.get('D92').group, 'Danh mục');
    for (const screen of screens.SCREENS) {
      assert.ok(screen.id && screen.title && screen.variants.length > 0, `incomplete screen ${screen.code}`);
    }
  });
  it('is served read-only (POST refused) with a CSP that forbids network calls', async () => {
    const server = makeServer(design);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const send = (method) =>
      new Promise((resolve, reject) => {
        const req = request({ host: '127.0.0.1', port, path: '/design.html', method }, (res) => {
          res.resume();
          res.on('end', () => resolve(res));
        });
        req.on('error', reject);
        req.end();
      });
    try {
      const get = await send('GET');
      assert.equal(get.statusCode, 200);
      assert.match(String(get.headers['content-security-policy']), /connect-src 'none'/);
      assert.ok((await send('POST')).statusCode >= 400);
    } finally {
      server.close();
    }
  });
});
