#!/usr/bin/env node
// Local HTTPS gateway for the PHONE apps (M01-ANDROID). LOCAL DEVELOPMENT AND TESTS ONLY - never deployed, never on the VPS.
//
// The phone apps sign the exact request bytes and the exact request target (contract11 section 8), and the existing web fronts
// (scripts/client-web-dev.mjs) are built for a browser: they re-read the body, forward only a Bearer/Idempotency-Key and know
// nothing of the device proof. This is the minimum for a phone: a loopback-HTTP backend behind a TLS listener that
//   * forwards EXACTLY this allowlist of method + path (no prefix, no wildcard, no query string, no other method):
//       GET  /v1/health/live, GET /v1/health/ready
//       GET  /v1/client-auth/config, GET /v1/client-auth/me, POST /v1/client-auth/{register,login,logout}
//       POST /v1/client-auth/device/{challenges,registrations}
//       GET  /v1/customer/me/profile, PUT /v1/customer/me/profile
//       Food shop:  GET/PUT /v1/onboarding/shop/profile, GET /v1/onboarding/shop/service-areas, POST /v1/onboarding/shop/complete,
//                   POST /v1/client-auth/context
//       Ship driver: GET /v1/driver/me, POST /v1/onboarding/driver
//       Test password reset (PUBLIC): GET /v1/account-recovery/config, POST /v1/account-recovery/reset-test - these two forward
//                   ONLY idempotency-key and content-type, never an authorization or device-proof header
//   * passes the BODY byte for byte and the TARGET unchanged (the proof signs both), and ONLY these request headers:
//       authorization, idempotency-key, content-type, x-device-registration, x-device-key-id, x-device-time, x-device-nonce,
//       x-device-signature  (no cookie, no x-forwarded-*, nothing else of the phone's headers);
//   * returns the backend answer with a small allowlist of headers (content-type, cache-control, retry-after, x-request-id,
//     x-device-binding-id, x-device-binding-generation) so the response can never carry a cookie or a server banner.
// It does not change the web fronts' semantics and opens no other backend route. TLS is normal verification on the phone side: the
// phone must trust this certificate (mobile/README.md); nothing here switches verification off.
//
//   NATIVE_GATEWAY_HOST      listen address (default 127.0.0.1; use the PC's LAN address, or keep loopback with `adb reverse`)
//   NATIVE_GATEWAY_PORT      default 8446
//   NATIVE_GATEWAY_BACKEND   loopback http URL of the API (default http://127.0.0.1:3000)
//   NATIVE_GATEWAY_TLS_CERT / NATIVE_GATEWAY_TLS_KEY   PEM files (default .local/native-gateway-tls/{cert,key}.pem, made by
//                            `node scripts/native-gateway-cert.mjs <lan-ip-or-host>`)
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_REQUEST_BYTES = 65_536;
export const MAX_RESPONSE_BYTES = 65_536;
export const UPSTREAM_TIMEOUT_MS = 12_000;

/** method + exact path. Anything else is a 404 from here, never forwarded. */
export const NATIVE_ROUTES = new Set([
  'GET /v1/health/live',
  'GET /v1/health/ready',
  'GET /v1/client-auth/config',
  'GET /v1/client-auth/me',
  'POST /v1/client-auth/register',
  'POST /v1/client-auth/login',
  'POST /v1/client-auth/logout',
  'POST /v1/client-auth/device/challenges',
  'POST /v1/client-auth/device/registrations',
  'GET /v1/customer/me/profile',
  'PUT /v1/customer/me/profile',
  'GET /v1/onboarding/shop/profile',
  'PUT /v1/onboarding/shop/profile',
  'GET /v1/onboarding/shop/service-areas',
  'POST /v1/onboarding/shop/complete',
  'POST /v1/client-auth/context',
  'GET /v1/driver/me',
  'POST /v1/onboarding/driver',
  'GET /v1/account-recovery/config',
  'POST /v1/account-recovery/reset-test',
]);

/** Public routes: the phone's session and device headers are dropped (a reset must not depend on, or leak, a session). */
export const PUBLIC_ROUTES = new Set(['GET /v1/account-recovery/config', 'POST /v1/account-recovery/reset-test']);
export const PUBLIC_FORWARDED_REQUEST_HEADERS = ['idempotency-key', 'content-type'];

export const FORWARDED_REQUEST_HEADERS = [
  'authorization',
  'idempotency-key',
  'content-type',
  'x-device-registration',
  'x-device-key-id',
  'x-device-time',
  'x-device-nonce',
  'x-device-signature',
];

export const RETURNED_RESPONSE_HEADERS = ['content-type', 'cache-control', 'retry-after', 'x-request-id', 'x-device-binding-id', 'x-device-binding-generation'];

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

function notFound(response) {
  response.writeHead(404, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found', request_id: '', details: {} } }));
}

function unavailable(response, status = 503) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify({ error: { code: status === 413 ? 'PAYLOAD_TOO_LARGE' : 'SERVICE_UNAVAILABLE', message: 'Service unavailable', request_id: '', details: {} } }));
}

/**
 * @param {{ backendUrl: string, key: string | Buffer, cert: string | Buffer, upstreamTimeoutMs?: number }} options
 * @returns {import('node:https').Server}
 */
export function createNativeGateway({ backendUrl, key, cert, upstreamTimeoutMs = UPSTREAM_TIMEOUT_MS }) {
  const backend = new URL(backendUrl);
  if (backend.protocol !== 'http:' || !LOOPBACK.has(backend.hostname)) {
    throw new Error('the backend must be a loopback http URL (this gateway is for local use only)');
  }
  return https.createServer({ key, cert, minVersion: 'TLSv1.2' }, (request, response) => {
    const target = request.url ?? '';
    // The exact path with no query string: the signed target is this very string.
    if (!NATIVE_ROUTES.has(`${request.method} ${target}`)) {
      request.resume();
      notFound(response);
      return;
    }
    const declared = Number(request.headers['content-length'] ?? 0);
    if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
      request.resume();
      unavailable(response, 413);
      return;
    }
    const chunks = [];
    let size = 0;
    let aborted = false;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES && !aborted) {
        aborted = true;
        unavailable(response, 413);
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (aborted) {
        return;
      }
      const body = Buffer.concat(chunks);
      const headers = {};
      for (const name of PUBLIC_ROUTES.has(`${request.method} ${target}`) ? PUBLIC_FORWARDED_REQUEST_HEADERS : FORWARDED_REQUEST_HEADERS) {
        const value = request.headers[name];
        if (typeof value === 'string') {
          headers[name] = value;
        }
      }
      if (body.length > 0 || request.method !== 'GET') {
        headers['content-length'] = String(body.length);
      }
      const upstream = http.request(
        { host: backend.hostname === 'localhost' ? '127.0.0.1' : backend.hostname.replace(/^\[|\]$/g, ''), port: backend.port || 80, method: request.method, path: target, headers },
        (answer) => {
          const parts = [];
          let received = 0;
          answer.on('data', (chunk) => {
            received += chunk.length;
            if (received > MAX_RESPONSE_BYTES) {
              answer.destroy();
              return;
            }
            parts.push(chunk);
          });
          answer.on('end', () => {
            if (received > MAX_RESPONSE_BYTES) {
              unavailable(response, 502);
              return;
            }
            const out = { 'cache-control': 'no-store' };
            for (const name of RETURNED_RESPONSE_HEADERS) {
              const value = answer.headers[name];
              if (typeof value === 'string') {
                out[name] = value;
              }
            }
            response.writeHead(answer.statusCode ?? 502, out);
            response.end(Buffer.concat(parts));
          });
        },
      );
      upstream.setTimeout(upstreamTimeoutMs, () => upstream.destroy());
      upstream.on('error', () => {
        if (!response.headersSent) {
          unavailable(response, 504);
        } else {
          response.destroy();
        }
      });
      upstream.end(body);
    });
  });
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const certPath = process.env.NATIVE_GATEWAY_TLS_CERT ?? join(root, '.local', 'native-gateway-tls', 'cert.pem');
  const keyPath = process.env.NATIVE_GATEWAY_TLS_KEY ?? join(root, '.local', 'native-gateway-tls', 'key.pem');
  const host = process.env.NATIVE_GATEWAY_HOST ?? '127.0.0.1';
  const port = Number(process.env.NATIVE_GATEWAY_PORT ?? 8446);
  const server = createNativeGateway({
    backendUrl: process.env.NATIVE_GATEWAY_BACKEND ?? 'http://127.0.0.1:3000',
    key: readFileSync(keyPath),
    cert: readFileSync(certPath),
  });
  server.listen(port, host, () => {
    console.log(`native gateway: https://${host}:${String(port)} -> ${process.env.NATIVE_GATEWAY_BACKEND ?? 'http://127.0.0.1:3000'} (${String(NATIVE_ROUTES.size)} routes, local test only)`);
  });
}
