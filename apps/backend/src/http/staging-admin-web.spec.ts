import { describe, expect, it, jest } from '@jest/globals';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { installStagingAdminWeb, publicAdminAsset } from './staging-admin-web';

describe('Render staging administration assets', () => {
  it('only resolves a strict collection of browser resources, never source or traversal paths', () => {
    expect(publicAdminAsset('/')).toBe('index.html');
    expect(publicAdminAsset('/styles.css')).toBe('styles.css');
    expect(publicAdminAsset('/js/dom/main.js')).toBe('js/dom/main.js');
    expect(publicAdminAsset('/fonts/PlusJakartaSans-wght.woff2')).toBe('fonts/PlusJakartaSans-wght.woff2');
    for (const path of ['/v1/admin-auth/state', '/v1/health/ready', '/.env', '/package.json',
      '/js/../../.env', '/js/a.js.map', '/js/a.spec.ts', '/fonts/secret.pem']) {
      expect(publicAdminAsset(path)).toBeUndefined();
    }
  });

  it('refuses to serve admin outside the staging+enabled+admin-auth gate', () => {
    const app = { use: jest.fn() } as unknown as INestApplication;
    const mockMissingPath = join(tmpdir(), '11ship-admin-build-not-found');
    expect(() => installStagingAdminWeb(app, {
      appEnv: 'production', adminAuthEnabled: true, enabledFlag: 'true', distDir: mockMissingPath,
    })).toThrow('ADMIN_WEB_STAGING_ENABLED');
    expect(() => installStagingAdminWeb(app, {
      appEnv: 'staging', adminAuthEnabled: false, enabledFlag: 'true', distDir: mockMissingPath,
    })).toThrow('ADMIN_WEB_STAGING_ENABLED');
    expect(() => installStagingAdminWeb(app, {
      appEnv: 'staging', adminAuthEnabled: true, enabledFlag: 'maybe', distDir: mockMissingPath,
    })).toThrow('ADMIN_WEB_STAGING_ENABLED');
    installStagingAdminWeb(app, {
      appEnv: 'staging', adminAuthEnabled: false, enabledFlag: undefined, distDir: mockMissingPath,
    });
    expect(app.use).not.toHaveBeenCalled();
    expect(() => installStagingAdminWeb(app, {
      appEnv: 'staging', adminAuthEnabled: true, enabledFlag: 'true', distDir: mockMissingPath,
    })).toThrow('ADMIN_WEB_STAGING_BUILD_MISSING');
    expect(app.use).not.toHaveBeenCalled();
  });

  it('serves HTML and JS with secure headers and passes /v1 API routes to Nest', async () => {
    const dir = mkdtempSync(join(tmpdir(), '11ship-staging-assets-'));
    mkdirSync(join(dir, 'js', 'dom'), { recursive: true });
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>11Ship test</title>');
    writeFileSync(join(dir, 'js', 'dom', 'main.js'), 'console.log("test")');
    let handler: ((req: IncomingMessage, res: ServerResponse, next: () => void) => void) | undefined;
    const app = { use: (fn: typeof handler) => { handler = fn; } } as unknown as INestApplication;
    const server = createServer((req, res) => {
      if (handler === undefined) throw new Error('missing handler');
      handler(req, res, () => res.writeHead(204).end());
    });
    try {
      installStagingAdminWeb(app, {
        appEnv: 'staging', adminAuthEnabled: true, enabledFlag: 'true', distDir: dir,
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = (server.address() as AddressInfo).port;
      const origin = `http://127.0.0.1:${port}`;
      const page = await fetch(origin + '/');
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('11Ship test');
      expect(page.headers.get('content-security-policy')).toContain("default-src 'none'");
      expect(page.headers.get('cache-control')).toBe('no-store');
      const js = await fetch(origin + '/js/dom/main.js');
      expect(js.status).toBe(200);
      expect(js.headers.get('content-type')).toContain('javascript');
      const head = await fetch(origin + '/', { method: 'HEAD' });
      expect(head.status).toBe(200);
      expect(await head.text()).toBe('');
      expect((await fetch(origin + '/v1/admin-auth/state')).status).toBe(204);
      expect((await fetch(origin + '/v1/health/ready')).status).toBe(204);
      expect((await fetch(origin + '/.env')).status).toBe(404);
      expect((await fetch(origin + '/js/%2e%2e/%2e%2e/.env')).status).toBe(404);
      expect((await fetch(origin + '/?secret=do-not-log', { method: 'POST' })).status).toBe(405);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
