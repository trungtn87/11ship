import { AppError } from '../common/app-errors';
import { isCanonicalUuid } from '../shared/identifiers';
import { TOPUP_REQUEST_STATES, TopupListCursor, TopupRequestState } from '../wallet/topup-request-repository';
import { MAX_WALLET_VND } from '../wallet/wallet-types';
import { decodeCursor, TOPUP_LIST_DEFAULT_LIMIT, TOPUP_LIST_MAX_LIMIT } from '../wallet-topup/topup-request-validation';

// Strict parsers of the administration routes of the top-up requests (M04-B2.2b). The actor comes from the session and the request from the path; a body
// never names an actor, a Shipper, a wallet, a role, a state or a ledger field. Anything else is ADMIN_INPUT_INVALID, echoing nothing.

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

function version(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    return invalid();
  }
  return value;
}

export const REJECT_REASON_CODES = ['NOT_RECEIVED', 'AMOUNT_MISMATCH', 'DUPLICATE_REQUEST', 'INVALID_REQUEST', 'OTHER'] as const;
export type RejectReasonCode = (typeof REJECT_REASON_CODES)[number];

export interface RejectBody {
  readonly expectedVersion: number;
  readonly reasonCode: RejectReasonCode;
}
/** POST reject: exact {expected_version, reason_code} with a reason from the allowlist. */
export function parseRejectBody(body: unknown): RejectBody {
  const parsed = exact(body, ['expected_version', 'reason_code']);
  const reason = parsed.reason_code;
  if (typeof reason !== 'string' || !(REJECT_REASON_CODES as readonly string[]).includes(reason)) {
    return invalid();
  }
  return { expectedVersion: version(parsed.expected_version), reasonCode: reason as RejectReasonCode };
}

export interface ConfirmBody {
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

/**
 * POST confirm: exact {expected_version, actual_amount_vnd, bank_id, system_owned_account_id, canonical_transaction_id, received_at}. The amount is what the
 * statement shows (a safe integer >= 1 and within the wallet limit), not what was asked; the time carries its zone.
 */
export function parseConfirmBody(body: unknown): ConfirmBody {
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

export interface AdminTopupListQuery {
  readonly state: TopupRequestState | undefined;
  readonly limit: number;
  readonly after: TopupListCursor | undefined;
}
/** GET list: only status / limit (1..50, default 20) / cursor, each once, as plain strings. */
export function parseAdminTopupListQuery(query: unknown): AdminTopupListQuery {
  if (typeof query !== 'object' || query === null || Array.isArray(query)) {
    return invalid();
  }
  const source = query as Record<string, unknown>;
  if (!Object.keys(source).every((key) => key === 'status' || key === 'limit' || key === 'cursor')) {
    return invalid();
  }
  const text = (key: string): string | undefined => {
    const value = source[key];
    return value === undefined ? undefined : typeof value === 'string' ? value : invalid();
  };
  const status = text('status');
  if (status !== undefined && !TOPUP_REQUEST_STATES.includes(status as TopupRequestState)) {
    return invalid();
  }
  const limitText = text('limit');
  let limit = TOPUP_LIST_DEFAULT_LIMIT;
  if (limitText !== undefined) {
    if (!/^[0-9]{1,3}$/.test(limitText) || Number(limitText) < 1 || Number(limitText) > TOPUP_LIST_MAX_LIMIT) {
      return invalid();
    }
    limit = Number(limitText);
  }
  const cursor = text('cursor');
  let after: TopupListCursor | undefined;
  if (cursor !== undefined) {
    try {
      after = decodeCursor(cursor);
    } catch {
      return invalid();
    }
  }
  return { state: status as TopupRequestState | undefined, limit, after };
}
