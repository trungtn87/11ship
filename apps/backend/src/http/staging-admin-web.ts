// Staging-only administration page. Render terminates HTTPS; the existing Nest app serves
// both the HTML assets and /v1/admin-auth on ONE origin (required for __Host-* cookies).
// Never start another local-HTTPS proxy in Render, and never expose secret files.
import { createReadStream, existsSync, realpathSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import type { INestApplication } from '@nestjs/common';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
};

const HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; " +
    "base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
  'cache-control': 'no-store',
};

// Explicit allowlist: no directory traversal, arbitrary hidden files, maps, API content, or source TS.
export function publicAdminAsset(pathname: string): string | undefined {
  if (pathname === '/') return 'index.html';
  if (pathname === '/index.html' || pathname === '/styles.css') return pathname.slice(1);
  if (/^\/js\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.js$/.test(pathname)) return pathname.slice(1);
  if (/^\/fonts\/[A-Za-z0-9_-]+\.(?:woff2|txt)$/.test(pathname)) return pathname.slice(1);
  if (/^\/[A-Za-z0-9_-]+\.(?:png|svg)$/.test(pathname)) return pathname.slice(1);
  return undefined;
}

export interface AdminWebMiddlewareOptions {
  appEnv: string;
  adminAuthEnabled: boolean;
  enabledFlag: string | undefined;
  distDir?: string;
}

export function installStagingAdminWeb(app: INestApplication, options: AdminWebMiddlewareOptions): void {
  const flag = options.enabledFlag;
  if (flag === undefined || flag === 'false') return;
  // Fail closed on production, absent admin auth, or unexpected flag values.
  if (flag !== 'true' || options.appEnv !== 'staging' || !options.adminAuthEnabled) {
    throw new Error('ADMIN_WEB_STAGING_ENABLED is not permitted for this configuration');
  }
  const root = resolve(options.distDir ?? join(process.cwd(), 'apps', 'admin-web', 'dist'));
  const index = join(root, 'index.html');
  if (!existsSync(index) || !existsSync(join(root, 'js', 'dom', 'main.js'))) {
    throw new Error('ADMIN_WEB_STAGING_BUILD_MISSING');
  }
  const canonicalRoot = realpathSync(root);
  app.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
    let pathname: string;
    try {
      pathname = new URL(req.url ?? '/', 'http://staging.invalid').pathname;
    } catch {
      res.writeHead(400, HEADERS).end();
      return;
    }
    // Always preserve Nest's real API (including health); no static fallback for API routes.
    if (pathname === '/v1' || pathname.startsWith('/v1/')) {
      next();
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { ...HEADERS, allow: 'GET, HEAD' }).end();
      return;
    }
    const asset = publicAdminAsset(pathname);
    if (asset === undefined) {
      res.writeHead(404, HEADERS).end();
      return;
    }
    let filename: string;
    try {
      const file = realpathSync(join(canonicalRoot, asset));
      if (!file.startsWith(canonicalRoot + sep) || !statSync(file).isFile()) {
        throw new Error('not an asset');
      }
      filename = file;
    } catch {
      res.writeHead(404, HEADERS).end();
      return;
    }
    res.writeHead(200, { ...HEADERS, 'content-type': MIME[extname(filename)] ?? 'application/octet-stream' });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(filename).on('error', () => res.destroy()).pipe(res);
  });
}
