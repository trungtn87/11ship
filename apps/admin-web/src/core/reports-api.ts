// HTTP client of the reports (M12-E): GET /v1/admin/reports/:kind, GET/POST /v1/admin/reports/exports and the file download. Cookie-only; the CSRF token is passed in from memory.
// Every JSON answer is parsed strictly. The file is fetched with the session cookie and handed to the page as a Blob (an error body is never saved as if it were the file).

import { CsrfPort, failureOf } from './accounts-api.js';
import { ApiClient, ApiResult, record, str } from './api.js';
import { CommandResult, commandResultOf } from './commands.js';
import { OVERVIEW_RANGES } from './overview.js';
import { DownloadResult, EXPORT_STATE_LABEL, ExportJob, ExportListRead, ExportRequest, ExportState, REPORT_KINDS, ReportColumn, ReportData, ReportKind, ReportQuery, ReportRead, ReportRow, ReportSource, ReportSummaryItem } from './reports.js';

export const REPORTS_BASE = '/v1';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FORMATS: readonly string[] = ['count', 'vnd', 'signed-vnd', 'percent', 'seconds', 'text'];
const iso = (value: unknown): string | undefined => {
  const text = str(value);
  return text !== undefined && !Number.isNaN(Date.parse(text)) ? text : undefined;
};
const whole = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function parseLink(value: unknown): Record<string, string> | null | undefined {
  if (value === undefined) {
    return null;
  }
  const raw = record(value);
  if (raw === undefined) {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(raw)) {
    if (typeof entry !== 'string') {
      return undefined;
    }
    out[key] = entry;
  }
  return out;
}

export function parseReport(data: Record<string, unknown>): ReportData | undefined {
  const period = record(data.period);
  const generatedAt = iso(data.generated_at);
  const title = str(data.title);
  const basisLabel = str(data.basis_label);
  const fromDay = str(period?.from_day);
  const toDay = str(period?.to_day);
  if (
    typeof data.kind !== 'string' || !(REPORT_KINDS as readonly string[]).includes(data.kind) || generatedAt === undefined || title === undefined || basisLabel === undefined || period === undefined || fromDay === undefined || toDay === undefined ||
    typeof period.range !== 'string' || !(OVERVIEW_RANGES as readonly string[]).includes(period.range) || !Array.isArray(data.summary) || !Array.isArray(data.columns) || !Array.isArray(data.rows) || !Array.isArray(data.notes) || typeof data.truncated !== 'boolean'
  ) {
    return undefined;
  }
  const summary: ReportSummaryItem[] = [];
  for (const entry of data.summary) {
    const raw = record(entry);
    const key = str(raw?.key);
    const label = str(raw?.label);
    const link = parseLink(raw?.link);
    if (raw === undefined || key === undefined || label === undefined || link === undefined || typeof raw.format !== 'string' || !FORMATS.includes(raw.format) || (raw.value !== null && typeof raw.value !== 'number' && typeof raw.value !== 'string') || (raw.note !== undefined && typeof raw.note !== 'string')) {
      return undefined;
    }
    summary.push({ key, label, value: raw.value as number | string | null, format: raw.format as ReportSummaryItem['format'], note: typeof raw.note === 'string' ? raw.note : null, link });
  }
  const columns: ReportColumn[] = [];
  for (const entry of data.columns) {
    const raw = record(entry);
    const key = str(raw?.key);
    const label = str(raw?.label);
    if (raw === undefined || key === undefined || label === undefined || typeof raw.format !== 'string' || !FORMATS.includes(raw.format)) {
      return undefined;
    }
    columns.push({ key, label, format: raw.format as ReportColumn['format'] });
  }
  const rows: ReportRow[] = [];
  for (const entry of data.rows) {
    const raw = record(entry);
    const link = parseLink(raw?.link);
    if (raw === undefined || link === undefined || !Array.isArray(raw.cells) || raw.cells.length !== columns.length || !raw.cells.every((cell) => cell === null || typeof cell === 'number' || typeof cell === 'string')) {
      return undefined;
    }
    rows.push({ cells: raw.cells as ReportRow['cells'], link });
  }
  if (!data.notes.every((note) => typeof note === 'string')) {
    return undefined;
  }
  return { kind: data.kind as ReportKind, title, basisLabel, generatedAt, period: { range: period.range as ReportData['period']['range'], fromDay, toDay }, summary, columns, rows, truncated: data.truncated, notes: data.notes as string[] };
}

export function parseJob(value: unknown): ExportJob | undefined {
  const raw = record(value);
  const id = str(raw?.job_id);
  const createdAt = iso(raw?.created_at);
  const finishedAt = raw?.finished_at === null ? null : iso(raw?.finished_at);
  const expiresAt = raw?.expires_at === null ? null : iso(raw?.expires_at);
  const fileName = raw?.file_name === null ? null : str(raw?.file_name);
  const errorCode = raw?.error_code === null ? null : str(raw?.error_code);
  if (
    raw === undefined || id === undefined || !UUID_RE.test(id) || createdAt === undefined || finishedAt === undefined || expiresAt === undefined || fileName === undefined || errorCode === undefined ||
    typeof raw.kind !== 'string' || !(REPORT_KINDS as readonly string[]).includes(raw.kind) || (raw.format !== 'csv' && raw.format !== 'xlsx') || typeof raw.state !== 'string' || !(raw.state in EXPORT_STATE_LABEL) ||
    (raw.row_count !== null && !whole(raw.row_count)) || (raw.file_bytes !== null && !whole(raw.file_bytes))
  ) {
    return undefined;
  }
  return { id, kind: raw.kind as ReportKind, format: raw.format, state: raw.state as ExportState, errorCode, rowCount: raw.row_count as number | null, fileName, fileBytes: raw.file_bytes as number | null, createdAt, finishedAt, expiresAt };
}

function parseJobs(data: Record<string, unknown>): ExportJob[] | undefined {
  if (!Array.isArray(data.items)) {
    return undefined;
  }
  const jobs: ExportJob[] = [];
  for (const entry of data.items) {
    const job = parseJob(entry);
    if (job === undefined) {
      return undefined;
    }
    jobs.push(job);
  }
  return jobs;
}

export class AdminReportApi extends ApiClient {
  read(query: ReportQuery): Promise<ApiResult<ReportData>> {
    const params = new URLSearchParams({ range: query.range, basis: query.basis });
    if (query.range === 'custom') {
      params.set('from', query.from ?? '');
      params.set('to', query.to ?? '');
    }
    return this.call({ method: 'GET', path: `/admin/reports/${query.kind}?${params.toString()}` }, parseReport);
  }

  listExports(): Promise<ApiResult<ExportJob[]>> {
    return this.call({ method: 'GET', path: '/admin/reports/exports' }, parseJobs);
  }

  createExport(csrf: string, request: ExportRequest): Promise<ApiResult<ExportJob>> {
    const q = request.query;
    const body: Record<string, unknown> = { kind: q.kind, format: request.format, range: q.range, basis: q.basis };
    if (q.range === 'custom') {
      body.from = q.from;
      body.to = q.to;
    }
    return this.call({ method: 'POST', path: '/admin/reports/exports', body, csrf, idempotencyKey: request.key }, (data) => parseJob(data));
  }
}

export function createReportSource(api: AdminReportApi, fetchImpl: typeof fetch, session?: CsrfPort): ReportSource {
  return {
    async read(query): Promise<ReportRead> {
      const result = await api.read(query);
      return result.kind === 'ok' ? { kind: 'ready', report: result.data } : failureOf(result);
    },
    async listExports(): Promise<ExportListRead> {
      const result = await api.listExports();
      return result.kind === 'ok' ? { kind: 'ready', jobs: result.data } : failureOf(result);
    },
    async createExport(request): Promise<CommandResult> {
      if (session === undefined) {
        return { kind: 'not-wired' };
      }
      const csrf = session.csrf();
      if (csrf === undefined) {
        return { kind: 'session-expired' };
      }
      return commandResultOf(await api.createExport(csrf, request), session);
    },
    async download(jobId): Promise<DownloadResult> {
      if (!UUID_RE.test(jobId)) {
        return { kind: 'failed', code: null, status: 0 };
      }
      try {
        const response = await fetchImpl(`${REPORTS_BASE}/admin/reports/exports/${jobId}/download`, { method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
        if (!response.ok) {
          let code: string | null = null;
          try {
            code = str(record(record(await response.json())?.error)?.code) ?? null;
          } catch {
            code = null;
          }
          return { kind: 'failed', code, status: response.status };
        }
        const disposition = response.headers.get('content-disposition') ?? '';
        const name = /filename="([A-Za-z0-9_.-]{1,120})"/.exec(disposition)?.[1] ?? 'bao-cao';
        return { kind: 'ok', fileName: name, blob: await response.blob() };
      } catch {
        return { kind: 'failed', code: null, status: 0 };
      }
    },
  };
}
