import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AdminRights, AdminRightsReader } from '../admin-m12/admin-rights';
import { resolvePeriod } from '../admin-m12/vietnam-time';
import { PROVISIONING_SCOPE_TYPE } from '../admin-provisioning/admin-provisioning-constants';
import { setBusinessLockTimeout } from '../admin-provisioning/admin-provisioning-locks';
import { AdminSystemActor } from '../admin-provisioning/admin-system-actor';
import { AuditWriter } from '../audit/audit-writer';
import { AppError } from '../common/app-errors';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { PERMISSION_AUDIT_READ } from '../finance-access/finance-access-constants';
import { IdempotencyExecutor, IdempotentOutcome, JsonObject } from '../idempotency/idempotency-executor';
import { TransactionManager } from '../transaction/transaction-manager';
import { AdminOperationsRepository, AuditRow, BackupRow, RestoreRow } from './admin-operations-repository';
import { AuditFilter, RestoreRequestBody } from './admin-operations-validation';

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());
const RESOURCE = 'restore_request';
const OPERATION_REQUEST = 'admin.restore.request.v1';
const OPERATION_CANCEL = 'admin.restore.cancel.v1';

/** What the backup policy is. A fixed rule of the system (Owner, spec section 6): shown to the administrators, not a parameter. */
export const BACKUP_POLICY = {
  daily: true,
  keep_daily: 7,
  keep_weekly: 4,
  before_migration: true,
  offsite_required: true,
  encrypted_required: true,
  /** A newest verified backup older than this is reported STALE: the daily job did not run or did not verify. */
  max_age_hours: 26,
} as const;

/** Keys whose VALUE is never shown, whatever the audit writer let through: the viewer must not become a second place where a secret can be read. */
const SECRET_KEY = /pass|secret|token|otp|signature|authorization|cookie|private|credential|hash|(^|_)key($|_)|account_number|card/i;
const REDACTED = '[đã ẩn]';

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) {
    return REDACTED;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redact(item, depth + 1));
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = SECRET_KEY.test(key) ? REDACTED : redact(item, depth + 1);
    }
    return out;
  }
  return typeof value === 'string' && value.length > 300 ? `${value.slice(0, 300)}…` : value;
}

const auditView = (row: AuditRow): JsonObject => ({
  audit_id: row.auditId,
  occurred_at: row.occurredAt,
  request_id: row.requestId,
  actor_type: row.actorType,
  actor_id: row.actorId,
  action: row.action,
  resource_type: row.resourceType,
  resource_id: row.resourceId,
  resource_version: row.resourceVersion,
  outcome: row.outcome,
  reason_code: row.reasonCode,
  metadata: redact(row.metadata) as JsonObject,
});

const backupView = (row: BackupRow): JsonObject => ({
  backup_id: row.backupId,
  kind: row.kind,
  state: row.state,
  started_at: iso(row.startedAtMs),
  finished_at: iso(row.finishedAtMs),
  size_bytes: row.sizeBytes,
  schema_version: row.schemaVersion,
  encrypted: row.encrypted,
  offsite: row.offsite,
  verified_at: iso(row.verifiedAtMs),
  verify_note: row.verifyNote,
  error_code: row.errorCode,
  // The only backups a restore may start from: finished, encrypted and verified.
  restorable: row.state === 'SUCCEEDED' && row.encrypted && row.verifiedAtMs !== null,
});

const restoreView = (row: RestoreRow): JsonObject => ({
  request_id: row.requestId,
  backup_id: row.backupId,
  backup_kind: row.backupKind,
  backup_started_at: iso(row.backupStartedAtMs),
  reason: row.reason,
  state: row.state,
  operator_note: row.operatorNote,
  version: row.version,
  created_at: iso(row.createdAtMs),
  updated_at: iso(row.updatedAtMs),
});

export type BackupHealthState = 'OK' | 'STALE' | 'NOT_OFFSITE' | 'NONE';

/** The honest summary of the history: OK only when the newest verified, encrypted, off-VPS backup is recent; never "OK" for a backup that was not verified. */
export function backupHealth(rows: readonly BackupRow[], nowMs: number): { state: BackupHealthState; last_verified_at: string | null; message: string } {
  const good = rows.filter((row) => row.state === 'SUCCEEDED' && row.encrypted && row.verifiedAtMs !== null);
  if (good.length === 0) {
    return { state: 'NONE', last_verified_at: null, message: 'Chưa có bản sao lưu nào được ghi nhận là đã kiểm chứng. Hệ thống chưa thể khôi phục từ bản sao lưu.' };
  }
  const offsite = good.filter((row) => row.offsite);
  const newest = (offsite.length > 0 ? offsite : good).reduce((a, b) => ((a.verifiedAtMs as number) >= (b.verifiedAtMs as number) ? a : b));
  const lastVerified = iso(newest.verifiedAtMs);
  if (offsite.length === 0) {
    return { state: 'NOT_OFFSITE', last_verified_at: lastVerified, message: 'Có bản sao lưu đã kiểm chứng nhưng chưa có bản nào nằm ngoài VPS. Mất VPS là mất cả dữ liệu lẫn bản sao.' };
  }
  const ageHours = (nowMs - (newest.verifiedAtMs as number)) / 3_600_000;
  return ageHours > BACKUP_POLICY.max_age_hours
    ? { state: 'STALE', last_verified_at: lastVerified, message: `Bản sao lưu đã kiểm chứng gần nhất cách đây hơn ${String(BACKUP_POLICY.max_age_hours)} giờ.` }
    : { state: 'OK', last_verified_at: lastVerified, message: 'Có bản sao lưu ngoài VPS, đã mã hóa và đã kiểm chứng trong 26 giờ qua.' };
}

/**
 * M12-F: the audit viewer (READ only: the log has no edit or delete path), the backup history with the honest health of the policy, and SYSTEM's restore requests.
 * The application never performs a restore: a request records who asked for which verified backup and why; an operator restores by the runbook and records the outcome.
 */
@Injectable()
export class AdminOperationsService {
  readonly #lockTimeoutMs: number;

  constructor(
    private readonly transactions: TransactionManager,
    private readonly executor: IdempotencyExecutor,
    private readonly actor: AdminSystemActor,
    private readonly rights: AdminRightsReader,
    private readonly repository: AdminOperationsRepository,
    private readonly audit: AuditWriter,
    @Inject(APP_CONFIG) appConfig: AppConfig,
  ) {
    this.#lockTimeoutMs = appConfig.idempotency.businessLockTimeoutMs;
  }

  async auditLog(sessionToken: string | undefined, filter: AuditFilter): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.transactions.withTransaction(async (context) => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      const rights = await this.rights.read(context, known);
      rights.require(PERMISSION_AUDIT_READ);
      // Default window: the last 7 Vietnam days, today included.
      const period = filter.fromDay === undefined || filter.toDay === undefined ? resolvePeriod('7d', rights.nowMs) : resolvePeriod('custom', rights.nowMs, { from: filter.fromDay, to: filter.toDay });
      const { rows, more } = await this.repository.audit(context, filter, period.fromMs, period.toMs);
      const last = rows[rows.length - 1];
      return {
        generated_at: iso(rights.nowMs),
        period: { from_day: period.fromDay, to_day: period.toDay },
        items: rows.map(auditView),
        next_cursor: more && last !== undefined ? `${last.occurredAt}_${last.auditId}` : null,
      };
    });
  }

  async backups(sessionToken: string | undefined): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.transactions.withTransaction(async (context) => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      const rights = await this.rights.read(context, known);
      this.#requireSystem(rights);
      const rows = await this.repository.backups(context, 60);
      const restores = await this.repository.restores(context, 20);
      return {
        generated_at: iso(rights.nowMs),
        policy: { ...BACKUP_POLICY },
        health: backupHealth(rows, rights.nowMs),
        items: rows.map(backupView),
        restore_requests: restores.map(restoreView),
      };
    });
  }

  requestRestore(sessionToken: string | undefined, csrf: unknown, body: RestoreRequestBody, key: string | readonly string[] | undefined, meta: { requestId: string }): Promise<IdempotentOutcome> {
    return this.#command(sessionToken, csrf, OPERATION_REQUEST, { backup_id: body.backupId, reason: body.reason }, key, async (context, rights, known) => {
      const backup = await this.repository.findBackup(context, body.backupId);
      if (backup === undefined) {
        throw new AppError('RESTORE_BACKUP_NOT_FOUND');
      }
      if (!(backup.state === 'SUCCEEDED' && backup.encrypted && backup.verifiedAtMs !== null)) {
        throw new AppError('RESTORE_BACKUP_NOT_USABLE');
      }
      if ((await this.repository.openRestoreCount(context)) > 0) {
        throw new AppError('RESTORE_REQUEST_OPEN');
      }
      const requestId = randomUUID();
      await this.repository.insertRestore(context, { requestId, backupId: body.backupId, requestedBy: known.userId, reason: body.reason });
      await this.audit.append(context, { requestId: meta.requestId, actorType: rights.role, actorId: known.userId, action: OPERATION_REQUEST, resourceType: RESOURCE, resourceId: requestId, resourceVersion: 1, outcome: 'SUCCESS', metadata: { backup_id: body.backupId, backup_kind: backup.kind, reason: body.reason } });
      const row = (await this.repository.findRestore(context, requestId)) as RestoreRow;
      return { status: 200, payload: restoreView(row) };
    });
  }

  cancelRestore(sessionToken: string | undefined, csrf: unknown, requestId: string, expectedVersion: number, key: string | readonly string[] | undefined, meta: { requestId: string }): Promise<IdempotentOutcome> {
    return this.#command(sessionToken, csrf, OPERATION_CANCEL, { request_id: requestId, expected_version: expectedVersion }, key, async (context, rights, known) => {
      const row = await this.repository.findRestore(context, requestId, true);
      if (row === undefined) {
        throw new AppError('RESTORE_REQUEST_NOT_FOUND');
      }
      if (row.state !== 'REQUESTED') {
        throw new AppError('RESTORE_REQUEST_STATE_CONFLICT');
      }
      if (row.version !== expectedVersion || !(await this.repository.cancelRestore(context, requestId, expectedVersion))) {
        throw new AppError('RESTORE_REQUEST_STATE_CONFLICT');
      }
      await this.audit.append(context, { requestId: meta.requestId, actorType: rights.role, actorId: known.userId, action: OPERATION_CANCEL, resourceType: RESOURCE, resourceId: requestId, resourceVersion: expectedVersion + 1, outcome: 'SUCCESS', metadata: { backup_id: row.backupId } });
      return { status: 200, payload: restoreView((await this.repository.findRestore(context, requestId)) as RestoreRow) };
    });
  }

  async #command(
    sessionToken: string | undefined,
    csrf: unknown,
    operationId: string,
    logicalRequest: JsonObject,
    key: string | readonly string[] | undefined,
    work: (context: Parameters<Parameters<TransactionManager['withTransaction']>[0]>[0], rights: AdminRights, known: { userId: string }) => Promise<{ status: number; payload: JsonObject }>,
  ): Promise<IdempotentOutcome> {
    const known = await this.actor.precheck(sessionToken, { required: true, header: csrf });
    return this.executor.execute(
      {
        scopeType: PROVISIONING_SCOPE_TYPE,
        scopeId: known.userId,
        operationId,
        idempotencyKey: key,
        logicalRequest,
        replay: {
          kind: 'sensitive',
          authorize: async (context, guard) => {
            if (guard.actor_user_id !== known.userId) {
              throw new AppError('ADMIN_SESSION_INVALID');
            }
            this.#requireSystem(await this.rights.read(context, known));
            return true;
          },
        },
      },
      async (context) => {
        const rights = await this.rights.read(context, known);
        this.#requireSystem(rights);
        const done = await work(context, rights, known);
        return { status: done.status, replayGuard: { actor_user_id: known.userId }, payload: done.payload };
      },
    );
  }

  /** Backups and restores are SYSTEM's: there is no function right that gives them to an ADMIN. */
  #requireSystem(rights: AdminRights): void {
    if (!rights.isSystem) {
      throw new AppError('ADMIN_FORBIDDEN');
    }
  }
}
