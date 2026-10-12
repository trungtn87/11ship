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
];

describe('11Food front: exactly the three register routes', () => {
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

  it('the route table is the three routes and nothing else', () => {
    assert.deepEqual(FOOD_AUTH_ROUTES.map((route) => route.id), ['otp-request', 'otp-verify', 'register']);
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
      '/v1/client-auth/login',
      '/v1/client-auth/me',
      '/v1/client-auth/logout',
      '/v1/client-auth/context',
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

describe('11Ship front: none of the register routes', () => {
  it('answers 404 to all three and never reaches the backend', async () => {
    const backend = await startBackend();
    const front = await startFront('ship-web', backend.url);
    try {
      for (const route of ROUTES) {
        const answer = await call(front.port, route.path, { body: route.body, headers: { 'idempotency-key': KEY } });
        assert.equal(answer.status, 404, route.path);
      }
      assert.equal(backend.seen.length, 0);
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
