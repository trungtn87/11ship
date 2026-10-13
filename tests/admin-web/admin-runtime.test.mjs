import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildAdminWeb } from '../../scripts/admin-web-build.mjs';
import { createLocalCertificate } from '../../scripts/admin-web-cert.mjs';
import { probeRuntime } from '../../scripts/client-web-check.mjs';
import { readBuildIdentity } from '../../scripts/client-web-dev.mjs';
import { artifactFingerprint } from '../../scripts/lib/artifact-fingerprint.mjs';

// M00.08: what the launcher needs from the existing Admin front - a build manifest, an identity route, guards for the
// certificate / build / port, and a probe that reaches the administration login through the front. Real TLS, real HTTP
// listeners, the real entry script as a child process. The backend is a stand-in only because a stand-in can answer wrongly on
// demand; the real login flow behind the real front is tests/integration/admin-web-*.int.spec.ts (CI) and the browser run.

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let work;
let tls;
let dist;

before(() => {
  work = mkdtempSync(join(tmpdir(), 'admin-runtime-'));
  tls = createLocalCertificate(join(work, 'tls'), 30);
  dist = buildAdminWeb({ outDir: join(work, 'dist'), quiet: true });
});
after(() => rmSync(work, { recursive: true, force: true }));

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = (server) => new Promise((resolve) => {
  server.closeAllConnections?.();
  server.close(() => resolve());
});

/** Stand-in backend: answers like the real one for /v1/admin-auth/state, by mode. Records everything that reaches it. */
async function startBackend(mode = 'login') {
  const seen = [];
  const server = http.createServer((request, response) => {
    seen.push({ method: request.method, url: request.url, headers: request.headers });
    const send = (status, body, headers = {}) => {
      response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
      response.end(JSON.stringify(body));
    };
    if (request.url === '/v1/admin-auth/state' && mode === 'login') {
      return send(401, { error: { code: 'ADMIN_SESSION_INVALID', message: 'The administration session is not valid', request_id: 'r', details: {} } },
        { 'set-cookie': '__Host-11admin-pre=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Strict' });
    }
    if (request.url === '/v1/admin-auth/state' && mode === 'wrong') {
      return send(200, { data: { state: 'SESSION' } });
    }
    return send(404, { error: { code: 'NOT_FOUND', message: 'Not found', request_id: 'r', details: {} } });
  });
  const port = await listen(server);
  return { port, seen, url: `http://127.0.0.1:${String(port)}`, stop: () => close(server) };
}

function runEntry(env) {
  const child = spawn(process.execPath, [join(root, 'scripts', 'admin-web-dev.mjs')], {
    env: { ...process.env, ADMIN_WEB_PORT: '0', ADMIN_WEB_DIST: dist, ADMIN_WEB_TLS_CERT: tls.cert, ADMIN_WEB_TLS_KEY: tls.key, ADMIN_WEB_BACKEND: 'http://127.0.0.1:9', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => (stdout += chunk));
  child.stderr.on('data', (chunk) => (stderr += chunk));
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  const ready = new Promise((resolve) => {
    const timer = setInterval(() => {
      const line = stdout.split('\n').find((text) => text.startsWith('{'));
      if (line !== undefined) {
        clearInterval(timer);
        resolve(JSON.parse(line));
      }
    }, 20);
    exited.then(() => {
      clearInterval(timer);
      resolve(undefined);
    });
  });
  return { child, exited, ready, output: () => ({ stdout, stderr }), stop: async () => { child.kill('SIGTERM'); await exited; } };
}

function call(port, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const request = https.request({ host: '127.0.0.1', port, servername: 'localhost', ca: readFileSync(tls.cert), method, path, headers: { host: `localhost:${String(port)}`, ...headers } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.on('error', reject);
    request.end(body);
  });
}

describe('Admin build manifest', () => {
  it('describes exactly the folder that is served, as a live build of admin-web', () => {
    const manifest = JSON.parse(readFileSync(join(dist, 'build-manifest.json'), 'utf8'));
    assert.equal(manifest.app_id, 'admin-web');
    assert.equal(manifest.mode, 'live');
    assert.match(manifest.source_sha, /^[0-9a-f]{40}$/);
    assert.equal(manifest.build_fingerprint, artifactFingerprint(dist));
    assert.equal(manifest.fingerprint, manifest.build_fingerprint);
    const identity = readBuildIdentity(dist, 'admin-web');
    assert.deepEqual(identity, { app_id: 'ADMIN_WEB', source_sha: manifest.source_sha, build_fingerprint: manifest.build_fingerprint, design_version: manifest.design_version, environment: 'development' });
  });
  it('is refused by the reader when a file changed after the build', () => {
    const copy = buildAdminWeb({ outDir: join(work, 'changed'), quiet: true });
    writeFileSync(join(copy, 'index.html'), '<!doctype html><title>changed</title>');
    assert.throws(() => readBuildIdentity(copy, 'admin-web'), (error) => error.code === 'ARTIFACT_CHANGED');
  });
});

describe('Admin front as the launcher starts it', () => {
  it('announces itself, reports its identity, and forwards only the administration API with cookies, Origin and CSRF header intact', async () => {
    const backend = await startBackend();
    const run = runEntry({ ADMIN_WEB_BACKEND: backend.url });
    try {
      const listening = await run.ready;
      assert.equal(listening.event, 'listening');
      assert.equal(listening.app, 'admin-web');
      assert.equal(listening.app_id, 'ADMIN_WEB');
      assert.equal(listening.origin, `https://localhost:${String(listening.port)}`);
      const runtime = await call(listening.port, '/__11ship/runtime');
      assert.equal(runtime.status, 200);
      assert.deepEqual(JSON.parse(runtime.body).data, { app_id: 'ADMIN_WEB', source_sha: listening.source_sha, build_fingerprint: listening.build_fingerprint, design_version: listening.design_version, environment: 'development' });
      assert.equal((await call(listening.port, '/__11ship/runtime', { method: 'POST' })).status, 405);

      const reply = await call(listening.port, '/v1/admin-auth/state', {
        headers: { cookie: '__Host-11admin-pre=abc', origin: 'https://localhost:8443', 'x-csrf-token': 'tok', 'x-forwarded-for': '6.6.6.6' },
      });
      assert.equal(reply.status, 401);
      assert.equal(JSON.parse(reply.body).error.code, 'ADMIN_SESSION_INVALID');
      assert.match(String(reply.headers['set-cookie']), /^__Host-11admin-pre=; .*Secure; HttpOnly; SameSite=Strict/);
      const forwarded = backend.seen.at(-1).headers;
      assert.equal(forwarded.cookie, '__Host-11admin-pre=abc');
      assert.equal(forwarded.origin, 'https://localhost:8443');
      assert.equal(forwarded['x-csrf-token'], 'tok');
      assert.equal(forwarded['x-forwarded-for'], undefined, 'a forwarding header from the browser never reaches the backend');

      // Nothing else of the backend is reachable through the front.
      const before = backend.seen.length;
      assert.equal((await call(listening.port, '/build-manifest.json')).status, 404, 'the manifest is for the launcher, not the browser');
      for (const path of ['/v1/health/live', '/v1/health/ready', '/v1/other', '/v1']) {
        const answer = await call(listening.port, path);
        assert.equal(answer.status, 404, path);
      }
      assert.equal(backend.seen.length, before, 'those paths were not forwarded');
    } finally {
      await run.stop();
      await backend.stop();
    }
  });

  it('M01-RESET: exactly the two public account-recovery routes are forwarded, without the admin cookie, CSRF or Authorization', async () => {
    const backend = await startBackend();
    const run = runEntry({ ADMIN_WEB_BACKEND: backend.url });
    try {
      const listening = await run.ready;
      const origin = `https://localhost:${String(listening.port)}`;
      const secrets = { cookie: '__Host-11admin=SESSION', 'x-csrf-token': 'tok', authorization: 'Bearer X', 'x-forwarded-for': '6.6.6.6' };
      backend.seen.length = 0;
      const config = await call(listening.port, '/v1/account-recovery/config', { headers: { ...secrets } });
      assert.equal(config.status, 404, 'the stand-in backend has no such route; what matters is what reached it');
      const body = JSON.stringify({ phone: '0987654321', password: 'Mật khẩu mới 123' });
      const reset = await call(listening.port, '/v1/account-recovery/reset-test', { method: 'POST', body, headers: { ...secrets, origin, 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)), 'idempotency-key': '00000000-0000-4000-8000-000000000001' } });
      assert.equal(reset.status, 404);
      assert.equal(backend.seen.length, 2);
      for (const seen of backend.seen) {
        for (const name of ['cookie', 'x-csrf-token', 'authorization', 'x-forwarded-for']) {
          assert.equal(seen.headers[name], undefined, `${name} is not forwarded to a public recovery route`);
        }
      }
      assert.equal(backend.seen[1].headers['idempotency-key'], '00000000-0000-4000-8000-000000000001');

      // Everything else under the prefix, another method, a query, another site and a missing Origin are refused before the backend.
      backend.seen.length = 0;
      assert.equal((await call(listening.port, '/v1/account-recovery/other')).status, 404);
      assert.equal((await call(listening.port, '/v1/account-recovery/config', { method: 'POST', body: '{}', headers: { origin } })).status, 405);
      assert.equal((await call(listening.port, '/v1/account-recovery/reset-test')).status, 405);
      assert.equal((await call(listening.port, '/v1/account-recovery/config?x=1')).status, 404);
      assert.equal((await call(listening.port, '/v1/account-recovery/reset-test', { method: 'POST', body, headers: { origin: 'https://evil.example', 'content-length': String(Buffer.byteLength(body)) } })).status, 403);
      assert.equal((await call(listening.port, '/v1/account-recovery/reset-test', { method: 'POST', body, headers: { 'content-length': String(Buffer.byteLength(body)) } })).status, 403);
      assert.equal(backend.seen.length, 0, 'none of these reached the backend');
    } finally {
      await run.stop();
      await backend.stop();
    }
  });

  it('the launcher probe accepts the right build and reaches the login through the front; each wrong answer has its own code', async () => {
    const manifest = JSON.parse(readFileSync(join(dist, 'build-manifest.json'), 'utf8'));
    const probe = (port, extra = {}) => probeRuntime({ app: 'admin-web', port, certPath: tls.cert, expectSha: manifest.source_sha, expectFingerprint: manifest.build_fingerprint, ...extra });
    for (const [mode, expectedCode, ok] of [['login', 'OK', true], ['off', 'ADMIN_AUTH_UNAVAILABLE', false], ['wrong', 'HEALTH_FAILED', false]]) {
      const backend = await startBackend(mode);
      const run = runEntry({ ADMIN_WEB_BACKEND: backend.url });
      try {
        const { port } = await run.ready;
        const result = await probe(port);
        assert.equal(result.ok, ok, `${mode}: ${JSON.stringify(result)}`);
        assert.equal(result.code, expectedCode, mode);
        assert.ok(!JSON.stringify(result).includes('abc'), 'no cookie or secret in the result');
      } finally {
        await run.stop();
        await backend.stop();
      }
    }
    // The backend is not there at all: the front answers 503, which is "not ready", not a wrong answer.
    const lonely = runEntry({});
    try {
      const { port } = await lonely.ready;
      assert.equal((await probe(port)).code, 'HEALTH_NOT_READY');
      assert.equal((await probe(port, { expectSha: 'a'.repeat(40) })).code, 'PROBE_IDENTITY_MISMATCH');
      assert.equal((await probe(port, { expectFingerprint: 'b'.repeat(64) })).code, 'PROBE_IDENTITY_MISMATCH');
      assert.equal((await probe(port, { health: false })).ok, true);
    } finally {
      await lonely.stop();
    }
  });
});

describe('Admin front refuses to start on what it cannot prove', () => {
  it('missing certificate -> exit 3; missing or altered build -> exit 4; a port someone else holds -> exit 5 and the other service is left alone', async () => {
    const noCert = runEntry({ ADMIN_WEB_TLS_CERT: join(work, 'absent.pem') });
    assert.equal((await noCert.exited).code, 3);
    assert.match(noCert.output().stderr, /TLS_CERT_MISSING/);

    const empty = runEntry({ ADMIN_WEB_DIST: join(work, 'no-such-dist') });
    assert.equal((await empty.exited).code, 4);
    assert.match(empty.output().stderr, /ARTIFACT_MISSING/);

    const altered = buildAdminWeb({ outDir: join(work, 'altered'), quiet: true });
    writeFileSync(join(altered, 'js', 'extra.js'), '// added after the build');
    const changed = runEntry({ ADMIN_WEB_DIST: altered });
    assert.equal((await changed.exited).code, 4);
    assert.match(changed.output().stderr, /ARTIFACT_CHANGED/);

    const foreign = http.createServer((request, response) => response.end('foreign'));
    const port = await listen(foreign);
    try {
      const held = runEntry({ ADMIN_WEB_PORT: String(port) });
      assert.equal((await held.exited).code, 5);
      assert.match(held.output().stderr, /PORT_IN_USE/);
    } finally {
      await close(foreign);
    }
  });
});
