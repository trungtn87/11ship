// HTTP client of "Vận hành hệ thống" (M13): GET/POST /v1/admin/ops/*. Cookie-only (HttpOnly session, same origin); the CSRF token is passed in from memory. Every
// answer is parsed strictly: a body without the documented shape is "unknown", never half-shown data. Nothing is stored here. There is no call that deploys a
// server, runs a command, takes a path or a URL, or edits a log line; the Discord webhook is only ever SENT (typed once by SYSTEM) and never read back.

import { CsrfPort, failureOf } from './accounts-api.js';
import { ApiClient, ApiResult, record, str } from './api.js';
import {
  ComponentVersion,
  ConfigSave,
  DisplayState,
  GatewayCheck,
  GatewayDevice,
  GatewayPage,
  INCIDENT_STATUSES,
  IncidentAction,
  IncidentDetail,
  IncidentQuery,
  IncidentStatus,
  LogQuery,
  LogRow,
  MaintenanceDraft,
  NoticeRecord,
  OPS_PAGE_SIZE,
  OpsComponent,
  OpsConfigPage,
  OpsDeploy,
  OpsIncident,
  OpsLevel,
  OpsMaintenance,
  OpsOverview,
  OpsRead,
  OpsSource,
  OpsWrite,
  QueueJob,
  ReleaseDraft,
  ReleaseRow,
  ReleasesPage,
  SettingRow,
  TimelineEntry,
} from './ops.js';

/** The transport's base: this client's paths start with /admin. */
export const OPS_BASE = '/v1';

const STATES: readonly string[] = ['OK', 'WARNING', 'CRITICAL', 'NO_DATA', 'STALE'];
const whole = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const iso = (v: unknown): string | undefined => {
  const t = str(v);
  return t !== undefined && !Number.isNaN(Date.parse(t)) ? t : undefined;
};
const nIso = (v: unknown): string | null | undefined => (v === null || v === undefined ? null : iso(v) ?? undefined);
const nStr = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const nBool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
const nNum = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const state = (v: unknown): DisplayState | undefined => (typeof v === 'string' && STATES.includes(v) ? (v as DisplayState) : undefined);
const level = (v: unknown): OpsLevel | undefined => (v === 'SYSTEM' || v === 'HANDLE' || v === 'VIEW' || v === 'NONE' ? v : undefined);
const list = <T>(v: unknown, parse: (x: unknown) => T | undefined): T[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const out: T[] = [];
  for (const item of v) {
    const parsed = parse(item);
    if (parsed === undefined) return undefined;
    out.push(parsed);
  }
  return out;
};

function parseIncident(value: unknown): OpsIncident | undefined {
  const r = record(value);
  if (r === undefined) return undefined;
  const id = str(r.incident_id);
  const code = str(r.code);
  const status = typeof r.status === 'string' && (INCIDENT_STATUSES as readonly string[]).includes(r.status) ? (r.status as IncidentStatus) : undefined;
  const first = iso(r.first_seen_at);
  const last = iso(r.last_seen_at);
  const ack = nIso(r.acknowledged_at);
  const viewed = nIso(r.first_viewed_at);
  const recovered = nIso(r.recovered_at);
  const closed = nIso(r.closed_at);
  const snoozed = nIso(r.snoozed_until);
  const checkState = r.check_state === null || r.check_state === undefined ? null : state(r.check_state);
  if (id === undefined || code === undefined || status === undefined || first === undefined || last === undefined || ack === undefined || viewed === undefined || recovered === undefined || closed === undefined || snoozed === undefined || checkState === undefined) {
    return undefined;
  }
  if ((r.severity !== 'WARNING' && r.severity !== 'CRITICAL') || !whole(r.occurrences) || !whole(r.version) || str(r.title) === undefined) return undefined;
  return {
    id,
    code,
    source: str(r.source) ?? '',
    sourceLabel: str(r.source_label) ?? '',
    severity: r.severity,
    status,
    title: str(r.title) as string,
    impact: nStr(r.impact) ?? '',
    detectedBy: str(r.detected_by) ?? 'INTERNAL',
    firstSeenAt: first,
    lastSeenAt: last,
    occurrences: r.occurrences,
    assigneeLabel: nStr(r.assignee_label),
    acknowledgedAt: ack,
    firstViewedAt: viewed,
    recoveredAt: recovered,
    closedAt: closed,
    closedWhileFailing: r.closed_while_failing === true,
    snoozedUntil: snoozed,
    inMaintenance: r.in_maintenance === true,
    checkState,
    version: r.version,
  };
}

function parseDeploy(value: unknown): OpsDeploy | undefined {
  const r = record(value);
  const started = iso(r?.started_at);
  if (r === undefined || str(r.deploy_id) === undefined || started === undefined || str(r.to_version) === undefined || str(r.status) === undefined) return undefined;
  return { id: r.deploy_id as string, componentLabel: str(r.component_label) ?? str(r.component) ?? '', fromVersion: nStr(r.from_version), toVersion: r.to_version as string, status: r.status as string, hasDbMigration: r.has_db_migration === true, startedAt: started, finishedAt: nIso(r.finished_at) ?? null, healthResult: nStr(r.health_result), healthDetail: nStr(r.health_detail) };
}

function parseMaintenance(value: unknown): OpsMaintenance | undefined {
  const r = record(value);
  const starts = iso(r?.starts_at);
  const ends = iso(r?.ends_at);
  const st = r?.state;
  if (r === undefined || str(r.maintenance_id) === undefined || starts === undefined || ends === undefined || !(st === 'ACTIVE' || st === 'SCHEDULED' || st === 'ENDED' || st === 'CANCELLED') || !Array.isArray(r.scope_labels)) return undefined;
  return { id: r.maintenance_id as string, scopeLabels: r.scope_labels.filter((x): x is string => typeof x === 'string'), reason: str(r.reason) ?? '', startsAt: starts, endsAt: ends, state: st };
}

export function parseOverview(d: Record<string, unknown>): OpsOverview | undefined {
  const updated = iso(d.updated_at);
  const components = list(d.components, (x): OpsComponent | undefined => {
    const r = record(x);
    const st = state(r?.state);
    if (r === undefined || str(r.key) === undefined || str(r.label) === undefined || st === undefined) return undefined;
    return { key: r.key as string, label: r.label as string, state: st, detail: nStr(r.detail), note: nStr(r.note), observedAt: nIso(r.observed_at) ?? null };
  });
  const inc = record(d.incidents);
  const items = inc === undefined ? undefined : list(inc.items, parseIncident);
  const probe = record(d.external_probe);
  const discord = record(d.discord);
  const maintenance = list(d.maintenance_active, parseMaintenance);
  const viewer = record(d.viewer);
  const lvl = level(viewer?.level);
  if (updated === undefined || components === undefined || inc === undefined || items === undefined || !whole(inc.open) || !whole(inc.critical) || !whole(inc.unacknowledged) || probe === undefined || typeof probe.activated !== 'boolean' || discord === undefined || maintenance === undefined || lvl === undefined) {
    return undefined;
  }
  const lastUpdate = d.last_update === null || d.last_update === undefined ? null : parseDeploy(d.last_update);
  if (lastUpdate === undefined) return undefined;
  return {
    updatedAt: updated,
    dataNote: nStr(d.data_note),
    components,
    open: inc.open,
    critical: inc.critical,
    unacknowledged: inc.unacknowledged,
    incidents: items,
    probe: { activated: probe.activated, label: str(probe.label) ?? '', lastReportAt: nIso(probe.last_report_at) ?? null, note: str(probe.note) ?? '' },
    discord: { enabled: discord.enabled === true, configured: discord.configured === true, pending: whole(discord.pending) ? discord.pending : 0, failed7d: whole(discord.failed_7d) ? discord.failed_7d : 0, lastSentAt: nIso(discord.last_sent_at) ?? null },
    maintenance,
    lastUpdate,
    level: lvl,
  };
}

function parseTimeline(x: unknown): TimelineEntry | undefined {
  const r = record(x);
  const at = iso(r?.at);
  if (r === undefined || at === undefined) return undefined;
  return { at, kind: str(r.code) ?? str(r.kind) ?? '', level: str(r.level) ?? 'INFO', message: typeof r.message === 'string' ? r.message : '', actor: nStr(r.actor_label) };
}

export function parseIncidentDetail(d: Record<string, unknown>): IncidentDetail | undefined {
  const incident = parseIncident(d);
  const check = record(d.current_check);
  const timeline = list(d.timeline, parseTimeline);
  const notices = list(d.notifications, (x): NoticeRecord | undefined => {
    const r = record(x);
    const created = iso(r?.created_at);
    if (r === undefined || created === undefined || str(r.outcome_text) === undefined) return undefined;
    return { kindLabel: str(r.kind_label) ?? '', outcome: r.outcome_text as string, attempts: whole(r.attempts) ? r.attempts : 0, createdAt: created, sentAt: nIso(r.sent_at) ?? null, errorCode: nStr(r.last_error_code) };
  });
  const errors = list(d.recent_errors, parseTimeline);
  const actions = record(d.actions);
  const checkState = state(check?.state);
  if (incident === undefined || check === undefined || checkState === undefined || timeline === undefined || notices === undefined || errors === undefined || actions === undefined) return undefined;
  return {
    incident,
    evidenceText: nStr(d.evidence_text),
    evidence: record(d.evidence) ?? {},
    currentCheck: { state: checkState, evidence: nStr(check.evidence), observedAt: nIso(check.observed_at) ?? null, value: record(check.value) ?? {} },
    timeline,
    notices,
    recentErrors: errors,
    link: nStr(d.link),
    actions: { acknowledge: actions.acknowledge === true, start: actions.start === true, note: actions.note === true, snooze: actions.snooze === true, close: actions.close === true, assign: actions.assign === true },
    readNote: str(d.read_note) ?? '',
  };
}

function parseCheck(x: unknown): GatewayCheck | undefined {
  const r = record(x);
  const st = state(r?.state);
  return r === undefined || st === undefined ? undefined : { state: st, evidence: nStr(r.evidence), value: record(r.value) ?? {} };
}

export function parseGateway(d: Record<string, unknown>): GatewayPage | undefined {
  const updated = iso(d.updated_at);
  const devices = list(d.devices, (x): GatewayDevice | undefined => {
    const r = record(x);
    const checks = record(r?.checks);
    const st = state(r?.state);
    const contact = parseCheck(checks?.contact);
    const battery = parseCheck(checks?.battery);
    const power = parseCheck(checks?.power);
    const failures = parseCheck(checks?.sms_failures);
    if (r === undefined || str(r.device_id) === undefined || str(r.label) === undefined || st === undefined || contact === undefined || battery === undefined || power === undefined || failures === undefined) return undefined;
    return {
      id: r.device_id as string,
      label: r.label as string,
      state: st,
      lastContactAt: nIso(r.last_contact_at) ?? null,
      appVersion: nStr(r.app_version),
      smsPermission: nBool(r.sms_permission),
      paused: nBool(r.paused),
      batteryPercent: nNum(r.battery_percent),
      charging: nBool(r.charging),
      simStateLabel: str(r.sim_state_label) ?? 'Chưa xác định',
      simBalanceLabel: str(r.sim_balance_label) ?? 'Chưa xác định',
      topupNotedOn: nStr(r.topup_noted_on),
      pendingReports: nNum(r.pending_reports),
      currentTask: nStr(r.current_task),
      lastErrorCode: nStr(r.last_error_code),
      telemetryAt: nIso(r.telemetry_at) ?? null,
      checks: { contact, battery, power, sms_failures: failures },
    };
  });
  const q = record(d.queue);
  const jobs = q === undefined ? undefined : list(q.jobs, (x): QueueJob | undefined => {
    const r = record(x);
    const at = iso(r?.at);
    if (r === undefined || at === undefined || str(r.purpose_label) === undefined || str(r.status_label) === undefined) return undefined;
    return { at, purposeLabel: r.purpose_label as string, statusLabel: r.status_label as string, status: str(r.status) ?? '', resultCode: nStr(r.result_code), recipientTail: str(r.recipient_tail) ?? '' };
  });
  const otp = parseCheck(q?.otp_check);
  const maintenance = list(d.maintenance, parseMaintenance);
  const viewer = record(d.viewer);
  const lvl = level(viewer?.level);
  if (updated === undefined || devices === undefined || q === undefined || jobs === undefined || otp === undefined || !whole(q.queued) || !whole(q.claimed) || !whole(q.failed_last_hour) || maintenance === undefined || lvl === undefined) return undefined;
  const dc = record(d.discord);
  return {
    updatedAt: updated,
    devices,
    queue: { queued: q.queued, claimed: q.claimed, failedLastHour: q.failed_last_hour, otpState: otp.state, otpEvidence: otp.evidence, purposesLabel: str(q.purposes_label) ?? 'Đăng ký / Quên mật khẩu', jobs },
    discord: dc === undefined ? null : { enabled: dc.enabled === true, configured: dc.configured === true, webhookMasked: nStr(dc.webhook_masked), updatedAt: nIso(dc.updated_at) ?? null, minSeverity: str(dc.min_severity) ?? 'WARNING' },
    maintenance,
    level: lvl,
  };
}

export function parseLogs(d: Record<string, unknown>): { rows: readonly LogRow[]; total: number } | undefined {
  const rows = list(d.items, (x): LogRow | undefined => {
    const r = record(x);
    const at = iso(r?.at);
    if (r === undefined || str(r.event_id) === undefined || at === undefined || typeof r.message !== 'string') return undefined;
    return { id: r.event_id as string, at, category: str(r.category) ?? '', level: str(r.level) ?? 'INFO', sourceLabel: str(r.source_label) ?? '', environment: str(r.environment) ?? '', appVersion: nStr(r.app_version), code: nStr(r.code), message: r.message, requestRef: nStr(r.request_ref), deliveryCode: nStr(r.delivery_code), userId: nStr(r.user_id), actor: nStr(r.actor_label) };
  });
  return rows === undefined || !whole(d.total) ? undefined : { rows, total: d.total };
}

function parseRelease(x: unknown): ReleaseRow | undefined {
  const r = record(x);
  const st = r?.status;
  if (r === undefined || str(r.release_id) === undefined || str(r.component) === undefined || str(r.version_name) === undefined || !(st === 'DRAFT' || st === 'PUBLISHED' || st === 'WITHDRAWN') || !whole(r.version)) return undefined;
  const art = record(r.artifact);
  return {
    id: r.release_id as string,
    component: r.component as string,
    componentLabel: str(r.component_label) ?? (r.component as string),
    versionName: r.version_name as string,
    versionCode: nNum(r.version_code),
    releaseNotes: typeof r.release_notes === 'string' ? r.release_notes : '',
    artifact: art === undefined || str(art.name) === undefined ? null : { name: art.name as string, sha256: nStr(art.sha256), sizeBytes: nNum(art.size_bytes) },
    priority: str(r.priority) ?? 'NORMAL',
    requiredReason: nStr(r.required_reason),
    status: st,
    releasedAt: nIso(r.released_at) ?? null,
    hasDbMigration: r.has_db_migration === true,
    rollbackWarning: nStr(r.rollback_warning),
    reportersRunning: nNum(r.reporters_running),
    version: r.version,
  };
}

export function parseReleases(d: Record<string, unknown>): ReleasesPage | undefined {
  const updated = iso(d.updated_at);
  const components = list(d.components, (x): ComponentVersion | undefined => {
    const r = record(x);
    if (r === undefined || str(r.component) === undefined || str(r.label) === undefined || str(r.status) === undefined) return undefined;
    const run = record(r.running);
    const reportedAt = iso(run?.last_reported_at);
    const published = r.published === null || r.published === undefined ? null : parseRelease(r.published);
    if (published === undefined) return undefined;
    return {
      component: r.component as string,
      label: r.label as string,
      running: run === undefined || reportedAt === undefined || str(run.version_name) === undefined || !whole(run.reporters) ? null : { versionName: run.version_name as string, versionCode: nNum(run.version_code), reporters: run.reporters, lastReportedAt: reportedAt },
      published,
      status: r.status as string,
      statusLabel: str(r.status_label) ?? '',
    };
  });
  const rel = record(d.releases);
  const items = rel === undefined ? undefined : list(rel.items, parseRelease);
  const deploys = list(d.deploys, parseDeploy);
  const control = record(d.deploy_control);
  const viewer = record(d.viewer);
  const lvl = level(viewer?.level);
  if (updated === undefined || components === undefined || rel === undefined || items === undefined || !whole(rel.total) || deploys === undefined || control === undefined || typeof control.available !== 'boolean' || !Array.isArray(control.missing) || lvl === undefined) return undefined;
  return {
    updatedAt: updated,
    components,
    releases: items,
    total: rel.total,
    deploys,
    deployControl: { available: control.available, missing: control.missing.filter((x): x is string => typeof x === 'string') },
    gatewayRule: str(d.gateway_update_rule) ?? '',
    androidNote: str(d.android_note) ?? '',
    artifactsAvailable: d.artifacts_available === true,
    level: lvl,
  };
}

export function parseConfig(d: Record<string, unknown>): OpsConfigPage | undefined {
  const updated = iso(d.updated_at);
  const cfg = record(d.config);
  const settings = cfg === undefined ? undefined : list(cfg.settings, (x): SettingRow | undefined => {
    const r = record(x);
    const g = r?.group;
    if (r === undefined || str(r.key) === undefined || !(g === 'gateway' || g === 'server' || g === 'alert' || g === 'app' || g === 'retention') || str(r.label) === undefined || !whole(r.value) || !whole(r.default) || !whole(r.min) || !whole(r.max)) return undefined;
    return { key: r.key as string, group: g, label: r.label as string, unit: str(r.unit) ?? '', value: r.value, default: r.default, min: r.min, max: r.max, implDefault: r.impl_default === true };
  });
  const maintenance = list(d.maintenance, parseMaintenance);
  const viewer = record(d.viewer);
  const lvl = level(viewer?.level);
  if (updated === undefined || cfg === undefined || settings === undefined || !whole(cfg.version) || typeof cfg.editable !== 'boolean' || maintenance === undefined || lvl === undefined) return undefined;
  const dc = record(cfg.discord);
  const sev = dc?.min_severity;
  const access = d.access === null || d.access === undefined ? null : list(d.access, (x) => {
    const r = record(x);
    const l = level(r?.level);
    return r === undefined || str(r.user_id) === undefined || l === undefined || !whole(r.version) ? undefined : { userId: r.user_id as string, label: nStr(r.label), level: l, version: r.version };
  });
  if (access === undefined) return undefined;
  return {
    updatedAt: updated,
    version: cfg.version,
    editable: cfg.editable,
    settings,
    discord: dc === undefined || (sev !== 'WARNING' && sev !== 'CRITICAL') ? null : { enabled: dc.enabled === true, minSeverity: sev, webhookConfigured: dc.webhook_configured === true, webhookMasked: nStr(dc.webhook_masked), webhookUpdatedAt: nIso(dc.webhook_updated_at) ?? null },
    maintenance,
    access,
    level: lvl,
  };
}

function qs(params: Readonly<Record<string, string | undefined>>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v as string)}`);
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

const offset = (page: number): string => String((Math.max(page, 1) - 1) * OPS_PAGE_SIZE);
const ack = (): Record<string, unknown> => ({});

export class AdminOpsApi extends ApiClient {
  me(): Promise<ApiResult<OpsLevel>> {
    return this.call({ method: 'GET', path: '/admin/ops/me' }, (d) => level(d.level));
  }
  overview(): Promise<ApiResult<OpsOverview>> {
    return this.call({ method: 'GET', path: '/admin/ops/overview' }, parseOverview);
  }
  incidents(q: IncidentQuery): Promise<ApiResult<{ rows: readonly OpsIncident[]; total: number }>> {
    const path = `/admin/ops/incidents${qs({ status: q.status === 'ALL' ? undefined : q.status, severity: q.severity, source: q.source, assignee: q.assignee, from: q.from, to: q.to, q: q.search.trim(), limit: String(OPS_PAGE_SIZE), offset: offset(q.page) })}`;
    return this.call({ method: 'GET', path }, (d) => {
      const rows = list(d.items, parseIncident);
      return rows === undefined || !whole(d.total) ? undefined : { rows, total: d.total };
    });
  }
  incident(ref: string): Promise<ApiResult<IncidentDetail>> {
    return this.call({ method: 'GET', path: `/admin/ops/incidents/${encodeURIComponent(ref)}` }, parseIncidentDetail);
  }
  incidentAction(csrf: string, id: string, key: string, a: IncidentAction): Promise<ApiResult<Record<string, unknown>>> {
    const base = `/admin/ops/incidents/${encodeURIComponent(id)}`;
    const body =
      a.kind === 'note' ? { text: a.text } : a.kind === 'snooze' ? { expected_version: a.version, minutes: a.minutes } : a.kind === 'close' ? { expected_version: a.version, ...(a.confirmStillFailing ? { confirm_still_failing: true, note: a.note } : a.note.trim() === '' ? {} : { note: a.note }) } : { expected_version: a.version };
    return this.call({ method: 'POST', path: `${base}/${a.kind === 'acknowledge' ? 'acknowledge' : a.kind}`, body, csrf, idempotencyKey: key }, (d) => d);
  }
  gateway(): Promise<ApiResult<GatewayPage>> {
    return this.call({ method: 'GET', path: '/admin/ops/gateway' }, parseGateway);
  }
  topupNote(csrf: string, deviceId: string, key: string, date: string | null): Promise<ApiResult<Record<string, unknown>>> {
    return this.call({ method: 'POST', path: `/admin/ops/gateway/${encodeURIComponent(deviceId)}/topup-note`, body: { date }, csrf, idempotencyKey: key }, (d) => d);
  }
  logs(q: LogQuery): Promise<ApiResult<{ rows: readonly LogRow[]; total: number }>> {
    const path = `/admin/ops/logs${qs({ group: q.group, source: q.source, level: q.level, code: q.code.trim(), delivery_code: q.deliveryCode.trim(), user_id: q.userId.trim(), app_version: q.appVersion.trim(), from: q.from, to: q.to, limit: String(OPS_PAGE_SIZE), offset: offset(q.page) })}`;
    return this.call({ method: 'GET', path }, parseLogs);
  }
  releases(page: number): Promise<ApiResult<ReleasesPage>> {
    return this.call({ method: 'GET', path: `/admin/ops/releases${qs({ limit: String(OPS_PAGE_SIZE), offset: offset(page) })}` }, parseReleases);
  }
  createRelease(csrf: string, key: string, d: ReleaseDraft): Promise<ApiResult<Record<string, unknown>>> {
    const body: Record<string, unknown> = {
      component: d.component,
      version_name: d.versionName.trim(),
      release_notes: d.releaseNotes.trim(),
      priority: d.priority,
      has_db_migration: d.hasDbMigration,
      ...(d.versionCode.trim() === '' ? {} : { version_code: Number(d.versionCode) }),
      ...(d.artifactName.trim() === '' ? {} : { artifact_name: d.artifactName.trim() }),
      ...(d.requiredReason.trim() === '' ? {} : { required_reason: d.requiredReason.trim() }),
      ...(d.minSupportedVersionCode.trim() === '' ? {} : { min_supported_version_code: Number(d.minSupportedVersionCode) }),
      ...(d.rollbackNote.trim() === '' ? {} : { rollback_note: d.rollbackNote.trim() }),
    };
    return this.call({ method: 'POST', path: '/admin/ops/releases', body, csrf, idempotencyKey: key }, (x) => x);
  }
  releaseStatus(csrf: string, id: string, key: string, version: number, to: 'publish' | 'withdraw'): Promise<ApiResult<Record<string, unknown>>> {
    return this.call({ method: 'POST', path: `/admin/ops/releases/${encodeURIComponent(id)}/${to}`, body: { expected_version: version }, csrf, idempotencyKey: key }, (x) => x);
  }
  config(): Promise<ApiResult<OpsConfigPage>> {
    return this.call({ method: 'GET', path: '/admin/ops/config' }, parseConfig);
  }
  saveConfig(csrf: string, r: ConfigSave): Promise<ApiResult<Record<string, unknown>>> {
    const body = { expected_version: r.version, settings: r.settings, discord_enabled: r.discordEnabled, discord_min_severity: r.minSeverity, ...(r.webhook === undefined ? {} : { webhook: r.webhook }) };
    return this.call({ method: 'POST', path: '/admin/ops/config', body, csrf, idempotencyKey: r.key }, (x) => x);
  }
  discordTest(csrf: string, key: string): Promise<ApiResult<Record<string, unknown>>> {
    return this.call({ method: 'POST', path: '/admin/ops/config/discord-test', body: ack(), csrf, idempotencyKey: key }, (x) => x);
  }
  createMaintenance(csrf: string, d: MaintenanceDraft): Promise<ApiResult<Record<string, unknown>>> {
    return this.call({ method: 'POST', path: '/admin/ops/maintenance', body: { scopes: d.scopes, reason: d.reason.trim(), ends_at: new Date(d.endsAt).toISOString() }, csrf, idempotencyKey: d.key }, (x) => x);
  }
  cancelMaintenance(csrf: string, id: string, key: string): Promise<ApiResult<Record<string, unknown>>> {
    return this.call({ method: 'POST', path: `/admin/ops/maintenance/${encodeURIComponent(id)}/cancel`, body: ack(), csrf, idempotencyKey: key }, (x) => x);
  }
  setAccess(csrf: string, userId: string, lvl: OpsLevel, version: number, key: string): Promise<ApiResult<Record<string, unknown>>> {
    return this.call({ method: 'POST', path: '/admin/ops/access', body: { user_id: userId, level: lvl, expected_version: version }, csrf, idempotencyKey: key }, (x) => x);
  }
}

async function writeResult<T>(result: ApiResult<Record<string, unknown>>, session: CsrfPort, map: (d: Record<string, unknown>) => T | undefined): Promise<OpsWrite<T>> {
  if (result.kind === 'ok') {
    const data = map(result.data);
    return data === undefined ? { kind: 'unknown' } : { kind: 'ok', data };
  }
  if (result.kind === 'network' || result.status >= 500) {
    return { kind: 'unknown' };
  }
  switch (result.code) {
    case 'VERSION_CONFLICT':
      return { kind: 'conflict' };
    case 'OPS_INCIDENT_STATE_CONFLICT':
    case 'OPS_RELEASE_CONFLICT':
      return { kind: 'state-conflict' };
    case 'ADMIN_CSRF_INVALID':
      await session.refresh();
      return { kind: 'unknown' };
    case 'ADMIN_SESSION_INVALID':
      return { kind: 'session-expired' };
    case 'ADMIN_FORBIDDEN':
      return { kind: 'forbidden' };
    case 'IDEMPOTENCY_BUSY':
      return { kind: 'unknown' };
    case 'ADMIN_AUTH_RATE_LIMITED':
      return { kind: 'rate-limited', ...(result.retryAfterSeconds === undefined ? {} : { retryAfterSec: result.retryAfterSeconds }) };
    default:
      return { kind: 'invalid' };
  }
}

const readOf = <T>(result: ApiResult<T>): OpsRead<T> => {
  if (result.kind === 'ok') return { kind: 'ready', data: result.data };
  if (result.kind === 'error' && result.status === 404) return { kind: 'not-found' };
  return failureOf(result);
};

/** The real OpsSource. It keeps nothing: no rows, no versions, no keys, no webhook. */
export function createOpsSource(api: AdminOpsApi, session?: CsrfPort): OpsSource {
  const write = async <T>(call: (csrf: string) => Promise<ApiResult<Record<string, unknown>>>, map: (d: Record<string, unknown>) => T | undefined): Promise<OpsWrite<T>> => {
    if (session === undefined) return { kind: 'not-wired' };
    const csrf = session.csrf();
    if (csrf === undefined) return { kind: 'session-expired' };
    return writeResult(await call(csrf), session, map);
  };
  const nothing = (): undefined | true => true;
  const plain = async (call: (csrf: string) => Promise<ApiResult<Record<string, unknown>>>): Promise<OpsWrite> => {
    const r = await write(call, nothing);
    return r.kind === 'ok' ? { kind: 'ok', data: undefined } : r;
  };
  return {
    async me() {
      const r = await api.me();
      // An administrator without a grant is answered 403 on the pages; "me" turns that into NONE so the menu can simply hide the section.
      return r.kind === 'ok' ? { kind: 'ready', data: r.data } : readOf(r);
    },
    async overview() {
      return readOf(await api.overview());
    },
    async incidents(q) {
      return readOf(await api.incidents(q));
    },
    async incident(ref) {
      return readOf(await api.incident(ref));
    },
    incidentAction: (id, key, action) => plain((csrf) => api.incidentAction(csrf, id, key, action)),
    async gateway() {
      return readOf(await api.gateway());
    },
    topupNote: (deviceId, key, date) => plain((csrf) => api.topupNote(csrf, deviceId, key, date)),
    async logs(q) {
      return readOf(await api.logs(q));
    },
    async releases(page) {
      return readOf(await api.releases(page));
    },
    createRelease: (key, draft) => plain((csrf) => api.createRelease(csrf, key, draft)),
    releaseStatus: (id, key, version, to) => plain((csrf) => api.releaseStatus(csrf, id, key, version, to)),
    async config() {
      return readOf(await api.config());
    },
    async saveConfig(request) {
      const r = await write((csrf) => api.saveConfig(csrf, request), () => true as const);
      if (r.kind !== 'ok') return r;
      // The answer of a save is the next state: it is read again (one GET) so the page never shows a body it did not parse strictly.
      const next = await api.config();
      return next.kind === 'ok' ? { kind: 'ok', data: next.data } : { kind: 'unknown' };
    },
    discordTest: (key) =>
      write(
        (csrf) => api.discordTest(csrf, key),
        (d) => {
          const res = record(d.result);
          return res === undefined ? { outcomeText: 'Chưa có kết quả', status: 'UNKNOWN' } : { outcomeText: str(res.outcome_text) ?? '', status: str(res.status) ?? 'UNKNOWN' };
        },
      ),
    createMaintenance: (draft) => plain((csrf) => api.createMaintenance(csrf, draft)),
    cancelMaintenance: (id, key) => plain((csrf) => api.cancelMaintenance(csrf, id, key)),
    setAccess: (userId, lvl, version, key) => plain((csrf) => api.setAccess(csrf, userId, lvl, version, key)),
  };
}
