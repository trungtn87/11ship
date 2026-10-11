import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { join, relative, sep } from 'node:path';
import { installAdminWebHosting, publicAdminAsset } from '../../apps/backend/src/http/admin-web-hosting';
import { runScript } from './support/admin-web-harness';
import { loadIntegrationConfig, REPO_ROOT, RunningApp, startApp } from './support/test-helpers';

// Issue #49 — the Admin web hosted by the real Nest application on ONE origin (built assets of apps/admin-web, the
// real AppModule, the real HTTP pipeline, installed where main.ts installs it: after configureApp, before init).
// No database write happens here; the app boots against the guarded test database like every integration spec.

const DIST = join(REPO_ROOT, 'apps', 'admin-web', 'dist');
const SECURITY_HEADERS = ['content-security-policy', 'x-content-type-options', 'referrer-policy', 'x-frame-options', 'cache-control'] as const;
const UUID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

interface Reply {
  readonly status: number;
  readonly headers: http.IncomingHttpHeaders;
  readonly body: Buffer;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe('issue #49 — Admin web hosted on the API origin', () => {
  let running: RunningApp;
  let port: number;

  /** Raw request: the path is sent exactly as given (no URL normalization), so traversal attempts are real. */
  function send(method: string, path: string, options: { body?: string; headers?: Record<string, string> } = {}): Promise<Reply> {
    return new Promise((resolve, reject) => {
      const request = http.request({ host: '127.0.0.1', port, method, path, headers: options.headers }, (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks) }));
      });
      request.on('error', reject);
      request.end(options.body);
    });
  }

  beforeAll(async () => {
    runScript('admin-web-build.mjs');
    running = await startApp(loadIntegrationConfig(), {
      beforeListen: (app) => installAdminWebHosting(app, { appEnv: 'test', distDir: DIST }),
    });
    port = Number(new URL(running.baseUrl).port);
    expect(port).toBe((running.app.getHttpServer().address() as AddressInfo).port);
  }, 120_000);

  afterAll(async () => {
    await running.app.close();
  });

  it('serves the page, the activation route and every deep link of the frontend with the same page and the security headers', async () => {
    const index = readFileSync(join(DIST, 'index.html'));
    for (const path of ['/', '/index.html', '/activate', '/invitations', '/invitations/new', `/invitations/${UUID}`, `/invitations/${UUID}/reissue`, `/invitations/${UUID}/revoke`, '/activate/']) {
      const reply = await send('GET', path);
      expect([path, reply.status]).toEqual([path, 200]);
      expect(reply.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(reply.body.equals(index)).toBe(true);
      for (const header of SECURITY_HEADERS) {
        expect(reply.headers[header]).toBeDefined();
      }
      expect(reply.headers['cache-control']).toBe('no-store');
      expect(String(reply.headers['content-security-policy'])).toContain("default-src 'none'");
    }
  });

  it('serves exactly the allowlisted built files and nothing else of the build output', async () => {
    const unserved: string[] = [];
    for (const file of walk(DIST)) {
      const url = `/${relative(DIST, file).split(sep).join('/')}`;
      const reply = await send('GET', url);
      if (publicAdminAsset(url) === undefined) {
        expect([url, reply.status]).toEqual([url, 404]);
        unserved.push(url);
      } else {
        expect([url, reply.status]).toEqual([url, 200]);
        expect(reply.body.equals(readFileSync(file))).toBe(true);
      }
    }
    // Everything the browser needs is served; what is left is build residue that must not be public.
    expect(unserved.filter((url) => !/\.(?:map|d\.ts|ts|tsbuildinfo)$/.test(url))).toEqual([]);
    for (const url of ['/styles.css', '/js/dom/main.js']) {
      expect((await send('GET', url)).status).toBe(200);
    }
  });

  it('answers 404 with the headers for anything outside the allowlist, traversal, hidden files, sources and unknown routes', async () => {
    for (const path of [
      '/nope', '/.env', '/.git/config', '/package.json', '/js/dom/main.js.map', '/js/../index.html', '/js/%2e%2e/index.html',
      '/js/..%2f..%2fpackage.json', '/../package.json', '/%2e%2e/%2e%2e/etc/passwd', '/invitations/not-a-uuid', '/invitations/new/extra',
      '/fonts/', '//evil.example/x', '/activate.html', '/src/core/routes.ts', '/apps/admin-web/src/core/routes.ts',
    ]) {
      const reply = await send('GET', path);
      expect([path, reply.status]).toEqual([path, 404]);
      for (const header of SECURITY_HEADERS) {
        expect([path, header, reply.headers[header] !== undefined]).toEqual([path, header, true]);
      }
      expect(reply.body.toString('utf8')).not.toContain('<html');
    }
  });

  it('answers HEAD without a body and refuses every other method on a static path with 405 + Allow, before the body parser', async () => {
    const head = await send('HEAD', '/');
    expect(head.status).toBe(200);
    expect(head.body.length).toBe(0);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      const reply = await send(method, '/activate', { body: method === 'OPTIONS' ? undefined : '{"x":1}', headers: { 'content-type': 'application/json' } });
      expect([method, reply.status]).toEqual([method, 405]);
      expect(reply.headers.allow).toBe('GET, HEAD');
      expect(reply.headers['content-security-policy']).toBeDefined();
    }
    // A malformed JSON body to a static path never reaches the parser: the answer is the hosting's, with its headers.
    const malformed = await send('POST', '/styles.css', { body: '{"broken":', headers: { 'content-type': 'application/json' } });
    expect(malformed.status).toBe(405);
    expect(malformed.headers['content-security-policy']).toBeDefined();
    const oversized = await send('POST', '/', { body: 'x'.repeat(2_000_000), headers: { 'content-type': 'application/json' } });
    expect(oversized.status).toBe(405);
    expect(oversized.headers['content-security-policy']).toBeDefined();
  });

  it('never shadows the API: /v1 answers come from the real API (JSON, its own envelope), for every method', async () => {
    const live = await send('GET', '/v1/health/live');
    expect(live.status).toBe(200);
    expect(live.headers['content-type']).toContain('application/json');
    expect(JSON.parse(live.body.toString('utf8'))).toEqual({ data: { status: 'ok' } });
    expect(live.headers['content-security-policy']).toBeUndefined();

    for (const [method, path] of [['GET', '/v1/activate'], ['GET', '/v1/index.html'], ['POST', '/v1/health/live'], ['GET', '/v1/'], ['GET', '/V1/activate'], ['GET', '/v1']] as const) {
      const reply = await send(method, path);
      expect([method, path, reply.status]).toEqual([method, path, 404]);
      expect(reply.body.toString('utf8')).not.toContain('<html');
      expect(reply.headers['content-security-policy']).toBeUndefined();
    }
  });

  it('is installed in front of the body parser: the parser error of an API call keeps the API envelope, a static call never sees it', async () => {
    const api = await send('POST', '/v1/auth/login', { body: '{"broken":', headers: { 'content-type': 'application/json' } });
    expect(api.status).toBeGreaterThanOrEqual(400);
    expect(api.status).toBeLessThan(500);
    expect(api.headers['content-type']).toContain('application/json');
    expect(JSON.parse(api.body.toString('utf8'))).toHaveProperty('error.code');
  });

  it('the built frontend calls the API only on its own origin (relative /v1 paths, same-origin credentials, no absolute URL)', () => {
    const scripts = walk(join(DIST, 'js')).filter((file) => file.endsWith('.js'));
    expect(scripts.length).toBeGreaterThan(0);
    const all = scripts.map((file) => readFileSync(file, 'utf8')).join('\n');
    expect(all).toContain('/v1/');
    expect(all).toContain('same-origin');
    const absolute = [...all.matchAll(/https?:\/\/[^\s'"`)]+/g)].map((match) => match[0]).filter((url) => !url.startsWith('http://www.w3.org/'));
    expect(absolute).toEqual([]);
    const html = readFileSync(join(DIST, 'index.html'), 'utf8');
    expect(html).not.toMatch(/(?:src|href)=["']https?:/i);
  });

  it('refuses production at install time, and a missing build, whatever the caller passes', () => {
    const app = running.app;
    expect(() => installAdminWebHosting(app, { appEnv: 'production', distDir: DIST })).toThrow();
    expect(() => installAdminWebHosting(app, { appEnv: 'staging', distDir: join(DIST, 'does-not-exist') })).toThrow();
  });
});
