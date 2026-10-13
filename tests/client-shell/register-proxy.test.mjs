import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createLocalCertificate } from '../../scripts/admin-web-cert.mjs';
import { buildClientWeb } from '../../scripts/client-web-build.mjs';
import { createClientWebServer, FOOD_AUTH_ROUTES, MAX_AUTH_REQUEST_BYTES } from '../../scripts/client-web-dev.mjs';

// M01.07: the three register routes the local 11Food front forwards (and ONLY those). Real TLS, real HTTP listeners; the backend
// is a small controlled server because only a stand-in can answer slowly, wrongly or with a cookie on demand. The real backend
// behind the same routes is exercised by tests/integration/food-register-browser.int.spec.ts (CI, PostgreSQL).

let work;
let tls;
const builds = {};
before(() => {
  work = mkdtempSync(join(tmpdir(), 'register-proxy-'));
  const made = createLocalCertificate(join(work, 'tls'), 30);
  tls = { ...made, pem: readFileSync(made.cert) };
  for (const app of ['food-web', 'ship-web']) {
    builds[app] = buildClientWeb(app, { outDir: join(work, app), quiet: true }).dist;
  }
});
after(() => rmSync(work, { recursive: true, force: true }));

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = (server) => new Promise((resolve) => {
  server.closeAllConnections?.();
  server.close(() => resolve());
});

const UUID = '33333333-3333-4333-8333-333333333333';
const KEY = '44444444-4444-4444-8444-444444444444';

/** A stand-in backend: records every request (headers + raw body) and answers by `behaviour`. */
async function startBackend() {
  const seen = [];
  const behaviour = { mode: 'ok' };
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      seen.push({ method: request.method, url: request.url, headers: request.headers, body: Buffer.concat(chunks) });
      const json = (status, body, headers = {}) => {
        response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
        response.end(typeof body === 'string' ? body : JSON.stringify(body));
      };
      switch (behaviour.mode) {
        case 'ok':
          return json(201, { data: { echoed: true } }, { 'set-cookie': 'sid=SECRET_COOKIE; HttpOnly', 'x-powered-by': 'backend-internal' });
        case 'limited':
          return json(429, { error: { code: 'OTP_RATE_LIMITED', message: 'x', request_id: 'r', details: {} } }, { 'retry-after': '42' });
        case 'badretry':
          return json(429, { error: { code: 'OTP_RATE_LIMITED', message: 'x', request_id: 'r', details: {} } }, { 'retry-after': '42 seconds, soon' });
        case 'html':
          response.writeHead(200, { 'content-type': 'text/html' });
          return response.end('<p>SECRET_MARKER_HTML</p>');
        case 'redirect':
          response.writeHead(302, { location: 'http://evil.example/', 'content-type': 'application/json' });
          return response.end('{}');
        case 'huge':
          return json(200, JSON.stringify({ data: { pad: 'x'.repeat(40_000) } }));
        case 'ok200':
          return json(200, { data: { echoed: true } }, { 'set-cookie': 'sid=SECRET_COOKIE; HttpOnly', 'x-powered-by': 'backend-internal' });
        case 'nocontent':
          response.writeHead(204, { 'set-cookie': 'sid=SECRET_COOKIE' });
          return response.end();
        case 'config':
          return json(200, { data: { registration_verification: 'DISABLED_TEST' } }, { 'set-cookie': 'sid=SECRET_COOKIE', 'cache-control': 'public, max-age=600' });
        case 'recovery-config':
          return json(200, { data: { mode: 'DISABLED_TEST' } }, { 'set-cookie': 'sid=SECRET_COOKIE', 'cache-control': 'public, max-age=600' });
        case 'recovery-config-extra':
          return json(200, { data: { mode: 'DISABLED_TEST', other: 1 } });
        case 'recovery-config-unknown':
          return json(200, { data: { mode: 'ON' } });
        case 'config-extra':
          return json(200, { data: { registration_verification: 'DISABLED_TEST', other: 1 } });
        case 'config-unknown':
          return json(200, { data: { registration_verification: 'ENABLED' } });
        case 'config-error':
          return json(503, { error: { code: 'SERVICE_UNAVAILABLE', message: 'x', request_id: 'r', details: {} } });
        case 'hang':
          return undefined;
        default:
          throw new Error(`unknown mode ${behaviour.mode}`);
      }
    });
  });
  const port = await listen(server);
  return { seen, behaviour, url: `http://127.0.0.1:${String(port)}`, stop: () => close(server) };
}

async function startFront(app, backendUrl, options = {}) {
  const server = createClientWebServer({ app, distDir: builds[app], backendUrl, key: readFileSync(tls.key), cert: tls.pem, ...options });
  const port = await listen(server);
  return { port, stop: () => close(server) };
}

/** One request to the front over TLS (the pinned certificate is the only one trusted). */
function call(port, path, { method = 'POST', headers = {}, body, origin = `https://localhost:${String(port)}`, contentType = 'application/json' } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.isBuffer(body) ? body : Buffer.from(body);
    const request = https.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        ca: tls.pem,
        servername: 'localhost',
        headers: {
          host: `localhost:${String(port)}`,
          ...(origin === null ? {} : { origin }),
          ...(contentType === null ? {} : { 'content-type': contentType }),
          ...(payload === undefined ? {} : { 'content-length': String(payload.length) }),
          ...headers,
        },
      },
      (answer) => {
        const parts = [];
        answer.on('data', (chunk) => parts.push(chunk));
        answer.on('end', () => resolve({ status: answer.statusCode, headers: answer.headers, text: Buffer.concat(parts).toString('utf8') }));
      },
    );
    request.on('error', reject);
    request.end(payload);
  });
}

const OTP_BODY = JSON.stringify({ phone: '0987654321', purpose: 'REGISTER' });
const REGISTER_BODY = JSON.stringify({ phone: '0987654321', password: 'Mật khẩu  có dấu cách ', verification_token: 'tok', device: { device_id: 'web-1', platform: 'WEB', app: 'FOOD' }, full_name: 'An', consent: { terms_version: 'a', privacy_version: 'b' } });

const ROUTES = [
  { name: 'request a code', path: '/v1/auth/phone-verifications', body: OTP_BODY, keyed: false },
  { name: 'verify a code', path: `/v1/auth/phone-verifications/${UUID}/verify`, body: JSON.stringify({ otp: '123456' }), keyed: false },
  { name: 'register', path: '/v1/client-auth/register', body: REGISTER_BODY, keyed: true },
  // M01-RESET: public, keyed, never carries the browser's cookie or Bearer.
  { name: 'no-OTP test password reset', path: '/v1/account-recovery/reset-test', body: JSON.stringify({ phone: '0987654321', password: 'Mật khẩu mới có dấu cách ' }), keyed: true },
];

const TOKEN = 'ACCESS_TOKEN_' + 'a'.repeat(30);
const LOGIN_BODY = JSON.stringify({ phone: '0987654321', password: 'Mật khẩu  có dấu cách ', device: { device_id: 'web-1', platform: 'WEB', app: 'FOOD' } });
const PROFILE_BODY = JSON.stringify({ full_name: 'Nguyễn Văn An', expected_version: 1 });
const CONTEXT_BODY = JSON.stringify({ context: 'SHOP_OWNER' });
const SHOP_BODY = JSON.stringify({ name: 'Quán A', contact_phone: '0987654321', address_text: '1 Đường A', zalo: null, facebook: null, pickup_lat: null, pickup_lng: null, service_area_id: null, expected_version: null });
const COMPLETE_BODY = JSON.stringify({ expected_version: 1 });
const ACCOUNT_ROUTES = [
  { name: 'login', method: 'POST', path: '/v1/client-auth/login', body: LOGIN_BODY, keyed: true, bearer: false },
  { name: 'me', method: 'GET', path: '/v1/client-auth/me', keyed: false, bearer: true },
  { name: 'logout', method: 'POST', path: '/v1/client-auth/logout', body: '{}', keyed: false, bearer: true, noContent: true },
  { name: 'profile read', method: 'GET', path: '/v1/customer/me/profile', keyed: false, bearer: true },
  { name: 'profile save', method: 'PUT', path: '/v1/customer/me/profile', body: PROFILE_BODY, keyed: true, bearer: true },
  { name: 'context', method: 'POST', path: '/v1/client-auth/context', body: CONTEXT_BODY, keyed: true, bearer: true },
  // The shop onboarding of 11Food (and only 11Food: see the 11Ship test below).
  { name: 'shop profile read', method: 'GET', path: '/v1/onboarding/shop/profile', keyed: false, bearer: true },
  { name: 'shop profile save', method: 'PUT', path: '/v1/onboarding/shop/profile', body: SHOP_BODY, keyed: true, bearer: true },
  { name: 'shop complete', method: 'POST', path: '/v1/onboarding/shop/complete', body: COMPLETE_BODY, keyed: true, bearer: true },
  { name: 'shop service areas', method: 'GET', path: '/v1/onboarding/shop/service-areas', keyed: false, bearer: true },
];
const DRIVER_BODY = JSON.stringify({ full_name: 'Nguyễn Văn An', plate_number: null });
const DRIVER_ROUTES = [
  { name: 'driver submit', method: 'POST', path: '/v1/onboarding/driver', body: DRIVER_BODY, keyed: true },
  { name: 'driver me', method: 'GET', path: '/v1/driver/me', keyed: false },
];
const SHOP_ONLY_PATHS = ['/v1/onboarding/shop/profile', '/v1/onboarding/shop/complete', '/v1/onboarding/shop/service-areas'];

describe('11Food front: exactly the register routes (+ the read-only mode route) and the account routes', () => {
  let backend;
  let front;
  before(async () => {
    backend = await startBackend();
    front = await startFront('food-web', backend.url, { authTimeoutMs: 1500 });
  });
  after(async () => {
    await front.stop();
    await backend.stop();
  });

  it('the route table is the register routes, the config and the account routes - nothing else', () => {
    assert.deepEqual(FOOD_AUTH_ROUTES.map((route) => route.id), ['otp-request', 'otp-verify', 'register', 'config', 'recovery-config', 'recovery-reset', 'login', 'me', 'logout', 'profile-read', 'profile-save', 'context', 'shop-profile-read', 'shop-profile-save', 'shop-complete', 'shop-service-areas', 'driver-submit', 'driver-read']);
  });

  for (const route of ROUTES) {
    it(`${route.name}: forwards the body byte for byte, the key only where it belongs, and nothing of the browser`, async () => {
      backend.seen.length = 0;
      backend.behaviour.mode = 'ok';
      const answer = await call(front.port, route.path, {
        body: route.body,
        headers: {
          ...(route.keyed ? { 'idempotency-key': KEY } : { 'idempotency-key': 'must-not-pass' }),
          cookie: 'sid=BROWSER_COOKIE',
          authorization: 'Bearer BROWSER_TOKEN',
          referer: 'https://localhost/x',
          'x-forwarded-for': '203.0.113.9',
        },
      });
      assert.equal(answer.status, 201);
      assert.deepEqual(JSON.parse(answer.text), { data: { echoed: true } });
      assert.equal(backend.seen.length, 1);
      const [seen] = backend.seen;
      assert.equal(seen.method, 'POST');
      assert.equal(seen.url, route.path);
      assert.equal(seen.body.toString('utf8'), route.body, 'the body is forwarded exactly, spaces and accents included');
      assert.equal(seen.headers['idempotency-key'], route.keyed ? KEY : undefined);
      for (const name of ['cookie', 'authorization', 'origin', 'referer', 'x-forwarded-for']) {
        assert.equal(seen.headers[name], undefined, `${name} is not forwarded`);
      }
      assert.match(seen.headers.host, /^127\.0\.0\.1:\d+$/);
      // What the browser gets back: no-store, no cookie, none of the backend's own headers.
      assert.equal(answer.headers['cache-control'], 'no-store');
      assert.equal(answer.headers['set-cookie'], undefined);
      assert.equal(answer.headers['x-powered-by'], undefined);
      assert.doesNotMatch(answer.text, /SECRET_COOKIE/);
    });
  }

  it('passes the backend status, body and Retry-After on (a 429 keeps the wait the server gave)', async () => {
    backend.behaviour.mode = 'limited';
    const answer = await call(front.port, ROUTES[0].path, { body: OTP_BODY });
    assert.equal(answer.status, 429);
    assert.equal(answer.headers['retry-after'], '42');
    assert.equal(JSON.parse(answer.text).error.code, 'OTP_RATE_LIMITED');
    assert.equal(answer.headers['cache-control'], 'no-store');
  });

  it('refuses a request of another site, a non-JSON body, an oversized or empty body and a register without a usable key - before the backend', async () => {
    backend.seen.length = 0;
    backend.behaviour.mode = 'ok';
    const cases = [
      ['another origin', ROUTES[0].path, { body: OTP_BODY, origin: 'https://evil.example' }, 403],
      ['no origin', ROUTES[0].path, { body: OTP_BODY, origin: null }, 403],
      ['origin with another port', ROUTES[0].path, { body: OTP_BODY, origin: 'https://localhost:1' }, 403],
      ['cross-site fetch metadata', ROUTES[0].path, { body: OTP_BODY, headers: { 'sec-fetch-site': 'cross-site' } }, 403],
      ['form content type', ROUTES[0].path, { body: 'phone=1', contentType: 'application/x-www-form-urlencoded' }, 415],
      ['no content type', ROUTES[0].path, { body: OTP_BODY, contentType: null }, 415],
      ['text content type', ROUTES[0].path, { body: OTP_BODY, contentType: 'text/plain' }, 415],
      ['body over the limit', ROUTES[0].path, { body: JSON.stringify({ pad: 'x'.repeat(MAX_AUTH_REQUEST_BYTES) }) }, 413],
      ['empty body', ROUTES[0].path, { body: '' }, 400],
      ['register without a key', ROUTES[2].path, { body: REGISTER_BODY }, 400],
      ['register with a malformed key', ROUTES[2].path, { body: REGISTER_BODY, headers: { 'idempotency-key': 'a b;c' } }, 400],
    ];
    for (const [name, path, options, status] of cases) {
      const answer = await call(front.port, path, options);
      assert.equal(answer.status, status, name);
      assert.equal(answer.headers['cache-control'], 'no-store', name);
    }
    assert.equal(backend.seen.length, 0, 'nothing of it reached the backend');
  });

  it('opens nothing else: other methods, a query string, a trailing slash, another id, a wildcard, other /v1 routes', async () => {
    backend.seen.length = 0;
    for (const route of ROUTES) {
      for (const method of ['GET', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']) {
        const answer = await call(front.port, route.path, { method });
        assert.equal(answer.status, 405, `${method} ${route.path}`);
        assert.equal(answer.headers.allow, 'POST');
      }
      assert.equal((await call(front.port, `${route.path}?x=1`, { body: route.body, headers: { 'idempotency-key': KEY } })).status, 404, 'query string');
      assert.equal((await call(front.port, `${route.path}/`, { body: route.body, headers: { 'idempotency-key': KEY } })).status, 404, 'trailing slash');
    }
    for (const path of [
      '/v1/auth/phone-verifications/not-a-uuid/verify',
      `/v1/auth/phone-verifications/${UUID}`,
      `/v1/auth/phone-verifications/${UUID}/verify/x`,
      `/v1/auth/phone-verifications/${UUID}%2fverify`,
      '/v1/auth/phone-verifications/../login',
      '/v1/auth/login',
      '/v1/auth/password-resets',
      '/v1/onboarding',
      '/v1/onboarding/shop',
      '/v1/onboarding/shop/profile/x',
      '/v1/onboarding/driver/profile',
      '/v1/customer/me',
      '/v1/customer/me/profile/x',
      '/v1/customer/me/driver-profile',
      '/v1/client-auth',
      '/v1',
      '/v1/admin-auth/state',
      '/v1/orders',
    ]) {
      const answer = await call(front.port, path, { body: OTP_BODY, headers: { 'idempotency-key': KEY } });
      assert.equal(answer.status, 404, path);
    }
    assert.equal(backend.seen.length, 0, 'none of these reached the backend');
  });

  it('the driver profile is 11Ship only: 11Food answers 404 and never reaches the backend', async () => {
    backend.seen.length = 0;
    for (const route of DRIVER_ROUTES) {
      const answer = await call(front.port, route.path, { method: route.method, ...(route.body === undefined ? { contentType: null, origin: null } : { body: route.body }), headers: { 'idempotency-key': KEY, authorization: `Bearer ${TOKEN}` } });
      assert.equal(answer.status, 404, route.path);
    }
    assert.equal(backend.seen.length, 0);
  });

  for (const route of ACCOUNT_ROUTES) {
    it(`${route.name}: ${route.method} forwarded with the method, the key and the bearer only where they belong, nothing else of the browser`, async () => {
      backend.seen.length = 0;
      backend.behaviour.mode = route.noContent ? 'nocontent' : route.method === 'POST' ? 'ok' : 'ok200';
      const answer = await call(front.port, route.path, {
        method: route.method,
        ...(route.body === undefined ? { contentType: null } : { body: route.body }),
        ...(route.method === 'GET' ? { origin: null } : {}),
        headers: {
          ...(route.keyed ? { 'idempotency-key': KEY } : { 'idempotency-key': 'must-not-pass' }),
          authorization: `Bearer ${TOKEN}`,
          cookie: 'sid=BROWSER_COOKIE',
          referer: 'https://localhost/x',
          'x-forwarded-for': '203.0.113.9',
        },
      });
      assert.equal(answer.status, route.noContent ? 204 : route.method === 'POST' ? 201 : 200);
      assert.equal(backend.seen.length, 1);
      const [seen] = backend.seen;
      assert.equal(seen.method, route.method);
      assert.equal(seen.url, route.path);
      assert.equal(seen.body.toString('utf8'), route.body ?? '', 'the body is forwarded exactly');
      assert.equal(seen.headers['idempotency-key'], route.keyed ? KEY : undefined);
      assert.equal(seen.headers.authorization, route.bearer ? `Bearer ${TOKEN}` : undefined);
      for (const name of ['cookie', 'origin', 'referer', 'x-forwarded-for']) {
        assert.equal(seen.headers[name], undefined, `${name} is not forwarded`);
      }
      assert.equal(answer.headers['cache-control'], 'no-store');
      assert.equal(answer.headers['set-cookie'], undefined);
      assert.doesNotMatch(answer.text, /SECRET_COOKIE/);
      backend.behaviour.mode = 'ok';
    });
  }

  it('account routes: a missing or malformed bearer, another site, a wrong method or a keyless save are refused before the backend', async () => {
    backend.seen.length = 0;
    const withoutBearer = await call(front.port, '/v1/client-auth/me', { method: 'GET', contentType: null, origin: null });
    assert.equal(withoutBearer.status, 401);
    const badBearer = await call(front.port, '/v1/customer/me/profile', { method: 'GET', contentType: null, origin: null, headers: { authorization: 'Bearer short' } });
    assert.equal(badBearer.status, 401);
    const otherSite = await call(front.port, '/v1/customer/me/profile', { method: 'PUT', body: PROFILE_BODY, origin: 'https://evil.example', headers: { authorization: `Bearer ${TOKEN}`, 'idempotency-key': KEY } });
    assert.equal(otherSite.status, 403);
    const noKey = await call(front.port, '/v1/customer/me/profile', { method: 'PUT', body: PROFILE_BODY, headers: { authorization: `Bearer ${TOKEN}` } });
    assert.equal(noKey.status, 400);
    const noKeyLogin = await call(front.port, '/v1/client-auth/login', { body: LOGIN_BODY });
    assert.equal(noKeyLogin.status, 400);
    const getWithBody = await call(front.port, '/v1/client-auth/me', { method: 'GET', body: '{}', origin: null, headers: { authorization: `Bearer ${TOKEN}` } });
    assert.equal(getWithBody.status, 400);
    for (const method of ['POST', 'DELETE', 'PATCH']) {
      const answer = await call(front.port, '/v1/customer/me/profile', { method, body: '{}', headers: { authorization: `Bearer ${TOKEN}` } });
      assert.equal(answer.status, 405, method);
      assert.equal(answer.headers.allow, 'GET, PUT');
    }
    assert.equal((await call(front.port, '/v1/customer/me/profile?x=1', { method: 'GET', contentType: null, origin: null, headers: { authorization: `Bearer ${TOKEN}` } })).status, 404);
    assert.equal(backend.seen.length, 0, 'none of these reached the backend');
  });

  it('GET /v1/client-auth/config: forwarded as a bodyless GET, the shape re-serialised, no-store, nothing of the backend headers', async () => {
    backend.seen.length = 0;
    backend.behaviour.mode = 'config';
    const answer = await call(front.port, '/v1/client-auth/config', { method: 'GET', contentType: null });
    assert.equal(answer.status, 200);
    assert.deepEqual(JSON.parse(answer.text), { data: { registration_verification: 'DISABLED_TEST' } });
    assert.equal(answer.headers['cache-control'], 'no-store');
    assert.equal(answer.headers['set-cookie'], undefined);
    assert.equal(backend.seen.length, 1);
    assert.equal(backend.seen[0].method, 'GET');
    assert.equal(backend.seen[0].url, '/v1/client-auth/config');
    assert.equal(backend.seen[0].body.length, 0);
    assert.equal(backend.seen[0].headers.cookie, undefined);
    backend.behaviour.mode = 'ok';
  });

  it('GET /v1/account-recovery/config: bodyless GET, shape re-serialised, no-store; refusals and bad answers never pass content on', async () => {
    backend.seen.length = 0;
    backend.behaviour.mode = 'recovery-config';
    const answer = await call(front.port, '/v1/account-recovery/config', { method: 'GET', contentType: null });
    assert.equal(answer.status, 200);
    assert.deepEqual(JSON.parse(answer.text), { data: { mode: 'DISABLED_TEST' } });
    assert.equal(answer.headers['cache-control'], 'no-store');
    assert.equal(answer.headers['set-cookie'], undefined);
    assert.equal(backend.seen.length, 1);
    assert.equal(backend.seen[0].url, '/v1/account-recovery/config');
    assert.equal(backend.seen[0].headers.cookie, undefined);
    backend.seen.length = 0;
    assert.equal((await call(front.port, '/v1/account-recovery/config', { method: 'GET', contentType: null, origin: 'https://evil.example' })).status >= 400, true);
    assert.equal((await call(front.port, '/v1/account-recovery/config', { method: 'POST', body: '{}' })).status, 405);
    assert.equal((await call(front.port, '/v1/account-recovery/config?x=1', { method: 'GET', contentType: null })).status, 404);
    assert.equal((await call(front.port, '/v1/account-recovery/reset-test', { method: 'GET', contentType: null })).status, 405);
    assert.equal((await call(front.port, '/v1/account-recovery/reset-test?x=1', { body: '{}' })).status, 404);
    assert.equal((await call(front.port, '/v1/account-recovery/other', { body: '{}' })).status, 404);
    assert.equal(backend.seen.length, 0, 'none of these reached the backend');
    for (const mode of ['recovery-config-extra', 'recovery-config-unknown', 'config-error', 'html', 'huge', 'redirect']) {
      backend.behaviour.mode = mode;
      const bad = await call(front.port, '/v1/account-recovery/config', { method: 'GET', contentType: null });
      assert.equal(bad.status, 502, mode);
      assert.equal(bad.text.includes('SECRET_MARKER'), false, mode);
    }
    backend.behaviour.mode = 'ok';
  });

  it('GET /v1/client-auth/config: another site, other methods, a query, a trailing slash and a body are refused before the backend', async () => {
    backend.seen.length = 0;
    backend.behaviour.mode = 'config';
    assert.equal((await call(front.port, '/v1/client-auth/config', { method: 'GET', contentType: null, origin: 'https://evil.example' })).status >= 400, true);
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const answer = await call(front.port, '/v1/client-auth/config', { method, body: '{}' });
      assert.equal(answer.status, 405, method);
      assert.equal(answer.headers.allow, 'GET');
    }
    assert.equal((await call(front.port, '/v1/client-auth/config?x=1', { method: 'GET', contentType: null })).status, 404);
    assert.equal((await call(front.port, '/v1/client-auth/config/', { method: 'GET', contentType: null })).status, 404);
    assert.equal(backend.seen.length, 0, 'none of these reached the backend');
    backend.behaviour.mode = 'ok';
  });

  it('GET /v1/client-auth/config: an extra key, an unknown mode, an error or an oversized answer is 502 and its content is never passed on', async () => {
    for (const mode of ['config-extra', 'config-unknown', 'config-error', 'html', 'huge', 'redirect']) {
      backend.behaviour.mode = mode;
      const answer = await call(front.port, '/v1/client-auth/config', { method: 'GET', contentType: null });
      assert.equal(answer.status, 502, mode);
      assert.equal(answer.text.includes('SECRET_MARKER'), false, mode);
      assert.equal(answer.text.includes('ENABLED'), false, mode);
    }
    backend.behaviour.mode = 'ok';
  });

  it('a silent backend ends as 504 within the deadline; a non-JSON, a redirect or an oversized answer is 502 and its content is never passed on', async () => {
    for (const [mode, status] of [['hang', 504], ['html', 502], ['redirect', 502], ['huge', 502]]) {
      backend.behaviour.mode = mode;
      const started = Date.now();
      const answer = await call(front.port, ROUTES[0].path, { body: OTP_BODY });
      assert.equal(answer.status, status, mode);
      assert.doesNotMatch(answer.text, /SECRET_MARKER|evil\.example|xxxx/);
      assert.equal(answer.headers['cache-control'], 'no-store');
      assert.ok(Date.now() - started < 5000, `${mode} answered in time`);
    }
  });

  it('a Retry-After that is not whole seconds or an HTTP date is not passed on', async () => {
    backend.behaviour.mode = 'badretry';
    const answer = await call(front.port, ROUTES[0].path, { body: OTP_BODY });
    assert.equal(answer.status, 429);
    assert.equal(answer.headers['retry-after'], undefined);
  });
});

describe('11Ship front: the driver profile routes, exactly', () => {
  let backend;
  let front;
  before(async () => {
    backend = await startBackend();
    front = await startFront('ship-web', backend.url, { authTimeoutMs: 1500 });
  });
  after(async () => {
    await front.stop();
    await backend.stop();
  });

  for (const route of DRIVER_ROUTES) {
    it(`${route.name}: ${route.method} forwarded with the method, the bearer and the key only where they belong, nothing else of the browser`, async () => {
      backend.seen.length = 0;
      backend.behaviour.mode = route.method === 'POST' ? 'ok' : 'ok200';
      const answer = await call(front.port, route.path, {
        method: route.method,
        ...(route.body === undefined ? { contentType: null, origin: null } : { body: route.body }),
        headers: { ...(route.keyed ? { 'idempotency-key': KEY } : { 'idempotency-key': 'must-not-pass' }), authorization: `Bearer ${TOKEN}`, cookie: 'sid=BROWSER_COOKIE', referer: 'https://localhost/x', 'x-forwarded-for': '203.0.113.9' },
      });
      assert.equal(answer.status, route.method === 'POST' ? 201 : 200);
      assert.equal(backend.seen.length, 1);
      const [seen] = backend.seen;
      assert.equal(seen.method, route.method);
      assert.equal(seen.url, route.path);
      assert.equal(seen.body.toString('utf8'), route.body ?? '');
      assert.equal(seen.headers['idempotency-key'], route.keyed ? KEY : undefined);
      assert.equal(seen.headers.authorization, `Bearer ${TOKEN}`);
      for (const name of ['cookie', 'origin', 'referer', 'x-forwarded-for']) {
        assert.equal(seen.headers[name], undefined, `${name} is not forwarded`);
      }
      assert.equal(answer.headers['cache-control'], 'no-store');
      backend.behaviour.mode = 'ok';
    });
  }

  it('no wildcard: a missing bearer, a keyless submit, a wrong method, a query string or a neighbouring path never reach the backend', async () => {
    backend.seen.length = 0;
    assert.equal((await call(front.port, '/v1/driver/me', { method: 'GET', contentType: null, origin: null })).status, 401);
    assert.equal((await call(front.port, '/v1/onboarding/driver', { body: DRIVER_BODY, headers: { authorization: `Bearer ${TOKEN}` } })).status, 400);
    for (const method of ['POST', 'PUT', 'DELETE']) {
      assert.equal((await call(front.port, '/v1/driver/me', { method, body: '{}', headers: { authorization: `Bearer ${TOKEN}`, 'idempotency-key': KEY } })).status, 405, method);
    }
    for (const method of ['GET', 'PUT']) {
      assert.equal((await call(front.port, '/v1/onboarding/driver', { method, ...(method === 'GET' ? { contentType: null, origin: null } : { body: DRIVER_BODY }), headers: { authorization: `Bearer ${TOKEN}`, 'idempotency-key': KEY } })).status, 405, method);
    }
    for (const path of ['/v1/driver/me?x=1', '/v1/driver/me/', '/v1/driver', '/v1/onboarding/driver/x', '/v1/drivers/me']) {
      assert.equal((await call(front.port, path, { method: 'GET', contentType: null, origin: null, headers: { authorization: `Bearer ${TOKEN}` } })).status, 404, path);
    }
    assert.equal(backend.seen.length, 0);
  });
});

describe('11Ship front: the same account routes as 11Food and nothing else', () => {
  it('forwards register and login, and answers 404 to any other /v1 route without reaching the backend', async () => {
    const backend = await startBackend();
    const front = await startFront('ship-web', backend.url);
    try {
      for (const route of [...ROUTES, ACCOUNT_ROUTES[0]]) {
        backend.seen.length = 0;
        const answer = await call(front.port, route.path, { body: route.body, headers: { 'idempotency-key': KEY } });
        assert.equal(answer.status, 201, route.path);
        assert.equal(backend.seen.length, 1, route.path);
      }
      backend.seen.length = 0;
      for (const path of [...SHOP_ONLY_PATHS, '/v1/orders', '/v1/drivers/me', '/v1/admin-auth/state']) {
        for (const method of ['GET', 'POST', 'PUT']) {
          const answer = await call(front.port, path, { method, ...(method === 'GET' ? { contentType: null, origin: null } : { body: OTP_BODY }), headers: { 'idempotency-key': KEY, authorization: `Bearer ${TOKEN}` } });
          assert.equal(answer.status, 404, `${method} ${path}`);
        }
      }
      assert.equal(backend.seen.length, 0, 'the shop onboarding is 11Food only: 11Ship never reaches it');
      // The context switch is a client-auth route, shared by both apps.
      const context = await call(front.port, '/v1/client-auth/context', { body: CONTEXT_BODY, headers: { 'idempotency-key': KEY, authorization: `Bearer ${TOKEN}` } });
      assert.equal(context.status, 201);
      assert.equal(backend.seen.length, 1);
    } finally {
      await front.stop();
      await backend.stop();
    }
  });
});

describe('the front only talks to a loopback backend', () => {
  it('refuses to start with a backend that is not loopback http', () => {
    assert.throws(() => createClientWebServer({ app: 'food-web', distDir: builds['food-web'], backendUrl: 'http://example.com:3000', key: readFileSync(tls.key), cert: tls.pem }), /loopback/);
  });
});
