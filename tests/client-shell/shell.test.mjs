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

describe('11Food live build', () => {
  let live;
  before(() => {
    live = mkdtempSync(join(tmpdir(), 'food-live-'));
    buildClientWeb('food-web', { outDir: live, quiet: true });
  });
  after(() => rmSync(live, { recursive: true, force: true }));
  const files = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(d, e.name)) : [join(d, e.name)]));

  it('ships no design preview, no sample data and no inline style', () => {
    const all = files(live);
    assert.ok(all.some((f) => f.endsWith('index.html')));
    for (const f of all) {
      assert.doesNotMatch(f, /design/i, f);
      if (/\.(js|html|css)$/.test(f)) {
        const text = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        assert.doesNotMatch(text, /Nguyễn Văn A|Quán Cơm Nhà|Kim Đồng|098 •••• 123/, `sample data in ${f}`);
        assert.doesNotMatch(text, /localStorage|sessionStorage|indexedDB|document\.cookie/, `browser storage in ${f}`);
      }
    }
    assert.equal(JSON.parse(readFileSync(join(live, 'build-manifest.json'), 'utf8')).mode, 'live');
  });

  it('nobody is signed in: every authed route goes to login, flow routes go back to their start', async () => {
    const { routeTable } = await import(pathToFileURL(join(live, 'js', 'client-shared', 'src', 'app.js')).href);
    const { resolveRoute } = await import(pathToFileURL(join(live, 'js', 'client-shared', 'src', 'router.js')).href);
    const { FOOD_DEFINITION } = await import(pathToFileURL(join(live, 'js', 'food-web', 'src', 'screens.js')).href);
    const table = routeTable(FOOD_DEFINITION);
    const state = { signedIn: false, flows: new Set() };
    for (const path of ['/account/profile', '/shop/start', '/shop/onboarding', '/shop/location', '/shop/home']) {
      const r = resolveRoute(path, table, state);
      assert.deepEqual([r.kind, r.to, r.reason], ['redirect', '/login', 'login'], path);
    }
    for (const path of ['/', '/search', '/orders', '/account', '/welcome', '/login', '/register', '/reset']) {
      assert.equal(resolveRoute(path, table, state).kind, 'render', path);
    }
    assert.equal(resolveRoute('/register/otp', table, state).to, '/register');
    assert.equal(resolveRoute('/reset/otp', table, state).to, '/reset');
    assert.equal(resolveRoute('/reset/password', table, state).to, '/reset');
  });

  it('bottom navigation has exactly the four approved tabs', async () => {
    const text = readFileSync(join(live, 'js', 'food-web', 'src', 'screens.js'), 'utf8');
    const labels = [...text.matchAll(/label: '([^']+)', icon: '[a-z]+', href: '\//g)].map((m) => m[1]);
    assert.deepEqual(labels, ['Trang chủ', 'Tìm kiếm', 'Đơn hàng', 'Tài khoản']);

describe('C08: dirty form, Back and navigation', () => {
  const fakeInput = (type, value = '', checked = false) => {
    const events = [];
    return { type, value, checked, readOnly: false, disabled: false, events, dispatchEvent: (event) => events.push(event.type) };
  };
  const fakeForm = (inputs) => ({ querySelectorAll: () => inputs });
  const fakeEnv = () => {
    const registered = [];
    const flows = new Set(['reset-password', 'reset-otp']);
    return {
      registered,
      flows,
      env: {
        guard: (guard) => {
          registered.push(guard);
          return { release: () => guard.wipe() };
        },
        flows: { end: (name) => flows.delete(name) },
      },
    };
  };
  const asker = (answer) => {
    const log = { asked: 0 };
    const ask = (host, answers) => {
      log.asked += 1;
      if (answer === 'stay') answers.stay();
      if (answer === 'leave') answers.leave();
      if (answer !== 'pending') answers.closed();
    };
    return { log, ask };
  };

  it('does not ask when nothing was typed, and still wipes (ends the flow) on leaving', async () => {
    const { LeaveController } = await load('leave.js');
    const { guardForm } = await load('screens/layout.js');
    const { env, flows } = fakeEnv();
    const a = asker('stay');
    const leave = new LeaveController(a.ask);
    const env2 = { ...env, guard: (g) => leave.register(g) };
    guardForm(env2, fakeForm([fakeInput('password')]), { flows: ['reset-password'] });
    let moved = 0;
    leave.request(() => (moved += 1));
    assert.equal(moved, 1);
    assert.equal(a.log.asked, 0);
    assert.equal(flows.has('reset-password'), false, 'the flow ends when the person leaves');
  });

  it('asks when typed; "Ở lại" keeps the content and does not navigate', async () => {
    const { LeaveController } = await load('leave.js');
    const { guardForm } = await load('screens/layout.js');
    const { env, flows } = fakeEnv();
    const password = fakeInput('password');
    const a = asker('stay');
    const leave = new LeaveController(a.ask);
    guardForm({ ...env, guard: (g) => leave.register(g) }, fakeForm([password]), { flows: ['reset-password'] });
    password.value = 'mat-khau-dang-go';
    assert.equal(leave.dirty(), true);
    let moved = 0;
    leave.request(() => (moved += 1));
    assert.equal(a.log.asked, 1);
    assert.equal(moved, 0);
    assert.equal(password.value, 'mat-khau-dang-go');
    assert.equal(flows.has('reset-password'), true);
    assert.equal(leave.dirty(), true, 'still guarded after staying');
  });

  it('"Thoát" wipes password/OTP and the flow, then navigates', async () => {
    const { LeaveController } = await load('leave.js');
    const { guardForm } = await load('screens/layout.js');
    const { env, flows } = fakeEnv();
    const password = fakeInput('password');
    const otp = fakeInput('text');
    const consent = fakeInput('checkbox');
    const a = asker('leave');
    const leave = new LeaveController(a.ask);
    guardForm({ ...env, guard: (g) => leave.register(g) }, fakeForm([password, otp, consent]), { flows: ['reset-password'] });
    password.value = 'abc12345';
    otp.value = '123456';
    consent.checked = true;
    let moved = 0;
    leave.request(() => (moved += 1));
    assert.equal(moved, 1);
    assert.equal(password.value, '');
    assert.equal(otp.value, '');
    assert.equal(consent.checked, false);
    assert.equal(flows.has('reset-password'), false);
    assert.equal(leave.dirty(), false);
  });

  it('a second request while the question is open does not open another one', async () => {
    const { LeaveController } = await load('leave.js');
    const { guardForm } = await load('screens/layout.js');
    const { env } = fakeEnv();
    const input = fakeInput('text');
    const a = asker('pending');
    const leave = new LeaveController(a.ask);
    guardForm({ ...env, guard: (g) => leave.register(g) }, fakeForm([input]));
    input.value = 'x';
    leave.request(() => undefined);
    leave.request(() => undefined);
    assert.equal(a.log.asked, 1);
  });

  it('release (success) wipes and stops asking; typed values are never put in the URL or storage by this code', async () => {
    const { LeaveController } = await load('leave.js');
    const { guardForm } = await load('screens/layout.js');
    const { env } = fakeEnv();
    const password = fakeInput('password');
    const a = asker('stay');
    const leave = new LeaveController(a.ask);
    const handle = guardForm({ ...env, guard: (g) => leave.register(g) }, fakeForm([password]));
    password.value = 'x1234567';
    handle.release();
    assert.equal(password.value, '');
    let moved = 0;
    leave.request(() => (moved += 1));
    assert.equal(moved, 1);
    assert.equal(a.log.asked, 0);
    for (const file of ['leave.js', 'screens/layout.js', 'app.js']) {
      const text = readFileSync(join(lib, file), 'utf8');
      assert.ok(!/localStorage|sessionStorage|document\.cookie/.test(text), file);
    }
    assert.ok(!/pushState\([^)]*(value|password|otp)/i.test(readFileSync(join(lib, 'app.js'), 'utf8')));
  });

  it('every form with a password or code is guarded, and the preview has the C08 screen', async () => {
    const auth = readFileSync(join(lib, 'screens/auth.js'), 'utf8');
    assert.equal((auth.match(/guardForm\(env/g) ?? []).length, 5, 'login, register, OTP, reset, reset-password');
    const found = readFileSync(join(lib, 'design/foundation.js'), 'utf8');
    assert.match(found, /code: 'C08'/);
  });

  it('11Food forms with unsaved input (profile, shop profile) are guarded', () => {
    const source = readFileSync(new URL('../../apps/food-web/src/screens.ts', import.meta.url), 'utf8');
    assert.equal((source.match(/guardForm\(env, form\)/g) ?? []).length, 2);
  });
});
