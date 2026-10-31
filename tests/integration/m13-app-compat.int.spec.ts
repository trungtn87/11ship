import { randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { OpsCollector } from '../../apps/backend/src/ops/ops-collector';
import { APP_COMPAT_MATRIX, CompatMatrix } from '../../apps/backend/src/ops/ops-compat';
import { OPS_DISCORD_CLIENT } from '../../apps/backend/src/ops/ops-discord';
import { HostSnapshot, HttpProbeResult, OPS_SYSTEM_PROBE, OpsSystemProbe } from '../../apps/backend/src/ops/ops-system-probe';
import { AdminApp, adminData, adminErrorCode, AdminResponse, sessionCookies, startAdminApp } from './support/admin-fixtures';
import { api, dataOf } from './support/auth-fixtures';
import { systemSession, SystemSession } from './support/provisioning-fixtures';

// #193 on a REAL PostgreSQL and the real administration pipeline: the backend demands SHIP >= 30 (FOOD has no raised minimum). What a phone is told, what the
// deploy preflight reads, what the operations check says and what SYSTEM may withdraw all come from the same matrix. Discord and the host probes are stand-ins.

const MATRIX: CompatMatrix = {
  contractRevision: 7,
  components: { FOOD: { minClientVersionCode: 1, reason: null }, SHIP: { minClientVersionCode: 30, reason: 'Cần bản mới để nhận đơn đúng cách' } },
};

class StubProbe implements OpsSystemProbe {
  self: HttpProbeResult = { ok: true, status: 200, latencyMs: 4, code: null };
  cpuPercent(): number | null { return 10; }
  hostSnapshot(): HostSnapshot {
    return {
      sampledAtMs: Date.now(), uptimeSeconds: 1000, cpuPercent: 10, cpuCores: 2, loadAvg: [0.5, 0.4, 0.3],
      memory: { totalBytes: 1000, availableBytes: 800, usedBytes: 200, usedPercent: 20 }, swap: { totalBytes: 100, usedBytes: 10, usedPercent: 10 },
      disks: [{ label: 'root', path: '/', totalBytes: 1000, freeBytes: 500, usedBytes: 500, usedPercent: 50 }], io: { readBytes: 1, writeBytes: 2 },
      network: { rxBytesTotal: 10, txBytesTotal: 20, rxBytesPerSec: 5, txBytesPerSec: 6 },
      processesByCpu: [{ pid: 1, name: 'node', cpuPercent: 3, rssBytes: 100, memoryPercent: 10 }], processesByMemory: [{ pid: 1, name: 'node', cpuPercent: 3, rssBytes: 100, memoryPercent: 10 }],
      backend: { pid: 1, uptimeSeconds: 10, rssBytes: 100, heapUsedBytes: 50, cpuPercent: 1 },
    };
  }
  memoryPercent(): number | null { return 20; }
  diskPercent(): number | null { return 50; }
  async selfHealth(): Promise<HttpProbeResult> { return this.self; }
  async get(): Promise<HttpProbeResult> { return this.self; }
  async certDaysLeft(): Promise<number | null> { return 100; }
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('#193 — APK–backend compatibility', () => {
  let admin: AdminApp;
  let system: SystemSession;
  let artifactDir: string;
  let collector: OpsCollector;

  const login = () => ({ cookie: system.login.cookie, csrf: system.login.csrf });
  async function apost(p: string, body: unknown): Promise<AdminResponse> {
    await admin.clearLimits();
    return admin.call('POST', `/ops${p}`, { basePath: '/v1/admin', body, cookies: sessionCookies(login()), csrf: login().csrf, headers: { 'idempotency-key': randomUUID() } });
  }
  const check = (component: string, code: number) => api(admin.running.baseUrl, 'GET', `/app-updates/check?component=${component}&version_code=${code}`);
  const apk = (name: string, text: string): string => {
    writeFileSync(path.join(artifactDir, name), Buffer.from(text));
    return createHash('sha256').update(Buffer.from(text)).digest('hex');
  };
  const body = (o: Json = {}): Json => ({ component: 'SHIP', version_name: '1.1.0', version_code: 40, release_notes: 'Bản mới', artifact_name: 'ship-40.apk', priority: 'RECOMMENDED', has_db_migration: false, ...o });
  async function publish(o: Json): Promise<Json> {
    const rel = adminData(await apost('/releases', body(o))) as Json;
    const pub = await apost(`/releases/${rel.release_id}/publish`, { expected_version: rel.version });
    expect(pub.status).toBe(200);
    return adminData(pub) as Json;
  }
  async function wipe(): Promise<void> {
    const client = await admin.pool.connect();
    try {
      await client.query(`SET app.ops_purge = 'on'`);
      await client.query('UPDATE app.ops_incidents SET reopens_incident_id = NULL');
      for (const t of ['ops_events', 'ops_notifications', 'ops_incidents', 'ops_checks', 'ops_metrics', 'ops_releases']) {
        await client.query(`DELETE FROM app.${t}`);
      }
    } finally {
      client.release();
    }
  }

  beforeAll(async () => {
    artifactDir = mkdtempSync(path.join(tmpdir(), 'm13-compat-'));
    admin = await startAdminApp({
      activationDisabledTest: true,
      overrides: [
        { provide: OPS_SYSTEM_PROBE, useValue: new StubProbe() },
        { provide: OPS_DISCORD_CLIENT, useValue: { post: async () => ({ ok: true, status: 204 }) } },
        { provide: APP_COMPAT_MATRIX, useValue: MATRIX },
      ],
      configOverride: { ops: { diskPaths: [{ label: 'root', path: '/' }], backendVersion: '1.0.0', collectorEnabled: false, artifactDir } },
    });
    system = await systemSession(admin);
    collector = admin.running.app.get(OpsCollector as never, { strict: false }) as OpsCollector;
    await wipe();
  });

  afterAll(async () => {
    await wipe();
    rmSync(artifactDir, { recursive: true, force: true });
    await admin.close();
  });

  it('the backend demands a build nobody can download: the phone is told so (never "up to date") and SYSTEM gets a critical incident', async () => {
    const ship = dataOf(await check('SHIP', 20));
    expect(ship).toMatchObject({ status: 'UPDATE_REQUIRED_UNAVAILABLE', compatible: false, required: true, update_available: false, release: null, min_supported_version_code: 30, contract_revision: 7, reason: 'Cần bản mới để nhận đơn đúng cách' });
    // FOOD is independent: its own minimum is untouched.
    expect(dataOf(await check('FOOD', 5))).toMatchObject({ status: 'COMPATIBLE', required: false, update_available: false });
    expect(dataOf(await check('SHIP', 35))).toMatchObject({ status: 'COMPATIBLE', required: false });
    const view = dataOf(await api(admin.running.baseUrl, 'GET', '/app-updates/compatibility')) as Json;
    expect(view).toMatchObject({ contract_revision: 7, components: { SHIP: { min_client_version_code: 30, published_version_code: null, satisfied: false, artifact_ready: false }, FOOD: { min_client_version_code: 1 } } });
    await collector.collectOnce();
    const incidents = (await admin.pool.query(`SELECT severity, status FROM app.ops_incidents WHERE check_key = 'app_compat.ship'`)).rows as Json[];
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ severity: 'CRITICAL' });
    expect((await admin.pool.query(`SELECT 1 FROM app.ops_incidents WHERE check_key = 'app_compat.food'`)).rowCount).toBe(0);
  });

  it('an APK below the minimum does not count; a published, downloadable one at or above it turns the answer into a required update with a link', async () => {
    apk('ship-25.apk', 'LOW');
    await publish({ version_name: '0.9.0', version_code: 25, artifact_name: 'ship-25.apk' });
    expect(dataOf(await check('SHIP', 20))).toMatchObject({ status: 'UPDATE_REQUIRED_UNAVAILABLE', release: null, update_available: false });
    const sha = apk('ship-40.apk', 'APK-FORTY');
    await publish({});
    const required = dataOf(await check('SHIP', 20));
    expect(required).toMatchObject({ status: 'UPDATE_REQUIRED', required: true, update_available: true, latest_version_code: 40, release: { version_code: 40, sha256: sha, size_bytes: 9 } });
    // At or above the minimum a newer build is only advice.
    expect(dataOf(await check('SHIP', 35))).toMatchObject({ status: 'UPDATE_OPTIONAL', required: false, update_available: true });
    expect(dataOf(await check('SHIP', 40))).toMatchObject({ status: 'COMPATIBLE', update_available: false });
    const dl = await fetch(`${admin.running.baseUrl}${(required.release as Json).download_path}`);
    expect(dl.status).toBe(200);
    expect(dl.headers.get('x-checksum-sha256')).toBe(sha);
    const view = dataOf(await api(admin.running.baseUrl, 'GET', '/app-updates/compatibility')) as Json;
    expect(view.components.SHIP).toMatchObject({ published_version_code: 40, artifact_ready: true, satisfied: true });
    const releases = adminData(await admin.call('GET', '/ops/releases', { basePath: '/v1/admin', cookies: sessionCookies(login()) })) as Json;
    expect((releases.components as Json[]).find((c) => c.component === 'SHIP')!.compatibility).toMatchObject({ ok: true, min_client_version_code: 30, contract_revision: 7 });
    await collector.collectOnce();
    expect((await admin.pool.query(`SELECT status FROM app.ops_incidents WHERE check_key = 'app_compat.ship' ORDER BY created_at DESC LIMIT 1`)).rows[0]).toMatchObject({ status: 'RECOVERED' });
  });

  it('a release file that disappears is not offered any more and SYSTEM is told', async () => {
    unlinkSync(path.join(artifactDir, 'ship-40.apk'));
    expect(dataOf(await check('SHIP', 20))).toMatchObject({ status: 'UPDATE_REQUIRED_UNAVAILABLE', release: null, update_available: false });
    expect(dataOf(await check('SHIP', 35))).toMatchObject({ update_available: false });
    const view = dataOf(await api(admin.running.baseUrl, 'GET', '/app-updates/compatibility')) as Json;
    expect(view.components.SHIP).toMatchObject({ artifact_ready: false, satisfied: false });
    await collector.collectOnce();
    const row = (await admin.pool.query(`SELECT evidence_code FROM app.ops_checks WHERE check_key = 'app_compat.ship'`)).rows[0] as Json;
    expect(row.evidence_code).toBe('COMPAT_ARTIFACT_MISSING');
    apk('ship-40.apk', 'APK-FORTY');
  });

  it('SYSTEM cannot withdraw the only build that meets the minimum, but can once another one does', async () => {
    const rows = (await admin.pool.query(`SELECT release_id, version::int AS version FROM app.ops_releases WHERE component = 'SHIP' AND version_code = 40`)).rows as Json[];
    const only = rows[0]!;
    const blocked = await apost(`/releases/${only.release_id}/withdraw`, { expected_version: only.version });
    expect({ status: blocked.status, code: adminErrorCode(blocked) }).toEqual({ status: 409, code: 'OPS_RELEASE_WITHDRAW_BLOCKED' });
    expect(dataOf(await check('SHIP', 20))).toMatchObject({ update_available: true });
    apk('ship-41.apk', 'APK-FORTY-ONE');
    await publish({ version_name: '1.2.0', version_code: 41, artifact_name: 'ship-41.apk' });
    const ok = await apost(`/releases/${only.release_id}/withdraw`, { expected_version: only.version });
    expect(ok.status).toBe(200);
    expect(dataOf(await check('SHIP', 20))).toMatchObject({ status: 'UPDATE_REQUIRED', latest_version_code: 41 });
    // A below-minimum draft (code 25) may still be withdrawn: it never satisfied the contract.
    const low = (await admin.pool.query(`SELECT release_id, version::int AS version FROM app.ops_releases WHERE component = 'SHIP' AND version_code = 25`)).rows[0] as Json;
    expect((await apost(`/releases/${low.release_id}/withdraw`, { expected_version: low.version })).status).toBe(200);
  });
});
