import { describe, expect, it } from '@jest/globals';
import { ageText, QUEUE_KINDS, queueTarget, sourceProblemText } from './action-queue';
import { Transport, TransportRequest, TransportResponse } from './api';
import { NOT_WIRED_OVERVIEW } from './overview';
import { AdminOverviewApi, createOverviewSource, parseActionQueue } from './overview-api';
import { routeOfLink } from './routes';

const reply = (status: number, body: unknown): TransportResponse => ({ status, header: () => null, json: () => Promise.resolve(body) });
const ID = '5f0c7a52-3a6e-4a2c-9f2c-0b8f3d1a7e11';

const sources = (over: Record<string, unknown> = {}) =>
  QUEUE_KINDS.map((kind) => (over[kind] as Record<string, unknown> | undefined) ?? { kind, status: 'OK', count: 0, truncated: false });
const item = (over: Record<string, unknown> = {}) => ({
  key: `SHOP_PAYMENT_AWAITING_GRANT|shop-grant:${ID}`,
  kind: 'SHOP_PAYMENT_AWAITING_GRANT',
  code: 'Quán Hoa',
  status: 'CONFIRMED',
  reason: 'Đã xác nhận tiền, chờ cấp quyền mở rộng thực đơn',
  waiting_since: '2026-10-29T01:00:00.000Z',
  age_seconds: 3 * 3600 + 5 * 60,
  overdue: null,
  waiting_on: 'ADMIN',
  action: 'VIEW',
  link: { area: 'business-finance', query: { request: ID } },
  detail: { amount_vnd: 200000, confirmed_payments: 1 },
  ...over,
});
const body = (over: Record<string, unknown> = {}) => ({ generated_at: '2026-10-29T04:05:00.000Z', sources: sources(), total: 1, items: [item()], ...over });

function scripted(...answers: (TransportResponse | 'throw')[]): { transport: Transport; requests: TransportRequest[] } {
  const requests: TransportRequest[] = [];
  const queue = [...answers];
  return {
    requests,
    transport: (request) => {
      requests.push(request);
      const next = queue.shift();
      return next === 'throw' || next === undefined ? Promise.reject(new Error('down')) : Promise.resolve(next);
    },
  };
}

describe('Việc cần xử lý - parser', () => {
  it('reads a whole queue: one row per file, with its reason, age, link and the rights-dependent action', () => {
    const parsed = parseActionQueue(body());
    expect(parsed?.generatedAt).toBe('2026-10-29T04:05:00.000Z');
    expect(parsed?.sources).toHaveLength(QUEUE_KINDS.length);
    expect(parsed?.items[0]).toMatchObject({ kind: 'SHOP_PAYMENT_AWAITING_GRANT', status: 'CONFIRMED', action: 'VIEW', overdue: null, ageSeconds: 11100, link: { area: 'business-finance', query: { request: ID } } });
  });

  it('a source the administrator may not see, or that failed, stays FORBIDDEN / ERROR and is never an empty list or 0', () => {
    const parsed = parseActionQueue(body({ items: [], total: 0, sources: sources({ TOPUP_PENDING: { kind: 'TOPUP_PENDING', status: 'FORBIDDEN' }, GOODS_OPEN: { kind: 'GOODS_OPEN', status: 'ERROR' } }) }));
    const byKind = new Map(parsed?.sources.map((source) => [source.kind, source]));
    expect(byKind.get('TOPUP_PENDING')).toEqual({ kind: 'TOPUP_PENDING', status: 'FORBIDDEN' });
    expect(byKind.get('GOODS_OPEN')).toEqual({ kind: 'GOODS_OPEN', status: 'ERROR' });
    expect(byKind.get('TOPUP_PENDING')).not.toHaveProperty('count');
    expect(sourceProblemText('FORBIDDEN')).toBe('Bạn không có quyền xem mục này');
    expect(sourceProblemText('ERROR')).toBe('Không tải được mục này');
  });

  it('refuses a half-valid answer instead of showing part of it', () => {
    const bad: Array<Record<string, unknown>> = [
      body({ generated_at: 'today' }),
      body({ total: 2 }), // the count must be the rows sent
      body({ items: [item(), item()], total: 2 }), // the same file twice is not two files
      body({ items: [item({ kind: 'CHAT_MESSAGE' })] }),
      body({ items: [item({ link: { area: 'elsewhere', query: {} } })] }),
      body({ items: [item({ link: { area: 'shipper', query: { id: 3 } } })] }),
      body({ items: [item({ action: 'DELETE' })] }),
      body({ items: [item({ overdue: 'yes' })] }),
      body({ items: [item({ age_seconds: -1 })] }),
      body({ items: [item({ detail: { nested: { a: 1 } } })] }),
      body({ sources: sources().slice(1) }), // a kind is missing: the page would not know its state
      body({ sources: [...sources().slice(1), { kind: 'COMPLAINT', status: 'OK', count: 1, truncated: false }, ...sources().slice(0, 1)] }), // a kind twice
      body({ sources: sources({ COMPLAINT: { kind: 'COMPLAINT', status: 'OK', count: '3', truncated: false } }) }),
      body({ sources: sources({ COMPLAINT: { kind: 'COMPLAINT', status: 'OK', count: 3 } }) }),
    ];
    bad.forEach((answer, index) => expect([index, parseActionQueue(answer)]).toEqual([index, undefined]));
  });
});

describe('Việc cần xử lý - client and source', () => {
  it('asks only for the filters that are set, reads with GET only, and maps failures to their own wording', async () => {
    const calls = scripted(reply(200, { data: body() }), reply(200, { data: body() }), reply(401, { error: { code: 'ADMIN_SESSION_INVALID' } }), reply(403, { error: { code: 'ADMIN_FORBIDDEN' } }), 'throw', reply(200, { data: { generated_at: 1 } }));
    const source = createOverviewSource(new AdminOverviewApi(calls.transport));
    expect((await source.actionQueue({})).kind).toBe('ready');
    expect((await source.actionQueue({ kind: 'TOPUP_PENDING', status: 'PENDING', from: '2026-10-01', to: '2026-10-05', sort: 'newest' })).kind).toBe('ready');
    expect(calls.requests.map((request) => request.path)).toEqual(['/admin/overview/action-queue', '/admin/overview/action-queue?kind=TOPUP_PENDING&status=PENDING&from=2026-10-01&to=2026-10-05&sort=newest']);
    expect(calls.requests.every((request) => request.method === 'GET')).toBe(true);
    expect(await source.actionQueue({})).toEqual({ kind: 'failed', failure: 'session-expired' });
    expect(await source.actionQueue({})).toEqual({ kind: 'failed', failure: 'forbidden' });
    expect(await source.actionQueue({})).toEqual({ kind: 'failed', failure: 'offline' });
    expect((await source.actionQueue({})).kind).toBe('failed');
  });

  it('the default source is not wired and lists nothing', async () => {
    expect(await NOT_WIRED_OVERVIEW.actionQueue({})).toMatchObject({ kind: 'not-wired' });
  });
});

describe('Việc cần xử lý - what a row shows and opens', () => {
  it('prints the wait as its two largest units', () => {
    expect(ageText(0)).toBe('0 giây');
    expect(ageText(45)).toBe('45 giây');
    expect(ageText(60)).toBe('1 phút');
    expect(ageText(3 * 3600 + 5 * 60 + 9)).toBe('3 giờ 5 phút');
    expect(ageText(2 * 86_400 + 4 * 3600)).toBe('2 ngày 4 giờ');
    expect(ageText(2 * 86_400)).toBe('2 ngày');
    expect(ageText(-5)).toBe('0 giây');
  });

  it('a detail screen opens only with a well-formed id; anything else falls back to the list the row belongs to', () => {
    expect(queueTarget({ area: 'shipper', query: { id: ID } })).toEqual({ kind: 'detail', area: 'shipper', id: ID });
    expect(queueTarget({ area: 'finance-topup', query: { id: ID } })).toEqual({ kind: 'detail', area: 'finance-topup', id: ID });
    expect(queueTarget({ area: 'finance-withdrawal', query: { id: ID } })).toEqual({ kind: 'detail', area: 'finance-withdrawal', id: ID });
    expect(queueTarget({ area: 'shipper', query: { id: '../../x' } })).toEqual({ kind: 'route', area: 'shippers', query: { status: 'SUBMITTED' } });
    expect(queueTarget({ area: 'finance-topup', query: {} })).toEqual({ kind: 'route', area: 'finance-topups', query: { status: 'PENDING' } });
    expect(queueTarget({ area: 'finance-withdrawal', query: { id: 'nope' } })).toEqual({ kind: 'route', area: 'finance-withdrawals', query: {} });
    expect(queueTarget({ area: 'deliveries', query: { group: 'stopped' } })).toEqual({ kind: 'route', area: 'deliveries', query: { group: 'stopped' } });
  });

  it('the Business console address is built here from a checked request id, never taken from the server as text', () => {
    expect(queueTarget({ area: 'business-finance', query: { request: ID } })).toEqual({ kind: 'page', href: `/business/finance?request=${ID}` });
    expect(queueTarget({ area: 'business-finance', query: { request: 'x" onmouseover="alert(1)' } })).toEqual({ kind: 'page', href: '/business/finance' });
    expect(queueTarget({ area: 'business-finance', query: { request: 'https://evil.example/' } })).toEqual({ kind: 'page', href: '/business/finance' });
    expect(queueTarget({ area: 'business-finance', query: {} })).toEqual({ kind: 'page', href: '/business/finance' });
  });

  it('the lists a row can fall back to are real routes of the shell, with the filter the row was counted with', () => {
    expect(routeOfLink('deliveries', { group: 'custody_open' })).toEqual({ name: 'deliveries', filter: { group: 'custody_open' } });
    expect(routeOfLink('shippers', { status: 'SUBMITTED' })).toEqual({ name: 'shippers', status: 'SUBMITTED' });
    expect(routeOfLink('finance-topups', { status: 'PENDING' })).toEqual({ name: 'finance-topups', status: 'PENDING' });
    expect(routeOfLink('finance-withdrawals', {})).toEqual({ name: 'finance-withdrawals' });
    expect(routeOfLink('complaints', {})).toEqual({ name: 'complaints' });
  });
});
