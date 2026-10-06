import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Client } from 'pg';
import {
  configWithDatabaseUrl,
  loadIntegrationConfig,
  RunningApp,
  startApp,
  UUID_PATTERN,
  withDatabaseName,
} from './support/test-helpers';

interface ErrorEnvelope {
  error: { code: string; message: string; request_id: string; details: unknown };
}

describe('F02a — health endpoints with PostgreSQL available', () => {
  let running: RunningApp;

  beforeAll(async () => {
    running = await startApp(loadIntegrationConfig());
  });

  afterAll(async () => {
    await running.app.close();
  });

  it('GET /v1/health/live returns 200 {"data":{"status":"ok"}}', async () => {
    const response = await fetch(`${running.baseUrl}/v1/health/live`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { status: 'ok' } });
  });

  it('GET /v1/health/ready returns 200 {"data":{"status":"ready"}}', async () => {
    const response = await fetch(`${running.baseUrl}/v1/health/ready`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { status: 'ready' } });
  });

  it('answers with a server-generated X-Request-ID', async () => {
    const response = await fetch(`${running.baseUrl}/v1/health/live`);
    expect(response.headers.get('x-request-id')).toMatch(UUID_PATTERN);
  });
});

describe('F02b — health endpoints with an unreachable database', () => {
  const SECRET = 'SECRET_MARKER_F02B_4d9e';
  let running: RunningApp;

  beforeAll(async () => {
    // Port 1 is closed, so the connection is refused. The password is a marker that must never
    // appear in a response or a log line. The HTTP server must still start.
    running = await startApp(
      configWithDatabaseUrl(
        loadIntegrationConfig(),
        `postgres://ship11_test:${SECRET}@127.0.0.1:1/ship11_test`,
      ),
    );
  });

  afterAll(async () => {
    await running.app.close();
  });

  it('keeps liveness at 200 while the database is down', async () => {
    const response = await fetch(`${running.baseUrl}/v1/health/live`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { status: 'ok' } });
  });

  it('answers readiness with 503 within 3 seconds and exposes no connection details', async () => {
    const startedAt = performance.now();
    const response = await fetch(`${running.baseUrl}/v1/health/ready`);
    const elapsedMs = performance.now() - startedAt;
    const text = await response.text();
    const body = JSON.parse(text) as ErrorEnvelope;

    expect(response.status).toBe(503);
    expect(elapsedMs).toBeLessThan(3000);
    expect(body).toEqual({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service unavailable',
        request_id: response.headers.get('x-request-id'),
        details: {},
      },
    });

    for (const forbidden of [SECRET, '127.0.0.1', 'postgres://', 'ship11_test', 'SELECT']) {
      expect(text).not.toContain(forbidden);
    }
    const logText = running.logs.join('\n');
    for (const forbidden of [SECRET, '127.0.0.1', 'postgres://', 'ship11_test']) {
      expect(logText).not.toContain(forbidden);
    }
  });
});

describe('F08 — error envelope and secret handling', () => {
  let running: RunningApp;

  beforeAll(async () => {
    running = await startApp(loadIntegrationConfig());
  });

  afterAll(async () => {
    await running.app.close();
  });

  it('returns the 404 NOT_FOUND envelope for an unknown route under /v1', async () => {
    const response = await fetch(`${running.baseUrl}/v1/does-not-exist`);
    const body = (await response.json()) as ErrorEnvelope;
    const headerId = response.headers.get('x-request-id');

    expect(response.status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toBe('Not found');
    expect(body.error.details).toEqual({});
    expect(body.error.request_id).toMatch(UUID_PATTERN);
    expect(body.error.request_id).toBe(headerId);
  });

  it('returns the same envelope for an unknown route outside the prefix', async () => {
    const response = await fetch(`${running.baseUrl}/does-not-exist`);
    const body = (await response.json()) as ErrorEnvelope;

    expect(response.status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.request_id).toBe(response.headers.get('x-request-id'));
  });

  it('never reflects a client-supplied X-Request-ID into the response or the logs', async () => {
    const response = await fetch(`${running.baseUrl}/v1/does-not-exist`, {
      headers: { 'X-Request-ID': 'client-controlled-<script>' },
    });
    const text = await response.text();

    expect(response.headers.get('x-request-id')).toMatch(UUID_PATTERN);
    expect(text).not.toContain('client-controlled');
    expect(running.logs.join('\n')).not.toContain('client-controlled');
  });

  it('does not leak a secret that the PostgreSQL server itself puts in its error message', async () => {
    // The server echoes the requested database name in its "does not exist" error. Using a marker
    // as the name gives a real database error that contains a secret-looking value.
    const MARKER = 'SECRETMARK_F08';
    const missingDatabaseUrl = withDatabaseName(
      loadIntegrationConfig().database.url,
      `probe_${MARKER}`,
    );

    // Precondition: prove the driver error really contains the marker, otherwise the test means nothing.
    const probe = new Client({ connectionString: missingDatabaseUrl, connectionTimeoutMillis: 3000 });
    let driverMessage = '';
    try {
      await probe.connect();
    } catch (error) {
      driverMessage = error instanceof Error ? error.message : '';
    } finally {
      await probe.end().catch(() => undefined);
    }
    expect(driverMessage).toContain(MARKER);

    const failing = await startApp(
      configWithDatabaseUrl(loadIntegrationConfig(), missingDatabaseUrl),
    );
    try {
      const response = await fetch(`${failing.baseUrl}/v1/health/ready`);
      const text = await response.text();
      const body = JSON.parse(text) as ErrorEnvelope;

      expect(response.status).toBe(503);
      expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
      expect(body.error.request_id).toBe(response.headers.get('x-request-id'));
      expect(text).not.toContain(MARKER);
      expect(failing.logs.join('\n')).not.toContain(MARKER);
    } finally {
      await failing.app.close();
    }
  });
});
