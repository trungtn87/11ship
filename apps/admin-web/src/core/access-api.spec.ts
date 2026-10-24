import { describe, expect, it } from '@jest/globals';
import { Transport, TransportRequest, TransportResponse } from './api';
import { AdminAccessApi, createAccessSource, parseAdministrator, parseMatrix } from './access-api';
import { NOT_WIRED_ACCESS } from './access';
import { canOpenRoute, visibleMenu } from './menu';
import { parseRoute } from './routes';

const ID = '11111111-1111-4111-8111-111111111111';
const reply = (status: number, body: unknown): TransportResponse => ({ status, header: () => null, json: () => Promise.resolve(body) });
const admin = (over: Record<string, unknown> = {}) => ({
  user_id: ID, full_name: 'Quản trị A', phone_masked: '09•• ••• 839', status: 'ACTIVE', membership_status: 'ACTIVE', membership_version: 3, created_at: '2026-10-18T09:00:00.000Z', live_sessions: 1, last_login_at: null,
  permissions: [{ app: 'DRIVER', can_view: true, can_review_profile: false, can_lock: false, can_manage_catalog: false, can_manage_shops: false }], permissions_fingerprint: 'a'.repeat(32),
  rights: [{ permission_key: 'report.read', state: 'GRANTED', version: 1 }, { permission_key: 'audit.read', state: 'NONE', version: 0 }], ...over,
});
function scripted(...answers: (TransportResponse | 'throw')[]): { transport: Transport; requests: TransportRequest[] } {
  const requests: TransportRequest[] = [];
  const queue = [...answers];
  return { requests, transport: (request) => { requests.push(request); const next = queue.shift(); return next === 'throw' || next === undefined ? Promise.reject(new Error('down')) : Promise.resolve(next); } };
}
const session = (csrf: string | null = 'csrf-1') => { let refreshed = 0; return { port: { csrf: () => csrf ?? undefined, refresh: () => { refreshed += 1; return Promise.resolve(true); } }, refreshed: () => refreshed }; };

describe('M12-C access - parsers and source', () => {
  it('maps an administrator and refuses a half-valid one', () => {
    expect(parseAdministrator(admin())).toMatchObject({ userId: ID, status: 'ACTIVE', membershipVersion: 3, fingerprint: 'a'.repeat(32) });
    expect(parseAdministrator(admin())?.rights.map((r) => [r.key, r.granted])).toEqual([['report.read', true], ['audit.read', false]]);
    for (const bad of [admin({ status: 'MAYBE' }), admin({ membership_version: -1 }), admin({ permissions: [{ app: 'OTHER' }] }), admin({ rights: [{ permission_key: 'wallet.adjustment.post', state: 'GRANTED', version: 1 }] }), admin({ user_id: 'x' })]) {
      expect(parseAdministrator(bad)).toBeUndefined();
    }
    expect(parseMatrix({ items: [admin()], truncated: false })?.items).toHaveLength(1);
    expect(parseMatrix({ items: [admin({ status: 'x' })], truncated: false })).toBeUndefined();
  });

  it('sends one request per command with the key, the right body and the token; a lost answer is "unknown" and a stale one "conflict"', async () => {
    const calls = scripted(reply(200, { data: { user_id: ID } }), reply(200, { data: { user_id: ID } }), reply(409, { error: { code: 'ADMIN_ACCESS_VERSION_CONFLICT' } }), 'throw', reply(403, { error: { code: 'ADMIN_FORBIDDEN' } }), reply(401, { error: { code: 'ADMIN_SESSION_INVALID' } }));
    const s = session();
    const source = createAccessSource(new AdminAccessApi(calls.transport), s.port);
    expect(await source.command({ name: 'lock', userId: ID, version: 3, reason: 'r', key: 'k1' })).toEqual({ kind: 'ok' });
    expect(await source.command({ name: 'grant', userId: ID, right: 'report.read', version: 0, key: 'k2' })).toEqual({ kind: 'ok' });
    expect(await source.command({ name: 'permissions', userId: ID, permissions: [{ app: 'DRIVER', canView: true, canReviewProfile: false, canLock: false, canManageCatalog: false, canManageShops: false }], fingerprint: 'f'.repeat(32), reason: 'r', key: 'k3' })).toEqual({ kind: 'conflict' });
    expect(await source.command({ name: 'revoke-sessions', userId: ID, reason: 'r', key: 'k4' })).toEqual({ kind: 'unknown' });
    expect(await source.command({ name: 'unlock', userId: ID, version: 4, reason: 'r', key: 'k5' })).toEqual({ kind: 'forbidden' });
    expect(await source.command({ name: 'unlock', userId: ID, version: 4, reason: 'r', key: 'k6' })).toEqual({ kind: 'session-expired' });
    expect(calls.requests.map((r) => [r.path, r.idempotencyKey, r.csrf])).toEqual([
      [`/admin/access/administrators/${ID}/lock`, 'k1', 'csrf-1'],
      [`/admin/finance/access/admins/${ID}/grant`, 'k2', 'csrf-1'],
      [`/admin/access/administrators/${ID}/permissions`, 'k3', 'csrf-1'],
      [`/admin/access/administrators/${ID}/revoke-sessions`, 'k4', 'csrf-1'],
      [`/admin/access/administrators/${ID}/unlock`, 'k5', 'csrf-1'],
      [`/admin/access/administrators/${ID}/unlock`, 'k6', 'csrf-1'],
    ]);
    expect(calls.requests[0]?.body).toEqual({ expected_version: 3, reason: 'r' });
    expect(calls.requests[1]?.body).toEqual({ permission_key: 'report.read', expected_version: 0 });
    // No session token in memory: nothing is sent at all.
    const none = createAccessSource(new AdminAccessApi(scripted().transport), session(null).port);
    expect(await none.command({ name: 'lock', userId: ID, version: 1, reason: 'r', key: 'k' })).toEqual({ kind: 'session-expired' });
    expect(await NOT_WIRED_ACCESS.command({ name: 'lock', userId: ID, version: 1, reason: 'r', key: 'k' })).toEqual({ kind: 'not-wired' });
  });

  it('the page is SYSTEM only in the menu and the route', () => {
    expect(canOpenRoute('ADMIN', new Set(['users']), { name: 'access' })).toBe(false);
    expect(canOpenRoute('SYSTEM', new Set(), { name: 'access' })).toBe(true);
    expect(visibleMenu('ADMIN', new Set(['users'])).flatMap((g) => g.items.map((i) => i.id))).not.toContain('access');
    expect(parseRoute('/accounts/access')).toEqual({ name: 'access' });
  });
});
