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

// M01 (11Ship driver profile), real browser: S12 -> S13 in headless Chromium over the REAL local https front (createClientWebServer,
// ship-web). The backend behind it is a controlled stand-in (one stateful driver). The real backend + PostgreSQL version of the same
// journey is tests/integration/ship-driver-profile-browser.int.spec.ts (CI). Set SHOT_DIR to write a JPEG of each screen.

const shots = process.env.SHOT_DIR === undefined || process.env.SHOT_DIR === '' ? undefined : process.env.SHOT_DIR;
const USER = '11111111-1111-4111-8111-111111111111';
const DRIVER = '77777777-7777-4777-8777-777777777777';
const ACCESS = 'ACCESS_TOKEN_' + 'a'.repeat(30);
const PASSWORD = 'Mật khẩu thử 12345';
const PHONE = '0987654321';
const NAME = 'Nguyễn Văn An';

async function startBackend() {
  const state = { seen: [], driver: null, dropNextSubmit: false };
  const reset = () => {
    state.seen.length = 0;
    state.driver = null;
    state.dropNextSubmit = false;
  };
  const who = () => ({
    user_id: USER,
    phone_normalized: '+84987654321',
    available_roles: state.driver === null ? ['CUSTOMER'] : ['CUSTOMER', 'DRIVER'],
    active_role: 'CUSTOMER',
    profile: { full_name: NAME, version: 1 },
    capabilities: { customer_access: true, shop_profile_read: false, shop_manage: false, driver_profile_read: state.driver !== null },
    onboarding: { shop: 'NOT_STARTED', driver: state.driver === null ? 'NOT_STARTED' : state.driver.status === 'PENDING' ? 'PENDING_APPROVAL' : state.driver.status },
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
      } else if (route === 'GET /v1/driver/me') {
        send(response, 200, { data: state.driver });
      } else if (route === 'POST /v1/onboarding/driver') {
        const sent = JSON.parse(body);
        if (state.driver !== null) {
          send(response, 409, err('DRIVER_PROFILE_EXISTS'));
          return;
        }
        state.driver = { driver_id: DRIVER, user_id: USER, full_name: sent.full_name, plate_number: sent.plate_number, status: 'PENDING', accepting_deliveries: false, version: 1 };
        if (state.dropNextSubmit) {
          // The work is done, the answer is lost: the person sees an unknown outcome and presses "Thử lại".
          state.dropNextSubmit = false;
          response.socket.destroy();
          return;
        }
        send(response, 201, { data: { driver_id: DRIVER, status: 'PENDING', accepting_deliveries: false, role_granted: true, version: 1 } });
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
  work = mkdtempSync(join(tmpdir(), 'ship-driver-browser-'));
  const made = createLocalCertificate(join(work, 'tls'), 30);
  const pem = readFileSync(made.cert);
  const dist = buildClientWeb('ship-web', { outDir: join(work, 'ship'), quiet: true }).dist;
  backend = await startBackend();
  front = createClientWebServer({ app: 'ship-web', distDir: dist, backendUrl: backend.url, key: readFileSync(made.key), cert: pem, authTimeoutMs: 4000 });
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

const waitPath = (page, expected) => page.waitFor(`location.pathname === ${JSON.stringify(expected)} && document.querySelector('#app')?.children.length > 0`, `path ${expected}`);
const clickRow = (page, title) => page.evaluate(`(() => { const row = [...document.querySelectorAll('.c-item')].find((e) => e.querySelector('.c-item__title')?.textContent.trim() === ${JSON.stringify(title)}); if (!row) { throw new Error('no row ${title}'); } row.click(); return true; })()`);
const formReady = (page) => page.waitFor(`document.querySelector('#driver-submit') && !document.querySelector('#driver-submit').disabled`, 'S12 ready');
const statusReady = (page) => page.waitFor(`location.pathname === '/driver/status' && document.querySelector('#driver-status-card')`, 'S13 loaded');

async function login(page) {
  await page.goto(`${origin}/login`);
  await page.fill('#phone', PHONE);
  await page.fill('#password', PASSWORD);
  await page.click('#login-submit');
  await waitPath(page, '/');
}

async function toForm(page) {
  await page.click('a[href="/account"]');
  await waitPath(page, '/account');
  await clickRow(page, 'Hồ sơ shipper');
  await waitPath(page, '/driver/onboarding');
  await formReady(page);
}

describe('the driver profile journey (stand-in backend)', () => {
  it('S12 reads first, an invalid form sends nothing, submit shows the real PENDING profile on S13, CUSTOMER stays', async () => {
    await withPage(async (page) => {
      await login(page);
      await toForm(page);
      assert.equal(backend.calls('GET', '/v1/driver/me').length, 1, 'the server is asked before the form is usable');
      assert.equal(await page.evaluate(`document.querySelector('#legal-name').value`), '', 'the customer name is not copied in');
      const overflowS12 = await page.evaluate(OVERFLOW);
      assert.ok(overflowS12.scrollWidth <= overflowS12.innerWidth, 'S12 does not scroll sideways');
      assert.deepEqual(await page.evaluate(SMALL_TARGETS), [], 'touch targets on S12');
      await page.shot(shots, 's12-empty');

      await page.click('#driver-submit');
      await page.waitFor(`!document.querySelector('#legal-name-error').hidden`, 'name error');
      await page.fill('#legal-name', 'Nguyễn Văn Shipper');
      await page.fill('#plate', '59A\u200B123');
      await page.click('#driver-submit');
      await page.waitFor(`!document.querySelector('#plate-error').hidden`, 'plate error');
      assert.equal(backend.calls('POST', '/v1/onboarding/driver').length, 0, 'an invalid form sends nothing');

      await page.fill('#plate', '59A-123.45');
      await page.shot(shots, 's12-filled');
      await page.click('#driver-submit');
      await statusReady(page);
      assert.equal(backend.calls('POST', '/v1/onboarding/driver').length, 1);
      const [sent] = backend.calls('POST', '/v1/onboarding/driver');
      assert.deepEqual(JSON.parse(sent.body), { full_name: 'Nguyễn Văn Shipper', plate_number: '59A-123.45' });
      assert.match(sent.headers['idempotency-key'], /^[0-9a-f-]{36}$/);
      assert.equal(backend.calls('POST', '/v1/client-auth/context').length, 0, 'no context is selected');
      assert.equal(await page.evaluate(`document.querySelector('#driver-status-card').dataset.status`), 'PENDING');
      assert.equal(await page.evaluate(`document.querySelector('#driver-status-title').innerText`), 'Hồ sơ đang chờ duyệt');
      assert.equal(await page.evaluate(`document.querySelector('#driver-name').innerText`), 'Nguyễn Văn Shipper');
      assert.equal(await page.evaluate(`document.querySelector('#driver-plate').innerText`), '59A-123.45');
      assert.equal(await page.evaluate(`document.querySelector('#driver-type')`), null, 'no classification on the Shipper screen');
      const overflowS13 = await page.evaluate(OVERFLOW);
      assert.ok(overflowS13.scrollWidth <= overflowS13.innerWidth, 'S13 does not scroll sideways');
      assert.deepEqual(await page.evaluate(SMALL_TARGETS), [], 'touch targets on S13');
      await page.shot(shots, 's13-pending');

      await page.click('header button[aria-label="Quay lại"], header button');
      await waitPath(page, '/account');
      assert.match(await page.evaluate(`document.querySelector('main').innerText`), /Chờ duyệt/);
      await page.shot(shots, 's05-account');
    });
  });

  it('an unknown outcome keeps the same key and body for "Thử lại"; the lost answer never creates a second profile', async () => {
    await withPage(async (page) => {
      await login(page);
      await toForm(page);
      backend.state.dropNextSubmit = true;
      await page.fill('#legal-name', 'Nguyễn Văn Shipper');
      await page.click('#driver-submit');
      await page.waitFor(`document.querySelector('form .c-banner--error, form .c-banner--warn')`, 'failure banner');
      assert.equal(backend.calls('POST', '/v1/onboarding/driver').length, 1, 'no automatic retry');
      assert.equal(await page.evaluate(`location.pathname`), '/driver/onboarding');
      await page.shot(shots, 's12-outcome-unknown');
      await page.click('form .c-banner button');
      // The stand-in answers 409 to the second POST (the work was done): the page reads the profile and shows S13.
      await page.waitFor(`location.pathname === '/driver/status'`, 'S13').catch(async (e) => { console.log('DBG', backend.state.seen.map((x) => x.method + ' ' + x.url).join(' ; '), JSON.stringify(page.problems)); throw e; });
      await statusReady(page);
      const posts = backend.calls('POST', '/v1/onboarding/driver');
      assert.equal(posts.length, 2);
      assert.equal(posts[1].headers['idempotency-key'], posts[0].headers['idempotency-key'], 'the same key');
      assert.equal(posts[1].body, posts[0].body, 'the same body');
      assert.equal(await page.evaluate(`document.querySelector('#driver-status-card').dataset.status`), 'PENDING');
    });
  });

  it('a person who already has a profile never sees a create form; every stored status is shown as the server holds it', async () => {
    await withPage(async (page) => {
      backend.state.driver = { driver_id: DRIVER, user_id: USER, full_name: 'Trần Shipper Sẵn', plate_number: null, driver_type: 'PLATFORM', status: 'SUSPENDED', accepting_deliveries: false, version: 4 };
      await login(page);
      await page.click('a[href="/account"]');
      await waitPath(page, '/account');
      await clickRow(page, 'Hồ sơ shipper');
      await statusReady(page);
      assert.equal(await page.evaluate(`document.querySelector('#driver-status-title').innerText`), 'Hồ sơ đang bị tạm khóa');
      assert.equal(await page.evaluate(`document.querySelector('#driver-plate').innerText`), 'Chưa bổ sung');
      assert.equal(await page.evaluate(`document.querySelector('#driver-type')`), null, 'even a server that sent a classification would not show it');
      assert.equal(await page.evaluate(`document.body.innerText.includes('PLATFORM')`), false);
      assert.equal(await page.evaluate(`document.querySelector('#driver-submit')`), null, 'no create or edit button on S13');
      // S12 opened directly (here through the router) goes to S13: the profile is read, not created again.
      await page.evaluate(`(() => { history.pushState(null, '', '/driver/onboarding'); window.dispatchEvent(new PopStateEvent('popstate')); })()`);
      await statusReady(page);
      assert.equal(backend.calls('POST', '/v1/onboarding/driver').length, 0);
      await page.shot(shots, 's13-suspended');
      // A status change on the server shows after "Tải lại".
      backend.state.driver = { ...backend.state.driver, status: 'ACTIVE', version: 5 };
      await page.click('#driver-reload');
      await page.waitFor(`document.querySelector('#driver-status-card')?.dataset.status === 'ACTIVE'`, 'ACTIVE shown');
      assert.equal(await page.evaluate(`document.querySelector('#driver-status-title').innerText`), 'Hồ sơ đã được duyệt');
      assert.match(await page.evaluate(`document.querySelector('main').innerText`), /Nhận đơn chưa mở/);
    });
  });
});
