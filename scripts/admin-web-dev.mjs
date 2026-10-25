#!/usr/bin/env node
// Local HTTPS front for the administration web (M01-D-LOGIN-UI). LOCAL DEVELOPMENT AND TESTS ONLY - never deployed.
//
// One HTTPS origin (default https://localhost:8443) serves the built page from apps/admin-web/dist and forwards ONLY
// /v1/admin-auth/*, /v1/admin/* and /v1/admin-activation/* (plus, M01-RESET, exactly two public account-recovery routes) to the backend over loopback HTTP. Same origin is what the backend's cookies need: __Host-11admin
// and __Host-11admin-pre are Secure + HttpOnly + SameSite=Strict + Path=/, and every POST must carry an Origin that is
// exactly one of ADMIN_AUTH_ALLOWED_ORIGINS. Nothing here weakens that:
//   * cookies, Origin, x-csrf-token and Set-Cookie pass through unchanged (the browser sets Origin, not this script);
//   * client-sent X-Forwarded-For / Forwarded headers are DROPPED and none is added, so the backend needs no trusted
//     proxy (ADMIN_AUTH_TRUSTED_PROXY_IPS stays []) and sees every local request as 127.0.0.1;
//   * any other path of the backend is not reachable through this front.
//
// M00.08: the build carries a build-manifest.json (scripts/admin-web-build.mjs). Started the way the launcher starts it
// (`node scripts/admin-web-dev.mjs`), the front refuses a certificate that is unusable (exit 3), a build without a valid
// manifest or whose files no longer match it (exit 4) and a port someone else holds (exit 5), and it answers
// GET /__11ship/runtime with the identity of the build it serves (app, commit, fingerprint) so the launcher can prove it.
//
// Usage: npm run admin-web:cert (once), npm run build:admin-web, then npm run admin-web:dev. Normally `11Ship-Admin.cmd` does all of
// it (ops/runbooks/local-https-runtime.md). See docs/tasks/M01-D-LOGIN-UI-local-run.md.
import { createReadStream, existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUNTIME_PATH, readBuildIdentity, RuntimeStartError } from './client-web-dev.mjs';
import { defaultTlsPaths, inspectTlsFiles } from './lib/local-tls.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
};

/** Static responses: nothing from another origin, no framing, no inline script. */
const SECURITY_HEADERS = {
  'content-security-policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; " +
    "base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
  'cache-control': 'no-store',
};

// Client-side routes of the page (see apps/admin-web/src/core/routes.ts): the page is served, and it decides what to show.
const APP_ROUTES = /^\/(?:activate|reset|invitations(?:\/.*)?|accounts(?:\/.*)?|catalog\/categories|system\/settings|system\/config|system\/audit|system\/backups|overview|reports|system\/parameters\/shipper-wallet|system\/shipping-fee-policy|system-ops(?:\/(?:incidents(?:\/(?:SC-\d{1,9}|[0-9a-fA-F-]{36}))?|gateway|logs|releases|config))?|operations\/(?:shippers(?:\/.*)?|orders|shops(?:\/[0-9a-fA-F-]{36})?|deliveries|notifications)|system\/parameters\/wallet|finance(?:\/(?:wallets|transactions|reconciliation|bank-accounts|(?:topups|withdrawals)(?:\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})?))?)$/;

// Login (#34), invitation management (1B) and activation (1C). Nothing else of the backend is reachable through this front.
const API_PREFIXES = ['/v1/admin-auth/', '/v1/admin-activation/', '/v1/admin/'];

// M01-RESET (no-OTP test build): the public password reset of the forgotten-password page. Exactly these two routes, no prefix, no query.
// They are PUBLIC: unlike the routes above they never carry the cookie, the x-csrf-token or an Authorization header of another session
// to the backend (see PUBLIC_FORWARDED_HEADERS); only the Idempotency-Key and the JSON body travel.
const RECOVERY_ROUTES = new Map([
  ['/v1/admin-recovery/config', 'GET'],
  ['/v1/admin-recovery/reset-test', 'POST'],
  // SMS_OTP flow (issue #102): request a code, then the one-use proof, then the reset itself.
  ['/v1/admin-recovery/otp', 'POST'],
  ['/v1/admin-recovery/reset', 'POST'],
]);
const RECOVERY_VERIFY = /^\/v1\/admin-recovery\/otp\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/verify$/;
const recoveryMethod = (pathname) => (RECOVERY_VERIFY.test(pathname) ? 'POST' : RECOVERY_ROUTES.get(pathname));
const PUBLIC_FORWARDED_HEADERS = new Set(['accept', 'content-type', 'content-length', 'idempotency-key']);
const MAX_RECOVERY_REQUEST_BYTES = 8192;

// Request headers never forwarded: hop-by-hop ones, and every client-supplied forwarding header (the backend must not
// be able to believe an address the browser made up).
const DROPPED_REQUEST_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'transfer-encoding',
  'upgrade',
  'te',
  'trailer',
  'host',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
  'forwarded',
]);
const DROPPED_RESPONSE_HEADERS = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'trailer']);

export const UPSTREAM_TIMEOUT_MS = 15_000;

/**
 * @param {{ distDir: string, backendUrl: string, key: string | Buffer, cert: string | Buffer, upstreamTimeoutMs?: number, identity?: object }} options
 *   `identity` (optional): what GET /__11ship/runtime reports (infrastructure metadata only). Without it the route does not exist.
 * @returns {import('node:https').Server}
 */
export function createAdminWebServer({ distDir, backendUrl, key, cert, upstreamTimeoutMs = UPSTREAM_TIMEOUT_MS, identity }) {
  const backend = new URL(backendUrl);
  if (backend.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(backend.hostname)) {
    throw new Error('the backend must be a loopback http URL (this front is for local use only)');
  }
  const distRoot = realpathSync(distDir);

  return https.createServer({ key, cert, minVersion: 'TLSv1.2' }, (request, response) => {
    const url = new URL(request.url ?? '/', 'https://front.invalid');
    if (identity !== undefined && url.pathname === RUNTIME_PATH) {
      if (request.method !== 'GET') {
        response.writeHead(405, { ...SECURITY_HEADERS, allow: 'GET', 'content-type': 'text/plain; charset=utf-8' });
        response.end();
        return;
      }
      response.writeHead(200, { ...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ data: identity }));
      return;
    }
    if (recoveryMethod(url.pathname) !== undefined) {
      const method = recoveryMethod(url.pathname);
      const refuse = (status, code) => {
        request.resume();
        response.writeHead(status, { ...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: { code, message: 'Not available', request_id: '', details: {} } }));
      };
      const origin = request.headers.origin;
      const declared = Number(request.headers['content-length'] ?? 0);
      if (request.method !== method) {
        refuse(405, 'METHOD_NOT_ALLOWED');
      } else if ((request.url ?? '') !== url.pathname) {
        refuse(404, 'NOT_FOUND');
      } else if ((method === 'POST' ? origin !== `https://${request.headers.host}` : origin !== undefined && origin !== `https://${request.headers.host}`) || (request.headers['sec-fetch-site'] !== undefined && request.headers['sec-fetch-site'] !== 'same-origin')) {
        refuse(403, 'ORIGIN_NOT_ALLOWED');
      } else if (!Number.isFinite(declared) || declared > MAX_RECOVERY_REQUEST_BYTES || request.headers['transfer-encoding'] !== undefined || (method === 'GET' && declared !== 0)) {
        refuse(method === 'GET' || !Number.isFinite(declared) ? 400 : 413, 'BAD_REQUEST');
      } else {
        forward(request, response, backend, upstreamTimeoutMs, PUBLIC_FORWARDED_HEADERS);
      }
      return;
    }
    if (API_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
      forward(request, response, backend, upstreamTimeoutMs);
      return;
    }
    serveStatic(url.pathname, request, response, distRoot);
  });
}

/**
 * Forwards one API request. A single upstream deadline (default 15 s, ADMIN_WEB_UPSTREAM_TIMEOUT_MS) covers the whole
 * exchange: connecting, the backend's answer and its body. When it passes, the upstream connection is destroyed and the
 * browser gets 504 (or a cut connection if the answer had already started). If the browser goes away first, the upstream
 * request is destroyed too. The timer is cleared in every case. This is a communication timeout of the local front only;
 * it does not change any session or challenge lifetime, and a timed-out request may still have been executed upstream.
 */
function forward(request, response, backend, timeoutMs, onlyHeaders) {
  const headers = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (!DROPPED_REQUEST_HEADERS.has(name) && value !== undefined && (onlyHeaders === undefined || onlyHeaders.has(name))) {
      headers[name] = value;
    }
  }
  headers.host = backend.host;
  let finished = false;
  let timer;
  const finish = () => {
    finished = true;
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  const answerError = (status, code) => {
    if (!response.headersSent) {
      // Same envelope shape as the backend's answers; the page shows "Chưa thể kết nối".
      response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ error: { code, message: 'Service unavailable', request_id: '', details: {} } }));
    } else {
      response.destroy();
    }
  };
  const upstream = http.request(
    { hostname: backend.hostname.replace(/^\[|\]$/g, ''), port: backend.port || 80, method: request.method, path: request.url, headers },
    (answer) => {
      const out = {};
      for (const [name, value] of Object.entries(answer.headers)) {
        if (!DROPPED_RESPONSE_HEADERS.has(name) && value !== undefined) {
          out[name] = value;
        }
      }
      response.writeHead(answer.statusCode ?? 502, out);
      answer.on('end', finish);
      answer.on('error', () => {
        finish();
        response.destroy();
      });
      answer.pipe(response);
    },
  );
  timer = setTimeout(() => {
    timer = undefined;
    if (!finished) {
      finished = true;
      upstream.destroy(new Error('upstream timeout'));
      answerError(504, 'SERVICE_UNAVAILABLE');
    }
  }, timeoutMs);
  upstream.on('error', () => {
    if (finished) {
      return;
    }
    finish();
    answerError(503, 'SERVICE_UNAVAILABLE');
  });
  // The browser closed the connection before the answer was complete: stop waiting for the backend.
  response.on('close', () => {
    if (!response.writableFinished) {
      upstream.destroy();
    }
    finish();
  });
  request.pipe(upstream);
}

function serveStatic(pathname, request, response, distRoot) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { ...SECURITY_HEADERS, allow: 'GET, HEAD' });
    response.end();
    return;
  }
  let relative;
  try {
    relative = decodeURIComponent(pathname);
  } catch {
    relative = '';
  }
  if (relative === '/' || relative === '') {
    relative = '/index.html';
  }
  // The build manifest is for the launcher and /__11ship/runtime, not for the browser (the hosted backend does not serve it either).
  if (relative === '/build-manifest.json') {
    response.writeHead(404, { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }
  const candidate = normalize(join(distRoot, relative));
  let file;
  try {
    file = realpathSync(candidate);
  } catch {
    file = undefined;
  }
  if ((file === undefined || !statSync(file).isFile()) && APP_ROUTES.test(relative)) {
    // Application routes (/activate, /invitations/...) are client-side: the page itself is served, the server never
    // decides what it may show. Anything else that does not exist stays 404.
    try {
      file = realpathSync(join(distRoot, 'index.html'));
    } catch {
      file = undefined;
    }
  }
  if (file === undefined || (file !== distRoot && !file.startsWith(distRoot + sep)) || !statSync(file).isFile()) {
    response.writeHead(404, { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }
  response.writeHead(200, { ...SECURITY_HEADERS, 'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream' });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  createReadStream(file).pipe(response);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const stop = (code, errorCode, message) => {
    console.error(`Web Admin: ${errorCode}: ${message}`);
    process.exit(code);
  };
  const tls = defaultTlsPaths(root);
  const inspected = inspectTlsFiles(tls);
  if (!inspected.ok) {
    stop(3, inspected.code, `${inspected.message}. Run "npm run admin-web:cert" or set ADMIN_WEB_TLS_CERT/ADMIN_WEB_TLS_KEY (for example mkcert files); see ops/runbooks/local-https-runtime.md`);
  }
  const distDir = process.env.ADMIN_WEB_DIST ?? join(root, 'apps', 'admin-web', 'dist');
  if (!existsSync(join(distDir, 'index.html'))) {
    stop(4, 'ARTIFACT_MISSING', 'apps/admin-web/dist is missing. Run "npm run build:admin-web" first.');
  }
  const host = process.env.ADMIN_WEB_HOST ?? 'localhost';
  const port = Number(process.env.ADMIN_WEB_PORT ?? '8443');
  const backendUrl = process.env.ADMIN_WEB_BACKEND ?? 'http://127.0.0.1:3000';
  const upstreamTimeoutMs = Number(process.env.ADMIN_WEB_UPSTREAM_TIMEOUT_MS ?? String(UPSTREAM_TIMEOUT_MS));
  if (!Number.isSafeInteger(upstreamTimeoutMs) || upstreamTimeoutMs < 100) {
    stop(2, 'CONFIG_INVALID', 'ADMIN_WEB_UPSTREAM_TIMEOUT_MS must be an integer number of milliseconds >= 100.');
  }
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    stop(2, 'CONFIG_INVALID', 'ADMIN_WEB_PORT must be a port number.');
  }
  let server;
  try {
    const identity = readBuildIdentity(realpathSync(distDir), 'admin-web');
    server = createAdminWebServer({ distDir, backendUrl, key: readFileSync(tls.key), cert: readFileSync(tls.cert), upstreamTimeoutMs, identity });
    server.identity = identity;
  } catch (error) {
    if (error instanceof RuntimeStartError) {
      stop(error.code.startsWith('ARTIFACT') ? 4 : 2, error.code, `${error.message} (npm run build:admin-web)`);
    }
    throw error;
  }
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE' || error.code === 'EACCES') {
      stop(5, 'PORT_IN_USE', `port ${String(port)} is held by another process or not allowed`);
    }
    stop(1, 'SERVER_ERROR', String(error.code ?? 'unknown'));
  });
  server.listen(port, host === 'localhost' ? '127.0.0.1' : host, () => {
    const actual = server.address().port;
    const origin = `https://${host}${actual === 443 ? '' : `:${String(actual)}`}`;
    console.log(`admin web: ${origin}  ->  backend ${backendUrl} (${API_PREFIXES.join(' ')})`);
    console.log(`backend must have ADMIN_AUTH_ALLOWED_ORIGINS=["${origin}"] and ADMIN_AUTH_TRUSTED_PROXY_IPS=[]`);
    // One machine-readable line, like the phone apps: the tests read the port and identity from it.
    console.log(JSON.stringify({ event: 'listening', app: 'admin-web', origin, port: actual, ...server.identity }));
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
