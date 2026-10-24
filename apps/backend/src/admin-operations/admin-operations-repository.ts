import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { JsonObject } from '../idempotency/idempotency-executor';
import { TransactionContext } from '../transaction/transaction-context';
import { AuditFilter } from './admin-operations-validation';

export interface AuditRow {
  readonly auditId: string;
  readonly occurredAt: string;
  readonly requestId: string;
  readonly actorType: string;
  readonly actorId: string | null;
  readonly action: string;
  readonly resourceType: string | null;
  readonly resourceId: string | null;
  readonly resourceVersion: number | null;
  readonly outcome: string;
  readonly reasonCode: string | null;
  readonly metadata: JsonObject;
}

export interface BackupRow {
  readonly backupId: string;
  readonly kind: string;
  readonly state: string;
  readonly startedAtMs: number;
  readonly finishedAtMs: number | null;
  readonly sizeBytes: number | null;
  readonly schemaVersion: string | null;
  readonly encrypted: boolean;
  readonly offsite: boolean;
  readonly verifiedAtMs: number | null;
  readonly verifyNote: string | null;
  readonly errorCode: string | null;
  readonly stage: 'STARTED' | 'LOCAL' | 'UPLOADED' | 'VERIFIED';
  readonly failedStage: string | null;
  readonly trigger: 'TIMER' | 'DEPLOY' | 'MANUAL' | 'WEB';
  readonly releaseVersion: string | null;
  readonly offsiteVerifiedAtMs: number | null;
}

export interface BackupJobRow {
  readonly jobId: string;
  readonly state: 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED';
  readonly backupId: string | null;
  readonly errorCode: string | null;
  readonly createdAtMs: number;
  readonly startedAtMs: number | null;
  readonly finishedAtMs: number | null;
}

export interface RestoreRow {
  readonly requestId: string;
  readonly backupId: string;
  readonly backupKind: string;
  readonly backupStartedAtMs: number;
  readonly reason: string;
  readonly state: string;
  readonly operatorNote: string | null;
  readonly version: number;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

const whole = (value: string | null): number | null => {
  if (value === null) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new TechnicalError('internal', 'Database returned an unexpected number');
  }
  return parsed;
};
const ms = (column: string): string => `(extract(epoch FROM ${column}) * 1000)::bigint::text`;

const BACKUP_COLUMNS = `backup_id::text AS backup_id, kind, state, ${ms('started_at')} AS started_ms, ${ms('finished_at')} AS finished_ms, size_bytes::text AS size_bytes, schema_version, encrypted, offsite, ${ms('verified_at')} AS verified_ms, verify_note, error_code, stage, failed_stage, trigger_kind, release_version, ${ms('offsite_verified_at')} AS offsite_verified_ms`;
const JOB_COLUMNS = `job_id::text AS job_id, state, backup_id::text AS backup_id, error_code, ${ms('created_at')} AS created_ms, ${ms('started_at')} AS started_ms, ${ms('finished_at')} AS finished_ms`;
const RESTORE_COLUMNS = `r.request_id::text AS request_id, r.backup_id::text AS backup_id, b.kind AS backup_kind, ${ms('b.started_at')} AS backup_started_ms, r.reason, r.state, r.operator_note, r.version::text AS version, ${ms('r.created_at')} AS created_ms, ${ms('r.updated_at')} AS updated_ms`;

const toBackup = (row: Record<string, string | boolean | null>): BackupRow => ({
  backupId: row.backup_id as string, kind: row.kind as string, state: row.state as string, startedAtMs: whole(row.started_ms as string) as number, finishedAtMs: whole(row.finished_ms as string | null),
  sizeBytes: whole(row.size_bytes as string | null), schemaVersion: row.schema_version as string | null, encrypted: row.encrypted as boolean, offsite: row.offsite as boolean, verifiedAtMs: whole(row.verified_ms as string | null),
  verifyNote: row.verify_note as string | null, errorCode: row.error_code as string | null, stage: row.stage as BackupRow['stage'], failedStage: row.failed_stage as string | null, trigger: row.trigger_kind as BackupRow['trigger'],
  releaseVersion: row.release_version as string | null, offsiteVerifiedAtMs: whole(row.offsite_verified_ms as string | null),
});
const toJob = (row: Record<string, string | null>): BackupJobRow => ({
  jobId: row.job_id as string, state: row.state as BackupJobRow['state'], backupId: row.backup_id, errorCode: row.error_code, createdAtMs: whole(row.created_ms) as number, startedAtMs: whole(row.started_ms), finishedAtMs: whole(row.finished_ms),
});
const toRestore = (row: Record<string, string | null>): RestoreRow => ({
  requestId: row.request_id as string, backupId: row.backup_id as string, backupKind: row.backup_kind as string, backupStartedAtMs: whole(row.backup_started_ms) as number, reason: row.reason as string, state: row.state as string,
  operatorNote: row.operator_note as string | null, version: whole(row.version) as number, createdAtMs: whole(row.created_ms) as number, updatedAtMs: whole(row.updated_ms) as number,
});

/** SQL of the audit viewer, the backup history and the restore requests (M12-F). The audit log is only READ here (the table grant has no UPDATE or DELETE). */
@Injectable()
export class AdminOperationsRepository {
  async audit(context: TransactionContext, filter: AuditFilter, fromMs: number, toMs: number): Promise<{ rows: AuditRow[]; more: boolean }> {
    const where: string[] = ['occurred_at >= to_timestamp($1::bigint / 1000.0)', 'occurred_at < to_timestamp($2::bigint / 1000.0)'];
    const values: unknown[] = [fromMs, toMs];
    const add = (sql: string, value: unknown): void => {
      values.push(value);
      where.push(sql.replace('?', `$${String(values.length)}`));
    };
    if (filter.action !== undefined) {
      // A prefix on the dotted name: "admin.report" finds every report action; the pattern characters of LIKE cannot appear (the parser allows [a-z0-9_.] and _ is escaped).
      add(`action LIKE ? ESCAPE '\\'`, `${filter.action.replace(/[\\%_]/g, '\\$&')}%`);
    }
    if (filter.actorId !== undefined) add('actor_id = ?', filter.actorId);
    if (filter.resourceType !== undefined) add('resource_type = ?', filter.resourceType);
    if (filter.resourceId !== undefined) add('resource_id = ?', filter.resourceId);
    if (filter.outcome !== undefined) add('outcome = ?', filter.outcome);
    if (filter.requestId !== undefined) add('request_id = ?::uuid', filter.requestId);
    if (filter.cursor !== undefined) {
      values.push(filter.cursor.occurredAt, filter.cursor.auditId);
      where.push(`(occurred_at, audit_id) < ($${String(values.length - 1)}::timestamptz, $${String(values.length)}::uuid)`);
    }
    values.push(filter.limit + 1);
    const result = await context.query<{
      audit_id: string; occurred_at: string; request_id: string; actor_type: string; actor_id: string | null; action: string; resource_type: string | null; resource_id: string | null;
      resource_version: string | null; outcome: string; reason_code: string | null; metadata: JsonObject;
    }>(
      `SELECT audit_id::text AS audit_id, to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS occurred_at, request_id::text AS request_id, actor_type, actor_id, action, resource_type, resource_id,
              resource_version::text AS resource_version, outcome, reason_code, metadata
         FROM app.audit_logs WHERE ${where.join(' AND ')} ORDER BY occurred_at DESC, audit_id DESC LIMIT $${String(values.length)}::int`,
      values,
    );
    const rows = result.rows.slice(0, filter.limit).map(
      (row): AuditRow => ({ auditId: row.audit_id, occurredAt: row.occurred_at, requestId: row.request_id, actorType: row.actor_type, actorId: row.actor_id, action: row.action, resourceType: row.resource_type, resourceId: row.resource_id, resourceVersion: whole(row.resource_version), outcome: row.outcome, reasonCode: row.reason_code, metadata: row.metadata }),
    );
    return { rows, more: result.rows.length > filter.limit };
  }

  async backups(context: TransactionContext, limit: number): Promise<BackupRow[]> {
    const result = await context.query<Record<string, string | boolean | null>>(`SELECT ${BACKUP_COLUMNS} FROM app.backup_records ORDER BY started_at DESC, backup_id LIMIT $1::int`, [limit]);
    return result.rows.map(toBackup);
  }

  async findBackup(context: TransactionContext, backupId: string): Promise<BackupRow | undefined> {
    const result = await context.query<Record<string, string | boolean | null>>(`SELECT ${BACKUP_COLUMNS} FROM app.backup_records WHERE backup_id = $1::uuid`, [backupId]);
    return result.rows[0] === undefined ? undefined : toBackup(result.rows[0]);
  }

  async restores(context: TransactionContext, limit: number): Promise<RestoreRow[]> {
    const result = await context.query<Record<string, string | null>>(`SELECT ${RESTORE_COLUMNS} FROM app.restore_requests r JOIN app.backup_records b ON b.backup_id = r.backup_id ORDER BY r.created_at DESC, r.request_id LIMIT $1::int`, [limit]);
    return result.rows.map(toRestore);
  }

  async findRestore(context: TransactionContext, requestId: string, lock = false): Promise<RestoreRow | undefined> {
    const result = await context.query<Record<string, string | null>>(
      `SELECT ${RESTORE_COLUMNS} FROM app.restore_requests r JOIN app.backup_records b ON b.backup_id = r.backup_id WHERE r.request_id = $1::uuid${lock ? ' FOR UPDATE OF r' : ''}`,
      [requestId],
    );
    return result.rows[0] === undefined ? undefined : toRestore(result.rows[0]);
  }

  /** The job that is queued or running (at most one: unique index), else the newest finished one. */
  async currentJob(context: TransactionContext): Promise<BackupJobRow | undefined> {
    const result = await context.query<Record<string, string | null>>(`SELECT ${JOB_COLUMNS} FROM app.backup_jobs ORDER BY (state IN ('QUEUED', 'RUNNING')) DESC, created_at DESC LIMIT 1`);
    return result.rows[0] === undefined ? undefined : toJob(result.rows[0]);
  }

  async openJobCount(context: TransactionContext): Promise<number> {
    const result = await context.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.backup_jobs WHERE state IN ('QUEUED', 'RUNNING')`);
    return whole(result.rows[0]?.n ?? '0') as number;
  }

  /** A backup run that is still STARTED (the timer or a deploy is running one) also blocks "Sao lưu ngay". */
  async runningBackupCount(context: TransactionContext): Promise<number> {
    const result = await context.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.backup_records WHERE state = 'RUNNING' AND started_at > clock_timestamp() - interval '6 hours'`);
    return whole(result.rows[0]?.n ?? '0') as number;
  }

  async insertJob(context: TransactionContext, job: { jobId: string; requestedBy: string }): Promise<BackupJobRow> {
    const result = await context.query<Record<string, string | null>>(
      `INSERT INTO app.backup_jobs (job_id, requested_by, state, version, created_at) VALUES ($1::uuid, $2::uuid, 'QUEUED', 1, date_trunc('milliseconds', clock_timestamp())) RETURNING ${JOB_COLUMNS}`,
      [job.jobId, job.requestedBy],
    );
    return toJob(result.rows[0] as Record<string, string | null>);
  }

  async openRestoreCount(context: TransactionContext): Promise<number> {
    const result = await context.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.restore_requests WHERE state IN ('REQUESTED', 'IN_PROGRESS')`);
    return whole(result.rows[0]?.n ?? '0') as number;
  }

  async insertRestore(context: TransactionContext, request: { requestId: string; backupId: string; requestedBy: string; reason: string }): Promise<void> {
    await context.query(
      `INSERT INTO app.restore_requests (request_id, backup_id, requested_by, reason, state, version, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'REQUESTED', 1, date_trunc('milliseconds', clock_timestamp()), date_trunc('milliseconds', clock_timestamp()))`,
      [request.requestId, request.backupId, request.requestedBy, request.reason],
    );
  }

  /** Compare-and-set: only a REQUESTED row at the version the caller saw is cancelled. */
  async cancelRestore(context: TransactionContext, requestId: string, expectedVersion: number): Promise<boolean> {
    const result = await context.query(
      `UPDATE app.restore_requests SET state = 'CANCELLED', version = version + 1, updated_at = date_trunc('milliseconds', clock_timestamp()) WHERE request_id = $1::uuid AND state = 'REQUESTED' AND version = $2::bigint`,
      [requestId, expectedVersion],
    );
    return result.rowCount === 1;
  }
}
