// Types and the not-wired source of "Nhật ký" and "Sao lưu và phục hồi" (M12-F). The audit log is READ here and nothing else (there is no edit or delete anywhere); the backup history
// says honestly what exists; a restore REQUEST is recorded here and performed by an operator (the page says so). The server decides every right again.

import { Failure } from './accounts.js';
import { CommandResult } from './commands.js';

export type AuditOutcome = 'SUCCESS' | 'DENIED' | 'FAILURE';

export interface AuditItem {
  readonly id: string;
  readonly occurredAt: string;
  readonly requestId: string;
  readonly actorType: string;
  readonly actorId: string | null;
  readonly action: string;
  readonly resourceType: string | null;
  readonly resourceId: string | null;
  readonly resourceVersion: number | null;
  readonly outcome: AuditOutcome;
  readonly reasonCode: string | null;
  /** Already redacted by the server; shown as key/value text, never as HTML. */
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface AuditQuery {
  readonly range: 'today' | 'yesterday' | '7d' | 'custom';
  readonly from?: string;
  readonly to?: string;
  readonly action?: string;
  readonly actorId?: string;
  readonly resourceType?: string;
  readonly resourceId?: string;
  readonly outcome?: AuditOutcome;
  readonly cursor?: string;
}

export interface AuditPage {
  readonly generatedAt: string;
  readonly fromDay: string;
  readonly toDay: string;
  readonly items: readonly AuditItem[];
  readonly nextCursor: string | null;
}

export type AuditRead = { readonly kind: 'ready'; readonly page: AuditPage } | { readonly kind: 'not-wired'; readonly reason: string } | { readonly kind: 'failed'; readonly failure: Failure; readonly retryAfterSec?: number };

export type BackupKind = 'DAILY' | 'WEEKLY' | 'PRE_MIGRATION' | 'PRE_RESTORE' | 'MANUAL';
export const BACKUP_KIND_LABEL: Record<BackupKind, string> = { DAILY: 'Hằng ngày', WEEKLY: 'Hằng tuần', PRE_MIGRATION: 'Trước migration', PRE_RESTORE: 'Trước khi khôi phục', MANUAL: 'Thủ công' };

export interface BackupItem {
  readonly id: string;
  readonly kind: BackupKind;
  readonly state: 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly sizeBytes: number | null;
  readonly schemaVersion: string | null;
  readonly encrypted: boolean;
  readonly offsite: boolean;
  readonly verifiedAt: string | null;
  readonly verifyNote: string | null;
  readonly errorCode: string | null;
  readonly restorable: boolean;
}

export type RestoreState = 'REQUESTED' | 'CANCELLED' | 'IN_PROGRESS' | 'COMPLETED' | 'ABORTED';
export const RESTORE_STATE_LABEL: Record<RestoreState, string> = { REQUESTED: 'Đã yêu cầu, chờ vận hành', CANCELLED: 'Đã hủy', IN_PROGRESS: 'Vận hành đang khôi phục', COMPLETED: 'Đã hoàn tất', ABORTED: 'Đã dừng' };

export interface RestoreItem {
  readonly id: string;
  readonly backupId: string;
  readonly backupKind: BackupKind;
  readonly backupStartedAt: string;
  readonly reason: string;
  readonly state: RestoreState;
  readonly operatorNote: string | null;
  readonly version: number;
  readonly createdAt: string;
}

export type BackupHealthState = 'OK' | 'STALE' | 'NOT_OFFSITE' | 'NONE';

export interface BackupPage {
  readonly generatedAt: string;
  readonly policy: { readonly keepDaily: number; readonly keepWeekly: number; readonly maxAgeHours: number };
  readonly health: { readonly state: BackupHealthState; readonly lastVerifiedAt: string | null; readonly message: string };
  readonly items: readonly BackupItem[];
  readonly restoreRequests: readonly RestoreItem[];
}

export type BackupRead = { readonly kind: 'ready'; readonly page: BackupPage } | { readonly kind: 'not-wired'; readonly reason: string } | { readonly kind: 'failed'; readonly failure: Failure; readonly retryAfterSec?: number };

export interface OperationsSource {
  readAudit(query: AuditQuery): Promise<AuditRead>;
  readBackups(): Promise<BackupRead>;
  /** Each call sends exactly one request and never repeats it by itself. */
  requestRestore(input: { readonly backupId: string; readonly reason: string; readonly key: string }): Promise<CommandResult>;
  cancelRestore(input: { readonly requestId: string; readonly expectedVersion: number; readonly key: string }): Promise<CommandResult>;
}

export const NOT_WIRED_OPERATIONS_REASON = 'Mục này chưa được nối với máy chủ. Không có dữ liệu nào được hiển thị.';

export const NOT_WIRED_OPERATIONS: OperationsSource = {
  readAudit: () => Promise.resolve({ kind: 'not-wired', reason: NOT_WIRED_OPERATIONS_REASON }),
  readBackups: () => Promise.resolve({ kind: 'not-wired', reason: NOT_WIRED_OPERATIONS_REASON }),
  requestRestore: () => Promise.resolve({ kind: 'not-wired' }),
  cancelRestore: () => Promise.resolve({ kind: 'not-wired' }),
};

export const RESTORE_REFUSAL: Record<string, string> = {
  RESTORE_BACKUP_NOT_FOUND: 'Không tìm thấy bản sao lưu này.',
  RESTORE_BACKUP_NOT_USABLE: 'Chỉ khôi phục được từ bản sao lưu đã hoàn tất, đã mã hóa và đã kiểm chứng.',
  RESTORE_REQUEST_OPEN: 'Đang có một yêu cầu khôi phục chưa xong. Hủy hoặc đợi vận hành hoàn tất rồi mới tạo yêu cầu mới.',
  RESTORE_REQUEST_NOT_FOUND: 'Không tìm thấy yêu cầu khôi phục này.',
  ADMIN_INPUT_INVALID: 'Lý do cần từ 10 đến 500 ký tự.',
};

export const RESTORE_REASON_MIN = 10;
export const RESTORE_REASON_MAX = 500;
