import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freePort, runScript, startFront } from './support/admin-web-harness';

// M01-D-LOGIN-UI - communication timeout of the local HTTPS front (scripts/admin-web-dev.mjs), run as its own process.
// The "backend" here is a FAULT-INJECTION server owned by this test (it never answers, stalls a body, or answers at
// once), because a real backend cannot be made to hang on demand. The real backend is exercised by the browser spec.
// The upstream timeout is shortened to 600 ms for the test; the default is 15 s.

const TIMEOUT_MS = 600;

interface UpstreamEvent {
  readonly path: string;
  readonly headers: http.IncomingHttpHeaders;
  closedAt?: number;
  readonly receivedAt: number;
}

describe('M01-D-LOGIN-UI - local HTTPS front: upstream timeout and cleanup', () => {
  let upstream: http.Server;
  let front: ChildProcess | undefined;
  let tlsDir: string;
  let ca: Buffer;
  let port: number;
  const events: UpstreamEvent[] = [];

  beforeAll(async () => {
    runScript('admin-web-build.mjs');
    tlsDir = mkdtempSync(join(tmpdir(), 'admin-web-proxy-tls-'));
    runScript('admin-web-cert.mjs', [tlsDir, '1']);
    ca = readFileSync(join(tlsDir, 'cert.pem'));

    upstream = http.createServer((request, response) => {
      const event: UpstreamEvent = { path: request.url ?? '', headers: request.headers, receivedAt: Date.now() };
      events.push(event);
      request.socket.on('close', () => {
        event.closedAt = Date.now();
      });
      if (event.path.endsWith('/state')) {
        return; // never answers: no status line, no headers
      }
      if (event.path.endsWith('/me')) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.write('{"data":'); // headers and part of a body, then silence
        return;
      }
      if (event.path.endsWith('/logout')) {
        return; // the browser goes away before this answers
      }
      response.writeHead(200, { 'content-type': 'application/json', 'set-cookie': '__Host-x=1; Path=/; Secure; HttpOnly' });
      response.end('{"data":{"ok":true}}');
    });
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));

    port = await freePort();
    front = await startFront({
      ADMIN_WEB_PORT: String(port),
      ADMIN_WEB_HOST: 'localhost',
      ADMIN_WEB_BACKEND: `http://127.0.0.1:${String((upstream.address() as AddressInfo).port)}`,
      ADMIN_WEB_TLS_CERT: join(tlsDir, 'cert.pem'),
      ADMIN_WEB_TLS_KEY: join(tlsDir, 'key.pem'),
      ADMIN_WEB_UPSTREAM_TIMEOUT_MS: String(TIMEOUT_MS),
    });
  }, 120_000);

  afterAll(async () => {
    front?.kill('SIGTERM');
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    rmSync(tlsDir, { recursive: true, force: true });
  });

  interface Outcome {
    status?: number;
    headers?: http.IncomingHttpHeaders;
    body?: string;
    error?: string;
    ms: number;
  }

  function call(method: 'GET' | 'POST', path: string, options: { headers?: Record<string, string>; abortAfterMs?: number } = {}): Promise<Outcome> {
    const started = Date.now();
    return new Promise((resolve) => {
      const request = https.request(
        { host: '127.0.0.1', servername: 'localhost', port, method, path, ca, headers: { origin: `https://localhost:${String(port)}`, ...options.headers } },
        (response) => {
          let body = '';
          response.on('data', (chunk: Buffer) => {
            body += chunk.toString('utf8');
          });
          response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body, ms: Date.now() - started }));
          response.on('aborted', () => resolve({ status: response.statusCode, error: 'aborted', ms: Date.now() - started }));
          response.on('error', (error: NodeJS.ErrnoException) => resolve({ status: response.statusCode, error: error.code ?? error.message, ms: Date.now() - started }));
        },
      );
      request.on('error', (error: NodeJS.ErrnoException) => resolve({ error: error.code ?? error.message, ms: Date.now() - started }));
      if (options.abortAfterMs !== undefined) {
        setTimeout(() => {
          request.destroy();
          resolve({ error: 'client-aborted', ms: Date.now() - started });
        }, options.abortAfterMs);
      }
      request.end();
    });
  }

  async function upstreamClosed(path: string): Promise<UpstreamEvent> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const event = events.find((candidate) => candidate.path === path);
      if (event?.closedAt !== undefined) {
        return event;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`upstream connection for ${path} was never closed`);
  }

  it('a backend that never answers: 504 with the unavailable envelope at the deadline, and the upstream connection is closed', async () => {
    const outcome = await call('GET', '/v1/admin-auth/state');
    expect(outcome.status).toBe(504);
    expect(JSON.parse(outcome.body ?? '{}')).toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } });
    expect(outcome.ms).toBeGreaterThanOrEqual(TIMEOUT_MS - 50);
    expect(outcome.ms).toBeLessThan(TIMEOUT_MS + 3_000);
    const event = await upstreamClosed('/v1/admin-auth/state');
    expect((event.closedAt ?? 0) - event.receivedAt).toBeLessThan(TIMEOUT_MS + 3_000);
  });

  it('a body that stalls after the headers: the browser connection is cut at the deadline (no endless wait), upstream closed', async () => {
    const outcome = await call('GET', '/v1/admin-auth/me');
    expect(outcome.status).toBe(200);
    expect(outcome.error).toBeDefined();
    expect(outcome.ms).toBeLessThan(TIMEOUT_MS + 3_000);
    await upstreamClosed('/v1/admin-auth/me');
  });

  it('the browser goes away first: the upstream request is destroyed, not left waiting for the deadline', async () => {
    const outcome = await call('POST', '/v1/admin-auth/logout', { headers: { 'content-type': 'application/json' }, abortAfterMs: 100 });
    expect(outcome.error).toBe('client-aborted');
    const event = await upstreamClosed('/v1/admin-auth/logout');
    expect((event.closedAt ?? 0) - event.receivedAt).toBeLessThan(TIMEOUT_MS);
  });

  it('a normal answer passes through unchanged (Set-Cookie kept); client forwarding headers are not passed on', async () => {
    const outcome = await call('GET', '/v1/admin-auth/other', { headers: { 'x-forwarded-for': '203.0.113.9', forwarded: 'for=203.0.113.9' } });
    expect(outcome.status).toBe(200);
    expect(outcome.body).toBe('{"data":{"ok":true}}');
    expect(outcome.headers?.['set-cookie']).toEqual(['__Host-x=1; Path=/; Secure; HttpOnly']);
    const event = events.find((candidate) => candidate.path === '/v1/admin-auth/other');
    expect(event?.headers['x-forwarded-for']).toBeUndefined();
    expect(event?.headers.forwarded).toBeUndefined();
    expect(event?.headers.origin).toBe(`https://localhost:${String(port)}`);
  });

  it('only /v1/admin-auth/* reaches the backend', async () => {
    const before = events.length;
    const outcome = await call('GET', '/v1/health');
    expect(outcome.status).toBe(404);
    expect(events.length).toBe(before);
  });
});
