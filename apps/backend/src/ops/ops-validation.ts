import { VPS_RANGE_NAMES, VpsRange } from './ops-vps';
import { BadRequestException } from '@nestjs/common';
import { shaped } from '../delivery/delivery-validation';
import { isCanonicalUuid } from '../shared/identifiers';
import {
  ACCESS_LEVELS,
  AccessLevel,
  ANDROID_COMPONENTS,
  ARTIFACT_NAME_PATTERN,
  CLIENT_LOG_KINDS,
  ClientLogKind,
  DEPLOY_STATUSES,
  DeployStatus,
  INCIDENT_STATUSES,
  IncidentSeverity,
  IncidentStatus,
  isOpsSource,
  OPS_SOURCES,
  RELEASE_COMPONENTS,
  RELEASE_PRIORITIES,
  ReleaseComponent,
  ReleasePriority,
} from './ops-constants';
import { parseIncidentCode } from './ops-incident-repository';

// Strict parsers of every M13 request. A body or query with an unknown key, a wrong type or an out-of-range value is a 400 (the transport answers it with the
// fixed error envelope); nothing here echoes what the caller sent.

function reject(): never {
  throw new BadRequestException();
}

const VERSION_NAME = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,31}$/;

function text(value: unknown, min: number, max: number): string {
  if (typeof value !== 'string') return reject();
  const t = value.trim();
  if (t.length < min || t.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(t)) return reject();
  return t;
}

const optText = (value: unknown, max: number): string | null => (value === undefined || value === null || value === '' ? null : text(value, 1, max));

function int(value: unknown, min: number, max: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : reject();
}

const optInt = (value: unknown, min: number, max: number): number | null => (value === undefined || value === null ? null : int(value, min, max));

function bool(value: unknown): boolean {
  return typeof value === 'boolean' ? value : reject();
}

function uuid(value: unknown): string {
  return typeof value === 'string' && isCanonicalUuid(value) ? value : reject();
}

function isoInstant(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return reject();
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : reject();
}

export function parseVpsQuery(query: unknown): VpsRange {
  const q = queryStrings(query, ['range']);
  if (q.range === undefined || q.range === '') return '1h';
  return (VPS_RANGE_NAMES as readonly string[]).includes(q.range) ? (q.range as VpsRange) : reject();
}

export function parseNoQuery(query: unknown): void {
  if (query === undefined || query === null) return;
  if (typeof query !== 'object' || Array.isArray(query) || Object.keys(query).length > 0) reject();
}

function queryStrings(query: unknown, allowed: readonly string[]): Record<string, string> {
  if (query === undefined || query === null) return {};
  if (typeof query !== 'object' || Array.isArray(query)) return reject();
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(query)) {
    if (!allowed.includes(k) || typeof v !== 'string') return reject();
    out[k] = v;
  }
  return out;
}

function page(q: Record<string, string>, max: number): { limit: number; offset: number } {
  const limit = q.limit === undefined ? 25 : /^\d{1,3}$/.test(q.limit) && Number(q.limit) >= 1 && Number(q.limit) <= max ? Number(q.limit) : reject();
  const offset = q.offset === undefined ? 0 : /^\d{1,7}$/.test(q.offset) ? Number(q.offset) : reject();
  return { limit, offset };
}

function day(value: string | undefined, endOfDay: boolean): number | null {
  if (value === undefined || value === '') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    // A bare date is a Vietnam calendar day (UTC+7): the bound of "through that day" is the start of the next one.
    const ms = Date.parse(`${value}T00:00:00+07:00`);
    return Number.isFinite(ms) ? ms + (endOfDay ? 86_400_000 : 0) : reject();
  }
  return isoInstant(value);
}

// ---- reads ---------------------------------------------------------------------------------------------------------------------------

export interface IncidentListQuery {
  readonly severity: IncidentSeverity | null;
  readonly source: string | null;
  readonly statuses: readonly IncidentStatus[] | null;
  readonly assigneeUserId: string | null;
  readonly unassigned: boolean;
  readonly fromMs: number | null;
  readonly toMs: number | null;
  readonly codeSeq: number | null;
  readonly limit: number;
  readonly offset: number;
}

export function parseIncidentList(query: unknown): IncidentListQuery {
  const q = queryStrings(query, ['severity', 'source', 'status', 'assignee', 'from', 'to', 'q', 'limit', 'offset']);
  const severity = q.severity === undefined || q.severity === '' ? null : q.severity === 'WARNING' || q.severity === 'CRITICAL' ? q.severity : reject();
  const source = q.source === undefined || q.source === '' ? null : isOpsSource(q.source) ? q.source : reject();
  let statuses: IncidentStatus[] | null = null;
  if (q.status !== undefined && q.status !== '') {
    if (q.status === 'OPEN') {
      statuses = ['NEW', 'ACKNOWLEDGED', 'IN_PROGRESS'];
    } else {
      statuses = q.status.split(',').map((s) => ((INCIDENT_STATUSES as readonly string[]).includes(s) ? (s as IncidentStatus) : reject()));
    }
  }
  const assignee = q.assignee === undefined || q.assignee === '' ? null : q.assignee;
  const search = (q.q ?? '').trim();
  if (search.length > 24) reject();
  return {
    severity,
    source,
    statuses,
    assigneeUserId: assignee === null || assignee === 'NONE' ? null : uuid(assignee),
    unassigned: assignee === 'NONE',
    fromMs: day(q.from, false),
    toMs: day(q.to, true),
    codeSeq: search === '' ? null : (parseIncidentCode(search) ?? reject()),
    ...page(q, 100),
  };
}

export function parseIncidentRef(ref: string): { readonly uuid?: string; readonly codeSeq?: number } {
  if (isCanonicalUuid(ref)) return { uuid: ref };
  const seq = parseIncidentCode(ref);
  return seq === undefined ? reject() : { codeSeq: seq };
}

export interface LogQuery {
  readonly group: 'TECHNICAL' | 'INCIDENT' | 'ADMIN' | null;
  readonly source: string | null;
  readonly level: 'INFO' | 'WARN' | 'ERROR' | null;
  readonly code: string | null;
  readonly deliveryCode: string | null;
  readonly userId: string | null;
  readonly appVersion: string | null;
  readonly fromMs: number | null;
  readonly toMs: number | null;
  readonly limit: number;
  readonly offset: number;
}

export function parseLogQuery(query: unknown): LogQuery {
  const q = queryStrings(query, ['group', 'source', 'level', 'code', 'delivery_code', 'user_id', 'app_version', 'from', 'to', 'limit', 'offset']);
  const group = q.group === undefined || q.group === '' ? null : q.group === 'TECHNICAL' || q.group === 'INCIDENT' || q.group === 'ADMIN' ? q.group : reject();
  const level = q.level === undefined || q.level === '' ? null : q.level === 'INFO' || q.level === 'WARN' || q.level === 'ERROR' ? q.level : reject();
  const source = q.source === undefined || q.source === '' ? null : isOpsSource(q.source) ? q.source : reject();
  const short = (v: string | undefined, max: number): string | null => (v === undefined || v.trim() === '' ? null : v.trim().length <= max ? v.trim() : reject());
  const userId = q.user_id === undefined || q.user_id === '' ? null : uuid(q.user_id);
  const appVersion = short(q.app_version, 32);
  if (appVersion !== null && !VERSION_NAME.test(appVersion)) reject();
  return { group, source, level, code: short(q.code, 48), deliveryCode: short(q.delivery_code, 32), userId, appVersion, fromMs: day(q.from, false), toMs: day(q.to, true), ...page(q, 100) };
}

// ---- incident actions ----------------------------------------------------------------------------------------------------------------

export function parseExpectedVersion(body: unknown): { expectedVersion: number } {
  const b = shaped(body, ['expected_version']);
  return { expectedVersion: int(b.expected_version, 1, Number.MAX_SAFE_INTEGER) };
}

export function parseNoteBody(body: unknown): { text: string } {
  const b = shaped(body, ['text']);
  return { text: text(b.text, 1, 500) };
}

export function parseSnoozeBody(body: unknown): { expectedVersion: number; minutes: number } {
  const b = shaped(body, ['expected_version', 'minutes']);
  return { expectedVersion: int(b.expected_version, 1, Number.MAX_SAFE_INTEGER), minutes: int(b.minutes, 10, 4320) };
}

export function parseCloseBody(body: unknown): { expectedVersion: number; confirmStillFailing: boolean; note: string | null } {
  const b = shaped(body, ['expected_version'], ['confirm_still_failing', 'note']);
  const confirm = b.confirm_still_failing === undefined ? false : bool(b.confirm_still_failing);
  const note = optText(b.note, 300);
  // Closing while the check still fails (or has no data) must say why.
  if (confirm && note === null) reject();
  return { expectedVersion: int(b.expected_version, 1, Number.MAX_SAFE_INTEGER), confirmStillFailing: confirm, note };
}

export function parseAssignBody(body: unknown): { expectedVersion: number; assigneeUserId: string | null } {
  const b = shaped(body, ['expected_version', 'assignee_user_id']);
  return { expectedVersion: int(b.expected_version, 1, Number.MAX_SAFE_INTEGER), assigneeUserId: b.assignee_user_id === null ? null : uuid(b.assignee_user_id) };
}

// ---- configuration -------------------------------------------------------------------------------------------------------------------

export interface ConfigBody {
  readonly expectedVersion: number;
  readonly settings: Record<string, number>;
  readonly discordEnabled: boolean;
  readonly discordMinSeverity: 'WARNING' | 'CRITICAL';
  /** undefined = keep; null = remove; a string = replace (validated as a Discord webhook by the service). */
  readonly webhook: string | null | undefined;
}

export function parseConfigBody(body: unknown): ConfigBody {
  const b = shaped(body, ['expected_version', 'settings', 'discord_enabled', 'discord_min_severity'], ['webhook']);
  if (typeof b.settings !== 'object' || b.settings === null || Array.isArray(b.settings)) reject();
  const settings: Record<string, number> = {};
  for (const [k, v] of Object.entries(b.settings as Record<string, unknown>)) {
    if (k.length > 48 || typeof v !== 'number' || !Number.isInteger(v)) reject();
    settings[k] = v;
  }
  if (Object.keys(settings).length > 60) reject();
  const sev = b.discord_min_severity;
  if (sev !== 'WARNING' && sev !== 'CRITICAL') reject();
  const webhook = b.webhook === undefined ? undefined : b.webhook === null ? null : text(b.webhook, 40, 220);
  return { expectedVersion: int(b.expected_version, 0, Number.MAX_SAFE_INTEGER), settings, discordEnabled: bool(b.discord_enabled), discordMinSeverity: sev as 'WARNING' | 'CRITICAL', webhook };
}

export interface MaintenanceBody {
  readonly scopes: readonly string[];
  readonly reason: string;
  readonly startsAtMs: number | null;
  readonly endsAtMs: number;
}

export function parseMaintenanceBody(body: unknown): MaintenanceBody {
  const b = shaped(body, ['scopes', 'reason', 'ends_at'], ['starts_at']);
  if (!Array.isArray(b.scopes) || b.scopes.length < 1 || b.scopes.length > OPS_SOURCES.length) reject();
  const scopes = [...new Set((b.scopes as unknown[]).map((s) => (isOpsSource(s) ? s : reject())))];
  return { scopes, reason: text(b.reason, 3, 200), startsAtMs: b.starts_at === undefined ? null : isoInstant(b.starts_at), endsAtMs: isoInstant(b.ends_at) };
}

export function parseAccessBody(body: unknown): { userId: string; level: AccessLevel; expectedVersion: number } {
  const b = shaped(body, ['user_id', 'level', 'expected_version']);
  if (typeof b.level !== 'string' || !(ACCESS_LEVELS as readonly string[]).includes(b.level)) reject();
  return { userId: uuid(b.user_id), level: b.level as AccessLevel, expectedVersion: int(b.expected_version, 0, Number.MAX_SAFE_INTEGER) };
}

export function parseTopupNoteBody(body: unknown): { date: string | null } {
  const b = shaped(body, ['date']);
  if (b.date === null) return { date: null };
  if (typeof b.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.date) || !Number.isFinite(Date.parse(`${b.date}T00:00:00Z`))) return reject();
  if (Date.parse(`${b.date}T00:00:00+07:00`) > Date.now() + 86_400_000) return reject();
  return { date: b.date };
}

// ---- releases ------------------------------------------------------------------------------------------------------------------------

export interface ReleaseBody {
  readonly component: ReleaseComponent;
  readonly versionName: string;
  readonly versionCode: number | null;
  readonly releaseNotes: string;
  readonly artifactName: string | null;
  readonly minBackendVersion: string | null;
  readonly minSupportedVersionCode: number | null;
  readonly compatibilityNote: string | null;
  readonly priority: ReleasePriority;
  readonly requiredReason: string | null;
  readonly hasDbMigration: boolean;
  readonly rollbackNote: string | null;
}

export function parseReleaseBody(body: unknown): ReleaseBody {
  const b = shaped(
    body,
    ['component', 'version_name', 'release_notes', 'priority', 'has_db_migration'],
    ['version_code', 'artifact_name', 'min_backend_version', 'min_supported_version_code', 'compatibility_note', 'required_reason', 'rollback_note'],
  );
  if (typeof b.component !== 'string' || !(RELEASE_COMPONENTS as readonly string[]).includes(b.component)) reject();
  const component = b.component as ReleaseComponent;
  const versionName = text(b.version_name, 1, 32);
  if (!VERSION_NAME.test(versionName)) reject();
  if (typeof b.priority !== 'string' || !(RELEASE_PRIORITIES as readonly string[]).includes(b.priority)) reject();
  const android = ANDROID_COMPONENTS.includes(component);
  const versionCode = optInt(b.version_code, 1, 2_000_000_000);
  if (android && versionCode === null) reject();
  const artifactName = optText(b.artifact_name, 96);
  if (artifactName !== null && !ARTIFACT_NAME_PATTERN.test(artifactName)) reject();
  // An Android release is only useful with its file; the others may be notes-only (a backend deploy has no downloadable artifact).
  if (android && artifactName === null) reject();
  const minBackend = optText(b.min_backend_version, 32);
  if (minBackend !== null && !VERSION_NAME.test(minBackend)) reject();
  const requiredReason = optText(b.required_reason, 200);
  if (b.priority === 'REQUIRED' && requiredReason === null) reject();
  return {
    component,
    versionName,
    versionCode,
    releaseNotes: text(b.release_notes, 1, 2000),
    artifactName,
    minBackendVersion: minBackend,
    minSupportedVersionCode: optInt(b.min_supported_version_code, 1, 2_000_000_000),
    compatibilityNote: optText(b.compatibility_note, 300),
    priority: b.priority as ReleasePriority,
    requiredReason,
    hasDbMigration: bool(b.has_db_migration),
    rollbackNote: optText(b.rollback_note, 300),
  };
}

export function parseReleaseListQuery(query: unknown): { component: ReleaseComponent | null; limit: number; offset: number } {
  const q = queryStrings(query, ['component', 'limit', 'offset']);
  const component = q.component === undefined || q.component === '' ? null : (RELEASE_COMPONENTS as readonly string[]).includes(q.component) ? (q.component as ReleaseComponent) : reject();
  return { component, ...page(q, 100) };
}

// ---- ingest and apps -----------------------------------------------------------------------------------------------------------------

export interface ProbeReport {
  readonly episodeId: string;
  readonly firstFailedAtMs: number;
  readonly recoveredAtMs: number | null;
  readonly failures: number;
  readonly code: string;
  readonly notified: boolean;
}

export interface ProbeBody {
  readonly reportedAtMs: number;
  readonly reports: readonly ProbeReport[];
}

export function parseProbeBody(body: unknown): ProbeBody {
  const b = shaped(body, ['reported_at'], ['reports', 'state']);
  const reports = b.reports === undefined ? [] : Array.isArray(b.reports) ? b.reports : reject();
  if (reports.length > 50) reject();
  return {
    reportedAtMs: isoInstant(b.reported_at),
    reports: reports.map((raw): ProbeReport => {
      const r = shaped(raw, ['episode_id', 'first_failed_at', 'failures', 'code', 'notified'], ['recovered_at']);
      const episodeId = text(r.episode_id, 8, 64);
      if (!/^[A-Za-z0-9._:-]+$/.test(episodeId)) reject();
      const code = text(r.code, 1, 32);
      if (!/^[A-Z0-9_]{1,32}$/.test(code)) reject();
      return { episodeId, firstFailedAtMs: isoInstant(r.first_failed_at), recoveredAtMs: r.recovered_at === undefined || r.recovered_at === null ? null : isoInstant(r.recovered_at), failures: int(r.failures, 1, 1_000_000), code, notified: bool(r.notified) };
    }),
  };
}

export function parseBackupBody(body: unknown): { kind: 'BACKUP' | 'RESTORE_TEST'; ok: boolean; finishedAtMs: number; sizeBytes: number | null; detailCode: string | null } {
  const b = shaped(body, ['kind', 'ok', 'finished_at'], ['size_bytes', 'detail_code']);
  if (b.kind !== 'BACKUP' && b.kind !== 'RESTORE_TEST') reject();
  const detail = b.detail_code === undefined || b.detail_code === null ? null : text(b.detail_code, 1, 32);
  if (detail !== null && !/^[A-Z0-9_]{1,32}$/.test(detail)) reject();
  const finished = isoInstant(b.finished_at);
  if (finished > Date.now() + 5 * 60_000) reject();
  return { kind: b.kind as 'BACKUP' | 'RESTORE_TEST', ok: bool(b.ok), finishedAtMs: finished, sizeBytes: optInt(b.size_bytes, 0, Number.MAX_SAFE_INTEGER), detailCode: detail };
}

export type DeployBody =
  | { readonly action: 'start'; readonly component: ReleaseComponent; readonly fromVersion: string | null; readonly toVersion: string; readonly hasDbMigration: boolean; readonly note: string | null }
  | { readonly action: 'finish'; readonly deployId: string; readonly status: Exclude<DeployStatus, 'RUNNING'>; readonly healthResult: 'PASSED' | 'FAILED' | null; readonly healthDetail: string | null; readonly note: string | null };

export function parseDeployBody(body: unknown): DeployBody {
  if (typeof body === 'object' && body !== null && (body as { action?: unknown }).action === 'start') {
    const b = shaped(body, ['action', 'component', 'to_version', 'has_db_migration'], ['from_version', 'note']);
    if (typeof b.component !== 'string' || !(RELEASE_COMPONENTS as readonly string[]).includes(b.component)) reject();
    const to = text(b.to_version, 1, 32);
    const from = optText(b.from_version, 32);
    if (!VERSION_NAME.test(to) || (from !== null && !VERSION_NAME.test(from))) reject();
    return { action: 'start', component: b.component as ReleaseComponent, fromVersion: from, toVersion: to, hasDbMigration: bool(b.has_db_migration), note: optText(b.note, 300) };
  }
  const b = shaped(body, ['action', 'deploy_id', 'status'], ['health_result', 'health_detail', 'note']);
  if (b.action !== 'finish') reject();
  if (typeof b.status !== 'string' || b.status === 'RUNNING' || !(DEPLOY_STATUSES as readonly string[]).includes(b.status)) reject();
  const health = b.health_result === undefined || b.health_result === null ? null : b.health_result === 'PASSED' || b.health_result === 'FAILED' ? b.health_result : reject();
  return { action: 'finish', deployId: uuid(b.deploy_id), status: b.status as Exclude<DeployStatus, 'RUNNING'>, healthResult: health, healthDetail: optText(b.health_detail, 200), note: optText(b.note, 300) };
}

export interface ClientLogEntry {
  readonly atMs: number;
  readonly kind: ClientLogKind;
  readonly code: string;
  readonly appVersion: string;
  readonly message: string;
  readonly context: Record<string, unknown>;
  readonly deliveryCode: string | null;
}

/** An app reports a bounded batch (it queues offline and sends later): at most 50 entries, each small, each a fixed kind. Free text is redacted when stored. */
export function parseClientLogs(body: unknown): { entries: ClientLogEntry[] } {
  const b = shaped(body, ['entries']);
  if (!Array.isArray(b.entries) || b.entries.length < 1 || b.entries.length > 50) reject();
  return {
    entries: (b.entries as unknown[]).map((raw): ClientLogEntry => {
      const e = shaped(raw, ['at', 'kind', 'code', 'app_version'], ['message', 'context', 'delivery_code']);
      if (typeof e.kind !== 'string' || !(CLIENT_LOG_KINDS as readonly string[]).includes(e.kind)) reject();
      const code = text(e.code, 1, 48);
      if (!/^[A-Z0-9_.:-]{1,48}$/.test(code)) reject();
      const version = text(e.app_version, 1, 32);
      if (!VERSION_NAME.test(version)) reject();
      const at = isoInstant(e.at);
      // An entry older than a week or from the future is not evidence of anything current.
      if (at > Date.now() + 5 * 60_000 || at < Date.now() - 7 * 86_400_000) reject();
      const context = e.context === undefined ? {} : typeof e.context === 'object' && e.context !== null && !Array.isArray(e.context) && JSON.stringify(e.context).length <= 1024 ? (e.context as Record<string, unknown>) : reject();
      return { atMs: at, kind: e.kind as ClientLogKind, code, appVersion: version, message: e.message === undefined ? '' : text(e.message, 0, 300), context, deliveryCode: optText(e.delivery_code, 32) };
    }),
  };
}

export function parseAppUpdateCheck(query: unknown): { component: 'FOOD' | 'SHIP'; versionCode: number | null } {
  const q = queryStrings(query, ['component', 'version_code']);
  if (q.component !== 'FOOD' && q.component !== 'SHIP') reject();
  const versionCode = q.version_code === undefined ? null : /^\d{1,10}$/.test(q.version_code) && Number(q.version_code) <= 2_000_000_000 ? Number(q.version_code) : reject();
  return { component: q.component as 'FOOD' | 'SHIP', versionCode };
}

export function parseVersionReport(body: unknown): { component: 'FOOD' | 'SHIP'; versionName: string; versionCode: number } {
  const b = shaped(body, ['component', 'version_name', 'version_code']);
  if (b.component !== 'FOOD' && b.component !== 'SHIP') reject();
  const versionName = text(b.version_name, 1, 32);
  if (!VERSION_NAME.test(versionName)) reject();
  return { component: b.component as 'FOOD' | 'SHIP', versionName, versionCode: int(b.version_code, 1, 2_000_000_000) };
}

export function parseReleaseId(value: string): string {
  return isCanonicalUuid(value) ? value : reject();
}

export const parseUuidParam = parseReleaseId;
