import { describe, expect, it } from '@jest/globals';
import { Transport, TransportRequest, TransportResponse } from './api';
import { AdminOrderApi, createOrderSource, parseDetail, parsePage, parseRow } from './orders-api';
import { NOT_WIRED_ORDERS, OrderQuery } from './orders';
import { canOpenRoute, grantsFromPermissions } from './menu';
import { formatRoute, parseRoute } from './routes';

const ID = '11111111-1111-4111-8111-111111111111';
const reply = (status: number, body: unknown): TransportResponse => ({ status, header: () => null, json: () => Promise.resolve(body) });
const errorBody = (code: string) => ({ error: { code, message: 'x', request_id: 'r', details: {} } });
const row = (over: Record<string, unknown> = {}) => ({
  order_id: ID, code: 'D-100001', status: 'PREPARING', display_status: 'PREPARING', shop_name: 'Quán Mẫu', recipient_name: 'Lan', line_count: 2, items_total_vnd: 90000,
  scheduled_for: null, edited: true, needs_attention: false, created_at: '2026-10-18T09:00:00.000Z', ...over,
});
const detail = (over: Record<string, unknown> = {}) => ({
  order_id: ID, code: 'D-100001', status: 'PREPARING', display_status: 'PREPARING', version: 4, edited: true, change_reason: 'Hết món', end_actor: null, end_reason: null,
  shop: { shop_id: ID, name: 'Quán Mẫu' }, customer: { user_id: ID }, recipient: { name: 'Lan', phone: '0912345678', address_text: '1 Hoàng Văn Thụ' },
  note: null, scheduled_for: null, created_at: '2026-10-18T09:00:00.000Z',
  money: { items_original_total_vnd: 120000, items_total_vnd: 90000, paid_vnd: 0, fee: { payer: 'CUSTOMER', amount_vnd: null, estimate_vnd: null } },
  items: [{ name: 'Phở', note: null, quantity: 1, unit_price_vnd: 90000, removed: false, original: { quantity: 2, unit_price_vnd: 60000 } }],
  deliveries: [], timeline: [{ at: '2026-10-18T09:00:00.000Z', type: 'order.placed', actor: 'CUSTOMER', note: null }], can: ['cancel-order'], ...over,
});
const query: OrderQuery = { query: ' D-1 ', status: 'PREPARING', shop: '', from: '2026-10-18', to: '2026-10-18', page: 2 };

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
const port = { csrf: () => 'csrf-1' as string | undefined, refresh: () => Promise.resolve(true) };

describe('admin web Orders - parsers', () => {
  it('maps a row and a detail; an unknown fee stays null, never 0', () => {
    expect(parseRow(row())).toMatchObject({ id: ID, status: 'PREPARING', itemsVnd: 90000, edited: true });
    const parsed = parseDetail(detail());
    expect(parsed).toMatchObject({ version: 4, originalItemsVnd: 120000, itemsVnd: 90000, changeReason: 'Hết món' });
    expect(parsed?.fee.amountVnd).toBeNull();
    expect(parsed?.lines[0]?.original).toEqual({ quantity: 2, unitPriceVnd: 60000 });
    expect([...(parsed?.can ?? [])]).toEqual(['cancel-order']);
    expect(parsePage({ items: [row()], total: 1 })).toMatchObject({ total: 1 });
  });

  it('refuses anything that is not exactly the documented shape', () => {
    for (const bad of [{ status: 'DELETED' }, { order_id: 'x' }, { items_total_vnd: -1 }, { created_at: 'yesterday' }, { edited: 'no' }]) {
      expect(parseRow(row(bad))).toBeUndefined();
    }
    expect(parsePage({ items: [row(), row({ status: 'x' })], total: 2 })).toBeUndefined();
    for (const bad of [{ can: ['set-status'] }, { items: 'x' }, { version: 1.5 }, { money: null }]) {
      expect(parseDetail(detail(bad))).toBeUndefined();
    }
  });
});

describe('admin web Orders - source', () => {
  it('reads the list with the filters (Vietnam-day bounds) and 20 per page', async () => {
    const { transport, requests } = scripted(reply(200, { data: { items: [row()], total: 21 } }));
    const read = await createOrderSource(new AdminOrderApi(transport)).list(query);
    expect(read).toMatchObject({ kind: 'ready', total: 21 });
    expect(requests[0]?.path).toContain('/admin/orders?');
    expect(requests[0]?.path).toContain('status=PREPARING');
    expect(requests[0]?.path).toContain('limit=20&offset=20');
    expect(decodeURIComponent(requests[0]?.path ?? '')).toContain('from=2026-10-18T00:00:00+07:00');
    expect(decodeURIComponent(requests[0]?.path ?? '')).toContain('to=2026-10-19T00:00:00+07:00');
  });

  it('maps failures: lost answer offline, 401 expired, 403 forbidden, 404 not found', async () => {
    expect(await createOrderSource(new AdminOrderApi(scripted('throw').transport)).list(query)).toMatchObject({ kind: 'failed', failure: 'offline' });
    expect(await createOrderSource(new AdminOrderApi(scripted(reply(401, errorBody('ADMIN_SESSION_INVALID'))).transport)).list(query)).toMatchObject({ kind: 'failed', failure: 'session-expired' });
    expect(await createOrderSource(new AdminOrderApi(scripted(reply(403, errorBody('ADMIN_FORBIDDEN'))).transport)).detail(ID)).toMatchObject({ kind: 'failed', failure: 'forbidden' });
    expect(await createOrderSource(new AdminOrderApi(scripted(reply(404, errorBody('ORDER_NOT_FOUND'))).transport)).detail(ID)).toEqual({ kind: 'not-found' });
  });

  it('sends one action with version, reason and its own key; a lost answer is unknown and is not repeated', async () => {
    const ok = scripted(reply(200, { data: detail() }));
    const result = await createOrderSource(new AdminOrderApi(ok.transport), port).action({ id: ID, name: 'cancel-order', version: 4, reason: 'Quán đóng cửa', key: 'k-1' });
    expect(result).toEqual({ kind: 'ok' });
    expect(ok.requests).toHaveLength(1);
    expect(ok.requests[0]).toMatchObject({ method: 'POST', path: `/admin/orders/${ID}/actions/cancel-order`, csrf: 'csrf-1', idempotencyKey: 'k-1', body: { expected_version: 4, reason: 'Quán đóng cửa' } });
    const lost = scripted('throw');
    expect(await createOrderSource(new AdminOrderApi(lost.transport), port).action({ id: ID, name: 'cancel-order', version: 4, reason: 'x', key: 'k-2' })).toEqual({ kind: 'unknown' });
    expect(lost.requests).toHaveLength(1);
    const stale = scripted(reply(409, errorBody('VERSION_CONFLICT')));
    expect(await createOrderSource(new AdminOrderApi(stale.transport), port).action({ id: ID, name: 'cancel-order', version: 3, reason: 'x', key: 'k-3' })).toEqual({ kind: 'conflict' });
  });

  it('is not wired by default and says so', async () => {
    expect(await NOT_WIRED_ORDERS.list(query)).toMatchObject({ kind: 'not-wired' });
    expect(await NOT_WIRED_ORDERS.action({ id: ID, name: 'cancel-order', version: 1, reason: 'x', key: 'k' })).toEqual({ kind: 'not-wired' });
  });
});

describe('admin web Orders - route and menu', () => {
  it('has its own route and opens for the shop/shipper viewers only', () => {
    expect(parseRoute('/operations/orders')).toEqual({ name: 'orders' });
    expect(formatRoute({ name: 'orders' })).toBe('/operations/orders');
    const grants = grantsFromPermissions([{ app: 'SHOP', canView: true } as never]);
    expect(canOpenRoute('ADMIN', grants, { name: 'orders' })).toBe(true);
    expect(canOpenRoute('ADMIN', new Set(), { name: 'orders' })).toBe(false);
  });
});
