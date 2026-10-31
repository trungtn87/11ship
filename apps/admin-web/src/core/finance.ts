// Model of "Tài chính" (M04, UI phase): shipper wallets, top-up (nạp) and withdrawal (rút) requests, the ledger and its reconciliation,
// and the wallet parameters. Owner-approved UI: docs/ui/m04/README.md section 4 (M04-A01 ... M04-A07).
//
// This file is PLAIN DATA and pure functions: the DOM (dom/finance-view.ts) only draws it, and `FinanceSource` is where it comes from.
// There is NO backend yet (UI phase): NOT_WIRED_FINANCE answers "not wired" to every read and the page says so. It never invents a
// balance, a request or a confirmation. The sample rows of the design preview live in design/samples.ts only (the real build removes
// that folder and a test checks it).
//
// Money rules the screens obey (README section 5): one wallet per shipper, B = total balance, H = amount held, A = B - H (computed
// here by `availableOf`, never read from a second figure); held money is hold INFORMATION and is not a ledger deduction; releasing a hold
// is not a top-up; only an Admin records money actually received, after checking the bank transaction.

import { Failure } from './accounts.js';

// ---- money and dates ----------------------------------------------------------------------------------------------------

/** Whole VND with Vietnamese grouping: 100000 -> "100.000đ". Negative -> "-1.000đ". Never throws; a non-integer is rounded. */
export function formatVnd(amount: number): string {
  const value = Math.round(Number.isFinite(amount) ? amount : 0);
  const digits = String(Math.abs(value)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${value < 0 ? '-' : ''}${digits}đ`;
}

/** Same with an explicit sign for ledger rows: "+150.000đ", "-1.000đ", "0đ". */
export function formatVndSigned(amount: number): string {
  const text = formatVnd(amount);
  return amount > 0 ? `+${text}` : text;
}

/** "100.000" -> 100000; "" or anything that is not a whole number of dong (digits, dots, spaces) -> undefined. */
export function parseVnd(text: string): number | undefined {
  const cleaned = text.replace(/[\s.]/g, '');
  if (!/^\d{1,12}$/.test(cleaned)) {
    return undefined;
  }
  return Number(cleaned);
}

/** Available = total - held (README: A = B - H). The only place the figure is computed. */
export const availableOf = (wallet: { readonly total: number; readonly held: number }): number => wallet.total - wallet.held;

// ---- states -------------------------------------------------------------------------------------------------------------

export type FinanceLoad<T> =
  | { readonly kind: 'not-wired'; readonly reason: string }
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly failure: Failure; readonly retryAfterSec?: number }
  /** `filtered`: the list is empty because of the filter, not because nothing exists. */
  | { readonly kind: 'empty'; readonly filtered: boolean }
  | { readonly kind: 'ready'; readonly data: T };

export const NOT_WIRED_FINANCE_REASON = 'Tài chính chưa được nối với máy chủ (giai đoạn giao diện M04). Chưa có số dư, yêu cầu hay giao dịch thật nên không hiển thị dòng nào.';

// ---- wallets (M04-A02) --------------------------------------------------------------------------------------------------

export type WalletStatus = 'ACTIVE' | 'LOCKED' | 'CLOSED';
export const WALLET_STATUS_LABEL: Record<WalletStatus, string> = { ACTIVE: 'Hoạt động', LOCKED: 'Tạm khóa', CLOSED: 'Ngừng hoạt động' };

export interface WalletRow {
  readonly id: string;
  /** Shipper code, e.g. SHP001. */
  readonly code: string;
  readonly name: string;
  readonly phoneMasked: string;
  readonly total: number;
  readonly held: number;
  readonly status: WalletStatus;
}

// ---- top-ups (M04-A03, M04-A04) -----------------------------------------------------------------------------------------

export type TopupStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'CANCELLED';
export const TOPUP_STATUS_LABEL: Record<TopupStatus, string> = { PENDING: 'Chờ xác nhận', CONFIRMED: 'Thành công', REJECTED: 'Từ chối', CANCELLED: 'Đã hủy' };
export type TopupTab = 'PENDING' | 'DONE' | 'ALL';
export const TOPUP_TABS: readonly TopupTab[] = ['PENDING', 'DONE', 'ALL'];
export const TOPUP_TAB_LABEL: Record<TopupTab, string> = { PENDING: 'Chờ xác nhận', DONE: 'Đã xử lý', ALL: 'Tất cả' };

export interface TopupRow {
  readonly id: string;
  readonly code: string;
  readonly createdAt: string;
  readonly shipperName: string;
  readonly phoneMasked: string;
  readonly amount: number;
  readonly bank: string;
  readonly status: TopupStatus;
}

export interface TopupDetail extends TopupRow {
  /** Content the shipper was told to put in the transfer. */
  readonly transferContent: string;
  /** Name of the attached proof image, or null. The page never loads an image it was not given a URL for. */
  readonly proofName: string | null;
  /** Set once an Admin decided. */
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  readonly actualAmount: number | null;
  readonly bankReference: string | null;
  readonly note: string | null;
}

/** What the Admin typed in the verification block. Strings: the form edits text, `validateTopupDecision` reads it. */
export interface TopupDecisionDraft {
  readonly actualAmount: string;
  readonly bankReference: string;
  readonly note: string;
}

export interface TopupDecisionErrors {
  actualAmount?: string;
  bankReference?: string;
  note?: string;
}

export const BANK_REFERENCE_MAX = 64;
export const NOTE_MAX = 500;

/**
 * Checks the verification form. "Xác nhận" needs the amount really received (a positive whole number) and the bank's own transaction
 * code; "Từ chối" needs a reason (the shipper is shown it). `mismatch` is a WARNING, not an error: the Admin may confirm what the bank
 * really received even when it differs from the request (the wallet is credited with the actual amount, never the requested one).
 */
export function validateTopupDecision(draft: TopupDecisionDraft, requested: number, action: 'confirm' | 'reject'): { readonly errors: TopupDecisionErrors; readonly mismatch: boolean } {
  const errors: TopupDecisionErrors = {};
  const actual = parseVnd(draft.actualAmount);
  if (action === 'confirm') {
    if (actual === undefined || actual <= 0) {
      errors.actualAmount = 'Nhập số tiền ngân hàng thực nhận (số nguyên, lớn hơn 0).';
    }
    const reference = draft.bankReference.trim();
    if (reference === '') {
      errors.bankReference = 'Nhập mã giao dịch ngân hàng để đối soát.';
    } else if (reference.length > BANK_REFERENCE_MAX) {
      errors.bankReference = `Mã giao dịch tối đa ${BANK_REFERENCE_MAX} ký tự.`;
    }
  } else if (draft.note.trim() === '') {
    errors.note = 'Nhập lý do từ chối để Shipper biết.';
  }
  if (draft.note.length > NOTE_MAX) {
    errors.note = `Ghi chú tối đa ${NOTE_MAX} ký tự.`;
  }
  return { errors, mismatch: action === 'confirm' && actual !== undefined && actual > 0 && actual !== requested };
}

export const TOPUP_EMPTY_DRAFT: TopupDecisionDraft = { actualAmount: '', bankReference: '', note: '' };

/** Only a PENDING request can be decided. */
export const canDecideTopup = (status: TopupStatus): boolean => status === 'PENDING';

// ---- withdrawals (M04-A05) ----------------------------------------------------------------------------------------------

export type WithdrawalStatus = 'PENDING' | 'PROCESSING' | 'NEEDS_RECONCILE' | 'COMPLETED' | 'CANCELLED';
export const WITHDRAWAL_STATUS_LABEL: Record<WithdrawalStatus, string> = {
  PENDING: 'Chờ xử lý',
  PROCESSING: 'Đang xử lý',
  NEEDS_RECONCILE: 'Cần đối soát',
  COMPLETED: 'Hoàn thành',
  CANCELLED: 'Đã hủy',
};
export type WithdrawalTab = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'NEEDS_RECONCILE' | 'ALL';
export const WITHDRAWAL_TABS: readonly WithdrawalTab[] = ['PENDING', 'PROCESSING', 'COMPLETED', 'NEEDS_RECONCILE', 'ALL'];
export const WITHDRAWAL_TAB_LABEL: Record<WithdrawalTab, string> = { PENDING: 'Chờ xử lý', PROCESSING: 'Đang xử lý', COMPLETED: 'Đã hoàn thành', NEEDS_RECONCILE: 'Cần đối soát', ALL: 'Tất cả' };

export interface WithdrawalRow {
  readonly id: string;
  readonly code: string;
  readonly createdAt: string;
  readonly shipperName: string;
  readonly phoneMasked: string;
  readonly amount: number;
  readonly status: WithdrawalStatus;
}

/** The receiving account AS IT WAS when the request was made: a later change of bank never rewrites it (README section 5). */
export interface BankSnapshot {
  readonly bank: string;
  readonly accountMasked: string;
  readonly holder: string;
}

export interface WithdrawalStep {
  readonly status: Exclude<WithdrawalStatus, 'CANCELLED'>;
  /** ISO time the request reached this step, or null when it has not. */
  readonly at: string | null;
  readonly by: string | null;
}

export interface WithdrawalDetail extends WithdrawalRow {
  readonly bank: BankSnapshot;
  /** Money reserved (held) in the wallet for this request. */
  readonly held: number;
  readonly steps: readonly WithdrawalStep[];
  readonly note: string | null;
}

export type WithdrawalAction = 'START' | 'MARK_PAID' | 'MARK_RECONCILE' | 'RECONCILE';

export const WITHDRAWAL_ACTION_LABEL: Record<WithdrawalAction, string> = {
  START: 'Nhận xử lý',
  MARK_PAID: 'Xác nhận đã chuyển tiền',
  MARK_RECONCILE: 'Chuyển sang cần đối soát',
  RECONCILE: 'Đối soát',
};

/**
 * The steps an Admin may take from a status (README A05: nhận xử lý, xác nhận đã chuyển, đối soát). Money stays on hold until the
 * transfer is confirmed PAID; an unknown outcome is never retried or released automatically, it goes to "Cần đối soát".
 */
export function withdrawalActions(status: WithdrawalStatus): readonly WithdrawalAction[] {
  switch (status) {
    case 'PENDING':
      return ['START'];
    case 'PROCESSING':
      return ['MARK_PAID', 'MARK_RECONCILE'];
    case 'NEEDS_RECONCILE':
      return ['RECONCILE'];
    case 'COMPLETED':
    case 'CANCELLED':
      return [];
  }
}

// ---- ledger and reconciliation (M04-A06) --------------------------------------------------------------------------------

export type LedgerType = 'TOPUP' | 'WITHDRAW' | 'COMMISSION' | 'HOLD' | 'RELEASE';
export const LEDGER_TYPE_LABEL: Record<LedgerType, string> = { TOPUP: 'Nạp tiền', WITHDRAW: 'Rút tiền', COMMISSION: 'Hoa hồng', HOLD: 'Tạm giữ', RELEASE: 'Giải phóng tạm giữ' };
export type LedgerStatus = 'SUCCESS' | 'PENDING' | 'FAILED';
export const LEDGER_STATUS_LABEL: Record<LedgerStatus, string> = { SUCCESS: 'Thành công', PENDING: 'Đang xử lý', FAILED: 'Thất bại' };

export interface LedgerRow {
  readonly id: string;
  readonly at: string;
  readonly type: LedgerType;
  readonly shipperName: string;
  /** Free description: an order code, a request code. */
  readonly reference: string;
  /** Signed. A HOLD / RELEASE row moves the held part only: it is not a deduction from, or a deposit into, the balance. */
  readonly amount: number;
  /** Total balance after this row, or null when the row does not move the balance (hold / release). */
  readonly balanceAfter: number | null;
  readonly status: LedgerStatus;
}

/** Hold and release rows are information about the held part: they never change the total balance. */
export const movesBalance = (type: LedgerType): boolean => type !== 'HOLD' && type !== 'RELEASE';

export interface LedgerFilter {
  readonly from: string;
  readonly to: string;
  readonly shipper: string;
  readonly type: LedgerType | 'ALL';
  readonly status: LedgerStatus | 'ALL';
}

export const EMPTY_LEDGER_FILTER: LedgerFilter = { from: '', to: '', shipper: '', type: 'ALL', status: 'ALL' };

/** Reconciliation compares the sum of the ledger with the sum of the wallet balances and shows the difference as it is. */
export interface ReconciliationSummary {
  readonly ledgerTotal: number;
  readonly walletTotal: number;
  readonly heldTotal: number;
  readonly pendingWithdrawals: number;
}

export const reconciliationDifference = (summary: ReconciliationSummary): number => summary.walletTotal - summary.ledgerTotal;

export interface LedgerData {
  readonly rows: readonly LedgerRow[];
  readonly summary: ReconciliationSummary;
}

// ---- overview (M04-A01) -------------------------------------------------------------------------------------------------

export interface ChartDay {
  /** dd/mm. */
  readonly label: string;
  readonly topup: number;
  readonly withdraw: number;
  readonly commission: number;
}

export interface FinanceOverview {
  readonly totalBalance: number;
  readonly totalHeld: number;
  readonly pendingTopups: number;
  readonly pendingWithdrawals: number;
  readonly commissionCollected: number;
  readonly transactionsToday: number;
  readonly chart: readonly ChartDay[];
}

// ---- wallet parameters (M04-A07) ----------------------------------------------------------------------------------------

export interface WalletParams {
  readonly minTopup: number;
  readonly minWithdraw: number;
  readonly commissionPerOrder: number;
}

/** Reference defaults (Owner decision): used by the design preview and the documents only. The real page shows what the server says. */
export const WALLET_PARAM_DEFAULTS: WalletParams = { minTopup: 100_000, minWithdraw: 10_000, commissionPerOrder: 1_000 };

export type WalletParamKey = keyof WalletParams;
export const WALLET_PARAM_LABEL: Record<WalletParamKey, string> = {
  minTopup: 'Nạp tối thiểu mỗi lần',
  minWithdraw: 'Rút tối thiểu (tham số lịch sử)',
  commissionPerOrder: 'Hoa hồng mỗi đơn giao thành công',
};
export const WALLET_PARAM_HINT: Record<WalletParamKey, string> = {
  minTopup: 'Shipper không thể tạo yêu cầu nạp thấp hơn mức này.',
  minWithdraw: 'Shipper không thể tạo yêu cầu rút thấp hơn mức này.',
  commissionPerOrder: 'Số tiền tạm giữ khi nhận đơn và thu khi đơn hoàn thành. Chỉ áp dụng cho giao dịch mới.',
};
/** Allowed range of each parameter (whole VND). */
export const WALLET_PARAM_RANGE: Record<WalletParamKey, { readonly min: number; readonly max: number }> = {
  minTopup: { min: 1_000, max: 50_000_000 },
  minWithdraw: { min: 1_000, max: 50_000_000 },
  commissionPerOrder: { min: 0, max: 1_000_000 },
};
export const WALLET_PARAM_KEYS: readonly WalletParamKey[] = ['minTopup', 'minWithdraw', 'commissionPerOrder'];

export type WalletParamsDraft = Record<WalletParamKey, string>;

export const draftOf = (params: WalletParams): WalletParamsDraft => ({
  minTopup: String(params.minTopup),
  minWithdraw: String(params.minWithdraw),
  commissionPerOrder: String(params.commissionPerOrder),
});

export function validateWalletParams(draft: WalletParamsDraft): Partial<Record<WalletParamKey, string>> {
  const errors: Partial<Record<WalletParamKey, string>> = {};
  for (const key of WALLET_PARAM_KEYS) {
    const value = parseVnd(draft[key]);
    const range = WALLET_PARAM_RANGE[key];
    if (value === undefined || value < range.min || value > range.max) {
      errors[key] = `Nhập số nguyên từ ${formatVnd(range.min)} đến ${formatVnd(range.max)}.`;
    }
  }
  return errors;
}

export interface WalletParamChange {
  readonly id: string;
  readonly key: WalletParamKey;
  readonly oldValue: number;
  readonly newValue: number;
  /** Id of the administrator who saved it. */
  readonly changedBy: string;
  readonly changedAt: string;
}

export interface WalletParamsData {
  readonly params: WalletParams;
  /** Newest first. */
  readonly history: readonly WalletParamChange[];
}

export const WALLET_PARAMS_NOT_SAVED = 'Giai đoạn giao diện: thay đổi chưa được lưu vào cơ sở dữ liệu.';

// ---- filters (pure; the page keeps the filter, the lists come whole from the source in this phase) ---------------------------

const fold = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();

export function filterWallets(rows: readonly WalletRow[], query: string): readonly WalletRow[] {
  const needle = fold(query.trim());
  if (needle === '') {
    return rows;
  }
  const digits = needle.replace(/\D/g, '');
  return rows.filter((row) => fold(`${row.name} ${row.phoneMasked} ${row.code}`).includes(needle) || (digits !== '' && row.phoneMasked.replace(/\D/g, '').includes(digits)));
}

export const topupMatchesTab = (status: TopupStatus, tab: TopupTab): boolean => (tab === 'ALL' ? true : tab === 'PENDING' ? status === 'PENDING' : status !== 'PENDING');

export function filterTopups(rows: readonly TopupRow[], tab: TopupTab, query: string): readonly TopupRow[] {
  const needle = fold(query.trim());
  return rows.filter((row) => topupMatchesTab(row.status, tab) && (needle === '' || fold(`${row.shipperName} ${row.phoneMasked} ${row.code}`).includes(needle)));
}

export const withdrawalMatchesTab = (status: WithdrawalStatus, tab: WithdrawalTab): boolean => tab === 'ALL' || (tab === 'COMPLETED' ? status === 'COMPLETED' : status === tab);

export function filterWithdrawals(rows: readonly WithdrawalRow[], tab: WithdrawalTab, query: string): readonly WithdrawalRow[] {
  const needle = fold(query.trim());
  return rows.filter((row) => withdrawalMatchesTab(row.status, tab) && (needle === '' || fold(`${row.shipperName} ${row.phoneMasked} ${row.code}`).includes(needle)));
}

export function topupCounts(rows: readonly TopupRow[]): Record<TopupTab, number> {
  return { PENDING: rows.filter((row) => topupMatchesTab(row.status, 'PENDING')).length, DONE: rows.filter((row) => topupMatchesTab(row.status, 'DONE')).length, ALL: rows.length };
}

export function withdrawalCounts(rows: readonly WithdrawalRow[]): Record<WithdrawalTab, number> {
  const counts = { PENDING: 0, PROCESSING: 0, COMPLETED: 0, NEEDS_RECONCILE: 0, ALL: rows.length } as Record<WithdrawalTab, number>;
  for (const row of rows) {
    if (row.status !== 'CANCELLED') {
      counts[row.status] += 1;
    }
  }
  return counts;
}

/** Date part (yyyy-mm-dd, local) of an ISO time, for the date filters. */
const dayOf = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const two = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
};

export function filterLedger(rows: readonly LedgerRow[], filter: LedgerFilter): readonly LedgerRow[] {
  const needle = fold(filter.shipper.trim());
  return rows.filter((row) => {
    const day = dayOf(row.at);
    return (
      (filter.from === '' || day >= filter.from) &&
      (filter.to === '' || day <= filter.to) &&
      (filter.type === 'ALL' || row.type === filter.type) &&
      (filter.status === 'ALL' || row.status === filter.status) &&
      (needle === '' || fold(row.shipperName).includes(needle))
    );
  });
}

/** Rows of one page (1-based) and the number of pages. */
export function paginate<T>(rows: readonly T[], page: number, size: number): { readonly rows: readonly T[]; readonly pages: number; readonly page: number } {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const safe = Math.min(Math.max(1, Math.trunc(page) || 1), pages);
  return { rows: rows.slice((safe - 1) * size, safe * size), pages, page: safe };
}

export const FINANCE_PAGE_SIZE = 10;

// ---- source ---------------------------------------------------------------------------------------------------------------

/**
 * Where the finance pages get their data. One method per page; each answers a `FinanceLoad` and never throws. The real source arrives
 * with the M04 backend packages; until then NOT_WIRED_FINANCE is used and every action button is disabled with its reason.
 */
export interface FinanceSource {
  overview(): Promise<FinanceLoad<FinanceOverview>>;
  wallets(): Promise<FinanceLoad<readonly WalletRow[]>>;
  topups(): Promise<FinanceLoad<readonly TopupRow[]>>;
  topup(id: string): Promise<FinanceLoad<TopupDetail>>;
  withdrawals(): Promise<FinanceLoad<readonly WithdrawalRow[]>>;
  withdrawal(id: string): Promise<FinanceLoad<WithdrawalDetail>>;
  ledger(): Promise<FinanceLoad<LedgerData>>;
  params(): Promise<FinanceLoad<WalletParamsData>>;
}

const notWired = <T>(): Promise<FinanceLoad<T>> => Promise.resolve({ kind: 'not-wired', reason: NOT_WIRED_FINANCE_REASON });

export const NOT_WIRED_FINANCE: FinanceSource = {
  overview: () => notWired(),
  wallets: () => notWired(),
  topups: () => notWired(),
  topup: () => notWired(),
  withdrawals: () => notWired(),
  withdrawal: () => notWired(),
  ledger: () => notWired(),
  params: () => notWired(),
};

/** Why a finance action button is disabled. */
export const FINANCE_ACTION_DISABLED = 'Thao tác này chưa được nối với máy chủ. Không có khoản tiền nào được ghi nhận từ giao diện này.';
