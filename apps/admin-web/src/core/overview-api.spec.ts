import { describe, expect, it } from '@jest/globals';
import { Transport, TransportRequest, TransportResponse } from './api';
import { canOpenRoute, visibleMenu } from './menu';
import { AdminOverviewApi, createOverviewSource, parseMetric, parseOverview } from './overview-api';
import { customRangeError, NOT_WIRED_OVERVIEW, notReadyText, vietnamToday } from './overview';
import { formatRoute, parseRoute, routeOfLink } from './routes';

const reply = (status: number, body: unknown): TransportResponse => ({ status, header: () => null, json: () => Promise.resolve(body) });
const ok = (value: number, extra: Record<string, unknown> = {}) => ({ status: 'OK', value, ...extra });
const body = (over: Record<string, unknown> = {}) => ({
  generated_at: '2026-10-19T03:04:05.000Z',
  time_zone: 'Asia/Ho_Chi_Minh',
  period: { range: 'today', from: '2026-10-18T17:00:00.000Z', to: '2026-10-19T17:00:00.000Z', from_day: '2026-10-19', to_day: '2026-10-19' },
  groups: {
    orders: { scope: 'PERIOD', metrics: { created: { status: 'NOT_READY', reason: 'M10_ORDER_NOT_CONNECTED' } } },
    deliveries_period: {
      scope: 'PERIOD',
      metrics: { created: ok(5, { link: { area: 'deliveries', query: { from: '2026-10-19', to: '2026-10-19', basis: 'created' } } }), completed: ok(3), failed: ok(1) },
      success_rate: { numerator: 3, denominator: 4 },
    },
    money_now: { scope: 'CURRENT', metrics: { wallet_balance_vnd: { status: 'FORBIDDEN' }, topup_pending: { status: 'ERROR' } } },
  },
  todo: [{ key: 'deliveries_stopped', ...ok(2, { link: { area: 'deliveries', query: { group: 'stopped' } } }) }, { key: 'complaints_unhandled', status: 'NOT_READY', reason: 'M11_FEEDBACK_NOT_CONNECTED' }],
  ...over,
});
const NOW = Date.UTC(2026, 9, 19, 3, 0, 0);

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

describe('M12-A overview - parsers', () => {
  it('keeps FORBIDDEN, NOT_READY and ERROR apart from a real zero', () => {
    expect(parseMetric(ok(0))).toEqual({ status: 'OK', value: 0 });
    expect(parseMetric({ status: 'FORBIDDEN' })).toEqual({ status: 'FORBIDDEN' });
    expect(parseMetric({ status: 'ERROR' })).toEqual({ status: 'ERROR' });
    expect(parseMetric({ status: 'NOT_READY', reason: 'M10_ORDER_NOT_CONNECTED' })).toEqual({ status: 'NOT_READY', reason: 'M10_ORDER_NOT_CONNECTED' });
    // A number is only believed when it is a safe integer under status OK.
    for (const bad of [{ status: 'OK' }, { status: 'OK', value: '3' }, { status: 'OK', value: 1.5 }, { status: 'OK', value: null }, { status: 'MAYBE' }, { status: 'NOT_READY' }, null, 'x']) {
      expect(parseMetric(bad)).toBeUndefined();
    }
    expect(parseMetric(ok(1, { link: { area: 'elsewhere', query: {} } }))).toBeUndefined();
    expect(parseMetric(ok(1, { link: { area: 'deliveries', query: { group: 3 } } }))).toBeUndefined();
  });

  it('maps a whole overview and refuses a half-valid one', () => {
    const parsed = parseOverview(body());
    expect(parsed?.generatedAt).toBe('2026-10-19T03:04:05.000Z');
    expect(parsed?.period).toMatchObject({ range: 'today', fromDay: '2026-10-19', toDay: '2026-10-19' });
    expect(parsed?.successRate).toEqual({ numerator: 3, denominator: 4 });
    expect(parsed?.groups.deliveries_period?.metrics.created).toMatchObject({ status: 'OK', value: 5 });
    expect(parsed?.groups.money_now?.metrics.wallet_balance_vnd).toEqual({ status: 'FORBIDDEN' });
    expect(parsed?.todo.map((item) => [item.key, item.metric.status])).toEqual([['deliveries_stopped', 'OK'], ['complaints_unhandled', 'NOT_READY']]);
    expect(parseOverview(body({ generated_at: 'yesterday' }))).toBeUndefined();
    expect(parseOverview(body({ todo: 'x' }))).toBeUndefined();
    expect(parseOverview(body({ period: { range: 'forever', from: '2026-10-18T17:00:00.000Z', to: '2026-10-19T17:00:00.000Z', from_day: 'a', to_day: 'b' } }))).toBeUndefined();
    const groups = body().groups as Record<string, unknown>;
    expect(parseOverview(body({ groups: { ...groups, deliveries_period: { scope: 'PERIOD', metrics: { created: ok(5) }, success_rate: { numerator: 5, denominator: 4 } } } }))).toBeUndefined();
    expect(parseOverview(body({ groups: { ...groups, orders: { scope: 'PERIOD', metrics: { created: { status: 'OK' } } } } }))).toBeUndefined();
  });

  it('a success rate the server could not compute stays a status, not 0 / 0', () => {
    const groups = body().groups as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const forbidden = parseOverview(body({ groups: { ...groups, deliveries_period: { ...groups.deliveries_period, success_rate: { status: 'FORBIDDEN' } } } }));
    expect(forbidden?.successRate).toEqual({ status: 'FORBIDDEN' });
  });
});

describe('M12-A overview - client and source', () => {
  it('asks for the range, sends custom days only for custom, and maps failures to their own wording (never a zero)', async () => {
    const calls = scripted(reply(200, { data: body() }), reply(200, { data: body() }), reply(401, { error: { code: 'ADMIN_SESSION_INVALID' } }), reply(403, { error: { code: 'ADMIN_FORBIDDEN' } }), 'throw', reply(200, { data: { generated_at: 1 } }));
    const source = createOverviewSource(new AdminOverviewApi(calls.transport));
    expect((await source.read({ range: '7d' })).kind).toBe('ready');
    expect((await source.read({ range: 'custom', from: '2026-10-01', to: '2026-10-05' })).kind).toBe('ready');
    expect(calls.requests.map((request) => request.path)).toEqual(['/admin/overview?range=7d', '/admin/overview?range=custom&from=2026-10-01&to=2026-10-05']);
    expect(calls.requests.every((request) => request.method === 'GET')).toBe(true);
    expect(await source.read({ range: 'today' })).toEqual({ kind: 'failed', failure: 'session-expired' });
    expect(await source.read({ range: 'today' })).toEqual({ kind: 'failed', failure: 'forbidden' });
    expect(await source.read({ range: 'today' })).toEqual({ kind: 'failed', failure: 'offline' });
    expect((await source.read({ range: 'today' })).kind).toBe('failed');
  });

  it('the default source is not wired and shows nothing', async () => {
    expect(await NOT_WIRED_OVERVIEW.read({ range: 'today' })).toMatchObject({ kind: 'not-wired' });
  });
});

describe('M12-A overview - links, range and menu', () => {
  it('a tile opens the delivery list with exactly the filter it was counted with; unknown values are dropped', () => {
    const route = routeOfLink('deliveries', { from: '2026-10-19', to: '2026-10-19', basis: 'ended', state: 'completed' });
    expect(route).toEqual({ name: 'deliveries', filter: { from: '2026-10-19', to: '2026-10-19', basis: 'ended', state: 'completed' } });
    expect(parseRoute(formatRoute(route).split('?')[0] as string, `?${formatRoute(route).split('?')[1] as string}`)).toEqual(route);
    expect(routeOfLink('deliveries', { group: 'stopped' })).toEqual({ name: 'deliveries', filter: { group: 'stopped' } });
    expect(routeOfLink('deliveries', { group: 'drop table', state: 'x', basis: 'y', from: '19/10', to: '2026-13-45x' })).toEqual({ name: 'deliveries' });
    expect(routeOfLink('shippers', { status: 'SUBMITTED' })).toEqual({ name: 'shippers', status: 'SUBMITTED' });
    expect(routeOfLink('finance-topups', { status: 'PENDING' })).toEqual({ name: 'finance-topups', status: 'PENDING' });
    expect(routeOfLink('shippers', { status: 'NOPE' })).toEqual({ name: 'shippers' });
  });

  it('validates a custom range like the server: real days, ordered, not after today, at most 92 days', () => {
    expect(vietnamToday(NOW)).toBe('2026-10-19');
    // 18:00 UTC on 19 Oct is already 20 Oct in Vietnam.
    expect(vietnamToday(Date.UTC(2026, 9, 19, 18, 0, 0))).toBe('2026-10-20');
    expect(customRangeError('2026-10-01', '2026-10-19', NOW)).toBeUndefined();
    expect(customRangeError('', '2026-10-19', NOW)).toBeDefined();
    expect(customRangeError('2026-02-30', '2026-03-01', NOW)).toBeDefined();
    expect(customRangeError('2026-10-20', '2026-10-19', NOW)).toBeDefined();
    expect(customRangeError('2026-10-01', '2026-10-20', NOW)).toBeDefined();
    expect(customRangeError('2026-07-01', '2026-10-19', NOW)).toBeDefined();
    expect(customRangeError('2026-07-20', '2026-10-19', NOW)).toBeUndefined();
  });

  it('explains NOT_READY in words and never prints the raw code', () => {
    expect(notReadyText('M10_ORDER_NOT_CONNECTED')).toContain('M10');
    expect(notReadyText('SOMETHING_NEW')).toBe('Chưa sẵn sàng');
  });

  it('"Điều hành" is in every administrator\'s menu, and the page opens for every role (the server gates each figure)', () => {
    const labels = (groups: ReturnType<typeof visibleMenu>) => groups.flatMap((group) => group.items.map((item) => item.label));
    expect(labels(visibleMenu('ADMIN', new Set()))).toContain('Điều hành');
    expect(labels(visibleMenu('SYSTEM', new Set()))).toContain('Điều hành');
    expect(canOpenRoute('ADMIN', new Set(), { name: 'overview' })).toBe(true);
    expect(parseRoute('/overview')).toEqual({ name: 'overview' });
    expect(formatRoute({ name: 'overview' })).toBe('/overview');
  });
});
