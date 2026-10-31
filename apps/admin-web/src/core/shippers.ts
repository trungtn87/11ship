// Model of "Vận hành › Shipper" and "Hệ thống › Tham số hệ thống › Ví Shipper" (M03). PLAIN DATA plus the port the pages talk to:
// dom/shippers-view.ts draws it, core/shippers-api.ts is the real source. The page shows only what the server said; it never decides a
// right, a state change or a value. The internal classification (PLATFORM / EXTERNAL) exists only on these pages.

import { Failure } from './accounts.js';

export const SHIPPER_PAGE_SIZE = 20;

export const SHIPPER_FILTERS = ['ALL', 'SUBMITTED', 'DRAFT', 'REJECTED', 'ACTIVE', 'SUSPENDED', 'CLOSING', 'CLOSED'] as const;
export type ShipperFilter = (typeof SHIPPER_FILTERS)[number];

export const SHIPPER_FILTER_LABEL: Record<ShipperFilter, string> = {
  ALL: 'Tất cả trạng thái',
  SUBMITTED: 'Chờ xét duyệt',
  DRAFT: 'Chưa gửi hồ sơ',
  REJECTED: 'Bị từ chối',
  ACTIVE: 'Đang hoạt động',
  SUSPENDED: 'Tạm khóa',
  CLOSING: 'Xin ngừng hoạt động',
  CLOSED: 'Đã ngừng hoạt động',
};

export type DriverStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'CLOSING' | 'CLOSED';
export type ReviewState = 'DRAFT' | 'SUBMITTED' | 'REJECTED' | 'APPROVED';
export type BankState = 'UNVERIFIED' | 'VERIFIED' | 'REJECTED';
export type DriverType = 'EXTERNAL' | 'PLATFORM';

/** The one label of a Shipper's standing, from the stored status and review state. */
export function standing(status: DriverStatus, reviewState: ReviewState, closureFrom: DriverStatus | null = null): { readonly label: string; readonly tone: 'ok' | 'wait' | 'lock' | 'neutral' } {
  switch (status) {
    case 'PENDING':
      if (reviewState === 'SUBMITTED') {
        return { label: 'Chờ xét duyệt', tone: 'wait' };
      }
      return reviewState === 'REJECTED' ? { label: 'Bị từ chối', tone: 'lock' } : { label: 'Chưa gửi hồ sơ', tone: 'neutral' };
    case 'ACTIVE':
      return { label: 'Đã duyệt · hoạt động', tone: 'ok' };
    case 'SUSPENDED':
      return { label: 'Tạm khóa', tone: 'lock' };
    case 'CLOSING':
      // From a suspension the account is still locked: it is closing only to give the balance back, never unlocked.
      return closureFrom === 'SUSPENDED' ? { label: 'Đang đóng để hoàn tiền (vẫn bị khóa)', tone: 'lock' } : { label: 'Xin ngừng hoạt động', tone: 'wait' };
    case 'CLOSED':
      return { label: 'Đã ngừng hoạt động', tone: 'neutral' };
  }
}

export const BANK_STATE_LABEL: Record<BankState, string> = { UNVERIFIED: 'Chờ xác minh', VERIFIED: 'Đã xác minh', REJECTED: 'Bị từ chối' };
export const DRIVER_TYPE_LABEL: Record<DriverType, string> = { EXTERNAL: 'EXTERNAL · Shipper bên ngoài (mặc định)', PLATFORM: 'PLATFORM · Shipper của nền tảng' };

export const READINESS_LABEL: Record<string, string> = {
  PROFILE_NOT_APPROVED: 'Hồ sơ chưa được duyệt',
  ACCOUNT_SUSPENDED: 'Đang tạm khóa',
  CLOSURE_REQUESTED: 'Đang xin ngừng hoạt động',
  ACCOUNT_CLOSED: 'Đã ngừng hoạt động',
  BANK_MISSING: 'Chưa có tài khoản ngân hàng',
  BANK_NOT_VERIFIED: 'Ngân hàng chưa được xác minh',
  WALLET_NOT_AVAILABLE: 'Ví chưa sẵn sàng (chờ module Ví M04)',
  BALANCE_TOO_LOW: 'Số dư khả dụng chưa đủ để nhận đơn',
  FUNDING_TOO_LOW: 'Tổng tiền nạp đã xác nhận chưa đạt mức yêu cầu',
};

export const EVENT_LABEL: Record<string, string> = {
  'driver.submitted': 'Shipper gửi hồ sơ xét duyệt',
  'driver.profile_updated': 'Shipper cập nhật hồ sơ',
  'driver.bank_changed': 'Shipper đổi tài khoản ngân hàng (cần xác minh lại)',
  'driver.accepting_on': 'Shipper bật nhận đơn',
  'driver.accepting_off': 'Shipper tắt nhận đơn',
  'driver.closure_requested': 'Shipper gửi yêu cầu ngừng hoạt động',
  'driver.closure_cancelled': 'Shipper hủy yêu cầu ngừng hoạt động',
  'driver.approved': 'Admin duyệt hồ sơ',
  'driver.rejected': 'Admin từ chối hồ sơ',
  'driver.suspended': 'Admin khóa hoạt động',
  'driver.reopened': 'Admin mở lại hoạt động',
  'driver.classified': 'Admin đổi phân loại nội bộ',
  'driver.bank_verified': 'Admin xác minh ngân hàng',
  'driver.bank_rejected': 'Admin từ chối ngân hàng',
  'driver.closure_rejected': 'Admin từ chối yêu cầu ngừng hoạt động',
  'driver.closed': 'Admin hoàn tất ngừng hoạt động',
};

export interface ShipperRow {
  readonly id: string;
  readonly code: string;
  readonly fullName: string;
  readonly phone: string;
  readonly driverType: DriverType;
  readonly status: DriverStatus;
  readonly reviewState: ReviewState;
  readonly accepting: boolean;
  readonly bankState: BankState | null;
  readonly bankName: string | null;
  readonly updatedAt: string;
}

export interface ShipperBankInfo {
  readonly bankCode: string;
  readonly bankName: string;
  readonly accountNumber: string;
  readonly accountHolder: string;
  readonly state: BankState;
  readonly rejectionReason: string | null;
  readonly verifiedAt: string | null;
}

export interface ShipperEvent {
  readonly id: string;
  readonly type: string;
  readonly actor: 'DRIVER' | 'ADMIN' | 'SYSTEM';
  readonly reason: string | null;
  readonly createdAt: string;
}

export interface ShipperDetail {
  readonly id: string;
  readonly code: string;
  readonly fullName: string;
  readonly phone: string;
  readonly plate: string | null;
  readonly driverType: DriverType;
  readonly status: DriverStatus;
  readonly reviewState: ReviewState;
  readonly rejectionReason: string | null;
  readonly suspensionReason: string | null;
  readonly accepting: boolean;
  readonly version: number;
  readonly bank: ShipperBankInfo | null;
  readonly blocks: readonly string[];
  readonly canAccept: boolean;
  readonly closureNote: string | null;
  readonly closureRequestedAt: string | null;
  /** The status the closure was asked from (ACTIVE or SUSPENDED); null when the account is not closing. */
  readonly closureFromStatus: DriverStatus | null;
  readonly submittedAt: string | null;
  readonly createdAt: string;
  readonly history: readonly ShipperEvent[];
}

export interface ShipperQuery {
  readonly query: string;
  readonly status: ShipperFilter;
  readonly page: number;
}

export type Refused = { readonly kind: 'failed'; readonly failure: Failure; readonly retryAfterSec?: number };

export type ShipperListRead =
  | { readonly kind: 'ready'; readonly rows: readonly ShipperRow[]; readonly total: number }
  | { readonly kind: 'not-wired'; readonly reason: string }
  | Refused;

export type ShipperDetailRead = { readonly kind: 'ready'; readonly shipper: ShipperDetail } | { readonly kind: 'not-found' } | { readonly kind: 'not-wired'; readonly reason: string } | Refused;

export type ShipperCommandName = 'approve' | 'reject' | 'lock' | 'unlock' | 'classification' | 'bank/verify' | 'bank/reject' | 'closure/reject' | 'closure/finalize';

export interface ShipperCommandRequest {
  readonly id: string;
  readonly name: ShipperCommandName;
  readonly version: number;
  readonly reason?: string;
  readonly driverType?: DriverType;
  /** Idempotency-Key of THIS intent. A retry after an unknown outcome sends the same one. */
  readonly key: string;
}

export type ShipperCommandResult =
  | { readonly kind: 'ok' }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'session-expired' }
  | { readonly kind: 'rate-limited'; readonly retryAfterSec?: number }
  /** The server refused for a business reason (a code the page turns into a sentence). Nothing changed. */
  | { readonly kind: 'refused'; readonly code: string }
  /** The answer was lost: the command MAY have been executed. Retry with the same key only. */
  | { readonly kind: 'unknown' }
  | { readonly kind: 'not-wired' };

export const REFUSAL_MESSAGE: Record<string, string> = {
  DRIVER_NOT_FOUND: 'Không tìm thấy Shipper này.',
  DRIVER_STATE_CONFLICT: 'Trạng thái hồ sơ đã thay đổi nên thao tác này không còn phù hợp. Hãy tải lại.',
  DRIVER_PROFILE_INCOMPLETE: 'Hồ sơ chưa đủ thông tin (cần họ tên và tài khoản ngân hàng đúng tên Shipper) nên không thể duyệt.',
  BANK_HOLDER_MISMATCH: 'Tên chủ tài khoản không khớp họ tên Shipper nên không thể xác minh.',
  DRIVER_BANK_NOT_VERIFIED: 'Ngân hàng của Shipper chưa được xác minh nên chưa thể mở lại hoạt động.',
  DRIVER_HAS_ACTIVE_WORK: 'Shipper còn đơn đang giao. Hãy chờ đơn hoàn tất trước khi hoàn tất ngừng hoạt động.',
  DRIVER_WALLET_NOT_SETTLED: 'Ví của Shipper chưa được tất toán (hoặc module Ví M04 chưa sẵn sàng) nên chưa thể ngừng hoạt động. Số dư không bị mất.',
  DRIVER_SELF_ACTION_FORBIDDEN: 'Quản trị viên không được thao tác trên hồ sơ Shipper của chính mình.',
  ADMIN_INPUT_INVALID: 'Thông tin gửi lên không hợp lệ (lý do bắt buộc, tối đa 500 ký tự).',
};

export const REASON_MAX = 500;

// ---- wallet parameters ---------------------------------------------------------------------------------------------------

export interface WalletParameterChange {
  readonly id: string;
  readonly key: 'topup_min_vnd' | 'withdraw_min_vnd';
  readonly oldValue: number;
  readonly newValue: number;
  readonly changedBy: string;
  readonly changedAt: string;
}

export interface WalletParameters {
  /** The version of the pair; sent back with a save so a stale screen cannot overwrite a newer change. */
  readonly version: number;
  readonly topupMinVnd: number;
  readonly withdrawMinVnd: number;
  readonly updatedAt: string | null;
  readonly history: readonly WalletParameterChange[];
}

export type WalletRead = { readonly kind: 'ready'; readonly parameters: WalletParameters } | { readonly kind: 'not-wired'; readonly reason: string } | Refused;

export interface WalletSaveCommand {
  readonly version: number;
  readonly topupMinVnd: number;
  readonly withdrawMinVnd: number;
  readonly key: string;
}

export const WALLET_PARAMETER_LABEL = { topup_min_vnd: 'Nạp tối thiểu mỗi lần', withdraw_min_vnd: 'Rút tối thiểu (tham số lịch sử, không áp dụng)' } as const;
export const WALLET_MAX_VND = 1_000_000_000;

/** A whole, positive VND amount typed by a person ("100000", "100.000"); undefined for anything else. */
export function parseVnd(text: string): number | undefined {
  const cleaned = text.trim().replace(/[.\s]/g, '');
  if (!/^[0-9]{1,10}$/.test(cleaned)) {
    return undefined;
  }
  const value = Number(cleaned);
  return value >= 1 && value <= WALLET_MAX_VND ? value : undefined;
}

export function formatVnd(value: number): string {
  return `${value.toLocaleString('vi-VN')} ₫`;
}

export const NOT_WIRED_SHIPPERS_REASON = 'Quản lý Shipper chưa được nối với máy chủ. Không có dữ liệu nào được hiển thị.';

export interface ShipperSource {
  list(query: ShipperQuery): Promise<ShipperListRead>;
  detail(id: string): Promise<ShipperDetailRead>;
  /** Sends exactly one request per call and never repeats it by itself. */
  command(request: ShipperCommandRequest): Promise<ShipperCommandResult>;
  walletParameters(): Promise<WalletRead>;
  saveWalletParameters(command: WalletSaveCommand): Promise<ShipperCommandResult>;
}

export const NOT_WIRED_SHIPPERS: ShipperSource = {
  list: () => Promise.resolve({ kind: 'not-wired', reason: NOT_WIRED_SHIPPERS_REASON }),
  detail: () => Promise.resolve({ kind: 'not-wired', reason: NOT_WIRED_SHIPPERS_REASON }),
  command: () => Promise.resolve({ kind: 'not-wired' }),
  walletParameters: () => Promise.resolve({ kind: 'not-wired', reason: NOT_WIRED_SHIPPERS_REASON }),
  saveWalletParameters: () => Promise.resolve({ kind: 'not-wired' }),
};
