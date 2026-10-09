import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { after, before, test } from 'node:test';
import { createWebServer, parseApiOrigin } from '../../scripts/web-dev-server.mjs';

let upstream;
let web;
let webPort;
const seen = [];

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function call(path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: webPort, path, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

before(async () => {
  upstream = createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
      res.writeHead(200, { 'Content-Type': 'application/json', 'X-Request-ID': 'abc', 'Set-Cookie': 'sid=1' });
      res.end('{"data":{"proxied":true}}');
    });
  });
  const upstreamPort = await listen(upstream);
  web = createWebServer({ apiOrigin: `http://127.0.0.1:${upstreamPort}` });
  webPort = await listen(web);
});

after(() => {
  web.close();
  upstream.close();
});

test('serves the app with security headers and no caching', async () => {
  const page = await call('/');
  assert.equal(page.status, 200);
  assert.match(page.headers['content-type'], /text\/html/);
  assert.match(page.body, /Môi trường thử nghiệm/);
  assert.match(page.headers['content-security-policy'], /default-src 'none'/);
  assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(page.headers['x-content-type-options'], 'nosniff');
  assert.equal(page.headers['referrer-policy'], 'no-referrer');
  assert.equal(page.headers['cache-control'], 'no-store');
  const js = await call('/src/main.js');
  assert.match(js.headers['content-type'], /text\/javascript/);
});

test('refuses path traversal, directories, and writes to static files', async () => {
  for (const path of ['/../package.json', '/%2e%2e/package.json', '/src/', '/..%2f..%2fetc/passwd', '/nope.txt']) {
    const result = await call(path);
    assert.equal(result.status, 404, path);
  }
  assert.equal((await call('/', { method: 'POST' })).status, 405);
});

test('/v1 is forwarded as is: method, path, bearer and body pass; cookies and origin do not; set-cookie is dropped', async () => {
  seen.length = 0;
  const result = await call('/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok', Cookie: 'a=b', Origin: 'http://evil.test', 'Idempotency-Key': 'k' },
    body: '{"x":1}',
  });
  assert.equal(result.status, 200);
  assert.equal(result.body, '{"data":{"proxied":true}}');
  assert.equal(result.headers['x-request-id'], 'abc');
  assert.equal(result.headers['set-cookie'], undefined);
  assert.equal(result.headers['cache-control'], 'no-store');
  assert.equal(seen.length, 1);
  assert.deepEqual({ method: seen[0].method, url: seen[0].url, body: seen[0].body }, { method: 'POST', url: '/v1/auth/login', body: '{"x":1}' });
  assert.equal(seen[0].headers.authorization, 'Bearer tok');
  assert.equal(seen[0].headers['idempotency-key'], 'k');
  assert.equal(seen[0].headers.cookie, undefined);
  assert.equal(seen[0].headers.origin, undefined);
});

test('API unreachable -> the standard 503 error envelope, so the client shows its normal copy', async () => {
  const dead = createWebServer({ apiOrigin: 'http://127.0.0.1:9' });
  const port = await listen(dead);
  const result = await new Promise((resolve, reject) => {
    request({ host: '127.0.0.1', port, path: '/v1/auth/me' }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    })
      .on('error', reject)
      .end();
  });
  dead.close();
  assert.equal(result.status, 503);
  assert.equal(result.body.error.code, 'SERVICE_UNAVAILABLE');
  assert.match(result.body.error.request_id, /^[0-9a-f-]{36}$/);
});

test('WEB_API_ORIGIN must be a plain origin', () => {
  assert.equal(parseApiOrigin('https://api.example.test').origin, 'https://api.example.test');
  for (const bad of ['https://u:p@api.test', 'https://api.test/v1', 'ftp://api.test', 'https://api.test?x=1']) {
    assert.throws(() => parseApiOrigin(bad), /WEB_API_ORIGIN/, bad);
  }
});
