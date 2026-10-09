// Serves apps/web and forwards /v1/* to the backend, so the page and the API share ONE origin (the backend has no
// CORS, and the client keeps its token in memory only). Node built-ins only: no dependency, no build step.
//
//   WEB_API_ORIGIN  where /v1 goes (default http://127.0.0.1:3000)
//   WEB_PORT        default 5173
//   WEB_HOST        default 127.0.0.1. Use 0.0.0.0 only to open the page from a phone on the same network; plain http
//                   over a LAN address is not a secure context, so browser geolocation is unavailable there.
//
// It never logs a header, a body or a query string, and it holds no credential of any kind.

import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../apps/web/', import.meta.url)));
const MAX_PROXY_BODY = 1_000_000;
const UPSTREAM_TIMEOUT_MS = 30_000;

// Only what the page needs is ever served (an allowlist of extensions): package.json, READMEs and the like are not.
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length']);

const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function securityHeaders(extra = {}) {
  return {
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    ...extra,
  };
}

export function parseApiOrigin(value) {
  const url = new URL(value);
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('WEB_API_ORIGIN must be an http(s) origin without credentials, path or query');
  }
  return url;
}

function unavailable(res) {
  const body = JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Service unavailable', request_id: randomUUID(), details: {} } });
  res.writeHead(503, securityHeaders({ 'Content-Type': 'application/json; charset=utf-8' }));
  res.end(body);
}

function proxy(req, res, upstream) {
  const chunks = [];
  let size = 0;
  let tooLarge = false;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_PROXY_BODY) {
      tooLarge = true;
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (tooLarge) {
      res.writeHead(413, securityHeaders({ 'Content-Type': 'application/json; charset=utf-8' }));
      res.end(JSON.stringify({ error: { code: 'CLIENT_ERROR', message: 'Client error', request_id: randomUUID(), details: {} } }));
      return;
    }
    const body = Buffer.concat(chunks);
    const headers = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (!HOP_BY_HOP.has(name) && name !== 'cookie' && name !== 'origin' && name !== 'referer') {
        headers[name] = value;
      }
    }
    if (body.length > 0) {
      headers['content-length'] = String(body.length);
    }
    const send = upstream.protocol === 'https:' ? httpsRequest : httpRequest;
    const outgoing = send(
      {
        protocol: upstream.protocol,
        hostname: upstream.hostname,
        port: upstream.port || undefined,
        method: req.method,
        path: req.url,
        headers,
        timeout: UPSTREAM_TIMEOUT_MS,
      },
      (incoming) => {
        const responseHeaders = {};
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (!HOP_BY_HOP.has(name) && name !== 'set-cookie') {
            responseHeaders[name] = value;
          }
        }
        res.writeHead(incoming.statusCode ?? 502, securityHeaders(responseHeaders));
        incoming.pipe(res);
      },
    );
    outgoing.on('timeout', () => outgoing.destroy());
    outgoing.on('error', () => {
      if (!res.headersSent) {
        unavailable(res);
      } else {
        res.destroy();
      }
    });
    outgoing.end(body);
  });
}

async function serveStatic(req, res) {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const target = normalize(join(ROOT, relative));
  if (target !== ROOT && !target.startsWith(ROOT + sep)) {
    res.writeHead(404, securityHeaders());
    res.end();
    return;
  }
  try {
    const type = MIME[extname(target)];
    const info = await stat(target);
    if (type === undefined || !info.isFile()) {
      throw new Error('not served');
    }
    res.writeHead(200, securityHeaders({ 'Content-Type': type, 'Content-Length': info.size }));
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(target).pipe(res);
  } catch {
    res.writeHead(404, securityHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }));
    res.end('Not found');
  }
}

export function createWebServer({ apiOrigin }) {
  const upstream = typeof apiOrigin === 'string' ? parseApiOrigin(apiOrigin) : apiOrigin;
  return createServer((req, res) => {
    const url = req.url ?? '/';
    if (url === '/v1' || url.startsWith('/v1/') || url.startsWith('/v1?')) {
      proxy(req, res, upstream);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, securityHeaders({ Allow: 'GET, HEAD' }));
      res.end();
      return;
    }
    serveStatic(req, res).catch(() => {
      res.writeHead(500, securityHeaders());
      res.end();
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const apiOrigin = process.env.WEB_API_ORIGIN ?? 'http://127.0.0.1:3000';
  const port = Number(process.env.WEB_PORT ?? 5173);
  const host = process.env.WEB_HOST ?? '127.0.0.1';
  const server = createWebServer({ apiOrigin });
  server.listen(port, host, () => {
    process.stdout.write(`11Ship web: http://${host}:${port}/  (API ${new URL(apiOrigin).origin} via /v1)\n`);
  });
}
