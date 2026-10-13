import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createLocalCertificate } from '../../scripts/admin-web-cert.mjs';
import { createNativeGateway, FORWARDED_REQUEST_HEADERS, NATIVE_ROUTES } from '../../scripts/native-gateway.mjs';

// The local native gateway (M01-ANDROID): an exact allowlist, the body byte for byte, the target unchanged, and only the proof
// headers. Real TLS and real HTTP listeners; the backend is a stand-in that records what reaches it.

let work;
let tls;
before(() => {
  work = mkdtempSync(join(tmpdir(), 'native-gateway-'));
  const made = createLocalCertificate(join(work, 'tls'), 30);
  tls = { key: readFileSync(made.key), cert: readFileSync(made.cert) };
});
after(() => rmSync(work, { recursive: true, force: true }));

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = (server) => new Promise((resolve) => {
  server.closeAllConnections?.();
  server.close(() => resolve());
});

async function start(answer) {
  const seen = [];
  const backend = http.createServer((request, response) => {
    const parts = [];
    request.on('data', (chunk) => parts.push(chunk));
    request.on('end', () => {
      seen.push({ method: request.method, url: request.url, headers: request.headers, body: Buffer.concat(parts) });
      answer(request, response);
    });
  });
  const backendPort = await listen(backend);
  const gateway = createNativeGateway({ backendUrl: `http://127.0.0.1:${backendPort}`, ...tls });
  const port = await listen(gateway);
  return { seen, port, stop: async () => { await close(gateway); await close(backend); } };
}

function call(port, method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const framed = body === undefined ? headers : { 'content-length': String(Buffer.byteLength(body)), ...headers };
    const request = https.request({ host: '127.0.0.1', port, method, path, headers: framed, ca: tls.cert, servername: 'localhost' }, (response) => {
      const parts = [];
      response.on('data', (chunk) => parts.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(parts) }));
    });
    request.on('error', reject);
    request.end(body);
  });
}

const ok = (_request, response) => {
  response.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'a=b', server: 'secret-banner', 'x-device-binding-id': 'b-1', 'x-device-binding-generation': '1', 'x-other': 'no' });
  response.end('{"data":{}}');
};

describe('native gateway', () => {
  it('forwards exactly the allowlisted method + path pairs', async () => {
    const gateway = await start(ok);
    try {
      for (const route of NATIVE_ROUTES) {
        const [method, path] = route.split(' ');
        const result = await call(gateway.port, method, path, { body: method === 'GET' ? undefined : '{}', headers: method === 'GET' ? {} : { 'content-type': 'application/json' } });
        assert.equal(result.status, 200, route);
      }
      assert.equal(gateway.seen.length, NATIVE_ROUTES.size);
    } finally {
      await gateway.stop();
    }
  });

  it('answers 404 and forwards nothing for any other route, method, prefix, trailing slash or query string', async () => {
    const gateway = await start(ok);
    try {
      const refused = [
        ['GET', '/v1/admin/me'],
        ['POST', '/v1/auth/login'],
        ['GET', '/v1/client-auth/login'],
        ['DELETE', '/v1/customer/me/profile'],
        ['GET', '/v1/client-auth/me/'],
        ['GET', '/v1/client-auth/me?x=1'],
        ['POST', '/v1/client-auth/device/challenges/extra'],
        ['POST', '/v1/client-auth/context'],
        ['GET', '/v1/driver/me'],
        ['GET', '/'],
      ];
      for (const [method, path] of refused) {
        const result = await call(gateway.port, method, path, { body: method === 'GET' ? undefined : '{}' });
        assert.equal(result.status, 404, `${method} ${path}`);
      }
      assert.equal(gateway.seen.length, 0);
    } finally {
      await gateway.stop();
    }
  });

  it('keeps the body byte for byte and the target unchanged, and passes only the proof headers', async () => {
    const gateway = await start(ok);
    try {
      const body = Buffer.from('{ "phone" : "0901234567",\n  "password":"x" }', 'utf8');
      const sent = {
        authorization: 'Bearer abc',
        'idempotency-key': '11111111-1111-4111-8111-111111111111',
        'content-type': 'application/json',
        'x-device-registration': 'reg',
        'x-device-key-id': 'key',
        'x-device-time': '1760000000',
        'x-device-nonce': 'nonce',
        'x-device-signature': 'sig',
        cookie: 'session=1',
        'x-forwarded-for': '1.2.3.4',
        'x-evil': 'yes',
      };
      const result = await call(gateway.port, 'POST', '/v1/client-auth/login', { headers: sent, body });
      assert.equal(result.status, 200);
      const [seen] = gateway.seen;
      assert.equal(seen.url, '/v1/client-auth/login');
      assert.deepEqual(seen.body, body);
      for (const name of FORWARDED_REQUEST_HEADERS) {
        assert.equal(seen.headers[name], sent[name], name);
      }
      assert.equal(seen.headers.cookie, undefined);
      assert.equal(seen.headers['x-forwarded-for'], undefined);
      assert.equal(seen.headers['x-evil'], undefined);
      // The answer: only the allowlisted headers come back (the binding headers yes, a cookie or a banner no).
      assert.equal(result.headers['x-device-binding-id'], 'b-1');
      assert.equal(result.headers['x-device-binding-generation'], '1');
      assert.equal(result.headers['set-cookie'], undefined);
      assert.equal(result.headers.server, undefined);
      assert.equal(result.headers['x-other'], undefined);
      assert.equal(result.headers['cache-control'], 'no-store');
    } finally {
      await gateway.stop();
    }
  });

  it('refuses an oversized body and a silent or dead backend without leaking the cause', async () => {
    const gateway = await start(ok);
    try {
      const big = await call(gateway.port, 'POST', '/v1/client-auth/register', { headers: { 'content-type': 'application/json' }, body: Buffer.alloc(70_000, 97) });
      assert.equal(big.status, 413);
    } finally {
      await gateway.stop();
    }
    const dead = createNativeGateway({ backendUrl: 'http://127.0.0.1:9', ...tls });
    const port = await listen(dead);
    try {
      const result = await call(port, 'GET', '/v1/health/live');
      assert.equal(result.status, 504);
      assert.doesNotMatch(result.body.toString(), /ECONNREFUSED|127\.0\.0\.1/);
    } finally {
      await close(dead);
    }
  });

  it('refuses a backend that is not a loopback http URL', () => {
    assert.throws(() => createNativeGateway({ backendUrl: 'http://10.0.0.5:3000', ...tls }), /loopback/);
    assert.throws(() => createNativeGateway({ backendUrl: 'https://127.0.0.1:3000', ...tls }), /loopback/);
  });
});
