// Model of "Tài khoản › Phân quyền" (M12-C): the administrators, what each may do, and the commands SYSTEM gives. PLAIN DATA plus the port the page talks to
// (dom/access-view.ts draws it, core/access-api.ts is the real source). The page decides no right: every answer says what is stored, and each command is
// checked again by the server (SYSTEM only). A right is never granted "because it is in the same group": every right below is its own switch.

import { Failure } from './accounts.js';
import { CommandResult } from './commands.js';

export type AppName = 'CUSTOMER' | 'SHOP' | 'DRIVER';

export interface AppPermissionRow {
  readonly app: AppName;
  readonly canView: boolean;
  readonly canReviewProfile: boolean;
  readonly canLock: boolean;
  readonly canManageCatalog: boolean;
}

/** The function rights SYSTEM gives one by one (wallet.read, wallet.topup.record, report.read, report.export, audit.read). */
export const RIGHT_KEYS = ['wallet.read', 'wallet.topup.record', 'wallet.withdrawal.process', 'wallet.withdrawal.confirm', 'wallet.withdrawal.reconcile', 'report.read', 'report.export', 'audit.read'] as const;
export type RightKey = (typeof RIGHT_KEYS)[number];

export interface RightState {
  readonly key: RightKey;
  readonly granted: boolean;
  /** The version the page echoes back; 0 = no row yet. */
  readonly version: number;
}

export interface AdministratorAccess {
  readonly userId: string;
  readonly fullName: string;
  readonly phoneMasked: string;
  /** ACTIVE only when the membership and the account are both active. */
  readonly status: 'ACTIVE' | 'DISABLED';
  readonly membershipStatus: 'ACTIVE' | 'DISABLED';
  readonly membershipVersion: number;
  readonly createdAt: string;
  readonly liveSessions: number;
  readonly lastLoginAt: string | null;
  readonly permissions: readonly AppPermissionRow[];
  readonly fingerprint: string;
  readonly rights: readonly RightState[];
}

export interface AccessMatrix {
  readonly items: readonly AdministratorAccess[];
  readonly truncated: boolean;
}

export type AccessRead = { readonly kind: 'ready'; readonly matrix: AccessMatrix } | { readonly kind: 'not-wired'; readonly reason: string } | { readonly kind: 'failed'; readonly failure: Failure; readonly retryAfterSec?: number };

export type AccessCommand =
  | { readonly name: 'permissions'; readonly userId: string; readonly permissions: readonly AppPermissionRow[]; readonly fingerprint: string; readonly reason: string; readonly key: string }
  | { readonly name: 'lock' | 'unlock'; readonly userId: string; readonly version: number; readonly reason: string; readonly key: string }
  | { readonly name: 'revoke-sessions'; readonly userId: string; readonly reason: string; readonly key: string }
  | { readonly name: 'grant' | 'revoke'; readonly userId: string; readonly right: RightKey; readonly version: number; readonly key: string };

export interface AccessSource {
  read(): Promise<AccessRead>;
  /** Sends exactly one request per call and never repeats it by itself. */
  command(command: AccessCommand): Promise<CommandResult>;
}

export const NOT_WIRED_ACCESS_REASON = 'Quản lý quyền ADMIN chưa được nối với máy chủ. Không có dữ liệu nào được hiển thị.';

export const NOT_WIRED_ACCESS: AccessSource = {
  read: () => Promise.resolve({ kind: 'not-wired', reason: NOT_WIRED_ACCESS_REASON }),
  command: () => Promise.resolve({ kind: 'not-wired' }),
};

export const APP_LABEL: Record<AppName, string> = { CUSTOMER: 'Tài khoản khách hàng', SHOP: 'Quán', DRIVER: 'Shipper và giao hàng' };

export const RIGHT_LABEL: Record<RightKey, string> = {
  'wallet.read': 'Xem ví và nạp tiền',
  'wallet.topup.record': 'Xác nhận nạp tiền (ghi tiền vào ví)',
  'wallet.withdrawal.process': 'Nhận xử lý và chuyển khoản rút tiền',
  'wallet.withdrawal.confirm': 'Xác nhận đã chuyển tiền rút',
  'wallet.withdrawal.reconcile': 'Đối soát rút tiền chưa rõ kết quả',
  'report.read': 'Xem báo cáo',
  'report.export': 'Xuất báo cáo',
  'audit.read': 'Xem nhật ký',
};

export const ACCESS_REFUSAL: Record<string, string> = {
  ADMIN_ACCESS_NOT_FOUND: 'Không tìm thấy quản trị viên này.',
  ADMIN_ACCESS_STATE_CONFLICT: 'Trạng thái tài khoản đã khác: thao tác này không còn phù hợp. Hãy tải lại.',
  ADMIN_INPUT_INVALID: 'Thông tin không hợp lệ (cần ít nhất một quyền xem; lý do bắt buộc, tối đa 500 ký tự).',
  FINANCE_ADMIN_NOT_FOUND: 'Không tìm thấy quản trị viên này.',
};
