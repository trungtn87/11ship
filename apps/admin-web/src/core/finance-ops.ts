// Model of the REAL operating pages of the finance area of the administration web (M04-C): the overview, the Shipper wallets, the withdrawals (claim, record the
// manual transfer, reconcile), the transactions, the reconciliation and the commission policy. Plain data and pure functions; the DOM (dom/finance-ops-view.ts)
// only draws it and `FinanceOpsSource` is where it comes from. Nothing here invents a balance, a row, a total or a status: a page shows what the server answered and
// says so when it did not. Money is whole VND. Every list is paged by the SERVER (cursor, one status per call): no total and no client-side search over the whole system.

import { Failure } from './accounts.js';
import { FinanceOutcome, FinanceRead, parseActualVnd, receivedAtFrom, TRANSACTION_ID_MAX } from './finance-admin.js';

export type { FinanceOutcome, FinanceRead } from './finance-admin.js';

export const OPS_PAGE_SIZE = 20;

// ---- shipper identity (masked by the server) ---------------------------------------------------------------------------------

export interface ShipperIdentity {
  readonly code: string | null;
  readonly nameMasked: string | null;
  readonly phoneMasked: string | null;
  readonly status: string | null;
}

export const identityLabel = (shipper: ShipperIdentity): string => (shipper.code === null ? '—' : `${shipper.code} · ${shipper.nameMasked ?? '—'}`);

// ---- overview -----------------------------------------------------------------------------------------------------------------

export interface CountAmount {
  readonly count: number;
  readonly amountVnd: number;
}

export interface OpsOverview {
  readonly wallets: number;
  readonly totalBalanceVnd: number;
  readonly totalHeldVnd: number;
  readonly totalAvailableVnd: number;
  readonly topupPending: CountAmount;
  readonly withdrawalPending: CountAmount;
  readonly withdrawalProcessing: number;
  readonly withdrawalReconciliation: CountAmount;
  readonly last24h: { readonly topup: CountAmount; readonly withdrawalPaid: CountAmount; readonly commission: CountAmount };
  readonly driftWallets: number;
  readonly driftWithdrawals: number;
  readonly commissionVnd: number;
}

// ---- wallets ------------------------------------------------------------------------------------------------------------------

export interface WalletItem {
  readonly walletId: string;
  readonly driverId: string;
  readonly shipper: ShipperIdentity;
  readonly balanceVnd: number;
  readonly heldVnd: number;
  readonly availableVnd: number;
  readonly updatedAt: string;
}
export interface WalletPage {
  readonly items: readonly WalletItem[];
  readonly nextCursor: string | null;
}

export type HoldStatus = 'ACTIVE' | 'CAPTURED' | 'RELEASED';
export interface HoldItem {
  readonly holdId: string;
  readonly purpose: 'COMMISSION' | 'WITHDRAWAL';
  readonly amountVnd: number;
  readonly status: HoldStatus;
  readonly orderRef: string | null;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
}

export type LedgerKind = 'TOPUP' | 'WITHDRAWAL_DEBIT' | 'COMMISSION_DEBIT' | 'ADJUSTMENT_CREDIT' | 'ADJUSTMENT_DEBIT' | 'HOLD_COMMISSION' | 'HOLD_WITHDRAWAL';
export const LEDGER_KINDS: readonly LedgerKind[] = ['TOPUP', 'WITHDRAWAL_DEBIT', 'COMMISSION_DEBIT', 'HOLD_COMMISSION', 'HOLD_WITHDRAWAL', 'ADJUSTMENT_CREDIT', 'ADJUSTMENT_DEBIT'];
export const LEDGER_KIND_LABEL: Record<LedgerKind, string> = {
  TOPUP: 'Nạp tiền',
  WITHDRAWAL_DEBIT: 'Rút tiền (đã chuyển)',
  COMMISSION_DEBIT: 'Hoa hồng',
  ADJUSTMENT_CREDIT: 'Điều chỉnh (+)',
  ADJUSTMENT_DEBIT: 'Điều chỉnh (−)',
  HOLD_COMMISSION: 'Tạm giữ hoa hồng',
  HOLD_WITHDRAWAL: 'Tạm giữ rút tiền',
};
export const HOLD_STATUS_LABEL: Record<HoldStatus, string> = { ACTIVE: 'Đang giữ', CAPTURED: 'Đã thu', RELEASED: 'Đã giải phóng' };

/** A hold row is information about the held part: it never changes the balance and is not a ledger movement. */
export const isHoldKind = (kind: LedgerKind): boolean => kind === 'HOLD_COMMISSION' || kind === 'HOLD_WITHDRAWAL';

export interface LedgerItem {
  readonly id: string;
  readonly kind: LedgerKind;
  readonly amountVnd: number;
  readonly balanceAfterVnd: number | null;
  readonly holdStatus: HoldStatus | null;
  readonly orderRef: string | null;
  readonly sourceId: string | null;
  readonly at: string;
  readonly driverId: string | null;
  readonly shipper: ShipperIdentity | null;
}
export interface LedgerPage {
  readonly items: readonly LedgerItem[];
  readonly nextCursor: string | null;
}
export interface LedgerFilterOps {
  readonly kind: LedgerKind | 'ALL';
  /** A Shipper's driver id (the wallet page links here). */
  readonly driverId: string | null;
}
export const EMPTY_LEDGER_FILTER_OPS: LedgerFilterOps = { kind: 'ALL', driverId: null };

export interface WalletDetail {
  readonly shipper: ShipperIdentity;
  readonly wallet: { readonly walletId: string; readonly balanceVnd: number; readonly heldVnd: number; readonly availableVnd: number; readonly version: number } | null;
  readonly holds: readonly HoldItem[];
  readonly recent: readonly LedgerItem[];
}

// ---- withdrawals --------------------------------------------------------------------------------------------------------------

export type WithdrawalState = 'PENDING' | 'PROCESSING' | 'RECONCILIATION' | 'PAID' | 'CANCELLED';
export const WITHDRAWAL_STATES: readonly WithdrawalState[] = ['PENDING', 'PROCESSING', 'RECONCILIATION', 'PAID', 'CANCELLED'];
export const WITHDRAWAL_STATE_LABEL: Record<WithdrawalState, string> = {
  PENDING: 'Chờ xử lý',
  PROCESSING: 'Đang xử lý',
  RECONCILIATION: 'Cần đối soát',
  PAID: 'Hoàn thành',
  CANCELLED: 'Đã hủy',
};
/** The server takes ONE status per call, so the tabs are exactly its states (plus "all"). */
export type WithdrawalFilterOps = WithdrawalState | 'ALL';
export const WITHDRAWAL_FILTERS: readonly WithdrawalFilterOps[] = ['PENDING', 'PROCESSING', 'RECONCILIATION', 'PAID', 'CANCELLED', 'ALL'];
export const WITHDRAWAL_FILTER_LABEL: Record<WithdrawalFilterOps, string> = { ...WITHDRAWAL_STATE_LABEL, ALL: 'Tất cả' };

export interface WithdrawalItem {
  readonly withdrawalId: string;
  readonly requestCode: string;
  readonly driverId: string;
  readonly shipper: ShipperIdentity;
  readonly amountVnd: number;
  readonly state: WithdrawalState;
  readonly version: number;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
  readonly destinationBank: string;
  readonly destinationMasked: string;
}
export interface WithdrawalPage {
  readonly items: readonly WithdrawalItem[];
  readonly nextCursor: string | null;
}

/** The destination as the server allows THIS administrator to see it now: whole only to the one who claimed the transfer (or a reconciler of a RECONCILIATION case). */
export type Destination =
  | { readonly full: true; readonly bankCode: string; readonly bankName: string; readonly accountNumber: string; readonly accountHolder: string }
  | { readonly full: false; readonly bankCode: string; readonly bankName: string; readonly accountNumberMasked: string; readonly accountHolderMasked: string };

export type ReconciliationReason = 'UNKNOWN_OUTCOME' | 'AMOUNT_MISMATCH' | 'DESTINATION_MISMATCH' | 'TAKEOVER_NEEDED';
export const RECONCILIATION_REASONS: readonly ReconciliationReason[] = ['UNKNOWN_OUTCOME', 'AMOUNT_MISMATCH', 'DESTINATION_MISMATCH', 'TAKEOVER_NEEDED'];
export const RECONCILIATION_REASON_LABEL: Record<ReconciliationReason, string> = {
  UNKNOWN_OUTCOME: 'Không biết đã chuyển hay chưa (mất phản hồi)',
  AMOUNT_MISMATCH: 'Số tiền đã chuyển khác yêu cầu',
  DESTINATION_MISMATCH: 'Đã chuyển nhầm tài khoản',
  TAKEOVER_NEEDED: 'Người nhận xử lý không thể tiếp tục',
};

export type ReconcileOutcome = 'UNKNOWN' | 'CONFIRMED_PAID' | 'CONFIRMED_NOT_SENT_FINAL';
export const RECONCILE_OUTCOME_LABEL: Record<ReconcileOutcome, string> = {
  UNKNOWN: 'Vẫn chưa rõ — giữ nguyên',
  CONFIRMED_PAID: 'Đã chuyển đủ tiền (có chứng từ)',
  CONFIRMED_NOT_SENT_FINAL: 'Chắc chắn CHƯA chuyển (ngân hàng xác nhận)',
};
export type ReconcileReasonCode = 'STATEMENT_CONFIRMED' | 'BANK_CONFIRMED_NOT_SENT' | 'STILL_UNCLEAR' | 'OTHER';
export const RECONCILE_REASON_CODE_LABEL: Record<ReconcileReasonCode, string> = {
  STATEMENT_CONFIRMED: 'Đối chiếu sao kê ngân hàng',
  BANK_CONFIRMED_NOT_SENT: 'Ngân hàng xác nhận chưa/không thực hiện lệnh',
  STILL_UNCLEAR: 'Chưa đủ chứng cứ',
  OTHER: 'Lý do khác',
};

export interface WithdrawalEvent {
  readonly kind: string;
  readonly fromState: WithdrawalState | null;
  readonly toState: WithdrawalState;
  readonly reasonCode: string | null;
  readonly at: string;
  readonly byMe: boolean;
}

export interface WithdrawalDetailOps extends WithdrawalItem {
  readonly destination: Destination;
  /** PENDING only: is the Shipper's bank account still exactly the verified one the request was made with? */
  readonly snapshotCurrent: boolean | null;
  readonly processing: { readonly startedAt: string; readonly isOwner: boolean } | null;
  readonly reconciliation: { readonly reasonCode: ReconciliationReason; readonly reportedAt: string } | null;
  readonly outgoing: { readonly bankId: string; readonly amountVnd: number; readonly occurredAt: string; readonly matchesAmount: boolean } | null;
  readonly paidAt: string | null;
  readonly outcome: string | null;
  readonly events: readonly WithdrawalEvent[];
  readonly rights: { readonly canProcess: boolean; readonly canConfirm: boolean; readonly canReport: boolean; readonly canReconcile: boolean };
}

export interface SourceAccount {
  readonly accountId: string;
  readonly bankId: string;
  readonly numberMasked: string;
}

// ---- reconciliation and commission --------------------------------------------------------------------------------------------

export interface DriftItem {
  readonly walletId: string;
  readonly driverId: string;
  readonly shipper: ShipperIdentity;
  readonly balanceVnd: number;
  readonly heldVnd: number;
  readonly ledgerSumVnd: number;
  readonly lastBalanceAfterVnd: number;
  readonly activeHoldsVnd: number;
}
export interface ReconciliationView {
  readonly checkedWallets: number;
  readonly driftWallets: number;
  readonly driftWithdrawals: number;
  readonly withdrawalsInReconciliation: number;
  readonly drift: readonly DriftItem[];
}
export interface CheckResult {
  readonly checkedWallets: number;
  readonly driftWallets: number;
  readonly driftWithdrawals: number;
  readonly recorded: boolean;
}

export interface CommissionVersion {
  readonly version: number;
  readonly commissionVnd: number;
  readonly createdAt: string;
}
export interface CommissionPolicyView {
  readonly current: CommissionVersion;
  readonly history: readonly CommissionVersion[];
}

// ---- commands -----------------------------------------------------------------------------------------------------------------

/** The outgoing transfer an administrator read off the bank statement. The transaction id is kept EXACTLY as typed (only the edges are trimmed by the server). */
export interface OutgoingEvidenceInput {
  readonly actualVnd: number;
  readonly bankId: string;
  readonly accountId: string;
  readonly transactionId: string;
  /** ISO instant with its zone. */
  readonly paidAt: string;
}

export interface StartCommand {
  readonly key: string;
  readonly withdrawalId: string;
  readonly version: number;
}
export interface MarkPaidCommand {
  readonly key: string;
  readonly withdrawalId: string;
  readonly version: number;
  readonly evidence: OutgoingEvidenceInput;
}
export interface ReportCommand {
  readonly key: string;
  readonly withdrawalId: string;
  readonly version: number;
  readonly reason: ReconciliationReason;
  readonly evidence?: OutgoingEvidenceInput;
}
export interface ReconcileCommand {
  readonly key: string;
  readonly withdrawalId: string;
  readonly version: number;
  readonly outcome: ReconcileOutcome;
  readonly reasonCode: ReconcileReasonCode;
  readonly evidence?: OutgoingEvidenceInput;
}
export interface CommissionCommand {
  readonly key: string;
  readonly version: number;
  readonly commissionVnd: number;
}
export interface CheckCommand {
  readonly key: string;
}

export interface FinanceOpsSource {
  overview(): Promise<FinanceRead<OpsOverview>>;
  wallets(query: string, cursor: string | null): Promise<FinanceRead<WalletPage>>;
  wallet(driverId: string): Promise<FinanceRead<WalletDetail>>;
  ledger(filter: LedgerFilterOps, cursor: string | null): Promise<FinanceRead<LedgerPage>>;
  withdrawals(filter: WithdrawalFilterOps, cursor: string | null): Promise<FinanceRead<WithdrawalPage>>;
  withdrawal(withdrawalId: string): Promise<FinanceRead<WithdrawalDetailOps>>;
  sourceAccounts(): Promise<FinanceRead<readonly SourceAccount[]>>;
  reconciliation(): Promise<FinanceRead<ReconciliationView>>;
  commissionPolicy(): Promise<FinanceRead<CommissionPolicyView>>;
  startProcessing(command: StartCommand): Promise<FinanceOutcome>;
  markPaid(command: MarkPaidCommand): Promise<FinanceOutcome>;
  reportReconciliation(command: ReportCommand): Promise<FinanceOutcome>;
  reconcile(command: ReconcileCommand): Promise<FinanceOutcome>;
  runCheck(command: CheckCommand): Promise<FinanceOutcome & { readonly result?: CheckResult }>;
  changeCommission(command: CommissionCommand): Promise<FinanceOutcome>;
}

/** Nothing connected: every read says so, every command is refused before it leaves the page. No sample data exists in this build. */
export const NOT_WIRED_FINANCE_OPS: FinanceOpsSource = {
  overview: async () => ({ kind: 'not-wired' }),
  wallets: async () => ({ kind: 'not-wired' }),
  wallet: async () => ({ kind: 'not-wired' }),
  ledger: async () => ({ kind: 'not-wired' }),
  withdrawals: async () => ({ kind: 'not-wired' }),
  withdrawal: async () => ({ kind: 'not-wired' }),
  sourceAccounts: async () => ({ kind: 'not-wired' }),
  reconciliation: async () => ({ kind: 'not-wired' }),
  commissionPolicy: async () => ({ kind: 'not-wired' }),
  startProcessing: async () => ({ kind: 'not-wired' }),
  markPaid: async () => ({ kind: 'not-wired' }),
  reportReconciliation: async () => ({ kind: 'not-wired' }),
  reconcile: async () => ({ kind: 'not-wired' }),
  runCheck: async () => ({ kind: 'not-wired' }),
  changeCommission: async () => ({ kind: 'not-wired' }),
};

// ---- the transfer evidence form ------------------------------------------------------------------------------------------------

export interface EvidenceDraft {
  readonly actual: string;
  readonly transactionId: string;
  readonly paidAt: string;
  readonly accountId: string;
  /** The administrator states that the money went to exactly the destination of the request. */
  readonly destinationChecked: boolean;
}
export const EMPTY_EVIDENCE_DRAFT: EvidenceDraft = { actual: '', transactionId: '', paidAt: '', accountId: '', destinationChecked: false };

export interface EvidenceChecked {
  readonly errors: { actual?: string; transactionId?: string; paidAt?: string; accountId?: string; destinationChecked?: string };
  /** Present only when every field is valid: exactly what would be sent. */
  readonly ready?: OutgoingEvidenceInput & { readonly accountLabel: string };
  /** The amount typed is NOT the amount of the request: the transfer cannot be recorded as PAID (the server refuses it); it is reported instead. */
  readonly mismatch: boolean;
}

/** Checks the form. The transaction code is kept EXACTLY as typed (case and leading zeros). `needsDestination`: PAID needs the statement that the destination was checked. */
export function checkEvidence(draft: EvidenceDraft, requestedVnd: number, accounts: readonly SourceAccount[], nowMs: number, needsDestination: boolean): EvidenceChecked {
  const errors: { actual?: string; transactionId?: string; paidAt?: string; accountId?: string; destinationChecked?: string } = {};
  const actualVnd = parseActualVnd(draft.actual);
  if (actualVnd === undefined) {
    errors.actual = 'Nhập số tiền đã chuyển đúng như trên sao kê (số nguyên đồng, lớn hơn 0).';
  }
  const transactionId = draft.transactionId.replace(/^\s+|\s+$/g, '');
  if (transactionId === '') {
    errors.transactionId = 'Nhập mã giao dịch chuyển đi đúng như trên sao kê ngân hàng.';
  } else if ([...transactionId].length > TRANSACTION_ID_MAX || /[\u0000-\u001f\u007f-\u009f]/.test(transactionId)) {
    errors.transactionId = `Mã giao dịch tối đa ${TRANSACTION_ID_MAX} ký tự và không chứa ký tự điều khiển.`;
  }
  const paidAt = receivedAtFrom(draft.paidAt, nowMs);
  if (paidAt === undefined) {
    errors.paidAt = draft.paidAt === '' ? 'Chọn thời điểm đã chuyển (theo sao kê).' : 'Thời điểm không hợp lệ hoặc nằm trong tương lai.';
  }
  const account = accounts.find((item) => item.accountId === draft.accountId);
  if (account === undefined) {
    errors.accountId = 'Chọn tài khoản hệ thống đã dùng để chuyển.';
  }
  if (needsDestination && !draft.destinationChecked) {
    errors.destinationChecked = 'Xác nhận bạn đã kiểm tra tiền được chuyển đúng tài khoản nhận của yêu cầu.';
  }
  const mismatch = actualVnd !== undefined && actualVnd !== requestedVnd;
  if (Object.keys(errors).length > 0 || actualVnd === undefined || paidAt === undefined || account === undefined) {
    return { errors, mismatch };
  }
  return { errors, mismatch, ready: { actualVnd, bankId: account.bankId, accountId: account.accountId, transactionId, paidAt, accountLabel: `${account.bankId} · ${account.numberMasked}` } };
}

// ---- words ---------------------------------------------------------------------------------------------------------------------

/** What each backend code of the withdrawal flow is shown as. A code not listed gets the generic sentence of finance-admin.ts: the page never echoes a server string. */
export const OPS_MESSAGE: Readonly<Record<string, string>> = {
  WITHDRAWAL_NOT_FOUND: 'Không tìm thấy yêu cầu rút tiền.',
  WITHDRAWAL_STATE_CONFLICT: 'Yêu cầu rút tiền đã đổi trạng thái ở nơi khác. Đã tải lại trạng thái mới nhất; không có tiền nào bị thay đổi bởi thao tác này.',
  BANK_SNAPSHOT_STALE: 'Shipper đã đổi hoặc chưa xác minh lại tài khoản ngân hàng sau khi tạo yêu cầu. KHÔNG chuyển tiền. Shipper cần hủy yêu cầu và tạo yêu cầu mới sau khi tài khoản được xác minh.',
  WITHDRAWAL_NOT_OWNER: 'Chỉ quản trị viên đã nhận xử lý yêu cầu này mới được xác nhận đã chuyển tiền.',
  WITHDRAWAL_EVIDENCE_MISMATCH: 'Số tiền đã chuyển khác số tiền yêu cầu nên KHÔNG thể ghi là hoàn thành. Hãy dùng "Chuyển sang cần đối soát" và nhập chứng từ; không chuyển thêm lần nữa.',
  COMMISSION_POLICY_VERSION_CONFLICT: 'Chính sách hoa hồng đã được thay đổi ở nơi khác (hoặc giá trị không đổi). Đã tải lại.',
  BANK_TRANSACTION_ALREADY_RECORDED: 'Mã giao dịch ngân hàng này đã được ghi nhận trước đó (cho một yêu cầu khác). Không có thay đổi nào được ghi.',
  FINANCE_BANK_ACCOUNT_NOT_FOUND: 'Không tìm thấy tài khoản hệ thống đã chọn hoặc không khớp ngân hàng.',
  DRIVER_NOT_FOUND: 'Không tìm thấy hồ sơ Shipper.',
};

/** Failure of a read panel (re-exported so the view needs one import). */
export type OpsFailure = Failure;
