import { describe, expect, it } from '@jest/globals';
import { Transport, TransportRequest, TransportResponse } from './api';
import { AdminFeedbackApi, createFeedbackSource, parseComplaintDetail, parseComplaintRow, parseReviewDetail, parseReviewRow } from './feedback-api';
import { ComplaintQuery, NOT_WIRED_FEEDBACK, ReviewQuery } from './feedback';
import { canOpenRoute, grantsFromPermissions, visibleMenu } from './menu';
import { formatRoute, parseRoute } from './routes';

const ID = '11111111-1111-4111-8111-111111111111';
const reply = (status: number, body: unknown): TransportResponse => ({ status, header: () => null, json: () => Promise.resolve(body) });
const errorBody = (code: string) => ({ error: { code, message: 'x', request_id: 'r', details: {} } });
const AT = '2026-10-18T09:00:00.000Z';

const review = (over: Record<string, unknown> = {}) => ({
  review_id: ID, kind: 'SHOP_BY_CUSTOMER', stars: 1, comment: 'Tệ', visibility: 'VISIBLE', shop: { shop_id: ID, name: 'Ốc 11' }, shipper: null, related_code: '#110168', has_reply: false, created_at: AT, version: 1, ...over,
});
const reviewDetail = (over: Record<string, unknown> = {}) => ({
  ...review(), reviewer_name: 'Lê Thu Hà', delivery: null, reply: null, reply_history: [], moderations: [], complaints: [], can: ['hide'], ...over,
});
const complaintRow = (over: Record<string, unknown> = {}) => ({
  complaint_id: ID, code: 'PA00128', summary: 'Chưa nhận được hàng', category: 'GOODS', status: 'PENDING', submitter_role: 'CUSTOMER', related_code: '#110168', shop: { shop_id: ID, name: 'Ốc 11' }, shipper: null,
  assigned_to: null, reconsideration_pending: false, created_at: AT, updated_at: AT, ...over,
});
const complaintDetail = (over: Record<string, unknown> = {}) => ({
  complaint: {
    complaint_id: ID, code: 'PA00128', category: 'GOODS', status: 'IN_PROGRESS', awaiting_from: null, submitter_role: 'SHOP', body: 'Hàng chưa về quán', conclusion: null, close_reason: null, related_code: 'G-1',
    shop: { shop_id: ID, name: 'Ốc 11' }, shipper: { driver_id: ID, name: 'Shipper A', code: 'SP1' }, assigned_to: { user_id: ID, name: 'Trần Minh' }, received_at: AT, created_at: AT, updated_at: AT, closed_at: null, closure_no: 0, version: 3,
    reconsideration_open: false,
  },
  messages: [{ message_id: ID, seq: 1, kind: 'SUBMITTED', visibility: 'SUBMITTER', audience_role: null, author_type: 'SUBMITTER', author_user_id: ID, body: 'Hàng chưa về quán', created_at: AT, attachments: [{ attachment_id: ID, content_type: 'image/png', byte_size: 70 }] }],
  reconsiderations: [], order: null, delivery: null, chain: [{ delivery_id: ID, code: 'G-1', state: 'failed', previous_delivery_id: null, created_at: AT }], review: null, adjustments: [],
  finance: { allowed: false, integrated: false }, can: ['note', 'conclude'], ...over,
});
const rq: ReviewQuery = { kind: 'ALL', stars: 1, visibility: 'HIDDEN', query: ' #11 ', from: '', to: '', shop: '', shipper: '', page: 2 };
const cq: ComplaintQuery = { query: ' PA0 ', status: 'PENDING', category: 'ALL', submitterRole: 'ALL', shop: '', shipper: '', assignee: 'ME', from: '', to: '', page: 1 };

function scripted(...answers: (TransportResponse | 'throw')[]): { transport: Transport; requests: TransportRequest[] } {
  const requests: TransportRequest[] = [];
  const queue = [...answers];
  const transport: Transport = (request) => {
    requests.push(request);
    const next = queue.shift();
    return next === 'throw' || next === undefined ? Promise.reject(new Error('down')) : Promise.resolve(next);
  };
  return { transport, requests };
}
const session = (csrf: string | null = 'csrf-1') => {
  let refreshed = 0;
  return { port: { csrf: () => csrf ?? undefined, refresh: () => { refreshed += 1; return Promise.resolve(true); } }, refreshed: () => refreshed };
};

describe('admin web Feedback - parsers', () => {
  it('maps a rating, its detail, a complaint line and a complaint detail', () => {
    expect(parseReviewRow(review())).toMatchObject({ id: ID, stars: 1, visibility: 'VISIBLE', shopName: 'Ốc 11', hasReply: false });
    expect(parseReviewDetail(reviewDetail({ reply: { body: 'Cảm ơn', version: 2, updated_at: AT } }))?.reply).toEqual({ body: 'Cảm ơn', version: 2, updatedAt: AT });
    expect([...(parseReviewDetail(reviewDetail())?.can ?? [])]).toEqual(['hide']);
    expect(parseComplaintRow(complaintRow())).toMatchObject({ code: 'PA00128', status: 'PENDING', submitterRole: 'CUSTOMER', assignedTo: null });
    const parsed = parseComplaintDetail(complaintDetail());
    expect(parsed).toMatchObject({ code: 'PA00128', status: 'IN_PROGRESS', version: 3, financeAllowed: false, assignee: { name: 'Trần Minh' } });
    expect(parsed?.thread[0]?.attachments).toEqual([{ id: ID, contentType: 'image/png', byteSize: 70 }]);
    expect([...(parsed?.can ?? [])]).toEqual(['note', 'conclude']);
  });

  it('refuses anything that is not exactly the documented shape (never half-shown data)', () => {
    for (const bad of [{ stars: 'x' }, { kind: 'OTHER' }, { visibility: 'GONE' }, { review_id: 'x' }, { created_at: 'yesterday' }, { shop: null }]) {
      expect(parseReviewRow(review(bad))).toBeUndefined();
    }
    for (const bad of [{ can: ['edit'] }, { moderations: [{ action: 'DELETE' }] }, { reply: { body: 1 } }]) {
      expect(parseReviewDetail(reviewDetail(bad))).toBeUndefined();
    }
    for (const bad of [{ status: 'DONE' }, { category: 'X' }, { submitter_role: 'ADMIN' }, { reconsideration_pending: 'no' }]) {
      expect(parseComplaintRow(complaintRow(bad))).toBeUndefined();
    }
    for (const bad of [{ can: ['set-status'] }, { messages: 'x' }, { finance: {} }, { adjustments: [{ kind: 'X' }] }]) {
      expect(parseComplaintDetail(complaintDetail(bad))).toBeUndefined();
    }
  });
});

describe('admin web Feedback - source', () => {
  it('reads the lists with the filters in the query string and 20 per page', async () => {
    const reviews = scripted(reply(200, { data: { items: [review()], total: 21, counters: { total: 21, hidden: 2, low: 4 } } }));
    expect(await createFeedbackSource(new AdminFeedbackApi(reviews.transport)).listReviews(rq)).toMatchObject({ kind: 'ready', total: 21, counters: { hidden: 2, low: 4 } });
    expect(reviews.requests[0]).toMatchObject({ method: 'GET', path: '/admin/reviews?stars=1&visibility=HIDDEN&q=%2311&limit=20&offset=20' });
    const complaints = scripted(reply(200, { data: { items: [complaintRow()], total: 1, counters: { pending: 1, in_progress: 2, awaiting_info: 3, reconsiderations: 4 } } }));
    expect(await createFeedbackSource(new AdminFeedbackApi(complaints.transport)).listComplaints(cq)).toMatchObject({ kind: 'ready', counters: { pending: 1, inProgress: 2, awaitingInfo: 3, reconsiderations: 4 } });
    expect(complaints.requests[0]).toMatchObject({ method: 'GET', path: '/admin/complaints?q=PA0&status=PENDING&assignee=ME&limit=20&offset=0' });
  });

  it('maps failures: lost answer is offline, 401 expired, 403 forbidden, 404 not found', async () => {
    const run = (answer: TransportResponse | 'throw') => createFeedbackSource(new AdminFeedbackApi(scripted(answer).transport)).complaintDetail(ID);
    expect(await run(reply(404, errorBody('COMPLAINT_NOT_FOUND')))).toEqual({ kind: 'not-found' });
    expect(await run(reply(401, errorBody('ADMIN_SESSION_INVALID')))).toMatchObject({ kind: 'failed', failure: 'session-expired' });
    expect(await run(reply(403, errorBody('ADMIN_FORBIDDEN')))).toMatchObject({ kind: 'failed', failure: 'forbidden' });
    expect(await run('throw')).toMatchObject({ kind: 'failed' });
  });

  it('a rating action sends the version, the reason and its own key, once; there is no way to send stars or text', async () => {
    const { transport, requests } = scripted(reply(200, { data: reviewDetail({ visibility: 'HIDDEN', can: ['restore'] }) }));
    const source = createFeedbackSource(new AdminFeedbackApi(transport), session().port);
    expect(await source.reviewAction({ id: ID, name: 'hide', version: 1, reasonCode: 'OTHER', reasonNote: 'Nhầm đơn', key: 'k-1' })).toEqual({ kind: 'ok' });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: 'POST', path: `/admin/reviews/${ID}/actions/hide`, csrf: 'csrf-1', idempotencyKey: 'k-1' });
    expect(requests[0]?.body).toEqual({ expected_version: 1, reason_code: 'OTHER', reason_note: 'Nhầm đơn' });
  });

  it('each complaint action sends only its own fields', async () => {
    const run = async (request: Parameters<ReturnType<typeof createFeedbackSource>['complaintAction']>[0]) => {
      const { transport, requests } = scripted(reply(200, { data: complaintDetail() }));
      await createFeedbackSource(new AdminFeedbackApi(transport), session().port).complaintAction(request);
      return requests[0];
    };
    const base = { id: ID, version: 3, key: 'k' };
    expect((await run({ ...base, name: 'receive' }))?.body).toEqual({ expected_version: 3 });
    expect((await run({ ...base, name: 'assign', assigneeId: ID }))?.body).toEqual({ expected_version: 3, assignee_user_id: ID });
    expect((await run({ ...base, name: 'note', body: 'ghi' }))?.body).toEqual({ expected_version: 3, body: 'ghi' });
    expect((await run({ ...base, name: 'request-info', from: 'SHIPPER', body: 'giải trình' }))?.body).toEqual({ expected_version: 3, from: 'SHIPPER', body: 'giải trình' });
    expect((await run({ ...base, name: 'conclude', body: 'xong' }))?.body).toEqual({ expected_version: 3, conclusion: 'xong' });
    expect((await run({ ...base, name: 'close', body: 'trùng' }))?.body).toEqual({ expected_version: 3, reason: 'trùng' });
    expect((await run({ ...base, name: 'decide-reconsideration', decision: 'REOPEN', body: 'ok' }))?.body).toEqual({ expected_version: 3, decision: 'REOPEN', reason: 'ok' });
    expect((await run({ ...base, name: 'adjust-result', correctedResult: 'NOT_DELIVERED', body: 'lý do', historyReviewed: true }))?.body).toEqual({ expected_version: 3, corrected_result: 'NOT_DELIVERED', reason: 'lý do', history_reviewed: true });
    expect((await run({ ...base, name: 'adjust-commission', direction: 'REFUND_TO_SHIPPER', amountVnd: 1000, body: 'hoàn' }))?.body).toEqual({ expected_version: 3, direction: 'REFUND_TO_SHIPPER', amount_vnd: 1000, reason: 'hoàn', history_reviewed: false });
  });

  it('classifies the action outcomes: conflict, refused, forbidden, unknown (answer lost or 5xx), not wired, expired session', async () => {
    const act = (source: ReturnType<typeof createFeedbackSource>) => source.complaintAction({ id: ID, name: 'receive', version: 1, key: 'k' });
    const run = async (...answers: (TransportResponse | 'throw')[]) => act(createFeedbackSource(new AdminFeedbackApi(scripted(...answers).transport), session().port));
    expect(await run(reply(409, errorBody('VERSION_CONFLICT')))).toEqual({ kind: 'conflict' });
    expect(await run(reply(409, errorBody('COMPLAINT_STATE_CONFLICT')))).toEqual({ kind: 'conflict' });
    expect(await run(reply(409, errorBody('ADJUSTMENT_HISTORY_REVIEW_REQUIRED')))).toEqual({ kind: 'refused', code: 'ADJUSTMENT_HISTORY_REVIEW_REQUIRED' });
    expect(await run(reply(403, errorBody('ADMIN_FORBIDDEN')))).toEqual({ kind: 'forbidden' });
    expect(await run('throw')).toEqual({ kind: 'unknown' });
    expect(await run(reply(503, errorBody('TRANSACTION_OUTCOME_UNKNOWN')))).toEqual({ kind: 'unknown' });
    expect(await run(reply(400, errorBody('SOMETHING_NEW')))).toEqual({ kind: 'refused', code: 'ADMIN_INPUT_INVALID' });
    expect(await act(createFeedbackSource(new AdminFeedbackApi(scripted().transport)))).toEqual({ kind: 'not-wired' });
    expect(await act(createFeedbackSource(new AdminFeedbackApi(scripted().transport), session(null).port))).toEqual({ kind: 'session-expired' });
  });

  it('a stale CSRF token is refreshed and the same key is offered again (unknown, nothing ran)', async () => {
    const s = session();
    const source = createFeedbackSource(new AdminFeedbackApi(scripted(reply(403, errorBody('ADMIN_CSRF_INVALID'))).transport), s.port);
    expect(await source.complaintAction({ id: ID, name: 'receive', version: 1, key: 'k' })).toEqual({ kind: 'unknown' });
    expect(s.refreshed()).toBe(1);
  });

  it('by default nothing is wired and nothing is shown; the picture path stays on the same origin', async () => {
    expect(await NOT_WIRED_FEEDBACK.listReviews(rq)).toMatchObject({ kind: 'not-wired' });
    expect(await NOT_WIRED_FEEDBACK.complaintDetail(ID)).toMatchObject({ kind: 'not-wired' });
    expect(await NOT_WIRED_FEEDBACK.complaintAction({ id: ID, name: 'receive', version: 1, key: 'k' })).toEqual({ kind: 'not-wired' });
    expect(createFeedbackSource(new AdminFeedbackApi(scripted().transport)).pictureUrl(ID, ID)).toBe(`/v1/admin/complaints/${ID}/attachments/${ID}`);
  });
});

describe('admin web Feedback - routes and menu', () => {
  it('has its own routes and menu entries, visible only with the feedback grant (SYSTEM sees them)', () => {
    expect(parseRoute('/operations/reviews')).toEqual({ name: 'reviews' });
    expect(parseRoute('/operations/complaints')).toEqual({ name: 'complaints' });
    expect(formatRoute({ name: 'reviews' })).toBe('/operations/reviews');
    expect(formatRoute({ name: 'complaints' })).toBe('/operations/complaints');
    const labels = (groups: ReturnType<typeof visibleMenu>) => groups.flatMap((g) => g.items.map((i) => i.label));
    expect(labels(visibleMenu('SYSTEM', new Set()))).toEqual(expect.arrayContaining(['Đánh giá', 'Phản ánh']));
    expect(labels(visibleMenu('ADMIN', new Set()))).not.toContain('Đánh giá');
    const grants = grantsFromPermissions([{ app: 'SHOP', canView: true, canReviewProfile: false, canLock: false }]);
    expect(labels(visibleMenu('ADMIN', grants))).toEqual(expect.arrayContaining(['Đánh giá', 'Phản ánh']));
    expect(canOpenRoute('ADMIN', new Set(), { name: 'complaints' })).toBe(false);
    expect(canOpenRoute('ADMIN', grants, { name: 'complaints' })).toBe(true);
  });
});
