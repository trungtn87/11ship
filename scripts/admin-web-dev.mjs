#!/usr/bin/env node
// Local HTTPS front for the administration web (M01-D-LOGIN-UI). LOCAL DEVELOPMENT AND TESTS ONLY - never deployed.
//
// One HTTPS origin (default https://localhost:8443) serves the built page from apps/admin-web/dist and forwards ONLY
// /v1/admin-auth/*, /v1/admin/* and /v1/admin-activation/* to the backend over loopback HTTP. Same origin is what the backend's cookies need: __Host-11admin
// and __Host-11admin-pre are Secure + HttpOnly + SameSite=Strict + Path=/, and every POST must carry an Origin that is
// exactly one of ADMIN_AUTH_ALLOWED_ORIGINS. Nothing here weakens that:
//   * cookies, Origin, x-csrf-token and Set-Cookie pass through unchanged (the browser sets Origin, not this script);
//   * client-sent X-Forwarded-For / Forwarded headers are DROPPED and none is added, so the backend needs no trusted
//     proxy (ADMIN_AUTH_TRUSTED_PROXY_IPS stays []) and sees every local request as 127.0.0.1;
//   * any other path of the backend is not reachable through this front.
//
// Usage: npm run admin-web:cert (once), npm run build, then npm run admin-web:dev. See docs/tasks/M01-D-LOGIN-UI-local-run.md.
import { createReadStream, existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

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
const APP_ROUTES = /^\/(?:activate|invitations(?:\/.*)?)$/;

// Login (#34), invitation management (1B) and activation (1C). Nothing else of the backend is reachable through this front.
const API_PREFIXES = ['/v1/admin-auth/', '/v1/admin-activation/', '/v1/admin/'];

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

/**
 * @param {{ distDir: string, backendUrl: string, key: string | Buffer, cert: string | Buffer, upstreamTimeoutMs?: number }} options
 * @returns {import('node:https').Server}
 */
export const UPSTREAM_TIMEOUT_MS = 15_000;

export function createAdminWebServer({ distDir, backendUrl, key, cert, upstreamTimeoutMs = UPSTREAM_TIMEOUT_MS }) {
  const backend = new URL(backendUrl);
  if (backend.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(backend.hostname)) {
    throw new Error('the backend must be a loopback http URL (this front is for local use only)');
  }
  const distRoot = realpathSync(distDir);

  return https.createServer({ key, cert, minVersion: 'TLSv1.2' }, (request, response) => {
    const url = new URL(request.url ?? '/', 'https://front.invalid');
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
function forward(request, response, backend, timeoutMs) {
  const headers = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (!DROPPED_REQUEST_HEADERS.has(name) && value !== undefined) {
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
  const tlsDir = join(root, '.local', 'admin-web-tls');
  const certPath = process.env.ADMIN_WEB_TLS_CERT ?? join(tlsDir, 'cert.pem');
  const keyPath = process.env.ADMIN_WEB_TLS_KEY ?? join(tlsDir, 'key.pem');
  const distDir = join(root, 'apps', 'admin-web', 'dist');
  if (!existsSync(certPath) || !existsSync(keyPath)) {
    console.error(`No TLS certificate at ${certPath}. Run "npm run admin-web:cert" or set ADMIN_WEB_TLS_CERT/ADMIN_WEB_TLS_KEY (for example mkcert files).`);
    process.exit(1);
  }
  if (!existsSync(join(distDir, 'index.html'))) {
    console.error('apps/admin-web/dist is missing. Run "npm run build" first.');
    process.exit(1);
  }
  const host = process.env.ADMIN_WEB_HOST ?? 'localhost';
  const port = Number(process.env.ADMIN_WEB_PORT ?? '8443');
  const backendUrl = process.env.ADMIN_WEB_BACKEND ?? 'http://127.0.0.1:3000';
  const upstreamTimeoutMs = Number(process.env.ADMIN_WEB_UPSTREAM_TIMEOUT_MS ?? String(UPSTREAM_TIMEOUT_MS));
  if (!Number.isSafeInteger(upstreamTimeoutMs) || upstreamTimeoutMs < 100) {
    console.error('ADMIN_WEB_UPSTREAM_TIMEOUT_MS must be an integer number of milliseconds >= 100.');
    process.exit(1);
  }
  const server = createAdminWebServer({ distDir, backendUrl, key: readFileSync(keyPath), cert: readFileSync(certPath), upstreamTimeoutMs });
  server.listen(port, host === 'localhost' ? '127.0.0.1' : host, () => {
    const origin = `https://${host}${port === 443 ? '' : `:${port}`}`;
    console.log(`admin web: ${origin}  ->  backend ${backendUrl} (${API_PREFIXES.join(' ')})`);
    console.log(`backend must have ADMIN_AUTH_ALLOWED_ORIGINS=["${origin}"] and ADMIN_AUTH_TRUSTED_PROXY_IPS=[]`);
  });
}
