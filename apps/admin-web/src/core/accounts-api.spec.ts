import { describe, expect, it } from '@jest/globals';
import { AdminAccountsApi, createAccountsSource, parseAdministratorPage, parseUserDetail, parseUserPage, scopeLabels } from './accounts-api';
import { EMPTY_ADMIN_FILTER, EMPTY_USER_FILTER } from './accounts';
import { Transport, TransportRequest, TransportResponse } from './api';
import { grantsFromPermissions } from './menu';

const ID = '11111111-1111-4111-8111-111111111111';

function reply(status: number, body: unknown, headers: Record<string, string> = {}): TransportResponse {
  return { status, header: (name) => headers[name.toLowerCase()] ?? null, json: () => Promise.resolve(body) };
}

/** Answers in order and records the requests. */
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

const errorBody = (code: string) => ({ error: { code, message: 'x', request_id: 'r', details: {} } });
const summary = (over: Record<string, unknown> = {}) => ({
  user_id: ID,
  display_name: 'Nguyễn Văn A',
  phone_masked: '+84•••••678',
  roles_visible: ['CUSTOMER', 'SHOP_OWNER'],
  account_status: 'ACTIVE',
  created_at: '2026-10-01T03:04:05.123Z',
  ...over,
});
const perm = (app: string, view: boolean, review = false, lock = false) => ({ app, can_view: view, can_review_profile: review, can_lock: lock });

describe('admin web account read - parsers', () => {
  it('maps a user page: DISABLED shows as LOCKED, a blank name as null, roles as given', () => {
    const page = parseUserPage({ items: [summary(), summary({ display_name: null, account_status: 'DISABLED', roles_visible: ['DRIVER'] })], next_cursor: 'abc', available_role_filters: ['CUSTOMER', 'DRIVER'] });
    expect(page?.nextCursor).toBe('abc');
    expect(page?.roleFilters).toEqual(['CUSTOMER', 'DRIVER']);
    expect(page?.items[0]).toEqual({ id: ID, fullName: 'Nguyễn Văn A', phoneMasked: '+84•••••678', roles: ['CUSTOMER', 'SHOP_OWNER'], status: 'ACTIVE', createdAt: '2026-10-01T03:04:05.123Z' });
    expect(page?.items[1]).toMatchObject({ fullName: null, status: 'LOCKED', roles: ['DRIVER'] });
  });

  it('refuses a page with an unknown role, an unknown status, a bad date or a missing cursor field', () => {
    const base = { items: [summary()], next_cursor: null, available_role_filters: [] };
    expect(parseUserPage(base)?.nextCursor).toBeNull();
    expect(parseUserPage({ ...base, items: [summary({ roles_visible: ['ADMIN'] })] })).toBeUndefined();
    expect(parseUserPage({ ...base, items: [summary({ account_status: 'LOCKED' })] })).toBeUndefined();
    expect(parseUserPage({ ...base, items: [summary({ created_at: 'yesterday' })] })).toBeUndefined();
    expect(parseUserPage({ items: [summary()], available_role_filters: [] })).toBeUndefined();
    expect(parseUserPage({ ...base, items: 'x' })).toBeUndefined();
  });

  it('the detail never enables an action and carries no timeline, whatever the server lists', () => {
    const detail = parseUserDetail({
      ...summary(),
      updated_at: '2026-10-02T00:00:00.000Z',
      version: 3,
      profiles: { customer: { full_name: 'Nguyễn Văn A' }, shop: { name: null, status: 'APPROVED' }, driver: { status: 'PENDING' } },
      allowed_actions: ['LOCK'],
    });
    expect(detail?.allowedActions).toEqual([]);
    expect(detail?.events).toEqual([]);
    expect(detail?.version).toBe(3);
    expect(detail?.profile).toEqual({ customer: { fullName: 'Nguyễn Văn A' }, shop: { name: null, state: 'APPROVED' }, driver: { state: 'PENDING' } });
    expect(parseUserDetail({ ...summary(), updated_at: '2026-10-02T00:00:00.000Z', version: '3', profiles: {} })).toBeUndefined();
    expect(parseUserDetail({ ...summary(), updated_at: '2026-10-02T00:00:00.000Z', version: 1 })).toBeUndefined();
  });

  it('administrators: scopes in words, DISABLED as LOCKED, only ADMIN rows, no rights = "Chưa cấp quyền"', () => {
    const row = (over: Record<string, unknown> = {}) => ({
      user_id: ID,
      full_name: 'Trần B',
      phone_masked: '+84•••••111',
      admin_role: 'ADMIN',
      status: 'DISABLED',
      permissions: [perm('CUSTOMER', true, false, true), perm('SHOP', false), perm('DRIVER', true, true)],
      created_at: '2026-10-01T00:00:00.000Z',
      ...over,
    });
    const page = parseAdministratorPage({ items: [row()], next_cursor: null });
    expect(page?.items[0]).toMatchObject({ fullName: 'Trần B', status: 'LOCKED', scopes: ['Khách hàng: Xem, Khóa', 'Xế: Xem, Duyệt hồ sơ'] });
    expect(scopeLabels([{ app: 'SHOP', canView: false, canReviewProfile: false, canLock: false }])).toEqual(['Chưa cấp quyền']);
    expect(parseAdministratorPage({ items: [row({ admin_role: 'SYSTEM' })], next_cursor: null })).toBeUndefined();
    expect(parseAdministratorPage({ items: [row({ status: 'PENDING' })], next_cursor: null })).toBeUndefined();
    expect(parseAdministratorPage({ items: [row({ permissions: [perm('CUSTOMER', true), perm('CUSTOMER', true)] })], next_cursor: null })).toBeUndefined();
  });
});

describe('admin web account read - menu grants', () => {
  it('CUSTOMER -> users, SHOP -> users+shops, DRIVER -> users+drivers; review/lock open nothing; no view = nothing', () => {
    const asked = (app: 'CUSTOMER' | 'SHOP' | 'DRIVER', canView: boolean, canLock = false) => ({ app, canView, canReviewProfile: canLock, canLock });
    expect([...grantsFromPermissions([asked('CUSTOMER', true)])]).toEqual(['users']);
    expect([...grantsFromPermissions([asked('SHOP', true)])].sort()).toEqual(['shops', 'users']);
    expect([...grantsFromPermissions([asked('DRIVER', true), asked('SHOP', false)])].sort()).toEqual(['drivers', 'users']);
    expect([...grantsFromPermissions([asked('CUSTOMER', false, true), asked('SHOP', false, true)])]).toEqual([]);
  });
});

describe('admin web account read - source', () => {
  it('grants: parsed from the permissions answer; roles follow can_view; a malformed or failed answer grants nothing', async () => {
    const good = scripted(reply(200, { data: { admin_role: 'ADMIN', permissions: [perm('CUSTOMER', true), perm('SHOP', false), perm('DRIVER', true)] } }));
    const result = await createAccountsSource(new AdminAccountsApi(good.transport)).grants();
    expect(good.requests).toEqual([{ method: 'GET', path: '/admin-auth/permissions' }]);
    expect(result.kind === 'ok' && [...result.grants].sort()).toEqual(['drivers', 'users']);
    expect(result.kind === 'ok' && result.roles).toEqual(['CUSTOMER', 'DRIVER']);
    const bad = await createAccountsSource(new AdminAccountsApi(scripted(reply(200, { data: { admin_role: 'ADMIN', permissions: [{ app: 'SHOP' }] } })).transport)).grants();
    expect(bad).toEqual({ kind: 'failed', failure: 'offline' });
    const gone = await createAccountsSource(new AdminAccountsApi(scripted(reply(401, errorBody('ADMIN_SESSION_INVALID'))).transport)).grants();
    expect(gone).toEqual({ kind: 'failed', failure: 'session-expired' });
  });

  it('users: query string carries trimmed q, role, mapped status, limit and cursor - and nothing for "all"', async () => {
    const answer = reply(200, { data: { items: [], next_cursor: null, available_role_filters: [] } });
    const { transport, requests } = scripted(answer, answer);
    const source = createAccountsSource(new AdminAccountsApi(transport));
    expect(await source.users(EMPTY_USER_FILTER, null)).toEqual({ kind: 'empty' });
    await source.users({ query: '  nguyen & a%_ ', role: 'SHOP_OWNER', status: 'LOCKED' }, 'cur/+=');
    expect(requests[0]?.path).toBe('/admin/users?limit=20');
    expect(requests[1]?.path).toBe('/admin/users?q=nguyen%20%26%20a%25_&role=SHOP_OWNER&status=DISABLED&limit=20&cursor=cur%2F%2B%3D');
  });

  it('rows carry the next cursor; a cursor the server refuses (400) becomes "cursor-invalid", but only when one was sent', async () => {
    const page = reply(200, { data: { items: [summary()], next_cursor: 'next', available_role_filters: ['CUSTOMER'] } });
    const refused = reply(400, errorBody('ADMIN_INPUT_INVALID'));
    const { transport } = scripted(page, refused, refused);
    const source = createAccountsSource(new AdminAccountsApi(transport));
    const first = await source.users(EMPTY_USER_FILTER, null);
    expect(first.kind === 'rows' && first.nextCursor).toBe('next');
    expect(await source.users(EMPTY_USER_FILTER, 'old')).toEqual({ kind: 'cursor-invalid' });
    expect(await source.users(EMPTY_USER_FILTER, null)).toEqual({ kind: 'failed', failure: 'unknown' });
  });

  it('failures: 401 session-expired, 403 forbidden, 429 with Retry-After, lost answer offline; detail 404 USER_NOT_AVAILABLE is not-found', async () => {
    const { transport } = scripted(
      reply(401, errorBody('ADMIN_SESSION_INVALID')),
      reply(403, errorBody('ADMIN_FORBIDDEN')),
      reply(429, errorBody('RATE_LIMITED'), { 'retry-after': '7' }),
      'throw',
      reply(404, errorBody('USER_NOT_AVAILABLE')),
      reply(404, errorBody('NOT_FOUND')),
    );
    const source = createAccountsSource(new AdminAccountsApi(transport));
    expect(await source.users(EMPTY_USER_FILTER, null)).toEqual({ kind: 'failed', failure: 'session-expired' });
    expect(await source.users(EMPTY_USER_FILTER, null)).toEqual({ kind: 'failed', failure: 'forbidden' });
    expect(await source.users(EMPTY_USER_FILTER, null)).toEqual({ kind: 'failed', failure: 'rate-limited', retryAfterSec: 7 });
    expect(await source.users(EMPTY_USER_FILTER, null)).toEqual({ kind: 'failed', failure: 'offline' });
    expect(await source.user(ID)).toEqual({ kind: 'not-found' });
    expect(await source.user(ID)).toEqual({ kind: 'failed', failure: 'unknown' });
  });

  it('administrators: the pending filter is never sent; LOCKED maps to DISABLED; the id is encoded in the detail path', async () => {
    const answer = reply(200, { data: { items: [], next_cursor: null } });
    const { transport, requests } = scripted(answer, answer, reply(200, { data: {} }));
    const source = createAccountsSource(new AdminAccountsApi(transport));
    await source.administrators({ query: 'an', status: 'PENDING' }, null);
    await source.administrators({ ...EMPTY_ADMIN_FILTER, status: 'LOCKED' }, null);
    await source.user('a/b');
    expect(requests.map((request) => request.path)).toEqual(['/admin/administrators?q=an&limit=20', '/admin/administrators?status=DISABLED&limit=20', '/admin/users/a%2Fb']);
  });
});
