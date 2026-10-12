import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ChildProcess, execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import https from 'node:https';
import { AddressInfo, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configWithDatabaseUrl, loadIntegrationConfig, minimalChildEnv, REPO_ROOT, RunningApp, startApp } from './support/test-helpers';

// M00.05 — the local HTTPS front of 11Food (scripts/food-web-dev.mjs, the very script the launcher runs) against the REAL
// backend: the real Nest application on a real HTTP listener with the real PostgreSQL of the integration job. Nothing about the
// backend is faked: these are the answers /v1/health/live and /v1/health/ready really give, carried through the front over
// real TLS (a real certificate; the client verifies the chain against it, nothing is switched off). Controlled failures
// (silent or malformed backend, bad certificates, foreign ports) are in tests/client-shell/runtime.test.mjs.

const FRONT_START_MS = 15_000;
let work: string;
let dist: string;
let certFile: string;
let keyFile: string;

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

interface Front {
  port: number;
  child: ChildProcess;
  identity: { app_id: string; source_sha: string; build_fingerprint: string };
}

async function startFront(backendUrl: string): Promise<Front> {
  const port = await freePort();
  const child = spawn(process.execPath, [join(REPO_ROOT, 'scripts', 'food-web-dev.mjs')], {
    cwd: REPO_ROOT,
    env: minimalChildEnv({ CLIENT_WEB_PORT: String(port), CLIENT_WEB_DIST: dist, CLIENT_WEB_BACKEND: backendUrl, CLIENT_WEB_TLS_CERT: certFile, CLIENT_WEB_TLS_KEY: keyFile }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  const line = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`the front did not start in time: ${stderr}`)), FRONT_START_MS);
    child.stdout?.once('data', (chunk: Buffer) => {
      clearTimeout(timer);
      resolve(chunk.toString().split('\n')[0]);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`the front exited with ${String(code)}: ${stderr}`));
    });
  });
  return { port, child, identity: JSON.parse(line) as Front['identity'] };
}

async function stopFront(front: Front): Promise<void> {
  const ended = new Promise<void>((resolve) => front.child.once('exit', () => resolve()));
  front.child.kill('SIGTERM');
  await ended;
}

/** HTTPS GET that verifies the chain against the test certificate. */
function get(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = https.request(
      { host: '127.0.0.1', port, servername: 'localhost', ca: readFileSync(certFile), path, method: 'GET', headers: { host: `localhost:${String(port)}` } },
      (response) => {
        let body = '';
        response.on('data', (chunk: Buffer) => (body += chunk.toString()));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
      },
    );
    request.on('error', reject);
    request.end();
  });
}

function probe(port: number, identity: Front['identity']): { ok: boolean; code: string } {
  const run = spawnSync(
    process.execPath,
    [join(REPO_ROOT, 'scripts', 'client-web-check.mjs'), 'probe', '--app', 'food-web', '--port', String(port), '--cert', certFile, '--expect-sha', identity.source_sha, '--expect-fingerprint', identity.build_fingerprint],
    { cwd: REPO_ROOT, encoding: 'utf8', env: minimalChildEnv({}), timeout: 30_000 },
  );
  return JSON.parse(run.stdout.trim()) as { ok: boolean; code: string };
}

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), '11ship-client-runtime-'));
  dist = join(work, 'food-web');
  execFileSync(process.execPath, [join(REPO_ROOT, 'scripts', 'client-web-build.mjs'), 'food-web', '--out', dist], { cwd: REPO_ROOT, stdio: 'pipe', timeout: 120_000 });
  execFileSync(process.execPath, [join(REPO_ROOT, 'scripts', 'admin-web-cert.mjs'), join(work, 'tls'), '30'], { cwd: REPO_ROOT, stdio: 'pipe' });
  certFile = join(work, 'tls', 'cert.pem');
  keyFile = join(work, 'tls', 'key.pem');
}, 150_000);

afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

describe('M00.05 — HTTPS front against the real backend, PostgreSQL available', () => {
  let running: RunningApp;
  let front: Front;

  beforeAll(async () => {
    running = await startApp(loadIntegrationConfig());
    front = await startFront(running.baseUrl);
  }, 60_000);

  afterAll(async () => {
    await stopFront(front);
    await running.app.close();
  });

  it('reports its identity: the app and the exact build it serves', async () => {
    const answer = await get(front.port, '/__11ship/runtime');
    expect(answer.status).toBe(200);
    const { data } = JSON.parse(answer.body) as { data: Record<string, string> };
    expect(Object.keys(data).sort()).toEqual(['app_id', 'build_fingerprint', 'design_version', 'environment', 'source_sha']);
    expect(data.app_id).toBe('FOOD_WEB');
    const manifest = JSON.parse(readFileSync(join(dist, 'build-manifest.json'), 'utf8')) as { source_sha: string; build_fingerprint: string };
    expect(data.source_sha).toBe(manifest.source_sha);
    expect(data.build_fingerprint).toBe(manifest.build_fingerprint);
  });

  it('carries live and ready of the real backend: 200 with the agreed bodies', async () => {
    const live = await get(front.port, '/v1/health/live');
    const ready = await get(front.port, '/v1/health/ready');
    expect([live.status, JSON.parse(live.body)]).toEqual([200, { data: { status: 'ok' } }]);
    expect([ready.status, JSON.parse(ready.body)]).toEqual([200, { data: { status: 'ready' } }]);
  });

  it('opens nothing else of the real backend: other health spellings and business routes do not reach it', async () => {
    for (const path of ['/v1/health', '/v1/health/live?x=1', '/v1/health/live/', '/v1/admin-auth/state', '/v1/admin/accounts']) {
      const answer = await get(front.port, path);
      expect(answer.status).toBe(404);
      expect(answer.body).not.toContain('"data"');
    }
  });

  it('the launcher probe (pinned certificate) accepts this front and checks health through it', () => {
    expect(probe(front.port, front.identity)).toMatchObject({ ok: true, code: 'OK' });
  });
});

describe('M00.05 — HTTPS front against the real backend, PostgreSQL unreachable', () => {
  const SECRET = 'SECRET_MARKER_M0005_4b7d';
  let running: RunningApp;
  let front: Front;

  beforeAll(async () => {
    // Port 1 is closed, so database connections are refused; the HTTP server still starts (liveness never touches the database).
    running = await startApp(configWithDatabaseUrl(loadIntegrationConfig(), `postgres://ship11_test:${SECRET}@127.0.0.1:1/ship11_test`));
    front = await startFront(running.baseUrl);
  }, 60_000);

  afterAll(async () => {
    await stopFront(front);
    await running.app.close();
  });

  it('live is 200 and ready is 503 through the front, and nothing of the connection reaches the browser', async () => {
    const live = await get(front.port, '/v1/health/live');
    const ready = await get(front.port, '/v1/health/ready');
    expect(live.status).toBe(200);
    expect(ready.status).toBe(503);
    for (const text of [live.body, ready.body]) {
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain('postgres://');
      expect(text).not.toContain('ship11_test');
    }
  });

  it('the launcher probe reports the backend as not ready, never as success', () => {
    expect(probe(front.port, front.identity)).toMatchObject({ ok: false, code: 'HEALTH_NOT_READY' });
  });
});

describe('M00.05 — HTTPS front against the real backend, backend stopped', () => {
  it('a backend that stopped is a 502 through the front, never a success', async () => {
    const running = await startApp(loadIntegrationConfig());
    const front = await startFront(running.baseUrl);
    try {
      expect((await get(front.port, '/v1/health/ready')).status).toBe(200);
      await running.app.close();
      for (const path of ['/v1/health/live', '/v1/health/ready']) {
        const answer = await get(front.port, path);
        expect(answer.status).toBe(502);
        expect(answer.body).not.toContain('ECONNREFUSED');
      }
      expect(probe(front.port, front.identity).ok).toBe(false);
    } finally {
      await stopFront(front);
    }
  }, 60_000);
});
