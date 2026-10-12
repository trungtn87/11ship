#!/usr/bin/env node
// Local HTTPS front of a phone app's PC runtime (11Food https://localhost:8444, 11Ship https://localhost:8445), M00.05.
// LOCAL DEVELOPMENT AND TESTS ONLY - never deployed. Started by scripts/food-web-dev.mjs and scripts/ship-web-dev.mjs (which the
// launcher runs), or by hand: `npm run food-web:dev`, `npm run ship-web:dev`.
//
// One loopback HTTPS origin per app serves the build in apps/<app>/dist and answers exactly three kinds of request:
//   * GET/HEAD of the static build (and, for extension-less paths, the page itself: the app routes in the browser);
//   * GET /__11ship/runtime: which build is running (app, source commit, build fingerprint, design version) - infrastructure
//     metadata only: no session, no right, no path, no secret, no connection string;
//   * GET /v1/health/live and GET /v1/health/ready, forwarded to the backend over loopback HTTP. NOTHING else of /v1 is
//     reachable: not a prefix, not a wildcard, not another method, not a query string. Auth, cookies and business routes are
//     opened by later packages after their own review (the Admin front keeps its own allowlist in admin-web-dev.mjs).
//
// What the server refuses to start with: a certificate that is missing, expired, not yet valid, not naming localhost and
// 127.0.0.1, or whose key does not belong to it; a build folder without a valid manifest or whose files no longer match the
// manifest's fingerprint (so the identity it reports is always the identity of what it serves); a port someone else holds.
// It never switches TLS verification off and never touches a trust store.
import { createReadStream, existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { artifactFingerprint } from './lib/artifact-fingerprint.mjs';
import { defaultTlsPaths, inspectTlsFiles } from './lib/local-tls.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The phone apps that have a PC runtime. Admin keeps scripts/admin-web-dev.mjs. */
export const CLIENT_RUNTIMES = {
  'food-web': { runtimeAppId: 'FOOD_WEB', port: 8444, name: '11Food' },
  'ship-web': { runtimeAppId: 'SHIP_WEB', port: 8445, name: '11Ship' },
};
export const RUNTIME_PATH = '/__11ship/runtime';
/** The ONLY backend routes reachable through the front, with the exact status/body each may carry. */
export const HEALTH_ROUTES = new Map([
  ['/v1/health/live', { status: 'ok', accepted: [200] }],
  ['/v1/health/ready', { status: 'ready', accepted: [200, 503] }],
]);
/** Shorter than the 5 s limit of the app, so a silent backend ends as 504 from here and not as a timeout in the browser. */
export const UPSTREAM_TIMEOUT_MS = 4000;
const MAX_UPSTREAM_BYTES = 4096;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};
const SECURITY_HEADERS = {
  'content-security-policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; " +
    "base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
  'cache-control': 'no-store',
};

export class RuntimeStartError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * The identity of the build in `distDir`, or a RuntimeStartError. Reads the manifest and recomputes the fingerprint of the
 * folder: a folder that changed after its manifest was written is refused, so /__11ship/runtime never describes a build that
 * is not the one served.
 */
export function readBuildIdentity(distDir, app) {
  const runtime = CLIENT_RUNTIMES[app];
  if (runtime === undefined) {
    throw new RuntimeStartError('APP_UNKNOWN', `unknown app: ${String(app)}`);
  }
  const manifestPath = join(distDir, 'build-manifest.json');
  if (!existsSync(manifestPath)) {
    throw new RuntimeStartError('ARTIFACT_MISSING', 'the build has no build-manifest.json (run the build first)');
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    throw new RuntimeStartError('ARTIFACT_INVALID', 'build-manifest.json is not valid JSON');
  }
  const fingerprint = manifest?.build_fingerprint;
  const valid =
    typeof manifest === 'object' && manifest !== null &&
    manifest.app_id === app && manifest.mode === 'live' &&
    typeof manifest.source_sha === 'string' && /^[0-9a-f]{40}$/.test(manifest.source_sha) &&
    typeof fingerprint === 'string' && /^[0-9a-f]{64}$/.test(fingerprint) &&
    typeof manifest.design_version === 'string' && /^[0-9A-Za-z._-]{1,32}$/.test(manifest.design_version);
  if (!valid) {
    throw new RuntimeStartError('ARTIFACT_INVALID', `build-manifest.json is not a live build of ${app} (app, mode, source commit, fingerprint or design version)`);
  }
  if (artifactFingerprint(distDir) !== fingerprint) {
    throw new RuntimeStartError('ARTIFACT_CHANGED', 'the files of the build no longer match its manifest (build again)');
  }
  return {
    app_id: runtime.runtimeAppId,
    source_sha: manifest.source_sha,
    build_fingerprint: fingerprint,
    design_version: manifest.design_version,
    environment: 'development',
  };
}

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function sendJson(response, status, body, extra = {}) {
  response.writeHead(status, { ...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8', ...extra });
  response.end(JSON.stringify(body));
}

/** Same envelope shape as the backend's errors; the text is fixed, never the cause. */
function sendError(response, status, code, extra = {}) {
  sendJson(response, status, { error: { code, message: status === 404 ? 'Not found' : 'Service unavailable', request_id: '', details: {} } }, extra);
}

/**
 * @param {{ app: 'food-web' | 'ship-web', distDir: string, backendUrl: string, key: string | Buffer, cert: string | Buffer, upstreamTimeoutMs?: number }} options
 * @returns {import('node:https').Server}
 */
export function createClientWebServer({ app, distDir, backendUrl, key, cert, upstreamTimeoutMs = UPSTREAM_TIMEOUT_MS }) {
  const backend = new URL(backendUrl);
  if (backend.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(backend.hostname)) {
    throw new RuntimeStartError('BACKEND_NOT_LOOPBACK', 'the backend must be a loopback http URL (this front is for local use only)');
  }
  const distRoot = realpathSync(distDir);
  const identity = readBuildIdentity(distRoot, app);

  const server = https.createServer({ key, cert, minVersion: 'TLSv1.2' }, (request, response) => {
    // Loopback only, twice: the listener is bound to 127.0.0.1 and a peer that is not loopback is refused anyway; and the Host
    // must be this machine's name for this port, so a web page of another site cannot reach the front by DNS rebinding.
    if (!LOOPBACK_ADDRESSES.has(request.socket.remoteAddress ?? '')) {
      response.writeHead(403, { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8' });
      response.end('Forbidden');
      return;
    }
    const port = String(server.address()?.port ?? '');
    if (!['localhost', '127.0.0.1', '[::1]'].some((name) => request.headers.host === `${name}:${port}`)) {
      response.writeHead(421, { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8' });
      response.end('Misdirected request');
      return;
    }
    const url = new URL(request.url ?? '/', 'https://front.invalid');
    const route = HEALTH_ROUTES.get(url.pathname);
    if (url.pathname === RUNTIME_PATH || route !== undefined) {
      if (request.method !== 'GET') {
        response.writeHead(405, { ...SECURITY_HEADERS, allow: 'GET', 'content-type': 'text/plain; charset=utf-8' });
        response.end();
        return;
      }
      // Exact routes: no query string, no parameter, no trailing slash. Anything else is just "not found".
      if (url.search !== '' || (request.url ?? '') !== url.pathname) {
        sendError(response, 404, 'NOT_FOUND');
        return;
      }
      if (route === undefined) {
        sendJson(response, 200, { data: identity });
        return;
      }
      forwardHealth(request, response, backend, url.pathname, route, upstreamTimeoutMs);
      return;
    }
    if (url.pathname === '/v1' || url.pathname.startsWith('/v1/') || url.pathname.startsWith('/__11ship')) {
      // Not proxied and not a page: the rest of the backend is not reachable through this front.
      sendError(response, 404, 'NOT_FOUND');
      return;
    }
    serveStatic(url.pathname, request, response, distRoot);
  });
  server.identity = identity;
  return server;
}

/**
 * Forwards one health request. The upstream request is built here from scratch: GET, a fixed path, `Accept` and a fixed Host
 * only - never the browser's cookies, Authorization, Origin, forwarding headers or anything else. A single deadline covers the
 * whole exchange. The answer is released only if it is what the backend agreed to say: the right status, a JSON content type,
 * at most 4096 bytes, and (for 200) exactly {"data":{"status":"ok"|"ready"}}. Anything else is a 502, a silent backend a 504,
 * a refused connection a 502 - with a fixed body, never the cause.
 */
function forwardHealth(request, response, backend, path, route, timeoutMs) {
  let finished = false;
  let timer;
  const finish = () => {
    finished = true;
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  const noStore = { 'cache-control': 'no-store' };
  const fail = (status, code) => {
    if (finished) {
      return;
    }
    finish();
    upstream.destroy();
    if (!response.headersSent) {
      sendError(response, status, code, noStore);
    } else {
      response.destroy();
    }
  };
  const upstream = http.request(
    { hostname: backend.hostname.replace(/^\[|\]$/g, ''), port: backend.port || 80, method: 'GET', path, headers: { accept: 'application/json', host: backend.host, connection: 'close' } },
    (answer) => {
      const type = String(answer.headers['content-type'] ?? '');
      if (!route.accepted.includes(answer.statusCode ?? 0) || !/^application\/json\b/i.test(type)) {
        answer.resume();
        fail(502, 'BAD_GATEWAY');
        return;
      }
      const chunks = [];
      let size = 0;
      answer.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_UPSTREAM_BYTES) {
          fail(502, 'BAD_GATEWAY');
          return;
        }
        chunks.push(chunk);
      });
      answer.on('error', () => fail(502, 'BAD_GATEWAY'));
      answer.on('end', () => {
        if (finished) {
          return;
        }
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch {
          fail(502, 'BAD_GATEWAY');
          return;
        }
        const isObject = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
        const exact =
          isObject && Object.keys(parsed).length === 1 && typeof parsed.data === 'object' && parsed.data !== null &&
          Object.keys(parsed.data).length === 1 && parsed.data.status === route.status;
        // 200 must carry exactly the agreed body; the 503 of /ready may carry the backend's error envelope (any JSON object, not passed on).
        if ((answer.statusCode === 200 && !exact) || !isObject) {
          fail(502, 'BAD_GATEWAY');
          return;
        }
        finish();
        if (answer.statusCode === 200) {
          // Re-serialised from what was validated, not the bytes as they came.
          sendJson(response, 200, parsed, noStore);
        } else {
          // The 503 of /ready: the app only needs the status; the backend's text is not passed on.
          sendError(response, 503, 'SERVICE_UNAVAILABLE', noStore);
        }
      });
    },
  );
  timer = setTimeout(() => {
    timer = undefined;
    fail(504, 'GATEWAY_TIMEOUT');
  }, timeoutMs);
  upstream.on('error', () => fail(502, 'BAD_GATEWAY'));
  // The browser went away first: stop waiting for the backend.
  response.on('close', () => {
    if (!response.writableFinished) {
      finish();
      upstream.destroy();
    }
  });
  upstream.end();
}

function serveStatic(pathname, request, response, distRoot) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { ...SECURITY_HEADERS, allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' });
    response.end();
    return;
  }
  let relative;
  try {
    relative = decodeURIComponent(pathname);
  } catch {
    relative = '';
  }
  const refuse = () => {
    response.writeHead(404, { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  };
  if (relative === '' || relative.includes('\0') || relative.includes('\\')) {
    refuse();
    return;
  }
  // The page itself for the app's routes (no file extension): the browser decides what to show, the server never does.
  const isAppRoute = !extname(relative) || relative.endsWith('/');
  const wanted = relative === '/' || isAppRoute ? '/index.html' : relative;
  let file;
  try {
    file = realpathSync(normalize(join(distRoot, wanted)));
  } catch {
    file = undefined;
  }
  // Anything that resolves outside the build folder (symlink, traversal) is refused; build-manifest.json is part of the build (the app reads it, M00.04).
  if (file === undefined || (file !== distRoot && !file.startsWith(distRoot + sep)) || !statSync(file).isFile()) {
    refuse();
    return;
  }
  response.writeHead(200, { ...SECURITY_HEADERS, 'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream' });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  createReadStream(file).pipe(response);
}

/**
 * Starts the front for `app` from the process environment. Exit codes: 2 usage / configuration, 3 TLS, 4 build, 5 port in use.
 * Test-only overrides: CLIENT_WEB_PORT, CLIENT_WEB_BACKEND, CLIENT_WEB_DIST, CLIENT_WEB_TLS_CERT/KEY, CLIENT_WEB_UPSTREAM_TIMEOUT_MS.
 */
export function runClientWebDev(app, env = process.env) {
  const runtime = CLIENT_RUNTIMES[app];
  if (runtime === undefined) {
    console.error(`usage: client-web-dev <${Object.keys(CLIENT_RUNTIMES).join('|')}>`);
    process.exit(2);
  }
  const stop = (code, errorCode, message) => {
    console.error(`${runtime.name}: ${errorCode}: ${message}`);
    process.exit(code);
  };
  const port = Number(env.CLIENT_WEB_PORT ?? String(runtime.port));
  const upstreamTimeoutMs = Number(env.CLIENT_WEB_UPSTREAM_TIMEOUT_MS ?? String(UPSTREAM_TIMEOUT_MS));
  if (!Number.isInteger(port) || port < 0 || port > 65_535 || !Number.isSafeInteger(upstreamTimeoutMs) || upstreamTimeoutMs < 100) {
    stop(2, 'CONFIG_INVALID', 'CLIENT_WEB_PORT must be a port number and CLIENT_WEB_UPSTREAM_TIMEOUT_MS an integer >= 100');
  }
  const tls = defaultTlsPaths(root, env);
  const inspected = inspectTlsFiles(tls);
  if (!inspected.ok) {
    stop(3, inspected.code, `${inspected.message}. Set up the local certificate once: see ops/runbooks/local-https-runtime.md`);
  }
  const distDir = env.CLIENT_WEB_DIST ?? join(root, 'apps', app, 'dist');
  let server;
  try {
    server = createClientWebServer({
      app,
      distDir,
      backendUrl: env.CLIENT_WEB_BACKEND ?? 'http://127.0.0.1:3000',
      key: readFileSync(tls.key),
      cert: readFileSync(tls.cert),
      upstreamTimeoutMs,
    });
  } catch (error) {
    if (error instanceof RuntimeStartError) {
      stop(error.code.startsWith('ARTIFACT') ? 4 : 2, error.code, error.message);
    }
    throw error;
  }
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE' || error.code === 'EACCES') {
      stop(5, 'PORT_IN_USE', `port ${String(port)} is held by another process or not allowed`);
    }
    stop(1, 'SERVER_ERROR', String(error.code ?? 'unknown'));
  });
  server.listen(port, '127.0.0.1', () => {
    const actual = server.address().port;
    // One machine-readable line: the launcher and the tests read the port and identity from it.
    console.log(JSON.stringify({ event: 'listening', app, origin: `https://localhost:${String(actual)}`, port: actual, ...server.identity }));
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  return server;
}
