// Models of the account pages of the administration web: users (D81), a user's detail (D86) with the lock/unlock dialogs
// (D87/D88) and the administrators list (D89). They are PLAIN DATA: the views in dom/accounts-view.ts only draw them, and
// `AccountsSource` supplies them. The real source (core/accounts-api.ts) reads the read-only account endpoints; the
// NOT_WIRED_SOURCE answers "not wired" and never invents a row, a name or a status. Lock/unlock follows decision D15 (handoff
// docs/tasks/M01-admin-account-lock-handoff-20261013.md): the server says per user which action is allowed. The design preview (src/design) builds the same models from clearly labelled sample data; that data lives only
// in that folder, which the real build removes.

import { Grants } from './menu.js';
import { normalizeReason, REASON_MAX } from './inputs.js';

export { REASON_MAX };

export type UserRole = 'CUSTOMER' | 'SHOP_OWNER' | 'DRIVER';
export type UserStatus = 'ACTIVE' | 'LOCKED';

export const USER_ROLE_LABEL: Record<UserRole, string> = { CUSTOMER: 'Khách hàng', SHOP_OWNER: 'Chủ quán', DRIVER: 'Shipper' };
export const USER_STATUS_LABEL: Record<UserStatus, string> = { ACTIVE: 'Hoạt động', LOCKED: 'Đang khóa' };

/** Why a list or a detail could not be shown. Each one has its own wording and none shows stale data. */
export type Failure = 'offline' | 'timeout' | 'forbidden' | 'session-expired' | 'rate-limited' | 'unknown';

export type ListState<Row> =
  | { readonly kind: 'not-wired'; readonly reason: string }
  | { readonly kind: 'loading' }
  | { readonly kind: 'empty' }
  | { readonly kind: 'rows'; readonly rows: readonly Row[]; readonly nextCursor: string | null; readonly loadingMore?: boolean }
  | { readonly kind: 'failed'; readonly failure: Failure; readonly retryAfterSec?: number };

// ---- D81: users -----------------------------------------------------------------------------------------------------

export interface UserRow {
  readonly id: string;
  /** null = the account has no name yet (shown as "Chưa có tên", never as an empty cell). */
  readonly fullName: string | null;
  /** The server masks the phone; the page never receives the full number. */
  readonly phoneMasked: string;
  readonly roles: readonly UserRole[];
  readonly status: UserStatus;
  /** ISO timestamp. */
  readonly createdAt: string;
}

export interface UserFilter {
  readonly query: string;
  readonly role: UserRole | 'ALL';
  readonly status: UserStatus | 'ALL';
}

export const EMPTY_USER_FILTER: UserFilter = { query: '', role: 'ALL', status: 'ALL' };

export interface UsersScreen {
  readonly name: 'users';
  readonly filter: UserFilter;
  readonly state: ListState<UserRow>;
}

// ---- D86 / D87 / D88: one user ----------------------------------------------------------------------------------------

export interface TimelineEvent {
  readonly at: string;
  readonly label: string;
  readonly actor?: string;
  readonly reason?: string;
}

export interface UserDetail extends UserRow {
  /** Row version, sent back with a lock/unlock so a stale view cannot overwrite a newer change. */
  readonly version: number;
  /** Profile data the viewing admin may see (their scope); absent parts are simply not shown. */
  readonly profile: {
    readonly customer?: { readonly fullName: string | null };
    readonly shop?: { readonly name: string | null; readonly state: string };
    readonly driver?: { readonly state: string };
  };
  readonly events: readonly TimelineEvent[];
  /** What the SERVER allows this admin to do right now. The page never derives it from the role or the status. */
  readonly allowedActions: readonly ('LOCK' | 'UNLOCK')[];
}

export type UserDetailState =
  | { readonly kind: 'not-wired'; readonly reason: string }
  | { readonly kind: 'loading' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'failed'; readonly failure: Failure; readonly retryAfterSec?: number }
  | { readonly kind: 'ready'; readonly user: UserDetail };

export type LockPhase = 'form' | 'working' | 'unknown' | 'conflict' | 'failed' | 'done';

export interface LockDialog {
  readonly action: 'LOCK' | 'UNLOCK';
  readonly reason: string;
  readonly phase: LockPhase;
  /** Shown under the reason field (validation) or in the status area (server answer). */
  readonly error?: string;
}

export interface UserDetailScreen {
  readonly name: 'user';
  readonly id: string;
  readonly state: UserDetailState;
  readonly dialog?: LockDialog;
}

// ---- Administrators ---------------------------------------------------------------------------------------------------

export type AdministratorStatus = 'ACTIVE' | 'PENDING' | 'LOCKED';
export const ADMINISTRATOR_STATUS_LABEL: Record<AdministratorStatus, string> = { ACTIVE: 'Hoạt động', PENDING: 'Chờ kích hoạt', LOCKED: 'Đang khóa' };

export interface AdministratorRow {
  readonly id: string;
  readonly fullName: string;
  readonly phoneMasked: string;
  /** Which apps the administrator may view / review / lock, in words ("Khách hàng: Xem, Khóa"). */
  readonly scopes: readonly string[];
  readonly status: AdministratorStatus;
  readonly createdAt: string;
}

export interface AdministratorFilter {
  readonly query: string;
  readonly status: AdministratorStatus | 'ALL';
}

export const EMPTY_ADMIN_FILTER: AdministratorFilter = { query: '', status: 'ALL' };

export interface AdministratorsScreen {
  readonly name: 'administrators';
  readonly filter?: AdministratorFilter;
  readonly state: ListState<AdministratorRow>;
}

// ---- Where the data comes from ----------------------------------------------------------------------------------------

/** What is missing, in words, per page. Shown on the page and listed in docs/ui/m01-admin-web.md. */
export const NOT_WIRED_REASON = {
  users: 'Danh sách người dùng chờ máy chủ (gói M01.30). Chưa có dữ liệu thật nên không hiển thị dòng nào.',
  user: 'Chi tiết người dùng chờ máy chủ (gói M01.30).',
  administrators: 'Danh sách quản trị viên chưa có giao diện lập trình để đọc. Cần bổ sung hợp đồng trước khi nối.',
} as const;

/** What the server answered to a lock / unlock. The page never decides anything from it except what to say next. */
export type LockResult =
  | { readonly kind: 'ok' }
  /** USER_ACCOUNT_VERSION_CONFLICT or USER_ACCOUNT_ALREADY_IN_STATE: the account is not what the page showed. Nothing was changed. */
  | { readonly kind: 'conflict' }
  /** USER_ACCOUNT_IMPACT_REVIEW_REQUIRED: the gate is closed. Nothing was changed. */
  | { readonly kind: 'review-required' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'session-expired' }
  | { readonly kind: 'rate-limited'; readonly retryAfterSec?: number }
  /** Any other definitive refusal (a 4xx before anything ran). */
  | { readonly kind: 'rejected' }
  /** The answer was lost (network, timeout, 5xx, a refreshed CSRF): the command MAY have been executed. Retry with the same key only. */
  | { readonly kind: 'unknown' }
  | { readonly kind: 'not-wired' };

export interface LockCommand {
  readonly id: string;
  readonly action: 'LOCK' | 'UNLOCK';
  /** The version of the detail the admin looked at. */
  readonly version: number;
  /** Already trimmed and validated (1..500 code points). */
  readonly reason: string;
  /** Idempotency-Key of THIS intent. A retry after an unknown outcome sends the same one. */
  readonly key: string;
}

/** Wording of the dialog when the server refuses. Shown in the status area of the dialog, never as a toast. */
export const LOCK_MESSAGE = {
  reviewRequired: 'Chưa thể khóa hoặc mở khóa tài khoản này vì tác động tới nghiệp vụ chưa được rà soát. Không có thay đổi nào được ghi.',
  forbidden: 'Bạn không có quyền khóa hoặc mở khóa tài khoản này (cần quyền Xem và Khóa ở mọi ứng dụng của tài khoản).',
  rateLimited: 'Thao tác quá nhanh. Vui lòng thử lại sau ít phút.',
  rejected: 'Yêu cầu không hợp lệ. Hãy kiểm tra lại lý do và thử lại.',
  notWired: 'Khóa và mở khóa chưa được nối với máy chủ.',
} as const;

/** A page of a list: a normal list state, or "the cursor no longer fits" (filter or rights changed): start again from page 1. */
export type PageState<Row> = ListState<Row> | { readonly kind: 'cursor-invalid' };

/** What the SERVER says the signed-in admin may read: menu grants and the USER roles the list may be filtered by. */
export type GrantsResult =
  | { readonly kind: 'ok'; readonly grants: Grants; readonly roles: readonly UserRole[] }
  | { readonly kind: 'failed'; readonly failure: Failure; readonly retryAfterSec?: number };

/** The seam to the backend: one method per page. A `cursor` is the opaque `next_cursor` of the previous page of the SAME filter. */
export interface AccountsSource {
  grants(): Promise<GrantsResult>;
  users(filter: UserFilter, cursor: string | null): Promise<PageState<UserRow>>;
  user(id: string): Promise<UserDetailState>;
  administrators(filter: AdministratorFilter, cursor: string | null): Promise<PageState<AdministratorRow>>;
  /** Lock / unlock one user. Sends exactly one request per call and never repeats it by itself. */
  lock(command: LockCommand): Promise<LockResult>;
}

/** Nothing wired: every page says so. It never answers with data and never throws. */
export const NOT_WIRED_SOURCE: AccountsSource = {
  grants: () => Promise.resolve({ kind: 'ok', grants: new Set(), roles: [] }),
  users: () => Promise.resolve({ kind: 'not-wired', reason: NOT_WIRED_REASON.users }),
  user: () => Promise.resolve({ kind: 'not-wired', reason: NOT_WIRED_REASON.user }),
  administrators: () => Promise.resolve({ kind: 'not-wired', reason: NOT_WIRED_REASON.administrators }),
  lock: () => Promise.resolve({ kind: 'not-wired' }),
};

/** A reason is 1..500 Unicode code points after trimming (the same rule as the invitation reasons and the lock/unlock contract). */
export function validateReason(raw: string): { readonly ok: true; readonly value: string } | { readonly ok: false; readonly message: string } {
  const value = normalizeReason(raw);
  if (value !== undefined) {
    return { ok: true, value };
  }
  return { ok: false, message: raw.trim().length === 0 ? 'Nhập lý do.' : `Lý do tối đa ${REASON_MAX} ký tự.` };
}
