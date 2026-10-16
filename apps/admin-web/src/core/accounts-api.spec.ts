import { describe, expect, it } from '@jest/globals';
import { AdminAccountsApi, createAccountsSource, parseAdministratorPage, parseLockAcknowledgement, parseUserDetail, parseUserPage, scopeLabels } from './accounts-api';
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
const lifecycle = (over: Record<string, unknown> = {}) => ({
  lock_reason: null,
  locked_at: null,
  related_data: [],
  active_work: [],
  delete_effect: 'DELETE_PERMANENTLY',
  lock_blocked_reason: null,
  delete_blocked_reason: null,
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

  it('the detail carries no timeline and exactly the actions the server allows; any other shape is refused', () => {
    const detail = parseUserDetail({
      ...summary(),
      updated_at: '2026-10-02T00:00:00.000Z',
      version: 3,
      profiles: { customer: { full_name: 'Nguyễn Văn A' }, shop: { name: null, status: 'APPROVED' }, driver: { status: 'PENDING' } },
      allowed_actions: ['LOCK', 'DELETE'],
      phone_verified: false,
      lifecycle: lifecycle({ related_data: ['SHOP'], delete_effect: 'LOCK' }),
    });
    expect(detail?.allowedActions).toEqual(['LOCK', 'DELETE']);
    expect(detail?.events).toEqual([]);
    expect(detail?.version).toBe(3);
    expect(detail?.phoneVerified).toBe(false);
    expect(detail?.lifecycle).toEqual({ lockReason: null, lockedAt: null, relatedData: ['SHOP'], activeWork: [], deleteEffect: 'LOCK', lockBlockedReason: null, deleteBlockedReason: null });
    expect(detail?.profile).toEqual({ customer: { fullName: 'Nguyễn Văn A' }, shop: { name: null, state: 'APPROVED' }, driver: { state: 'PENDING' } });
    const base = { ...summary(), updated_at: '2026-10-02T00:00:00.000Z', version: 3, profiles: {}, phone_verified: true, lifecycle: lifecycle() };
    expect(parseUserDetail({ ...base, allowed_actions: [] })?.allowedActions).toEqual([]);
    expect(parseUserDetail({ ...base, allowed_actions: ['UNLOCK'] })?.allowedActions).toEqual(['UNLOCK']);
    expect(parseUserDetail({ ...base, allowed_actions: ['DELETE', 'UNLOCK'] })?.allowedActions).toEqual(['UNLOCK', 'DELETE']);
    for (const odd of [undefined, 'LOCK', ['LOCK', 'UNLOCK'], ['DELETE', 'DELETE'], ['LOCK', 'DELETE', 'UNLOCK'], ['PURGE'], [null]]) {
      expect(parseUserDetail({ ...base, allowed_actions: odd })).toBeUndefined();
    }
    expect(parseUserDetail({ ...summary(), updated_at: '2026-10-02T00:00:00.000Z', version: '3', profiles: {}, allowed_actions: [] })).toBeUndefined();
    expect(parseUserDetail({ ...summary(), updated_at: '2026-10-02T00:00:00.000Z', version: 1 })).toBeUndefined();
  });

  it('the lifecycle block is strict: lock reason, blocks, names and the delete effect have exactly the documented values', () => {
    const base = { ...summary(), updated_at: '2026-10-02T00:00:00.000Z', version: 3, profiles: {}, phone_verified: true, allowed_actions: ['UNLOCK'] };
    const locked = parseUserDetail({ ...base, lifecycle: lifecycle({ lock_reason: 'DELETE_REQUEST', locked_at: '2026-10-03T00:00:00.000Z', related_data: ['DRIVER_PROFILE'], delete_effect: 'LOCK', delete_blocked_reason: 'ALREADY_LOCKED' }) });
    expect(locked?.lifecycle).toMatchObject({ lockReason: 'DELETE_REQUEST', lockedAt: '2026-10-03T00:00:00.000Z', deleteBlockedReason: 'ALREADY_LOCKED' });
    expect(parseUserDetail({ ...base, lifecycle: lifecycle({ lock_blocked_reason: 'ACTIVE_WORK', active_work: ['ORDERS'] }) })?.lifecycle.activeWork).toEqual(['ORDERS']);
    for (const odd of [
      lifecycle({ lock_reason: 'MANUAL' }),
      lifecycle({ locked_at: 'yesterday' }),
      lifecycle({ related_data: 'SHOP' }),
      lifecycle({ related_data: ['shop'] }),
      lifecycle({ active_work: [1] }),
      lifecycle({ delete_effect: 'PURGE' }),
      lifecycle({ lock_blocked_reason: 'BUSY' }),
      lifecycle({ delete_blocked_reason: undefined }),
      'x',
      null,
    ]) {
      expect(parseUserDetail({ ...base, lifecycle: odd })).toBeUndefined();
    }
    expect(parseUserDetail({ ...base, lifecycle: lifecycle(), phone_verified: 'yes' })).toBeUndefined();
  });

  it('a lock acknowledgement is a lock/unlock one, a delete that locked, or a permanent delete; anything else is refused', () => {
    const command = '22222222-2222-4222-8222-222222222222';
    expect(parseLockAcknowledgement({ command_id: command, user_id: ID, account_status: 'DISABLED', lock_reason: 'VIOLATION', version: 5, changed_at: '2026-10-03T00:00:00.000Z' })).toEqual({ userId: ID, accountStatus: 'DISABLED', version: 5 });
    expect(parseLockAcknowledgement({ command_id: command, user_id: ID, result: 'LOCKED', account_status: 'DISABLED', version: 5, changed_at: '2026-10-03T00:00:00.000Z' })?.result).toBe('LOCKED');
    expect(parseLockAcknowledgement({ command_id: command, user_id: ID, result: 'DELETED' })).toEqual({ userId: ID, accountStatus: null, version: null, result: 'DELETED' });
    expect(parseLockAcknowledgement({ command_id: command, user_id: ID, result: 'GONE' })).toBeUndefined();
    expect(parseLockAcknowledgement({ command_id: 'x', user_id: ID, result: 'DELETED' })).toBeUndefined();
    expect(parseLockAcknowledgement({ command_id: command, user_id: ID, account_status: 'DISABLED', version: 0, changed_at: '2026-10-03T00:00:00.000Z' })).toBeUndefined();
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

const ACK = { data: { command_id: '22222222-2222-4222-8222-222222222222', user_id: ID, account_status: 'DISABLED', version: 4, changed_at: '2026-10-13T08:00:00.000Z' } };
const COMMAND = { id: ID, action: 'LOCK' as const, version: 3, reason: 'Vi phạm', key: '33333333-3333-4333-8333-333333333333' };
const port = (token: string | null = 'csrf-1') => {
  const calls = { refresh: 0 };
  return { calls, csrf: () => token ?? undefined, refresh: () => { calls.refresh += 1; return Promise.resolve(true); } };
};

describe('admin web account lock - source', () => {
  it('sends exactly one POST with the CSRF token, the idempotency key, the version and the reason - and nothing else', async () => {
    const { transport, requests } = scripted(reply(200, ACK), reply(200, { data: { ...ACK.data, account_status: 'ACTIVE', version: 5 } }));
    const source = createAccountsSource(new AdminAccountsApi(transport), port());
    expect(await source.lock(COMMAND)).toEqual({ kind: 'ok' });
    expect(await source.lock({ ...COMMAND, action: 'UNLOCK' })).toEqual({ kind: 'ok' });
    expect(requests).toEqual([
      { method: 'POST', path: `/admin/users/${ID}/lock`, body: { expected_version: 3, reason: 'Vi phạm' }, csrf: 'csrf-1', idempotencyKey: COMMAND.key },
      { method: 'POST', path: `/admin/users/${ID}/unlock`, body: { expected_version: 3, reason: 'Vi phạm' }, csrf: 'csrf-1', idempotencyKey: COMMAND.key },
    ]);
  });

  it('the category of a LOCK travels in lock_reason; a delete sends no category; a permanent delete is "deleted"', async () => {
    const deleted = { data: { command_id: '22222222-2222-4222-8222-222222222222', user_id: ID, result: 'DELETED' } };
    const { transport, requests } = scripted(reply(200, ACK), reply(200, deleted), reply(200, { data: { ...ACK.data, result: 'LOCKED' } }));
    const source = createAccountsSource(new AdminAccountsApi(transport), port());
    expect(await source.lock({ ...COMMAND, category: 'SECURITY' })).toEqual({ kind: 'ok' });
    expect(await source.lock({ ...COMMAND, action: 'DELETE', category: 'SECURITY' })).toEqual({ kind: 'deleted' });
    expect(await source.lock({ ...COMMAND, action: 'DELETE' })).toEqual({ kind: 'ok' });
    expect(requests.map((request) => [request.path, request.body])).toEqual([
      [`/admin/users/${ID}/lock`, { expected_version: 3, reason: 'Vi phạm', lock_reason: 'SECURITY' }],
      [`/admin/users/${ID}/delete`, { expected_version: 3, reason: 'Vi phạm' }],
      [`/admin/users/${ID}/delete`, { expected_version: 3, reason: 'Vi phạm' }],
    ]);
  });

  it('a lost answer, a 5xx and a malformed acknowledgement are "unknown": the command may have run, nothing is repeated by itself', async () => {
    const { transport, requests } = scripted('throw', reply(503, errorBody('TRANSACTION_OUTCOME_UNKNOWN')), reply(200, { data: { ...ACK.data, version: 0 } }), reply(409, errorBody('IDEMPOTENCY_BUSY')));
    const source = createAccountsSource(new AdminAccountsApi(transport), port());
    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect(await source.lock(COMMAND)).toEqual({ kind: 'unknown' });
    }
    expect(requests).toHaveLength(4);
  });

  it('a CSRF refusal reads a fresh token and is "unknown" so the admin retries with the SAME key', async () => {
    const session = port();
    const { transport, requests } = scripted(reply(403, errorBody('ADMIN_CSRF_INVALID')));
    expect(await createAccountsSource(new AdminAccountsApi(transport), session).lock(COMMAND)).toEqual({ kind: 'unknown' });
    expect(session.calls.refresh).toBe(1);
    expect(requests).toHaveLength(1);
  });

  it('maps every definitive refusal to its own result', async () => {
    const answers: Array<[number, string, object]> = [
      [409, 'USER_ACCOUNT_VERSION_CONFLICT', { kind: 'conflict' }],
      [409, 'USER_ACCOUNT_ALREADY_IN_STATE', { kind: 'conflict' }],
      [409, 'USER_ACCOUNT_IMPACT_REVIEW_REQUIRED', { kind: 'review-required' }],
      [409, 'USER_ACCOUNT_HAS_ACTIVE_WORK', { kind: 'has-active-work' }],
      [404, 'USER_NOT_AVAILABLE', { kind: 'not-found' }],
      [403, 'ADMIN_FORBIDDEN', { kind: 'forbidden' }],
      [401, 'ADMIN_SESSION_INVALID', { kind: 'session-expired' }],
      [400, 'ADMIN_INPUT_INVALID', { kind: 'rejected' }],
      [409, 'IDEMPOTENCY_KEY_REUSED', { kind: 'rejected' }],
    ];
    const { transport } = scripted(...answers.map(([status, code]) => reply(status, errorBody(code))));
    const source = createAccountsSource(new AdminAccountsApi(transport), port());
    for (const [, code, expected] of answers) {
      expect([code, await source.lock(COMMAND)]).toEqual([code, expected]);
    }
    const limited = scripted(reply(429, errorBody('ADMIN_AUTH_RATE_LIMITED'), { 'retry-after': '9' }));
    expect(await createAccountsSource(new AdminAccountsApi(limited.transport), port()).lock(COMMAND)).toEqual({ kind: 'rate-limited', retryAfterSec: 9 });
  });

  it('without a session token nothing is sent; without a session port the source is not wired for locking', async () => {
    const { transport, requests } = scripted(reply(200, ACK));
    expect(await createAccountsSource(new AdminAccountsApi(transport), port(null)).lock(COMMAND)).toEqual({ kind: 'session-expired' });
    expect(await createAccountsSource(new AdminAccountsApi(transport)).lock(COMMAND)).toEqual({ kind: 'not-wired' });
    expect(requests).toEqual([]);
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
