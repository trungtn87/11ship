import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createLocalCertificate } from '../../scripts/admin-web-cert.mjs';
import { buildClientWeb } from '../../scripts/client-web-build.mjs';
import { createClientWebServer } from '../../scripts/client-web-dev.mjs';
import { launchChrome, OVERFLOW, SMALL_TARGETS, spkiHash } from './support/chrome.mjs';

// M01 (11Food shop onboarding), real browser: F20 -> F21 -> F22 -> F21 -> F23 in headless Chromium over the REAL local https front
// (createClientWebServer). The backend behind it is a controlled stand-in (one stateful shop), and the device position is the one
// stubbed thing (a headless Chrome has no GPS). The real backend + PostgreSQL version of the same journey is
// tests/integration/food-shop-onboarding-browser.int.spec.ts (CI). Set SHOT_DIR to write a JPEG of each screen.

const shots = process.env.SHOT_DIR === undefined || process.env.SHOT_DIR === '' ? undefined : process.env.SHOT_DIR;
const USER = '11111111-1111-4111-8111-111111111111';
const SHOP = '55555555-5555-4555-8555-555555555555';
const AREA = '66666666-6666-4666-8666-666666666661';
const ACCESS = 'ACCESS_TOKEN_' + 'a'.repeat(30);
const PASSWORD = 'Mật khẩu thử 12345';
const PHONE = '0987654321';
const NAME = 'Nguyễn Văn An';
const LAT = 10.762622;
const LNG = 106.660172;

async function startBackend() {
  const state = { seen: [], shop: null, areas: [{ service_area_id: AREA, name: 'Quận Thử' }], roles: ['CUSTOMER'], active: 'CUSTOMER', onboarding: 'NOT_STARTED' };
  const reset = () => {
    state.seen.length = 0;
    state.shop = null;
    state.areas = [{ service_area_id: AREA, name: 'Quận Thử' }];
    state.roles = ['CUSTOMER'];
    state.active = 'CUSTOMER';
    state.onboarding = 'NOT_STARTED';
  };
  const who = () => ({
    user_id: USER,
    phone_normalized: '+84987654321',
    available_roles: state.roles,
    active_role: state.active,
    profile: { full_name: NAME, version: 1 },
    capabilities: { customer_access: true, shop_profile_read: false, shop_manage: false, driver_profile_read: false },
    onboarding: { shop: state.onboarding, driver: 'NOT_STARTED' },
    onboarding_required: false,
    role_selection_required: false,

    phone_verification_status: 'VERIFIED',
  });
  const session = () => ({ expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString() });
  const send = (response, status, body) => {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(body));
  };
  const err = (code) => ({ error: { code, message: 'RAW_SERVER_TEXT_MARKER', request_id: 'r', details: {} } });
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      if (request.url === '/v1/health/live' || request.url === '/v1/health/ready') {
        send(response, 200, { data: { status: request.url.endsWith('live') ? 'ok' : 'ready' } });
        return;
      }
      state.seen.push({ method: request.method, url: request.url, headers: request.headers, body });
      const route = `${request.method} ${request.url}`;
      if (route === 'POST /v1/client-auth/login') {
        send(response, JSON.parse(body).password === PASSWORD ? 200 : 401, JSON.parse(body).password === PASSWORD ? { data: { ...who(), access_token: ACCESS, session: session() } } : err('INVALID_CREDENTIALS'));
        return;
      }
      if (request.headers.authorization !== `Bearer ${ACCESS}`) {
        send(response, 401, err('SESSION_INVALID'));
        return;
      }
      if (route === 'GET /v1/client-auth/me') {
        send(response, 200, { data: { ...who(), session: session() } });
      } else if (route === 'POST /v1/client-auth/context') {
        const wanted = JSON.parse(body).context;
        if (!state.roles.includes(wanted)) {
          send(response, 403, err('ROLE_NOT_AVAILABLE'));
          return;
        }
        state.active = wanted;
        send(response, 200, { data: { ...who(), session: session() } });
      } else if (route === 'GET /v1/onboarding/shop/profile') {
        send(response, 200, { data: state.shop });
      } else if (route === 'GET /v1/onboarding/shop/service-areas') {
        send(response, 200, { data: state.areas });
      } else if (route === 'PUT /v1/onboarding/shop/profile') {
        const sent = JSON.parse(body);
        const created = state.shop === null;
        if ((created && sent.expected_version !== null) || (!created && sent.expected_version !== state.shop.version)) {
          send(response, 409, err('VERSION_CONFLICT'));
          return;
        }
        const version = created ? 1 : state.shop.version + 1;
        state.shop = { shop_id: SHOP, name: sent.name, contact_phone: sent.contact_phone.startsWith('+84') ? sent.contact_phone : `+84${sent.contact_phone.slice(1)}`, zalo: sent.zalo, facebook: sent.facebook, address_text: sent.address_text, pickup_lat: sent.pickup_lat, pickup_lng: sent.pickup_lng, service_area_id: sent.service_area_id, status: 'INCOMPLETE', accepting_orders: false, version };
        state.onboarding = 'INCOMPLETE';
        send(response, created ? 201 : 200, { data: { shop_id: SHOP, status: 'INCOMPLETE', version, role_granted: false } });
      } else if (route === 'POST /v1/onboarding/shop/complete') {
        state.shop = { ...state.shop, status: 'ACTIVE', version: state.shop.version + 1 };
        state.roles = ['CUSTOMER', 'SHOP_OWNER'];
        state.onboarding = 'COMPLETED';
        send(response, 200, { data: { shop_id: SHOP, status: 'ACTIVE', accepting_orders: false, role_granted: true, version: state.shop.version } });
      } else {
        send(response, 404, err('NOT_FOUND'));
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    state,
    reset,
    url: `http://127.0.0.1:${String(server.address().port)}`,
    calls: (method, url) => state.seen.filter((entry) => entry.method === method && entry.url === url),
    stop: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}

let work;
let backend;
let front;
let origin;
let browser;

before(async () => {
  work = mkdtempSync(join(tmpdir(), 'shop-browser-'));
  const made = createLocalCertificate(join(work, 'tls'), 30);
  const pem = readFileSync(made.cert);
  const dist = buildClientWeb('food-web', { outDir: join(work, 'food'), quiet: true }).dist;
  backend = await startBackend();
  front = createClientWebServer({ app: 'food-web', distDir: dist, backendUrl: backend.url, key: readFileSync(made.key), cert: pem, authTimeoutMs: 4000 });
  await new Promise((resolve) => front.listen(0, '127.0.0.1', resolve));
  origin = `https://localhost:${String(front.address().port)}`;
  browser = await launchChrome({ spki: spkiHash(pem) });
});

after(async () => {
  await browser?.close();
  await new Promise((resolve) => {
    front?.closeAllConnections?.();
    front?.close(() => resolve());
    if (front === undefined) {
      resolve();
    }
  });
  await backend?.stop();
  rmSync(work, { recursive: true, force: true });
});

async function withPage(run, width = 390) {
  backend.reset();
  const page = await browser.newPage();
  try {
    await page.viewport(width);
    await run(page);
    assert.deepEqual(page.problems, [], 'no console error, CSP violation or exception');
  } finally {
    await browser.closePage(page);
  }
}

const path = `location.pathname`;
const waitPath = (page, expected) => page.waitFor(`location.pathname === ${JSON.stringify(expected)} && document.querySelector('#app')?.children.length > 0`, `path ${expected}`);
const mainText = (page) => page.evaluate(`document.querySelector('main')?.innerText ?? ''`);
const clickRow = (page, title) => page.evaluate(`(() => { const row = [...document.querySelectorAll('.c-item')].find((e) => e.querySelector('.c-item__title')?.textContent.trim() === ${JSON.stringify(title)}); if (!row) { throw new Error('no row ${title}'); } row.click(); return true; })()`);
const formReady = (page) => page.waitFor(`document.querySelector('#shop-name') && !document.querySelector('#shop-name').disabled`, 'F21 loaded');
const geoCalls = (page) => page.evaluate('window.__geo.calls');

async function login(page) {
  await page.goto(`${origin}/login`);
  await page.fill('#phone', PHONE);
  await page.fill('#password', PASSWORD);
  await page.click('#login-submit');
  await waitPath(page, '/');
  await page.evaluate(`(() => {
    window.__geo = { calls: 0, mode: 'ok' };
    navigator.geolocation.getCurrentPosition = (success, failure) => {
      window.__geo.calls += 1;
      if (window.__geo.mode === 'denied') { failure({ code: 1, message: 'denied' }); return; }
      success({ coords: { latitude: ${LAT}, longitude: ${LNG}, accuracy: 12.4 }, timestamp: Date.now() });
    };
  })()`);
}

async function toForm(page) {
  await page.click('a[href="/account"]');
  await waitPath(page, '/account');
  await clickRow(page, 'Quản lý cửa hàng');
  await waitPath(page, '/shop/start');
  await page.waitFor(`document.querySelector('#shop-start-cta')`, 'F20 loaded');
  await page.click('#shop-start-cta');
  await waitPath(page, '/shop/onboarding');
  await formReady(page);
}

async function fillShop(page) {
  await page.fill('#shop-name', 'Quán Cơm Thử');
  await page.fill('#shop-phone', '0912345678');
  await page.fill('#shop-address', '12 Đường Thử');
}

describe('the shop onboarding journey (stand-in backend, stubbed device position)', () => {
  it('saves without a position, resumes, takes a position + the server area, completes, enters SHOP_OWNER and returns to CUSTOMER', async () => {
    await withPage(async (page) => {
      await login(page);
      await toForm(page);
      assert.equal(await page.evaluate(`document.querySelector('#shop-area').value`), '');
      assert.equal(await page.evaluate(`[...document.querySelectorAll('#shop-area option')].map((o) => o.value + '|' + o.textContent).join(',')`), `|Chọn khu vực phục vụ,${AREA}|Quận Thử`);
      assert.equal(await page.evaluate(`document.querySelector('#shop-complete').getAttribute('aria-disabled')`), 'true');
      assert.match(await page.evaluate(`document.querySelector('#shop-complete-reason').innerText`), /Lưu hồ sơ trước/);
      assert.deepEqual(await page.evaluate(SMALL_TARGETS), [], 'touch targets on F21');
      const overflow = await page.evaluate(OVERFLOW);
      assert.ok(overflow.scrollWidth <= overflow.innerWidth, 'F21 does not scroll sideways');
      await fillShop(page);
      await page.shot(shots, 'f21-filled');

      // Save WITHOUT a position or an area.
      await page.click('#shop-save');
      await page.waitFor(`document.body.innerText.includes('Đã lưu hồ sơ')`, 'saved');
      const [put] = backend.calls('PUT', '/v1/onboarding/shop/profile');
      assert.deepEqual(JSON.parse(put.body), { name: 'Quán Cơm Thử', contact_phone: '0912345678', address_text: '12 Đường Thử', zalo: null, facebook: null, pickup_lat: null, pickup_lng: null, service_area_id: null, expected_version: null });
      assert.match(put.headers['idempotency-key'], /^[0-9a-f-]{36}$/);
      assert.equal(put.headers.cookie, undefined);
      assert.equal(await geoCalls(page), 0, 'no position was asked for before the button');

      // Leave and resume: the draft comes from the server.
      await page.click('header button');
      await waitPath(page, '/shop/start');
      await page.waitFor(`document.querySelector('#shop-start-cta')?.textContent.trim() === 'Tiếp tục hồ sơ'`, 'draft offered');
      await page.shot(shots, 'f20-draft');
      await page.click('#shop-start-cta');
      await waitPath(page, '/shop/onboarding');
      await formReady(page);
      assert.equal(await page.evaluate(`document.querySelector('#shop-name').value`), 'Quán Cơm Thử');
      assert.equal(await page.evaluate(`document.querySelector('#shop-phone').value`), '+84912345678');

      // F22: an unsaved edit survives the round trip and nothing is asked on the way; a refusal gives no position.
      await page.fill('#shop-address', '12 Đường Thử (sửa chưa lưu)');
      await page.click('#shop-gps');
      await waitPath(page, '/shop/location');
      assert.equal(await page.evaluate(`document.querySelector('.c-dialog') === null`), true, 'no leave question inside the flow');
      assert.equal(await geoCalls(page), 0);
      assert.deepEqual(await page.evaluate(SMALL_TARGETS), [], 'touch targets on F22');
      await page.shot(shots, 'f22-before');
      await page.evaluate(`window.__geo.mode = 'denied'`);
      await page.click('#location-get');
      await page.waitFor(`document.body.innerText.includes('Chưa được cấp quyền vị trí')`, 'refusal shown');
      assert.equal(await page.evaluate(`document.querySelector('#location-details') === null`), true, 'a refusal shows no coordinates');
      assert.equal(await page.evaluate(`document.querySelector('#location-confirm').getAttribute('aria-disabled')`), 'true');
      await page.shot(shots, 'f22-denied');
      await page.evaluate(`window.__geo.mode = 'ok'`);
      await page.click('#location-get');
      await page.waitFor(`document.querySelector('#location-lat')`, 'position shown');
      assert.equal(await page.evaluate(`document.querySelector('#location-lat').textContent`), LAT.toFixed(6));
      assert.match(await page.evaluate(`document.querySelector('#location-accuracy').textContent`), /12/);
      assert.equal(await geoCalls(page), 2);
      await page.shot(shots, 'f22-measured');
      await page.click('#location-confirm');
      await waitPath(page, '/shop/onboarding');
      await formReady(page);
      assert.equal(await page.evaluate(`document.querySelector('#shop-address').value`), '12 Đường Thử (sửa chưa lưu)');
      assert.equal(await page.evaluate(`document.querySelector('#location-lat').textContent`), LAT.toFixed(6));
      assert.match(await page.evaluate(`document.querySelector('#shop-complete-reason').innerText`), /chưa lưu/);

      // Area from the server list, save, complete.
      await page.evaluate(`(() => { const s = document.querySelector('#shop-area'); s.value = ${JSON.stringify(AREA)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await page.click('#shop-save');
      await page.waitFor(`document.querySelector('#shop-complete').getAttribute('aria-disabled') === 'false'`, 'completion offered');
      const second = JSON.parse(backend.calls('PUT', '/v1/onboarding/shop/profile')[1].body);
      assert.deepEqual([second.pickup_lat, second.pickup_lng, second.service_area_id, second.expected_version], [LAT, LNG, AREA, 1]);
      await page.shot(shots, 'f21-ready');
      await page.click('#shop-complete');
      await page.waitFor(`document.querySelector('#shop-open-home')`, 'completed');
      assert.deepEqual(JSON.parse(backend.calls('POST', '/v1/onboarding/shop/complete')[0].body), { expected_version: 2 });
      assert.equal(backend.calls('GET', '/v1/client-auth/me').length >= 1, true, 'identity refreshed after completion');
      assert.equal(backend.state.active, 'CUSTOMER', 'completion selected no context');
      assert.equal(await page.evaluate(`document.querySelector('#shop-save').hidden`), true, 'the completed profile is read-only here');
      await page.shot(shots, 'f21-completed');

      await page.click('#shop-open-home');
      await waitPath(page, '/shop/home');
      await page.waitFor(`document.querySelector('#shop-home-name')`, 'F23 loaded');
      const home = await mainText(page);
      assert.match(home, /Quán Cơm Thử/);
      assert.match(home, /Đang ở: Chủ quán/);
      assert.match(home, /Chưa nhận đơn/);
      assert.equal(backend.state.active, 'SHOP_OWNER');
      await page.shot(shots, 'f23-owner');
      await clickRow(page, 'Về giao diện khách hàng');
      await waitPath(page, '/account');
      assert.equal(backend.state.active, 'CUSTOMER');
      assert.equal(backend.calls('POST', '/v1/client-auth/context').length, 2);
      const account = await mainText(page);
      assert.match(account, /Khách hàng/);
      assert.match(account, /Chủ quán/);
      assert.equal(await page.evaluate('localStorage.length + sessionStorage.length'), 0);
      assert.equal(await page.evaluate(`[location.href, JSON.stringify(history.state), document.cookie].join('|').includes('Quán Cơm')`), false);
    });
  });

  it('F21 asks before a real exit with unsaved changes ("Ở lại" keeps them, "Thoát" drops them) and never inside the flow', async () => {
    await withPage(async (page) => {
      await login(page);
      await toForm(page);
      await fillShop(page);
      await page.click('header button');
      await page.waitFor(`document.querySelector('.c-dialog')`, 'leave question');
      assert.equal(await page.evaluate(path), '/shop/onboarding');
      await page.evaluate(`[...document.querySelectorAll('.c-dialog button')].find((b) => b.textContent.trim() === 'Ở lại').click()`);
      await page.waitFor(`document.querySelector('.c-dialog') === null`, 'dialog closed');
      assert.equal(await page.evaluate(`document.querySelector('#shop-name').value`), 'Quán Cơm Thử');
      await page.click('header button');
      await page.waitFor(`document.querySelector('.c-dialog')`, 'leave question again');
      await page.evaluate(`[...document.querySelectorAll('.c-dialog button')].find((b) => b.textContent.trim() === 'Thoát').click()`);
      await waitPath(page, '/shop/start');
      await page.waitFor(`document.querySelector('#shop-start-cta')?.textContent.trim() === 'Đăng ký cửa hàng'`, 'nothing was saved');
      assert.equal(backend.calls('PUT', '/v1/onboarding/shop/profile').length, 0);
      await page.click('#shop-start-cta');
      await waitPath(page, '/shop/onboarding');
      await formReady(page);
      assert.equal(await page.evaluate(`document.querySelector('#shop-name').value`), '', 'the dropped form is empty');
    });
  });

  it('with no active area the draft still saves and completion says why it is locked; the area is never typed or guessed', async () => {
    await withPage(async (page) => {
      backend.state.areas = [];
      await login(page);
      await toForm(page);
      assert.equal(await page.evaluate(`document.querySelector('#shop-area').disabled`), true);
      assert.match(await page.evaluate(`document.querySelector('#shop-area-note').textContent`), /Chưa có khu vực đang hoạt động/);
      await fillShop(page);
      await page.click('#shop-gps');
      await waitPath(page, '/shop/location');
      await page.click('#location-get');
      await page.waitFor(`document.querySelector('#location-lat')`, 'position');
      await page.click('#location-confirm');
      await waitPath(page, '/shop/onboarding');
      await formReady(page);
      await page.click('#shop-save');
      await page.waitFor(`document.body.innerText.includes('Đã lưu hồ sơ')`, 'saved');
      assert.equal(backend.state.shop.service_area_id, null);
      assert.equal(backend.state.shop.pickup_lat, LAT);
      assert.equal(await page.evaluate(`document.querySelector('#shop-complete').getAttribute('aria-disabled')`), 'true');
      assert.match(await page.evaluate(`document.querySelector('#shop-complete-reason').innerText`), /Chưa có khu vực hoạt động/);
      assert.equal(backend.calls('POST', '/v1/onboarding/shop/complete').length, 0);
    });
  });
});
