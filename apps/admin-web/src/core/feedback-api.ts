// HTTP client of M11.03 (Administration web): GET /v1/admin/reviews, /v1/admin/complaints (+ detail, handlers, evidence pictures) and one POST per action.
// Cookie-only (HttpOnly session, same origin); the CSRF token is passed in from memory. Every answer is parsed strictly: a body that does not have the
// documented shape is "unknown", never half-shown data. Nothing is stored here.

import { CsrfPort, failureOf } from './accounts-api.js';
import { ApiClient, ApiResult, record, str } from './api.js';
import {
  ActionResult,
  AdjustmentRecord,
  COMPLAINT_ACTIONS,
  COMPLAINT_CATEGORIES,
  COMPLAINT_STATUSES,
  ComplaintActionName,
  ComplaintActionRequest,
  ComplaintCategory,
  ComplaintCounters,
  ComplaintDetail,
  ComplaintDetailRead,
  ComplaintListRead,
  ComplaintQuery,
  ComplaintRow,
  ComplaintStatus,
  DeliveryHistoryLine,
  FEEDBACK_PAGE_SIZE,
  FeedbackSource,
  HandlersRead,
  ModerationRecord,
  RelatedDelivery,
  ReviewActionRequest,
  ReviewCounters,
  ReviewDetail,
  ReviewDetailRead,
  ReviewKind,
  ReviewListRead,
  ReviewQuery,
  ReviewRow,
  SubmitterRole,
  ThreadLine,
} from './feedback.js';

export const FEEDBACK_BASE = '/v1';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES: readonly string[] = ['CUSTOMER', 'SHOP', 'SHIPPER'];
const KINDS: readonly string[] = ['SHOP_BY_CUSTOMER', 'SHIPPER_BY_CUSTOMER', 'SHIPPER_BY_SHOP'];
const whole = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const iso = (value: unknown): string | undefined => {
  const text = str(value);
  return text !== undefined && !Number.isNaN(Date.parse(text)) ? text : undefined;
};
const nullableStr = (value: unknown): string | null | undefined => (value === null ? null : str(value));
const nullableIso = (value: unknown): string | null | undefined => (value === null ? null : iso(value));
const nullableWhole = (value: unknown): number | null | undefined => (value === null ? null : whole(value) ? value : undefined);
const uuid = (value: unknown): string | undefined => {
  const text = str(value);
  return text !== undefined && UUID_RE.test(text) ? text : undefined;
};

// ---- reviews ---------------------------------------------------------------------------------------------------------------------

export function parseReviewRow(value: unknown): ReviewRow | undefined {
  const raw = record(value);
  const shop = record(raw?.shop);
  const shipper = raw?.shipper === null ? null : record(raw?.shipper);
  const id = uuid(raw?.review_id);
  const comment = nullableStr(raw?.comment);
  const createdAt = iso(raw?.created_at);
  const relatedCode = str(raw?.related_code);
  if (
    raw === undefined || shop === undefined || shipper === undefined || id === undefined || comment === undefined || createdAt === undefined || relatedCode === undefined ||
    typeof raw.kind !== 'string' || !KINDS.includes(raw.kind) || !whole(raw.stars) || (raw.visibility !== 'VISIBLE' && raw.visibility !== 'HIDDEN') || typeof raw.has_reply !== 'boolean' || !whole(raw.version)
  ) {
    return undefined;
  }
  const shopName = str(shop.name);
  const shipperName = shipper === null ? null : nullableStr(shipper.name);
  if (shopName === undefined || shipperName === undefined) {
    return undefined;
  }
  return { id, kind: raw.kind as ReviewKind, stars: raw.stars, comment, visibility: raw.visibility, shopName, shipperName, relatedCode, hasReply: raw.has_reply, createdAt, version: raw.version };
}

function parseModeration(value: unknown): ModerationRecord | undefined {
  const raw = record(value);
  const at = iso(raw?.at);
  const note = nullableStr(raw?.reason_note);
  const code = str(raw?.reason_code);
  if (raw === undefined || at === undefined || note === undefined || code === undefined || (raw.action !== 'HIDE' && raw.action !== 'RESTORE')) {
    return undefined;
  }
  return { action: raw.action, reasonCode: code, reasonNote: note, at };
}

export function parseReviewDetail(data: Record<string, unknown>): ReviewDetail | undefined {
  const base = parseReviewRow(data);
  const reviewer = str(data.reviewer_name);
  const delivery = data.delivery === null ? null : record(data.delivery);
  const reply = data.reply === null ? null : record(data.reply);
  if (base === undefined || reviewer === undefined || delivery === undefined || reply === undefined || !Array.isArray(data.reply_history) || !Array.isArray(data.moderations) || !Array.isArray(data.complaints) || !Array.isArray(data.can)) {
    return undefined;
  }
  const history: ReviewDetail['replyHistory'][number][] = [];
  for (const entry of data.reply_history) {
    const raw = record(entry);
    const body = str(raw?.body);
    const writtenAt = iso(raw?.written_at);
    if (raw === undefined || body === undefined || writtenAt === undefined || !whole(raw.version)) {
      return undefined;
    }
    history.push({ version: raw.version, body, writtenAt });
  }
  const moderations: ModerationRecord[] = [];
  for (const entry of data.moderations) {
    const parsed = parseModeration(entry);
    if (parsed === undefined) {
      return undefined;
    }
    moderations.push(parsed);
  }
  const complaints: ReviewDetail['complaints'][number][] = [];
  for (const entry of data.complaints) {
    const raw = record(entry);
    const id = uuid(raw?.complaint_id);
    const code = str(raw?.code);
    if (raw === undefined || id === undefined || code === undefined || typeof raw.status !== 'string' || !(COMPLAINT_STATUSES as readonly string[]).includes(raw.status)) {
      return undefined;
    }
    complaints.push({ id, code, status: raw.status as ComplaintStatus });
  }
  const can = new Set<'hide' | 'restore'>();
  for (const entry of data.can) {
    if (entry !== 'hide' && entry !== 'restore') {
      return undefined;
    }
    can.add(entry);
  }
  const replyBody = reply === null ? undefined : str(reply.body);
  const replyUpdated = reply === null ? undefined : iso(reply.updated_at);
  if (reply !== null && (replyBody === undefined || replyUpdated === undefined || !whole(reply.version))) {
    return undefined;
  }
  return {
    ...base,
    reviewerName: reviewer,
    deliveryCode: delivery === null ? null : (str(delivery.code) ?? null),
    deliveryState: delivery === null ? null : (str(delivery.state) ?? null),
    reply: reply === null ? null : { body: replyBody as string, version: reply.version as number, updatedAt: replyUpdated as string },
    replyHistory: history,
    moderations,
    complaints,
    can,
  };
}

// ---- complaints ------------------------------------------------------------------------------------------------------------------

export function parseComplaintRow(value: unknown): ComplaintRow | undefined {
  const raw = record(value);
  const shop = record(raw?.shop);
  const shipper = raw?.shipper === null ? null : record(raw?.shipper);
  const id = uuid(raw?.complaint_id);
  const code = str(raw?.code);
  const summary = str(raw?.summary);
  const related = str(raw?.related_code);
  const assigned = nullableStr(raw?.assigned_to);
  const createdAt = iso(raw?.created_at);
  if (
    raw === undefined || shop === undefined || shipper === undefined || id === undefined || code === undefined || summary === undefined || related === undefined || assigned === undefined || createdAt === undefined ||
    typeof raw.category !== 'string' || !(COMPLAINT_CATEGORIES as readonly string[]).includes(raw.category) || typeof raw.status !== 'string' || !(COMPLAINT_STATUSES as readonly string[]).includes(raw.status) ||
    typeof raw.submitter_role !== 'string' || !ROLES.includes(raw.submitter_role) || typeof raw.reconsideration_pending !== 'boolean'
  ) {
    return undefined;
  }
  const shopName = str(shop.name);
  const shipperName = shipper === null ? null : nullableStr(shipper.name);
  if (shopName === undefined || shipperName === undefined) {
    return undefined;
  }
  return {
    id, code, summary, category: raw.category as ComplaintCategory, status: raw.status as ComplaintStatus, submitterRole: raw.submitter_role as SubmitterRole, relatedCode: related, shopName, shipperName,
    assignedTo: assigned, reconsiderationPending: raw.reconsideration_pending, createdAt,
  };
}

function parseThread(value: unknown): ThreadLine | undefined {
  const raw = record(value);
  const id = uuid(raw?.message_id);
  const body = nullableStr(raw?.body);
  const createdAt = iso(raw?.created_at);
  const audience = nullableStr(raw?.audience_role);
  if (raw === undefined || id === undefined || body === undefined || createdAt === undefined || audience === undefined || typeof raw.kind !== 'string' || typeof raw.visibility !== 'string' || typeof raw.author_type !== 'string' || !Array.isArray(raw.attachments)) {
    return undefined;
  }
  const attachments: ThreadLine['attachments'][number][] = [];
  for (const entry of raw.attachments) {
    const a = record(entry);
    const attachmentId = uuid(a?.attachment_id);
    if (a === undefined || attachmentId === undefined || typeof a.content_type !== 'string' || !whole(a.byte_size)) {
      return undefined;
    }
    attachments.push({ id: attachmentId, contentType: a.content_type, byteSize: a.byte_size });
  }
  return { id, kind: raw.kind, visibility: raw.visibility, audienceRole: audience, authorType: raw.author_type, body, createdAt, attachments };
}

function parseAdjustment(value: unknown): AdjustmentRecord | undefined {
  const raw = record(value);
  const createdAt = iso(raw?.created_at);
  const reason = str(raw?.reason);
  const amount = nullableWhole(raw?.amount_vnd);
  const pending = nullableStr(raw?.pending_reason);
  const originalAssignment = nullableStr(raw?.original_assignment_status);
  if (
    raw === undefined || createdAt === undefined || reason === undefined || amount === undefined || pending === undefined || originalAssignment === undefined || (raw.kind !== 'DELIVERY_RESULT' && raw.kind !== 'COMMISSION') ||
    typeof raw.original_state !== 'string' || (raw.status !== 'RECORDED' && raw.status !== 'PENDING_FINANCE' && raw.status !== 'EXECUTED') || typeof raw.history_reviewed !== 'boolean' || !Array.isArray(raw.successor_delivery_ids)
  ) {
    return undefined;
  }
  const corrected = raw.corrected_result === 'DELIVERED' || raw.corrected_result === 'NOT_DELIVERED' ? raw.corrected_result : null;
  const direction = raw.direction === 'REFUND_TO_SHIPPER' || raw.direction === 'CHARGE_TO_SHIPPER' ? raw.direction : null;
  return {
    kind: raw.kind, originalState: raw.original_state, originalAssignmentStatus: originalAssignment, correctedResult: corrected, direction, amountVnd: amount, status: raw.status, pendingReason: pending,
    historyReviewed: raw.history_reviewed, successorCount: raw.successor_delivery_ids.length, reason, createdAt,
  };
}

function parseDelivery(value: unknown): RelatedDelivery | null | undefined {
  if (value === null) {
    return null;
  }
  const raw = record(value);
  const shipper = raw?.shipper === null ? null : record(raw?.shipper);
  const fee = record(raw?.fee);
  const incident = raw?.incident === null ? null : record(raw?.incident);
  if (raw === undefined || shipper === undefined || fee === undefined || incident === undefined || typeof raw.code !== 'string' || typeof raw.state !== 'string' || !Array.isArray(raw.assignments) || !Array.isArray(raw.timeline)) {
    return undefined;
  }
  const feeVnd = nullableWhole(fee.amount_vnd);
  if (feeVnd === undefined) {
    return undefined;
  }
  const assignments: RelatedDelivery['assignments'][number][] = [];
  for (const entry of raw.assignments) {
    const a = record(entry);
    const name = str(a?.shipper_name);
    const status = str(a?.status);
    const acceptedAt = iso(a?.accepted_at);
    const endedAt = nullableIso(a?.ended_at);
    if (a === undefined || name === undefined || status === undefined || acceptedAt === undefined || endedAt === undefined) {
      return undefined;
    }
    assignments.push({ shipperName: name, status, acceptedAt, endedAt });
  }
  const timeline: DeliveryHistoryLine[] = [];
  for (const entry of raw.timeline) {
    const t = record(entry);
    const at = iso(t?.at);
    const note = nullableStr(t?.note);
    if (t === undefined || at === undefined || note === undefined || typeof t.type !== 'string' || typeof t.actor !== 'string') {
      return undefined;
    }
    timeline.push({ at, type: t.type, actor: t.actor, note });
  }
  return {
    code: raw.code, state: raw.state, shipperName: shipper === null ? null : (str(shipper.name) ?? null), feeVnd, custody: incident === null ? null : (str(incident.custody) ?? null),
    incidentStatus: incident === null ? null : (str(incident.status) ?? null), assignments, timeline,
  };
}

export function parseComplaintDetail(data: Record<string, unknown>): ComplaintDetail | undefined {
  const c = record(data.complaint);
  const shop = record(c?.shop);
  const shipper = c?.shipper === null ? null : record(c?.shipper);
  const assignee = c?.assigned_to === null ? null : record(c?.assigned_to);
  const delivery = parseDelivery(data.delivery);
  const review = data.review === null ? null : record(data.review);
  const finance = record(data.finance);
  const id = uuid(c?.complaint_id);
  const createdAt = iso(c?.created_at);
  const updatedAt = iso(c?.updated_at);
  const closedAt = nullableIso(c?.closed_at);
  const conclusion = nullableStr(c?.conclusion);
  const closeReason = nullableStr(c?.close_reason);
  const awaiting = nullableStr(c?.awaiting_from);
  if (
    c === undefined || shop === undefined || shipper === undefined || assignee === undefined || delivery === undefined || review === undefined || finance === undefined || id === undefined || createdAt === undefined || updatedAt === undefined ||
    closedAt === undefined || conclusion === undefined || closeReason === undefined || awaiting === undefined || typeof c.code !== 'string' || typeof c.body !== 'string' || typeof c.related_code !== 'string' ||
    typeof c.category !== 'string' || !(COMPLAINT_CATEGORIES as readonly string[]).includes(c.category) || typeof c.status !== 'string' || !(COMPLAINT_STATUSES as readonly string[]).includes(c.status) ||
    typeof c.submitter_role !== 'string' || !ROLES.includes(c.submitter_role) || !whole(c.version) || !Array.isArray(data.messages) || !Array.isArray(data.reconsiderations) || !Array.isArray(data.chain) ||
    !Array.isArray(data.adjustments) || !Array.isArray(data.can) || typeof finance.allowed !== 'boolean'
  ) {
    return undefined;
  }
  const thread: ThreadLine[] = [];
  for (const entry of data.messages) {
    const parsed = parseThread(entry);
    if (parsed === undefined) {
      return undefined;
    }
    thread.push(parsed);
  }
  const reconsiderations: ComplaintDetail['reconsiderations'][number][] = [];
  for (const entry of data.reconsiderations) {
    const r = record(entry);
    const requestedAt = iso(r?.requested_at);
    const reason = str(r?.reason);
    const decision = nullableStr(r?.decision_reason);
    if (r === undefined || requestedAt === undefined || reason === undefined || decision === undefined || typeof r.status !== 'string') {
      return undefined;
    }
    reconsiderations.push({ requestedAt, reason, status: r.status, decisionReason: decision });
  }
  const chain: ComplaintDetail['chain'][number][] = [];
  for (const entry of data.chain) {
    const d = record(entry);
    if (d === undefined || typeof d.code !== 'string' || typeof d.state !== 'string') {
      return undefined;
    }
    chain.push({ code: d.code, state: d.state });
  }
  const adjustments: AdjustmentRecord[] = [];
  for (const entry of data.adjustments) {
    const parsed = parseAdjustment(entry);
    if (parsed === undefined) {
      return undefined;
    }
    adjustments.push(parsed);
  }
  const can = new Set<ComplaintActionName>();
  for (const entry of data.can) {
    if (typeof entry !== 'string' || !(COMPLAINT_ACTIONS as readonly string[]).includes(entry)) {
      return undefined;
    }
    can.add(entry as ComplaintActionName);
  }
  const reviewComment = review === null ? null : nullableStr(review.comment);
  if (review !== null && (reviewComment === undefined || !whole(review.stars) || typeof review.source !== 'string' || typeof review.visibility !== 'string')) {
    return undefined;
  }
  const shopName = str(shop.name);
  const assigneeId = assignee === null ? null : uuid(assignee.user_id);
  const assigneeName = assignee === null ? null : str(assignee.name);
  if (shopName === undefined || (assignee !== null && (assigneeId === undefined || assigneeName === undefined))) {
    return undefined;
  }
  return {
    id, code: c.code, category: c.category as ComplaintCategory, status: c.status as ComplaintStatus, awaitingFrom: awaiting, submitterRole: c.submitter_role as SubmitterRole, body: c.body, conclusion, closeReason,
    relatedCode: c.related_code, shopName, shipperName: shipper === null ? null : (nullableStr(shipper.name) ?? null), assignee: assignee === null ? null : { id: assigneeId as string, name: assigneeName as string },
    createdAt, updatedAt, closedAt, version: c.version, thread, reconsiderations, delivery, chain,
    review: review === null ? null : { stars: review.stars as number, comment: reviewComment as string | null, source: review.source as string, visibility: review.visibility as string },
    adjustments, financeAllowed: finance.allowed, can,
  };
}

// ---- client ----------------------------------------------------------------------------------------------------------------------

function query(params: Readonly<Record<string, string | undefined>>): string {
  const parts = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value as string)}`);
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

function parseReviewPage(data: Record<string, unknown>): { rows: ReviewRow[]; total: number; counters: ReviewCounters } | undefined {
  const counters = record(data.counters);
  if (!Array.isArray(data.items) || !whole(data.total) || counters === undefined || !whole(counters.total) || !whole(counters.hidden) || !whole(counters.low)) {
    return undefined;
  }
  const rows: ReviewRow[] = [];
  for (const entry of data.items) {
    const row = parseReviewRow(entry);
    if (row === undefined) {
      return undefined;
    }
    rows.push(row);
  }
  return { rows, total: data.total, counters: { total: counters.total, hidden: counters.hidden, low: counters.low } };
}

function parseComplaintPage(data: Record<string, unknown>): { rows: ComplaintRow[]; total: number; counters: ComplaintCounters } | undefined {
  const counters = record(data.counters);
  if (!Array.isArray(data.items) || !whole(data.total) || counters === undefined || !whole(counters.pending) || !whole(counters.in_progress) || !whole(counters.awaiting_info) || !whole(counters.reconsiderations)) {
    return undefined;
  }
  const rows: ComplaintRow[] = [];
  for (const entry of data.items) {
    const row = parseComplaintRow(entry);
    if (row === undefined) {
      return undefined;
    }
    rows.push(row);
  }
  return { rows, total: data.total, counters: { pending: counters.pending, inProgress: counters.in_progress, awaitingInfo: counters.awaiting_info, reconsiderations: counters.reconsiderations } };
}

function parseHandlers(data: Record<string, unknown>): { id: string; name: string }[] | undefined {
  if (!Array.isArray(data.handlers)) {
    return undefined;
  }
  const out: { id: string; name: string }[] = [];
  for (const entry of data.handlers) {
    const raw = record(entry);
    const id = uuid(raw?.user_id);
    const name = str(raw?.name);
    if (id === undefined || name === undefined) {
      return undefined;
    }
    out.push({ id, name });
  }
  return out;
}

export class AdminFeedbackApi extends ApiClient {
  reviews(filter: ReviewQuery): Promise<ApiResult<ReturnType<typeof parseReviewPage> & object>> {
    const path = `/admin/reviews${query({
      kind: filter.kind === 'ALL' ? undefined : filter.kind,
      stars: filter.stars === 'ALL' ? undefined : String(filter.stars),
      visibility: filter.visibility === 'ALL' ? undefined : filter.visibility,
      q: filter.query.trim(),
      from: filter.from,
      to: filter.to,
      shop: filter.shop.trim(),
      shipper: filter.shipper.trim(),
      limit: String(FEEDBACK_PAGE_SIZE),
      offset: String((Math.max(filter.page, 1) - 1) * FEEDBACK_PAGE_SIZE),
    })}`;
    return this.call({ method: 'GET', path }, parseReviewPage) as Promise<ApiResult<ReturnType<typeof parseReviewPage> & object>>;
  }

  review(id: string): Promise<ApiResult<ReviewDetail>> {
    return this.call({ method: 'GET', path: `/admin/reviews/${encodeURIComponent(id)}` }, parseReviewDetail);
  }

  reviewAction(csrf: string, request: ReviewActionRequest): Promise<ApiResult<ReviewDetail>> {
    const body: Record<string, unknown> = { expected_version: request.version, reason_code: request.reasonCode };
    if (request.reasonNote !== null) {
      body.reason_note = request.reasonNote;
    }
    return this.call({ method: 'POST', path: `/admin/reviews/${encodeURIComponent(request.id)}/actions/${request.name}`, body, csrf, idempotencyKey: request.key }, parseReviewDetail);
  }

  complaints(filter: ComplaintQuery): Promise<ApiResult<ReturnType<typeof parseComplaintPage> & object>> {
    const path = `/admin/complaints${query({
      q: filter.query.trim(),
      status: filter.status === 'ALL' ? undefined : filter.status,
      category: filter.category === 'ALL' ? undefined : filter.category,
      submitter_role: filter.submitterRole === 'ALL' ? undefined : filter.submitterRole,
      shop: filter.shop.trim(),
      shipper: filter.shipper.trim(),
      assignee: filter.assignee === 'ALL' ? undefined : filter.assignee,
      from: filter.from,
      to: filter.to,
      limit: String(FEEDBACK_PAGE_SIZE),
      offset: String((Math.max(filter.page, 1) - 1) * FEEDBACK_PAGE_SIZE),
    })}`;
    return this.call({ method: 'GET', path }, parseComplaintPage) as Promise<ApiResult<ReturnType<typeof parseComplaintPage> & object>>;
  }

  handlers(): Promise<ApiResult<{ id: string; name: string }[]>> {
    return this.call({ method: 'GET', path: '/admin/complaint-handlers' }, parseHandlers);
  }

  complaint(id: string): Promise<ApiResult<ComplaintDetail>> {
    return this.call({ method: 'GET', path: `/admin/complaints/${encodeURIComponent(id)}` }, parseComplaintDetail);
  }

  /** One request; the caller owns the key and never repeats the call by itself. */
  complaintAction(csrf: string, request: ComplaintActionRequest): Promise<ApiResult<ComplaintDetail>> {
    const body: Record<string, unknown> = { expected_version: request.version };
    switch (request.name) {
      case 'assign':
        body.assignee_user_id = request.assigneeId ?? null;
        break;
      case 'note':
        body.body = request.body;
        break;
      case 'request-info':
        body.from = request.from;
        body.body = request.body;
        break;
      case 'conclude':
        body.conclusion = request.body;
        break;
      case 'close':
        body.reason = request.body;
        break;
      case 'decide-reconsideration':
        body.decision = request.decision;
        body.reason = request.body;
        break;
      case 'adjust-result':
        body.corrected_result = request.correctedResult;
        body.reason = request.body;
        body.history_reviewed = request.historyReviewed === true;
        break;
      case 'adjust-commission':
        body.direction = request.direction;
        body.amount_vnd = request.amountVnd;
        body.reason = request.body;
        body.history_reviewed = request.historyReviewed === true;
        break;
      case 'receive':
        break;
    }
    return this.call({ method: 'POST', path: `/admin/complaints/${encodeURIComponent(request.id)}/actions/${request.name}`, body, csrf, idempotencyKey: request.key }, parseComplaintDetail);
  }
}

const REFUSALS: readonly string[] = ['REVIEW_NOT_FOUND', 'COMPLAINT_NOT_FOUND', 'COMPLAINT_STATE_CONFLICT', 'ADMIN_ACTION_NOT_ALLOWED', 'ADMIN_INPUT_INVALID', 'ADJUSTMENT_HISTORY_REVIEW_REQUIRED'];

async function resultOf(result: ApiResult<unknown>, session: CsrfPort): Promise<ActionResult> {
  if (result.kind === 'ok') {
    return { kind: 'ok' };
  }
  if (result.kind === 'network' || result.status >= 500) {
    return { kind: 'unknown' };
  }
  if (result.code === 'VERSION_CONFLICT' || result.code === 'COMPLAINT_STATE_CONFLICT') {
    return { kind: 'conflict' };
  }
  switch (result.code) {
    case 'ADMIN_CSRF_INVALID':
      await session.refresh();
      return { kind: 'unknown' };
    case 'ADMIN_SESSION_INVALID':
      return { kind: 'session-expired' };
    case 'ADMIN_FORBIDDEN':
      return { kind: 'forbidden' };
    case 'IDEMPOTENCY_BUSY':
      return { kind: 'unknown' };
    case 'ADMIN_AUTH_RATE_LIMITED':
      return { kind: 'rate-limited', ...(result.retryAfterSeconds === undefined ? {} : { retryAfterSec: result.retryAfterSeconds }) };
    default:
      return REFUSALS.includes(result.code) ? { kind: 'refused', code: result.code } : { kind: 'refused', code: 'ADMIN_INPUT_INVALID' };
  }
}

/** The real FeedbackSource. It keeps nothing: no rows, no versions, no keys. */
export function createFeedbackSource(api: AdminFeedbackApi, session?: CsrfPort): FeedbackSource {
  const act = async <T>(send: (csrf: string) => Promise<ApiResult<T>>): Promise<ActionResult> => {
    if (session === undefined) {
      return { kind: 'not-wired' };
    }
    const csrf = session.csrf();
    return csrf === undefined ? { kind: 'session-expired' } : resultOf(await send(csrf), session);
  };
  return {
    async listReviews(filter): Promise<ReviewListRead> {
      const result = await api.reviews(filter);
      return result.kind === 'ok' ? { kind: 'ready', rows: result.data.rows, total: result.data.total, counters: result.data.counters } : failureOf(result);
    },
    async reviewDetail(id): Promise<ReviewDetailRead> {
      const result = await api.review(id);
      if (result.kind === 'ok') {
        return { kind: 'ready', review: result.data };
      }
      return result.kind === 'error' && result.status === 404 ? { kind: 'not-found' } : failureOf(result);
    },
    reviewAction: (request) => act((csrf) => api.reviewAction(csrf, request)),
    async listComplaints(filter): Promise<ComplaintListRead> {
      const result = await api.complaints(filter);
      return result.kind === 'ok' ? { kind: 'ready', rows: result.data.rows, total: result.data.total, counters: result.data.counters } : failureOf(result);
    },
    async complaintDetail(id): Promise<ComplaintDetailRead> {
      const result = await api.complaint(id);
      if (result.kind === 'ok') {
        return { kind: 'ready', complaint: result.data };
      }
      return result.kind === 'error' && result.status === 404 ? { kind: 'not-found' } : failureOf(result);
    },
    async handlers(): Promise<HandlersRead> {
      const result = await api.handlers();
      return result.kind === 'ok' ? { kind: 'ready', handlers: result.data } : failureOf(result);
    },
    complaintAction: (request) => act((csrf) => api.complaintAction(csrf, request)),
    pictureUrl: (complaintId, attachmentId) => `${FEEDBACK_BASE}/admin/complaints/${encodeURIComponent(complaintId)}/attachments/${encodeURIComponent(attachmentId)}`,
  };
}
