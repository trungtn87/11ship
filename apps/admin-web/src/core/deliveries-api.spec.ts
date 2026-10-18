import { describe, expect, it } from '@jest/globals';
import { Transport, TransportRequest, TransportResponse } from './api';
import { AdminDeliveryApi, createDeliverySource, parseCounters, parseDetail, parsePage, parseRow } from './deliveries-api';
import { NOT_WIRED_DELIVERIES, DeliveryQuery } from './deliveries';
import { canOpenRoute, grantsFromPermissions, visibleMenu } from './menu';
import { formatRoute, parseRoute } from './routes';

const ID = '11111111-1111-4111-8111-111111111111';
const reply = (status: number, body: unknown, headers: Record<string, string> = {}): TransportResponse => ({ status, header: (name) => headers[name.toLowerCase()] ?? null, json: () => Promise.resolve(body) });
const errorBody = (code: string) => ({ error: { code, message: 'x', request_id: 'r', details: {} } });
const row = (over: Record<string, unknown> = {}) => ({
  delivery_id: ID, code: 'G-100001', shop: { shop_id: ID, name: 'Quán Mẫu' }, shipper: null, state: 'waiting_driver', goods_value_vnd: 150000, fee_vnd: null, fee_status: 'UNKNOWN',
  incident_open: false, custody: null, created_at: '2026-10-18T09:00:00.000Z', updated_at: '2026-10-18T09:01:00.000Z', ...over,
});
const counters = { searching: 2, waiting_pickup: 1, delivering: 3, needs_attention: 1 };
const detail = (over: Record<string, unknown> = {}) => ({
  delivery_id: ID, code: 'G-100001', source: 'DIRECT', order_id: null, previous_delivery_id: null, state: 'failed', version: 7,
  shop: { shop_id: ID, name: 'Quán Mẫu' }, shipper: { driver_id: ID, name: 'Shipper A' },
  recipient: { name: 'Lan', phone: null, address_text: null },
  goods: { description: 'Bánh', value_vnd: 150000, paid_vnd: 100000 },
  fee: { mode: 'PICKUP_AGREEMENT', payer: 'CUSTOMER', amount_vnd: 20000, status: 'FINAL' },
  search: { started_at: '2026-10-18T09:00:00.000Z', expires_at: '2026-10-18T09:30:00.000Z' },
  location: { lat: 22.66, lng: 106.25, recorded_at: '2026-10-18T09:20:00.000Z', age_seconds: 400, freshness: 'STALE' },
  assignments: [{ assignment_id: ID, shipper_name: 'Shipper A', status: 'FAILED', accepted_at: '2026-10-18T09:05:00.000Z', ended_at: '2026-10-18T09:25:00.000Z', end_reason: 'RECIPIENT_UNREACHABLE' }],
  timeline: [{ at: '2026-10-18T09:00:00.000Z', type: 'delivery.created', actor: 'SHOP', note: null }],
  incident: { incident_id: ID, status: 'OPEN', custody: 'SHIPPER', reason: 'Không liên lạc được', opened_at: '2026-10-18T09:25:00.000Z', closed_at: null, m11_referred_at: null },
  policy: { search_radius_m: 3000, commission_vnd: 1000, fee_policy_version_no: 2 },
  can: ['record-custody', 'refer-m11'], ...over,
});
const query: DeliveryQuery = { query: ' G-1 ', state: 'ALL', goods: 'OPEN', from: '', to: '', shop: '', shipper: '', page: 2 };

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

describe('admin web Deliveries - parsers', () => {
  it('maps a row, the counters, a page and a detail; an unknown fee stays null', () => {
    expect(parseRow(row())).toMatchObject({ id: ID, code: 'G-100001', shipperName: null, feeVnd: null, state: 'waiting_driver' });
    expect(parseRow(row({ shipper: { driver_id: ID, name: 'A' }, fee_vnd: 15000, incident_open: true, custody: 'SHOP' }))).toMatchObject({ shipperName: 'A', feeVnd: 15000, incidentOpen: true, custody: 'SHOP' });
    expect(parseCounters(counters)).toEqual({ searching: 2, waitingPickup: 1, delivering: 3, needsAttention: 1 });
    expect(parsePage({ items: [row()], total: 1, counters })).toMatchObject({ total: 1 });
    const parsed = parseDetail(detail());
    expect(parsed).toMatchObject({ id: ID, version: 7, recipientPhone: null, recipientAddress: null, feeVnd: 20000 });
    expect(parsed?.location).toMatchObject({ freshness: 'STALE', ageSeconds: 400 });
    expect(parsed?.incident).toMatchObject({ status: 'OPEN', custody: 'SHIPPER' });
    expect(parsed?.policy).toEqual({ searchRadiusM: 3000, commissionVnd: 1000, feePolicyVersion: 2 });
    expect([...(parsed?.can ?? [])]).toEqual(['record-custody', 'refer-m11']);
  });

  it('refuses anything that is not exactly the documented shape (never half-shown data)', () => {
    for (const bad of [{ state: 'deleted' }, { delivery_id: 'x' }, { fee_vnd: -1 }, { custody: 'MOON' }, { incident_open: 'no' }, { created_at: 'yesterday' }, { shop: null }]) {
      expect(parseRow(row(bad))).toBeUndefined();
    }
    expect(parsePage({ items: [row(), row({ state: 'x' })], total: 2, counters })).toBeUndefined();
    expect(parsePage({ items: [row()], total: 1 })).toBeUndefined();
    for (const bad of [{ can: ['set-status'] }, { source: 'WEB' }, { location: { lat: 1 } }, { policy: { search_radius_m: 'x' } }, { timeline: 'x' }, { version: 1.5 }]) {
      expect(parseDetail(detail(bad))).toBeUndefined();
    }
  });
});

describe('admin web Deliveries - source', () => {
  it('reads the list with the filters in the query string and 20 per page', async () => {
    const { transport, requests } = scripted(reply(200, { data: { items: [row()], total: 21, counters } }));
    const source = createDeliverySource(new AdminDeliveryApi(transport));
    const read = await source.list(query);
    expect(read).toMatchObject({ kind: 'ready', total: 21 });
    expect(requests[0]).toMatchObject({ method: 'GET', path: '/admin/deliveries?q=G-1&goods=OPEN&limit=20&offset=20' });
  });

  it('maps failures: lost answer is offline, 401 expired, 403 forbidden, 404 not found', async () => {
    const down = createDeliverySource(new AdminDeliveryApi(scripted('throw').transport));
    expect(await down.list(query)).toMatchObject({ kind: 'failed', failure: 'offline' });
    const expired = createDeliverySource(new AdminDeliveryApi(scripted(reply(401, errorBody('ADMIN_SESSION_INVALID'))).transport));
    expect(await expired.list(query)).toMatchObject({ kind: 'failed', failure: 'session-expired' });
    const forbidden = createDeliverySource(new AdminDeliveryApi(scripted(reply(403, errorBody('ADMIN_FORBIDDEN'))).transport));
    expect(await forbidden.detail(ID)).toMatchObject({ kind: 'failed', failure: 'forbidden' });
    const missing = createDeliverySource(new AdminDeliveryApi(scripted(reply(404, errorBody('DELIVERY_NOT_FOUND'))).transport));
    expect(await missing.detail(ID)).toEqual({ kind: 'not-found' });
  });

  it('sends one action with the version, the reason and its own key, and never repeats it by itself', async () => {
    const { transport, requests } = scripted(reply(200, { data: detail() }));
    const { port } = session();
    const source = createDeliverySource(new AdminDeliveryApi(transport), port);
    const result = await source.action({ id: ID, name: 'record-custody', version: 7, reason: 'Hàng đã về quán', resolution: 'GOODS_RETURNED', key: 'k-1' });
    expect(result).toEqual({ kind: 'ok' });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: 'POST', path: `/admin/deliveries/${ID}/actions/record-custody`, csrf: 'csrf-1', idempotencyKey: 'k-1' });
    expect(requests[0]?.body).toEqual({ expected_version: 7, reason: 'Hàng đã về quán', resolution: 'GOODS_RETURNED' });
  });

  it('an adjustment sends only the changed fields', async () => {
    const { transport, requests } = scripted(reply(200, { data: detail() }));
    const source = createDeliverySource(new AdminDeliveryApi(transport), session().port);
    await source.action({ id: ID, name: 'adjust-after-pickup', version: 7, reason: 'Sửa phí theo thỏa thuận', feeVnd: 25000, key: 'k-2' });
    expect(requests[0]?.body).toEqual({ expected_version: 7, reason: 'Sửa phí theo thỏa thuận', fee_vnd: 25000 });
  });

  it('classifies the action outcomes: conflict, refused, forbidden, unknown (answer lost or 5xx), not wired', async () => {
    const run = async (...answers: (TransportResponse | 'throw')[]) => createDeliverySource(new AdminDeliveryApi(scripted(...answers).transport), session().port).action({ id: ID, name: 'refer-m11', version: 1, reason: 'x', key: 'k' });
    expect(await run(reply(409, errorBody('VERSION_CONFLICT')))).toEqual({ kind: 'conflict' });
    expect(await run(reply(409, errorBody('DELIVERY_STATE_CONFLICT')))).toEqual({ kind: 'conflict' });
    expect(await run(reply(409, errorBody('FEE_LOCKED')))).toEqual({ kind: 'refused', code: 'FEE_LOCKED' });
    expect(await run(reply(403, errorBody('ADMIN_FORBIDDEN')))).toEqual({ kind: 'forbidden' });
    expect(await run('throw')).toEqual({ kind: 'unknown' });
    expect(await run(reply(503, errorBody('TRANSACTION_OUTCOME_UNKNOWN')))).toEqual({ kind: 'unknown' });
    expect(await run(reply(400, errorBody('SOMETHING_NEW')))).toEqual({ kind: 'refused', code: 'ADMIN_INPUT_INVALID' });
    expect(await createDeliverySource(new AdminDeliveryApi(scripted().transport)).action({ id: ID, name: 'refer-m11', version: 1, reason: 'x', key: 'k' })).toEqual({ kind: 'not-wired' });
    expect(await createDeliverySource(new AdminDeliveryApi(scripted().transport), session(null).port).action({ id: ID, name: 'refer-m11', version: 1, reason: 'x', key: 'k' })).toEqual({ kind: 'session-expired' });
  });

  it('a stale CSRF token is refreshed and the same key is offered again (unknown, nothing ran)', async () => {
    const s = session();
    const source = createDeliverySource(new AdminDeliveryApi(scripted(reply(403, errorBody('ADMIN_CSRF_INVALID'))).transport), s.port);
    expect(await source.action({ id: ID, name: 'refer-m11', version: 1, reason: 'x', key: 'k' })).toEqual({ kind: 'unknown' });
    expect(s.refreshed()).toBe(1);
  });

  it('by default nothing is wired and nothing is shown', async () => {
    expect(await NOT_WIRED_DELIVERIES.list(query)).toMatchObject({ kind: 'not-wired' });
    expect(await NOT_WIRED_DELIVERIES.detail(ID)).toMatchObject({ kind: 'not-wired' });
    expect(await NOT_WIRED_DELIVERIES.action({ id: ID, name: 'refer-m11', version: 1, reason: 'x', key: 'k' })).toEqual({ kind: 'not-wired' });
  });
});

describe('admin web Deliveries - route and menu', () => {
  it('has its own route and menu entry, visible only with the delivery grant (SYSTEM sees it)', () => {
    expect(parseRoute('/operations/deliveries')).toEqual({ name: 'deliveries' });
    expect(formatRoute({ name: 'deliveries' })).toBe('/operations/deliveries');
    const labels = (groups: ReturnType<typeof visibleMenu>) => groups.flatMap((g) => g.items.map((i) => i.label));
    expect(labels(visibleMenu('SYSTEM', new Set()))).toContain('Giao hàng');
    expect(labels(visibleMenu('ADMIN', new Set()))).not.toContain('Giao hàng');
    const grants = grantsFromPermissions([{ app: 'DRIVER', canView: true, canReviewProfile: false, canLock: false }]);
    expect(labels(visibleMenu('ADMIN', grants))).toContain('Giao hàng');
    expect(canOpenRoute('ADMIN', new Set(), { name: 'deliveries' })).toBe(false);
    expect(canOpenRoute('ADMIN', grants, { name: 'deliveries' })).toBe(true);
  });
});
