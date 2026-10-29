import { describe, expect, it } from '@jest/globals';
import { Transport, TransportRequest, TransportResponse } from './api';
import { AdminFinanceApi, createFinanceAdminSource, parseAdminAccess, parseReceivingAccounts, parseRights, parseTopup, parseTopupPage } from './finance-api';

const ID = '11111111-1111-4111-8111-111111111111';
const ACC = '22222222-2222-4222-8222-222222222222';
const reply = (status: number, body: unknown, headers: Record<string, string> = {}): TransportResponse => ({ status, header: (name) => headers[name.toLowerCase()] ?? null, json: () => Promise.resolve(body) });
const err = (code: string) => ({ error: { code, message: 'x', request_id: 'r', details: {} } });
const topup = (over: Record<string, unknown> = {}) => ({ request_id: ID, driver_id: ACC, amount_requested_vnd: 100000, actual_amount_vnd: null, state: 'PENDING', version: 1, created_at: '2026-10-18T03:00:00.000Z', resolved_at: null, received_at: null, ...over });

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

describe('finance API (B3a) - parsers', () => {
  it('reads the rights of the session: SYSTEM implicit has both, an ADMIN only the listed ones, unknown keys open nothing', () => {
    expect(parseRights({ role: 'SYSTEM', implicit: true, permissions: ['wallet.read', 'wallet.topup.record'] })).toMatchObject({ canRead: true, canRecord: true });
    expect(parseRights({ role: 'ADMIN', implicit: false, permissions: [] })).toMatchObject({ canRead: false, canRecord: false });
    expect(parseRights({ role: 'ADMIN', implicit: false, permissions: ['wallet.topup.record'] })).toMatchObject({ canRead: false, canRecord: true });
    expect(parseRights({ role: 'ADMIN', implicit: false, permissions: ['driver.approve', 'wallet.admin'] })).toMatchObject({ canRead: false, canRecord: false });
    expect(parseRights({ role: 'ADMIN', implicit: false })).toBeUndefined();
    expect(parseRights({ role: 'OWNER', implicit: false, permissions: [] })).toBeUndefined();
  });
  it('maps a request and a page; a malformed one is "no usable answer", not half shown', () => {
    expect(parseTopup(topup({ state: 'CONFIRMED', actual_amount_vnd: 60000, version: 2, resolved_at: '2026-10-18T04:00:00.000Z', received_at: '2026-10-18T03:30:00.000Z' }))).toMatchObject({ requestId: ID, requestedVnd: 100000, actualVnd: 60000, state: 'CONFIRMED' });
    for (const bad of [topup({ state: 'DONE' }), topup({ amount_requested_vnd: 1.5 }), topup({ amount_requested_vnd: '100000' }), topup({ request_id: 'x' }), topup({ version: 0 }), topup({ created_at: 'never' }), null]) {
      expect(parseTopup(bad)).toBeUndefined();
    }
    expect(parseTopupPage({ items: [topup()], next_cursor: null })?.items).toHaveLength(1);
    expect(parseTopupPage({ items: [topup(), { x: 1 }], next_cursor: null })).toBeUndefined();
    expect(parseTopupPage({ items: [], next_cursor: 5 })).toBeUndefined();
  });
  it('maps the masked receiving accounts (no holder, no full number) and the rights of one administrator', () => {
    expect(parseReceivingAccounts({ accounts: [{ account_id: ACC, bank_id: 'VCB', account_number_masked: '****6789', can_receive: true }] })).toEqual([{ accountId: ACC, bankId: 'VCB', numberMasked: '****6789', canReceive: true }]);
    expect(parseReceivingAccounts({ accounts: [{ account_id: ACC, bank_id: 'VCB', can_receive: true }] })).toBeUndefined();
    const access = { user_id: ID, permissions: [{ permission_key: 'wallet.read', state: 'NONE', version: 0, granted_at: null, revoked_at: null }] };
    expect(parseAdminAccess(access)?.permissions[0]).toMatchObject({ key: 'wallet.read', state: 'NONE', version: 0 });
    expect(parseAdminAccess({ ...access, permissions: [{ ...access.permissions[0], permission_key: 'wallet.everything' }] })).toBeUndefined();
    // A real server response includes the shop rights too. They must not make the entire dialog unreadable.
    for (const key of ['shop.payment.read', 'shop.payment.record', 'shop.entitlement.manage']) {
      expect(parseAdminAccess({ ...access, permissions: [...access.permissions, { ...access.permissions[0], permission_key: key }] })?.permissions).toHaveLength(2);
    }
    expect(parseRights({ role: 'ADMIN', implicit: false, permissions: ['shop.payment.read', 'shop.payment.record', 'shop.entitlement.manage'] })).toMatchObject({ canRead: false, canRecord: false, canProcess: false, canConfirm: false, canReconcile: false });
  });
});

describe('finance API (B3a) - requests', () => {
  it('lists with the server state, a page size and a cursor; ALL sends no status', async () => {
    const { transport, requests } = scripted(reply(200, { data: { items: [], next_cursor: null } }), reply(200, { data: { items: [], next_cursor: null } }));
    const api = new AdminFinanceApi(transport);
    await api.topups('PENDING', null);
    await api.topups('ALL', 'abc def');
    expect(requests[0]?.path).toBe('/admin/finance/topup-requests?status=PENDING&limit=20');
    expect(requests[1]?.path).toBe('/admin/finance/topup-requests?limit=20&cursor=abc%20def');
  });
  it('confirm sends EXACTLY the documented body with the key and the token; the code is not changed', async () => {
    const { transport, requests } = scripted(reply(200, { data: topup({ state: 'CONFIRMED', actual_amount_vnd: 60000, version: 2 }) }));
    const s = session();
    const source = createFinanceAdminSource(new AdminFinanceApi(transport), s.port);
    const outcome = await source.confirm({ key: 'key-1', requestId: ID, version: 1, actualVnd: 60000, bankId: 'VCB', accountId: ACC, transactionId: '000AbC', receivedAt: '2026-10-18T09:30:00.000Z' });
    expect(outcome).toEqual({ kind: 'ok' });
    expect(requests[0]).toMatchObject({
      method: 'POST',
      path: `/admin/finance/topup-requests/${ID}/confirm`,
      csrf: 'csrf-1',
      idempotencyKey: 'key-1',
      body: { expected_version: 1, actual_amount_vnd: 60000, bank_id: 'VCB', system_owned_account_id: ACC, canonical_transaction_id: '000AbC', received_at: '2026-10-18T09:30:00.000Z' },
    });
    expect(Object.keys((requests[0] as { body: object }).body).sort()).toEqual(['actual_amount_vnd', 'bank_id', 'canonical_transaction_id', 'expected_version', 'received_at', 'system_owned_account_id']);
  });
  it('reject sends exactly {expected_version, reason_code}: no note', async () => {
    const { transport, requests } = scripted(reply(200, { data: topup({ state: 'REJECTED', version: 2 }) }));
    const source = createFinanceAdminSource(new AdminFinanceApi(transport), session().port);
    await source.reject({ key: 'k', requestId: ID, version: 1, reason: 'AMOUNT_MISMATCH' });
    expect((requests[0] as { body: object }).body).toEqual({ expected_version: 1, reason_code: 'AMOUNT_MISMATCH' });
  });
  it('maps every outcome: conflicts keep the code, a lost answer or a 5xx is UNKNOWN, a stale token is refreshed and stays unknown (same key), no token means the session is gone', async () => {
    const run = async (answer: TransportResponse | 'throw', csrf: string | null = 'c') => {
      const { transport, requests } = scripted(answer);
      const s = session(csrf);
      const outcome = await createFinanceAdminSource(new AdminFinanceApi(transport), s.port).reject({ key: 'k', requestId: ID, version: 1, reason: 'OTHER' });
      return { outcome, sent: requests.length, refreshed: s.refreshed() };
    };
    expect((await run(reply(409, err('BANK_TRANSACTION_ALREADY_RECORDED')))).outcome).toEqual({ kind: 'conflict', code: 'BANK_TRANSACTION_ALREADY_RECORDED' });
    expect((await run(reply(409, err('VERSION_CONFLICT')))).outcome).toEqual({ kind: 'conflict', code: 'VERSION_CONFLICT' });
    expect((await run('throw')).outcome).toEqual({ kind: 'unknown' });
    expect((await run(reply(503, err('TRANSACTION_OUTCOME_UNKNOWN')))).outcome).toEqual({ kind: 'unknown' });
    expect((await run(reply(200, { data: 'not-an-object' }))).outcome).toEqual({ kind: 'unknown' });
    expect((await run(reply(409, err('IDEMPOTENCY_BUSY')))).outcome).toEqual({ kind: 'unknown' });
    const csrf = await run(reply(403, err('ADMIN_CSRF_INVALID')));
    expect(csrf.outcome).toEqual({ kind: 'unknown' });
    expect(csrf.refreshed).toBe(1);
    expect((await run(reply(401, err('ADMIN_SESSION_INVALID')))).outcome).toEqual({ kind: 'session-expired' });
    expect((await run(reply(403, err('ADMIN_FORBIDDEN')))).outcome).toEqual({ kind: 'forbidden' });
    expect((await run(reply(429, err('ADMIN_AUTH_RATE_LIMITED'), { 'retry-after': '7' }))).outcome).toEqual({ kind: 'rate-limited', retryAfterSec: 7 });
    expect((await run(reply(400, err('ADMIN_INPUT_INVALID')))).outcome).toEqual({ kind: 'refused', code: 'ADMIN_INPUT_INVALID' });
    const none = await run(reply(200, { data: topup() }), null);
    expect(none).toMatchObject({ outcome: { kind: 'session-expired' }, sent: 0 });
  });
  it('reads: 404 is not-found, 403 forbidden, 401 session-expired, a bad body is offline', async () => {
    const read = async (answer: TransportResponse | 'throw') => createFinanceAdminSource(new AdminFinanceApi(scripted(answer).transport), session().port).topup(ID);
    expect(await read(reply(404, err('TOPUP_REQUEST_NOT_FOUND')))).toEqual({ kind: 'not-found' });
    expect(await read(reply(403, err('ADMIN_FORBIDDEN')))).toEqual({ kind: 'failed', failure: 'forbidden' });
    expect(await read(reply(401, err('ADMIN_SESSION_INVALID')))).toEqual({ kind: 'failed', failure: 'session-expired' });
    expect(await read(reply(200, { data: { request_id: 'x' } }))).toEqual({ kind: 'failed', failure: 'offline' });
    expect(await read('throw')).toEqual({ kind: 'failed', failure: 'offline' });
  });
  it('account commands: create is accepted at 201, the receiving switch and the rights carry their versions and keys', async () => {
    const created = { account_id: ACC, bank_id: 'VCB', account_number: '0123456789', account_holder: 'A', can_receive: false, version: 1, created_at: '2026-10-18T03:00:00.000Z' };
    const { transport, requests } = scripted(reply(201, { data: created }), reply(200, { data: created }), reply(200, { data: { user_id: ID, permissions: [] } }));
    const source = createFinanceAdminSource(new AdminFinanceApi(transport), session().port);
    expect(await source.createAccount({ key: 'k1', bankId: 'VCB', accountNumber: '0123456789', accountHolder: 'A' })).toEqual({ kind: 'ok' });
    expect(await source.setReceiving({ key: 'k2', accountId: ACC, version: 1, canReceive: true })).toEqual({ kind: 'ok' });
    expect(await source.changeAccess({ key: 'k3', userId: ID, permission: 'wallet.read', version: 0, action: 'grant' })).toEqual({ kind: 'ok' });
    expect(requests.map((r) => [r.path, r.idempotencyKey])).toEqual([
      ['/admin/finance/bank-accounts', 'k1'],
      [`/admin/finance/bank-accounts/${ACC}/receiving`, 'k2'],
      [`/admin/finance/access/admins/${ID}/grant`, 'k3'],
    ]);
    expect((requests[0] as { body: object }).body).toEqual({ bank_id: 'VCB', account_number: '0123456789', account_holder: 'A' });
    expect((requests[1] as { body: object }).body).toEqual({ expected_version: 1, can_receive: true });
    expect((requests[2] as { body: object }).body).toEqual({ permission_key: 'wallet.read', expected_version: 0 });
  });
});
