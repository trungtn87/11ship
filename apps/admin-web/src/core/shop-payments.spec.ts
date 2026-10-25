import { describe, expect, it } from '@jest/globals';
import { Transport, TransportRequest, TransportResponse } from './api';
import { parseRights } from './finance-api';
import { checkReason, SHOP_PAYMENT_FILTERS, stateLabel } from './shop-payments';
import { AdminShopPaymentApi, createShopPaymentSource, parseDetail, parsePage } from './shop-payments-api';

const ID = '11111111-1111-4111-8111-111111111111';
const SHOP = '33333333-3333-4333-8333-333333333333';
const reply = (status: number, body: unknown): TransportResponse => ({ status, header: () => null, json: () => Promise.resolve(body) });
const err = (code: string) => ({ error: { code, message: 'x', request_id: 'r', details: {} } });
const item = (over: Record<string, unknown> = {}) => ({
  request_id: ID, shop: { shop_id: SHOP, name: 'Quán A', status: 'ACTIVE' }, purpose: 'MENU_EXPANSION', amount_requested_vnd: 200000, state: 'PENDING', reject_reason_code: null, version: 2,
  created_at: '2026-10-25T03:00:00.000Z', reported_at: '2026-10-25T03:05:00.000Z', resolved_at: null, awaiting_check: true, can_report: false, can_cancel: false, ...over,
});
const detail = (over: Record<string, unknown> = {}) => ({ ...item(), settlement: null, entitlement: null, menu_expanded: false, menu_expanded_since: null, visible_count: 12, visible_limit: 20, over_limit: false, entitlement_history: [], may_record: true, may_manage: false, ...over });

function scripted(...answers: TransportResponse[]): { transport: Transport; requests: TransportRequest[] } {
  const requests: TransportRequest[] = [];
  const queue = [...answers];
  const transport: Transport = (request) => {
    requests.push(request);
    const next = queue.shift();
    return next === undefined ? Promise.reject(new Error('down')) : Promise.resolve(next);
  };
  return { transport, requests };
}
const port = { csrf: () => 'csrf-1' as string | undefined, refresh: () => Promise.resolve(true) };

describe('shop payments (issue #198) — model and client', () => {
  it('words a request by what happened: reported and waiting is "Chờ kiểm tra", a report is a notice and never "Đã nhận tiền"', () => {
    expect(stateLabel('PENDING', true)).toBe('Chờ kiểm tra');
    expect(stateLabel('PENDING', false)).toBe('Chưa báo chuyển khoản');
    expect(stateLabel('CONFIRMED', true)).toBe('Đã nhận tiền');
    expect(stateLabel('REJECTED', true)).toBe('Chưa nhận được');
    expect(SHOP_PAYMENT_FILTERS[0]).toBe('CHECK');
  });

  it('the reason of a grant is mandatory, folded and 3..300 characters', () => {
    expect(checkReason('  Quán đã   chuyển khoản ')).toEqual({ reason: 'Quán đã chuyển khoản' });
    expect(checkReason('')).toMatchObject({ error: expect.stringContaining('bắt buộc') });
    expect(checkReason('ab').error).toBeDefined();
    expect(checkReason('x'.repeat(301)).error).toBeDefined();
    expect(checkReason('có\u0007điều khiển').error).toBeDefined();
  });

  it('maps a request, a page and a detail; a malformed answer is "no usable answer", not half shown', () => {
    expect(parsePage({ items: [item()], next_cursor: null })?.items[0]).toMatchObject({ requestId: ID, shopName: 'Quán A', purpose: 'MENU_EXPANSION', requestedVnd: 200000, state: 'PENDING' });
    for (const bad of [item({ state: 'DONE' }), item({ purpose: 'SUBSCRIPTION' }), item({ amount_requested_vnd: 0 }), item({ request_id: 'x' }), item({ shop: { shop_id: 'x', name: 'A' } }), item({ reported_at: 'never' })]) {
      expect(parsePage({ items: [bad], next_cursor: null })).toBeUndefined();
    }
    expect(parseDetail(detail())).toMatchObject({ menuExpanded: false, visibleCount: 12, visibleLimit: 20, mayRecord: true, mayManage: false, settlement: null });
    expect(parseDetail(detail({ menu_expanded: true, visible_limit: null, menu_expanded_since: '2026-10-25T04:00:00.000Z' }))).toMatchObject({ menuExpanded: true, visibleLimit: null });
    expect(parseDetail(detail({ settlement: { bank_id: 'VCB', canonical_transaction_id: 'FT1', amount_vnd: 200000, received_at: '2026-10-25T03:30:00.000Z', recorded_at: '2026-10-25T03:40:00.000Z' }, state: 'CONFIRMED' }))?.settlement).toMatchObject({ amountVnd: 200000, transactionId: 'FT1' });
    expect(parseDetail(detail({ may_record: 'yes' }))).toBeUndefined();
    expect(parseDetail(detail({ entitlement_history: [{ action: 'LEND', reason: 'x', at: '2026-10-25T04:00:00.000Z', payment_request_id: null }] }))).toBeUndefined();
  });

  it('the queue tabs ask the server with its own switches (state and reported); every page has a size and a cursor', async () => {
    const empty = { data: { items: [], next_cursor: null } };
    const { transport, requests } = scripted(reply(200, empty), reply(200, empty), reply(200, empty), reply(200, empty));
    const api = new AdminShopPaymentApi(transport);
    await api.list('CHECK', null);
    await api.list('NOT_REPORTED', null);
    await api.list('CONFIRMED', 'abc def');
    await api.list('ALL', null);
    expect(requests.map((r) => r.path)).toEqual([
      '/admin/shop-payments?status=PENDING&reported=true&limit=20',
      '/admin/shop-payments?status=PENDING&reported=false&limit=20',
      '/admin/shop-payments?status=CONFIRMED&limit=20&cursor=abc%20def',
      '/admin/shop-payments?limit=20',
    ]);
  });

  it('confirm, reject, grant and revoke send EXACTLY the documented bodies with the key and the token; recording money and granting the right are different requests', async () => {
    const ok = reply(200, { data: {} });
    const { transport, requests } = scripted(ok, ok, ok, ok);
    const source = createShopPaymentSource(new AdminShopPaymentApi(transport), port);
    expect(await source.confirm({ key: 'k1', requestId: ID, version: 2, actualVnd: 200000, bankId: 'VCB', accountId: SHOP, transactionId: '000AbC', receivedAt: '2026-10-25T03:30:00.000Z' })).toEqual({ kind: 'ok' });
    await source.reject({ key: 'k2', requestId: ID, version: 2, reason: 'NOT_RECEIVED' });
    await source.grant({ key: 'k3', shopId: SHOP, reason: 'Đã đối soát', paymentRequestId: ID });
    await source.revoke({ key: 'k4', shopId: SHOP, reason: 'Thu hồi' });
    expect(requests[0]).toMatchObject({ method: 'POST', path: `/admin/shop-payments/${ID}/confirm`, csrf: 'csrf-1', idempotencyKey: 'k1', body: { expected_version: 2, actual_amount_vnd: 200000, bank_id: 'VCB', system_owned_account_id: SHOP, canonical_transaction_id: '000AbC', received_at: '2026-10-25T03:30:00.000Z' } });
    expect(requests[1]).toMatchObject({ path: `/admin/shop-payments/${ID}/reject`, body: { expected_version: 2, reason_code: 'NOT_RECEIVED' } });
    expect(requests[2]).toMatchObject({ path: `/admin/shop-payments/shops/${SHOP}/menu-expanded/grant`, body: { reason: 'Đã đối soát', payment_request_id: ID } });
    expect(requests[3]).toMatchObject({ path: `/admin/shop-payments/shops/${SHOP}/menu-expanded/revoke`, body: { reason: 'Thu hồi' } });
    expect(Object.keys((requests[3] as { body: object }).body)).toEqual(['reason']);
  });

  it('maps the outcomes: the payment conflicts keep the code (nothing changed), a lost answer is UNKNOWN, no token means the session is gone', async () => {
    const run = async (answer: TransportResponse, csrf: string | null = 'c') =>
      createShopPaymentSource(new AdminShopPaymentApi(scripted(answer).transport), { csrf: () => csrf ?? undefined, refresh: () => Promise.resolve(true) }).grant({ key: 'k', shopId: SHOP, reason: 'lý do', paymentRequestId: null });
    expect(await run(reply(409, err('SHOP_ENTITLEMENT_STATE_CONFLICT')))).toEqual({ kind: 'conflict', code: 'SHOP_ENTITLEMENT_STATE_CONFLICT' });
    expect(await run(reply(409, err('SHOP_ENTITLEMENT_PAYMENT_NOT_CONFIRMED')))).toEqual({ kind: 'conflict', code: 'SHOP_ENTITLEMENT_PAYMENT_NOT_CONFIRMED' });
    expect(await run(reply(503, err('TRANSACTION_OUTCOME_UNKNOWN')))).toEqual({ kind: 'unknown' });
    expect(await run(reply(403, err('ADMIN_FORBIDDEN')))).toEqual({ kind: 'forbidden' });
    expect(await run(reply(200, {}), null)).toEqual({ kind: 'session-expired' });
  });

  it('the rights of the session: the three shop-payment rights are separate, SYSTEM has them implicitly, the top-up rights open none of them', () => {
    expect(parseRights({ role: 'SYSTEM', implicit: true, permissions: [] })).toMatchObject({ canShopRead: true, canShopRecord: true, canShopManage: true });
    expect(parseRights({ role: 'ADMIN', implicit: false, permissions: ['wallet.read', 'wallet.topup.record'] })).toMatchObject({ canShopRead: false, canShopRecord: false, canShopManage: false });
    expect(parseRights({ role: 'ADMIN', implicit: false, permissions: ['shop.payment.read'] })).toMatchObject({ canShopRead: true, canShopRecord: false, canShopManage: false });
    expect(parseRights({ role: 'ADMIN', implicit: false, permissions: ['shop.entitlement.manage'] })).toMatchObject({ canShopRead: false, canShopRecord: false, canShopManage: true });
  });
});
