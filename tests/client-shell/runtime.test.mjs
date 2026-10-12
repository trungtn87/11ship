import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createLocalCertificate } from '../../scripts/admin-web-cert.mjs';
import { buildClientWeb } from '../../scripts/client-web-build.mjs';
import { createClientWebServer, readBuildIdentity, RuntimeStartError } from '../../scripts/client-web-dev.mjs';
import { probeRuntime } from '../../scripts/client-web-check.mjs';
import { artifactFingerprint } from '../../scripts/lib/artifact-fingerprint.mjs';
import { inspectTlsFiles } from '../../scripts/lib/local-tls.mjs';

// M00.05: the local HTTPS runtime of 11Food (8444) and 11Ship (8445). Everything here is real: real TLS with a real
// certificate (made by openssl), real HTTP listeners, real child processes for the entry scripts. The BACKEND is a small
// controlled HTTP server, because only a stand-in can answer wrongly, slowly or not at all on demand; the real backend with
// PostgreSQL is exercised by tests/integration/client-runtime.int.spec.ts (CI).

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const decoder = (buffer) => buffer.toString('utf8');
let work;
let tls; // { cert, key, pem }
let builds; // { 'food-web': dist, 'ship-web': dist }

before(() => {
  work = mkdtempSync(join(tmpdir(), 'client-runtime-'));
  const dir = join(work, 'tls');
  const made = createLocalCertificate(dir, 30);
  tls = { ...made, pem: readFileSync(made.cert) };
  builds = {};
  for (const app of ['food-web', 'ship-web']) {
    builds[app] = buildClientWeb(app, { outDir: join(work, app), quiet: true }).dist;
  }
});
after(() => rmSync(work, { recursive: true, force: true }));

// ---------------------------------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------------------------------
const listen = (server, port = 0) => new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server.address().port)));
const close = (server) => new Promise((resolve) => {
  server.closeAllConnections?.();
  server.close(() => resolve());
});

/** A stand-in backend. `mode` decides how /v1/health/* answer. Every request that reaches it is recorded. */
async function startBackend(mode = 'ok') {
  const seen = [];
  const sockets = new Set();
  const server = http.createServer((request, response) => {
    seen.push({ method: request.method, url: request.url, headers: request.headers });
    const json = (status, body, type = 'application/json; charset=utf-8') => {
      response.writeHead(status, { 'content-type': type });
      response.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    const live = request.url === '/v1/health/live';
    const ok = { data: { status: live ? 'ok' : 'ready' } };
    switch (mode) {
      case 'ok':
        return json(200, ok);
      case 'unready':
        return live ? json(200, ok) : json(503, { error: { code: 'SERVICE_UNAVAILABLE', message: 'DB_SECRET_MARKER postgres://user:pw@db/x', request_id: 'r', details: {} } });
      case 'notjson':
        return json(200, 'plain text SECRET_MARKER_BODY', 'text/plain');
      case 'badjson':
        return json(200, '{"data":{"status":"ok"', 'application/json');
      case 'htmltype':
        return json(200, ok, 'text/html');
      case 'wrongstatus':
        return json(200, { data: { status: 'degraded' } });
      case 'extrakeys':
        return json(200, { data: { status: live ? 'ok' : 'ready' }, secret: 'SECRET_MARKER_EXTRA' });
      case 'live503':
        return json(503, ok);
      case 'ready500':
        return live ? json(200, ok) : json(500, { error: { code: 'INTERNAL', message: 'SECRET_MARKER_500' } });
      case 'huge':
        return json(200, JSON.stringify({ data: { status: 'ok', pad: 'x'.repeat(20_000) } }));
      case 'hang':
        sockets.add(request.socket);
        return undefined; // never answers
      default:
        throw new Error(`unknown backend mode ${mode}`);
    }
  });
  const port = await listen(server);
  return { port, seen, url: `http://127.0.0.1:${String(port)}`, stop: () => close(server) };
}

/** The front, in this process, on a free port. */
async function startFront(app, backendUrl, options = {}) {
  const server = createClientWebServer({ app, distDir: options.distDir ?? builds[app], backendUrl, key: readFileSync(tls.key), cert: tls.pem, upstreamTimeoutMs: options.upstreamTimeoutMs });
  const port = await listen(server);
  return { port, server, identity: server.identity, stop: () => close(server) };
}

/** HTTPS request that VERIFIES the chain against the test certificate (no verification switched off). */
function call(port, path, { method = 'GET', headers = {}, body, hostHeader, ca = tls.pem } = {}) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      { host: '127.0.0.1', port, servername: 'localhost', ca, method, path, headers: { host: hostHeader ?? `localhost:${String(port)}`, ...headers } },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: decoder(Buffer.concat(chunks)) }));
      },
    );
    request.on('error', reject);
    request.end(body);
  });
}
const json = (answer) => JSON.parse(answer.body);

function freePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** The real entry script as a child process (what the launcher runs). */
function runEntry(script, env, { wait = 'listening' } = {}) {
  const child = spawn(process.execPath, [join(root, 'scripts', script)], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => (stdout += chunk));
  child.stderr.on('data', (chunk) => (stderr += chunk));
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  const ready = new Promise((resolve) => {
    const timer = setInterval(() => {
      if (stdout.includes('\n')) {
        clearInterval(timer);
        resolve(JSON.parse(stdout.split('\n')[0]));
      }
    }, 20);
    exited.then(() => {
      clearInterval(timer);
      resolve(undefined);
    });
  });
  return { child, exited, ready: wait === 'listening' ? ready : undefined, output: () => ({ stdout, stderr }) };
}

const frontEnv = (app, extra = {}) => ({
  CLIENT_WEB_PORT: '0',
  CLIENT_WEB_DIST: builds[app],
  CLIENT_WEB_TLS_CERT: tls.cert,
  CLIENT_WEB_TLS_KEY: tls.key,
  CLIENT_WEB_BACKEND: 'http://127.0.0.1:9',
  ...extra,
});

/** Certificates for the failure cases. */
function openssl(args, cwd) {
  execFileSync('openssl', args, { cwd, stdio: 'pipe' });
}
function selfSigned(dir, { san = 'DNS:localhost,IP:127.0.0.1', start, end } = {}) {
  mkdirSync(dir, { recursive: true });
  const key = join(dir, 'key.pem');
  const cert = join(dir, 'cert.pem');
  if (start === undefined) {
    openssl(['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', key, '-out', cert, '-days', '30', '-subj', '/CN=localhost', '-addext', `subjectAltName=${san}`, '-addext', 'extendedKeyUsage=serverAuth'], dir);
    return { cert, key };
  }
  // A certificate with chosen validity dates: `openssl ca -selfsign` accepts -startdate/-enddate.
  writeFileSync(join(dir, 'index.txt'), '');
  writeFileSync(join(dir, 'serial'), '01\n');
  writeFileSync(
    join(dir, 'ca.cnf'),
    `[ca]\ndefault_ca=d\n[d]\ndir=.\ndatabase=index.txt\nnew_certs_dir=.\nserial=serial\ndefault_md=sha256\npolicy=p\nx509_extensions=v3\ncopy_extensions=none\nunique_subject=no\n[p]\ncommonName=supplied\n[v3]\nsubjectAltName=${san}\nextendedKeyUsage=serverAuth\n`,
  );
  openssl(['req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', key, '-out', join(dir, 'req.csr'), '-subj', '/CN=localhost'], dir);
  openssl(['ca', '-config', join(dir, 'ca.cnf'), '-selfsign', '-keyfile', key, '-in', join(dir, 'req.csr'), '-out', cert, '-startdate', start, '-enddate', end, '-batch', '-notext'], dir);
  return { cert, key };
}

// ---------------------------------------------------------------------------------------------------------------------
describe('artifact: one fingerprint for the build and for the launcher', () => {
  it('matches the algorithm the launcher uses (pinned value; the PowerShell suite pins the same one)', () => {
    const dir = join(work, 'fp');
    mkdirSync(join(dir, 'sub'), { recursive: true });
    writeFileSync(join(dir, 'a.txt'), 'a');
    writeFileSync(join(dir, 'sub', 'b.txt'), 'b');
    writeFileSync(join(dir, 'build-manifest.json'), '{"ignored":true}');
    const line = (name, text) => `${name}|${createHash('sha256').update(text).digest('hex')}`;
    const expected = createHash('sha256').update([line('a.txt', 'a'), line('sub/b.txt', 'b')].join('\n'), 'utf8').digest('hex');
    assert.equal(artifactFingerprint(dir), expected);
    assert.equal(expected, '67307b9269c97d70e6591b918f30a9b5dc19eb5d1866b508e289c14cc2c097aa');
    // Names, content, added files all change it; the manifest does not.
    writeFileSync(join(dir, 'build-manifest.json'), '{"ignored":false}');
    assert.equal(artifactFingerprint(dir), expected);
    writeFileSync(join(dir, 'sub', 'b.txt'), 'c');
    assert.notEqual(artifactFingerprint(dir), expected);
    assert.equal(artifactFingerprint(mkdtempSync(join(work, 'empty-'))), null, 'a folder without files has no fingerprint');
  });

  it('a real build carries the identity the launcher and /__11ship/runtime need, and describes exactly its own folder', () => {
    for (const app of ['food-web', 'ship-web']) {
      const manifest = JSON.parse(readFileSync(join(builds[app], 'build-manifest.json'), 'utf8'));
      assert.equal(manifest.app_id, app);
      assert.equal(manifest.mode, 'live');
      assert.match(manifest.source_sha, /^[0-9a-f]{40}$/);
      assert.match(manifest.build_fingerprint, /^[0-9a-f]{64}$/);
      assert.equal(manifest.fingerprint, manifest.build_fingerprint, 'the diagnostics screen (M00.04) still reads `fingerprint`');
      assert.equal(manifest.build_fingerprint, artifactFingerprint(builds[app]));
      assert.match(manifest.built_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      assert.equal(manifest.design_version, '2.0.1');
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('/__11ship/runtime: which build is running', () => {
  for (const [app, runtimeId] of [['food-web', 'FOOD_WEB'], ['ship-web', 'SHIP_WEB']]) {
    it(`${app}: read-only identity of the served build, nothing else`, async () => {
      const backend = await startBackend();
      const front = await startFront(app, backend.url);
      try {
        const manifest = JSON.parse(readFileSync(join(builds[app], 'build-manifest.json'), 'utf8'));
        const answer = await call(front.port, '/__11ship/runtime');
        assert.equal(answer.status, 200);
        assert.match(answer.headers['content-type'], /^application\/json/);
        assert.equal(answer.headers['cache-control'], 'no-store');
        assert.deepEqual(json(answer), {
          data: { app_id: runtimeId, source_sha: manifest.source_sha, build_fingerprint: manifest.build_fingerprint, design_version: '2.0.1', environment: 'development' },
        });
        assert.equal(backend.seen.length, 0, 'identity is answered by the front itself');
      } finally {
        await front.stop();
        await backend.stop();
      }
    });
  }

  it('is exact and read-only: GET only, no query, no trailing slash, no sibling routes', async () => {
    const backend = await startBackend();
    const front = await startFront('food-web', backend.url);
    try {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
        const answer = await call(front.port, '/__11ship/runtime', { method });
        assert.equal(answer.status, 405, method);
        assert.equal(answer.headers.allow, 'GET');
      }
      for (const path of ['/__11ship/runtime?x=1', '/__11ship/runtime/', '/__11ship/runtime/x', '/__11ship/', '/__11ship', '/__11ship/state', '/__11ship/runtime%2f']) {
        assert.equal((await call(front.port, path)).status, 404, path);
      }
    } finally {
      await front.stop();
      await backend.stop();
    }
  });

  it('reports no secret even when the process has some in its environment (real entry script)', async () => {
    const marker = 'SECRET_MARKER_ENV_91f3';
    const run = runEntry('food-web-dev.mjs', frontEnv('food-web', { DATABASE_URL: `postgres://user:${marker}@db/x`, DEV_DB_PASSWORD: marker, ADMIN_AUTH_SECRET: marker }));
    try {
      const listening = await run.ready;
      assert.equal(listening.event, 'listening');
      const answer = await call(listening.port, '/__11ship/runtime');
      for (const text of [answer.body, JSON.stringify(listening), run.output().stdout, run.output().stderr]) {
        assert.ok(!text.includes(marker) && !text.includes('postgres://'));
      }
    } finally {
      run.child.kill();
      await run.exited;
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('the build that is served is the build that is described', () => {
  const copyBuild = (app, name) => {
    const target = join(work, name);
    cpSync(builds[app], target, { recursive: true });
    return target;
  };
  it('refuses a folder without manifest, with a damaged manifest, of the wrong app, a design build, an unknown commit, or changed files', () => {
    const expectCode = (distDir, app, code) => assert.throws(() => readBuildIdentity(distDir, app), (error) => error instanceof RuntimeStartError && error.code === code, code);
    const missing = copyBuild('food-web', 'b-missing');
    rmSync(join(missing, 'build-manifest.json'));
    expectCode(missing, 'food-web', 'ARTIFACT_MISSING');

    const damaged = copyBuild('food-web', 'b-damaged');
    writeFileSync(join(damaged, 'build-manifest.json'), '{not json');
    expectCode(damaged, 'food-web', 'ARTIFACT_INVALID');

    expectCode(builds['food-web'], 'ship-web', 'ARTIFACT_INVALID'); // Food's build asked to run as Ship

    const rewrite = (name, patch) => {
      const dir = copyBuild('food-web', name);
      const manifest = JSON.parse(readFileSync(join(dir, 'build-manifest.json'), 'utf8'));
      writeFileSync(join(dir, 'build-manifest.json'), JSON.stringify({ ...manifest, ...patch }));
      return dir;
    };
    expectCode(rewrite('b-design', { mode: 'design' }), 'food-web', 'ARTIFACT_INVALID');
    expectCode(rewrite('b-unknown', { source_sha: 'unknown' }), 'food-web', 'ARTIFACT_INVALID');
    expectCode(rewrite('b-shortfp', { build_fingerprint: 'abc' }), 'food-web', 'ARTIFACT_INVALID');

    const changed = copyBuild('food-web', 'b-changed');
    writeFileSync(join(changed, 'tokens.css'), `${readFileSync(join(changed, 'tokens.css'), 'utf8')}\n/* edited after the build */\n`);
    expectCode(changed, 'food-web', 'ARTIFACT_CHANGED');
    assert.throws(() => createClientWebServer({ app: 'food-web', distDir: changed, backendUrl: 'http://127.0.0.1:3000', key: readFileSync(tls.key), cert: tls.pem }), /no longer match/);
  });

  it('only a loopback http backend is accepted', () => {
    for (const url of ['http://192.168.1.5:3000', 'https://127.0.0.1:3000', 'http://example.com:3000']) {
      assert.throws(() => createClientWebServer({ app: 'food-web', distDir: builds['food-web'], backendUrl: url, key: readFileSync(tls.key), cert: tls.pem }), (error) => error.code === 'BACKEND_NOT_LOOPBACK', url);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('static build', () => {
  it('serves the page, the app routes and the build files; refuses everything outside the build', async () => {
    const backend = await startBackend();
    const front = await startFront('food-web', backend.url);
    try {
      const page = await call(front.port, '/');
      assert.equal(page.status, 200);
      assert.match(page.headers['content-type'], /^text\/html/);
      assert.match(page.body, /<title>11Food<\/title>/);
      assert.match(page.headers['content-security-policy'], /connect-src 'self'/);
      assert.equal(page.headers['x-content-type-options'], 'nosniff');
      assert.equal(page.headers['cache-control'], 'no-store');
      for (const route of ['/diagnostics', '/account', '/orders/', '/anything/else']) {
        const answer = await call(front.port, route);
        assert.equal(answer.status, 200, route);
        assert.match(answer.body, /<title>11Food<\/title>/);
      }
      assert.equal((await call(front.port, '/build-manifest.json')).status, 200);
      assert.equal((await call(front.port, '/components.css')).status, 200);
      assert.equal((await call(front.port, '/design.html')).status, 404);
      for (const path of ['/nope.js', '/js/missing.js', '/..%2f..%2fpackage.json', '/%2e%2e/%2e%2e/package.json', '/js/%2e%2e/%2e%2e/package.json', '/%00', '/a%5cb.js', '/%']) {
        assert.equal((await call(front.port, path)).status, 404, path);
      }
      for (const method of ['POST', 'PUT', 'DELETE']) {
        assert.equal((await call(front.port, '/', { method })).status, 405, method);
      }
      assert.equal(backend.seen.length, 0, 'static requests never reach the backend');
      const ship = await startFront('ship-web', backend.url);
      try {
        assert.match((await call(ship.port, '/')).body, /<title>11Ship<\/title>/);
      } finally {
        await ship.stop();
      }
    } finally {
      await front.stop();
      await backend.stop();
    }
  });

  it('refuses a request whose Host is not this machine on this port (DNS rebinding)', async () => {
    const backend = await startBackend();
    const front = await startFront('food-web', backend.url);
    try {
      for (const host of ['evil.example', `evil.example:${String(front.port)}`, 'localhost', `localhost:${String(front.port + 1)}`, `127.0.0.1.evil.example:${String(front.port)}`]) {
        for (const path of ['/', '/__11ship/runtime', '/v1/health/live']) {
          assert.equal((await call(front.port, path, { hostHeader: host })).status, 421, `${host} ${path}`);
        }
      }
      for (const host of [`localhost:${String(front.port)}`, `127.0.0.1:${String(front.port)}`]) {
        assert.equal((await call(front.port, '/__11ship/runtime', { hostHeader: host })).status, 200, host);
      }
      assert.equal(backend.seen.length, 0);
    } finally {
      await front.stop();
      await backend.stop();
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('health proxy: exactly two GET routes, nothing else', () => {
  it('forwards live and ready with the agreed bodies, and sends the backend nothing the browser supplied', async () => {
    const backend = await startBackend();
    const front = await startFront('food-web', backend.url);
    try {
      const live = await call(front.port, '/v1/health/live', { headers: { cookie: '__Host-11admin=SESSION_MARKER', authorization: 'Bearer TOKEN_MARKER', origin: 'https://localhost:8443', 'x-forwarded-for': '10.9.9.9', 'x-csrf-token': 'CSRF_MARKER', 'x-custom': 'CUSTOM_MARKER' } });
      assert.equal(live.status, 200);
      assert.deepEqual(json(live), { data: { status: 'ok' } });
      assert.equal(live.headers['cache-control'], 'no-store');
      const ready = await call(front.port, '/v1/health/ready');
      assert.equal(ready.status, 200);
      assert.deepEqual(json(ready), { data: { status: 'ready' } });
      assert.deepEqual(backend.seen.map((entry) => [entry.method, entry.url]), [['GET', '/v1/health/live'], ['GET', '/v1/health/ready']]);
      for (const entry of backend.seen) {
        assert.deepEqual(Object.keys(entry.headers).sort(), ['accept', 'connection', 'host']);
        assert.equal(entry.headers.host, `127.0.0.1:${String(backend.port)}`);
      }
    } finally {
      await front.stop();
      await backend.stop();
    }
  });

  it('ready 503 is passed on as 503 with a fixed body (nothing of the backend text)', async () => {
    const backend = await startBackend('unready');
    const front = await startFront('ship-web', backend.url);
    try {
      assert.equal((await call(front.port, '/v1/health/live')).status, 200);
      const ready = await call(front.port, '/v1/health/ready');
      assert.equal(ready.status, 503);
      assert.ok(!ready.body.includes('DB_SECRET_MARKER') && !ready.body.includes('postgres://'));
      assert.equal(json(ready).error.code, 'SERVICE_UNAVAILABLE');
    } finally {
      await front.stop();
      await backend.stop();
    }
  });

  it('no wildcard: every other path, method and spelling stays out of the backend', async () => {
    const backend = await startBackend();
    const front = await startFront('food-web', backend.url);
    try {
      const notProxied = [
        '/v1', '/v1/', '/v1/health', '/v1/health/', '/v1/health/live/', '/v1/health/ready/', '/v1/health/liveness', '/v1/health/live/x',
        '/v1/health/live?x=1', '/v1/health/ready?', '/v1/health/../admin/state', '/v1/health/%6cive', '/v1/health/live%00', '/v1/health//live',
        '/v1/admin-auth/state', '/v1/admin/accounts', '/v1/admin-activation/x', '/v1/auth/login', '/v1/orders', '/v1/anything', '/v1/__11ship/runtime',
        '/V1/HEALTH/LIVE', '/v2/health/live', '//v1/health/live',
      ];
      for (const path of notProxied) {
        const answer = await call(front.port, path).catch((error) => ({ status: `error ${error.code}`, body: '' }));
        assert.ok([404, 200].includes(answer.status), `${path} -> ${String(answer.status)}`);
        if (answer.status === 200) {
          // Only the page itself (a client route of the app) may answer with 200; never backend JSON.
          assert.match(answer.body, /<title>11Food<\/title>/, path);
        }
      }
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']) {
        for (const path of ['/v1/health/live', '/v1/health/ready']) {
          assert.equal((await call(front.port, path, { method, body: method === 'POST' ? '{}' : undefined })).status, 405, `${method} ${path}`);
        }
      }
      assert.equal(backend.seen.length, 0, `the backend saw ${JSON.stringify(backend.seen.map((entry) => entry.url))}`);
    } finally {
      await front.stop();
      await backend.stop();
    }
  });

  it('a backend that is not there, silent, or says something else ends as 502/504 with a fixed body', async () => {
    const dead = await startBackend();
    const deadUrl = dead.url;
    await dead.stop();
    let front = await startFront('food-web', deadUrl);
    try {
      for (const path of ['/v1/health/live', '/v1/health/ready']) {
        const answer = await call(front.port, path);
        assert.equal(answer.status, 502, path);
        assert.equal(json(answer).error.code, 'BAD_GATEWAY');
        assert.ok(!/ECONNREFUSED|connect|127\.0\.0\.1/i.test(answer.body), 'no cause in the body');
      }
    } finally {
      await front.stop();
    }

    for (const [mode, path, status] of [
      ['notjson', '/v1/health/live', 502],
      ['badjson', '/v1/health/live', 502],
      ['htmltype', '/v1/health/live', 502],
      ['wrongstatus', '/v1/health/live', 502],
      ['extrakeys', '/v1/health/live', 502],
      ['extrakeys', '/v1/health/ready', 502],
      ['live503', '/v1/health/live', 502],
      ['ready500', '/v1/health/ready', 502],
      ['huge', '/v1/health/live', 502],
    ]) {
      const backend = await startBackend(mode);
      front = await startFront('food-web', backend.url);
      try {
        const answer = await call(front.port, path);
        assert.equal(answer.status, status, `${mode} ${path}`);
        assert.equal(json(answer).error.code, 'BAD_GATEWAY');
        assert.ok(!answer.body.includes('SECRET_MARKER'), `${mode}: nothing of the backend's text is repeated`);
      } finally {
        await front.stop();
        await backend.stop();
      }
    }
  });

  it('a silent backend is cut off at the deadline (504) and the upstream request is destroyed', async () => {
    const backend = await startBackend('hang');
    const front = await startFront('food-web', backend.url, { upstreamTimeoutMs: 300 });
    try {
      const started = Date.now();
      const answer = await call(front.port, '/v1/health/ready');
      const took = Date.now() - started;
      assert.equal(answer.status, 504);
      assert.equal(json(answer).error.code, 'GATEWAY_TIMEOUT');
      assert.ok(took >= 250 && took < 3000, `took ${String(took)} ms`);
      assert.equal(backend.seen.length, 1);
    } finally {
      await front.stop();
      await backend.stop();
    }
  });

  it('the default deadline stays below the 5 s limit of the app', async () => {
    const { UPSTREAM_TIMEOUT_MS } = await import('../../scripts/client-web-dev.mjs');
    assert.ok(UPSTREAM_TIMEOUT_MS < 5000 && UPSTREAM_TIMEOUT_MS >= 1000);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('the app\'s own connection logic (M00.04) over the real HTTPS front', () => {
  /** fetch() over https that verifies the test certificate. */
  const secureFetch = (port) => (input, init) =>
    new Promise((resolve, reject) => {
      const request = https.request(
        { host: '127.0.0.1', port, servername: 'localhost', ca: tls.pem, path: String(input), method: init?.method ?? 'GET', headers: { host: `localhost:${String(port)}` } },
        (response) => {
          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () => resolve({ status: response.statusCode, text: async () => decoder(Buffer.concat(chunks)) }));
        },
      );
      request.on('error', reject);
      request.end();
    });
  const monitorFor = async (port) => {
    const { HealthMonitor } = await import(pathToFileURL(join(builds['food-web'], 'js', 'client-shared', 'src', 'health.js')).href);
    return new HealthMonitor({ fetch: secureFetch(port) });
  };

  it('ready, backend not ready and backend gone give the states the Owner will see', async () => {
    const ok = await startBackend('ok');
    let front = await startFront('food-web', ok.url);
    try {
      const snapshot = await (await monitorFor(front.port)).check();
      assert.equal(snapshot.phase, 'ready');
      assert.equal(snapshot.live.httpStatus, 200);
      assert.equal(snapshot.ready.httpStatus, 200);
    } finally {
      await front.stop();
      await ok.stop();
    }
    const unready = await startBackend('unready');
    front = await startFront('food-web', unready.url);
    try {
      const snapshot = await (await monitorFor(front.port)).check();
      assert.equal(snapshot.phase, 'backend_not_ready');
      assert.equal(snapshot.ready.reason, 'NOT_READY');
    } finally {
      await front.stop();
      await unready.stop();
    }
    const gone = await startBackend('ok');
    const goneUrl = gone.url;
    await gone.stop();
    front = await startFront('food-web', goneUrl);
    try {
      const snapshot = await (await monitorFor(front.port)).check();
      assert.notEqual(snapshot.phase, 'ready', 'a missing backend is never shown as ready');
      assert.equal(snapshot.phase, 'bad_response', 'the front answers 502, which the app reports as an unexpected answer');
    } finally {
      await front.stop();
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('certificate: missing, expired, wrong names, wrong key', () => {
  it('inspectTlsFiles names each problem with a closed code and never prints key or certificate content', () => {
    const good = inspectTlsFiles({ cert: tls.cert, key: tls.key });
    assert.equal(good.ok, true);
    assert.match(good.fingerprint256, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);

    const code = (options) => inspectTlsFiles(options).code;
    assert.equal(code({ cert: join(work, 'no-such.pem'), key: tls.key }), 'TLS_CERT_MISSING');
    assert.equal(code({ cert: tls.cert, key: join(work, 'no-such-key.pem') }), 'TLS_KEY_MISSING');
    const junk = join(work, 'junk.pem');
    writeFileSync(junk, 'this is not a certificate');
    assert.equal(code({ cert: junk, key: tls.key }), 'TLS_CERT_UNREADABLE');
    assert.equal(code({ cert: tls.cert, key: junk }), 'TLS_KEY_UNREADABLE');
    // Dates: the same valid certificate, judged at other moments.
    assert.equal(code({ cert: tls.cert, key: tls.key, now: new Date(Date.now() + 40 * 86_400_000) }), 'TLS_CERT_EXPIRED');
    assert.equal(code({ cert: tls.cert, key: tls.key, now: new Date(Date.now() - 2 * 86_400_000) }), 'TLS_CERT_NOT_YET_VALID');
    const other = createLocalCertificate(join(work, 'other-tls'), 30);
    assert.equal(code({ cert: tls.cert, key: other.key }), 'TLS_KEY_MISMATCH');
    for (const outcome of [inspectTlsFiles({ cert: junk, key: tls.key }), inspectTlsFiles({ cert: tls.cert, key: other.key })]) {
      assert.ok(!/BEGIN|PRIVATE|MII/.test(JSON.stringify(outcome)));
    }
  });

  it('a real expired certificate, a not-yet-valid one and one for other names are refused by the entry script (exit 3) before any port opens', async () => {
    const cases = [
      ['TLS_CERT_EXPIRED', selfSigned(join(work, 'c-expired'), { start: '20200101000000Z', end: '20200102000000Z' })],
      ['TLS_CERT_NOT_YET_VALID', selfSigned(join(work, 'c-future'), { start: '20990101000000Z', end: '20990102000000Z' })],
      ['TLS_CERT_SAN_MISMATCH', selfSigned(join(work, 'c-san'), { san: 'DNS:example.test' })],
      ['TLS_CERT_SAN_MISMATCH', selfSigned(join(work, 'c-san-ip-only'), { san: 'IP:127.0.0.1' })],
    ];
    for (const [expected, material] of cases) {
      assert.equal(inspectTlsFiles(material).code, expected, expected);
      const run = runEntry('food-web-dev.mjs', frontEnv('food-web', { CLIENT_WEB_TLS_CERT: material.cert, CLIENT_WEB_TLS_KEY: material.key }));
      const ended = await run.exited;
      assert.equal(ended.code, 3, expected);
      const { stdout, stderr } = run.output();
      assert.equal(stdout, '', 'no "listening" line');
      assert.match(stderr, new RegExp(expected));
      assert.match(stderr, /local-https-runtime\.md/);
      assert.ok(!/BEGIN|PRIVATE KEY/.test(stderr));
    }
  });

  it('missing certificate or key: exit 3 with TLS_CERT_MISSING / TLS_KEY_MISSING', async () => {
    for (const [env, expected] of [
      [{ CLIENT_WEB_TLS_CERT: join(work, 'absent-cert.pem') }, 'TLS_CERT_MISSING'],
      [{ CLIENT_WEB_TLS_KEY: join(work, 'absent-key.pem') }, 'TLS_KEY_MISSING'],
    ]) {
      const run = runEntry('ship-web-dev.mjs', frontEnv('ship-web', env));
      assert.equal((await run.exited).code, 3);
      assert.match(run.output().stderr, new RegExp(expected));
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('ports and the real entry scripts', () => {
  it('a port held by someone else is reported (exit 5, PORT_IN_USE) and the other process is left alone', async () => {
    const foreign = http.createServer((request, response) => response.end('{"data":{"status":"ok"}}'));
    const port = await listen(foreign);
    try {
      const run = runEntry('food-web-dev.mjs', frontEnv('food-web', { CLIENT_WEB_PORT: String(port) }));
      assert.equal((await run.exited).code, 5);
      assert.match(run.output().stderr, /PORT_IN_USE/);
      const reply = await new Promise((resolve) => http.get({ host: '127.0.0.1', port, path: '/' }, (response) => {
        let text = '';
        response.on('data', (chunk) => (text += chunk));
        response.on('end', () => resolve(text));
      }));
      assert.equal(reply, '{"data":{"status":"ok"}}', 'the foreign service still answers');
    } finally {
      await close(foreign);
    }
  });

  it('the entry script listens on loopback only, announces itself once, and stops on SIGTERM', async () => {
    const run = runEntry('ship-web-dev.mjs', frontEnv('ship-web'));
    const listening = await run.ready;
    assert.equal(listening.event, 'listening');
    assert.equal(listening.app, 'ship-web');
    assert.equal(listening.app_id, 'SHIP_WEB');
    assert.match(listening.origin, /^https:\/\/localhost:\d+$/);
    // Not reachable on a non-loopback interface: the only listener is 127.0.0.1.
    const addresses = (await import('node:os')).networkInterfaces();
    const external = Object.values(addresses).flat().find((entry) => entry && !entry.internal && entry.family === 'IPv4');
    if (external !== undefined) {
      await assert.rejects(() => new Promise((resolve, reject) => {
        const socket = net.connect({ host: external.address, port: listening.port }, () => resolve(socket.destroy()));
        socket.on('error', reject);
      }));
    }
    run.child.kill('SIGTERM');
    const ended = await run.exited;
    assert.ok(ended.code === 0 || ended.signal === 'SIGTERM');
  });

  it('refuses to start on a build that is not its own app', async () => {
    const run = runEntry('ship-web-dev.mjs', frontEnv('ship-web', { CLIENT_WEB_DIST: builds['food-web'] }));
    assert.equal((await run.exited).code, 4);
    assert.match(run.output().stderr, /ARTIFACT_INVALID/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('readiness probe (what the launcher asks before it opens the browser)', () => {
  const identityOf = (app) => JSON.parse(readFileSync(join(builds[app], 'build-manifest.json'), 'utf8'));

  it('accepts the right app and build with the pinned certificate, and reads health through the front', async () => {
    const backend = await startBackend();
    const front = await startFront('food-web', backend.url);
    try {
      const manifest = identityOf('food-web');
      const outcome = await probeRuntime({ app: 'food-web', port: front.port, certPath: tls.cert, expectSha: manifest.source_sha, expectFingerprint: manifest.build_fingerprint });
      assert.equal(outcome.ok, true, JSON.stringify(outcome));
      assert.equal(outcome.app_id, 'FOOD_WEB');
      assert.deepEqual(backend.seen.map((entry) => entry.url), ['/v1/health/live', '/v1/health/ready']);
    } finally {
      await front.stop();
      await backend.stop();
    }
  });

  it('refuses another app, another build, and a server that is not ours, each with its own code', async () => {
    const backend = await startBackend();
    const food = await startFront('food-web', backend.url);
    try {
      const manifest = identityOf('food-web');
      const probe = (extra) => probeRuntime({ app: 'food-web', port: food.port, certPath: tls.cert, ...extra });
      assert.equal((await probeRuntime({ app: 'ship-web', port: food.port, certPath: tls.cert })).code, 'PROBE_IDENTITY_MISMATCH');
      assert.equal((await probe({ expectSha: 'a'.repeat(40) })).code, 'PROBE_IDENTITY_MISMATCH');
      assert.equal((await probe({ expectSha: manifest.source_sha, expectFingerprint: 'b'.repeat(64) })).code, 'PROBE_IDENTITY_MISMATCH');
      assert.equal((await probeRuntime({ app: 'nope', port: food.port, certPath: tls.cert })).code, 'APP_UNKNOWN');
      assert.equal((await probe({ certPath: join(work, 'absent.pem') })).code, 'TLS_CERT_UNREADABLE');
    } finally {
      await food.stop();
    }

    // A foreign HTTPS service on the port with ANOTHER certificate that answers 200 with a plausible body: never accepted, and it
    // never even receives the request (the certificate is checked before anything is written).
    const stranger = selfSigned(join(work, 'stranger'));
    let strangerRequests = 0;
    const foreign = https.createServer({ key: readFileSync(stranger.key), cert: readFileSync(stranger.cert) }, (request, response) => {
      strangerRequests += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"data":{"app_id":"FOOD_WEB","status":"ok"}}');
    });
    const foreignPort = await listen(foreign);
    try {
      const outcome = await probeRuntime({ app: 'food-web', port: foreignPort, certPath: tls.cert });
      assert.equal(outcome.code, 'TLS_PIN_MISMATCH');
      assert.equal(strangerRequests, 0, 'no HTTP request was sent to the server with the wrong certificate');
      // With the stranger's OWN certificate pinned the TLS check passes - and the answer is still not an identity.
      const manifest = identityOf('food-web');
      const accepted = await probeRuntime({ app: 'food-web', port: foreignPort, certPath: stranger.cert, expectSha: manifest.source_sha, expectFingerprint: manifest.build_fingerprint });
      assert.equal(accepted.ok, false);
      assert.equal(accepted.code, 'PROBE_IDENTITY_MISMATCH');
    } finally {
      await close(foreign);
    }

    // A plain HTTP service, a closed port.
    const plain = http.createServer((request, response) => response.end('hi'));
    const plainPort = await listen(plain);
    try {
      assert.equal((await probeRuntime({ app: 'food-web', port: plainPort, certPath: tls.cert })).code, 'PROBE_UNREACHABLE');
    } finally {
      await close(plain);
    }
    assert.equal((await probeRuntime({ app: 'food-web', port: await freePort(), certPath: tls.cert })).code, 'PROBE_UNREACHABLE');
    await backend.stop();
  });

  it('reports a backend that is not ready, answers wrongly or is silent, through the front', async () => {
    const cases = [['unready', 'HEALTH_NOT_READY'], ['wrongstatus', 'HEALTH_FAILED'], ['notjson', 'HEALTH_FAILED'], ['live503', 'HEALTH_FAILED']];
    for (const [mode, expected] of cases) {
      const backend = await startBackend(mode);
      const front = await startFront('ship-web', backend.url);
      try {
        const outcome = await probeRuntime({ app: 'ship-web', port: front.port, certPath: tls.cert });
        assert.equal(outcome.ok, false, mode);
        assert.equal(outcome.code, expected, mode);
        assert.equal(outcome.app_id, 'SHIP_WEB', 'the identity part was verified before the health part failed');
      } finally {
        await front.stop();
        await backend.stop();
      }
    }
    const silent = await startBackend('hang');
    const front = await startFront('ship-web', silent.url, { upstreamTimeoutMs: 5000 });
    try {
      const outcome = await probeRuntime({ app: 'ship-web', port: front.port, certPath: tls.cert, timeoutMs: 400 });
      assert.equal(outcome.code, 'PROBE_TIMEOUT');
    } finally {
      await front.stop();
      await silent.stop();
    }
    // --no-health: identity only, even when the backend is down.
    const dead = await startBackend();
    const deadUrl = dead.url;
    await dead.stop();
    const alone = await startFront('ship-web', deadUrl);
    try {
      assert.equal((await probeRuntime({ app: 'ship-web', port: alone.port, certPath: tls.cert, health: false })).ok, true);
      assert.equal((await probeRuntime({ app: 'ship-web', port: alone.port, certPath: tls.cert })).ok, false);
    } finally {
      await alone.stop();
    }
  });

  it('the command line prints one JSON line and exits 0 / 1', () => {
    const script = join(root, 'scripts', 'client-web-check.mjs');
    const run = (args) => {
      try {
        return { code: 0, out: execFileSync(process.execPath, [script, ...args], { stdio: 'pipe' }).toString() };
      } catch (error) {
        return { code: error.status, out: String(error.stdout) };
      }
    };
    const okCert = run(['cert', '--cert', tls.cert, '--key', tls.key]);
    assert.equal(okCert.code, 0);
    assert.equal(JSON.parse(okCert.out).ok, true);
    const missing = run(['cert', '--cert', join(work, 'absent.pem'), '--key', tls.key]);
    assert.equal(missing.code, 1);
    assert.equal(JSON.parse(missing.out).code, 'TLS_CERT_MISSING');
    assert.equal(run(['probe', '--app', 'food-web', '--port', '0']).code, 1);
    assert.equal(run(['nonsense']).code, 1);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('repository hygiene: certificates, keys and launcher state stay out of git', () => {
  const ignored = (path) => {
    try {
      execFileSync('git', ['check-ignore', '-q', '--no-index', path], { cwd: root, stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  };
  it('git ignores the certificate folder, any .pem/.key, and the launcher state of the apps', () => {
    for (const path of ['.local/admin-web-tls/key.pem', '.local/admin-web-tls/cert.pem', '.11ship-local/food-web.json', '.11ship-local/ship-web.json', 'localhost.pem', 'localhost-key.pem', 'anywhere/private.key']) {
      assert.ok(ignored(path), `${path} must be git-ignored`);
    }
  });
  it('no certificate or key is tracked', () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: root }).toString().split('\n');
    assert.deepEqual(tracked.filter((file) => /\.(pem|key|crt|p12|pfx)$/i.test(file)), []);
    assert.ok(existsSync(join(root, '.gitignore')));
  });
});
