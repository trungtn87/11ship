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
  readonly stage: BackupStage;
  readonly failedStage: BackupStage | null;
  readonly trigger: BackupTrigger;
  readonly releaseVersion: string | null;
  readonly offsiteVerifiedAt: string | null;
  readonly restorable: boolean;
}

export type BackupStage = 'STARTED' | 'LOCAL' | 'UPLOADED' | 'VERIFIED';
export const BACKUP_STAGE_LABEL: Record<BackupStage, string> = { STARTED: 'Đang bắt đầu', LOCAL: 'Đã tạo bản trên VPS', UPLOADED: 'Đã tải lên Drive, chưa xác minh', VERIFIED: 'Đã xác minh ngoài VPS' };
export type BackupTrigger = 'TIMER' | 'DEPLOY' | 'MANUAL' | 'WEB';
export const BACKUP_TRIGGER_LABEL: Record<BackupTrigger, string> = { TIMER: 'Lịch 03:00', DEPLOY: 'Trước deploy', MANUAL: 'Chạy tay', WEB: 'Sao lưu ngay' };

export interface BackupJob {
  readonly id: string;
  readonly state: 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED';
  readonly errorCode: string | null;
  readonly createdAt: string;
  readonly finishedAt: string | null;
}

/** One plain sentence per code the backup job can report (see BACKUP_FAILURE_TEXT of the server). A code without a sentence is shown as the code itself, never as a guess. */
export const BACKUP_ERROR_TEXT: Readonly<Record<string, string>> = {
  DRIVE_NOT_CONFIGURED: 'Chưa nối Google Drive. Sao lưu chỉ nằm trên VPS.',
  DRIVE_AUTH: 'Google Drive từ chối quyền truy cập. Cần kết nối lại Drive.',
  DRIVE_QUOTA: 'Google Drive đã đầy dung lượng.',
  UPLOAD_FAILED: 'Không tải được bản sao lên Google Drive. Bản trên VPS được giữ để thử lại.',
  UPLOAD_VERIFY: 'Bản trên Google Drive không khớp bản gốc.',
  ENCRYPT_FAILED: 'Mã hóa bản sao lưu thất bại.',
  DUMP_FAILED: 'Không sao lưu được cơ sở dữ liệu.',
  PG_TOOL_OLD: 'Công cụ sao lưu PostgreSQL cũ hơn máy chủ cơ sở dữ liệu.',
  VERIFY_RESTORE: 'Khôi phục thử bản sao lưu không thành công.',
  VERIFY_SCHEMA_MISMATCH: 'Khôi phục thử cho phiên bản dữ liệu khác với nguồn.',
  VERIFY_AUDIT_COUNT: 'Khôi phục thử cho số bản ghi nhật ký không khớp.',
  VERIFY_LEDGER_COUNT: 'Khôi phục thử cho số dòng sổ cái không khớp.',
  VERIFY_LEDGER_DIFFERENCE: 'Khôi phục thử cho thấy ví và sổ cái không khớp nhau.',
  SPOOL_FULL: 'Thư mục sao lưu trên VPS đã đầy.',
  DISK_LOW: 'Dung lượng trống trên VPS không đủ để sao lưu.',
  PASSPHRASE_MISSING: 'Thiếu khóa mã hóa bản sao lưu.',
  FILES_FAILED: 'Không sao lưu được tệp ảnh.',
  INTERRUPTED: 'Lần chạy bị gián đoạn.',
};

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
  readonly policy: { readonly keepDaily: number; readonly keepWeekly: number; readonly maxAgeHours: number; readonly scheduleTime: string; readonly scheduleTimezone: string };
  readonly latestLocalAt: string | null;
  readonly latestOffsiteAt: string | null;
  readonly job: BackupJob | null;
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
  /** "Sao lưu ngay": queues one background job. Same key = same job. */
  runBackup(input: { readonly key: string }): Promise<CommandResult>;
}

export const NOT_WIRED_OPERATIONS_REASON = 'Mục này chưa được nối với máy chủ. Không có dữ liệu nào được hiển thị.';

export const NOT_WIRED_OPERATIONS: OperationsSource = {
  readAudit: () => Promise.resolve({ kind: 'not-wired', reason: NOT_WIRED_OPERATIONS_REASON }),
  readBackups: () => Promise.resolve({ kind: 'not-wired', reason: NOT_WIRED_OPERATIONS_REASON }),
  requestRestore: () => Promise.resolve({ kind: 'not-wired' }),
  cancelRestore: () => Promise.resolve({ kind: 'not-wired' }),
  runBackup: () => Promise.resolve({ kind: 'not-wired' }),
};

export const RESTORE_REFUSAL: Record<string, string> = {
  BACKUP_RUN_OPEN: 'Đang có một lần sao lưu chờ hoặc đang chạy. Đợi nó xong rồi thử lại.',
  RESTORE_BACKUP_NOT_FOUND: 'Không tìm thấy bản sao lưu này.',
  RESTORE_BACKUP_NOT_USABLE: 'Chỉ khôi phục được từ bản sao lưu đã hoàn tất, đã mã hóa và đã kiểm chứng.',
  RESTORE_REQUEST_OPEN: 'Đang có một yêu cầu khôi phục chưa xong. Hủy hoặc đợi vận hành hoàn tất rồi mới tạo yêu cầu mới.',
  RESTORE_REQUEST_NOT_FOUND: 'Không tìm thấy yêu cầu khôi phục này.',
  ADMIN_INPUT_INVALID: 'Lý do cần từ 10 đến 500 ký tự.',
};

export const RESTORE_REASON_MIN = 10;
export const RESTORE_REASON_MAX = 500;
