// Model of the REAL finance pages of the administration web (M04-B3a): top-up requests, the receiving accounts and the finance rights. Plain data and
// pure functions; the DOM (dom/finance-admin-view.ts) only draws it and `FinanceAdminSource` is where it comes from. Nothing here invents a request, an
// account, a balance or a total: a page shows what the server answered and says so when it did not. Money is whole VND.

import { Failure } from './accounts.js';

export const FINANCE_PERMISSION_READ = 'wallet.read';
export const FINANCE_PERMISSION_RECORD = 'wallet.topup.record';
export const FINANCE_PERMISSION_PROCESS = 'wallet.withdrawal.process';
export const FINANCE_PERMISSION_CONFIRM = 'wallet.withdrawal.confirm';
export const FINANCE_PERMISSION_RECONCILE = 'wallet.withdrawal.reconcile';
export type FinancePermissionKey =
  | typeof FINANCE_PERMISSION_READ
  | typeof FINANCE_PERMISSION_RECORD
  | typeof FINANCE_PERMISSION_PROCESS
  | typeof FINANCE_PERMISSION_CONFIRM
  | typeof FINANCE_PERMISSION_RECONCILE
  | 'shop.payment.read'
  | 'shop.payment.record'
  | 'shop.entitlement.manage';
export const FINANCE_PERMISSIONS: readonly FinancePermissionKey[] = [FINANCE_PERMISSION_READ, FINANCE_PERMISSION_RECORD, FINANCE_PERMISSION_PROCESS, FINANCE_PERMISSION_CONFIRM, FINANCE_PERMISSION_RECONCILE, 'shop.payment.read', 'shop.payment.record', 'shop.entitlement.manage'];
export const FINANCE_PERMISSION_LABEL: Record<FinancePermissionKey, string> = {
  'shop.payment.read': 'Xem thanh toán và trao đổi của quán',
  'shop.payment.record': 'Ghi nhận tiền quán và gửi trao đổi',
  'shop.entitlement.manage': 'Cấp hoặc thu hồi quyền mở rộng thực đơn',
  'wallet.read': 'Xem tài chính (ví, giao dịch, nạp, rút, đối soát)',
  'wallet.topup.record': 'Xác nhận / từ chối nạp tiền',
  'wallet.withdrawal.process': 'Nhận xử lý yêu cầu rút tiền (chuyển tiền thủ công)',
  'wallet.withdrawal.confirm': 'Xác nhận đã chuyển tiền (chỉ người đã nhận xử lý)',
  'wallet.withdrawal.reconcile': 'Đối soát rút tiền và chạy kiểm tra đối soát',
};

/** GET access/me: the rights of the CALLING session. Never derived from application permissions, a role of a Shipper or the old sidebar. */
export interface FinanceRights {
  readonly role: 'SYSTEM' | 'ADMIN';
  readonly implicit: boolean;
  readonly canRead: boolean;
  readonly canRecord: boolean;
  /** M04-C: withdrawals. Each right is separate; none implies another. */
  readonly canProcess: boolean;
  readonly canConfirm: boolean;
  readonly canReconcile: boolean;
}
export const NO_FINANCE_RIGHTS: FinanceRights = { role: 'ADMIN', implicit: false, canRead: false, canRecord: false, canProcess: false, canConfirm: false, canReconcile: false };

export type TopupState = 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'CANCELLED';
export const TOPUP_STATES: readonly TopupState[] = ['PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED'];
export const TOPUP_STATE_LABEL: Record<TopupState, string> = { PENDING: 'Chờ xác nhận', CONFIRMED: 'Thành công', REJECTED: 'Từ chối', CANCELLED: 'Đã hủy' };
/** The server takes ONE status per call, so the tabs are exactly its states (plus "all"): no merged tab, no total. */
export type TopupFilter = TopupState | 'ALL';
export const TOPUP_FILTERS: readonly TopupFilter[] = ['PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'ALL'];
export const TOPUP_FILTER_LABEL: Record<TopupFilter, string> = { ...TOPUP_STATE_LABEL, ALL: 'Tất cả' };
export const TOPUP_PAGE_SIZE = 20;

export interface TopupItem {
  readonly requestId: string;
  readonly driverId: string;
  readonly requestedVnd: number;
  /** Set by the server once CONFIRMED: the amount really received. */
  readonly actualVnd: number | null;
  readonly state: TopupState;
  readonly version: number;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
  readonly receivedAt: string | null;
  /** The transfer content tied to this request (NAP + ten characters). The bank statement line carrying it is the evidence to check; absent from older servers. */
  readonly transferCode?: string | null;
}
export interface TopupPage {
  readonly items: readonly TopupItem[];
  readonly nextCursor: string | null;
}

/** A receiving account as the confirmation sees it: the number is MASKED by the server. */
export interface ReceivingAccount {
  readonly accountId: string;
  readonly bankId: string;
  readonly numberMasked: string;
  readonly canReceive: boolean;
}

/** SYSTEM only: the full account as the server gives it to SYSTEM. */
export interface SystemAccount {
  readonly accountId: string;
  readonly bankId: string;
  readonly accountNumber: string;
  readonly accountHolder: string;
  readonly canReceive: boolean;
  readonly version: number;
  readonly createdAt: string;
}

export type GrantState = 'NONE' | 'GRANTED' | 'REVOKED';
export interface AdminFinancePermission {
  readonly key: FinancePermissionKey;
  readonly state: GrantState;
  readonly version: number;
  readonly grantedAt: string | null;
  readonly revokedAt: string | null;
}
export interface AdminFinanceAccess {
  readonly userId: string;
  readonly permissions: readonly AdminFinancePermission[];
}

// ---- reads and commands -------------------------------------------------------------------------------------------------

export type FinanceRead<T> =
  | { readonly kind: 'ready'; readonly data: T }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'not-wired' }
  | { readonly kind: 'failed'; readonly failure: Failure; readonly retryAfterSec?: number };

/**
 * What the server said to ONE command. `unknown` = no usable answer (timeout, lost connection, 5xx, busy): the command may or may not have been done,
 * so the caller keeps the SAME key and body and never sends another command by itself. `conflict` / `refused` carry the backend code for the sentence.
 */
export type FinanceOutcome =
  | { readonly kind: 'ok' }
  | { readonly kind: 'conflict'; readonly code: string }
  | { readonly kind: 'refused'; readonly code: string }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'session-expired' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'rate-limited'; readonly retryAfterSec?: number }
  | { readonly kind: 'not-wired' };

export interface ConfirmCommand {
  readonly key: string;
  readonly requestId: string;
  readonly version: number;
  readonly actualVnd: number;
  readonly bankId: string;
  readonly accountId: string;
  /** Exactly as typed (only the edges are trimmed by the server): never lower-cased, leading zeros kept. */
  readonly transactionId: string;
  /** ISO instant with its zone. */
  readonly receivedAt: string;
}
export interface RejectCommand {
  readonly key: string;
  readonly requestId: string;
  readonly version: number;
  readonly reason: RejectReason;
}
export interface CreateAccountCommand {
  readonly key: string;
  readonly bankId: string;
  readonly accountNumber: string;
  readonly accountHolder: string;
}
export interface ReceivingCommand {
  readonly key: string;
  readonly accountId: string;
  readonly version: number;
  readonly canReceive: boolean;
}
export interface AccessCommand {
  readonly key: string;
  readonly userId: string;
  readonly permission: FinancePermissionKey;
  readonly version: number;
  readonly action: 'grant' | 'revoke';
}

export interface FinanceAdminSource {
  rights(): Promise<FinanceRead<FinanceRights>>;
  topups(filter: TopupFilter, cursor: string | null): Promise<FinanceRead<TopupPage>>;
  topup(requestId: string): Promise<FinanceRead<TopupItem>>;
  receivingAccounts(): Promise<FinanceRead<readonly ReceivingAccount[]>>;
  confirm(command: ConfirmCommand): Promise<FinanceOutcome>;
  reject(command: RejectCommand): Promise<FinanceOutcome>;
  systemAccounts(): Promise<FinanceRead<readonly SystemAccount[]>>;
  createAccount(command: CreateAccountCommand): Promise<FinanceOutcome>;
  setReceiving(command: ReceivingCommand): Promise<FinanceOutcome>;
  adminAccess(userId: string): Promise<FinanceRead<AdminFinanceAccess>>;
  changeAccess(command: AccessCommand): Promise<FinanceOutcome>;
}

/** Nothing connected: every read says so, every command is refused before it leaves the page. No sample data exists in this build. */
export const NOT_WIRED_FINANCE_ADMIN: FinanceAdminSource = {
  rights: async () => ({ kind: 'not-wired' }),
  topups: async () => ({ kind: 'not-wired' }),
  topup: async () => ({ kind: 'not-wired' }),
  receivingAccounts: async () => ({ kind: 'not-wired' }),
  confirm: async () => ({ kind: 'not-wired' }),
  reject: async () => ({ kind: 'not-wired' }),
  systemAccounts: async () => ({ kind: 'not-wired' }),
  createAccount: async () => ({ kind: 'not-wired' }),
  setReceiving: async () => ({ kind: 'not-wired' }),
  adminAccess: async () => ({ kind: 'not-wired' }),
  changeAccess: async () => ({ kind: 'not-wired' }),
};

// ---- money and time -----------------------------------------------------------------------------------------------------

export function formatVndAmount(amount: number): string {
  return `${String(Math.abs(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}đ`;
}

/**
 * "60.000" / "60000" -> 60000. A dot is accepted ONLY as a thousands separator ("60.000", never "60000.5" or "6.0000"): a stray decimal point
 * must not silently become a bigger amount. Anything else, zero or more than 12 digits -> undefined.
 */
export function parseActualVnd(text: string): number | undefined {
  const value = text.trim();
  if (/^[1-9]\d{0,11}$/.test(value)) {
    return Number(value);
  }
  if (/^[1-9]\d{0,2}(\.\d{3}){1,3}$/.test(value)) {
    return Number(value.replace(/\./g, ''));
  }
  return undefined;
}

/** A bank can be 5 minutes ahead of this server; more than that is a typing error, the same tolerance the server applies. */
export const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * `<input type="datetime-local">` value ("2026-10-18T09:30") read in the browser's zone -> an ISO instant WITH its zone (Z), or undefined when it
 * is empty, not a date or in the future. Never defaults to "now": the Admin must say when the money arrived.
 */
export function receivedAtFrom(value: string, nowMs: number): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    return undefined;
  }
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms) || ms > nowMs + FUTURE_TOLERANCE_MS) {
    return undefined;
  }
  return new Date(ms).toISOString();
}

export const TRANSACTION_ID_MAX = 128;

// ---- confirmation form --------------------------------------------------------------------------------------------------

export interface ConfirmDraft {
  readonly actual: string;
  readonly transactionId: string;
  readonly receivedAt: string;
  readonly accountId: string;
}
export const EMPTY_CONFIRM_DRAFT: ConfirmDraft = { actual: '', transactionId: '', receivedAt: '', accountId: '' };

export interface ConfirmChecked {
  readonly errors: { actual?: string; transactionId?: string; receivedAt?: string; accountId?: string };
  /** Present only when every field is valid: exactly what would be sent (the account must be one that receives now). */
  readonly ready?: { readonly actualVnd: number; readonly transactionId: string; readonly receivedAt: string; readonly account: ReceivingAccount };
  readonly mismatch: boolean;
}

/** Checks the form. A transaction code is kept EXACTLY as typed (case and leading zeros); only the two edges are trimmed, as the server does. */
export function checkConfirm(draft: ConfirmDraft, requestedVnd: number, accounts: readonly ReceivingAccount[], nowMs: number): ConfirmChecked {
  const errors: { actual?: string; transactionId?: string; receivedAt?: string; accountId?: string } = {};
  const actualVnd = parseActualVnd(draft.actual);
  if (actualVnd === undefined) {
    errors.actual = 'Nhập số tiền thực nhận trên sao kê (số nguyên đồng, lớn hơn 0).';
  }
  const transactionId = draft.transactionId.replace(/^\s+|\s+$/g, '');
  if (transactionId === '') {
    errors.transactionId = 'Nhập mã giao dịch đúng như trên sao kê ngân hàng.';
  } else if ([...transactionId].length > TRANSACTION_ID_MAX || /[\u0000-\u001f\u007f-\u009f]/.test(transactionId)) {
    errors.transactionId = `Mã giao dịch tối đa ${TRANSACTION_ID_MAX} ký tự và không chứa ký tự điều khiển.`;
  }
  const receivedAt = receivedAtFrom(draft.receivedAt, nowMs);
  if (receivedAt === undefined) {
    errors.receivedAt = draft.receivedAt === '' ? 'Chọn thời điểm tiền về tài khoản (theo sao kê).' : 'Thời điểm không hợp lệ hoặc nằm trong tương lai.';
  }
  const account = accounts.find((item) => item.accountId === draft.accountId);
  if (account === undefined || !account.canReceive) {
    errors.accountId = 'Chọn tài khoản nhận tiền đang bật.';
  }
  if (Object.keys(errors).length > 0 || actualVnd === undefined || receivedAt === undefined || account === undefined) {
    return { errors, mismatch: actualVnd !== undefined && actualVnd !== requestedVnd };
  }
  return { errors, mismatch: actualVnd !== requestedVnd, ready: { actualVnd, transactionId, receivedAt, account } };
}

// ---- reject reasons -----------------------------------------------------------------------------------------------------

export type RejectReason = 'NOT_RECEIVED' | 'AMOUNT_MISMATCH' | 'DUPLICATE_REQUEST' | 'INVALID_REQUEST' | 'OTHER';
export const REJECT_REASONS: readonly RejectReason[] = ['NOT_RECEIVED', 'AMOUNT_MISMATCH', 'DUPLICATE_REQUEST', 'INVALID_REQUEST', 'OTHER'];
export const REJECT_REASON_LABEL: Record<RejectReason, string> = {
  NOT_RECEIVED: 'Chưa nhận được tiền',
  AMOUNT_MISMATCH: 'Số tiền không khớp',
  DUPLICATE_REQUEST: 'Yêu cầu trùng',
  INVALID_REQUEST: 'Yêu cầu không hợp lệ',
  OTHER: 'Lý do khác',
};

// ---- new receiving account ----------------------------------------------------------------------------------------------

export interface AccountDraft {
  readonly bankId: string;
  readonly accountNumber: string;
  readonly accountHolder: string;
}
export interface AccountChecked {
  readonly errors: { bankId?: string; accountNumber?: string; accountHolder?: string };
  readonly ready?: { readonly bankId: string; readonly accountNumber: string; readonly accountHolder: string };
}

/** The same shapes the server accepts. The number stays TEXT (leading zeros kept); only spaces and dashes typed for readability are removed. */
export function checkAccount(draft: AccountDraft): AccountChecked {
  const errors: { bankId?: string; accountNumber?: string; accountHolder?: string } = {};
  const bankId = draft.bankId.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,16}$/.test(bankId)) {
    errors.bankId = 'Mã ngân hàng gồm 2-16 chữ hoặc số (ví dụ VCB).';
  }
  const accountNumber = draft.accountNumber.replace(/[\s-]/g, '');
  if (!/^[0-9]{6,20}$/.test(accountNumber)) {
    errors.accountNumber = 'Số tài khoản gồm 6-20 chữ số.';
  }
  const accountHolder = draft.accountHolder.normalize('NFC').replace(/\s+/g, ' ').trim();
  if ([...accountHolder].length < 1 || [...accountHolder].length > 120 || /[\p{Cc}\p{Cf}]/u.test(accountHolder)) {
    errors.accountHolder = 'Nhập tên chủ tài khoản (tối đa 120 ký tự).';
  }
  return Object.keys(errors).length > 0 ? { errors } : { errors, ready: { bankId, accountNumber, accountHolder } };
}

// ---- words --------------------------------------------------------------------------------------------------------------

/** What each backend code is shown as. A code not listed gets the generic sentence: the page never echoes a server string. */
export const FINANCE_MESSAGE: Readonly<Record<string, string>> = {
  VERSION_CONFLICT: 'Yêu cầu vừa được thay đổi ở nơi khác. Đã tải lại dữ liệu, hãy kiểm tra rồi thao tác lại nếu cần.',
  TOPUP_REQUEST_STATE_CONFLICT: 'Yêu cầu này đã được xử lý. Đã tải lại trạng thái mới nhất.',
  BANK_TRANSACTION_ALREADY_RECORDED: 'Giao dịch ngân hàng này đã được ghi nhận trước đó. Không có khoản tiền nào được cộng thêm.',
  TOPUP_ACCOUNT_NOT_RECEIVING: 'Tài khoản nhận tiền này đang tắt hoặc không khớp ngân hàng. Nhờ SYSTEM bật lại tài khoản rồi thử lại.',
  TOPUP_WALLET_LIMIT_EXCEEDED: 'Số tiền làm ví vượt mức tối đa nên không được ghi nhận.',
  DRIVER_STATE_CONFLICT: 'Hồ sơ Shipper đã đóng nên không thể cộng tiền. Bạn có thể từ chối yêu cầu.',
  TOPUP_REQUEST_NOT_FOUND: 'Không tìm thấy yêu cầu nạp tiền.',
  FINANCE_VERSION_CONFLICT: 'Quyền tài chính vừa được thay đổi ở nơi khác. Đã tải lại.',
  FINANCE_GRANT_STATE_CONFLICT: 'Quyền đã ở trạng thái này. Đã tải lại.',
  FINANCE_BANK_ACCOUNT_STATE_CONFLICT: 'Tài khoản đã ở trạng thái này. Đã tải lại.',
  FINANCE_BANK_ACCOUNT_EXISTS: 'Tài khoản ngân hàng này đã được cấu hình.',
  FINANCE_BANK_ACCOUNT_NOT_FOUND: 'Không tìm thấy tài khoản nhận tiền.',
  FINANCE_ADMIN_NOT_FOUND: 'Không tìm thấy quản trị viên hoặc tài khoản không còn hoạt động.',
  ADMIN_INPUT_INVALID: 'Dữ liệu không hợp lệ. Kiểm tra lại các trường rồi thử lại.',
};
export const FINANCE_GENERIC_MESSAGE = 'Máy chủ từ chối thao tác. Không có thay đổi nào được ghi.';
export const FINANCE_UNKNOWN_MESSAGE = 'Chưa xác định kết quả. Kiểm tra lại trạng thái yêu cầu và sao kê trước khi làm gì tiếp; trang không tự gửi lại lệnh khác.';
export const FINANCE_FORBIDDEN_MESSAGE = 'Bạn không (còn) quyền thực hiện thao tác này. Đã tải lại quyền của bạn.';
export const FINANCE_RATE_LIMITED_MESSAGE = 'Thao tác quá nhanh. Đợi một lát rồi thử lại.';

export function messageOf(code: string): string {
  return FINANCE_MESSAGE[code] ?? FINANCE_GENERIC_MESSAGE;
}

/** First 8 characters of an identifier, for a table cell. The full value is shown on the detail page. */
export const shortId = (id: string): string => id.slice(0, 8);
