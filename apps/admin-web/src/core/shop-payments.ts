// Model of "Tài chính › Thanh toán quán" (issue #198): the reconciliation queue of the payments shops report, one request with the two money commands (record the
// money RECEIVED / refuse) and, as a SEPARATE command under its own right, the manual dish right of the shop. PLAIN DATA plus the port the pages talk to
// (dom/shop-payments-view.ts draws it, core/shop-payments-api.ts is the real source). The page decides nothing: a state, a right and a limit are what the server
// said, and every command is asked again by the server. There is no subscription here: no period, no renewal, no expiry, no shop wallet.

import { ConfirmCommand, FinanceOutcome, FinanceRead, ReceivingAccount, RejectCommand } from './finance-admin.js';

export type ShopPaymentState = 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'CANCELLED';
export const SHOP_PAYMENT_STATES: readonly ShopPaymentState[] = ['PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED'];
export type ShopPaymentPurpose = 'ACCOUNT_OPENING' | 'MENU_EXPANSION' | 'OTHER';
export const SHOP_PAYMENT_PURPOSES: readonly ShopPaymentPurpose[] = ['ACCOUNT_OPENING', 'MENU_EXPANSION', 'OTHER'];
export const SHOP_PAYMENT_PURPOSE_LABEL: Record<ShopPaymentPurpose, string> = { ACCOUNT_OPENING: 'Mở tài khoản quán', MENU_EXPANSION: 'Mở rộng số món', OTHER: 'Khoản khác' };

/** The tabs of the queue: what still needs a person first. The server takes ONE state (and the `reported` switch) per call. */
export type ShopPaymentFilter = 'CHECK' | 'NOT_REPORTED' | 'CONFIRMED' | 'REJECTED' | 'CANCELLED' | 'ALL';
export const SHOP_PAYMENT_FILTERS: readonly ShopPaymentFilter[] = ['CHECK', 'NOT_REPORTED', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'ALL'];
export const SHOP_PAYMENT_FILTER_LABEL: Record<ShopPaymentFilter, string> = { CHECK: 'Chờ kiểm tra', NOT_REPORTED: 'Chưa báo chuyển khoản', CONFIRMED: 'Đã nhận tiền', REJECTED: 'Chưa nhận được', CANCELLED: 'Đã hủy', ALL: 'Tất cả' };
export const SHOP_PAYMENT_PAGE_SIZE = 20;

/** The label of a state in this queue: a PENDING request the shop reported is "Chờ kiểm tra", one it did not report is still waiting for the transfer. */
export function stateLabel(state: ShopPaymentState, reported: boolean): string {
  switch (state) {
    case 'PENDING':
      return reported ? 'Chờ kiểm tra' : 'Chưa báo chuyển khoản';
    case 'CONFIRMED':
      return 'Đã nhận tiền';
    case 'REJECTED':
      return 'Chưa nhận được';
    case 'CANCELLED':
      return 'Đã hủy';
  }
}

export interface ShopPaymentItem {
  readonly requestId: string;
  readonly shopId: string;
  readonly shopName: string;
  readonly purpose: ShopPaymentPurpose;
  readonly requestedVnd: number;
  readonly state: ShopPaymentState;
  readonly rejectReason: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly reportedAt: string | null;
  readonly resolvedAt: string | null;
}

export interface ShopPaymentPage {
  readonly items: readonly ShopPaymentItem[];
  readonly nextCursor: string | null;
}

/** The proof of money received (immutable on the server). */
export interface ShopSettlement {
  readonly bankId: string;
  readonly transactionId: string;
  readonly amountVnd: number;
  readonly receivedAt: string;
  readonly recordedAt: string;
}

export interface EntitlementEvent {
  readonly action: 'GRANT' | 'REVOKE';
  readonly reason: string;
  readonly at: string;
  readonly paymentRequestId: string | null;
}

export interface ShopPaymentDetail extends ShopPaymentItem {
  readonly shopStatus: string;
  readonly settlement: ShopSettlement | null;
  /** The grant that followed THIS payment, if any. */
  readonly grantedByThisPayment: boolean;
  readonly menuExpanded: boolean;
  readonly menuExpandedSince: string | null;
  readonly visibleCount: number;
  /** null = no limit (the right is held). */
  readonly visibleLimit: number | null;
  /** After a revocation a shop can show more than the limit: nothing is hidden for it, it cannot add or show another until it is back under. */
  readonly overLimit: boolean;
  readonly history: readonly EntitlementEvent[];
  /** What THIS administrator may do now, as the server said (hint for the buttons; every command is asked again). */
  readonly mayRecord: boolean;
  readonly mayManage: boolean;
}

export interface GrantCommand {
  readonly key: string;
  readonly shopId: string;
  readonly reason: string;
  /** The CONFIRMED payment this right follows, or null (a manual decision with a reason, not pretending that money was paid). */
  readonly paymentRequestId: string | null;
}
export interface RevokeCommand {
  readonly key: string;
  readonly shopId: string;
  readonly reason: string;
}

export interface ShopPaymentSource {
  list(filter: ShopPaymentFilter, cursor: string | null): Promise<FinanceRead<ShopPaymentPage>>;
  detail(requestId: string): Promise<FinanceRead<ShopPaymentDetail>>;
  receivingAccounts(): Promise<FinanceRead<readonly ReceivingAccount[]>>;
  confirm(command: ConfirmCommand): Promise<FinanceOutcome>;
  reject(command: RejectCommand): Promise<FinanceOutcome>;
  grant(command: GrantCommand): Promise<FinanceOutcome>;
  revoke(command: RevokeCommand): Promise<FinanceOutcome>;
}

/** Nothing connected: every read says so, every command is refused before it leaves the page. */
export const NOT_WIRED_SHOP_PAYMENTS: ShopPaymentSource = {
  list: async () => ({ kind: 'not-wired' }),
  detail: async () => ({ kind: 'not-wired' }),
  receivingAccounts: async () => ({ kind: 'not-wired' }),
  confirm: async () => ({ kind: 'not-wired' }),
  reject: async () => ({ kind: 'not-wired' }),
  grant: async () => ({ kind: 'not-wired' }),
  revoke: async () => ({ kind: 'not-wired' }),
};

export const ENTITLEMENT_REASON_MIN = 3;
export const ENTITLEMENT_REASON_MAX = 300;

/** The reason of a grant / revoke as the server reads it: folded spaces, 3..300 characters, no control characters. */
export function checkReason(value: string): { readonly reason?: string; readonly error?: string } {
  const reason = value.normalize('NFC').replace(/\s+/gu, ' ').trim();
  const length = [...reason].length;
  if (length < ENTITLEMENT_REASON_MIN || length > ENTITLEMENT_REASON_MAX || /\p{Cc}/u.test(reason)) {
    return { error: length === 0 ? 'Lý do là bắt buộc (ghi vào nhật ký kiểm toán).' : `Lý do từ ${String(ENTITLEMENT_REASON_MIN)} đến ${String(ENTITLEMENT_REASON_MAX)} ký tự.` };
  }
  return { reason };
}
