import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { diagnosticsReport } from '../../apps/client-shared/src/connection';
import { HealthMonitor, HealthSnapshot } from '../../apps/client-shared/src/health';
import { configWithDatabaseUrl, loadIntegrationConfig, RunningApp, startApp } from './support/test-helpers';

// M00.04 — the connection state of the phone apps (apps/client-shared/src/health.ts) against the REAL backend: the real Nest
// application on a real HTTP listener, with the real PostgreSQL of the integration job. Nothing here is faked: these are the
// answers /v1/health/live and /v1/health/ready really give, read by the same code the apps run. (Controlled failures such as
// timeouts, wrong bodies and dropped connections are provoked in tests/client-shell/health.test.mjs and in the browser test.)

function monitorFor(baseUrl: string): HealthMonitor {
  return new HealthMonitor({ fetch, baseUrl });
}

function report(snapshot: HealthSnapshot, origin: string): string {
  return diagnosticsReport('11Food', { health: snapshot, build: { kind: 'unavailable' }, origin });
}

describe('M00.04 — client health against the real backend, PostgreSQL available', () => {
  let running: RunningApp;

  beforeAll(async () => {
    running = await startApp(loadIntegrationConfig());
  });

  afterAll(async () => {
    await running.app.close();
  });

  it('live answers 200 {"data":{"status":"ok"}} and ready answers 200 {"data":{"status":"ready"}}: the app shows ready', async () => {
    const snapshot = await monitorFor(running.baseUrl).check();
    expect(snapshot.phase).toBe('ready');
    expect(snapshot.live).toMatchObject({ state: 'ok', httpStatus: 200 });
    expect(snapshot.ready).toMatchObject({ state: 'ok', httpStatus: 200 });
    expect(snapshot.lastCheckedAt).toBeGreaterThan(0);
  });

  it('a new check replaces the old result and ends ready again (retry)', async () => {
    const monitor = monitorFor(running.baseUrl);
    const phases: string[] = [];
    monitor.subscribe((state) => phases.push(state.phase));
    await monitor.check();
    await monitor.check();
    expect(phases[0]).toBe('checking');
    expect(phases.filter((phase) => phase === 'checking').length).toBeGreaterThanOrEqual(2);
    expect(phases.at(-1)).toBe('ready');
  });
});

describe('M00.04 — client health against the real backend, PostgreSQL unreachable', () => {
  const SECRET = 'SECRET_MARKER_M0004_7c1e';
  let running: RunningApp;

  beforeAll(async () => {
    // Port 1 is closed, so the connection is refused; the HTTP server still starts (liveness never touches the database).
    running = await startApp(configWithDatabaseUrl(loadIntegrationConfig(), `postgres://ship11_test:${SECRET}@127.0.0.1:1/ship11_test`));
  });

  afterAll(async () => {
    await running.app.close();
  });

  it('live is ok, ready answers 503: "backend not ready", within the 5 second limit, and no connection detail reaches the result', async () => {
    const startedAt = performance.now();
    const snapshot = await monitorFor(running.baseUrl).check();
    expect(performance.now() - startedAt).toBeLessThan(5000);
    expect(snapshot.phase).toBe('backend_not_ready');
    expect(snapshot.live).toMatchObject({ state: 'ok', httpStatus: 200 });
    expect(snapshot.ready).toMatchObject({ state: 'failed', reason: 'NOT_READY', httpStatus: 503 });
    for (const text of [JSON.stringify(snapshot), report(snapshot, running.baseUrl)]) {
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain('postgres://');
      expect(text).not.toContain('ship11_test'); // the database user/name of the configured URL
    }
  });
});

describe('M00.04 — client health against the real backend, backend stopped', () => {
  it('a server that is not listening any more is reported as offline, never as ready', async () => {
    const running = await startApp(loadIntegrationConfig());
    const { baseUrl } = running;
    expect((await monitorFor(baseUrl).check()).phase).toBe('ready');
    await running.app.close();
    const snapshot = await monitorFor(baseUrl).check();
    expect(snapshot.phase).toBe('offline');
    expect(snapshot.live).toMatchObject({ state: 'failed', reason: 'OFFLINE' });
    expect(snapshot.ready).toMatchObject({ state: 'skipped' });
  });
});
