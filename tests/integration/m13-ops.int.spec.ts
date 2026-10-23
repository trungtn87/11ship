import { randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { ADMIN_SESSION_COOKIE } from '../../apps/backend/src/admin-auth/admin-auth-constants';
import { SmsGatewayConfig } from '../../apps/backend/src/config/sms-gateway-config';
import { runSmsGatewayCli } from '../../apps/backend/src/sms-gateway/cli/sms-gateway-cli';
import { runOpsCli } from '../../apps/backend/src/ops/cli/ops-cli';
import { TransactionManager } from '../../apps/backend/src/transaction/transaction-manager';
import { OpsCollector } from '../../apps/backend/src/ops/ops-collector';
import { DiscordBody, DiscordClient, DiscordResult, OPS_DISCORD_CLIENT, OpsDiscordDispatcher } from '../../apps/backend/src/ops/ops-discord';
import { CheckReport, OpsEngine } from '../../apps/backend/src/ops/ops-engine';
import { OpsIngestService } from '../../apps/backend/src/ops/ops-ingest-service';
import { OpsRetention, OpsRuntime } from '../../apps/backend/src/ops/ops-runtime';
import { HttpProbeResult, OPS_SYSTEM_PROBE, OpsSystemProbe } from '../../apps/backend/src/ops/ops-system-probe';
import { AdminApp, adminData, adminErrorCode, AdminResponse, adminTestEnv, cookieFrom, loginStep, preauthCookies, rewindAcceptedStep, sessionCookies, startAdminApp, totpNow } from './support/admin-fixtures';
import { begin, ok as okStep, post as postStep } from './support/activation-fixtures';
import { api, dataOf, Phone, randomPhone } from './support/auth-fixtures';
import { ADMIN_PASSWORD } from './support/admin-fixtures';
import { createInvitation, createPayload, systemSession, SystemSession } from './support/provisioning-fixtures';

// M13 on a REAL PostgreSQL and the real administration pipeline. Discord is a scripted stand-in and so is every infrastructure measurement: no production
// system is disturbed to test anything. The rows that producers of other modules would write are written by SQL or by the services themselves.

const HOOK = 'https://discord.com/api/webhooks/123456789012345678/AbCdEfGhIjKlMnOpQrStUvWxYz_SECRETTOKEN01';
const OPEN: SmsGatewayConfig = { recipientMode: 'OPEN', allowlist: new Set(), limitPhonePerHour: 3, limitPhonePerDay: 5, limitGlobalPerDay: 1000, onlineWindowSeconds: 90, leaseSeconds: 60, pollSeconds: 5 };
const ADMIN_ORIGIN_ = 'https://admin.example.test';

class MockDiscord implements DiscordClient {
  calls: { url: string; body: DiscordBody }[] = [];
  script: DiscordResult[] = [];
  async post(url: string, body: DiscordBody): Promise<DiscordResult> {
    this.calls.push({ url, body });
    return this.script.shift() ?? { ok: true, status: 204 };
  }
}

class StubProbe implements OpsSystemProbe {
  cpu: number | null = 10;
  memory: number | null = 20;
  disk: number | null = 50;
  self: HttpProbeResult = { ok: true, status: 200, latencyMs: 4, code: null };
  m14: HttpProbeResult = { ok: true, status: 200, latencyMs: 9, code: null };
  cert: number | null = 100;
  cpuPercent(): number | null { return this.cpu; }
  memoryPercent(): number | null { return this.memory; }
  diskPercent(): number | null { return this.disk; }
  async selfHealth(): Promise<HttpProbeResult> { return this.self; }
  async get(): Promise<HttpProbeResult> { return this.m14; }
  async certDaysLeft(): Promise<number | null> { return this.cert; }
}

interface Login { readonly cookie: string; readonly csrf: string }
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('M13 — operations, alerts and updates', () => {
  let admin: AdminApp;
  let system: SystemSession;
  const discord = new MockDiscord();
  const probe = new StubProbe();
  let artifactDir: string;
  let tx: TransactionManager;
  let engine: OpsEngine;
  let dispatcher: OpsDiscordDispatcher;
  let collector: OpsCollector;
  let ingest: OpsIngestService;
  const get = <T>(token: string): T => admin.running.app.get(token as never, { strict: false }) as T;

  // ---------------------------------------------------------------- helpers
  const systemLogin = (): Login => ({ cookie: system.login.cookie, csrf: system.login.csrf });
  const aget = (who: Login, p: string): Promise<AdminResponse> => admin.call('GET', `/ops${p}`, { basePath: '/v1/admin', cookies: sessionCookies(who) });
  async function apost(who: Login, p: string, body: unknown, key: string = randomUUID()): Promise<AdminResponse> {
    await admin.clearLimits();
    return admin.call('POST', `/ops${p}`, { basePath: '/v1/admin', body, cookies: sessionCookies(who), csrf: who.csrf, headers: { 'idempotency-key': key } });
  }
  const code = (r: AdminResponse): { status: number; code: string | undefined } => ({ status: r.status, code: adminErrorCode(r) });
  const q = async <T extends object>(sql: string, args: unknown[] = []): Promise<T[]> => (await admin.pool.query<T>(sql, args)).rows;

  async function wipeOps(): Promise<void> {
    const client = await admin.pool.connect();
    try {
      await client.query(`SET app.ops_purge = 'on'`);
      await client.query('UPDATE app.ops_incidents SET reopens_incident_id = NULL');
      // Devices left by an earlier run would change what "no gateway paired" means; jobs reference them, so both go (test database only).
      await client.query('DELETE FROM app.sms_jobs');
      await client.query('DELETE FROM app.ops_gateway_telemetry');
      await client.query('DELETE FROM app.sms_gateway_devices');
      for (const t of ['ops_events', 'ops_notifications', 'ops_incidents', 'ops_checks', 'ops_metrics', 'ops_metrics_hourly', 'ops_maintenance', 'ops_gateway_telemetry', 'ops_deploys', 'ops_version_reports', 'ops_releases', 'ops_backup_reports', 'ops_ingest_keys', 'ops_admin_scopes', 'ops_config']) {
        await client.query(`DELETE FROM app.${t}`);
      }
    } finally {
      client.release();
    }
  }

  async function adminWith(): Promise<{ login: Login; userId: string }> {
    const phone: Phone = randomPhone();
    admin.track(phone.normalized);
    const invitation = await createInvitation(admin, system, createPayload(phone.local, { full_name: 'Quản trị vận hành' }));
    const token = invitation.link.split('#t=')[1] as string;
    const session = await begin(admin, { invitationId: invitation.invitationId, token, phone });
    okStep(await postStep(admin, '/password', session, { password: ADMIN_PASSWORD }));
    const secret = String(adminData(okStep(await postStep(admin, '/totp/enrollment', session))).secret);
    okStep(await postStep(admin, '/complete', session, { code: totpNow(secret) }));
    const userId = (await q<{ user_id: string }>('SELECT user_id FROM app.users WHERE phone_normalized = $1', [phone.normalized]))[0]!.user_id;
    const preauth = await loginStep(admin, { phone, password: ADMIN_PASSWORD, userId });
    await rewindAcceptedStep(admin, userId);
    const verified = await admin.call('POST', '/totp/verify', { body: { code: totpNow(secret) }, cookies: preauthCookies(preauth), csrf: preauth.csrf });
    if (verified.status !== 200) throw new Error(`login failed ${verified.status}`);
    return { login: { cookie: String(cookieFrom(verified, ADMIN_SESSION_COOKIE)), csrf: String(adminData(verified).csrf_token) }, userId };
  }

  const report = (key: string, state: CheckReport['state'], o: Partial<CheckReport> = {}): CheckReport => ({ checkKey: key, source: 'API', state, value: { n: 1 }, evidenceCode: 'X', staleAfterSeconds: 300, title: `Test ${key}`, impact: 'Ảnh hưởng thử', ...o });
  const observe = (r: CheckReport) => tx.withTransaction((c) => engine.observe(c, r));
  const incidentOf = async (key: string): Promise<Json[]> => q<Json>(`SELECT incident_id, code_seq, status, severity, occurrences, detected_by, first_seen_at, closed_while_failing, reopens_incident_id, in_maintenance, version::int AS version FROM app.ops_incidents WHERE check_key = $1 ORDER BY created_at`, [key]);
  const notices = async (incidentId: string): Promise<Json[]> => q<Json>(`SELECT kind, status, skip_reason, attempts FROM app.ops_notifications WHERE incident_id = $1::uuid ORDER BY created_at, kind`, [incidentId]);
  const sweep = () => tx.withTransaction((c) => engine.sweep(c));
  const sql = (text: string, args: unknown[] = []) => admin.pool.query(text, args);

  async function configureDiscord(enabled = true, webhook: string | null = HOOK): Promise<void> {
    const current = dataOf1(await aget(systemLogin(), '/config')).config as Json;
    const r = await apost(systemLogin(), '/config', { expected_version: current.version, settings: {}, discord_enabled: enabled, discord_min_severity: 'WARNING', ...(webhook === undefined ? {} : { webhook }) });
    expect(r.status).toBe(200);
  }
  const dataOf1 = (r: AdminResponse): Json => adminData(r) as Json;

  beforeAll(async () => {
    artifactDir = mkdtempSync(path.join(tmpdir(), 'm13-artifacts-'));
    admin = await startAdminApp({
      smsGateway: OPEN,
      activationDisabledTest: true,
      overrides: [
        { provide: OPS_DISCORD_CLIENT, useValue: discord },
        { provide: OPS_SYSTEM_PROBE, useValue: probe },
      ],
      configOverride: { ops: { diskPaths: [{ label: 'root', path: '/' }], backendVersion: '1.0.0', collectorEnabled: false, artifactDir, adminBaseUrl: ADMIN_ORIGIN_ } },
    });
    system = await systemSession(admin);
    tx = get<TransactionManager>(TransactionManager as never);
    engine = get<OpsEngine>(OpsEngine as never);
    dispatcher = get<OpsDiscordDispatcher>(OpsDiscordDispatcher as never);
    collector = get<OpsCollector>(OpsCollector as never);
    ingest = get<OpsIngestService>(OpsIngestService as never);
  });

  afterAll(async () => {
    if (process.env.M13_DEBUG_LOGS) console.log(admin.running.logs.filter((l) => /error|fail/i.test(l)).slice(-12).join('\n'));
    await wipeOps();
    rmSync(artifactDir, { recursive: true, force: true });
    await admin.close();
  });

  beforeEach(async () => {
    await wipeOps();
    discord.calls = [];
    discord.script = [];
    Object.assign(probe, { cpu: 10, memory: 20, disk: 50, cert: 100, self: { ok: true, status: 200, latencyMs: 4, code: null } });
  });

  // ---------------------------------------------------------------- incidents
  describe('incidents: dedupe, escalation, recovery, reminders (design sections 8 and 9)', () => {
    it('a repeated failure is ONE incident with a count; missing data never opens, recovers or counts as healthy', async () => {
      await configureDiscord();
      await observe(report('t13.alpha', 'UNKNOWN'));
      expect(await incidentOf('t13.alpha')).toHaveLength(0);
      for (let i = 0; i < 3; i += 1) await observe(report('t13.alpha', 'CRITICAL'));
      const [inc, ...rest] = await incidentOf('t13.alpha');
      expect(rest).toHaveLength(0);
      expect(inc).toMatchObject({ status: 'NEW', severity: 'CRITICAL', occurrences: 3 });
      await observe(report('t13.alpha', 'UNKNOWN'));
      expect((await incidentOf('t13.alpha'))[0]).toMatchObject({ status: 'NEW' });
      const open = (await notices(String(inc!.incident_id))).filter((n) => n.kind === 'OPEN');
      expect(open).toHaveLength(1);
    });

    it('open message carries severity, source, impact, time, code and an Admin link; it is sent once and the result is recorded on the timeline', async () => {
      await configureDiscord();
      await observe(report('t13.msg', 'CRITICAL', { title: 'Gateway mất liên lạc', source: 'SMS_GATEWAY' }));
      const summary = await dispatcher.runOnce();
      expect(summary).toMatchObject({ sent: 1, failed: 0 });
      const e = discord.calls[0]!.body.embeds[0]!;
      expect(e.title).toMatch(/\[SC-\d{3,}\] Gateway mất liên lạc/);
      const names = e.fields.map((f) => f.name);
      expect(names).toEqual(expect.arrayContaining(['Mức độ', 'Nguồn', 'Ảnh hưởng', 'Thời điểm', 'Mã sự cố']));
      expect(JSON.stringify(e)).toContain(`${ADMIN_ORIGIN_}/system-ops/incidents/SC-`);
      expect(discord.calls[0]!.url).toBe(HOOK);
      expect(discord.calls[0]!.body.allowed_mentions.parse).toEqual([]);
      const inc = (await incidentOf('t13.msg'))[0]!;
      const timeline = await q<Json>(`SELECT code FROM app.ops_events WHERE incident_id = $1::uuid ORDER BY seq`, [inc.incident_id]);
      expect(timeline.map((t) => t.code)).toEqual(['DETECTED', 'DISCORD_SENT']);
      await dispatcher.runOnce();
      expect(discord.calls).toHaveLength(1);
    });

    it('a worse severity escalates and is announced even after the incident was acknowledged; recovery sends one message; failing again reopens the SAME incident', async () => {
      await configureDiscord();
      await observe(report('t13.esc', 'WARNING'));
      const first = (await incidentOf('t13.esc'))[0]!;
      const handler = await adminWith();
      await apost(systemLogin(), '/access', { user_id: handler.userId, level: 'HANDLE', expected_version: 0 });
      const ack = await apost(handler.login, `/incidents/${first.incident_id}/acknowledge`, { expected_version: first.version });
      expect(ack.status).toBe(200);
      await observe(report('t13.esc', 'CRITICAL'));
      expect((await incidentOf('t13.esc'))[0]).toMatchObject({ status: 'ACKNOWLEDGED', severity: 'CRITICAL' });
      expect((await notices(String(first.incident_id))).map((n) => n.kind).sort()).toEqual(['ESCALATION', 'OPEN']);
      await observe(report('t13.esc', 'OK'));
      await observe(report('t13.esc', 'OK'));
      expect((await incidentOf('t13.esc'))[0]).toMatchObject({ status: 'RECOVERED' });
      expect((await notices(String(first.incident_id))).filter((n) => n.kind === 'RECOVERY')).toHaveLength(1);
      await observe(report('t13.esc', 'CRITICAL'));
      const after = await incidentOf('t13.esc');
      expect(after).toHaveLength(1);
      expect(after[0]).toMatchObject({ status: 'NEW', incident_id: first.incident_id });
    });

    it('reminders: warning after 30 min, critical after 10; acknowledged or snoozed stops them; deduplicated per interval', async () => {
      await configureDiscord();
      await observe(report('t13.rw', 'WARNING'));
      await observe(report('t13.rc', 'CRITICAL'));
      await sweep();
      expect(await q('SELECT 1 FROM app.ops_notifications WHERE kind = $1', ['REMINDER'])).toHaveLength(0);
      const age = (key: string, minutes: number) => sql(`UPDATE app.ops_incidents SET first_seen_at = first_seen_at - make_interval(mins => $2), last_notified_at = last_notified_at - make_interval(mins => $2) WHERE check_key = $1`, [key, minutes]);
      await age('t13.rw', 29);
      await age('t13.rc', 9);
      await sweep();
      expect(await q('SELECT 1 FROM app.ops_notifications WHERE kind = $1', ['REMINDER'])).toHaveLength(0);
      await age('t13.rw', 2);
      await age('t13.rc', 2);
      await sweep();
      const reminders = await q<Json>(`SELECT i.check_key FROM app.ops_notifications n JOIN app.ops_incidents i USING (incident_id) WHERE n.kind = 'REMINDER' ORDER BY 1`);
      expect(reminders.map((r) => r.check_key)).toEqual(['t13.rc', 't13.rw']);
      await sweep();
      expect(await q('SELECT 1 FROM app.ops_notifications WHERE kind = $1', ['REMINDER'])).toHaveLength(2);

      const handler = await adminWith();
      await apost(systemLogin(), '/access', { user_id: handler.userId, level: 'HANDLE', expected_version: 0 });
      await observe(report('t13.rs', 'WARNING'));
      await observe(report('t13.ra', 'WARNING'));
      const [snz] = await incidentOf('t13.rs');
      const [ack] = await incidentOf('t13.ra');
      expect((await apost(handler.login, `/incidents/${snz!.incident_id}/snooze`, { expected_version: snz!.version, minutes: 120 })).status).toBe(200);
      expect((await apost(handler.login, `/incidents/${ack!.incident_id}/acknowledge`, { expected_version: ack!.version })).status).toBe(200);
      await age('t13.rs', 600);
      await age('t13.ra', 600);
      await sweep();
      expect(await q(`SELECT 1 FROM app.ops_notifications n JOIN app.ops_incidents i USING (incident_id) WHERE n.kind = 'REMINDER' AND i.check_key IN ('t13.rs','t13.ra')`)).toHaveLength(0);
    });

    it('an acknowledged incident whose snooze ran out gets one notice; read is not acknowledged', async () => {
      await configureDiscord();
      await observe(report('t13.sn', 'WARNING'));
      const [i] = await incidentOf('t13.sn');
      const handler = await adminWith();
      await apost(systemLogin(), '/access', { user_id: handler.userId, level: 'HANDLE', expected_version: 0 });
      const detail = await aget(handler.login, `/incidents/SC-${String(i!.code_seq).padStart(3, '0')}`);
      expect(detail.status).toBe(200);
      expect((await incidentOf('t13.sn'))[0]).toMatchObject({ status: 'NEW' });
      expect(await q('SELECT 1 FROM app.ops_incidents WHERE incident_id = $1::uuid AND first_viewed_at IS NOT NULL', [i!.incident_id])).toHaveLength(1);
      const cur = (await incidentOf('t13.sn'))[0]!;
      await apost(handler.login, `/incidents/${i!.incident_id}/acknowledge`, { expected_version: cur.version });
      const cur2 = (await incidentOf('t13.sn'))[0]!;
      await apost(handler.login, `/incidents/${i!.incident_id}/snooze`, { expected_version: cur2.version, minutes: 30 });
      await sql(`UPDATE app.ops_incidents SET snoozed_until = now() - interval '1 minute' WHERE incident_id = $1::uuid`, [i!.incident_id]);
      await sweep();
      await sweep();
      expect((await notices(String(i!.incident_id))).filter((n) => n.kind === 'SNOOZE_END')).toHaveLength(1);
    });

    it('closing while the check still fails is allowed only with a stated reason, keeps the real state visible and opens a NEW linked incident', async () => {
      await observe(report('t13.cl', 'CRITICAL'));
      const [i] = await incidentOf('t13.cl');
      const handler = await adminWith();
      await apost(systemLogin(), '/access', { user_id: handler.userId, level: 'HANDLE', expected_version: 0 });
      expect(code(await apost(handler.login, `/incidents/${i!.incident_id}/close`, { expected_version: i!.version }))).toEqual({ status: 409, code: 'OPS_INCIDENT_STATE_CONFLICT' });
      expect((await apost(handler.login, `/incidents/${i!.incident_id}/close`, { expected_version: i!.version, confirm_still_failing: true })).status).toBe(400);
      const closed = await apost(handler.login, `/incidents/${i!.incident_id}/close`, { expected_version: i!.version, confirm_still_failing: true, note: 'đã báo nhà mạng' });
      expect(closed.status).toBe(200);
      expect(adminData(closed).check_state).toBe('CRITICAL');
      await observe(report('t13.cl', 'CRITICAL'));
      const all = await incidentOf('t13.cl');
      expect(all).toHaveLength(2);
      expect(all[0]).toMatchObject({ status: 'CLOSED', closed_while_failing: true });
      expect(all[1]).toMatchObject({ status: 'NEW', reopens_incident_id: i!.incident_id });
    });

    it('a recovered incident is closed plainly and by itself after the configured hours', async () => {
      await observe(report('t13.ac', 'WARNING'));
      await observe(report('t13.ac', 'OK'));
      await sql(`UPDATE app.ops_incidents SET recovered_at = now() - interval '25 hours' WHERE check_key = 't13.ac'`);
      expect((await sweep()).closed).toBe(1);
      expect((await incidentOf('t13.ac'))[0]).toMatchObject({ status: 'CLOSED', closed_while_failing: false });
    });
  });

  // ---------------------------------------------------------------- maintenance
  describe('maintenance (design section 10)', () => {
    it('silences Discord for its scope only, keeps the incident, and the first message goes out by itself after the window', async () => {
      await configureDiscord();
      const ends = new Date(Date.now() + 3_600_000).toISOString();
      const created = await apost(systemLogin(), '/maintenance', { scopes: ['M14'], reason: 'nâng cấp máy bản đồ', ends_at: ends });
      expect(created.status).toBe(200);
      await observe(report('t13.mnt', 'CRITICAL', { source: 'M14' }));
      await observe(report('t13.out', 'CRITICAL', { source: 'API' }));
      const [m] = await incidentOf('t13.mnt');
      const [o] = await incidentOf('t13.out');
      expect(m).toMatchObject({ in_maintenance: true });
      expect((await notices(String(m!.incident_id)))[0]).toMatchObject({ kind: 'OPEN', status: 'SKIPPED', skip_reason: 'MAINTENANCE' });
      expect((await notices(String(o!.incident_id)))[0]).toMatchObject({ kind: 'OPEN', status: 'PENDING' });
      await sql(`UPDATE app.ops_maintenance SET starts_at = now() - interval '2 hours', ends_at = now() - interval '1 minute'`);
      await sweep();
      const after = await notices(String(m!.incident_id));
      expect(after.map((n) => `${n.kind}:${n.status}`).sort()).toEqual(['OPEN:PENDING', 'OPEN:SKIPPED']);
      expect((await incidentOf('t13.mnt'))[0]).toMatchObject({ in_maintenance: false });
      await get<OpsRuntime>(OpsRuntime as never).tick(true);
      expect(await q(`SELECT 1 FROM app.ops_events WHERE code = 'MAINTENANCE_ENDED'`)).toHaveLength(1);
    });

    it('is SYSTEM-only, bounded, and a window that already ended cannot be created', async () => {
      const handler = await adminWith();
      await apost(systemLogin(), '/access', { user_id: handler.userId, level: 'HANDLE', expected_version: 0 });
      const body = { scopes: ['API'], reason: 'thử', ends_at: new Date(Date.now() + 60_000).toISOString() };
      expect(code(await apost(handler.login, '/maintenance', body))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
      expect(code(await apost(systemLogin(), '/maintenance', { ...body, ends_at: new Date(Date.now() - 60_000).toISOString() }))).toEqual({ status: 400, code: 'OPS_MAINTENANCE_INVALID' });
      expect(code(await apost(systemLogin(), '/maintenance', { ...body, ends_at: new Date(Date.now() + 80 * 3_600_000).toISOString() }))).toEqual({ status: 400, code: 'OPS_MAINTENANCE_INVALID' });
      expect(code(await apost(systemLogin(), '/maintenance', { ...body, scopes: ['NOPE'] }))).toMatchObject({ status: 400 });
    });
  });

  // ---------------------------------------------------------------- Discord
  describe('Discord delivery: retry, rate limit, no flood, no false "delivered"', () => {
    const notice = async (n = 1): Promise<void> => {
      for (let i = 0; i < n; i += 1) await tx.withTransaction((c) => engine.enqueueFreeNotice(c, 'TEST', 'INFO', { title: `thử ${i}` }, `t13:${randomUUID()}`));
    };
    const rows = () => q<Json>(`SELECT status, skip_reason, attempts, last_error_code, last_http_status FROM app.ops_notifications ORDER BY created_at`);

    it('a rate limit keeps the message, does not count an attempt and stops the run', async () => {
      await configureDiscord();
      await notice(2);
      discord.script = [{ ok: false, status: 429, code: 'RATE_LIMITED', retryAfterSeconds: 30, permanent: false }];
      const s = await dispatcher.runOnce();
      expect(s.rateLimited).toBe(true);
      expect(discord.calls).toHaveLength(1);
      expect((await rows()).map((r) => `${r.status}:${r.attempts}`)).toEqual(['PENDING:0', 'PENDING:0']);
      const again = await dispatcher.runOnce();
      expect(again.claimed).toBe(0);
    });

    it('transient failures retry with back-off and end as FAILED at the limit; a permanent failure ends at once; nothing is ever shown as sent', async () => {
      await configureDiscord();
      await notice(1);
      for (let i = 0; i < 5; i += 1) {
        discord.script = [{ ok: false, status: 503, code: 'HTTP_503', permanent: false }];
        await dispatcher.runOnce();
        await sql(`UPDATE app.ops_notifications SET next_attempt_at = now() - interval '1 second' WHERE status = 'PENDING'`);
      }
      expect((await rows())[0]).toMatchObject({ status: 'FAILED', attempts: 5, last_error_code: 'HTTP_503' });
      // The channel failing is itself reported (a check and an incident): let that message go out before the next case.
      await dispatcher.runOnce();
      await q(`UPDATE app.ops_notifications SET status = 'SKIPPED', skip_reason = 'SUPERSEDED' WHERE status = 'PENDING'`).catch(() => undefined);
      discord.calls = [];
      await notice(1);
      discord.script = [{ ok: false, status: 404, code: 'HTTP_404', permanent: true }];
      await dispatcher.runOnce();
      expect((await rows()).find((r) => r.last_http_status === 404)).toMatchObject({ status: 'FAILED', attempts: 1 });
      expect((await q<Json>(`SELECT sent_at FROM app.ops_notifications WHERE last_http_status = 404`))[0]).toMatchObject({ sent_at: null });
      expect((await q<Json>(`SELECT state FROM app.ops_checks WHERE check_key = 'discord_channel'`))[0]).toMatchObject({ state: 'WARNING' });
    });

    it('after an outage the channel gets a bounded burst per run, not the whole backlog at once', async () => {
      await configureDiscord();
      await notice(8);
      expect((await dispatcher.runOnce()).sent).toBe(5);
      expect((await dispatcher.runOnce()).sent).toBe(3);
      expect(discord.calls).toHaveLength(8);
    });

    it('newer reminders replace older pending ones of the same incident', async () => {
      await configureDiscord();
      await observe(report('t13.rem', 'CRITICAL'));
      const [i] = await incidentOf('t13.rem');
      for (let n = 0; n < 3; n += 1) {
        await sql(`UPDATE app.ops_incidents SET first_seen_at = first_seen_at - interval '15 minutes', last_notified_at = last_notified_at - interval '15 minutes', last_reminder_at = last_reminder_at - interval '15 minutes' WHERE incident_id = $1::uuid`, [i!.incident_id]);
        await sweep();
      }
      const pending = (await notices(String(i!.incident_id))).filter((n) => n.kind === 'REMINDER' && n.status === 'PENDING');
      expect(pending).toHaveLength(1);
    });

    it('a closed or unconfigured channel sends nothing and says why (never "sent")', async () => {
      await notice(1);
      await dispatcher.runOnce();
      expect(discord.calls).toHaveLength(0);
      expect((await rows())[0]).toMatchObject({ status: 'SKIPPED', skip_reason: 'NOT_CONFIGURED' });
      await configureDiscord(true, HOOK);
      await notice(1);
      const cfg = dataOf1(await aget(systemLogin(), '/config')).config as Json;
      await apost(systemLogin(), '/config', { expected_version: cfg.version, settings: {}, discord_enabled: false, discord_min_severity: 'WARNING' });
      await dispatcher.runOnce();
      expect(discord.calls).toHaveLength(0);
      expect((await rows())[1]).toMatchObject({ status: 'SKIPPED', skip_reason: 'DISABLED' });
    });

    it('SYSTEM can send a test message and gets the real outcome', async () => {
      const before = await apost(systemLogin(), '/config/discord-test', {});
      expect(adminData(before).result).toMatchObject({ status: 'SKIPPED', skip_reason: 'NOT_CONFIGURED' });
      await configureDiscord();
      const sent = await apost(systemLogin(), '/config/discord-test', {});
      expect(adminData(sent).result).toMatchObject({ status: 'SENT' });
      expect(discord.calls).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------- collectors
  describe('server monitoring: no data is not green, outages are real (design section 5)', () => {
    it('API needs three consecutive failures; database/CPU/disk follow their thresholds; missing sources stay "no data"', async () => {
      await collector.collectOnce();
      let overview = dataOf1(await aget(systemLogin(), '/overview'));
      const comp = (k: string): Json => (overview.components as Json[]).find((c) => c.key === k)!;
      expect(comp('api').state).toBe('OK');
      expect(comp('database').state).toBe('OK');
      expect(comp('backup').state).toBe('NO_DATA');
      expect(comp('restore_test').state).toBe('NO_DATA');
      expect(comp('restore_test').note).toContain('khác');
      expect(comp('m14').state).toBe('NO_DATA');
      expect(comp('https').state).toBe('NO_DATA');
      expect(comp('sms_gateway').state).toBe('NO_DATA');
      expect(overview.external_probe).toMatchObject({ activated: false, label: 'Chưa kích hoạt' });

      probe.self = { ok: false, status: null, latencyMs: 5000, code: 'TIMEOUT' };
      await collector.collectOnce();
      await collector.collectOnce();
      expect(await incidentOf('api')).toHaveLength(0);
      await collector.collectOnce();
      expect((await incidentOf('api'))[0]).toMatchObject({ status: 'NEW', severity: 'CRITICAL' });
      probe.self = { ok: true, status: 200, latencyMs: 3, code: null };
      await collector.collectOnce();
      expect((await incidentOf('api'))[0]).toMatchObject({ status: 'RECOVERED' });

      probe.disk = 85;
      await collector.collectOnce();
      expect((await incidentOf('disk.root'))[0]).toMatchObject({ severity: 'WARNING' });
      probe.disk = 95;
      await collector.collectOnce();
      expect((await incidentOf('disk.root'))[0]).toMatchObject({ severity: 'CRITICAL' });
      overview = dataOf1(await aget(systemLogin(), '/overview'));
      expect(comp('resources').state).toBe('CRITICAL');
      expect(overview.incidents.open).toBeGreaterThanOrEqual(1);
    });

    it('a threshold SYSTEM changes takes effect, and a value outside its bounds or order is refused', async () => {
      probe.disk = 75;
      await collector.collectOnce();
      expect(await incidentOf('disk.root')).toHaveLength(0);
      const cfg = dataOf1(await aget(systemLogin(), '/config')).config as Json;
      const changed = await apost(systemLogin(), '/config', { expected_version: cfg.version, settings: { 'server.disk_warn_percent': 70 }, discord_enabled: false, discord_min_severity: 'WARNING' });
      expect(changed.status).toBe(200);
      await collector.collectOnce();
      expect((await incidentOf('disk.root'))[0]).toMatchObject({ severity: 'WARNING' });
      const v = (adminData(changed) as Json).version;
      expect(code(await apost(systemLogin(), '/config', { expected_version: v, settings: { 'server.cpu_percent': 5 }, discord_enabled: false, discord_min_severity: 'WARNING' }))).toEqual({ status: 400, code: 'OPS_SETTINGS_INVALID' });
      expect(code(await apost(systemLogin(), '/config', { expected_version: v, settings: { 'server.disk_warn_percent': 95 }, discord_enabled: false, discord_min_severity: 'WARNING' }))).toEqual({ status: 400, code: 'OPS_SETTINGS_INVALID' });
      expect(code(await apost(systemLogin(), '/config', { expected_version: v, settings: { 'no.such.key': 5 }, discord_enabled: false, discord_min_severity: 'WARNING' }))).toEqual({ status: 400, code: 'OPS_SETTINGS_INVALID' });
      expect(code(await apost(systemLogin(), '/config', { expected_version: 0, settings: {}, discord_enabled: false, discord_min_severity: 'WARNING' }))).toEqual({ status: 409, code: 'VERSION_CONFLICT' });
      expect(code(await apost(systemLogin(), '/config', { expected_version: v, settings: {}, discord_enabled: true, discord_min_severity: 'WARNING' }))).toEqual({ status: 409, code: 'OPS_DISCORD_NOT_CONFIGURED' });
    });

    it('the independent probe is only "silent" after it reported once; its outage is imported with the real start time and not announced twice', async () => {
      await collector.collectOnce();
      expect(await incidentOf('external_probe')).toHaveLength(0);
      const probeKey = await ingest.createKey('Giam sat ngoai', 'PROBE');
      const backupKey = await ingest.createKey('Sao luu', 'BACKUP');
      const send = (secret: string, body: unknown) => api(admin.running.baseUrl, 'POST', '/ops/ingest/probe', { bearer: secret, body });
      expect((await send(backupKey.secret, { reported_at: new Date().toISOString() })).status).toBe(401);
      expect((await send(`${probeKey.secret}x`, { reported_at: new Date().toISOString() })).status).toBe(401);
      const first = new Date(Date.now() - 20 * 60_000).toISOString();
      const rec = new Date(Date.now() - 15 * 60_000).toISOString();
      await configureDiscord();
      const body = { reported_at: new Date().toISOString(), reports: [{ episode_id: 'ep-1-finished', first_failed_at: first, recovered_at: rec, failures: 5, code: 'TIMEOUT', notified: true }, { episode_id: 'ep-2-open', first_failed_at: first, failures: 3, code: 'HTTP_503', notified: false }] };
      expect((await send(probeKey.secret, body)).status).toBe(200);
      expect((await send(probeKey.secret, body)).status).toBe(200);
      const inc = await incidentOf('public_api');
      expect(inc).toHaveLength(2);
      const done = inc.find((i) => i.status === 'RECOVERED')!;
      const open = inc.find((i) => i.status === 'NEW')!;
      expect(done.detected_by).toBe('EXTERNAL_PROBE');
      expect(Math.abs(new Date(done.first_seen_at as string).getTime() - Date.parse(first))).toBeLessThan(2000);
      expect((await notices(String(done.incident_id))).map((n) => `${n.kind}:${n.status}:${n.skip_reason}`)).toEqual(['OPEN:SKIPPED:EXTERNAL_SENT']);
      expect((await notices(String(open.incident_id))).map((n) => `${n.kind}:${n.status}`)).toEqual(['OPEN:PENDING']);
      expect((await send(probeKey.secret, { reported_at: new Date().toISOString(), reports: [{ episode_id: 'ep-2-open', first_failed_at: first, recovered_at: new Date().toISOString(), failures: 3, code: 'HTTP_503', notified: false }] })).status).toBe(200);
      expect((await incidentOf('public_api')).map((i) => i.status).sort()).toEqual(['RECOVERED', 'RECOVERED']);
      await sql(`UPDATE app.ops_checks SET value = jsonb_set(value, '{reported_at}', to_jsonb((now() - interval '30 minutes')::text)) WHERE check_key = 'external_probe'`);
      await collector.collectOnce();
      expect((await incidentOf('external_probe'))[0]).toMatchObject({ severity: 'WARNING', status: 'NEW' });
      expect((await send(probeKey.secret, { reported_at: new Date().toISOString() })).status).toBe(200);
      expect((await incidentOf('external_probe'))[0]).toMatchObject({ status: 'RECOVERED' });
      expect(await ingest.revokeKey(probeKey.keyId)).toBe(true);
      expect((await send(probeKey.secret, { reported_at: new Date().toISOString() })).status).toBe(401);
    });

    it('backup and restore test are two facts; a failed backup warns; a report is evaluated at once', async () => {
      const key = await ingest.createKey('Sao luu', 'BACKUP');
      const send = (body: unknown) => api(admin.running.baseUrl, 'POST', '/ops/ingest/backup', { bearer: key.secret, body });
      expect((await send({ kind: 'BACKUP', ok: true, finished_at: new Date().toISOString(), size_bytes: 1234 })).status).toBe(200);
      let overview = dataOf1(await aget(systemLogin(), '/overview'));
      const comp = (k: string): Json => (overview.components as Json[]).find((c) => c.key === k)!;
      expect(comp('backup').state).toBe('OK');
      expect(comp('restore_test').state).toBe('NO_DATA');
      expect((await send({ kind: 'BACKUP', ok: false, finished_at: new Date().toISOString(), detail_code: 'DISK_FULL' })).status).toBe(200);
      expect((await incidentOf('backup'))[0]).toMatchObject({ severity: 'WARNING', status: 'NEW' });
      expect((await send({ kind: 'RESTORE_TEST', ok: true, finished_at: new Date().toISOString() })).status).toBe(200);
      overview = dataOf1(await aget(systemLogin(), '/overview'));
      expect(comp('restore_test').state).toBe('OK');
      expect(comp('backup').state).toBe('WARNING');
      expect((await send({ kind: 'BACKUP', ok: true, finished_at: 'yesterday' })).status).toBe(400);
    });

    it('the deploy pipeline reports start and finish: history, one Discord result, and no promise of a database rollback', async () => {
      await configureDiscord();
      const key = await ingest.createKey('Deploy', 'DEPLOY');
      const send = (body: unknown) => api(admin.running.baseUrl, 'POST', '/ops/ingest/deploy', { bearer: key.secret, body });
      const started = await send({ action: 'start', component: 'BACKEND', to_version: '1.2.0', from_version: '1.1.0', has_db_migration: true });
      expect(started.status).toBe(200);
      const id = String(dataOf(started).deploy_id);
      expect((await send({ action: 'finish', deploy_id: id, status: 'FAILED', health_result: 'FAILED', health_detail: 'ready 503' })).status).toBe(200);
      expect((await send({ action: 'finish', deploy_id: id, status: 'SUCCEEDED' })).status).toBe(409);
      await dispatcher.runOnce();
      expect(discord.calls).toHaveLength(1);
      expect(JSON.stringify(discord.calls[0]!.body)).toContain('không tự khôi phục cơ sở dữ liệu');
      const view = dataOf1(await aget(systemLogin(), '/releases'));
      expect((view.deploys as Json[])[0]).toMatchObject({ status: 'FAILED', health_result: 'FAILED', has_db_migration: true });
      expect(view.deploy_control).toMatchObject({ available: false });
      expect((view.deploy_control as Json).missing.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------- SMS gateway
  describe('SMS gateway monitoring (design sections 3 and 4)', () => {
    async function pair(label: string): Promise<{ deviceId: string; token: string }> {
      const out: string[] = [];
      const c = await runSmsGatewayCli({ env: adminTestEnv(), argv: ['pair', '--label', label], out: (l) => out.push(l), err: () => undefined });
      expect(c).toBe(0);
      return { deviceId: /paired device ([0-9a-f-]{36})/.exec(out.join('\n'))![1]!, token: /: ([A-Za-z0-9_-]{43})$/.exec(out[1]!)![1]! };
    }
    const beat = (token: string, body: Record<string, unknown>) => api(admin.running.baseUrl, 'POST', '/sms-gateway/heartbeat', { bearer: token, body });

    it('silence is reported as "no signal" on time without guessing a cause, and the incident recovers when the phone returns', async () => {
      await sql('DELETE FROM app.sms_gateway_devices');
      const dev = await pair('Gateway 01');
      expect((await beat(dev.token, { app_version: '1.0.3', sms_permission: true, paused: false, battery_percent: 18, charging: false, sim_state: 'READY', pending_reports: 0, current_task: 'IDLE' })).status).toBe(200);
      await collector.collectOnce();
      expect(await incidentOf(`gateway.${dev.deviceId}.contact`)).toHaveLength(0);
      const overview0 = dataOf1(await aget(systemLogin(), '/overview'));
      expect((overview0.components as Json[]).find((c) => c.key === 'sms_gateway')!.state).not.toBe('OK');
      await sql(`UPDATE app.sms_gateway_devices SET last_seen_at = now() - interval '3 minutes 5 seconds' WHERE device_id = $1::uuid`, [dev.deviceId]);
      await collector.collectOnce();
      expect((await incidentOf(`gateway.${dev.deviceId}.contact`))[0]).toMatchObject({ severity: 'WARNING' });
      await sql(`UPDATE app.sms_gateway_devices SET last_seen_at = now() - interval '5 minutes 5 seconds' WHERE device_id = $1::uuid`, [dev.deviceId]);
      await collector.collectOnce();
      const [inc] = await incidentOf(`gateway.${dev.deviceId}.contact`);
      expect(inc).toMatchObject({ severity: 'CRITICAL', occurrences: 2 });
      const text = JSON.stringify(await q<Json>(`SELECT title, impact, evidence FROM app.ops_incidents WHERE incident_id = $1::uuid`, [inc!.incident_id])).toLowerCase();
      expect(text).toContain('không nhận được tín hiệu từ gateway');
      for (const guess of ['hết pin', 'mất mạng', 'tắt máy', 'hết tiền']) expect(text).not.toContain(guess);
      expect((await beat(dev.token, { app_version: '1.0.3', paused: false, battery_percent: 18, charging: false })).status).toBe(200);
      await collector.collectOnce();
      expect((await incidentOf(`gateway.${dev.deviceId}.contact`))[0]).toMatchObject({ status: 'RECOVERED' });
    });

    it('battery <=10% without charging is critical; charging recovers it; the page shows "Chưa xác định" for the SIM balance and "Đăng ký / Quên mật khẩu" for the queue', async () => {
      await sql('DELETE FROM app.sms_gateway_devices');
      const dev = await pair('Gateway 02');
      await beat(dev.token, { app_version: '1.0.3', paused: false, battery_percent: 8, charging: false, sim_state: 'READY', pending_reports: 0, current_task: 'IDLE' });
      await collector.collectOnce();
      expect((await incidentOf(`gateway.${dev.deviceId}.battery`))[0]).toMatchObject({ severity: 'CRITICAL' });
      const page = dataOf1(await aget(systemLogin(), '/gateway'));
      const d = (page.devices as Json[])[0]!;
      expect(d).toMatchObject({ label: 'Gateway 02', battery_percent: 8, charging: false, sim_balance: null, sim_balance_label: 'Chưa xác định', topup_noted_on: null });
      expect(page.queue.purposes_label).toBe('Đăng ký / Quên mật khẩu');
      expect(JSON.stringify(page)).not.toContain('Đăng nhập');
      expect((await apost(systemLogin(), `/gateway/${dev.deviceId}/topup-note`, { date: '2026-10-10' })).status).toBe(200);
      expect(((dataOf1(await aget(systemLogin(), '/gateway')).devices as Json[])[0] as Json).topup_noted_on).toBe('2026-10-10');
      await beat(dev.token, { app_version: '1.0.3', paused: false, battery_percent: 8, charging: true });
      await collector.collectOnce();
      expect((await incidentOf(`gateway.${dev.deviceId}.battery`))[0]).toMatchObject({ status: 'RECOVERED' });
      expect(code(await apost(systemLogin(), `/gateway/${randomUUID()}/topup-note`, { date: '2026-10-10' }))).toEqual({ status: 404, code: 'OPS_TARGET_NOT_FOUND' });
      expect((await apost(systemLogin(), `/gateway/${dev.deviceId}/topup-note`, { date: '2999-01-01' })).status).toBe(400);
    });
  });

  // ---------------------------------------------------------------- apps
  describe('app logs, version reports and error bursts (design section 7)', () => {
    const principal = (userId: string, app: 'FOOD' | 'SHIP' = 'SHIP') => ({ userId, sessionId: randomUUID(), activeRole: null, phoneNormalized: '+84900000000', platform: 'ANDROID', app });
    const entry = (o: Partial<{ code: string; kind: string; message: string; at: number }> = {}) => ({ atMs: o.at ?? Date.now() - 1000, kind: (o.kind ?? 'CRASH') as 'CRASH', code: o.code ?? 'NPE', appVersion: '9.9.9', message: o.message ?? 'lỗi', context: {}, deliveryCode: null });

    it('stores redacted lines, drops a retried batch, caps a runaway account, and a lone crash is not an incident', async () => {
      const u = randomUUID();
      const e = entry({ message: 'khách 0912345678 mã otp 123456 Authorization: Bearer abcdefghijklmnop1234 token=zzzzzzzz' });
      expect(await ingest.clientLogs(principal(u), [e])).toMatchObject({ accepted: 1, duplicate: 0 });
      expect(await ingest.clientLogs(principal(u), [e])).toMatchObject({ accepted: 0, duplicate: 1 });
      const [row] = await q<Json>(`SELECT message, detail, source, kind, user_id FROM app.ops_events WHERE category = 'TECHNICAL' AND source = 'APP_SHIP'`);
      for (const secret of ['0912345678', '123456', 'abcdefghijklmnop1234', 'zzzzzzzz']) expect(JSON.stringify(row)).not.toContain(secret);
      expect(row).toMatchObject({ kind: 'CRASH', user_id: u });
      await collector.collectOnce();
      expect(await incidentOf('client.app_ship.9.9.9')).toHaveLength(0);
      const many = Array.from({ length: 320 }, (_, i) => entry({ code: `E${i}`, at: Date.now() - 2000 - i }));
      const capped = (await ingest.clientLogs(principal(randomUUID()), many)) as Json;
      expect(capped.accepted).toBe(300);
      expect(capped.dropped).toBe(20);
    });

    it('enough errors from several accounts of one version open ONE incident; M14 and push kinds go to their own sources; app-off is not evidence', async () => {
      for (let i = 0; i < 5; i += 1) await ingest.clientLogs(principal(randomUUID()), [entry({ code: `CR${i}` })]);
      await collector.collectOnce();
      const inc = await incidentOf('client.app_ship.9.9.9');
      expect(inc).toHaveLength(1);
      expect(inc[0]).toMatchObject({ severity: 'WARNING', status: 'NEW' });
      await ingest.clientLogs(principal(randomUUID(), 'FOOD'), [entry({ kind: 'MAP_ERROR', code: 'TILE' }), entry({ kind: 'PUSH_ERROR', code: 'FCM_TOKEN', at: Date.now() - 1500 })]);
      expect((await q<Json>(`SELECT DISTINCT source FROM app.ops_events WHERE kind IN ('MAP_ERROR','PUSH_ERROR') ORDER BY 1`)).map((r) => r.source)).toEqual(['M14', 'NOTIFICATIONS']);
      expect(await incidentOf('notifications')).toHaveLength(0);
    });

    it('version reports tell what devices REPORTED; a published release nobody reported is "available", never "installed"', async () => {
      const u = randomUUID();
      await ingest.versionReport(principal(u), { component: 'SHIP', versionName: '1.0.0', versionCode: 10 });
      await expect(ingest.versionReport(principal(u, 'FOOD'), { component: 'SHIP', versionName: '1.0.0', versionCode: 10 })).rejects.toBeTruthy();
      const view = dataOf1(await aget(systemLogin(), '/releases'));
      const ship = (view.components as Json[]).find((c) => c.component === 'SHIP')!;
      expect(ship.running).toMatchObject({ version_name: '1.0.0', reporters: 1 });
      const food = (view.components as Json[]).find((c) => c.component === 'FOOD')!;
      expect(food.running).toBeNull();
      expect(food.status).toBe('NO_RELEASE');
    });
  });

  // ---------------------------------------------------------------- releases and updates
  describe('releases and Android updates (design section 12)', () => {
    const apk = (name: string, bytes: Buffer): { sha: string } => {
      writeFileSync(path.join(artifactDir, name), bytes);
      return { sha: createHash('sha256').update(bytes).digest('hex') };
    };
    const body = (o: Json = {}): Json => ({ component: 'SHIP', version_name: '1.1.0', version_code: 11, release_notes: 'Cải thiện hiệu năng', artifact_name: 'ship-1.1.0.apk', priority: 'RECOMMENDED', has_db_migration: false, ...o });
    const check = (component: string, code: number) => api(admin.running.baseUrl, 'GET', `/app-updates/check?component=${component}&version_code=${code}`);

    it('registers a draft measured from the server file; refuses paths, missing files and duplicates; offers nothing until published', async () => {
      const { sha } = apk('ship-1.1.0.apk', Buffer.from('APK-BYTES-ONE'));
      for (const bad of ['../etc/passwd', 'a/b.apk', '/etc/passwd', 'x y.apk']) {
        expect((await apost(systemLogin(), '/releases', body({ artifact_name: bad }))).status).toBe(400);
      }
      expect(code(await apost(systemLogin(), '/releases', body({ artifact_name: 'missing.apk' })))).toEqual({ status: 400, code: 'OPS_ARTIFACT_INVALID' });
      const created = await apost(systemLogin(), '/releases', body());
      expect(created.status).toBe(200);
      const r = adminData(created) as Json;
      expect(r).toMatchObject({ status: 'DRAFT', component: 'SHIP', artifact: { name: 'ship-1.1.0.apk', sha256: sha, size_bytes: 13 } });
      expect(code(await apost(systemLogin(), '/releases', body()))).toEqual({ status: 409, code: 'OPS_RELEASE_CONFLICT' });
      expect(dataOf((await check('SHIP', 10))).update_available).toBe(false);
      expect((await apost(systemLogin(), '/releases', body({ component: 'GATEWAY', version_name: '2.0', artifact_name: undefined }))).status).toBe(400);
      expect((await apost(systemLogin(), '/releases', body({ priority: 'REQUIRED', version_name: '1.2.0' }))).status).toBe(400);
    });

    it('publish re-checks the file; a published release is offered, downloaded with its checksum, and an altered file is refused', async () => {
      const bytes = Buffer.from('APK-BYTES-TWO-'.repeat(50));
      const { sha } = apk('ship-1.1.0.apk', bytes);
      const rel = adminData(await apost(systemLogin(), '/releases', body())) as Json;
      appendFileSync(path.join(artifactDir, 'ship-1.1.0.apk'), 'tamper');
      expect(code(await apost(systemLogin(), `/releases/${rel.release_id}/publish`, { expected_version: rel.version }))).toEqual({ status: 400, code: 'OPS_ARTIFACT_INVALID' });
      apk('ship-1.1.0.apk', bytes);
      expect(code(await apost(systemLogin(), `/releases/${rel.release_id}/publish`, { expected_version: 99 }))).toEqual({ status: 409, code: 'VERSION_CONFLICT' });
      const pub = await apost(systemLogin(), `/releases/${rel.release_id}/publish`, { expected_version: rel.version });
      expect(adminData(pub)).toMatchObject({ status: 'PUBLISHED' });
      const offer = dataOf(await check('SHIP', 10));
      expect(offer).toMatchObject({ update_available: true, required: false, release: { version_code: 11, sha256: sha } });
      expect(dataOf(await check('SHIP', 11)).update_available).toBe(false);
      const dl = await fetch(`${admin.running.baseUrl}${(offer.release as Json).download_path}`);
      expect(dl.status).toBe(200);
      expect(dl.headers.get('x-checksum-sha256')).toBe(sha);
      const got = Buffer.from(await dl.arrayBuffer());
      expect(createHash('sha256').update(got).digest('hex')).toBe(sha);
      appendFileSync(path.join(artifactDir, 'ship-1.1.0.apk'), 'x');
      expect((await fetch(`${admin.running.baseUrl}${(offer.release as Json).download_path}`)).status).toBe(400);
      apk('ship-1.1.0.apk', bytes);
      const wd = await apost(systemLogin(), `/releases/${rel.release_id}/withdraw`, { expected_version: (adminData(pub) as Json).version });
      expect(adminData(wd)).toMatchObject({ status: 'WITHDRAWN' });
      expect(dataOf(await check('SHIP', 10)).update_available).toBe(false);
      expect((await fetch(`${admin.running.baseUrl}/v1/app-updates/download/${rel.release_id}`)).status).toBe(404);
      expect((await fetch(`${admin.running.baseUrl}/v1/app-updates/download/not-an-id`)).status).toBe(400);
    });

    it('REQUIRED blocks only builds below the stated minimum; a database migration is flagged as not auto-rollbackable; a gateway file is not served on the public route', async () => {
      apk('ship-2.0.0.apk', Buffer.from('APK-V2'));
      const rel = adminData(await apost(systemLogin(), '/releases', body({ version_name: '2.0.0', version_code: 20, artifact_name: 'ship-2.0.0.apk', priority: 'REQUIRED', required_reason: 'Sửa lỗi bảo mật', min_supported_version_code: 15, has_db_migration: true }))) as Json;
      expect(rel.rollback_warning).toContain('cần đánh giá riêng');
      await apost(systemLogin(), `/releases/${rel.release_id}/publish`, { expected_version: rel.version });
      expect(dataOf(await check('SHIP', 12))).toMatchObject({ update_available: true, required: true, reason: 'Sửa lỗi bảo mật' });
      expect(dataOf(await check('SHIP', 16))).toMatchObject({ update_available: true, required: false });
      apk('gw-3.apk', Buffer.from('GW-APK'));
      const gw = adminData(await apost(systemLogin(), '/releases', body({ component: 'GATEWAY', version_name: '3.0.0', version_code: 30, artifact_name: 'gw-3.apk' }))) as Json;
      await apost(systemLogin(), `/releases/${gw.release_id}/publish`, { expected_version: gw.version });
      expect((await fetch(`${admin.running.baseUrl}/v1/app-updates/download/${gw.release_id}`)).status).toBe(404);
      expect((await api(admin.running.baseUrl, 'GET', '/app-updates/check?component=GATEWAY&version_code=1')).status).toBe(400);
    });

    it('the Gateway is offered an update only when it is idle with nothing unreported, and is refused the file otherwise', async () => {
      await sql('DELETE FROM app.sms_gateway_devices');
      const out: string[] = [];
      await runSmsGatewayCli({ env: adminTestEnv(), argv: ['pair', '--label', 'Gateway upd'], out: (l) => out.push(l), err: () => undefined });
      const token = /: ([A-Za-z0-9_-]{43})$/.exec(out[1]!)![1]!;
      apk('gw-4.apk', Buffer.from('GW-APK-4'));
      const gw = adminData(await apost(systemLogin(), '/releases', body({ component: 'GATEWAY', version_name: '4.0.0', version_code: 40, artifact_name: 'gw-4.apk' }))) as Json;
      await apost(systemLogin(), `/releases/${gw.release_id}/publish`, { expected_version: gw.version });
      const beat = async (b: Record<string, unknown>) => dataOf(await api(admin.running.baseUrl, 'POST', '/sms-gateway/heartbeat', { bearer: token, body: { app_version: '3.0.0', app_version_code: 30, ...b } }));
      const busy = await beat({ paused: false, pending_reports: 1, current_task: 'SENDING' });
      expect(busy.update).toMatchObject({ version_code: 40, ready: false });
      const file = (paused: string) => fetch(`${admin.running.baseUrl}/v1/sms-gateway/update/${gw.release_id}?paused=${paused}`, { headers: { authorization: `Bearer ${token}` } });
      expect((await file('false')).status).toBe(409);
      const idle = await beat({ paused: true, pending_reports: 0, current_task: 'IDLE' });
      expect(idle.update).toMatchObject({ ready: true });
      const ok = await file('true');
      expect(ok.status).toBe(200);
      expect(Buffer.from(await ok.arrayBuffer()).toString()).toBe('GW-APK-4');
      expect((await fetch(`${admin.running.baseUrl}/v1/sms-gateway/update/${gw.release_id}?paused=true`)).status).toBe(401);
      expect((await beat({ paused: true, pending_reports: 0, current_task: 'IDLE', app_version_code: 40 })).update).toBeUndefined();
    });
  });

  describe('operator tool for the machine credentials', () => {
    const ctl = async (...argv: string[]) => {
      const out: string[] = [];
      const err: string[] = [];
      const c = await runOpsCli({ env: adminTestEnv(), argv, out: (l) => out.push(l), err: (l) => err.push(l) });
      return { c, out, err };
    };
    it('creates a credential of ONE scope, shows it once, stores only its digest, lists and revokes it', async () => {
      const made = await ctl('ingest-key', 'create', '--label', 'Probe test', '--scope', 'PROBE');
      expect(made.c).toBe(0);
      const secret = /: ([A-Za-z0-9_-]{43})$/.exec(made.out[1]!)![1]!;
      const keyId = /created key ([0-9a-f-]{36})/.exec(made.out[0]!)![1]!;
      const stored = await q<Json>(`SELECT credential_digest, scope FROM app.ops_ingest_keys WHERE key_id = $1::uuid`, [keyId]);
      expect(stored[0]!.credential_digest).toBe(createHash('sha256').update(secret).digest('hex'));
      expect(JSON.stringify(stored)).not.toContain(secret);
      const post = (path: string) => api(admin.running.baseUrl, 'POST', `/ops/ingest/${path}`, { bearer: secret, body: path === 'probe' ? { reported_at: new Date().toISOString() } : { kind: 'BACKUP', ok: true, finished_at: new Date().toISOString() } });
      expect((await post('probe')).status).toBe(200);
      expect((await post('backup')).status).toBe(401);
      expect((await ctl('ingest-key', 'list')).out.join('\n')).toContain(keyId);
      expect((await ctl('ingest-key', 'revoke', '--key-id', keyId)).c).toBe(0);
      expect((await post('probe')).status).toBe(401);
      expect((await ctl('ingest-key', 'create', '--label', 'x', '--scope', 'ROOT')).c).toBe(2);
      expect((await ctl('ingest-key', 'revoke', '--key-id', 'nope')).c).toBe(2);
      expect((await ctl('nope')).c).toBe(2);
    });
  });

  // ---------------------------------------------------------------- permissions and secrets
  describe('permissions and secrets (design sections 2 and 8)', () => {
    it('an ADMIN without a grant sees nothing; VIEW reads but cannot act; HANDLE acts but cannot configure; only SYSTEM sees the admin log', async () => {
      const who = await adminWith();
      await observe(report('t13.perm', 'WARNING'));
      const [i] = await incidentOf('t13.perm');
      expect(code(await aget(who.login, '/overview'))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
      expect(code(await aget(who.login, '/incidents'))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
      expect((await apost(systemLogin(), '/access', { user_id: who.userId, level: 'VIEW', expected_version: 0 })).status).toBe(200);
      expect((await aget(who.login, '/overview')).status).toBe(200);
      expect((await aget(who.login, '/incidents')).status).toBe(200);
      expect(code(await apost(who.login, `/incidents/${i!.incident_id}/acknowledge`, { expected_version: i!.version }))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
      expect(adminData(await aget(who.login, `/incidents/${i!.incident_id}`)).actions).toMatchObject({ acknowledge: false, close: false, assign: false });
      expect((await apost(systemLogin(), '/access', { user_id: who.userId, level: 'HANDLE', expected_version: 1 })).status).toBe(200);
      expect((await apost(who.login, `/incidents/${i!.incident_id}/note`, { text: 'đã gọi nhà mạng' })).status).toBe(200);
      expect((await apost(who.login, `/incidents/${i!.incident_id}/acknowledge`, { expected_version: i!.version })).status).toBe(200);
      const cfgBody = { expected_version: 0, settings: {}, discord_enabled: false, discord_min_severity: 'WARNING' };
      expect(code(await apost(who.login, '/config', cfgBody))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
      expect(code(await apost(who.login, '/maintenance', { scopes: ['API'], reason: 'thử', ends_at: new Date(Date.now() + 60_000).toISOString() }))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
      expect(code(await apost(who.login, '/releases', { component: 'SHIP', version_name: '9.9.9', version_code: 99, release_notes: 'x', artifact_name: 'x.apk', priority: 'NORMAL', has_db_migration: false }))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
      expect(code(await apost(who.login, '/access', { user_id: who.userId, level: 'HANDLE', expected_version: 2 }))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
      expect(code(await aget(who.login, '/logs?group=ADMIN'))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
      expect((await aget(who.login, '/logs?group=INCIDENT')).status).toBe(200);
      expect((await apost(systemLogin(), '/access', { user_id: who.userId, level: 'NONE', expected_version: 2 })).status).toBe(200);
      expect(code(await aget(who.login, '/overview'))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
      expect(code(await aget({ cookie: '', csrf: '' }, '/overview')).status).toBe(401);
      expect(code(await apost(systemLogin(), '/access', { user_id: system.account.userId, level: 'VIEW', expected_version: 0 }))).toEqual({ status: 404, code: 'OPS_TARGET_NOT_FOUND' });
    });

    it('the webhook is never returned, logged or audited; only the fact that it changed is recorded', async () => {
      await configureDiscord();
      const seen: string[] = [];
      for (const p of ['/config', '/overview', '/gateway', '/releases', '/logs?group=ADMIN', '/logs?group=TECHNICAL']) seen.push((await aget(systemLogin(), p)).text);
      const cfg = dataOf1(await aget(systemLogin(), '/config')).config as Json;
      expect(cfg.discord).toMatchObject({ enabled: true, webhook_configured: true, webhook_masked: '••••••••••••••••' });
      const upd = await apost(systemLogin(), '/config', { expected_version: cfg.version, settings: {}, discord_enabled: true, discord_min_severity: 'CRITICAL', webhook: HOOK.replace('SECRETTOKEN01', 'SECRETTOKEN02') });
      seen.push(upd.text);
      for (const text of seen) {
        expect(text).not.toContain('SECRETTOKEN');
        expect(text).not.toContain('webhooks/123456789012345678');
      }
      const stored = await q<Json>(`SELECT encode(webhook_ciphertext, 'hex') AS c FROM app.ops_config`);
      expect(String(stored[0]!.c)).not.toContain(Buffer.from('SECRETTOKEN').toString('hex'));
      expect(String(stored[0]!.c)).not.toContain(Buffer.from('discord.com').toString('hex'));
      const audit = await q<Json>(`SELECT metadata::text AS m FROM app.audit_logs WHERE action = 'admin.ops.config.update.v1' ORDER BY occurred_at DESC LIMIT 2`);
      expect(audit.length).toBeGreaterThan(0);
      for (const a of audit) expect(String(a.m)).not.toMatch(/SECRETTOKEN|discord\.com/);
      expect(JSON.stringify(audit[0])).toContain('webhook_changed');
      const events = await q<Json>(`SELECT detail::text AS d, message FROM app.ops_events WHERE category = 'ADMIN'`);
      expect(events.length).toBeGreaterThan(0);
      for (const e of events) expect(`${e.d}${e.message}`).not.toMatch(/SECRETTOKEN|discord\.com/);
      expect(code(await apost(systemLogin(), '/config', { expected_version: (adminData(upd) as Json).version, settings: {}, discord_enabled: true, discord_min_severity: 'WARNING', webhook: 'https://evil.example/api/webhooks/123456789012345678/AbCdEfGhIjKlMnOpQrStUvWx' }))).toEqual({ status: 400, code: 'OPS_WEBHOOK_INVALID' });
      const removed = await apost(systemLogin(), '/config', { expected_version: (adminData(upd) as Json).version, settings: {}, discord_enabled: false, discord_min_severity: 'WARNING', webhook: null });
      expect(((adminData(removed) as Json).discord as Json).webhook_configured).toBe(false);
    });

    it('a replayed write returns the first answer and writes nothing twice', async () => {
      const key = randomUUID();
      const a = await apost(systemLogin(), '/access', { user_id: (await adminWith()).userId, level: 'VIEW', expected_version: 0 }, key);
      expect(a.status).toBe(200);
      const before = (await q<Json>(`SELECT count(*)::int AS n FROM app.audit_logs WHERE action = 'admin.ops.access.set.v1'`))[0]!.n;
      const again = await admin.call('POST', '/ops/access', { basePath: '/v1/admin', body: { user_id: (adminData(a) as Json).user_id, level: 'VIEW', expected_version: 0 }, cookies: sessionCookies(systemLogin()), csrf: systemLogin().csrf, headers: { 'idempotency-key': key } });
      expect(again.status).toBe(200);
      expect((await q<Json>(`SELECT count(*)::int AS n FROM app.audit_logs WHERE action = 'admin.ops.access.set.v1'`))[0]!.n).toBe(before);
    });
  });

  // ---------------------------------------------------------------- logs and retention
  describe('log: append-only, bounded retention, business data untouched (design section 11)', () => {
    it('refuses UPDATE, DELETE outside the retention pass and TRUNCATE', async () => {
      await sql(`INSERT INTO app.ops_events (event_id, occurred_at, category, level, source, environment, message, detail) VALUES ($1::uuid, now(), 'TECHNICAL', 'INFO', 'API', 'test', 'x', '{}')`, [randomUUID()]);
      await expect(sql(`UPDATE app.ops_events SET message = 'edited'`)).rejects.toThrow(/append-only/);
      await expect(sql(`DELETE FROM app.ops_events`)).rejects.toThrow(/retention pass/);
      await expect(sql(`TRUNCATE app.ops_events`)).rejects.toThrow(/never truncated/);
    });

    it('purges by class and age with the configured days, folds metrics, and never touches business tables or the audit log', async () => {
      const ins = (category: string, level: string, days: number) =>
        sql(`INSERT INTO app.ops_events (event_id, occurred_at, category, level, source, environment, message, detail${category === 'INCIDENT' ? ', incident_id' : ''}) VALUES ($1::uuid, now() - make_interval(days => $2), $3, $4, 'API', 'test', 'm', '{}'${category === 'INCIDENT' ? ', (SELECT incident_id FROM app.ops_incidents LIMIT 1)' : ''})`, [randomUUID(), days, category, level]);
      await observe(report('t13.ret', 'WARNING'));
      await ins('TECHNICAL', 'INFO', 31);
      await ins('TECHNICAL', 'INFO', 29);
      await ins('TECHNICAL', 'ERROR', 91);
      await ins('TECHNICAL', 'ERROR', 31);
      await ins('ADMIN', 'INFO', 366);
      await ins('ADMIN', 'INFO', 364);
      await sql(`INSERT INTO app.ops_metrics (metric_key, observed_at, value) VALUES ('cpu_percent', now() - interval '8 days', 50), ('cpu_percent', now() - interval '8 days' + interval '5 minutes', 70), ('cpu_percent', now() - interval '1 hour', 10)`);
      const business = async () => (await q<Json>(`SELECT (SELECT count(*) FROM app.users)::int u, (SELECT count(*) FROM app.audit_logs)::int a, (SELECT count(*) FROM app.deliveries)::int d, (SELECT count(*) FROM app.wallet_ledger_entries)::int w`))[0];
      const before = await business();
      const result = await get<OpsRetention>(OpsRetention as never).runOnce();
      expect(result.events).toBeGreaterThanOrEqual(2);
      expect(result.adminEvents).toBe(1);
      const left = await q<Json>(`SELECT category, level, count(*)::int n FROM app.ops_events WHERE message = 'm' GROUP BY 1, 2 ORDER BY 1, 2`);
      expect(left.map((r) => `${r.category}:${r.level}:${r.n}`)).toEqual(['ADMIN:INFO:1', 'TECHNICAL:ERROR:1', 'TECHNICAL:INFO:1']);
      expect(await q(`SELECT 1 FROM app.ops_metrics WHERE value IN (50, 70)`)).toHaveLength(0);
      expect(await q(`SELECT 1 FROM app.ops_metrics_hourly WHERE metric_key = 'cpu_percent' AND samples = 2 AND max_value = 70`)).toHaveLength(1);
      expect(await q(`SELECT 1 FROM app.ops_metrics WHERE value = 10`)).toHaveLength(1);
      expect(await business()).toEqual(before);
    });

    it('closed incidents expire with their log and Discord rows after the incident window', async () => {
      await observe(report('t13.old', 'WARNING'));
      await observe(report('t13.old', 'OK'));
      const [i] = await incidentOf('t13.old');
      await sql(`UPDATE app.ops_incidents SET status = 'CLOSED', closed_at = now() - interval '400 days' WHERE incident_id = $1::uuid`, [i!.incident_id]);
      const r = await get<OpsRetention>(OpsRetention as never).runOnce();
      expect(r.incidents).toBe(1);
      expect(await incidentOf('t13.old')).toHaveLength(0);
      expect(await q(`SELECT 1 FROM app.ops_events WHERE incident_id = $1::uuid`, [i!.incident_id])).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------- listing
  describe('incident list and log filters', () => {
    it('filters by severity, source, status and assignee; pages; searches by code; validates input', async () => {
      await observe(report('t13.l1', 'WARNING', { source: 'API' }));
      await observe(report('t13.l2', 'CRITICAL', { source: 'DATABASE' }));
      await observe(report('t13.l3', 'CRITICAL', { source: 'DATABASE' }));
      await observe(report('t13.l3', 'OK'));
      const list = async (qs: string): Promise<Json> => dataOf1(await aget(systemLogin(), `/incidents${qs}`));
      expect((await list('')).total).toBe(3);
      expect((await list('?severity=CRITICAL&status=OPEN')).total).toBe(1);
      expect((await list('?source=DATABASE')).total).toBe(2);
      expect((await list('?status=RECOVERED')).total).toBe(1);
      expect((await list('?assignee=NONE&limit=1')).items).toHaveLength(1);
      expect((await list('?limit=1&offset=2')).items).toHaveLength(1);
      const [one] = await incidentOf('t13.l1');
      expect(((await list(`?q=SC-${String(one!.code_seq).padStart(3, '0')}`)).items as Json[])[0]!.check_key).toBe('t13.l1');
      for (const bad of ['?severity=BAD', '?source=NOPE', '?status=WEIRD', '?limit=0', '?limit=500', '?x=1', '?q=hello', `?assignee=notuuid`]) expect((await aget(systemLogin(), `/incidents${bad}`)).status).toBe(400);
      expect(code(await aget(systemLogin(), `/incidents/SC-9999`))).toEqual({ status: 404, code: 'OPS_INCIDENT_NOT_FOUND' });
      const detail = dataOf1(await aget(systemLogin(), `/incidents/${one!.incident_id}`));
      expect(detail).toMatchObject({ code: expect.stringMatching(/^SC-/), read_note: expect.stringContaining('không đồng nghĩa') });
      expect((detail.timeline as Json[]).map((t) => t.kind)).toContain('DETECTED');
      expect((await aget(systemLogin(), '/logs?group=INCIDENT&source=API&level=WARN')).status).toBe(200);
      expect((await aget(systemLogin(), '/logs?group=NOPE')).status).toBe(400);
    });
  });

  it('M13 does not change orders, wallets, fees or auth rows', async () => {
    const snap = async () => (await q<Json>(`SELECT (SELECT count(*) FROM app.deliveries)::int d, (SELECT count(*) FROM app.delivery_assignments)::int a, (SELECT count(*) FROM app.wallet_ledger_entries)::int l, (SELECT count(*) FROM app.driver_wallets)::int w, (SELECT count(*) FROM app.sms_jobs)::int j`))[0];
    const before = await snap();
    await configureDiscord();
    await observe(report('t13.noop', 'CRITICAL'));
    await collector.collectOnce();
    await dispatcher.runOnce();
    await sweep();
    expect(await snap()).toEqual(before);
  });
});
