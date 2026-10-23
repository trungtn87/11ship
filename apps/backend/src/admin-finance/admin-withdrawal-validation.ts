import { AppError } from '../common/app-errors';
import { isCanonicalUuid } from '../shared/identifiers';
import { MAX_WALLET_VND } from '../wallet/wallet-types';
import { ReconciliationReason, RECONCILIATION_REASONS, WITHDRAWAL_STATES, WithdrawalCursor, WithdrawalState } from '../wallet/withdrawal-repository';
import { decodeCursor, TOPUP_LIST_DEFAULT_LIMIT, TOPUP_LIST_MAX_LIMIT } from '../wallet-topup/topup-request-validation';

// Strict parsers of the administration routes of the withdrawals (M04-C). The actor comes from the session and the withdrawal from the path; a body never names an
// actor, a Shipper, a wallet, a role, a state, an amount of the request or a ledger field. Anything else is ADMIN_INPUT_INVALID, echoing nothing.

function invalid(): never {
  throw new AppError('ADMIN_INPUT_INVALID');
}

function objectOf(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid();
  }
  const proto = Object.getPrototypeOf(value) as unknown;
  const keys = Object.keys(value);
  if ((proto !== Object.prototype && proto !== null) || !required.every((key) => keys.includes(key)) || !keys.every((key) => required.includes(key) || optional.includes(key))) {
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

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

/** The outgoing bank transaction an administrator read off the statement, exactly as the statement gives it (only the edges of the id are trimmed). */
export interface OutgoingEvidence {
  readonly actualAmountVnd: number;
  readonly bankId: string;
  readonly systemAccountId: string;
  readonly canonicalTransactionId: string;
  readonly paidAtIso: string;
  readonly paidAtMs: number;
}

const EVIDENCE_KEYS = ['actual_amount_vnd', 'bank_id', 'system_owned_account_id', 'canonical_transaction_id', 'paid_at'] as const;

function evidenceOf(parsed: Record<string, unknown>): OutgoingEvidence {
  const amount = parsed.actual_amount_vnd;
  const bank = parsed.bank_id;
  const account = parsed.system_owned_account_id;
  const rawId = parsed.canonical_transaction_id;
  const rawTime = parsed.paid_at;
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
  return { actualAmountVnd: amount, bankId: bank, systemAccountId: account, canonicalTransactionId: id, paidAtIso: new Date(ms).toISOString(), paidAtMs: ms };
}

/** An evidence object nested under `evidence`: exact keys. */
function nestedEvidence(value: unknown): OutgoingEvidence {
  return evidenceOf(objectOf(value, EVIDENCE_KEYS));
}

export interface VersionBody {
  readonly expectedVersion: number;
}
/** POST start-processing: exact {expected_version}. */
export function parseVersionBody(body: unknown): VersionBody {
  return { expectedVersion: version(objectOf(body, ['expected_version']).expected_version) };
}

export interface MarkPaidBody {
  readonly expectedVersion: number;
  readonly evidence: OutgoingEvidence;
}
/** POST mark-paid: exact {expected_version, destination_checked: true, + the five evidence fields}. destination_checked is the administrator's statement that the account the money went to is the snapshot's. */
export function parseMarkPaidBody(body: unknown): MarkPaidBody {
  const parsed = objectOf(body, ['expected_version', 'destination_checked', ...EVIDENCE_KEYS]);
  if (parsed.destination_checked !== true) {
    return invalid();
  }
  return { expectedVersion: version(parsed.expected_version), evidence: evidenceOf(parsed) };
}

export interface ReportBody {
  readonly expectedVersion: number;
  readonly reason: ReconciliationReason;
  readonly evidence: OutgoingEvidence | undefined;
}
/** POST report-reconciliation: exact {expected_version, reason_code} and an optional `evidence` (the outgoing transfer, when there is one to claim). */
export function parseReportBody(body: unknown): ReportBody {
  const parsed = objectOf(body, ['expected_version', 'reason_code'], ['evidence']);
  const reason = parsed.reason_code;
  if (typeof reason !== 'string' || !(RECONCILIATION_REASONS as readonly string[]).includes(reason)) {
    return invalid();
  }
  return { expectedVersion: version(parsed.expected_version), reason: reason as ReconciliationReason, evidence: parsed.evidence === undefined ? undefined : nestedEvidence(parsed.evidence) };
}

export const RECONCILE_OUTCOMES = ['UNKNOWN', 'CONFIRMED_PAID', 'CONFIRMED_NOT_SENT_FINAL'] as const;
export type ReconcileOutcome = (typeof RECONCILE_OUTCOMES)[number];
export const RECONCILE_REASON_CODES = ['STATEMENT_CONFIRMED', 'BANK_CONFIRMED_NOT_SENT', 'STILL_UNCLEAR', 'OTHER'] as const;

export interface ReconcileBody {
  readonly expectedVersion: number;
  readonly outcome: ReconcileOutcome;
  readonly reasonCode: string;
  readonly evidence: OutgoingEvidence | undefined;
}
/**
 * POST reconcile: {expected_version, outcome, reason_code} plus
 *   CONFIRMED_PAID            optional `evidence` (needed unless an outgoing record is already attached) and destination_checked: true;
 *   CONFIRMED_NOT_SENT_FINAL  bank_confirmed_not_sent: true (the bank confirms the transfer was never made or was cancelled for good);
 *   UNKNOWN                   nothing more (the case stays in RECONCILIATION).
 */
export function parseReconcileBody(body: unknown): ReconcileBody {
  const parsed = objectOf(body, ['expected_version', 'outcome', 'reason_code'], ['evidence', 'destination_checked', 'bank_confirmed_not_sent']);
  const outcome = parsed.outcome;
  const reason = parsed.reason_code;
  if (typeof outcome !== 'string' || !(RECONCILE_OUTCOMES as readonly string[]).includes(outcome) || typeof reason !== 'string' || !(RECONCILE_REASON_CODES as readonly string[]).includes(reason)) {
    return invalid();
  }
  const evidence = parsed.evidence === undefined ? undefined : nestedEvidence(parsed.evidence);
  if (outcome === 'CONFIRMED_PAID' && parsed.destination_checked !== true) {
    return invalid();
  }
  if (outcome === 'CONFIRMED_NOT_SENT_FINAL' && (parsed.bank_confirmed_not_sent !== true || evidence !== undefined)) {
    return invalid();
  }
  if (outcome === 'UNKNOWN' && (evidence !== undefined || parsed.destination_checked !== undefined || parsed.bank_confirmed_not_sent !== undefined)) {
    return invalid();
  }
  return { expectedVersion: version(parsed.expected_version), outcome: outcome as ReconcileOutcome, reasonCode: reason, evidence };
}

export interface AdminWithdrawalListQuery {
  readonly state: WithdrawalState | undefined;
  readonly limit: number;
  readonly after: WithdrawalCursor | undefined;
}
/** GET list: only status / limit (1..50, default 20) / cursor, each once, as plain strings. */
export function parseAdminWithdrawalListQuery(query: unknown): AdminWithdrawalListQuery {
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
  if (status !== undefined && !WITHDRAWAL_STATES.includes(status as WithdrawalState)) {
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
  let after: WithdrawalCursor | undefined;
  if (cursor !== undefined) {
    try {
      const decoded = decodeCursor(cursor);
      after = { createdAtMs: decoded.createdAtMs, withdrawalId: decoded.requestId };
    } catch {
      return invalid();
    }
  }
  return { state: status as WithdrawalState | undefined, limit, after };
}
