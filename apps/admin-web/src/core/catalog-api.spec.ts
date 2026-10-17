import { describe, expect, it } from '@jest/globals';
import { Transport, TransportRequest, TransportResponse } from './api';
import { AdminCatalogApi, createCatalogSource, parseCategoryPage, parseCategoryRow } from './catalog-api';
import { grantsFromPermissions } from './menu';
import { parsePermissions, scopeLabels } from './accounts-api';

const ID = '11111111-1111-4111-8111-111111111111';
const reply = (status: number, body: unknown, headers: Record<string, string> = {}): TransportResponse => ({ status, header: (name) => headers[name.toLowerCase()] ?? null, json: () => Promise.resolve(body) });
const errorBody = (code: string) => ({ error: { code, message: 'x', request_id: 'r', details: {} } });
const row = (over: Record<string, unknown> = {}) => ({ category_id: ID, name: 'Ốc', status: 'ACTIVE', sort_order: 1, version: 2, item_count: 4, updated_at: '2026-10-16T03:00:00.000Z', ...over });

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

describe('admin web dish groups - parsers', () => {
  it('maps a row and a page', () => {
    expect(parseCategoryRow(row())).toEqual({ id: ID, name: 'Ốc', sortOrder: 1, status: 'ACTIVE', itemCount: 4, version: 2, updatedAt: '2026-10-16T03:00:00.000Z' });
    expect(parseCategoryPage({ items: [row(), row({ category_id: '22222222-2222-4222-8222-222222222222', status: 'INACTIVE' })], total: 2, next_sort_order: 7 })).toMatchObject({ total: 2, nextSortOrder: 7 });
  });

  it('refuses anything that is not exactly the documented shape', () => {
    for (const bad of [{ status: 'DELETED' }, { sort_order: -1 }, { sort_order: 1.5 }, { item_count: '4' }, { version: 0 }, { name: '' }, { category_id: 'x' }, { updated_at: 'yesterday' }]) {
      expect(parseCategoryRow(row(bad))).toBeUndefined();
    }
    expect(parseCategoryPage({ items: [row({ status: 'X' })], total: 1, next_sort_order: 0 })).toBeUndefined();
    expect(parseCategoryPage({ items: [], total: -1, next_sort_order: 0 })).toBeUndefined();
    expect(parseCategoryPage({ items: 'no', total: 0, next_sort_order: 0 })).toBeUndefined();
  });
});

describe('admin web dish groups - requests', () => {
  it('lists with the search, the status filter and the page as limit/offset', async () => {
    const { transport, requests } = scripted(reply(200, { data: { items: [row()], total: 11, next_sort_order: 3 } }));
    const source = createCatalogSource(new AdminCatalogApi(transport));
    const read = await source.list({ query: '  ốc  ', status: 'ACTIVE', page: 2 });
    expect(read).toMatchObject({ kind: 'ready', total: 11, nextSortOrder: 3 });
    expect(requests[0]).toMatchObject({ method: 'GET', path: '/admin/menu-categories?q=%E1%BB%91c&status=ACTIVE&limit=10&offset=10' });
    const all = scripted(reply(200, { data: { items: [], total: 0, next_sort_order: 0 } }));
    await createCatalogSource(new AdminCatalogApi(all.transport)).list({ query: '', status: 'ALL', page: 1 });
    expect(all.requests[0]?.path).toBe('/admin/menu-categories?limit=10&offset=0');
  });

  it('maps a failed read to a failure the page can show', async () => {
    for (const [answer, failure] of [[reply(401, errorBody('ADMIN_SESSION_INVALID')), 'session-expired'], [reply(403, errorBody('ADMIN_FORBIDDEN')), 'forbidden'], ['throw', 'offline'], [reply(500, errorBody('INTERNAL')), 'unknown']] as const) {
      const { transport } = scripted(answer);
      expect(await createCatalogSource(new AdminCatalogApi(transport)).list({ query: '', status: 'ALL', page: 1 })).toMatchObject({ kind: 'failed', failure });
    }
    const { transport } = scripted(reply(200, { data: { items: [{}], total: 1, next_sort_order: 0 } }));
    expect((await createCatalogSource(new AdminCatalogApi(transport)).list({ query: '', status: 'ALL', page: 1 })).kind).toBe('failed');
  });

  it('create: one POST with the key, the CSRF token and no order when the admin left it empty; 201 is success', async () => {
    const { transport, requests } = scripted(reply(201, { data: row() }));
    const s = session();
    const result = await createCatalogSource(new AdminCatalogApi(transport), s.port).save({ kind: 'create', name: 'Ốc', sortOrder: null, status: 'ACTIVE', key: 'k-1' });
    expect(result).toEqual({ kind: 'ok' });
    expect(requests).toEqual([{ method: 'POST', path: '/admin/menu-categories', body: { name: 'Ốc', status: 'ACTIVE' }, csrf: 'csrf-1', idempotencyKey: 'k-1' }]);
    const explicit = scripted(reply(201, { data: row() }));
    await createCatalogSource(new AdminCatalogApi(explicit.transport), session().port).save({ kind: 'create', name: 'Ốc', sortOrder: 0, status: 'INACTIVE', key: 'k-2' });
    expect(explicit.requests[0]?.body).toEqual({ name: 'Ốc', status: 'INACTIVE', sort_order: 0 });
  });

  it('update: one POST to the group with the version, all three fields and the key', async () => {
    const { transport, requests } = scripted(reply(200, { data: row({ version: 3 }) }));
    const result = await createCatalogSource(new AdminCatalogApi(transport), session().port).save({ kind: 'update', id: ID, version: 2, name: 'Ốc', sortOrder: 5, status: 'INACTIVE', key: 'k-3' });
    expect(result).toEqual({ kind: 'ok' });
    expect(requests).toEqual([{ method: 'POST', path: `/admin/menu-categories/${ID}`, body: { expected_version: 2, name: 'Ốc', sort_order: 5, status: 'INACTIVE' }, csrf: 'csrf-1', idempotencyKey: 'k-3' }]);
  });

  it('answers: a lost answer or a server fault is UNKNOWN (never a failure); a refusal is named', async () => {
    const cases: readonly (readonly [TransportResponse | 'throw', string])[] = [
      ['throw', 'unknown'],
      [reply(503, errorBody('TRANSACTION_OUTCOME_UNKNOWN')), 'unknown'],
      [reply(500, errorBody('INTERNAL')), 'unknown'],
      [reply(409, errorBody('IDEMPOTENCY_BUSY')), 'unknown'],
      [reply(200, { data: { nonsense: true } }), 'unknown'],
      [reply(401, errorBody('ADMIN_SESSION_INVALID')), 'session-expired'],
      [reply(403, errorBody('ADMIN_FORBIDDEN')), 'forbidden'],
      [reply(409, errorBody('MENU_CATEGORY_VERSION_CONFLICT')), 'conflict'],
      [reply(404, errorBody('MENU_CATEGORY_NOT_FOUND')), 'not-found'],
      [reply(400, errorBody('ADMIN_INPUT_INVALID')), 'rejected'],
      [reply(429, errorBody('ADMIN_AUTH_RATE_LIMITED'), { 'retry-after': '30' }), 'rate-limited'],
    ];
    for (const [answer, kind] of cases) {
      const { transport } = scripted(answer);
      const result = await createCatalogSource(new AdminCatalogApi(transport), session().port).save({ kind: 'update', id: ID, version: 1, name: 'A', sortOrder: 0, status: 'ACTIVE', key: 'k' });
      expect(result.kind).toBe(kind);
    }
    const taken = scripted(reply(409, errorBody('MENU_CATEGORY_NAME_TAKEN')), reply(409, errorBody('MENU_CATEGORY_NAME_TAKEN_INACTIVE')));
    const source = createCatalogSource(new AdminCatalogApi(taken.transport), session().port);
    expect(await source.save({ kind: 'create', name: 'A', sortOrder: null, status: 'ACTIVE', key: 'k' })).toEqual({ kind: 'name-taken', inactive: false });
    expect(await source.save({ kind: 'create', name: 'A', sortOrder: null, status: 'ACTIVE', key: 'k' })).toEqual({ kind: 'name-taken', inactive: true });
  });

  it('a refused CSRF token reads a fresh one and is reported as unknown, so the SAME key is retried; no token at all is a lost session', async () => {
    const { transport } = scripted(reply(403, errorBody('ADMIN_CSRF_INVALID')));
    const s = session();
    const result = await createCatalogSource(new AdminCatalogApi(transport), s.port).save({ kind: 'create', name: 'A', sortOrder: null, status: 'ACTIVE', key: 'k' });
    expect(result.kind).toBe('unknown');
    expect(s.refreshed()).toBe(1);
    const none = scripted();
    expect(await createCatalogSource(new AdminCatalogApi(none.transport), session(null).port).save({ kind: 'create', name: 'A', sortOrder: null, status: 'ACTIVE', key: 'k' })).toEqual({ kind: 'session-expired' });
    expect(none.requests).toHaveLength(0);
    expect(await createCatalogSource(new AdminCatalogApi(none.transport)).save({ kind: 'create', name: 'A', sortOrder: null, status: 'ACTIVE', key: 'k' })).toEqual({ kind: 'not-wired' });
  });
});

describe('admin web - the catalog right', () => {
  const perm = (app: string, over: Record<string, unknown> = {}) => ({ app, can_view: true, can_review_profile: false, can_lock: false, ...over });

  it('reads can_manage_catalog (absent = false) and refuses a non-boolean', () => {
    const parsed = parsePermissions({ admin_role: 'ADMIN', permissions: [perm('SHOP', { can_manage_catalog: true }), perm('CUSTOMER')] });
    expect(parsed?.permissions).toEqual([
      { app: 'SHOP', canView: true, canReviewProfile: false, canLock: false, canManageCatalog: true },
      { app: 'CUSTOMER', canView: true, canReviewProfile: false, canLock: false },
    ]);
    expect(parsePermissions({ admin_role: 'ADMIN', permissions: [perm('SHOP', { can_manage_catalog: 'yes' })] })).toBeUndefined();
  });

  it('opens "Nhóm món" only for a SHOP row that can view AND manage the catalog', () => {
    const base = { app: 'SHOP' as const, canView: true, canReviewProfile: false, canLock: false };
    expect(grantsFromPermissions([{ ...base, canManageCatalog: true }]).has('catalog')).toBe(true);
    expect(grantsFromPermissions([base]).has('catalog')).toBe(false);
    expect(grantsFromPermissions([{ ...base, canView: false, canManageCatalog: true }]).has('catalog')).toBe(false);
    expect(grantsFromPermissions([{ ...base, app: 'CUSTOMER', canManageCatalog: true }]).has('catalog')).toBe(false);
  });

  it('shows the right in the scope of an administrator', () => {
    expect(scopeLabels([{ app: 'SHOP', canView: true, canReviewProfile: false, canLock: false, canManageCatalog: true }])).toEqual(['Chủ quán: Xem, Nhóm món']);
  });
});
