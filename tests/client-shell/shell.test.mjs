import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { buildClientWeb } from '../../scripts/client-web-build.mjs';
import { makeServer, resolveFile } from '../../scripts/ui-preview.mjs';

let out;
let lib;
const load = (name) => import(pathToFileURL(join(lib, name)).href);

before(() => {
  out = mkdtempSync(join(tmpdir(), 'client-shell-'));
  const built = buildClientWeb('ui-foundation', { design: true, outDir: out, quiet: true });
  lib = join(built.dist, 'js', 'client-shared', 'src');
});
after(() => rmSync(out, { recursive: true, force: true }));

describe('validation', () => {
  it('phone follows the backend contract', async () => {
    const v = await load('validation.js');
    for (const ok of ['0987654321', '84987654321', '+84987654321', ' 0987654321 ']) assert.equal(v.isValidPhone(ok), true, ok);
    for (const bad of ['098765432', '09876543210', '+8498765432a', '0987 654 321', '', '1987654321']) assert.equal(v.isValidPhone(bad), false, bad);
    assert.equal(v.maskPhone('+84987654321'), '098 •••• 321');
    assert.equal(v.maskPhone('abc'), undefined);
  });
  it('otp keeps six ASCII digits and a leading zero', async () => {
    const v = await load('validation.js');
    assert.equal(v.sanitizeOtp(' 01a2-345678'), '012345');
    assert.equal(v.isCompleteOtp('012345'), true);
    assert.equal(v.isCompleteOtp('01234'), false);
  });
  it('password length counts code points 8..128', async () => {
    const v = await load('validation.js');
    assert.equal(v.isValidPassword('1234567'), false);
    assert.equal(v.isValidPassword('12345678'), true);
    assert.equal(v.isValidPassword('a'.repeat(129)), false);
    assert.equal(v.isValidPassword('😀'.repeat(8)), true);
  });
  it('person name is normalised and control characters rejected', async () => {
    const v = await load('validation.js');
    assert.equal(v.normalizePersonName('  Nguyễn   Văn  A '), 'Nguyễn Văn A');
    assert.equal(v.normalizePersonName('A\u0000B'), undefined);
    assert.equal(v.normalizePersonName('   '), undefined);
    assert.equal(v.normalizePersonName('a'.repeat(121)), undefined);
  });
  it('coordinates must be a valid pair', async () => {
    const v = await load('validation.js');
    assert.equal(v.isValidCoordinatePair(10.77, 106.7), true);
    assert.equal(v.isValidCoordinatePair(91, 0), false);
    assert.equal(v.isValidCoordinatePair(0, 181), false);
  });
});

describe('router', () => {
  const table = {
    routes: [
      { id: 'home', path: '/', access: 'public' },
      { id: 'login', path: '/dang-nhap', access: 'public' },
      { id: 'account', path: '/tai-khoan', access: 'authed' },
      { id: 'otp', path: '/dang-ky/ma-otp', access: 'flow', flow: 'register' },
    ],
    fallback: '/',
    loginPath: '/dang-nhap',
    flowStart: { register: '/dang-ky' },
  };
  it('guards authed routes, flow routes and unknown paths', async () => {
    const r = await load('router.js');
    const state = { signedIn: false, flows: new Set() };
    assert.deepEqual(r.resolveRoute('/tai-khoan', table, state), { kind: 'redirect', to: '/dang-nhap', reason: 'login' });
    assert.equal(r.resolveRoute('/dang-ky/ma-otp', table, state).to, '/dang-ky');
    assert.equal(r.resolveRoute('/khong-co', table, state).reason, 'unknown');
    assert.equal(r.resolveRoute('/tai-khoan/', table, { signedIn: true, flows: new Set() }).kind, 'render');
    assert.equal(r.resolveRoute('/dang-ky/ma-otp', table, { signedIn: false, flows: new Set(['register']) }).kind, 'render');
  });
  it('safeReturnTo only keeps same-origin authed screens', async () => {
    const r = await load('router.js');
    assert.equal(r.safeReturnTo('/tai-khoan', table), '/tai-khoan');
    for (const bad of ['//evil.com', 'https://evil.com', '/\\evil', '/tai-khoan\n', '/dang-nhap', '/khong-co', null, undefined, '/' + 'a'.repeat(300)]) {
      assert.equal(r.safeReturnTo(bad, table), undefined, String(bad));
    }
  });
});

describe('ports and features', () => {
  it('no not-wired port can ever answer ok', async () => {
    const { NOT_WIRED_PORTS } = await load('ports.js');
    for (const group of Object.values(NOT_WIRED_PORTS)) {
      for (const fn of Object.values(group)) {
        const result = await fn({});
        assert.notEqual(result.kind, 'ok');
      }
    }
  });
  it('every feature is unwired with a visible reason until a backend contract exists', async () => {
    const f = await load('features.js');
    for (const [id, status] of Object.entries(f.FEATURES)) {
      assert.equal(f.isWired(id), status.wired);
      assert.equal(status.wired, false, id);
      assert.ok(status.reason.length > 10, id);
    }
  });
});

describe('builds', () => {
  it('live build contains no design preview', () => {
    const live = mkdtempSync(join(tmpdir(), 'client-live-'));
    try {
      // ui-foundation is design-only, so it must refuse a live build.
      assert.throws(() => buildClientWeb('ui-foundation', { outDir: live, quiet: true }), /design-only/);
    } finally {
      rmSync(live, { recursive: true, force: true });
    }
  });
  it('design build has the preview page and a manifest', () => {
    assert.ok(existsSync(join(out, 'design.html')));
    const manifest = JSON.parse(readFileSync(join(out, 'build-manifest.json'), 'utf8'));
    assert.equal(manifest.mode, 'design');
    assert.match(manifest.fingerprint, /^[0-9a-f]{64}$/);
  });
  it('no innerHTML in shared sources', () => {
    const dir = join(lib);
    const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
    for (const file of walk(dir).filter((f) => f.endsWith('.js'))) {
      assert.doesNotMatch(readFileSync(file, 'utf8').replace(/\/\/.*$/gm, ''), /\bstyle:\s*['"`]|\.style\.|cssText/, `inline style in ${file}`);
      assert.doesNotMatch(readFileSync(file, 'utf8').replace(/\/\/.*$/gm, ''), /innerHTML|outerHTML|insertAdjacentHTML|document\.write/, file);
    }
  });
});

describe('preview server', () => {
  it('serves only GET/HEAD inside its folder with a closed CSP', async () => {
    assert.equal(resolveFile(out, '/../../etc/passwd'), undefined);
    assert.equal(resolveFile(out, '/%2e%2e/%2e%2e/etc/passwd'), undefined);
    assert.ok(resolveFile(out, '/'));
    const server = makeServer(out);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const get = await fetch(`${base}/`);
      assert.equal(get.status, 200);
      assert.match(get.headers.get('content-security-policy'), /connect-src 'none'/);
      assert.equal((await fetch(`${base}/`, { method: 'POST' })).status, 405);
      assert.equal((await fetch(`${base}/nope`)).status, 404);
    } finally {
      server.close();
    }
  });
});
