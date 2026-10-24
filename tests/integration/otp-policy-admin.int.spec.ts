import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { AdminApp, adminData, adminErrorCode, AdminResponse, sessionCookies, startAdminApp } from './support/admin-fixtures';
import { api, dataOf, randomPhone } from './support/auth-fixtures';
import { ActivatedAdmin, activatedAdmin, getAs, permission, postAs, systemLoginOf } from './support/m12-fixtures';
import { systemSession, SystemSession } from './support/provisioning-fixtures';
import { setOtpPolicy } from './support/test-helpers';

// Issue #117 on a REAL PostgreSQL: Hệ thống › SMS & OTP. SYSTEM reads and changes the six OTP limits, an ADMIN reads and never changes, the transport checks (session,
// CSRF, Origin), the optimistic version, validation with safe bounds (never 0), the audit/history rows, and the effect on the very next OTP request without a restart.

const tag = randomBytes(3).toString('hex').toUpperCase();
const PATH = '/system-settings/otp-policy';
const CHANGED = { cooldown_seconds: 45, max_wrong_attempts: 4, phone_per_hour: 2, phone_per_day: 4, ip_per_hour: 7, global_per_day: 25 } as const;

describe('issue #117 — SMS & OTP policy (Admin API)', () => {
  let admin: AdminApp;
  let system: SystemSession;
  let viewer: ActivatedAdmin;
  const outcome = (response: AdminResponse): [number, string | undefined] => [response.status, adminErrorCode(response)];
  const read = async (who = systemLoginOf(system)): Promise<Record<string, any>> => adminData(await getAs(admin, who, PATH)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const save = (body: Record<string, unknown>, who = systemLoginOf(system), key?: string): Promise<AdminResponse> => postAs(admin, who, PATH, body, key);
  const url = (): string => admin.config.database.url;

  beforeAll(async () => {
    admin = await startAdminApp({ activationDisabledTest: true });
    system = await systemSession(admin);
    viewer = await activatedAdmin(admin, system, [permission('DRIVER')], `Xem OTP ${tag}`);
  });
  beforeEach(async () => {
    await setOtpPolicy(url());
  });
  afterAll(async () => {
    try {
      await admin.pool.query('ALTER TABLE app.otp_policy_changes DISABLE TRIGGER USER');
      await admin.pool.query('DELETE FROM app.otp_policy_changes');
      await admin.pool.query('ALTER TABLE app.otp_policy_changes ENABLE TRIGGER USER');
      await setOtpPolicy(url(), { phone_per_hour: 3, phone_per_day: 5, ip_per_hour: 10, global_per_day: 30 });
    } finally {
      await admin.close();
    }
  });

  it('SYSTEM and ADMIN read the same six values with their bounds and defaults; only SYSTEM is told it may edit; no session is 401', async () => {
    const asSystem = await read();
    const asAdmin = await read(viewer.login);
    expect(asSystem.editable).toBe(true);
    expect(asAdmin.editable).toBe(false);
    for (const data of [asSystem, asAdmin]) {
      expect(data).toMatchObject({ cooldown_seconds: 60, max_wrong_attempts: 3, phone_per_hour: 20, phone_per_day: 100, ip_per_hour: 1000, global_per_day: 10000 });
      expect(data.defaults).toEqual({ cooldown_seconds: 60, max_wrong_attempts: 3, phone_per_hour: 3, phone_per_day: 5, ip_per_hour: 10, global_per_day: 30 });
      expect(data.bounds.cooldown_seconds).toEqual({ min: 10, max: 600 });
      expect(Number.isSafeInteger(data.version)).toBe(true);
    }
    expect(outcome(await getAs(admin, undefined, PATH))).toEqual([401, 'ADMIN_SESSION_INVALID']);
  });

  it('an ADMIN session can never change the policy (403) and nothing is written; a SYSTEM session without CSRF or from another Origin is refused', async () => {
    const before = await read();
    const body = { expected_version: before.version, ...CHANGED };
    expect(outcome(await save(body, viewer.login))).toEqual([403, 'ADMIN_FORBIDDEN']);
    expect(outcome(await admin.call('POST', PATH, { basePath: '/v1/admin', body, cookies: sessionCookies(systemLoginOf(system)), headers: { 'idempotency-key': randomUUID() } }))).toEqual([403, 'ADMIN_CSRF_INVALID']);
    expect(outcome(await admin.call('POST', PATH, { basePath: '/v1/admin', body, origin: 'https://evil.example', cookies: sessionCookies(systemLoginOf(system)), csrf: systemLoginOf(system).csrf, headers: { 'idempotency-key': randomUUID() } }))).toEqual([403, 'ADMIN_CSRF_INVALID']);
    expect(await read()).toEqual(before);
  });

  it('SYSTEM saves all six values: the version grows, the history and the audit row keep before/after/actor/reason, and the next OTP request uses the new cooldown at once', async () => {
    const before = await read();
    const response = await save({ expected_version: before.version, ...CHANGED, reason: 'Thử nghiệm giới hạn' });
    expect(response.status).toBe(200);
    const after = adminData(response) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(after).toMatchObject({ ...CHANGED, version: before.version + 1 });
    expect(after.changed_keys.sort()).toEqual(Object.keys(CHANGED).sort());
    expect(after.history[0]).toMatchObject({ version: before.version + 1, new_values: CHANGED, reason: 'Thử nghiệm giới hạn' });
    expect(after.history[0].old_values).toMatchObject({ cooldown_seconds: 60, phone_per_hour: 20 });

    const audit = await admin.pool.query<{ actor_type: string; actor_id: string; outcome: string; metadata: Record<string, unknown>; resource_version: string }>(
      `SELECT actor_type, actor_id, outcome, metadata, resource_version::text FROM app.audit_logs WHERE action = 'admin.otp_policy.update.v1' ORDER BY occurred_at DESC LIMIT 1`,
    );
    expect(audit.rows[0]).toMatchObject({ actor_type: 'SYSTEM', outcome: 'SUCCESS', resource_version: String(before.version + 1) });
    expect(audit.rows[0]?.actor_id).toBe(system.account.userId);
    expect(audit.rows[0]?.metadata).toMatchObject({ from_values: { cooldown_seconds: 60 }, to_values: CHANGED, reason: 'Thử nghiệm giới hạn' });

    // In force for the very next request, with no restart: the response tells the app the new cooldown.
    const phone = randomPhone();
    admin.track(phone.normalized);
    const requested = await api(admin.running.baseUrl, 'POST', '/auth/phone-verifications', { body: { phone: phone.local, purpose: 'REGISTER' } });
    expect(requested.status).toBe(201);
    expect(dataOf(requested).resend_after_seconds).toBe(45);

    // The central configuration page reads the same row.
    const groups = adminData(await getAs(admin, systemLoginOf(system), '/config/groups')) as { groups: Array<{ key: string; values: Array<{ key: string; value: unknown }> }> };
    const security = groups.groups.find((group) => group.key === 'security');
    expect(security?.values.find((value) => value.key === 'phone_per_day')?.value).toBe(4);
  });

  it('a stale screen is a 409, never a silent overwrite; an identical retry with the same key replays; two writers on one version have exactly one winner', async () => {
    const before = await read();
    const key = randomUUID();
    const first = await save({ expected_version: before.version, ...CHANGED }, systemLoginOf(system), key);
    expect(first.status).toBe(200);
    const replay = await save({ expected_version: before.version, ...CHANGED }, systemLoginOf(system), key);
    expect([replay.status, adminData(replay).version]).toEqual([200, before.version + 1]);
    expect(outcome(await save({ expected_version: before.version, ...CHANGED, ip_per_hour: 9 }))).toEqual([409, 'OTP_POLICY_VERSION_CONFLICT']);
    expect((await read()).ip_per_hour).toBe(7);

    const current = await read();
    const results = await Promise.all([
      save({ expected_version: current.version, ...CHANGED, ip_per_hour: 11 }),
      save({ expected_version: current.version, ...CHANGED, ip_per_hour: 12 }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await read()).version).toBe(current.version + 1);
  });

  it('a save that changes nothing writes no version, no history and no audit row', async () => {
    const before = await read();
    const same = { cooldown_seconds: before.cooldown_seconds, max_wrong_attempts: before.max_wrong_attempts, phone_per_hour: before.phone_per_hour, phone_per_day: before.phone_per_day, ip_per_hour: before.ip_per_hour, global_per_day: before.global_per_day };
    const audits = (await admin.pool.query("SELECT 1 FROM app.audit_logs WHERE action = 'admin.otp_policy.update.v1'")).rowCount;
    const response = await save({ expected_version: before.version, ...same });
    expect([response.status, (adminData(response) as Record<string, any>).changed_keys]).toEqual([200, []]); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect((await read()).version).toBe(before.version);
    expect((await admin.pool.query("SELECT 1 FROM app.audit_logs WHERE action = 'admin.otp_policy.update.v1'")).rowCount).toBe(audits);
  });

  it('refuses values outside the safe bounds (never 0, nothing switches a limiter off), a daily limit below the hourly one, missing and extra keys; nothing is written', async () => {
    const before = await read();
    const base = { expected_version: before.version, ...CHANGED };
    const bad: Array<Record<string, unknown>> = [
      { ...base, cooldown_seconds: 0 },
      { ...base, cooldown_seconds: 9 },
      { ...base, cooldown_seconds: 601 },
      { ...base, max_wrong_attempts: 0 },
      { ...base, max_wrong_attempts: 11 },
      { ...base, phone_per_hour: 0 },
      { ...base, phone_per_day: 0 },
      { ...base, ip_per_hour: 0 },
      { ...base, ip_per_hour: 1001 },
      { ...base, global_per_day: 0 },
      { ...base, global_per_day: 10001 },
      { ...base, phone_per_hour: 5, phone_per_day: 4 },
      { ...base, cooldown_seconds: 60.5 },
      { ...base, cooldown_seconds: '60' },
      { ...base, enabled: false },
      { ...base, otp_secret: 'x' },
      { expected_version: before.version, cooldown_seconds: 60 },
      { ...base, reason: 'x'.repeat(501) },
    ];
    for (const body of bad) {
      expect([JSON.stringify(body).slice(0, 80), ...outcome(await save(body))]).toEqual([JSON.stringify(body).slice(0, 80), 400, 'ADMIN_INPUT_INVALID']);
    }
    expect(await read()).toEqual(before);
  });

  it('PostgreSQL itself refuses an unsafe row or a rewritten history, whatever the application does', async () => {
    await expect(admin.pool.query('UPDATE app.otp_policy SET ip_per_hour = 0')).rejects.toThrow();
    await expect(admin.pool.query('UPDATE app.otp_policy SET cooldown_seconds = 5')).rejects.toThrow();
    await expect(admin.pool.query('UPDATE app.otp_policy SET phone_per_hour = 9, phone_per_day = 8')).rejects.toThrow();
    await expect(admin.pool.query("INSERT INTO app.otp_policy (policy_id, cooldown_seconds, max_wrong_attempts, phone_per_hour, phone_per_day, ip_per_hour, global_per_day, updated_at) VALUES (2, 60, 3, 3, 5, 10, 30, now())")).rejects.toThrow();
    await save({ expected_version: (await read()).version, ...CHANGED });
    await expect(admin.pool.query('DELETE FROM app.otp_policy_changes')).rejects.toThrow();
    await expect(admin.pool.query("UPDATE app.otp_policy_changes SET reason = 'x'")).rejects.toThrow();
  });
});
