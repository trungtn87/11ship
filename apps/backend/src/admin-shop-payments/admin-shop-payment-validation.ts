import { AppError } from '../common/app-errors';
import { isCanonicalUuid } from '../shared/identifiers';
import { MAX_WALLET_VND } from '../wallet/wallet-types';
import { SHOP_PAYMENT_REJECT_REASONS, ShopPaymentRejectReason } from '../shop-payment/shop-payment-constants';
import { parsePaymentListQuery, PaymentListQuery } from '../shop-payment/shop-payment-validation';

// Strict parsers of the administration routes of the shop payments (#198). The actor comes from the session and the target from the path; a body never names an
// actor, a shop, a state, a role or a ledger field. Anything else is ADMIN_INPUT_INVALID, echoing nothing.

function invalid(): never {
  throw new AppError('ADMIN_INPUT_INVALID');
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid();
  }
  const proto = Object.getPrototypeOf(value) as unknown;
  const actual = Object.keys(value);
  if ((proto !== Object.prototype && proto !== null) || actual.length !== keys.length || !actual.every((key) => keys.includes(key))) {
    return invalid();
  }
  return value as Record<string, unknown>;
}

const version = (value: unknown): number => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : invalid());

export function parseAdminId(value: unknown): string {
  return isCanonicalUuid(value) ? value : invalid();
}

export interface AdminPaymentListQuery extends PaymentListQuery {
  readonly reported: boolean | undefined;
}

/** GET list: status / limit / cursor as the shop's, plus `reported=true|false` (the reconciliation queue shows the reported ones). */
export function parseAdminPaymentListQuery(query: unknown): AdminPaymentListQuery {
  const { list, extras } = parsePaymentListQuery(query, ['reported'], invalid);
  const reported = extras.reported;
  if (reported !== undefined && reported !== 'true' && reported !== 'false') {
    return invalid();
  }
  return { ...list, reported: reported === undefined ? undefined : reported === 'true' };
}

export interface RejectInput {
  readonly expectedVersion: number;
  readonly reasonCode: ShopPaymentRejectReason;
}

export function parseRejectInput(body: unknown): RejectInput {
  const parsed = exact(body, ['expected_version', 'reason_code']);
  const reason = parsed.reason_code;
  if (typeof reason !== 'string' || !(SHOP_PAYMENT_REJECT_REASONS as readonly string[]).includes(reason)) {
    return invalid();
  }
  return { expectedVersion: version(parsed.expected_version), reasonCode: reason as ShopPaymentRejectReason };
}

export interface ConfirmInput {
  readonly expectedVersion: number;
  readonly actualAmountVnd: number;
  readonly bankId: string;
  readonly systemAccountId: string;
  /** Exactly as the bank statement gives it: only the edges are trimmed. Never lower-cased, never stripped of leading zeros. */
  readonly canonicalTransactionId: string;
  readonly receivedAtIso: string;
  readonly receivedAtMs: number;
}

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

/** POST confirm: exact {expected_version, actual_amount_vnd, bank_id, system_owned_account_id, canonical_transaction_id, received_at}: what the STATEMENT shows. */
export function parseConfirmInput(body: unknown): ConfirmInput {
  const parsed = exact(body, ['expected_version', 'actual_amount_vnd', 'bank_id', 'system_owned_account_id', 'canonical_transaction_id', 'received_at']);
  const amount = parsed.actual_amount_vnd;
  const bank = parsed.bank_id;
  const account = parsed.system_owned_account_id;
  const rawId = parsed.canonical_transaction_id;
  const rawTime = parsed.received_at;
  if (
    typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 1 || BigInt(amount) > MAX_WALLET_VND ||
    typeof bank !== 'string' || !/^[A-Z0-9]{2,16}$/.test(bank) ||
    !isCanonicalUuid(account) ||
    typeof rawId !== 'string' ||
    typeof rawTime !== 'string' || !TIMESTAMP.test(rawTime)
  ) {
    return invalid();
  }
  const id = rawId.replace(/^\s+|\s+$/gu, '');
  const ms = Date.parse(rawTime);
  if ([...id].length < 1 || [...id].length > 128 || /[\p{Cc}]/u.test(id) || !Number.isFinite(ms)) {
    return invalid();
  }
  return { expectedVersion: version(parsed.expected_version), actualAmountVnd: amount, bankId: bank, systemAccountId: account, canonicalTransactionId: id, receivedAtIso: new Date(ms).toISOString(), receivedAtMs: ms };
}

export interface EntitlementInput {
  readonly reason: string;
  readonly paymentRequestId: string | null;
}

/** POST grant: exact {reason, payment_request_id|null}; POST revoke: exact {reason}. The reason is 3..300 characters after trimming. */
export function parseEntitlementInput(body: unknown, withPayment: boolean): EntitlementInput {
  const parsed = exact(body, withPayment ? ['reason', 'payment_request_id'] : ['reason']);
  const raw = parsed.reason;
  const payment = withPayment ? parsed.payment_request_id : null;
  if (typeof raw !== 'string' || (payment !== null && !isCanonicalUuid(payment))) {
    return invalid();
  }
  const reason = raw.normalize('NFC').replace(/\s+/gu, ' ').trim();
  if ([...reason].length < 3 || [...reason].length > 300 || /[\p{Cc}]/u.test(reason)) {
    return invalid();
  }
  return { reason, paymentRequestId: payment };
}
