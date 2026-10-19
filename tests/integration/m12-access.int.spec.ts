import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { AdminApp, adminData, adminErrorCode, AdminResponse, startAdminApp } from './support/admin-fixtures';
import { countRows } from './support/auth-fixtures';
import { ActivatedAdmin, activatedAdmin, changeGrant, getAs, loginAdmin, permission, postAs, purgeGrants, systemLoginOf } from './support/m12-fixtures';
import { systemSession, SystemSession } from './support/provisioning-fixtures';

// M12-C on a REAL PostgreSQL: SYSTEM manages the ADMIN accounts. Proved: only SYSTEM (an ADMIN cannot raise its own rights or touch another, and SYSTEM is never a
// target); a permission change or a lock applies at the target's NEXT call; a stale screen (fingerprint / version) is refused; a lock ends the sessions and an
// unlock does not revive them; a retry with the same key writes once; every change leaves one audit row with before / after and the reason.

const tag = randomBytes(3).toString('hex').toUpperCase();
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('M12-C — administrator access', () => {
  let admin: AdminApp;
  let system: SystemSession;
  let peer: ActivatedAdmin;
  let target: ActivatedAdmin;

  beforeAll(async () => {
    admin = await startAdminApp({ activationDisabledTest: true });
    system = await systemSession(admin);
    peer = await activatedAdmin(admin, system, [permission('DRIVER')], `Đồng cấp ${tag}`);
    target = await activatedAdmin(admin, system, [permission('DRIVER', { view: true, review: true }), permission('SHOP')], `Đối tượng ${tag}`);
  });

  afterAll(async () => {
    try {
      await purgeGrants(admin.pool);
    } finally {
      await admin.close();
    }
  });

  const sys = systemLoginOf;
  const matrix = async (): Promise<Json> => adminData(await getAs(admin, sys(system), '/access/matrix')) as Json;
  const rowOf = async (userId: string): Promise<Json> => ((await matrix()).items as Json[]).find((item) => item.user_id === userId) as Json;
  const code = (response: AdminResponse): { status: number; code: string | undefined } => ({ status: response.status, code: adminErrorCode(response) });
  const audits = (action: string, id: string): Promise<number> => countRows(admin.pool, 'SELECT 1 FROM app.audit_logs WHERE action = $1 AND resource_id = $2', [action, id]);
  const path = (id: string, command: string): string => `/access/administrators/${id}/${command}`;

  it('only SYSTEM reads the matrix or changes anything; an ADMIN is refused everywhere, SYSTEM is never a target', async () => {
    expect(code(await getAs(admin, peer.login, '/access/matrix'))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    expect((await getAs(admin, undefined, '/access/matrix')).status).toBe(401);
    const row = await rowOf(target.userId);
    const body = { permissions: row.permissions, expected_fingerprint: row.permissions_fingerprint, reason: 'thử' };
    expect(code(await postAs(admin, peer.login, path(target.userId, 'permissions'), body))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    // An ADMIN cannot raise itself either.
    const own = await rowOf(peer.userId);
    expect(code(await postAs(admin, peer.login, path(peer.userId, 'permissions'), { permissions: [{ app: 'DRIVER', can_view: true, can_review_profile: true, can_lock: true }], expected_fingerprint: own.permissions_fingerprint, reason: 'tự nâng' }))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    for (const command of ['lock', 'unlock']) {
      expect(code(await postAs(admin, peer.login, path(target.userId, command), { expected_version: 1, reason: 'x' })).status).toBe(403);
    }
    expect(code(await postAs(admin, peer.login, path(target.userId, 'revoke-sessions'), { reason: 'x' })).status).toBe(403);
    // SYSTEM is not an administrator to manage; an unknown id answers like a missing one.
    expect(code(await postAs(admin, sys(system), path(system.account.userId, 'revoke-sessions'), { reason: 'x' }))).toEqual({ status: 404, code: 'ADMIN_ACCESS_NOT_FOUND' });
    expect(code(await postAs(admin, sys(system), path(randomUUID(), 'lock'), { expected_version: 1, reason: 'x' }))).toEqual({ status: 404, code: 'ADMIN_ACCESS_NOT_FOUND' });
    expect(((await matrix()).items as Json[]).some((item) => item.user_id === system.account.userId)).toBe(false);
  });

  it('the matrix shows phone (masked, not email), the app permissions, the function rights and live sessions', async () => {
    const row = await rowOf(target.userId);
    expect(row).toMatchObject({ full_name: `Đối tượng ${tag}`, status: 'ACTIVE', membership_version: 1 });
    expect(row.phone_masked).toEqual(expect.stringMatching(/•/));
    expect(JSON.stringify(row)).not.toContain(target.phone.local);
    expect(row.permissions.map((p: Json) => p.app)).toEqual(['DRIVER', 'SHOP']);
    expect(row.rights.map((r: Json) => r.permission_key)).toEqual(['wallet.read', 'wallet.topup.record', 'report.read', 'report.export', 'audit.read']);
    expect(row.live_sessions).toBeGreaterThanOrEqual(1);
  });

  it('a permission change applies at the next call, needs the screen it saw (fingerprint), is validated, and a retry writes once', async () => {
    expect((await getAs(admin, target.login, '/deliveries')).status).toBe(200);
    const row = await rowOf(target.userId);
    const bad = [
      { permissions: [], expected_fingerprint: row.permissions_fingerprint, reason: 'x' },
      { permissions: [{ app: 'DRIVER', can_view: false, can_review_profile: true, can_lock: false }], expected_fingerprint: row.permissions_fingerprint, reason: 'x' },
      { permissions: [{ app: 'DRIVER', can_view: false, can_review_profile: false, can_lock: false }], expected_fingerprint: row.permissions_fingerprint, reason: 'x' },
      { permissions: [{ app: 'CUSTOMER', can_view: true, can_review_profile: true, can_lock: false }], expected_fingerprint: row.permissions_fingerprint, reason: 'x' },
      { permissions: [{ app: 'DRIVER', can_view: true, can_review_profile: false, can_lock: false }, { app: 'DRIVER', can_view: true, can_review_profile: false, can_lock: false }], expected_fingerprint: row.permissions_fingerprint, reason: 'x' },
      { permissions: row.permissions, expected_fingerprint: row.permissions_fingerprint, reason: '' },
      { permissions: row.permissions, expected_fingerprint: 'zz', reason: 'x' },
      { permissions: row.permissions, expected_fingerprint: row.permissions_fingerprint, reason: 'x', role: 'SYSTEM' },
    ];
    for (const body of bad) {
      expect(code(await postAs(admin, sys(system), path(target.userId, 'permissions'), body)).code).toBe('ADMIN_INPUT_INVALID');
    }
    // Stale screen: the fingerprint of other rows.
    expect(code(await postAs(admin, sys(system), path(target.userId, 'permissions'), { permissions: row.permissions, expected_fingerprint: '0'.repeat(32), reason: 'x' }))).toEqual({ status: 409, code: 'ADMIN_ACCESS_VERSION_CONFLICT' });
    // Take every delivery-related view away: only CUSTOMER view remains.
    const key = randomUUID();
    const change = { permissions: [{ app: 'CUSTOMER', can_view: true, can_review_profile: false, can_lock: false }], expected_fingerprint: row.permissions_fingerprint, reason: 'Chuyển sang phụ trách khách hàng' };
    expect((await postAs(admin, sys(system), path(target.userId, 'permissions'), change, key)).status).toBe(200);
    expect(code(await getAs(admin, target.login, '/deliveries'))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' }); // same session, next call
    const after = await rowOf(target.userId);
    expect(after.permissions.map((p: Json) => p.app)).toEqual(['CUSTOMER']);
    expect(after.membership_version).toBe(1); // permissions do not end the sessions
    // Same key + same body: answered again, written once. The stale fingerprint now conflicts for a NEW key.
    expect((await postAs(admin, sys(system), path(target.userId, 'permissions'), change, key)).status).toBe(200);
    expect(await audits('admin.access.permissions.update.v1', target.userId)).toBe(1);
    expect(code(await postAs(admin, sys(system), path(target.userId, 'permissions'), change))).toEqual({ status: 409, code: 'ADMIN_ACCESS_VERSION_CONFLICT' });
    const evidence = (await admin.pool.query(`SELECT metadata FROM app.audit_logs WHERE action = 'admin.access.permissions.update.v1' AND resource_id = $1`, [target.userId])).rows[0].metadata as Json;
    expect(evidence.reason).toBe('Chuyển sang phụ trách khách hàng');
    expect(evidence.before).toHaveLength(2);
    expect(evidence.after).toEqual([{ app: 'CUSTOMER', can_view: true, can_review_profile: false, can_lock: false, can_manage_catalog: false }]);
    // Restore for the next cases.
    const restore = { permissions: [{ app: 'DRIVER', can_view: true, can_review_profile: false, can_lock: false }], expected_fingerprint: after.permissions_fingerprint, reason: 'Khôi phục' };
    expect((await postAs(admin, sys(system), path(target.userId, 'permissions'), restore)).status).toBe(200);
    expect((await getAs(admin, target.login, '/deliveries')).status).toBe(200);
  });

  it('function rights go through the same grant routes: report and audit rights are separate from each other and from money', async () => {
    for (const key of ['report.read', 'report.export', 'audit.read']) {
      expect((await changeGrant(admin, system, 'grant', target.userId, key, 0)).status).toBe(200);
    }
    const row = await rowOf(target.userId);
    expect(row.rights.filter((r: Json) => r.state === 'GRANTED').map((r: Json) => r.permission_key)).toEqual(['report.read', 'report.export', 'audit.read']);
    expect(code(await changeGrant(admin, system, 'grant', target.userId, 'wallet.adjustment.post', 0)).code).toBe('ADMIN_INPUT_INVALID');
    for (const key of ['report.read', 'report.export', 'audit.read']) {
      expect((await changeGrant(admin, system, 'revoke', target.userId, key, 1)).status).toBe(200);
    }
  });

  it('lock ends the sessions and refuses a stale version; unlock does not revive a session; the account signs in again; revoke-sessions ends them too', async () => {
    const row = await rowOf(target.userId);
    expect(code(await postAs(admin, sys(system), path(target.userId, 'lock'), { expected_version: row.membership_version + 5, reason: 'x' }))).toEqual({ status: 409, code: 'ADMIN_ACCESS_VERSION_CONFLICT' });
    expect(code(await postAs(admin, sys(system), path(target.userId, 'unlock'), { expected_version: row.membership_version, reason: 'x' }))).toEqual({ status: 409, code: 'ADMIN_ACCESS_STATE_CONFLICT' });
    expect((await postAs(admin, sys(system), path(target.userId, 'lock'), { expected_version: row.membership_version, reason: 'Nghi ngờ lộ tài khoản' })).status).toBe(200);
    expect((await getAs(admin, target.login, '/deliveries')).status).toBe(401);
    const locked = await rowOf(target.userId);
    expect(locked).toMatchObject({ status: 'DISABLED', membership_status: 'DISABLED', live_sessions: 0 });
    expect(code(await postAs(admin, sys(system), path(target.userId, 'lock'), { expected_version: locked.membership_version, reason: 'x' }))).toEqual({ status: 409, code: 'ADMIN_ACCESS_STATE_CONFLICT' });
    expect((await postAs(admin, sys(system), path(target.userId, 'unlock'), { expected_version: locked.membership_version, reason: 'Đã xác minh' })).status).toBe(200);
    expect((await getAs(admin, target.login, '/deliveries')).status).toBe(401); // the old session stays dead
    const fresh = await loginAdmin(admin, target);
    expect((await getAs(admin, fresh, '/deliveries')).status).toBe(200);
    const unlocked = await rowOf(target.userId);
    expect(unlocked).toMatchObject({ status: 'ACTIVE', live_sessions: 1 });
    expect((await postAs(admin, sys(system), path(target.userId, 'revoke-sessions'), { reason: 'Đăng xuất mọi thiết bị' })).status).toBe(200);
    expect((await getAs(admin, fresh, '/deliveries')).status).toBe(401);
    for (const [action, n] of [['admin.access.lock.v1', 1], ['admin.access.unlock.v1', 1], ['admin.access.revoke_sessions.v1', 1]] as const) {
      expect(await audits(action, target.userId)).toBe(n);
    }
    const lockAudit = (await admin.pool.query(`SELECT metadata FROM app.audit_logs WHERE action = 'admin.access.lock.v1' AND resource_id = $1`, [target.userId])).rows[0].metadata as Json;
    expect(lockAudit).toMatchObject({ reason: 'Nghi ngờ lộ tài khoản', before: { status: 'ACTIVE' }, after: { status: 'DISABLED' } });
  });
});
