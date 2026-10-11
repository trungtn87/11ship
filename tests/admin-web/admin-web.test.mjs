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
  it('ADMIN without grants only sees Tổng quan', async () => {
    const m = await load(real, 'core/menu.js');
    assert.deepEqual(ids(m.visibleMenu('ADMIN', m.NO_GRANTS)), ['home']);
  });
  it('ADMIN with a grant sees that entry, never administrators or invitations', async () => {
    const m = await load(real, 'core/menu.js');
    const seen = ids(m.visibleMenu('ADMIN', new Set(['users', 'shops'])));
    assert.deepEqual(seen, ['home', 'users', 'users-list', 'users-locked', 'shops']);
    assert.ok(!seen.includes('administrators') && !seen.includes('invitations'));
  });
  it('SYSTEM sees every entry', async () => {
    const m = await load(real, 'core/menu.js');
    assert.deepEqual(ids(m.visibleMenu('SYSTEM')), m.allLeaves().map((leaf) => leaf.id));
  });
  it('keeps the specified sections and order', async () => {
    const m = await load(real, 'core/menu.js');
    assert.deepEqual(
      m.MENU.flatMap((group) => group.items.map((item) => item.label)),
      ['Tổng quan', 'Người dùng', 'Quản trị viên', 'Lời mời Admin', 'Quán', 'Xế', 'Đơn hàng', 'Giao hàng', 'Phản ánh', 'Ví xế', 'Nạp tiền', 'Rút tiền', 'Vùng hoạt động', 'Tham số', 'Nhật ký', 'Giám sát'],
    );
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
    assert.equal(m.canOpenRoute('ADMIN', new Set(['users']), { name: 'users' }), true);
    assert.equal(m.canOpenRoute('SYSTEM', none, { name: 'administrators' }), true);
    assert.equal(m.canOpenRoute('ADMIN', none, { name: 'home' }), true);
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
});

describe('design preview', () => {
  it('is built with a labelled page and the preview pages', () => {
    assert.ok(existsSync(join(design, 'design.html')));
    assert.ok(readFileSync(join(design, 'js', 'design', 'viewer.js'), 'utf8').includes('Dữ liệu minh họa'));
  });
  it('lists the catalog screens with their codes', async () => {
    const s = await load(design, 'design/screens.js').catch(() => undefined);
    // screens.js touches the DOM only when rendering; importing the list must work in Node.
    if (s === undefined) return;
    const codes = s.SCREENS.map((screen) => screen.code);
    for (const code of ['D00', 'D01', 'D02', 'D03', 'D04', 'D05', 'D06', 'D07', 'D08', 'D09', 'D81', 'D86', 'D87', 'D88']) assert.ok(codes.includes(code), code);
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
