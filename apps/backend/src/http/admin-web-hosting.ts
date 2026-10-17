// Same-origin hosting of the administration web (issue #49, carried over from PR #42 and adapted to the Admin
// frontend of main). Render terminates HTTPS and the existing Nest process serves BOTH the static page and
// /v1/admin-auth, /v1/admin-activation, ... on ONE origin: the administration cookies are __Host-* cookies and
// the page calls the API with `credentials: 'same-origin'`, so a second origin (or a second local-HTTPS proxy in
// front of Render) would break login. Nothing here opens a port, reads a secret or touches the database.
//
// What it serves is an EXPLICIT allowlist, never a directory listing and never a catch-all:
//   - the built assets of apps/admin-web/dist: the page, its stylesheet, its modules and its font;
//   - the exact browser routes of the frontend (routes.ts: /activate, /invitations, ...), answered with the page,
//     so an activation link or a reload of a deep link opens the application instead of a 404.
// Everything else answers 404 with the same security headers. Requests under /v1 are NEVER answered here: they go on
// to the real API untouched (the API, including its own error envelope and its own transport headers, is not shadowed
// by a static fallback). Only GET and HEAD are answered for a static path; anything else is 405.
//
// Installation order matters: it is installed through app.use() BEFORE the application initializes, so it sits in
// front of the body parser (which the framework registers at init). A static answer therefore never reaches the
// parser, and a malformed body sent to a static path cannot produce a header-less parser error.
import { createReadStream, existsSync, realpathSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { ADMIN_WEB_STAGING_ENABLED_VARIABLE } from '../config/admin-web-hosting-config';
import { StartupConfigError } from '../config/startup-config-error';

const MIME: Readonly<Record<string, string>> = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
});

// Same-origin only: the page loads nothing from anywhere else and talks only to its own API.
const HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'content-security-policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; " +
    "base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'cache-control': 'no-store',
});

/** The API prefix. Matched case-insensitively because the framework's own routing is. */
const API_PREFIX = /^\/v1(?:\/|$)/i;

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

/**
 * The browser routes of apps/admin-web/src/core/routes.ts (parseRoute / formatRoute). They all open the same page; the
 * server decides nothing about them (role, session): the page asks the API. A path that parseRoute would map to the
 * "home" fallback is deliberately NOT in this list: an unknown path is a 404, not the application. A test pins this list
 * to the frontend's own router.
 */
const SPA_ROUTES: readonly RegExp[] = Object.freeze([
  /^\/activate$/,
  // M02 dish groups (Danh mục › Nhóm món): a reload or a bookmark of the page opens the app.
  /^\/catalog\/categories$/,
  // M03 Shippers (Vận hành › Shipper) and the Shipper wallet parameters (Hệ thống › Tham số hệ thống).
  /^\/operations\/shippers$/,
  new RegExp(`^/operations/shippers/${UUID}$`),
  /^\/system\/parameters\/shipper-wallet$/,
  /^\/invitations$/,
  /^\/invitations\/new$/,
  new RegExp(`^/invitations/${UUID}$`),
  new RegExp(`^/invitations/${UUID}/(?:reissue|revoke)$`),
]);

/**
 * Maps a request path to the built file that answers it, or undefined. Explicit allowlist: no traversal, no hidden
 * file, no source map, no TypeScript source, no secret file, no API content. The frontend strips trailing slashes before
 * it parses a route, so the server accepts them the same way for a route (never for an asset).
 */
export function publicAdminAsset(pathname: string): string | undefined {
  if (pathname === '/' || pathname === '/index.html') {
    return 'index.html';
  }
  if (pathname === '/styles.css') {
    return 'styles.css';
  }
  if (/^\/js\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.js$/.test(pathname)) {
    return pathname.slice(1);
  }
  if (/^\/fonts\/[A-Za-z0-9_-]+\.(?:woff2|txt)$/.test(pathname)) {
    return pathname.slice(1);
  }
  if (/^\/[A-Za-z0-9_-]+\.(?:png|svg)$/.test(pathname)) {
    return pathname.slice(1);
  }
  const route = pathname.replace(/\/+$/, '');
  if (SPA_ROUTES.some((pattern) => pattern.test(route))) {
    return 'index.html';
  }
  return undefined;
}

export interface AdminWebHostingOptions {
  readonly appEnv: string;
  /** Built assets (apps/admin-web/dist by default). */
  readonly distDir?: string;
}

/** The path part of the request target, exactly as sent (no decoding), or undefined when it is not an origin-form path. */
function pathOf(target: string | undefined): string | undefined {
  const raw = target ?? '/';
  const end = raw.search(/[?#]/);
  const path = end === -1 ? raw : raw.slice(0, end);
  // Origin-form only. "//host/x" and absolute-form targets are not paths of this server.
  return path.startsWith('/') && !path.startsWith('//') ? path : undefined;
}

/**
 * Installs the hosting. Called by main.ts only when loadConfig produced `adminWebHosting` (ADMIN_WEB_STAGING_ENABLED=true
 * on staging or production with the administration web authentication enabled). Configuration validation is the environment
 * gate; this adapter independently requires a complete build and stops startup instead of serving a broken page.
 */
export function installAdminWebHosting(app: INestApplication, options: AdminWebHostingOptions): void {
  const root = resolve(options.distDir ?? join(process.cwd(), 'apps', 'admin-web', 'dist'));
  if (!existsSync(join(root, 'index.html')) || !existsSync(join(root, 'js', 'dom', 'main.js'))) {
    // `npm run build:admin-web` is part of the staging build command; without it there is nothing to serve.
    throw new StartupConfigError([ADMIN_WEB_STAGING_ENABLED_VARIABLE]);
  }
  const canonicalRoot = realpathSync(root);

  app.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const pathname = pathOf(req.url);
    if (pathname === undefined) {
      res.writeHead(404, HEADERS).end();
      return;
    }
    // The real API is never shadowed (health included): no static fallback for anything under /v1.
    if (API_PREFIX.test(pathname)) {
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
    createReadStream(filename)
      .on('error', () => res.destroy())
      .pipe(res);
  });
}
