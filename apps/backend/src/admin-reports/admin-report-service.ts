import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AdminRights, AdminRightsReader } from '../admin-m12/admin-rights';
import { OverviewRange, Period, resolvePeriod } from '../admin-m12/vietnam-time';
import { PROVISIONING_SCOPE_TYPE } from '../admin-provisioning/admin-provisioning-constants';
import { setBusinessLockTimeout } from '../admin-provisioning/admin-provisioning-locks';
import { AdminSystemActor } from '../admin-provisioning/admin-system-actor';
import { AuditWriter } from '../audit/audit-writer';
import { AppError } from '../common/app-errors';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { PERMISSION_REPORT_EXPORT } from '../finance-access/finance-access-constants';
import { IdempotencyExecutor, IdempotentOutcome, JsonObject } from '../idempotency/idempotency-executor';
import { TransactionManager } from '../transaction/transaction-manager';
import { ExportBody, ReportFilter } from './admin-report-validation';
import { AdminReportRepository, ExportJobRow } from './admin-report-repository';
import { renderExport } from './export-file';
import { Report, ReportBuilder, ReportKind, requiredRights } from './report-builder';

/** The screen shows the first 200 rows; the export carries up to 20 000 or fails (it never carries a part and calls it complete). */
export const SCREEN_ROWS = 200;
export const EXPORT_MAX_ROWS = 20_000;
export const EXPORT_KEEP_SECONDS = 24 * 3600;
const MAX_OPEN_JOBS = 3;
const INTERRUPTED_AFTER_SECONDS = 600;

const OPERATION_CREATE = 'admin.report.export.create.v1';
const OPERATION_DOWNLOAD = 'admin.report.export.download.v1';
const RESOURCE = 'report_export';
const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

const CONTENT_TYPE = { csv: 'text/csv; charset=utf-8', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } as const;

const reportView = (report: Report, period: Period, nowMs: number): JsonObject => ({
  kind: report.kind,
  title: report.title,
  basis_label: report.basisLabel,
  generated_at: iso(nowMs),
  period: { range: period.range, from_day: period.fromDay, to_day: period.toDay },
  summary: report.summary.map((item) => ({ key: item.key, label: item.label, value: item.value, format: item.format, ...(item.note === undefined ? {} : { note: item.note }), ...(item.link === undefined ? {} : { link: { ...item.link } }) })),
  columns: report.columns.map((column) => ({ key: column.key, label: column.label, format: column.format })),
  rows: report.rows.map((row) => ({ cells: [...row.cells], ...(row.link === undefined ? {} : { link: { ...row.link } }) })),
  truncated: report.truncated,
  notes: [...report.notes],
});

const jobView = (job: ExportJobRow): JsonObject => ({
  job_id: job.jobId,
  kind: job.kind,
  format: job.format,
  state: job.state,
  error_code: job.errorCode,
  row_count: job.rowCount,
  file_name: job.fileName,
  file_bytes: job.fileBytes,
  created_at: iso(job.createdAtMs),
  finished_at: iso(job.finishedAtMs),
  expires_at: iso(job.expiresAtMs),
  filter: job.filter,
});

/**
 * M12-E: the administration reports and their exports. READ (the screen) needs `report.read` (and `wallet.read` for money); EXPORT needs `report.export` as well, checked when the
 * job is created, when it runs (the creator's rights at that moment) and when the file is downloaded - a right taken back in between stops the file. The period of an export is fixed
 * when it is asked for. Only the creator downloads their own file; every create and every download is audited with the filter. Exports are created by POST and processed in the
 * background; the screen never streams "all the history".
 */
@Injectable()
export class AdminReportService {
  readonly #log = new Logger(AdminReportService.name);
  readonly #lockTimeoutMs: number;

  constructor(
    private readonly transactions: TransactionManager,
    private readonly executor: IdempotencyExecutor,
    private readonly actor: AdminSystemActor,
    private readonly rights: AdminRightsReader,
    private readonly builder: ReportBuilder,
    private readonly jobs: AdminReportRepository,
    private readonly audit: AuditWriter,
    @Inject(APP_CONFIG) appConfig: AppConfig,
  ) {
    this.#lockTimeoutMs = appConfig.idempotency.businessLockTimeoutMs;
  }

  async report(sessionToken: string | undefined, kind: ReportKind, filter: ReportFilter): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.transactions.withTransaction(async (context) => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      const rights = await this.rights.read(context, known);
      const period = this.#period(filter, rights.nowMs);
      const report = await this.builder.build(context, kind, period, filter.basis, rights, SCREEN_ROWS);
      return reportView(report, period, rights.nowMs);
    });
  }

  async listExports(sessionToken: string | undefined): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.transactions.withTransaction(async (context) => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      const rights = await this.rights.read(context, known);
      rights.require(PERMISSION_REPORT_EXPORT);
      return { items: (await this.jobs.listOf(context, known.userId, 20)).map(jobView) };
    });
  }

  createExport(sessionToken: string | undefined, csrf: unknown, body: ExportBody, key: string | readonly string[] | undefined, meta: { requestId: string }): Promise<IdempotentOutcome> {
    return this.#create(sessionToken, csrf, body, key, meta);
  }

  async #create(sessionToken: string | undefined, csrf: unknown, body: ExportBody, key: string | readonly string[] | undefined, meta: { requestId: string }): Promise<IdempotentOutcome> {
    const known = await this.actor.precheck(sessionToken, { required: true, header: csrf });
    return this.executor.execute(
      {
        scopeType: PROVISIONING_SCOPE_TYPE,
        scopeId: known.userId,
        operationId: OPERATION_CREATE,
        idempotencyKey: key,
        logicalRequest: { kind: body.kind, format: body.format, range: body.filter.range, from: body.filter.from ?? null, to: body.filter.to ?? null, basis: body.filter.basis },
        replay: {
          kind: 'sensitive',
          authorize: async (context, guard) => {
            if (guard.actor_user_id !== known.userId) {
              throw new AppError('ADMIN_SESSION_INVALID');
            }
            this.#requireExport(await this.rights.read(context, known), body.kind);
            return true;
          },
        },
      },
      async (context) => {
        const rights = await this.rights.read(context, known);
        this.#requireExport(rights, body.kind);
        const period = this.#period(body.filter, rights.nowMs);
        if ((await this.jobs.openCount(context, known.userId)) >= MAX_OPEN_JOBS) {
          throw new AppError('REPORT_EXPORT_LIMIT');
        }
        const filter: JsonObject = { range: body.filter.range, basis: body.filter.basis, from_day: period.fromDay, to_day: period.toDay, from_ms: period.fromMs, to_ms: period.toMs };
        const job = await this.jobs.insert(context, { jobId: randomUUID(), requestedBy: known.userId, kind: body.kind, format: body.format, filter });
        await this.audit.append(context, { requestId: meta.requestId, actorType: rights.role, actorId: known.userId, action: OPERATION_CREATE, resourceType: RESOURCE, resourceId: job.jobId, resourceVersion: 1, outcome: 'SUCCESS', metadata: { kind: body.kind, format: body.format, ...filter } });
        return { status: 200, replayGuard: { actor_user_id: known.userId }, payload: jobView(job) };
      },
    );
  }

  /** The file of one of the caller's own finished exports. The rights are read NOW: a right taken back since the job ran stops the download. */
  async download(sessionToken: string | undefined, jobId: string, meta: { requestId: string }): Promise<{ readonly fileName: string; readonly contentType: string; readonly content: Buffer }> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.transactions.withTransaction(async (context) => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      const rights = await this.rights.read(context, known);
      const job = await this.jobs.find(context, jobId);
      // Somebody else's job looks exactly like a missing one.
      if (job === undefined || job.requestedBy !== known.userId) {
        throw new AppError('REPORT_EXPORT_NOT_FOUND');
      }
      this.#requireExport(rights, job.kind as ReportKind);
      if (job.state === 'EXPIRED' || (job.state === 'DONE' && (job.expiresAtMs ?? 0) <= rights.nowMs)) {
        throw new AppError('REPORT_EXPORT_EXPIRED');
      }
      const content = job.state === 'DONE' ? await this.jobs.content(context, jobId) : undefined;
      if (job.state !== 'DONE' || content === undefined || job.fileName === null) {
        throw new AppError('REPORT_EXPORT_NOT_READY');
      }
      await this.audit.append(context, { requestId: meta.requestId, actorType: rights.role, actorId: known.userId, action: OPERATION_DOWNLOAD, resourceType: RESOURCE, resourceId: jobId, resourceVersion: job.version, outcome: 'SUCCESS', metadata: { kind: job.kind, format: job.format, rows: job.rowCount ?? 0 } });
      return { fileName: job.fileName, contentType: CONTENT_TYPE[job.format], content };
    });
  }

  // ---- the background side ----------------------------------------------------------------------------------------------------------

  /**
   * Processes at most one queued job: claim it, run it under the CREATOR's rights as they are NOW, and store the file together with DONE (or a code with FAILED).
   * Returns true when a job was handled. Never throws for a job's own failure: that is the job's FAILED state.
   */
  async processNext(): Promise<boolean> {
    await this.transactions.withTransaction(async (context) => {
      await this.jobs.failInterrupted(context, INTERRUPTED_AFTER_SECONDS);
      await this.jobs.expireDue(context);
    });
    const job = await this.transactions.withTransaction((context) => this.jobs.claim(context));
    if (job === undefined) {
      return false;
    }
    try {
      const built = await this.transactions.withTransaction(async (context) => {
        const nowMs = Number((await context.query<{ ms: string }>(`SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint::text AS ms`)).rows[0]?.ms ?? '0');
        const rights = await this.rights.readForUser(context, job.requestedBy, nowMs);
        const kind = job.kind as ReportKind;
        if (rights === undefined || !requiredRights(kind).every((right) => rights.has(right)) || !rights.has(PERMISSION_REPORT_EXPORT)) {
          return { ok: false as const, failed: 'PERMISSION_REVOKED' };
        }
        const period = this.#storedPeriod(job);
        const basis = job.filter.basis === 'ended' ? 'ended' : 'created';
        const report = await this.builder.build(context, kind, period, basis, rights, EXPORT_MAX_ROWS);
        if (report.truncated) {
          return { ok: false as const, failed: 'TOO_MANY_ROWS' };
        }
        const madeAt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(nowMs));
        const content = renderExport(job.format, report, period, basis, madeAt);
        return { ok: true as const, content, rows: report.rows.length, period, kind };
      });
      await this.transactions.withTransaction(async (context) => {
        if (!built.ok) {
          await this.jobs.fail(context, job.jobId, built.failed);
          return;
        }
        const name = `11ship-${built.kind}-${built.period.fromDay}_${built.period.toDay}-${job.jobId.slice(0, 8)}.${job.format}`;
        if (!(await this.jobs.complete(context, { jobId: job.jobId, fileName: name, content: built.content, sha256: createHash('sha256').update(built.content).digest('hex'), rowCount: built.rows, keepSeconds: EXPORT_KEEP_SECONDS }))) {
          throw new Error('export job changed under the runner');
        }
      });
    } catch (error) {
      this.#log.warn(`report export failed: ${error instanceof Error ? error.constructor.name : 'unknown'}`);
      await this.transactions.withTransaction((context) => this.jobs.fail(context, job.jobId, 'INTERNAL')).catch(() => undefined);
    }
    return true;
  }

  #requireExport(rights: AdminRights, kind: ReportKind): void {
    for (const right of [...requiredRights(kind), PERMISSION_REPORT_EXPORT]) {
      rights.require(right);
    }
  }

  #period(filter: ReportFilter, nowMs: number): Period {
    return resolvePeriod(filter.range as OverviewRange, nowMs, filter.from === undefined || filter.to === undefined ? undefined : { from: filter.from, to: filter.to });
  }

  #storedPeriod(job: ExportJobRow): Period {
    const f = job.filter;
    if (typeof f.from_ms !== 'number' || typeof f.to_ms !== 'number' || typeof f.from_day !== 'string' || typeof f.to_day !== 'string' || typeof f.range !== 'string') {
      throw new Error('stored export filter is invalid');
    }
    return { range: f.range as OverviewRange, fromMs: f.from_ms, toMs: f.to_ms, fromDay: f.from_day, toDay: f.to_day };
  }
}

