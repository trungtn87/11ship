// Model of "Báo cáo" (M12-E): five reports and their exports. PLAIN DATA plus the port the page talks to (dom/reports-view.ts draws it, core/reports-api.ts is the real source).
// A figure whose source does not exist is `null` with a note, never 0; a rate always shows its numerator and denominator; every report says the moment it counts at. An export is a
// background job: the page shows its state and offers the file only when the job is DONE.

import { Failure } from './accounts.js';
import { CommandResult } from './commands.js';
import { OverviewRange } from './overview.js';

export const REPORT_KINDS = ['deliveries', 'shops', 'shippers', 'quality', 'money'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const REPORT_KIND_LABEL: Record<ReportKind, string> = {
  deliveries: 'Giao hàng',
  shops: 'Quán',
  shippers: 'Shipper',
  quality: 'Chất lượng',
  money: 'Tiền và đối soát',
};

export type ReportBasis = 'created' | 'ended';

export interface ReportQuery {
  readonly kind: ReportKind;
  readonly range: OverviewRange;
  readonly from?: string;
  readonly to?: string;
  readonly basis: ReportBasis;
}

export type CellFormat = 'count' | 'vnd' | 'signed-vnd' | 'percent' | 'seconds' | 'text';

export interface ReportSummaryItem {
  readonly key: string;
  readonly label: string;
  readonly value: number | string | null;
  readonly format: CellFormat;
  readonly note: string | null;
  /** The filter of the delivery list this number counts. */
  readonly link: Readonly<Record<string, string>> | null;
}

export interface ReportColumn {
  readonly key: string;
  readonly label: string;
  readonly format: CellFormat;
}

export interface ReportRow {
  readonly cells: ReadonlyArray<number | string | null>;
  readonly link: Readonly<Record<string, string>> | null;
}

export interface ReportData {
  readonly kind: ReportKind;
  readonly title: string;
  readonly basisLabel: string;
  readonly generatedAt: string;
  readonly period: { readonly range: OverviewRange; readonly fromDay: string; readonly toDay: string };
  readonly summary: readonly ReportSummaryItem[];
  readonly columns: readonly ReportColumn[];
  readonly rows: readonly ReportRow[];
  readonly truncated: boolean;
  readonly notes: readonly string[];
}

export type ReportRead = { readonly kind: 'ready'; readonly report: ReportData } | { readonly kind: 'not-wired'; readonly reason: string } | { readonly kind: 'failed'; readonly failure: Failure; readonly retryAfterSec?: number };

export type ExportState = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'EXPIRED';
export const EXPORT_STATE_LABEL: Record<ExportState, string> = { QUEUED: 'Đang chờ', RUNNING: 'Đang tạo file', DONE: 'Sẵn sàng tải', FAILED: 'Không tạo được', EXPIRED: 'Đã hết hạn tải' };

export interface ExportJob {
  readonly id: string;
  readonly kind: ReportKind;
  readonly format: 'csv' | 'xlsx';
  readonly state: ExportState;
  readonly errorCode: string | null;
  readonly rowCount: number | null;
  readonly fileName: string | null;
  readonly fileBytes: number | null;
  readonly createdAt: string;
  readonly finishedAt: string | null;
  readonly expiresAt: string | null;
}

export type ExportListRead = { readonly kind: 'ready'; readonly jobs: readonly ExportJob[] } | { readonly kind: 'not-wired'; readonly reason: string } | { readonly kind: 'failed'; readonly failure: Failure; readonly retryAfterSec?: number };

export type DownloadResult = { readonly kind: 'ok'; readonly fileName: string; readonly blob: Blob } | { readonly kind: 'failed'; readonly code: string | null; readonly status: number };

export interface ExportRequest {
  readonly query: ReportQuery;
  readonly format: 'csv' | 'xlsx';
  /** Idempotency-Key of THIS intent. A retry after an unknown outcome sends the same one. */
  readonly key: string;
}

export interface ReportSource {
  read(query: ReportQuery): Promise<ReportRead>;
  listExports(): Promise<ExportListRead>;
  /** Sends exactly one request per call and never repeats it by itself. */
  createExport(request: ExportRequest): Promise<CommandResult>;
  download(jobId: string): Promise<DownloadResult>;
}

export const NOT_WIRED_REPORTS_REASON = 'Báo cáo chưa được nối với máy chủ. Không có số liệu nào được hiển thị.';

export const NOT_WIRED_REPORTS: ReportSource = {
  read: () => Promise.resolve({ kind: 'not-wired', reason: NOT_WIRED_REPORTS_REASON }),
  listExports: () => Promise.resolve({ kind: 'not-wired', reason: NOT_WIRED_REPORTS_REASON }),
  createExport: () => Promise.resolve({ kind: 'not-wired' }),
  download: () => Promise.resolve({ kind: 'failed', code: null, status: 0 }),
};

export const EXPORT_ERROR_TEXT: Record<string, string> = {
  PERMISSION_REVOKED: 'Quyền xuất đã bị thu hồi trước khi file được tạo.',
  TOO_MANY_ROWS: 'Báo cáo có quá nhiều dòng để xuất một lần. Hãy thu hẹp khoảng thời gian.',
  INTERRUPTED: 'Việc tạo file bị gián đoạn. Hãy tạo lại.',
  INTERNAL: 'Có lỗi khi tạo file. Hãy tạo lại.',
};

export const REPORT_REFUSAL: Record<string, string> = {
  REPORT_EXPORT_LIMIT: 'Đang có quá nhiều yêu cầu xuất chưa xong. Hãy đợi các file hoàn tất.',
  ADMIN_INPUT_INVALID: 'Bộ lọc không hợp lệ.',
};
