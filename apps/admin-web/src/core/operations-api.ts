// HTTP client of "Nhật ký" and "Sao lưu và phục hồi" (M12-F): GET /v1/admin/audit, GET /v1/admin/backups, POST /v1/admin/restore-requests (+ /:id/cancel). Cookie-only; the CSRF
// token is passed in from memory. Every answer is parsed strictly: a shape that is not exactly what the server documents is a failure, never a half-filled page.

import { CsrfPort, failureOf } from './accounts-api.js';
import { ApiClient, ApiResult, record, str } from './api.js';
import { CommandResult, commandResultOf } from './commands.js';
import { AuditItem, AuditOutcome, AuditPage, AuditQuery, AuditRead, BackupItem, BackupJob, BackupKind, BackupPage, BackupRead, BackupStage, BackupTrigger, OperationsSource, RestoreItem, RestoreState } from './operations.js';

export const OPERATIONS_BASE = '/v1';

const iso = (value: unknown): string | undefined => {
  const text = str(value);
  return text !== undefined && !Number.isNaN(Date.parse(text)) ? text : undefined;
};
const nullableIso = (value: unknown): string | null | undefined => (value === null ? null : iso(value));
const nullableStr = (value: unknown): string | null | undefined => (value === null ? null : str(value));
const nullableWhole = (value: unknown): number | null | undefined => (value === null ? null : typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined);
const KINDS: readonly string[] = ['DAILY', 'WEEKLY', 'PRE_MIGRATION', 'PRE_RESTORE', 'MANUAL'];
const RESTORE_STATES: readonly string[] = ['REQUESTED', 'CANCELLED', 'IN_PROGRESS', 'COMPLETED', 'ABORTED'];
const HEALTH: readonly string[] = ['OK', 'STALE', 'NOT_OFFSITE', 'NONE'];
const STAGES: readonly string[] = ['STARTED', 'LOCAL', 'UPLOADED', 'VERIFIED'];
const TRIGGERS: readonly string[] = ['TIMER', 'DEPLOY', 'MANUAL', 'WEB'];

function parseAuditItem(value: unknown): AuditItem | undefined {
  const raw = record(value);
  if (raw === undefined) {
    return undefined;
  }
  const id = str(raw.audit_id);
  const occurredAt = iso(raw.occurred_at);
  const requestId = str(raw.request_id);
  const actorType = str(raw.actor_type);
  const action = str(raw.action);
  const actorId = nullableStr(raw.actor_id);
  const resourceType = nullableStr(raw.resource_type);
  const resourceId = nullableStr(raw.resource_id);
  const version = nullableWhole(raw.resource_version);
  const reasonCode = nullableStr(raw.reason_code);
  const metadata = record(raw.metadata);
  const outcome = raw.outcome;
  if (id === undefined || occurredAt === undefined || requestId === undefined || actorType === undefined || action === undefined || actorId === undefined || resourceType === undefined || resourceId === undefined || version === undefined || reasonCode === undefined || metadata === undefined || (outcome !== 'SUCCESS' && outcome !== 'DENIED' && outcome !== 'FAILURE')) {
    return undefined;
  }
  return { id, occurredAt, requestId, actorType, actorId, action, resourceType, resourceId, resourceVersion: version, outcome: outcome as AuditOutcome, reasonCode, metadata };
}

export function parseAudit(data: Record<string, unknown>): AuditPage | undefined {
  const generatedAt = iso(data.generated_at);
  const period = record(data.period);
  const fromDay = str(period?.from_day);
  const toDay = str(period?.to_day);
  const nextCursor = nullableStr(data.next_cursor);
  if (generatedAt === undefined || fromDay === undefined || toDay === undefined || nextCursor === undefined || !Array.isArray(data.items)) {
    return undefined;
  }
  const items: AuditItem[] = [];
  for (const entry of data.items) {
    const item = parseAuditItem(entry);
    if (item === undefined) {
      return undefined;
    }
    items.push(item);
  }
  return { generatedAt, fromDay, toDay, items, nextCursor };
}

function parseBackup(value: unknown): BackupItem | undefined {
  const raw = record(value);
  const id = str(raw?.backup_id);
  const kind = raw?.kind;
  const state = raw?.state;
  const startedAt = iso(raw?.started_at);
  const finishedAt = nullableIso(raw?.finished_at);
  const size = nullableWhole(raw?.size_bytes);
  const schema = nullableStr(raw?.schema_version);
  const verifiedAt = nullableIso(raw?.verified_at);
  const note = nullableStr(raw?.verify_note);
  const error = nullableStr(raw?.error_code);
  const failedStage = raw?.failed_stage === null ? null : typeof raw?.failed_stage === 'string' && STAGES.includes(raw.failed_stage) ? (raw.failed_stage as BackupStage) : undefined;
  const release = nullableStr(raw?.release_version);
  const offsiteAt = nullableIso(raw?.offsite_verified_at);
  if (raw === undefined || failedStage === undefined || release === undefined || offsiteAt === undefined || typeof raw.stage !== 'string' || !STAGES.includes(raw.stage) || typeof raw.trigger !== 'string' || !TRIGGERS.includes(raw.trigger) || id === undefined || typeof kind !== 'string' || !KINDS.includes(kind) || (state !== 'RUNNING' && state !== 'SUCCEEDED' && state !== 'FAILED') || startedAt === undefined || finishedAt === undefined || size === undefined || schema === undefined || verifiedAt === undefined || note === undefined || error === undefined || typeof raw.encrypted !== 'boolean' || typeof raw.offsite !== 'boolean' || typeof raw.restorable !== 'boolean') {
    return undefined;
  }
  return { id, kind: kind as BackupKind, state, startedAt, finishedAt, sizeBytes: size, schemaVersion: schema, encrypted: raw.encrypted, offsite: raw.offsite, verifiedAt, verifyNote: note, errorCode: error, stage: raw.stage as BackupStage, failedStage, trigger: raw.trigger as BackupTrigger, releaseVersion: release, offsiteVerifiedAt: offsiteAt, restorable: raw.restorable };
}

export function parseRestore(value: unknown): RestoreItem | undefined {
  const raw = record(value);
  const id = str(raw?.request_id);
  const backupId = str(raw?.backup_id);
  const kind = raw?.backup_kind;
  const startedAt = iso(raw?.backup_started_at);
  const reason = str(raw?.reason);
  const state = raw?.state;
  const note = nullableStr(raw?.operator_note);
  const createdAt = iso(raw?.created_at);
  if (raw === undefined || id === undefined || backupId === undefined || typeof kind !== 'string' || !KINDS.includes(kind) || startedAt === undefined || reason === undefined || typeof state !== 'string' || !RESTORE_STATES.includes(state) || note === undefined || createdAt === undefined || typeof raw.version !== 'number' || !Number.isSafeInteger(raw.version) || raw.version < 1) {
    return undefined;
  }
  return { id, backupId, backupKind: kind as BackupKind, backupStartedAt: startedAt, reason, state: state as RestoreState, operatorNote: note, version: raw.version, createdAt };
}

export function parseJob(value: unknown): BackupJob | undefined {
  const raw = record(value);
  const id = str(raw?.job_id);
  const createdAt = iso(raw?.created_at);
  const finishedAt = nullableIso(raw?.finished_at);
  const error = nullableStr(raw?.error_code);
  if (raw === undefined || id === undefined || createdAt === undefined || finishedAt === undefined || error === undefined || (raw.state !== 'QUEUED' && raw.state !== 'RUNNING' && raw.state !== 'DONE' && raw.state !== 'FAILED')) {
    return undefined;
  }
  return { id, state: raw.state, errorCode: error, createdAt, finishedAt };
}

export function parseBackups(data: Record<string, unknown>): BackupPage | undefined {
  const generatedAt = iso(data.generated_at);
  const policy = record(data.policy);
  const health = record(data.health);
  const healthState = health?.state;
  const lastVerified = nullableIso(health?.last_verified_at);
  const message = str(health?.message);
  if (generatedAt === undefined || policy === undefined || health === undefined || typeof healthState !== 'string' || !HEALTH.includes(healthState) || lastVerified === undefined || message === undefined || !Array.isArray(data.items) || !Array.isArray(data.restore_requests)) {
    return undefined;
  }
  const latestLocal = nullableIso(data.latest_local_at);
  const latestOffsite = nullableIso(data.latest_offsite_at);
  const job = data.job === null ? null : parseJob(data.job);
  const scheduleTime = str(policy.schedule_time);
  const scheduleZone = str(policy.schedule_timezone);
  if (latestLocal === undefined || latestOffsite === undefined || job === undefined || scheduleTime === undefined || scheduleZone === undefined) {
    return undefined;
  }
  const keepDaily = policy.keep_daily;
  const keepWeekly = policy.keep_weekly;
  const maxAge = policy.max_age_hours;
  if (typeof keepDaily !== 'number' || typeof keepWeekly !== 'number' || typeof maxAge !== 'number') {
    return undefined;
  }
  const items: BackupItem[] = [];
  for (const entry of data.items) {
    const item = parseBackup(entry);
    if (item === undefined) {
      return undefined;
    }
    items.push(item);
  }
  const restoreRequests: RestoreItem[] = [];
  for (const entry of data.restore_requests) {
    const item = parseRestore(entry);
    if (item === undefined) {
      return undefined;
    }
    restoreRequests.push(item);
  }
  return { generatedAt, policy: { keepDaily, keepWeekly, maxAgeHours: maxAge, scheduleTime, scheduleTimezone: scheduleZone }, latestLocalAt: latestLocal, latestOffsiteAt: latestOffsite, job, health: { state: healthState as BackupPage['health']['state'], lastVerifiedAt: lastVerified, message }, items, restoreRequests };
}

export class AdminOperationsApi extends ApiClient {
  audit(query: AuditQuery): Promise<ApiResult<AuditPage>> {
    const params = new URLSearchParams();
    if (query.range === 'custom') {
      params.set('from', query.from ?? '');
      params.set('to', query.to ?? '');
    }
    for (const [name, value] of [['action', query.action], ['actor_id', query.actorId], ['resource_type', query.resourceType], ['resource_id', query.resourceId], ['outcome', query.outcome], ['cursor', query.cursor]] as const) {
      if (value !== undefined && value !== '') {
        params.set(name, value);
      }
    }
    params.set('limit', '50');
    return this.call({ method: 'GET', path: `/admin/audit?${params.toString()}` }, parseAudit);
  }

  backups(): Promise<ApiResult<BackupPage>> {
    return this.call({ method: 'GET', path: '/admin/backups' }, parseBackups);
  }

  runBackup(csrf: string, input: { key: string }): Promise<ApiResult<BackupJob>> {
    return this.call({ method: 'POST', path: '/admin/backups/run', body: {}, csrf, idempotencyKey: input.key }, (data) => parseJob(data));
  }

  requestRestore(csrf: string, input: { backupId: string; reason: string; key: string }): Promise<ApiResult<RestoreItem>> {
    return this.call({ method: 'POST', path: '/admin/restore-requests', body: { backup_id: input.backupId, reason: input.reason }, csrf, idempotencyKey: input.key }, (data) => parseRestore(data));
  }

  cancelRestore(csrf: string, input: { requestId: string; expectedVersion: number; key: string }): Promise<ApiResult<RestoreItem>> {
    return this.call({ method: 'POST', path: `/admin/restore-requests/${input.requestId}/cancel`, body: { expected_version: input.expectedVersion }, csrf, idempotencyKey: input.key }, (data) => parseRestore(data));
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createOperationsSource(api: AdminOperationsApi, session?: CsrfPort): OperationsSource {
  const command = async (send: (csrf: string) => Promise<ApiResult<unknown>>): Promise<CommandResult> => {
    if (session === undefined) {
      return { kind: 'not-wired' };
    }
    const csrf = session.csrf();
    return csrf === undefined ? { kind: 'session-expired' } : commandResultOf(await send(csrf), session);
  };
  return {
    async readAudit(query): Promise<AuditRead> {
      const result = await api.audit(query);
      return result.kind === 'ok' ? { kind: 'ready', page: result.data } : failureOf(result);
    },
    async readBackups(): Promise<BackupRead> {
      const result = await api.backups();
      return result.kind === 'ok' ? { kind: 'ready', page: result.data } : failureOf(result);
    },
    runBackup: (input) => command((csrf) => api.runBackup(csrf, input)),
    requestRestore: (input) => (UUID_RE.test(input.backupId) ? command((csrf) => api.requestRestore(csrf, input)) : Promise.resolve({ kind: 'refused', code: 'ADMIN_INPUT_INVALID' })),
    cancelRestore: (input) => (UUID_RE.test(input.requestId) ? command((csrf) => api.cancelRestore(csrf, input)) : Promise.resolve({ kind: 'refused', code: 'ADMIN_INPUT_INVALID' })),
  };
}
