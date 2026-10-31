import { describe, expect, it } from '@jest/globals';
import { Transport, TransportRequest, TransportResponse } from './api';
import { AdminShipperApi, createShipperSource, parseDetail, parsePage, parseRow, parseWalletParameters } from './shippers-api';
import { formatVnd, parseVnd, standing } from './shippers';
import { allLeaves, canOpenRoute, visibleMenu } from './menu';
import { formatRoute, parseRoute } from './routes';

const ID = '11111111-1111-4111-8111-111111111111';
const reply = (status: number, body: unknown, headers: Record<string, string> = {}): TransportResponse => ({ status, header: (name) => headers[name.toLowerCase()] ?? null, json: () => Promise.resolve(body) });
const errorBody = (code: string) => ({ error: { code, message: 'x', request_id: 'r', details: {} } });
const listRow = (over: Record<string, unknown> = {}) => ({
  driver_id: ID, shipper_code: 'SH000001', full_name: 'Nguyễn Văn A', phone: '+84901234567', driver_type: 'EXTERNAL', status: 'PENDING', review_state: 'SUBMITTED',
  accepting_deliveries: false, bank_state: 'UNVERIFIED', bank_name: 'Vietcombank', updated_at: '2026-10-17T03:00:00.000Z', version: 2, ...over,
});
const detail = (over: Record<string, unknown> = {}) => ({
  driver_id: ID, shipper_code: 'SH000001', full_name: 'Nguyễn Văn A', phone: '+84901234567', plate_number: null, driver_type: 'PLATFORM', status: 'PENDING', review_state: 'SUBMITTED',
  rejection_reason: null, suspension_reason: null, submitted_at: '2026-10-17T03:00:00.000Z', accepting_deliveries: false, version: 3, created_at: '2026-10-16T03:00:00.000Z',
  bank: { bank_code: 'VCB', bank_name: 'Vietcombank', account_number: '0123456789', account_holder: 'NGUYEN VAN A', verification_state: 'UNVERIFIED', rejection_reason: null, verified_at: null },
  readiness: { profile_approved: false, bank_verified: false, wallet_ready: false, blocks: ['PROFILE_NOT_APPROVED'], can_accept: false }, closure: null,
  history: [{ event_id: '22222222-2222-4222-8222-222222222222', event_type: 'driver.submitted', actor_type: 'DRIVER', reason: null, created_at: '2026-10-17T03:00:00.000Z' }], ...over,
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

describe('admin web Shippers - parsers', () => {
  it('maps a row, a page and a detail (the classification is read only here)', () => {
    expect(parseRow(listRow())).toMatchObject({ id: ID, code: 'SH000001', driverType: 'EXTERNAL', reviewState: 'SUBMITTED', bankState: 'UNVERIFIED' });
    expect(parseRow(listRow({ bank_state: null, bank_name: null }))).toMatchObject({ bankState: null, bankName: null });
    expect(parsePage({ items: [listRow()], total: 1 })).toMatchObject({ total: 1 });
    const parsed = parseDetail(detail());
    expect(parsed).toMatchObject({ id: ID, driverType: 'PLATFORM', version: 3, blocks: ['PROFILE_NOT_APPROVED'], canAccept: false });
    expect(parsed?.bank).toMatchObject({ accountNumber: '0123456789', state: 'UNVERIFIED' });
    expect(parsed?.history[0]).toMatchObject({ type: 'driver.submitted', actor: 'DRIVER' });
  });

  it('refuses anything that is not exactly the documented shape', () => {
    for (const bad of [{ status: 'DELETED' }, { review_state: 'X' }, { driver_type: 'SYSTEM' }, { bank_state: 'X' }, { driver_id: 'x' }, { updated_at: 'yesterday' }, { accepting_deliveries: 'no' }]) {
      expect(parseRow(listRow(bad))).toBeUndefined();
    }
    for (const bad of [{ version: 0 }, { bank: { bank_code: 'VCB' } }, { readiness: { blocks: 'x' } }, { history: [{ event_id: 'x' }] }, { driver_type: 'X' }, { closure: 5 }]) {
      expect(parseDetail(detail(bad))).toBeUndefined();
    }
    expect(parsePage({ items: [listRow({ status: 'X' })], total: 1 })).toBeUndefined();
    expect(parsePage({ items: 'no', total: 0 })).toBeUndefined();
  });

  it('reads the wallet parameters and refuses a zero, a decimal or a missing history', () => {
    const ok = { version: 2, topup_min_vnd: 100000, withdraw_min_vnd: 10000, updated_at: null, history: [] };
    expect(parseWalletParameters(ok)).toMatchObject({ version: 2, topupMinVnd: 100000, withdrawMinVnd: 10000 });
    for (const bad of [{ topup_min_vnd: 0 }, { withdraw_min_vnd: 1.5 }, { history: 'x' }, { updated_at: 'x' }]) {
      expect(parseWalletParameters({ ...ok, ...bad })).toBeUndefined();
    }
  });
});

describe('admin web Shippers - requests', () => {
  it('lists with the search, the status and the page as limit/offset', async () => {
    const { transport, requests } = scripted(reply(200, { data: { items: [listRow()], total: 41 } }));
    const read = await createShipperSource(new AdminShipperApi(transport)).list({ query: '  0912  ', status: 'SUBMITTED', page: 2 });
    expect(read).toMatchObject({ kind: 'ready', total: 41 });
    expect(requests[0]).toMatchObject({ method: 'GET', path: '/admin/shippers?q=0912&status=SUBMITTED&limit=20&offset=20' });
  });

  it('a command carries the version, the reason and a key, and maps every answer to a result the page can show', async () => {
    const s = session();
    const ok = scripted(reply(200, { data: detail() }));
    const result = await createShipperSource(new AdminShipperApi(ok.transport), s.port).command({ id: ID, name: 'reject', version: 3, reason: 'Sai tên', key: 'key-1' });
    expect(result).toEqual({ kind: 'ok' });
    expect(ok.requests[0]).toMatchObject({ method: 'POST', path: `/admin/shippers/${ID}/reject`, body: { expected_version: 3, reason: 'Sai tên' }, csrf: 'csrf-1', idempotencyKey: 'key-1' });
    const table: Array<[TransportResponse | 'throw', unknown]> = [
      [reply(409, errorBody('VERSION_CONFLICT')), { kind: 'conflict' }],
      [reply(401, errorBody('ADMIN_SESSION_INVALID')), { kind: 'session-expired' }],
      [reply(403, errorBody('ADMIN_FORBIDDEN')), { kind: 'forbidden' }],
      [reply(409, errorBody('DRIVER_WALLET_NOT_SETTLED')), { kind: 'refused', code: 'DRIVER_WALLET_NOT_SETTLED' }],
      [reply(403, errorBody('DRIVER_SELF_ACTION_FORBIDDEN')), { kind: 'refused', code: 'DRIVER_SELF_ACTION_FORBIDDEN' }],
      [reply(429, errorBody('ADMIN_AUTH_RATE_LIMITED'), { 'retry-after': '30' }), { kind: 'rate-limited', retryAfterSec: 30 }],
      [reply(503, errorBody('TRANSACTION_OUTCOME_UNKNOWN')), { kind: 'unknown' }],
      ['throw', { kind: 'unknown' }],
    ];
    for (const [answer, expected] of table) {
      const { transport } = scripted(answer);
      expect(await createShipperSource(new AdminShipperApi(transport), session().port).command({ id: ID, name: 'approve', version: 3, key: 'k' })).toEqual(expected);
    }
  });

  it('a stale CSRF token is refreshed and the same key is offered again; no session means no request', async () => {
    const s = session();
    const { transport } = scripted(reply(403, errorBody('ADMIN_CSRF_INVALID')));
    expect(await createShipperSource(new AdminShipperApi(transport), s.port).command({ id: ID, name: 'approve', version: 3, key: 'k' })).toEqual({ kind: 'unknown' });
    expect(s.refreshed()).toBe(1);
    const none = scripted();
    expect(await createShipperSource(new AdminShipperApi(none.transport), session(null).port).command({ id: ID, name: 'approve', version: 3, key: 'k' })).toEqual({ kind: 'session-expired' });
    expect(none.requests).toHaveLength(0);
  });

  it('saves the wallet parameters with the pair version and maps a stale screen to a conflict', async () => {
    const saved = scripted(reply(200, { data: { version: 4, topup_min_vnd: 150000, withdraw_min_vnd: 20000, updated_at: '2026-10-17T03:00:00.000Z', history: [] } }));
    expect(await createShipperSource(new AdminShipperApi(saved.transport), session().port).saveWalletParameters({ version: 2, topupMinVnd: 150000, withdrawMinVnd: 20000, key: 'k' })).toEqual({ kind: 'ok' });
    expect(saved.requests[0]).toMatchObject({ method: 'POST', path: '/admin/system-settings/shipper-wallet', body: { expected_version: 2, topup_min_vnd: 150000, withdraw_min_vnd: 20000 } });
    const stale = scripted(reply(409, errorBody('WALLET_PARAMETER_VERSION_CONFLICT')));
    expect(await createShipperSource(new AdminShipperApi(stale.transport), session().port).saveWalletParameters({ version: 2, topupMinVnd: 1, withdrawMinVnd: 1, key: 'k' })).toEqual({ kind: 'conflict' });
  });
});

describe('admin web Shippers - model, routes and menu', () => {
  it('turns what a person types into whole VND, and nothing else', () => {
    expect(parseVnd('100000')).toBe(100000);
    expect(parseVnd(' 100.000 ')).toBe(100000);
    for (const bad of ['', '0', '-5', '1.5e3', '12,5', 'abc', '1000000001', '10 000 000 000']) {
      expect(parseVnd(bad)).toBeUndefined();
    }
    expect(formatVnd(100000)).toContain('100');
  });

  it('labels the standing from status and review state', () => {
    expect(standing('PENDING', 'SUBMITTED').label).toBe('Chờ xét duyệt');
    expect(standing('PENDING', 'REJECTED').tone).toBe('lock');
    expect(standing('ACTIVE', 'APPROVED').tone).toBe('ok');
    expect(standing('SUSPENDED', 'APPROVED').label).toBe('Tạm khóa');
  });

  it('tells a closure asked from a suspension apart: still locked, closing only to hand the balance back', () => {
    expect(standing('CLOSING', 'APPROVED').label).toBe('Xin ngừng hoạt động');
    expect(standing('CLOSING', 'APPROVED', 'ACTIVE').label).toBe('Xin ngừng hoạt động');
    expect(standing('CLOSING', 'APPROVED', 'SUSPENDED')).toEqual({ label: 'Đang đóng để hoàn tiền (vẫn bị khóa)', tone: 'lock' });
  });

  it('reads where the closure was asked from and keeps the suspension reason of a locked Shipper that is closing', () => {
    const from = (status: unknown) => parseDetail(detail({ status: 'CLOSING', suspension_reason: 'Khiếu nại', closure: { requested_at: '2026-10-18T03:00:00.000Z', note: null, can_cancel: true, from_status: status } }));
    expect(from('SUSPENDED')).toMatchObject({ status: 'CLOSING', closureFromStatus: 'SUSPENDED', suspensionReason: 'Khiếu nại' });
    expect(from('ACTIVE')?.closureFromStatus).toBe('ACTIVE');
    expect(from('CLOSED')?.closureFromStatus).toBeNull();
    expect(parseDetail(detail())?.closureFromStatus).toBeNull();
  });

  it('parses and formats the routes', () => {
    expect(parseRoute('/operations/shippers')).toEqual({ name: 'shippers' });
    expect(parseRoute('/operations/shippers', '?status=SUBMITTED')).toEqual({ name: 'shippers', status: 'SUBMITTED' });
    expect(parseRoute('/operations/shippers', '?status=NOPE')).toEqual({ name: 'shippers' });
    expect(parseRoute(`/operations/shippers/${ID}`)).toEqual({ name: 'shipper', id: ID });
    expect(parseRoute('/operations/shippers/x')).toEqual({ name: 'home' });
    expect(parseRoute('/system/parameters/shipper-wallet')).toEqual({ name: 'wallet-parameters' });
    for (const route of [{ name: 'shippers' as const }, { name: 'shipper' as const, id: ID }, { name: 'wallet-parameters' as const }]) {
      expect(parseRoute(formatRoute(route))).toEqual(route);
    }
  });

  it('shows the Shipper entry to SYSTEM and to an ADMIN with the DRIVER view right, and the parameters to every administrator (only SYSTEM edits)', () => {
    const labels = (role: 'SYSTEM' | 'ADMIN', grants: ReadonlySet<'drivers' | 'users'>) => allLeaves().filter((leaf) => visibleMenu(role, grants as never).some((g) => g.items.some((i) => i.id === leaf.id || i.children?.some((c) => c.id === leaf.id)))).map((leaf) => leaf.id);
    expect(labels('SYSTEM', new Set())).toEqual(expect.arrayContaining(['drivers', 'parameters-shipper-wallet']));
    expect(labels('ADMIN', new Set(['drivers']))).toContain('drivers');
    // Every administrator sees the parameters, whatever it was granted; SYSTEM alone edits them (the server decides).
    expect(labels('ADMIN', new Set(['drivers']))).toContain('parameters-shipper-wallet');
    expect(labels('ADMIN', new Set())).toContain('parameters-shipper-wallet');
    expect(labels('ADMIN', new Set(['users']))).not.toContain('drivers');
    expect(canOpenRoute('ADMIN', new Set(['drivers']) as never, { name: 'wallet-parameters' })).toBe(true);
    expect(canOpenRoute('ADMIN', new Set() as never, { name: 'wallet-parameters' })).toBe(true);
    expect(canOpenRoute('ADMIN', new Set(['drivers']) as never, { name: 'shippers' })).toBe(true);
    expect(canOpenRoute('ADMIN', new Set() as never, { name: 'shipper', id: ID })).toBe(false);
  });
});
