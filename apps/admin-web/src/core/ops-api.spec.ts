import { describe, expect, it } from '@jest/globals';
import { Transport, TransportRequest, TransportResponse } from './api';
import { AdminOpsApi, createOpsSource, parseConfig, parseVps, parseGateway, parseIncidentDetail, parseLogs, parseOverview, parseReleases } from './ops-api';
import { DEFAULT_INCIDENT_QUERY, NOT_WIRED_OPS, STATE_LABEL, formatBytes, formatUptime, splitSegments } from './ops';

const ID = '11111111-1111-4111-8111-111111111111';
const AT = '2026-10-18T06:50:00.000Z';
const reply = (status: number, body: unknown): TransportResponse => ({ status, header: () => null, json: () => Promise.resolve(body) });
const err = (code: string) => ({ error: { code, message: 'x', request_id: 'r', details: {} } });
const incident = (over: Record<string, unknown> = {}) => ({
  incident_id: ID, code: 'SC-013', source: 'SMS_GATEWAY', source_label: 'SMS Gateway', check_key: 'k', severity: 'CRITICAL', status: 'NEW', title: 'Gateway mất liên lạc', impact: 'OTP chậm', detected_by: 'INTERNAL',
  first_seen_at: AT, last_seen_at: AT, occurrences: 2, assignee_label: null, acknowledged_at: null, first_viewed_at: null, recovered_at: null, closed_at: null, closed_while_failing: false,
  snoozed_until: null, in_maintenance: false, check_state: 'CRITICAL', version: 1, ...over,
});
const probe = (over: Record<string, unknown> = {}) => ({ status: 'NOT_CONFIGURED', activated: false, state: null, label: 'Chưa cấu hình', active_key_count: 0, last_report_at: null, last_key_used_at: null, last_outage_at: null, last_public_api_status: null, public_api: null, runbook_path: 'ops/runbooks/m13-external-probe-20261023.md', discord_webhook_status: 'EXTERNAL_HOST_ONLY', note: 'n', webhook_note: 'Webhook Discord của probe lưu riêng trên máy probe', ...over });
const overview = (over: Record<string, unknown> = {}) => ({
  updated_at: AT, data_note: null, components: [{ key: 'api', label: 'API', state: 'OK', state_label: 'Hoạt động', detail: null, note: null, observed_at: AT }, { key: 'backup', label: 'Sao lưu', state: 'NO_DATA', detail: null, note: null, observed_at: null }],
  incidents: { open: 1, critical: 1, unacknowledged: 1, items: [incident()] }, external_probe: probe(), vps: null,
  discord: { enabled: false, configured: false, pending: 0, failed_7d: 0, last_sent_at: null }, maintenance_active: [], last_update: null, viewer: { level: 'SYSTEM' }, ...over,
});
function scripted(...answers: (TransportResponse | 'throw')[]): { transport: Transport; requests: TransportRequest[] } {
  const requests: TransportRequest[] = [];
  const queue = [...answers];
  return { requests, transport: (request) => { requests.push(request); const next = queue.shift(); return next === 'throw' || next === undefined ? Promise.reject(new Error('down')) : Promise.resolve(next); } };
}

describe('M13 operations administration client', () => {
  it('parses the overview strictly; "no data" stays "no data" and an unknown state is refused', () => {
    const parsed = parseOverview(overview());
    expect(parsed?.components.map((c) => c.state)).toEqual(['OK', 'NO_DATA']);
    expect(STATE_LABEL.NO_DATA).toBe('Chưa có dữ liệu');
    expect(parsed?.probe).toMatchObject({ status: 'NOT_CONFIGURED', activated: false, activeKeyCount: 0, runbookPath: 'ops/runbooks/m13-external-probe-20261023.md' });
    expect(parsed?.vps).toBeNull();
    expect(parseOverview(overview({ components: [{ key: 'api', label: 'API', state: 'FINE' }] }))).toBeUndefined();
    expect(parseOverview(overview({ incidents: { open: 1, critical: 1, unacknowledged: 1, items: [incident({ status: 'WEIRD' })] } }))).toBeUndefined();
    expect(parseOverview(overview({ viewer: { level: 'ROOT' } }))).toBeUndefined();
    expect(parseOverview({})).toBeUndefined();
  });

  it('G20-B: the probe has exactly four honest states, and an unknown one is refused instead of shown as configured', () => {
    for (const status of ['NOT_CONFIGURED', 'WAITING_FIRST_REPORT', 'ACTIVE', 'STALE']) {
      expect(parseOverview(overview({ external_probe: probe({ status, activated: status === 'ACTIVE' || status === 'STALE', active_key_count: 1, last_report_at: AT, last_outage_at: AT }) }))?.probe).toMatchObject({ status, lastReportAt: AT, lastOutageAt: AT });
    }
    expect(parseOverview(overview({ external_probe: probe({ status: 'CONFIGURED' }) }))).toBeUndefined();
    expect(parseOverview(overview({ external_probe: probe({ last_report_at: 'not a date' }) }))).toBeUndefined();
    const withCard = parseOverview(overview({ vps: { collector_stale: true, collector_state: 'STALE', last_sample_at: AT, cpu_percent: 12.5, memory_percent: 40, disk_percent: 55, uptime_seconds: 90, db_connections: 4, db_size_bytes: 2048 } }));
    expect(withCard?.vps).toMatchObject({ collectorStale: true, collectorState: 'STALE', cpuPercent: 12.5, dbConnections: 4 });
    expect(parseConfig({ updated_at: AT, viewer: { level: 'VIEW' }, maintenance: [], access: null, external_probe: probe({ status: 'WAITING_FIRST_REPORT' }), config: { version: 1, editable: false, settings: [], discord: null } })?.probe?.status).toBe('WAITING_FIRST_REPORT');
  });

  it('G20-A: the VPS page is parsed strictly and its request carries only the documented range', async () => {
    const page = {
      updated_at: AT, range: '1h', expected_step_seconds: 60, gap_count: 1, gaps: [{ from: AT, to: AT }], viewer: { level: 'VIEW' },
      collector: { state: 'STALE', collector_stale: true, last_sample_at: AT, stale_after_seconds: 180, message: 'Mất tín hiệu bộ thu thập > 3 phút' },
      host: { uptime_seconds: 100, cpu_percent: 5, cpu_cores: 2, load_avg: [0.1, 0.2, 0.3], memory: { total_bytes: 10, available_bytes: 4, used_bytes: 6, used_percent: 60 }, swap: null, disks: [{ label: 'root', path: '/', total_bytes: 10, free_bytes: 5, used_bytes: 5, used_percent: 50 }], io: null, network: { rx_bytes_total: 1, tx_bytes_total: 2, rx_bytes_per_sec: null, tx_bytes_per_sec: 4 } },
      backend: { status: 'OK', pid: 7, uptime_seconds: 9, rss_bytes: 1, heap_used_bytes: 1, cpu_percent: null, self_health_latency_ms: 3 },
      postgres: { status: 'CRITICAL', latency_ms: null, active_connections: 2, database_size_bytes: 99 },
      processes_by_cpu: [{ pid: 1, name: 'node', cpu_percent: null, rss_bytes: 10, memory_percent: 1 }], processes_by_memory: [],
      series: { cpu_percent: [{ at: AT, value: 5, max: 6 }] },
    };
    const parsed = parseVps(page);
    expect(parsed).toMatchObject({ range: '1h', gapCount: 1, collector: { stale: true }, backend: { status: 'OK' }, postgres: { status: 'CRITICAL', latencyMs: null }, host: { cpuCores: 2, network: { rxBytesPerSec: null, txBytesPerSec: 4 } } });
    expect(parsed?.series.cpu_percent).toEqual([{ at: AT, value: 5 }]);
    expect(parseVps({ ...page, range: '2d' })).toBeUndefined();
    expect(parseVps({ ...page, series: { cpu_percent: [{ at: AT, value: 'x' }] } })).toBeUndefined();
    expect(parseVps({ ...page, processes_by_cpu: [{ pid: 1 }] })).toBeUndefined();
    const { transport, requests } = scripted(reply(200, { data: page }), reply(403, err('ADMIN_FORBIDDEN')));
    const source = createOpsSource(new AdminOpsApi(transport));
    expect((await source.vps('24h')).kind).toBe('ready');
    expect(requests[0]).toMatchObject({ method: 'GET', path: '/admin/ops/vps?range=24h' });
    expect(await source.vps('7d')).toEqual({ kind: 'failed', failure: 'forbidden' });
    expect(await NOT_WIRED_OPS.vps('1h')).toEqual({ kind: 'failed', failure: 'unknown' });
  });

  it('G20-A: a chart line stops at a hole in the samples and formats stay readable', () => {
    const at = (m: number) => ({ at: new Date(Date.UTC(2026, 9, 30, 12, m)).toISOString(), value: m });
    expect(splitSegments([at(0), at(1), at(2), at(9), at(10)], 60).map((run) => run.length)).toEqual([3, 2]);
    expect(splitSegments([at(0), at(1), at(2)], 60)).toHaveLength(1);
    expect(splitSegments([], 60)).toEqual([]);
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatUptime(90_000)).toBe('1 ngày 1 giờ');
  });


  it('parses an incident detail with timeline, Discord history, the real check state and the allowed actions', () => {
    const detail = {
      ...incident(), evidence_text: 'Không nhận được tín hiệu từ Gateway', evidence: {}, read_note: 'Đã đọc không đồng nghĩa đã xử lý.',
      current_check: { state: 'CRITICAL', label: 'Nghiêm trọng', observed_at: AT, evidence: 'Không nhận được tín hiệu từ Gateway', value: { silent_seconds: 400 } },
      timeline: [{ at: AT, code: 'DETECTED', level: 'ERROR', message: 'Gateway mất liên lạc', actor_label: null }],
      notifications: [{ kind_label: 'Sự cố mới', outcome_text: 'Đã gửi', attempts: 1, created_at: AT, sent_at: AT, last_error_code: null }], recent_errors: [], link: null,
      actions: { acknowledge: true, start: true, note: true, snooze: true, close: true, assign: false },
    };
    expect(parseIncidentDetail(detail)).toMatchObject({ incident: { code: 'SC-013', severity: 'CRITICAL' }, currentCheck: { state: 'CRITICAL' }, actions: { acknowledge: true, assign: false }, timeline: [{ kind: 'DETECTED' }] });
    expect(parseIncidentDetail({ ...detail, actions: undefined })).toBeUndefined();
    expect(parseIncidentDetail({ ...detail, current_check: { state: 'GREEN' } })).toBeUndefined();
  });

  it('parses the gateway page: unreported values stay null ("Chưa xác định") and a SIM balance is never invented', () => {
    const chk = { state: 'NO_DATA', label: 'x', observed_at: null, evidence: null, value: {} };
    const page = {
      updated_at: AT, viewer: { level: 'VIEW' }, maintenance: [], discord: null,
      devices: [{ device_id: ID, label: 'Gateway 01', state: 'OK', last_contact_at: AT, app_version: '1.0.3', sms_permission: true, paused: false, battery_percent: null, charging: null, sim_state_label: 'Chưa xác định', sim_balance_label: 'Chưa xác định', topup_noted_on: null, pending_reports: null, current_task: null, last_error_code: null, telemetry_at: null, checks: { contact: chk, battery: chk, power: chk, sms_failures: chk } }],
      queue: { queued: 0, claimed: 0, failed_last_hour: 0, otp_check: chk, purposes_label: 'Đăng ký / Quên mật khẩu', jobs: [] },
    };
    const parsed = parseGateway(page);
    expect(parsed?.devices[0]).toMatchObject({ batteryPercent: null, charging: null, simBalanceLabel: 'Chưa xác định' });
    expect(parsed?.queue.purposesLabel).toBe('Đăng ký / Quên mật khẩu');
    expect(parseGateway({ ...page, devices: [{ device_id: ID }] })).toBeUndefined();
  });

  it('parses logs, releases and configuration; the webhook value is never part of the model', () => {
    expect(parseLogs({ items: [{ event_id: ID, at: AT, category: 'TECHNICAL', level: 'ERROR', source_label: 'API', environment: 'production', app_version: '1.0', code: 'X', message: 'm', request_ref: null, delivery_code: null, user_id: null, actor_label: null }], total: 1 })).toMatchObject({ total: 1 });
    expect(parseLogs({ items: [{ event_id: 'x' }], total: 1 })).toBeUndefined();
    const release = { release_id: ID, component: 'SHIP', component_label: '11Ship', version_name: '1.1.0', version_code: 11, release_notes: 'n', artifact: { name: 'a.apk', sha256: 'a'.repeat(64), size_bytes: 10 }, priority: 'NORMAL', required_reason: null, status: 'PUBLISHED', released_at: AT, has_db_migration: true, rollback_warning: 'cần đánh giá riêng', reporters_running: 0, version: 2 };
    const page = { updated_at: AT, viewer: { level: 'SYSTEM' }, components: [{ component: 'SHIP', label: '11Ship', running: null, published: release, status: 'NO_REPORT', status_label: 'Chưa có báo cáo phiên bản đang chạy' }], releases: { items: [release], total: 1, limit: 20, offset: 0 }, deploys: [], deploy_control: { available: false, missing: ['a'] }, gateway_update_rule: 'g', android_note: 'a', artifacts_available: true };
    expect(parseReleases(page)).toMatchObject({ deployControl: { available: false }, components: [{ running: null, status: 'NO_REPORT' }], releases: [{ rollbackWarning: 'cần đánh giá riêng' }] });
    expect(parseReleases({ ...page, deploy_control: { available: 'no' } })).toBeUndefined();
    // #193: the APK–backend compatibility of an app is read when present, and absent for components without one.
    const withCompat = { ...page, components: [{ ...page.components[0], compatibility: { contract_revision: 3, min_client_version_code: 30, ok: false, problem: 'COMPAT_NO_PUBLISHED_APK', summary: 'Backend yêu cầu bản 30 nhưng chưa có APK' } }] };
    expect(parseReleases(withCompat)?.components[0]?.compatibility).toEqual({ ok: false, minClientVersionCode: 30, summary: 'Backend yêu cầu bản 30 nhưng chưa có APK' });
    expect(parseReleases(page)?.components[0]?.compatibility).toBeNull();
    const cfg = { updated_at: AT, viewer: { level: 'SYSTEM' }, maintenance: [], access: [], config: { version: 1, editable: true, settings: [{ key: 'server.cpu_percent', group: 'server', label: 'CPU', unit: 'percent', value: 90, default: 90, min: 50, max: 100, impl_default: false }], discord: { enabled: true, min_severity: 'WARNING', webhook_configured: true, webhook_masked: '••••', webhook_updated_at: AT } } };
    const parsed = parseConfig(cfg);
    expect(parsed?.discord).toMatchObject({ webhookConfigured: true, webhookMasked: '••••' });
    expect(JSON.stringify(parsed)).not.toContain('discord.com');
    expect(parseConfig({ ...cfg, config: { ...cfg.config, settings: [{ key: 'x' }] } })).toBeUndefined();
  });

  it('writes: one request with the caller\'s key; a refusal maps to a plain result; an unknown outcome is "unknown" (never success); nothing is sent without a CSRF token', async () => {
    const { transport, requests } = scripted(reply(200, { data: {} }), reply(409, err('VERSION_CONFLICT')), reply(409, err('OPS_INCIDENT_STATE_CONFLICT')), reply(403, err('ADMIN_FORBIDDEN')), 'throw', reply(503, {}));
    const source = createOpsSource(new AdminOpsApi(transport), { csrf: () => 'csrf', refresh: async () => true });
    const action = { kind: 'acknowledge', version: 3 } as const;
    expect(await source.incidentAction(ID, 'key-1', action)).toEqual({ kind: 'ok', data: undefined });
    expect(requests[0]).toMatchObject({ method: 'POST', path: `/admin/ops/incidents/${ID}/acknowledge`, csrf: 'csrf', idempotencyKey: 'key-1', body: { expected_version: 3 } });
    expect((await source.incidentAction(ID, 'k', action)).kind).toBe('conflict');
    expect((await source.incidentAction(ID, 'k', action)).kind).toBe('state-conflict');
    expect((await source.incidentAction(ID, 'k', action)).kind).toBe('forbidden');
    expect((await source.incidentAction(ID, 'k', action)).kind).toBe('unknown');
    expect((await source.incidentAction(ID, 'k', action)).kind).toBe('unknown');
    const none = createOpsSource(new AdminOpsApi(scripted().transport), { csrf: () => undefined, refresh: async () => true });
    expect((await none.incidentAction(ID, 'k', action)).kind).toBe('session-expired');
    expect((await createOpsSource(new AdminOpsApi(scripted().transport)).incidentAction(ID, 'k', action)).kind).toBe('not-wired');
  });

  it('closing while the check still fails sends the confirmation and the reason; a plain close sends neither', async () => {
    const { transport, requests } = scripted(reply(200, { data: {} }), reply(200, { data: {} }));
    const source = createOpsSource(new AdminOpsApi(transport), { csrf: () => 'c', refresh: async () => true });
    await source.incidentAction(ID, 'a', { kind: 'close', version: 2, confirmStillFailing: true, note: 'đã báo nhà mạng' });
    await source.incidentAction(ID, 'b', { kind: 'close', version: 2, confirmStillFailing: false, note: '' });
    expect(requests[0]!.body).toEqual({ expected_version: 2, confirm_still_failing: true, note: 'đã báo nhà mạng' });
    expect(requests[1]!.body).toEqual({ expected_version: 2 });
  });

  it('the webhook is only ever sent (typed once), and "keep" sends no webhook field at all', async () => {
    const { transport, requests } = scripted(reply(200, { data: {} }), reply(200, { data: {} }), reply(200, { data: {} }), reply(200, { data: {} }));
    const source = createOpsSource(new AdminOpsApi(transport), { csrf: () => 'c', refresh: async () => true });
    const base = { key: 'k', version: 1, settings: {}, discordEnabled: true, minSeverity: 'WARNING' as const };
    await source.saveConfig({ ...base, webhook: undefined });
    await source.saveConfig({ ...base, webhook: null });
    await source.saveConfig({ ...base, webhook: 'https://discord.com/api/webhooks/1/x' });
    // A save is followed by one GET that re-reads the state; the POSTs are what matters here.
    const posts = requests.filter((r) => r.method === 'POST');
    expect('webhook' in (posts[0]!.body as object)).toBe(false);
    expect((posts[1]!.body as { webhook: unknown }).webhook).toBeNull();
    expect((posts[2]!.body as { webhook: string }).webhook).toContain('discord.com');
  });

  it('lists send the filters the page shows, and the not-wired source can neither read nor write', async () => {
    const { transport, requests } = scripted(reply(200, { data: { items: [], total: 0 } }));
    const source = createOpsSource(new AdminOpsApi(transport));
    await source.incidents({ ...DEFAULT_INCIDENT_QUERY, severity: 'CRITICAL', source: 'API', assignee: 'NONE', search: ' SC-013 ', page: 3 });
    expect(requests[0]!.path).toBe('/admin/ops/incidents?status=OPEN&severity=CRITICAL&source=API&assignee=NONE&q=SC-013&limit=20&offset=40');
    expect(await NOT_WIRED_OPS.overview()).toEqual({ kind: 'failed', failure: 'unknown' });
    expect((await NOT_WIRED_OPS.saveConfig({ key: 'k', version: 1, settings: {}, discordEnabled: false, minSeverity: 'WARNING', webhook: undefined })).kind).toBe('not-wired');
    expect((await NOT_WIRED_OPS.createRelease('k', {} as never)).kind).toBe('not-wired');
  });
});
