import { describe, expect, it, jest } from '@jest/globals';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, IncomingMessage, request as httpRequest, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { formatRoute, parseRoute, Route } from '../../../admin-web/src/core/routes';
import { StartupConfigError } from '../config/startup-config-error';
import { installAdminWebHosting, publicAdminAsset } from './admin-web-hosting';

type Handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

const UUID = '123e4567-e89b-42d3-a456-426614174000';

describe('administration web hosting: what a path may resolve to', () => {
  it('serves only a strict collection of browser resources, never source, hidden or traversal paths', () => {
    expect(publicAdminAsset('/')).toBe('index.html');
    expect(publicAdminAsset('/index.html')).toBe('index.html');
    expect(publicAdminAsset('/styles.css')).toBe('styles.css');
    expect(publicAdminAsset('/js/dom/main.js')).toBe('js/dom/main.js');
    expect(publicAdminAsset('/js/core/activation-api.js')).toBe('js/core/activation-api.js');
    expect(publicAdminAsset('/js/vendor/qrcodegen.js')).toBe('js/vendor/qrcodegen.js');
    expect(publicAdminAsset('/fonts/PlusJakartaSans-wght.woff2')).toBe('fonts/PlusJakartaSans-wght.woff2');
    expect(publicAdminAsset('/fonts/OFL.txt')).toBe('fonts/OFL.txt');
    for (const path of [
      '/v1/admin-auth/state',
      '/v1/health/ready',
      '/.env',
      '/.git/config',
      '/package.json',
      '/js/../../.env',
      '/js/a.js.map',
      '/js/a.spec.ts',
      '/js/dom/main.ts',
      '/js/.hidden.js',
      '/js/a b.js',
      '/fonts/secret.pem',
      '/fonts/README.md',
      '/fonts/',
      '/js',
      '/js/',
      '/index.html/',
      '/%2e%2e/%2e%2e/.env',
      '/js/%2e%2e/.env',
      '/styles.css/x',
      '/unknown',
      '/admin',
      '/login',
      '/activate.html',
      '/invitations/not-a-uuid',
      `/invitations/${UUID}/other`,
      `/invitations/${UUID}/reissue/extra`,
      `/invitations/${UUID}x`,
      '/invitations/new/extra',
    ]) {
      expect(publicAdminAsset(path)).toBeUndefined();
    }
  });

  it('answers the exact browser routes of the frontend with the page, so an activation link or a reload opens the app', () => {
    for (const path of [
      '/activate',
      '/activate/',
      '/invitations',
      '/invitations/',
      '/invitations/new',
      `/invitations/${UUID}`,
      `/invitations/${UUID}/`,
      `/invitations/${UUID}/reissue`,
      `/invitations/${UUID}/revoke`,
      `/invitations/${UUID.toUpperCase()}`,
    ]) {
      expect(publicAdminAsset(path)).toBe('index.html');
    }
  });

  // The server list and the frontend router must not drift: every route the frontend can format is served, and a path
  // the frontend would only map to its "home" fallback (an unknown path) is NOT turned into the application.
  it('is pinned to the frontend router (routes.ts): every formatted route resolves, every fallback does not', () => {
    const routes: Route[] = [
      { name: 'activate' },
      { name: 'invitations' },
      { name: 'invitations', status: 'PENDING' },
      { name: 'invitation-new' },
      { name: 'invitation', id: UUID },
      { name: 'invitation-reissue', id: UUID },
      { name: 'invitation-revoke', id: UUID },
    ];
    for (const route of routes) {
      const [pathname] = formatRoute(route).split('?');
      expect(publicAdminAsset(pathname ?? '')).toBe('index.html');
    }
    for (const pathname of ['/invitations/not-a-uuid', '/nothing', '/invitations/new/x', `/invitations/${UUID}/bogus`]) {
      expect(parseRoute(pathname)).toEqual({ name: 'home' });
      expect(publicAdminAsset(pathname)).toBeUndefined();
    }
  });
});

describe('installAdminWebHosting: fail closed', () => {
  const missingBuild = join(tmpdir(), '11ship-admin-build-that-does-not-exist');

  it('refuses production whatever else was passed, before touching the application', () => {
    const app = { use: jest.fn() } as unknown as INestApplication;
    expect(() => installAdminWebHosting(app, { appEnv: 'production', distDir: missingBuild })).toThrow(StartupConfigError);
    expect(app.use).not.toHaveBeenCalled();
  });

  it('stops startup, naming only the variable, when the build is missing', () => {
    const app = { use: jest.fn() } as unknown as INestApplication;
    try {
      installAdminWebHosting(app, { appEnv: 'staging', distDir: missingBuild });
      throw new Error('expected a failure');
    } catch (error) {
      expect(error).toBeInstanceOf(StartupConfigError);
      expect((error as StartupConfigError).invalid).toEqual(['ADMIN_WEB_STAGING_ENABLED']);
    }
    expect(app.use).not.toHaveBeenCalled();
  });

  it('stops startup for a build without its entry module (a half-built page is not served)', () => {
    const dir = mkdtempSync(join(tmpdir(), '11ship-admin-half-build-'));
    try {
      writeFileSync(join(dir, 'index.html'), '<!doctype html>');
      const app = { use: jest.fn() } as unknown as INestApplication;
      expect(() => installAdminWebHosting(app, { appEnv: 'staging', distDir: dir })).toThrow(StartupConfigError);
      expect(app.use).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('installAdminWebHosting: serving', () => {
  async function withServer(run: (origin: string, nextCalls: string[], dir: string) => Promise<void>): Promise<void> {
    const dir = mkdtempSync(join(tmpdir(), '11ship-admin-assets-'));
    mkdirSync(join(dir, 'js', 'dom'), { recursive: true });
    mkdirSync(join(dir, 'js', 'core'), { recursive: true });
    mkdirSync(join(dir, 'fonts'), { recursive: true });
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>11Ship test</title>');
    writeFileSync(join(dir, 'styles.css'), 'body{}');
    writeFileSync(join(dir, 'js', 'dom', 'main.js'), 'console.log("main")');
    writeFileSync(join(dir, 'js', 'core', 'routes.js'), 'export {}');
    writeFileSync(join(dir, 'fonts', 'PlusJakartaSans-wght.woff2'), 'font');
    // Things that exist on disk next to the build but must never be served.
    writeFileSync(join(dir, '.env'), 'SECRET=do-not-serve');
    writeFileSync(join(dir, 'js', 'dom', 'main.js.map'), '{}');
    writeFileSync(join(dir, 'js', 'dom', 'main.ts'), 'source');
    let handler: Handler | undefined;
    const app = {
      use: (fn: Handler) => {
        handler = fn;
      },
    } as unknown as INestApplication;
    const nextCalls: string[] = [];
    const server = createServer((req, res) => {
      if (handler === undefined) {
        throw new Error('missing handler');
      }
      handler(req, res, () => {
        nextCalls.push(`${req.method ?? ''} ${req.url ?? ''}`);
        res.writeHead(204).end();
      });
    });
    try {
      installAdminWebHosting(app, { appEnv: 'staging', distDir: dir });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = (server.address() as AddressInfo).port;
      await run(`http://127.0.0.1:${port}`, nextCalls, dir);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // fetch() normalizes the path (dot segments, //), so raw request targets go through http.request.
  function rawGet(origin: string, target: string, method = 'GET'): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
    return new Promise((resolve, reject) => {
      const url = new URL(origin);
      const request = httpRequest({ host: url.hostname, port: url.port, method, path: target }, (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }),
        );
      });
      request.on('error', reject);
      request.end();
    });
  }

  it('serves the page and the assets with secure headers and the right content types', async () => {
    await withServer(async (origin) => {
      const page = await fetch(`${origin}/`);
      expect(page.status).toBe(200);
      expect(page.headers.get('content-type')).toContain('text/html');
      expect(await page.text()).toContain('11Ship test');
      expect(page.headers.get('content-security-policy')).toContain("default-src 'none'");
      expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
      expect(page.headers.get('cache-control')).toBe('no-store');
      expect(page.headers.get('x-content-type-options')).toBe('nosniff');
      expect(page.headers.get('referrer-policy')).toBe('no-referrer');
      const js = await fetch(`${origin}/js/dom/main.js`);
      expect(js.status).toBe(200);
      expect(js.headers.get('content-type')).toContain('javascript');
      const css = await fetch(`${origin}/styles.css`);
      expect(css.headers.get('content-type')).toContain('text/css');
      const font = await fetch(`${origin}/fonts/PlusJakartaSans-wght.woff2`);
      expect(font.headers.get('content-type')).toBe('font/woff2');
      const head = await fetch(`${origin}/`, { method: 'HEAD' });
      expect(head.status).toBe(200);
      expect(await head.text()).toBe('');
    });
  });

  it('opens the same page on the frontend routes (activation link, deep link, reload), with the same headers', async () => {
    await withServer(async (origin) => {
      for (const path of ['/activate', '/invitations', '/invitations/new', `/invitations/${UUID}`, `/invitations/${UUID}/revoke`]) {
        const response = await fetch(`${origin}${path}`);
        expect(response.status).toBe(200);
        expect(await response.text()).toContain('11Ship test');
        expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
      }
      // The invitation token lives in the URL fragment, which a browser never sends; a query string changes nothing.
      expect((await fetch(`${origin}/invitations?status=PENDING`)).status).toBe(200);
    });
  });

  it('never answers /v1 itself (any casing, the health route included) and leaves the request to the real API', async () => {
    await withServer(async (origin, nextCalls) => {
      for (const path of ['/v1', '/v1/', '/v1/health/ready', '/v1/admin-auth/state', '/v1/admin-activation/x', '/V1/health/ready']) {
        expect((await fetch(`${origin}${path}`)).status).toBe(204);
      }
      expect((await fetch(`${origin}/v1/admin-auth/login`, { method: 'POST' })).status).toBe(204);
      expect((await fetch(`${origin}/v1/admin-auth/x`, { method: 'DELETE' })).status).toBe(204);
      expect(nextCalls).toContain('GET /v1/health/ready');
      expect(nextCalls).toContain('POST /v1/admin-auth/login');
      // Only a real /v1 prefix: a look-alike is a static miss, not an API call.
      expect((await fetch(`${origin}/v10/x`)).status).toBe(404);
      expect((await fetch(`${origin}/v1x`)).status).toBe(404);
    });
  });

  it('answers 404 with the security headers for everything outside the allowlist, even if the file exists on disk', async () => {
    await withServer(async (origin, nextCalls) => {
      for (const path of ['/.env', '/js/dom/main.js.map', '/js/dom/main.ts', '/unknown', '/js/dom/', '/fonts/']) {
        const response = await fetch(`${origin}${path}`);
        expect(response.status).toBe(404);
        expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
        expect(await response.text()).not.toContain('do-not-serve');
      }
      // Raw targets that a client library would normalize away.
      for (const target of ['/js/%2e%2e/%2e%2e/.env', '/js/../.env', '/%2e%2e/.env', '//v1/health/ready', '//evil.example/x', 'http://evil.example/']) {
        const response = await rawGet(origin, target);
        expect(response.status).toBe(404);
        expect(response.body).not.toContain('do-not-serve');
      }
      expect(nextCalls).toEqual([]);
    });
  });

  it('refuses every method but GET and HEAD on a static path with 405, before any body is read', async () => {
    await withServer(async (origin, nextCalls) => {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
        const response = await fetch(`${origin}/activate?secret=do-not-log`, { method });
        expect(response.status).toBe(405);
        expect(response.headers.get('allow')).toBe('GET, HEAD');
        expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
      }
      const garbage = await fetch(`${origin}/`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' });
      expect(garbage.status).toBe(405);
      expect(nextCalls).toEqual([]);
    });
  });

  it('does not follow a symbolic link that leaves the build directory', async () => {
    await withServer(async (origin, _nextCalls, dir) => {
      const outside = mkdtempSync(join(tmpdir(), '11ship-admin-outside-'));
      try {
        writeFileSync(join(outside, 'secret.js'), 'do-not-serve');
        symlinkSync(join(outside, 'secret.js'), join(dir, 'js', 'core', 'leak.js'));
        const response = await fetch(`${origin}/js/core/leak.js`);
        expect(response.status).toBe(404);
        expect(await response.text()).not.toContain('do-not-serve');
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });
  });
});
