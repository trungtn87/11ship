import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { AdminApp, adminData, adminErrorCode, AdminResponse, startAdminApp } from './support/admin-fixtures';
import { countRows } from './support/auth-fixtures';
import { ActivatedAdmin, activatedAdmin, getAs, permission, postAs, systemLoginOf } from './support/m12-fixtures';
import { systemSession, SystemSession } from './support/provisioning-fixtures';

// M12-D on a REAL PostgreSQL: the configuration hub reads the OWNERS' values (no second source), every administrator may read and only SYSTEM changes (the owner decides
// again), the change flow carries a reason into the owner's audit row, a stale screen is refused, two writers racing on one version have exactly one winner, and a revert
// is an ordinary new change (a new version) whose history keeps both. The history is the owners' own audit rows.

const tag = randomBytes(3).toString('hex').toUpperCase();
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('M12-D — central configuration', () => {
  let admin: AdminApp;
  let system: SystemSession;
  let viewer: ActivatedAdmin;
  const startedAt = Date.now() - 1000;
  const code = (response: AdminResponse): { status: number; code: string | undefined } => ({ status: response.status, code: adminErrorCode(response) });

  beforeAll(async () => {
    admin = await startAdminApp({ activationDisabledTest: true });
    system = await systemSession(admin);
    viewer = await activatedAdmin(admin, system, [permission('DRIVER')], `Xem cấu hình ${tag}`);
  });

  afterAll(async () => {
    try {
      await admin.pool.query(`DELETE FROM app.system_setting_changes`);
      await admin.pool.query(`DELETE FROM app.system_settings`); // an absent row means the default
      await admin.pool.query(`DELETE FROM app.shipper_wallet_parameter_changes`);
      await admin.pool.query(`UPDATE app.shipper_wallet_parameters SET updated_by = NULL`);
    } finally {
      await admin.close();
    }
  });

  const groups = async (who = systemLoginOf(system)): Promise<Json> => adminData(await getAs(admin, who, '/config/groups')) as Json;
  const groupOf = async (key: string, who = systemLoginOf(system)): Promise<Json> => ((await groups(who)).groups as Json[]).find((g) => g.key === key) as Json;
  const valueOf = (group: Json, key: string): number | boolean => (group.values as Json[]).find((v) => v.key === key)?.value;
  const history = async (group: string): Promise<Json[]> => ((adminData(await getAs(admin, systemLoginOf(system), `/config/history?group=${group}&limit=100`)) as Json).items as Json[]).filter((i) => i.metadata && Date.parse(i.at) >= startedAt);

  it('every administrator reads the six groups from the owners; fixed rules are listed apart and have no edit; only SYSTEM is marked editable', async () => {
    const asAdmin = await groups(viewer.login);
    const asSystem = await groups();
    expect(asAdmin.editable).toBe(false);
    expect(asSystem.editable).toBe(true);
    expect((asSystem.groups as Json[]).map((g) => g.key)).toEqual(['security', 'shipper_wallet', 'delivery_policy', 'notifications', 'map_gps', 'storage_backup']);
    const security = await groupOf('security');
    expect(security.values.map((v: Json) => v.key)).toEqual(['otp_registration_enabled', 'otp_password_reset_enabled']);
    expect(security.fixed_rules.map((r: Json) => [r.key, r.value])).toEqual([['otp_resend_seconds', 60], ['otp_max_attempts', 5]]); // the values the auth module RUNS with (env default today); the page never invents them
    const policy = await groupOf('delivery_policy');
    expect(policy.fixed_rules.map((r: Json) => [r.key, r.value])).toEqual([['search_radius_m', 3000], ['search_window_minutes', 30]]);
    const map = await groupOf('map_gps');
    expect(map.values).toEqual([]);
    expect(map.edit).toBeNull(); // nothing to edit: the rules are fixed
    expect((await groupOf('shipper_wallet')).fixed_rules[0]).toMatchObject({ key: 'commission_vnd', value: 1000 });
    expect((await getAs(admin, undefined, '/config/groups')).status).toBe(401);
    expect(code(await getAs(admin, systemLoginOf(system), '/config/groups?x=1')).status).toBe(400);
    expect(code(await getAs(admin, systemLoginOf(system), '/config/history?group=nope')).status).toBe(400);
  });

  it('a change carries its reason into the audit row; ADMIN is refused; a stale version and a lost race are refused; the old screen (no reason) still works', async () => {
    const before = await groupOf('security');
    const body = { expected_version: before.version, otp_registration_enabled: !valueOf(before, 'otp_registration_enabled'), otp_password_reset_enabled: valueOf(before, 'otp_password_reset_enabled'), reason: 'Kiểm thử cấu hình' };
    expect(code(await postAs(admin, viewer.login, '/system-settings/phone-verification', body))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    expect(valueOf(await groupOf('security'), 'otp_registration_enabled')).toBe(valueOf(before, 'otp_registration_enabled'));
    for (const bad of [{ ...body, reason: '' }, { ...body, reason: 'x'.repeat(501) }, { ...body, extra: 1 }]) {
      expect(code(await postAs(admin, systemLoginOf(system), '/system-settings/phone-verification', bad)).code).toBe('ADMIN_INPUT_INVALID');
    }
    // Two writers on the same version: exactly one wins.
    const results = await Promise.all([postAs(admin, systemLoginOf(system), '/system-settings/phone-verification', body), postAs(admin, systemLoginOf(system), '/system-settings/phone-verification', { ...body, reason: 'Người ghi thứ hai' })]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const after = await groupOf('security');
    expect(after.version).toBeGreaterThan(before.version);
    expect(valueOf(after, 'otp_registration_enabled')).toBe(!valueOf(before, 'otp_registration_enabled'));
    // Stale screen.
    expect(code(await postAs(admin, systemLoginOf(system), '/system-settings/phone-verification', body)).code).toBe('SYSTEM_SETTING_VERSION_CONFLICT');
    // The history shows who, when, before/after and the reason of the winner.
    const entries = (await history('security')).filter((e) => e.metadata.setting_key === 'otp_registration_enabled');
    expect(entries[0]).toMatchObject({ group: 'security', actor_name: 'SYSTEM', metadata: { setting_key: 'otp_registration_enabled', old_value: valueOf(before, 'otp_registration_enabled'), new_value: !valueOf(before, 'otp_registration_enabled') } });
    expect(['Kiểm thử cấu hình', 'Người ghi thứ hai']).toContain(entries[0]?.metadata.reason);
    // Revert = a new, ordinary change: a new version, both entries stay in the history.
    const revert = { expected_version: after.version, otp_registration_enabled: valueOf(before, 'otp_registration_enabled'), otp_password_reset_enabled: valueOf(after, 'otp_password_reset_enabled'), reason: 'Hoàn nguyên về giá trị cũ' };
    const key = randomUUID();
    expect((await postAs(admin, systemLoginOf(system), '/system-settings/phone-verification', revert, key)).status).toBe(200);
    expect((await postAs(admin, systemLoginOf(system), '/system-settings/phone-verification', revert, key)).status).toBe(200); // retry: answered, not applied twice
    const reverted = await groupOf('security');
    expect(reverted.version).toBeGreaterThan(after.version);
    expect(valueOf(reverted, 'otp_registration_enabled')).toBe(valueOf(before, 'otp_registration_enabled'));
    const all = (await history('security')).filter((e) => e.metadata.setting_key === 'otp_registration_enabled');
    expect(all.filter((e) => e.metadata.reason === 'Hoàn nguyên về giá trị cũ')).toHaveLength(1);
    expect(all.length).toBeGreaterThanOrEqual(2);
    // The older body without a reason is still accepted (the existing screen), and leaves no reason.
    const old = { expected_version: reverted.version, otp_registration_enabled: valueOf(reverted, 'otp_registration_enabled'), otp_password_reset_enabled: !valueOf(reverted, 'otp_password_reset_enabled') };
    expect((await postAs(admin, systemLoginOf(system), '/system-settings/phone-verification', old)).status).toBe(200);
    expect(await countRows(admin.pool, `SELECT 1 FROM app.audit_logs WHERE action = 'admin.system_setting.update.v1' AND metadata ? 'reason'`)).toBeGreaterThanOrEqual(2);
    // Restore the second switch for later suites.
    expect((await postAs(admin, systemLoginOf(system), '/system-settings/phone-verification', { ...old, expected_version: (await groupOf('security')).version, otp_password_reset_enabled: valueOf(reverted, 'otp_password_reset_enabled') })).status).toBe(200);
  });

  it('wallet parameters: a new minimum applies to new requests and is in the history with its reason; the fixed commission stays out of every edit', async () => {
    const before = await groupOf('shipper_wallet');
    const topup = valueOf(before, 'topup_min_vnd') as number;
    const withdraw = valueOf(before, 'withdraw_min_vnd') as number;
    const change = { expected_version: before.version, topup_min_vnd: topup + 1000, withdraw_min_vnd: withdraw, reason: 'Tăng mức nạp tối thiểu' };
    expect(code(await postAs(admin, viewer.login, '/system-settings/shipper-wallet', change)).status).toBe(403);
    expect((await postAs(admin, systemLoginOf(system), '/system-settings/shipper-wallet', change)).status).toBe(200);
    expect(valueOf(await groupOf('shipper_wallet'), 'topup_min_vnd')).toBe(topup + 1000);
    const entry = (await history('shipper_wallet')).find((e) => e.metadata.reason === 'Tăng mức nạp tối thiểu');
    expect(entry?.metadata).toMatchObject({ param_key: 'topup_min_vnd', old_value: topup, new_value: topup + 1000 });
    // The commission is a rule, not a parameter: no key of the wallet body can carry it.
    expect(code(await postAs(admin, systemLoginOf(system), '/system-settings/shipper-wallet', { ...change, expected_version: (await groupOf('shipper_wallet')).version, commission_vnd: 5 })).code).toBe('ADMIN_INPUT_INVALID');
    // Revert to the earlier value: a NEW version, same endpoint.
    const now = await groupOf('shipper_wallet');
    expect((await postAs(admin, systemLoginOf(system), '/system-settings/shipper-wallet', { expected_version: now.version, topup_min_vnd: topup, withdraw_min_vnd: withdraw, reason: 'Hoàn nguyên' })).status).toBe(200);
    expect((await groupOf('shipper_wallet')).version).toBeGreaterThan(now.version);
  });
});
