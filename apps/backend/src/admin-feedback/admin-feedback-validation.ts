import { COMPLAINT_CATEGORIES, COMPLAINT_STATUSES, ComplaintCategory, ComplaintStatus, MODERATION_REASONS, ModerationReason, NOTE_MAX_CODEPOINTS, PartyRole, REVIEW_KINDS, ReviewKind } from '../feedback/feedback-constants';
import { dayStart, integerParam, invalid, onlyKeys, plainObject, queryText } from '../delivery/admin-delivery-validation';
import { isCanonicalUuid } from '../shared/identifiers';

// Strict parsers of the Administration's M11 routes. The actor comes from the session and the target from the path; a body never names an actor, a
// status or a visibility: each action has its own conditions in the service. Anything that is not exactly the documented shape is ADMIN_INPUT_INVALID.

const SEARCH_MAX = 80;
const TEXT_MAX = 4000;

export const parseId = (value: unknown): string => (isCanonicalUuid(value) ? value : invalid());
export const parseNoQuery = (query: unknown): void => onlyKeys(plainObject(query), []);

function text(value: unknown, min: number, max: number): string {
  if (typeof value !== 'string') {
    return invalid();
  }
  const lines = value
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/gu, ' ').trim());
  const joined = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const length = [...joined].length;
  return length < min || length > max || /[\p{Cc}\p{Cf}]/u.test(joined.replace(/\n/g, '')) ? invalid() : joined;
}

function version(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : invalid();
}

// ---- reviews ---------------------------------------------------------------------------------------------------------------------

export interface AdminReviewQuery {
  readonly kind: ReviewKind | null;
  readonly stars: number | null;
  readonly visibility: 'VISIBLE' | 'HIDDEN' | null;
  readonly q: string;
  readonly fromMs: number | null;
  readonly toMs: number | null;
  readonly shop: string;
  readonly shipper: string;
  readonly limit: number;
  readonly offset: number;
}

export function parseReviewQuery(query: unknown): AdminReviewQuery {
  const source = plainObject(query);
  onlyKeys(source, [], ['kind', 'stars', 'visibility', 'q', 'from', 'to', 'shop', 'shipper', 'limit', 'offset']);
  const kind = queryText(source, 'kind', 24);
  const visibility = queryText(source, 'visibility', 8);
  if ((kind !== '' && !(REVIEW_KINDS as readonly string[]).includes(kind)) || (visibility !== '' && visibility !== 'VISIBLE' && visibility !== 'HIDDEN')) {
    invalid();
  }
  const to = dayStart(source, 'to');
  return {
    kind: kind === '' ? null : (kind as ReviewKind),
    stars: Object.hasOwn(source, 'stars') ? integerParam(source, 'stars', 0, 1, 5) : null,
    visibility: visibility === '' ? null : (visibility as 'VISIBLE' | 'HIDDEN'),
    q: queryText(source, 'q', SEARCH_MAX),
    fromMs: dayStart(source, 'from'),
    toMs: to === null ? null : to + 86_400_000,
    shop: queryText(source, 'shop', SEARCH_MAX),
    shipper: queryText(source, 'shipper', SEARCH_MAX),
    limit: integerParam(source, 'limit', 20, 1, 50),
    offset: integerParam(source, 'offset', 0, 0, 100_000),
  };
}

export const REVIEW_ACTIONS = ['hide', 'restore'] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];
export const parseReviewAction = (value: unknown): ReviewAction => (typeof value === 'string' && (REVIEW_ACTIONS as readonly string[]).includes(value) ? (value as ReviewAction) : invalid());

export interface ModerationInput {
  readonly expectedVersion: number;
  readonly reasonCode: ModerationReason;
  readonly reasonNote: string | null;
}

/** hide / restore: a reason from the list is mandatory; OTHER also needs a written note. The rating's stars and text are never part of a body. */
export function parseModerationBody(body: unknown): ModerationInput {
  const source = plainObject(body);
  onlyKeys(source, ['expected_version', 'reason_code'], ['reason_note']);
  if (typeof source.reason_code !== 'string' || !(MODERATION_REASONS as readonly string[]).includes(source.reason_code)) {
    return invalid();
  }
  const note = source.reason_note === undefined || source.reason_note === null ? null : text(source.reason_note, 1, NOTE_MAX_CODEPOINTS);
  if (source.reason_code === 'OTHER' && note === null) {
    return invalid();
  }
  return { expectedVersion: version(source.expected_version), reasonCode: source.reason_code as ModerationReason, reasonNote: note };
}

// ---- complaints ------------------------------------------------------------------------------------------------------------------

export interface AdminComplaintQuery {
  readonly q: string;
  readonly status: ComplaintStatus | null;
  readonly category: ComplaintCategory | null;
  readonly submitterRole: PartyRole | null;
  readonly shop: string;
  readonly shipper: string;
  readonly assignee: string | 'NONE' | 'ME' | null;
  readonly fromMs: number | null;
  readonly toMs: number | null;
  readonly limit: number;
  readonly offset: number;
}

export function parseComplaintQuery(query: unknown): AdminComplaintQuery {
  const source = plainObject(query);
  onlyKeys(source, [], ['q', 'status', 'category', 'submitter_role', 'shop', 'shipper', 'assignee', 'from', 'to', 'limit', 'offset']);
  const status = queryText(source, 'status', 16);
  const category = queryText(source, 'category', 16);
  const role = queryText(source, 'submitter_role', 8);
  const assignee = queryText(source, 'assignee', 36);
  if (
    (status !== '' && !(COMPLAINT_STATUSES as readonly string[]).includes(status)) ||
    (category !== '' && !(COMPLAINT_CATEGORIES as readonly string[]).includes(category)) ||
    (role !== '' && role !== 'CUSTOMER' && role !== 'SHOP' && role !== 'SHIPPER') ||
    (assignee !== '' && assignee !== 'NONE' && assignee !== 'ME' && !isCanonicalUuid(assignee))
  ) {
    invalid();
  }
  const to = dayStart(source, 'to');
  return {
    q: queryText(source, 'q', SEARCH_MAX),
    status: status === '' ? null : (status as ComplaintStatus),
    category: category === '' ? null : (category as ComplaintCategory),
    submitterRole: role === '' ? null : (role as PartyRole),
    shop: queryText(source, 'shop', SEARCH_MAX),
    shipper: queryText(source, 'shipper', SEARCH_MAX),
    assignee: assignee === '' ? null : assignee,
    fromMs: dayStart(source, 'from'),
    toMs: to === null ? null : to + 86_400_000,
    limit: integerParam(source, 'limit', 20, 1, 50),
    offset: integerParam(source, 'offset', 0, 0, 100_000),
  };
}

export const COMPLAINT_ACTIONS = ['receive', 'assign', 'note', 'request-info', 'conclude', 'close', 'decide-reconsideration', 'adjust-result', 'adjust-commission'] as const;
export type ComplaintAction = (typeof COMPLAINT_ACTIONS)[number];
export const parseComplaintAction = (value: unknown): ComplaintAction => (typeof value === 'string' && (COMPLAINT_ACTIONS as readonly string[]).includes(value) ? (value as ComplaintAction) : invalid());

export interface ComplaintActionInput {
  readonly expectedVersion: number;
  readonly assignee: string | null;
  readonly body: string | null;
  readonly from: 'SUBMITTER' | 'SHOP' | 'SHIPPER' | null;
  readonly decision: 'REOPEN' | 'REJECT' | null;
  readonly correctedResult: 'DELIVERED' | 'NOT_DELIVERED' | null;
  readonly direction: 'REFUND_TO_SHIPPER' | 'CHARGE_TO_SHIPPER' | null;
  readonly amountVnd: number | null;
  readonly historyReviewed: boolean;
}

/** One strict body per action. Every text an action needs is mandatory (the reason is the audit); nothing here carries a status. */
export function parseComplaintActionBody(action: ComplaintAction, body: unknown): ComplaintActionInput {
  const source = plainObject(body);
  const extras: Record<ComplaintAction, readonly string[]> = {
    receive: [],
    assign: ['assignee_user_id'],
    note: ['body'],
    'request-info': ['from', 'body'],
    conclude: ['conclusion'],
    close: ['reason'],
    'decide-reconsideration': ['decision', 'reason'],
    'adjust-result': ['corrected_result', 'reason', 'history_reviewed'],
    'adjust-commission': ['direction', 'amount_vnd', 'reason', 'history_reviewed'],
  };
  onlyKeys(source, ['expected_version', ...extras[action]]);
  const input = {
    expectedVersion: version(source.expected_version),
    assignee: null as string | null,
    body: null as string | null,
    from: null as ComplaintActionInput['from'],
    decision: null as ComplaintActionInput['decision'],
    correctedResult: null as ComplaintActionInput['correctedResult'],
    direction: null as ComplaintActionInput['direction'],
    amountVnd: null as number | null,
    historyReviewed: false,
  };
  switch (action) {
    case 'assign':
      if (source.assignee_user_id !== null && !isCanonicalUuid(source.assignee_user_id)) {
        invalid();
      }
      input.assignee = source.assignee_user_id as string | null;
      break;
    case 'note':
      input.body = text(source.body, 1, TEXT_MAX);
      break;
    case 'request-info':
      if (source.from !== 'SUBMITTER' && source.from !== 'SHOP' && source.from !== 'SHIPPER') {
        invalid();
      }
      input.from = source.from as ComplaintActionInput['from'];
      input.body = text(source.body, 1, TEXT_MAX);
      break;
    case 'conclude':
      input.body = text(source.conclusion, 1, TEXT_MAX);
      break;
    case 'close':
      input.body = text(source.reason, 1, TEXT_MAX);
      break;
    case 'decide-reconsideration':
      if (source.decision !== 'REOPEN' && source.decision !== 'REJECT') {
        invalid();
      }
      input.decision = source.decision as 'REOPEN' | 'REJECT';
      input.body = text(source.reason, 1, TEXT_MAX);
      break;
    case 'adjust-result':
      if (source.corrected_result !== 'DELIVERED' && source.corrected_result !== 'NOT_DELIVERED') {
        invalid();
      }
      input.correctedResult = source.corrected_result as 'DELIVERED' | 'NOT_DELIVERED';
      input.body = text(source.reason, 1, NOTE_MAX_CODEPOINTS);
      input.historyReviewed = historyFlag(source.history_reviewed);
      break;
    case 'adjust-commission':
      if (source.direction !== 'REFUND_TO_SHIPPER' && source.direction !== 'CHARGE_TO_SHIPPER') {
        invalid();
      }
      input.direction = source.direction as 'REFUND_TO_SHIPPER' | 'CHARGE_TO_SHIPPER';
      if (typeof source.amount_vnd !== 'number' || !Number.isSafeInteger(source.amount_vnd) || source.amount_vnd < 1 || source.amount_vnd > 10_000_000) {
        invalid();
      }
      input.amountVnd = source.amount_vnd as number;
      input.body = text(source.reason, 1, NOTE_MAX_CODEPOINTS);
      input.historyReviewed = historyFlag(source.history_reviewed);
      break;
    case 'receive':
      break;
  }
  return input;
}

function historyFlag(value: unknown): boolean {
  return typeof value === 'boolean' ? value : invalid();
}
