import { describe, expect, it } from '@jest/globals';
import { Transport, TransportRequest, TransportResponse } from './api';
import { AdminShopApi, createShopSource, parseDetail, parseHistory, parseMenu, parsePage, parsePreview, parseRow } from './shops-api';

const ID = '11111111-1111-4111-8111-111111111111';
const AREA = '33333333-3333-4333-8333-333333333333';
const reply = (status: number, body: unknown, headers: Record<string, string> = {}): TransportResponse => ({ status, header: (name) => headers[name.toLowerCase()] ?? null, json: () => Promise.resolve(body) });
const errorBody = (code: string) => ({ error: { code, message: 'x', request_id: 'r', details: {} } });
const availability = (over: Record<string, unknown> = {}) => ({ online: true, reason: 'ONLINE', evaluated_at: '2026-10-24T03:00:00.000Z', ...over });
const owner = { name: 'Nguyễn Văn B', phone: '+84901234567', locked: false };
const listRow = (over: Record<string, unknown> = {}) => ({
  shop_id: ID, code: 'K01', name: 'Phở Ngon', address_text: 'Số 9, Cao Bằng', owner, service_area: { service_area_id: AREA, name: 'Cao Bằng' }, status: 'ACTIVE', version: 3,
  availability: availability(), items_visible: 2, items_total: 3, ...over,
});
const detail = (over: Record<string, unknown> = {}) => ({
  shop_id: ID, code: 'K01', name: 'Phở Ngon', status: 'ACTIVE', version: 3, logo_url: null, owner,
  profile: { contact_phone: '+84911000222', zalo: null, facebook: null, address_text: 'Số 9, Cao Bằng', service_area: { service_area_id: AREA, name: 'Cao Bằng', status: 'ACTIVE' }, pickup_lat: 22.66, pickup_lng: 106.25 },
  availability: availability(), timezone: 'Asia/Ho_Chi_Minh', hours: [{ weekday: 1, start_minute: 0, end_minute: 1440, end_day_offset: 0 }], menu: { visible: 2, hidden: 1 },
  open_work: { orders_open: 3, orders_pending_confirmation: 1, orders_preparing: 2, active_deliveries: 0 }, disable_blocked: true, enable_blockers: [], allowed_actions: ['DISABLE'],
  created_at: '2026-10-01T03:00:00.000Z', updated_at: '2026-10-02T03:00:00.000Z', ...over,
});

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
const command = { id: ID, name: 'disable', version: 3, reason: 'Vi phạm', key: 'key-1' } as const;

describe('admin web shops - parsers', () => {
  it('maps a row, a page, a detail, a menu page, a history page and both previews', () => {
    expect(parseRow(listRow())).toMatchObject({ id: ID, code: 'K01', status: 'ACTIVE', areaName: 'Cao Bằng', itemsVisible: 2, itemsTotal: 3, availability: { reason: 'ONLINE' } });
    expect(parsePage({ items: [listRow()], total: 41, areas: [{ service_area_id: AREA, name: 'Cao Bằng', status: 'INACTIVE' }] })).toMatchObject({ total: 41, areas: [{ id: AREA, active: false }] });
    expect(parseDetail(detail())).toMatchObject({ id: ID, version: 3, actions: ['disable'], ordersOpen: 3, disableBlocked: true, ordersPreparing: 2, pickupLat: 22.66, hours: [{ weekday: 1, startMinute: 0, endMinute: 1440, endDayOffset: 0 }] });
    expect(parseDetail(detail({ status: 'DISABLED', allowed_actions: ['ENABLE'], enable_blockers: ['PICKUP_POINT_MISSING'] }))).toMatchObject({ actions: ['enable'], enableBlockers: ['PICKUP_POINT_MISSING'] });
    const menu = parseMenu({
      categories: [{ category_id: AREA, name: 'Món chính', status: 'INACTIVE', item_count: 1 }],
      items: [{ item_id: ID, name: 'Phở', price_vnd: 45000, category: { category_id: AREA, name: 'Món chính', status: 'INACTIVE' }, status: 'HIDDEN', image_url: null, version: 1, updated_at: '2026-10-02T03:00:00.000Z' }],
      total: 1,
    });
    expect(menu).toMatchObject({ total: 1, items: [{ status: 'HIDDEN', categoryActive: false }], groups: [{ active: false }] });
    expect(parseHistory({ items: [{ audit_id: ID, occurred_at: '2026-10-02T03:00:00.000Z', actor: { type: 'ADMIN', name: 'QT' }, action: 'admin.shop.disable.v1', version: 4, reason: 'Vi phạm', from_status: 'ACTIVE', to_status: 'DISABLED' }], total: 1 })).toMatchObject({ entries: [{ version: 4, fromStatus: 'ACTIVE' }] });
    expect(parsePreview({ visible_to_customers: false, reason: 'SHOP_DISABLED', shop_id: ID })).toEqual({ visible: false, reason: 'SHOP_DISABLED' });
    expect(parsePreview({ visible_to_customers: true, shop_id: ID, logo_url: null, name: 'Phở', address_text: 'A', timezone: 'x', availability: availability(), hours: [], categories: [{ category_id: AREA, name: 'G', items: [{ item_id: ID, name: 'Phở', price_vnd: 1000, image_url: null }] }] })).toMatchObject({ visible: true, categories: [{ items: [{ priceVnd: 1000 }] }] });
  });

  it('refuses anything that is not exactly the documented shape', () => {
    for (const bad of [{ status: 'DELETED' }, { shop_id: 'x' }, { availability: availability({ reason: 'MAYBE' }) }, { availability: availability({ evaluated_at: 'soon' }) }, { items_visible: -1 }, { owner: { name: null, phone: '', locked: false } }, { code: '' }]) {
      expect(parseRow(listRow(bad))).toBeUndefined();
    }
    for (const bad of [{ version: 0 }, { allowed_actions: ['DELETE'] }, { hours: [{ weekday: 8, start_minute: 0, end_minute: 60, end_day_offset: 0 }] }, { hours: [{ weekday: 1, start_minute: 0, end_minute: 60, end_day_offset: 2 }] }, { menu: { visible: 1 } }, { disable_blocked: 'yes' }, { open_work: { orders_pending_confirmation: 1, orders_preparing: 0, active_deliveries: 0 } }, { profile: null }, { enable_blockers: [1] }]) {
      expect(parseDetail(detail(bad))).toBeUndefined();
    }
    expect(parsePage({ items: [listRow({ status: 'X' })], total: 1, areas: [] })).toBeUndefined();
    expect(parsePage({ items: [], total: 0 })).toBeUndefined();
    expect(parsePreview({ visible_to_customers: false, reason: 'X' })).toBeUndefined();
    expect(parseHistory({ items: [{ audit_id: ID }], total: 1 })).toBeUndefined();
  });
});

describe('admin web shops - requests', () => {
  it('lists with search, filters and the page as limit/offset 20', async () => {
    const { transport, requests } = scripted(reply(200, { data: { items: [], total: 0, areas: [] } }));
    await new AdminShopApi(transport).list({ query: ' phở ', area: AREA, profile: 'DISABLED', schedule: 'CLOSED', page: 3 });
    expect(requests[0]).toMatchObject({ method: 'GET', path: `/admin/shops?q=ph%E1%BB%9F&area=${AREA}&profile=DISABLED&schedule=CLOSED&limit=20&offset=40` });
    const empty = scripted(reply(200, { data: { items: [], total: 0, areas: [] } }));
    await new AdminShopApi(empty.transport).list({ query: '', area: 'ALL', profile: 'ALL', schedule: 'ALL', page: 1 });
    expect(empty.requests[0]?.path).toBe('/admin/shops?limit=20&offset=0');
  });

  it('reads the detail, the menu, the history and the preview from the shop path', async () => {
    const { transport, requests } = scripted(reply(200, { data: detail() }), reply(200, { data: { categories: [], items: [], total: 0 } }), reply(200, { data: { items: [], total: 0 } }), reply(200, { data: { visible_to_customers: false, reason: 'SHOP_DISABLED' } }));
    const api = new AdminShopApi(transport);
    await api.detail(ID);
    await api.menu(ID, { query: 'Phở', category: AREA, status: 'HIDDEN', page: 2 });
    await api.history(ID, 2);
    await api.preview(ID);
    expect(requests.map((request) => request.path)).toEqual([
      `/admin/shops/${ID}`,
      `/admin/shops/${ID}/menu?q=Ph%E1%BB%9F&category=${AREA}&status=HIDDEN&limit=20&offset=20`,
      `/admin/shops/${ID}/history?limit=20&offset=20`,
      `/admin/shops/${ID}/preview`,
    ]);
  });

  it('sends one POST with the version, the reason, the CSRF token and the intent key', async () => {
    const { transport, requests } = scripted(reply(200, { data: detail({ status: 'DISABLED', allowed_actions: ['ENABLE'] }) }));
    const source = createShopSource(new AdminShopApi(transport), session().port);
    expect(await source.command(command)).toEqual({ kind: 'ok' });
    expect(requests).toEqual([{ method: 'POST', path: `/admin/shops/${ID}/disable`, body: { expected_version: 3, reason: 'Vi phạm' }, csrf: 'csrf-1', idempotencyKey: 'key-1' }]);
  });
});

describe('admin web shops - what a command result means', () => {
  async function outcome(answer: TransportResponse | 'throw', csrf: string | null = 'csrf-1') {
    const state = session(csrf);
    const { transport, requests } = scripted(answer);
    const result = await createShopSource(new AdminShopApi(transport), state.port).command(command);
    return { result, sent: requests.length, refreshed: state.refreshed() };
  }

  it('a lost answer or a server fault may have been executed: unknown, never a plain failure', async () => {
    expect((await outcome('throw')).result).toEqual({ kind: 'unknown' });
    expect((await outcome(reply(503, errorBody('TRANSACTION_OUTCOME_UNKNOWN')))).result).toEqual({ kind: 'unknown' });
    expect((await outcome(reply(409, errorBody('IDEMPOTENCY_BUSY')))).result).toEqual({ kind: 'unknown' });
  });

  it('a stale CSRF token is refreshed and the SAME key is retried by the caller', async () => {
    const seen = await outcome(reply(403, errorBody('ADMIN_CSRF_INVALID')));
    expect(seen.result).toEqual({ kind: 'unknown' });
    expect(seen.refreshed).toBe(1);
  });

  it('maps the business answers', async () => {
    expect((await outcome(reply(409, errorBody('VERSION_CONFLICT')))).result).toEqual({ kind: 'conflict' });
    expect((await outcome(reply(403, errorBody('ADMIN_FORBIDDEN')))).result).toEqual({ kind: 'forbidden' });
    expect((await outcome(reply(401, errorBody('ADMIN_SESSION_INVALID')))).result).toEqual({ kind: 'session-expired' });
    expect((await outcome(reply(429, errorBody('ADMIN_AUTH_RATE_LIMITED'), { 'retry-after': '7' }))).result).toEqual({ kind: 'rate-limited', retryAfterSec: 7 });
    expect((await outcome(reply(409, errorBody('SHOP_STATE_CONFLICT')))).result).toEqual({ kind: 'refused', code: 'SHOP_STATE_CONFLICT' });
    expect((await outcome(reply(409, errorBody('SHOP_HAS_OPEN_WORK')))).result).toEqual({ kind: 'refused', code: 'SHOP_HAS_OPEN_WORK' });
    expect((await outcome(reply(409, errorBody('SHOP_PROFILE_INCOMPLETE')))).result).toEqual({ kind: 'refused', code: 'SHOP_PROFILE_INCOMPLETE' });
    expect((await outcome(reply(400, errorBody('INVALID_SERVICE_AREA')))).result).toEqual({ kind: 'refused', code: 'INVALID_SERVICE_AREA' });
    expect((await outcome(reply(418, errorBody('SOMETHING_NEW')))).result).toEqual({ kind: 'refused', code: 'ADMIN_INPUT_INVALID' });
  });

  it('without a session token nothing is sent', async () => {
    const seen = await outcome(reply(200, { data: detail() }), null);
    expect(seen).toMatchObject({ result: { kind: 'session-expired' }, sent: 0 });
  });

  it('a read maps 404 to not-found and the other failures to a retryable failure', async () => {
    const { transport } = scripted(reply(404, errorBody('SHOP_NOT_FOUND')), reply(403, errorBody('ADMIN_FORBIDDEN')), 'throw', reply(200, { data: { garbage: true } }));
    const source = createShopSource(new AdminShopApi(transport));
    expect(await source.detail(ID)).toEqual({ kind: 'not-found' });
    expect(await source.menu(ID, { query: '', category: 'ALL', status: 'ALL', page: 1 })).toMatchObject({ kind: 'failed', failure: 'forbidden' });
    expect(await source.history(ID, 1)).toMatchObject({ kind: 'failed', failure: 'offline' });
    expect(await source.list({ query: '', area: 'ALL', profile: 'ALL', schedule: 'ALL', page: 1 })).toMatchObject({ kind: 'failed' });
  });
});
