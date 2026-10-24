import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { JsonObject } from '../idempotency/idempotency-executor';
import { TransactionContext } from '../transaction/transaction-context';

export type ExportState = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'EXPIRED';

export interface ExportJobRow {
  readonly jobId: string;
  readonly requestedBy: string;
  readonly kind: string;
  readonly format: 'csv' | 'xlsx';
  readonly filter: JsonObject;
  readonly state: ExportState;
  readonly errorCode: string | null;
  readonly rowCount: number | null;
  readonly fileName: string | null;
  readonly fileBytes: number | null;
  readonly version: number;
  readonly createdAtMs: number;
  readonly finishedAtMs: number | null;
  readonly expiresAtMs: number | null;
}

interface Raw {
  job_id: string;
  requested_by: string;
  report_kind: string;
  format: 'csv' | 'xlsx';
  filter: JsonObject;
  state: ExportState;
  error_code: string | null;
  row_count: number | null;
  file_name: string | null;
  file_bytes: string | null;
  version: string;
  created_ms: string;
  finished_ms: string | null;
  expires_ms: string | null;
}

const COLUMNS = `job_id::text AS job_id, requested_by::text AS requested_by, report_kind, format, filter, state, error_code, row_count, file_name, file_bytes::text AS file_bytes, version::text AS version,
  (extract(epoch FROM created_at) * 1000)::bigint::text AS created_ms, (extract(epoch FROM finished_at) * 1000)::bigint::text AS finished_ms, (extract(epoch FROM expires_at) * 1000)::bigint::text AS expires_ms`;

const num = (value: string | null): number | null => {
  if (value === null) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new TechnicalError('internal', 'Database returned an unexpected number');
  }
  return parsed;
};

const toJob = (row: Raw): ExportJobRow => ({
  jobId: row.job_id, requestedBy: row.requested_by, kind: row.report_kind, format: row.format, filter: row.filter, state: row.state, errorCode: row.error_code, rowCount: row.row_count,
  fileName: row.file_name, fileBytes: num(row.file_bytes), version: num(row.version) as number, createdAtMs: num(row.created_ms) as number, finishedAtMs: num(row.finished_ms), expiresAtMs: num(row.expires_ms),
});

/** SQL of the export jobs (M12-E). One writer path: the runner moves a job QUEUED -> RUNNING -> DONE / FAILED, and later DONE -> EXPIRED; each move is a compare-and-set on the state. */
@Injectable()
export class AdminReportRepository {
  async insert(context: TransactionContext, job: { jobId: string; requestedBy: string; kind: string; format: string; filter: JsonObject }): Promise<ExportJobRow> {
    const result = await context.query<Raw>(
      `INSERT INTO app.report_export_jobs (job_id, requested_by, report_kind, format, filter, state, version, created_at)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb, 'QUEUED', 1, date_trunc('milliseconds', clock_timestamp())) RETURNING ${COLUMNS}`,
      [job.jobId, job.requestedBy, job.kind, job.format, JSON.stringify(job.filter)],
    );
    return toJob(result.rows[0] as Raw);
  }

  async openCount(context: TransactionContext, userId: string): Promise<number> {
    const result = await context.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.report_export_jobs WHERE requested_by = $1::uuid AND state IN ('QUEUED', 'RUNNING')`, [userId]);
    return num(result.rows[0]?.n ?? '0') as number;
  }

  async find(context: TransactionContext, jobId: string, lock = false): Promise<ExportJobRow | undefined> {
    const result = await context.query<Raw>(`SELECT ${COLUMNS} FROM app.report_export_jobs WHERE job_id = $1::uuid${lock ? ' FOR UPDATE' : ''}`, [jobId]);
    return result.rows[0] === undefined ? undefined : toJob(result.rows[0]);
  }

  async listOf(context: TransactionContext, userId: string, limit: number): Promise<ExportJobRow[]> {
    const result = await context.query<Raw>(`SELECT ${COLUMNS} FROM app.report_export_jobs WHERE requested_by = $1::uuid ORDER BY created_at DESC, job_id LIMIT $2::int`, [userId, limit]);
    return result.rows.map(toJob);
  }

  /** The oldest queued job, locked and skipped by other runners, moved to RUNNING in the same statement. */
  async claim(context: TransactionContext): Promise<ExportJobRow | undefined> {
    const result = await context.query<Raw>(
      `UPDATE app.report_export_jobs SET state = 'RUNNING', started_at = date_trunc('milliseconds', clock_timestamp()), version = version + 1
        WHERE job_id = (SELECT job_id FROM app.report_export_jobs WHERE state = 'QUEUED' ORDER BY created_at, job_id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING ${COLUMNS}`,
    );
    return result.rows[0] === undefined ? undefined : toJob(result.rows[0]);
  }

  /** A job still RUNNING long after it started belongs to a process that died: it ends FAILED (INTERRUPTED), never silently re-run and never left "running". */
  async failInterrupted(context: TransactionContext, olderThanSeconds: number): Promise<number> {
    const result = await context.query(
      `UPDATE app.report_export_jobs SET state = 'FAILED', error_code = 'INTERRUPTED', finished_at = date_trunc('milliseconds', clock_timestamp()), version = version + 1
        WHERE state = 'RUNNING' AND started_at < clock_timestamp() - make_interval(secs => $1::double precision)`,
      [olderThanSeconds],
    );
    return result.rowCount ?? 0;
  }

  async fail(context: TransactionContext, jobId: string, code: string): Promise<boolean> {
    const result = await context.query(
      `UPDATE app.report_export_jobs SET state = 'FAILED', error_code = $2, finished_at = date_trunc('milliseconds', clock_timestamp()), version = version + 1 WHERE job_id = $1::uuid AND state = 'RUNNING'`,
      [jobId, code],
    );
    return result.rowCount === 1;
  }

  /** The file and the DONE state are written together or not at all (one transaction): a job is never DONE without its file. */
  async complete(context: TransactionContext, job: { jobId: string; fileName: string; content: Buffer; sha256: string; rowCount: number; keepSeconds: number }): Promise<boolean> {
    const moved = await context.query(
      `UPDATE app.report_export_jobs SET state = 'DONE', file_name = $2, file_bytes = $3::bigint, file_sha256 = $4, row_count = $5::int,
              finished_at = date_trunc('milliseconds', clock_timestamp()), expires_at = date_trunc('milliseconds', clock_timestamp()) + make_interval(secs => $6::double precision), version = version + 1
        WHERE job_id = $1::uuid AND state = 'RUNNING'`,
      [job.jobId, job.fileName, job.content.length, job.sha256, job.rowCount, job.keepSeconds],
    );
    if (moved.rowCount !== 1) {
      return false;
    }
    await context.query('INSERT INTO app.report_export_files (job_id, content) VALUES ($1::uuid, $2::bytea)', [job.jobId, job.content]);
    return true;
  }

  async content(context: TransactionContext, jobId: string): Promise<Buffer | undefined> {
    const result = await context.query<{ content: Buffer }>('SELECT content FROM app.report_export_files WHERE job_id = $1::uuid', [jobId]);
    return result.rows[0]?.content;
  }

  /** DONE files past their time: the bytes are deleted and the job becomes EXPIRED (the record of who exported what stays). */
  async expireDue(context: TransactionContext): Promise<number> {
    const due = await context.query<{ job_id: string }>(`SELECT job_id::text AS job_id FROM app.report_export_jobs WHERE state = 'DONE' AND expires_at <= clock_timestamp() FOR UPDATE SKIP LOCKED LIMIT 50`);
    for (const row of due.rows) {
      await context.query('DELETE FROM app.report_export_files WHERE job_id = $1::uuid', [row.job_id]);
      await context.query(`UPDATE app.report_export_jobs SET state = 'EXPIRED', version = version + 1 WHERE job_id = $1::uuid`, [row.job_id]);
    }
    return due.rows.length;
  }
}
