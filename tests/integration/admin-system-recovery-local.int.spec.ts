import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Readable } from 'node:stream';
import { ADMIN_PREAUTH_COOKIE } from '../../apps/backend/src/admin-auth/admin-auth-constants';
import { AdminChallengeRepository } from '../../apps/backend/src/admin-auth/admin-challenge-repository';
import { runAdminAuthCli } from '../../apps/backend/src/admin-auth/cli/admin-auth-cli';
import { AdminMembershipRepository } from '../../apps/backend/src/admin-auth/admin-membership-repository';
import { AdminSessionRepository } from '../../apps/backend/src/admin-auth/admin-session-repository';
import { SystemRecoveryService } from '../../apps/backend/src/admin-auth/system-recovery-service';
import { AuditWriter } from '../../apps/backend/src/audit/audit-writer';
import { AdminPasswordVerifier } from '../../apps/backend/src/auth/admin-password-verifier';
import { Argon2idPasswordHasher } from '../../apps/backend/src/auth/password-hasher';
import { SessionRepository } from '../../apps/backend/src/auth/session-repository';
import { UserRepository } from '../../apps/backend/src/auth/user-repository';
import { poolClientSource } from '../../apps/backend/src/transaction/pg-client-source';
import { TransactionManager } from '../../apps/backend/src/transaction/transaction-manager';
import { randomPhone } from './support/auth-fixtures';
import {
  AdminApp,
  adminData,
  adminTestEnv,
  cookieFrom,
  count,
  createAdminMember,
  createSystem,
  enrollAndLogin,
  loginBody,
  purgeSystem,
  sessionCookies,
  startAdminApp,
  totpNow,
  rewindAcceptedStep,
} from './support/admin-fixtures';

// M01-RESET - local SYSTEM recovery CLI, in process against the guarded test database.
const NEW_PASSWORD = 'Another-Strong-Pass-77';
const CONFIRM = 'RESET_SYSTEM_LOCAL_TEST';
const PROGRAM = 'admin-auth:recover-system';
const ACTION = 'admin.auth.system_password_recovered.v1';

describe('M01-RESET - local SYSTEM recovery CLI', () => {
  let app: AdminApp;

  beforeAll(async () => {
    app = await startAdminApp();
  });
  afterAll(async () => {
    await app.close();
  });

  async function recover(mode: string[], input: unknown, extraEnv: Record<string, string | undefined> = {}) {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runAdminAuthCli('recover-system', {
      env: adminTestEnv({ HOST: '127.0.0.1', ...extraEnv }),
      argv: mode,
      stdin: Readable.from([typeof input === 'string' ? input : JSON.stringify(input)]),
      out: (line) => out.push(line),
      err: (line) => err.push(line),
    });
    return { code, out, err, text: [...out, ...err].join('\n') };
  }

  const check = (phone: string) => recover(['--check'], { phone });
  const apply = (phone: string, version: number, password = NEW_PASSWORD) =>
    recover(['--apply'], { phone, password, expected_version: version, confirmation: CONFIRM });
  const versionOf = async (userId: string) =>
    Number((await app.pool.query<{ v: string }>('SELECT version::text AS v FROM app.users WHERE user_id = $1::uuid', [userId])).rows[0]?.v);
  const userState = async (userId: string) =>
    (await app.pool.query('SELECT password_hash, version, status, account_origin FROM app.users WHERE user_id = $1::uuid', [userId])).rows;

  it('checks read-only, then applies: old password/session/preauth die, the new password still needs the SAME TOTP', async () => {
    const system = await createSystem(app);
    const first = await enrollAndLogin(app, system);
    const stale = await app.call('POST', '/login', { body: loginBody(system) });
    const stalePre = { cookie: String(cookieFrom(stale, ADMIN_PREAUTH_COOKIE)), csrf: String(adminData(stale).csrf_token) };
    const factorBefore = await app.pool.query('SELECT factor_id, state FROM app.admin_totp_factors WHERE user_id = $1::uuid', [system.userId]);
    const before = await userState(system.userId);
    const version = await versionOf(system.userId);

    const checked = await check(system.phone.local);
    expect([checked.code, checked.out]).toEqual([0, [`${PROGRAM}: SYSTEM_FOUND version=${version}`]]);
    expect(await userState(system.userId)).toEqual(before);
    expect(checked.text).not.toContain(system.phone.local);
    expect(checked.text).not.toContain(system.userId);

    const done = await apply(system.phone.local, version);
    expect([done.code, done.out]).toEqual([0, [`${PROGRAM}: RECOVERED version=${version + 1}`]]);
    expect(done.text).not.toContain(NEW_PASSWORD);
    expect(done.text).not.toContain(system.phone.local);

    expect((await app.call('GET', '/me', { cookies: sessionCookies(first) })).status).toBe(401);
    await rewindAcceptedStep(app, system.userId);
    const stalePost = await app.call('POST', '/totp/verify', {
      body: { code: totpNow(first.secret) },
      cookies: { [ADMIN_PREAUTH_COOKIE]: stalePre.cookie },
      csrf: stalePre.csrf,
    });
    expect([400, 401, 403]).toContain(stalePost.status);
    expect(await count(app.pool, 'SELECT 1 FROM app.admin_sessions WHERE user_id = $1::uuid AND revoked_at IS NULL', [system.userId])).toBe(0);
    expect(await count(app.pool, 'SELECT 1 FROM app.admin_auth_challenges WHERE user_id = $1::uuid AND consumed_at IS NULL', [system.userId])).toBe(0);

    expect((await app.call('POST', '/login', { body: loginBody(system) })).status).toBe(401);
    const login = await app.call('POST', '/login', { body: loginBody(system, { password: NEW_PASSWORD }) });
    expect(login.status).toBe(200);
    expect(adminData(login).next_step).toBe('VERIFY_TOTP');
    const factorAfter = await app.pool.query('SELECT factor_id, state FROM app.admin_totp_factors WHERE user_id = $1::uuid', [system.userId]);
    expect(factorAfter.rows).toEqual(factorBefore.rows);
    const after = (await userState(system.userId))[0] as { status: string; account_origin: string };
    expect([after.status, after.account_origin]).toEqual(['ACTIVE', 'ADMIN_PROVISIONED']);

    const audit = await app.pool.query<{ actor_type: string; actor_id: string | null; metadata: Record<string, unknown> }>(
      'SELECT actor_type, actor_id, metadata FROM app.audit_logs WHERE action = $1 AND resource_id = $2',
      [ACTION, system.userId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({
      actor_type: 'SYSTEM',
      actor_id: null,
      metadata: { execution_context: 'LOCAL_OPERATOR', target_user_id: system.userId, version: version + 1, verification: 'LOCAL_SERVER_OPERATOR_TEST' },
    });
    const text = JSON.stringify(audit.rows[0]);
    expect(text).not.toContain(system.phone.local);
    expect(text).not.toContain(NEW_PASSWORD);
  });

  it('a stale or replayed expected_version changes nothing; of two concurrent applies exactly one wins', async () => {
    const system = await createSystem(app);
    const version = await versionOf(system.userId);
    const results = await Promise.all([apply(system.phone.local, version, NEW_PASSWORD), apply(system.phone.local, version, `${NEW_PASSWORD}-b`)]);
    expect(results.map((r) => r.code).sort()).toEqual([0, 1]);
    expect(results.find((r) => r.code === 1)?.err).toEqual([`${PROGRAM}: refused: VERSION_CONFLICT`]);
    expect(await versionOf(system.userId)).toBe(version + 1);
    const hashAfter = await userState(system.userId);
    const replay = await apply(system.phone.local, version);
    expect([replay.code, replay.err]).toEqual([1, [`${PROGRAM}: refused: VERSION_CONFLICT`]]);
    expect(await userState(system.userId)).toEqual(hashAfter);
    expect(await count(app.pool, 'SELECT 1 FROM app.audit_logs WHERE action = $1 AND resource_id = $2', [ACTION, system.userId])).toBe(1);
  });

  it('refuses a wrong phone, an ADMIN, a USER and a missing SYSTEM without changing anything', async () => {
    const system = await createSystem(app);
    const admin = await createAdminMember(app);
    const sysState = await userState(system.userId);
    const adminState = await userState(admin.userId);
    const version = await versionOf(system.userId);

    for (const phone of [randomPhone().local, admin.phone.local]) {
      for (const run of [() => check(phone), () => apply(phone, version)]) {
        const result = await run();
        expect([result.code, result.err]).toEqual([1, [`${PROGRAM}: refused: SYSTEM_TARGET_NOT_FOUND`]]);
      }
    }
    expect(await userState(system.userId)).toEqual(sysState);
    expect(await userState(admin.userId)).toEqual(adminState);

    await purgeSystem(app.pool);
    const missing = await check(system.phone.local);
    expect([missing.code, missing.err]).toEqual([1, [`${PROGRAM}: refused: SYSTEM_TARGET_NOT_FOUND`]]);
    expect(await count(app.pool, `SELECT 1 FROM app.admin_memberships WHERE admin_role = 'SYSTEM'`)).toBe(0);
  });

  it('rolls the password and the revocation back when the audit insert fails', async () => {
    const system = await createSystem(app);
    const first = await enrollAndLogin(app, system);
    const existing = await app.pool.query<{ audit_id: string }>('SELECT audit_id FROM app.audit_logs LIMIT 1');
    const collide = existing.rows[0]?.audit_id as string;
    const transactions = new TransactionManager(poolClientSource(app.pool), { timeoutMs: 30_000, idleInTransactionTimeoutMs: 15_000 });
    const service = new SystemRecoveryService(
      transactions,
      new UserRepository(),
      new AdminMembershipRepository(),
      new SessionRepository(),
      new AdminSessionRepository(),
      new AdminChallengeRepository(),
      new AdminPasswordVerifier(new Argon2idPasswordHasher()),
      new AuditWriter({ idGenerator: () => collide }),
    );
    const before = await userState(system.userId);
    await expect(service.apply({ phoneNormalized: system.phone.normalized, password: NEW_PASSWORD, expectedVersion: await versionOf(system.userId) })).rejects.toBeDefined();
    expect(await userState(system.userId)).toEqual(before);
    expect((await app.call('GET', '/me', { cookies: sessionCookies(first) })).status).toBe(200);
  });

  it('usage and refused targets: exit 2 / 1 before connecting, reading input or changing anything', async () => {
    const system = await createSystem(app);
    const before = await userState(system.userId);
    const version = await versionOf(system.userId);
    const good = { phone: system.phone.local, password: NEW_PASSWORD, expected_version: version, confirmation: CONFIRM };
    expect((await recover([], good)).code).toBe(2);
    expect((await recover(['--check', '--apply'], good)).code).toBe(2);
    expect((await recover(['--apply', 'extra'], good)).code).toBe(2);
    expect((await recover(['--password=x'], good)).code).toBe(2);
    for (const env of [
      { APP_ENV: 'staging' },
      { APP_ENV: 'production' },
      { APP_ENV: undefined },
      { HOST: '0.0.0.0' },
      { HOST: undefined },
      { DATABASE_URL: 'postgres://ship11_test:x@db.example.test:5432/ship11_test' },
    ]) {
      const refused = await recover(['--apply'], good, env);
      expect(refused.code).toBe(1);
      expect(refused.text).not.toContain(NEW_PASSWORD);
    }
    for (const bad of [
      { ...good, confirmation: 'yes' },
      { ...good, confirmation: undefined },
      { ...good, expected_version: 0 },
      { ...good, expected_version: '3' },
      { ...good, role: 'SYSTEM' },
      { ...good, password: 'short' },
    ]) {
      expect((await recover(['--apply'], bad)).code).toBe(1);
    }
    expect(await userState(system.userId)).toEqual(before);
  });
});
