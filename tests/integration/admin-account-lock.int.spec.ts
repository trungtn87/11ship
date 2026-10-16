import { createHash, randomBytes, randomUUID, X509Certificate } from 'node:crypto';
import { ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ADMIN_SESSION_COOKIE } from '../../apps/backend/src/admin-auth/admin-auth-constants';
import { Argon2idPasswordHasher } from '../../apps/backend/src/auth/password-hasher';
import {
  ADMIN_ORIGIN,
  ADMIN_PASSWORD,
  AdminApp,
  adminData,
  adminErrorCode,
  AdminResponse,
  cookieFrom,
  count,
  loginStep,
  preauthCookies,
  rewindAcceptedStep,
  sessionCookies,
  startAdminApp,
  totpNow,
} from './support/admin-fixtures';
import { begin, ok, post } from './support/activation-fixtures';
import { freePort, runScript, startFront } from './support/admin-web-harness';
import { api, ApiResponse, grantRole, grantStrayRole, installFault, Phone, randomPhone, removeFault } from './support/auth-fixtures';
import { Browser, launchChrome, Page } from './support/cdp';
import { createInvitation, createPayload, systemSession, SystemSession } from './support/provisioning-fixtures';

// M01-ADMIN lock / unlock of an ordinary USER account (D15, 2026-10-13) against the real Nest pipeline and PostgreSQL, then ONE
// real-Chrome smoke through the local HTTPS front. SYSTEM locks any ordinary account; an ADMIN needs view + lock on EVERY domain of
// the target; a lock revokes every Food/Ship session in the same transaction, an unlock revives nothing. Accounts of the
// administration (ADMIN, SYSTEM) are never targets. The gate ADMIN_USER_ACCOUNT_MUTATIONS_ENABLED is open only for the first
// application and closed (the default) for the second.

const ADMIN_BASE = '/v1/admin';
const tag = randomBytes(3).toString('hex').toUpperCase();
const LOCK_ACTION = 'admin.user.lock.v1';
const UNLOCK_ACTION = 'admin.user.unlock.v1';

interface Seeded {
  readonly id: string;
  readonly phone: Phone;
}

interface AdminLogin {
  readonly cookie: string;
  readonly csrf: string;
}

interface ActivatedAdmin {
  readonly phone: Phone;
  readonly userId: string;
  readonly secret: string;
  readonly fullName: string;
}

type Right = readonly ['CUSTOMER' | 'SHOP' | 'DRIVER', boolean, boolean]; // app, can_view, can_lock

const rights = (...items: Right[]): Record<string, unknown>[] =>
  items.map(([app, view, lock]) => ({ app, can_view: view, can_review_profile: false, can_lock: lock }));

describe('admin account lock / unlock (API + one real browser smoke)', () => {
  let app: AdminApp;
  let system: SystemSession;
  let front: ChildProcess | undefined;
  let browser: Browser | undefined;
  let origin = '';
  let tlsDir = '';
  let hash = '';

  let adminFull: ActivatedAdmin; // CUSTOMER + DRIVER view and lock
  let adminPartial: ActivatedAdmin; // CUSTOMER view + lock, DRIVER view only
  let adminShop: ActivatedAdmin; // SHOP view + lock only
  let fullLogin: AdminLogin;
  let partialLogin: AdminLogin;
  let shopLogin: AdminLogin;

  async function seedUser(options: {
    readonly roles: readonly ('CUSTOMER' | 'SHOP' | 'DRIVER')[];
    readonly name?: string;
    readonly status?: 'ACTIVE' | 'DISABLED';
    readonly origin?: 'PHONE_VERIFIED' | 'TEST_UNVERIFIED';
  }): Promise<Seeded> {
    const phone = randomPhone();
    app.track(phone.normalized);
    const id = randomUUID();
    const unverified = options.origin === 'TEST_UNVERIFIED';
    await app.pool.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
       VALUES ($1::uuid, $2, $3, CASE WHEN $5::boolean THEN NULL ELSE clock_timestamp() END, $6, $4, 1, clock_timestamp(), clock_timestamp())`,
      [id, phone.normalized, hash, options.status ?? 'ACTIVE', unverified, options.origin ?? 'PHONE_VERIFIED'],
    );
    for (const role of options.roles) {
      if (role === 'CUSTOMER') {
        await grantStrayRole(app.pool, id, 'CUSTOMER');
      } else {
        await grantRole(app.pool, id, role);
      }
    }
    if (options.name !== undefined && options.roles.includes('CUSTOMER')) {
      await app.pool.query('INSERT INTO app.customer_profiles (user_id, full_name) VALUES ($1::uuid, $2)', [id, options.name]);
    }
    return { id, phone };
  }

  async function activatedAdmin(permissions: Record<string, unknown>[], fullName: string): Promise<ActivatedAdmin> {
    const phone = randomPhone();
    app.track(phone.normalized);
    const created = await createInvitation(app, system, createPayload(phone.local, { full_name: fullName, permissions }));
    const token = created.link.split('#t=')[1] as string;
    const session = await begin(app, { invitationId: created.invitationId, token, phone });
    ok(await post(app, '/password', session, { password: ADMIN_PASSWORD }));
    const secret = String(adminData(ok(await post(app, '/totp/enrollment', session))).secret);
    ok(await post(app, '/complete', session, { code: totpNow(secret) }));
    const row = await app.pool.query<{ user_id: string }>('SELECT user_id FROM app.users WHERE phone_normalized = $1', [phone.normalized]);
    return { phone, userId: (row.rows[0] as { user_id: string }).user_id, secret, fullName };
  }

  async function login(who: ActivatedAdmin): Promise<AdminLogin> {
    const preauth = await loginStep(app, { phone: who.phone, password: ADMIN_PASSWORD, userId: who.userId });
    await rewindAcceptedStep(app, who.userId);
    const verified = await app.call('POST', '/totp/verify', { body: { code: totpNow(who.secret) }, cookies: preauthCookies(preauth), csrf: preauth.csrf });
    if (verified.status !== 200) {
      throw new Error(`admin login failed: ${verified.status} ${verified.text}`);
    }
    return { cookie: String(cookieFrom(verified, ADMIN_SESSION_COOKIE)), csrf: String(adminData(verified).csrf_token) };
  }

  const systemLogin = (): AdminLogin => ({ cookie: system.login.cookie, csrf: system.login.csrf });

  const change = async (
    kind: 'lock' | 'unlock',
    userId: string,
    who: AdminLogin,
    body: unknown,
    options: { key?: string | null; csrf?: string | null; origin?: string | null; contentType?: string | null } = {},
  ): Promise<AdminResponse> => {
    // The ingress quota (30 POST per minute per address, shared with login) is not under test here.
    await app.clearLimits();
    const key = options.key === undefined ? randomUUID() : options.key;
    return app.call('POST', `/users/${userId}/${kind}`, {
      basePath: ADMIN_BASE,
      body,
      cookies: sessionCookies(who),
      ...(options.csrf === null ? {} : { csrf: options.csrf ?? who.csrf }),
      ...(key === null ? {} : { headers: { 'idempotency-key': key } }),
      ...(options.origin === undefined ? {} : { origin: options.origin }),
      ...(options.contentType === undefined ? {} : { contentType: options.contentType }),
    });
  };
  const body = (version: number, reason = 'Nhiều phản ánh trong ngày'): { expected_version: number; reason: string } => ({ expected_version: version, reason });
  const detail = (userId: string, who: { cookie: string }): Promise<AdminResponse> => app.call('GET', `/users/${userId}`, { basePath: ADMIN_BASE, cookies: sessionCookies(who) });
  const codeOf = (response: AdminResponse): { status: number; code: string | undefined } => ({ status: response.status, code: adminErrorCode(response) });

  async function userRow(userId: string): Promise<{ status: string; version: number }> {
    const result = await app.pool.query<{ status: string; version: string }>('SELECT status, version::text AS version FROM app.users WHERE user_id = $1::uuid', [userId]);
    const row = result.rows[0] as { status: string; version: string };
    return { status: row.status, version: Number(row.version) };
  }
  const liveSessions = (userId: string): Promise<number> => count(app.pool, 'SELECT 1 FROM app.sessions WHERE user_id = $1::uuid AND revoked_at IS NULL', [userId]);
  const allSessions = (userId: string): Promise<number> => count(app.pool, 'SELECT 1 FROM app.sessions WHERE user_id = $1::uuid', [userId]);
  const auditCount = (userId: string, action: string): Promise<number> =>
    count(app.pool, 'SELECT 1 FROM app.audit_logs WHERE resource_id = $1 AND action = $2', [userId, action]);
  const outboxCount = (userId: string): Promise<number> =>
    count(app.pool, "SELECT 1 FROM app.outbox_events WHERE resource_id = $1 AND event_type LIKE 'user.account.%'", [userId]);
  const sideEffects = async (userId: string): Promise<number[]> => [
    await auditCount(userId, LOCK_ACTION),
    await auditCount(userId, UNLOCK_ACTION),
    await outboxCount(userId),
    await liveSessions(userId),
  ];

  /** A real Food (WEB), Ship (WEB) and legacy session of the account, as the apps would get them. */
  async function appSessions(user: Seeded, withShip: boolean): Promise<string[]> {
    const tokens: string[] = [];
    const devices: Array<Record<string, unknown>> = [{ device_id: 'web-food-0001', platform: 'WEB', app: 'FOOD' }];
    if (withShip) {
      devices.push({ device_id: 'web-ship-0001', platform: 'WEB', app: 'SHIP' });
    }
    for (const device of devices) {
      const response = await clientLogin(user, device);
      expect(response.status).toBe(200);
      tokens.push(String((response.body.data as Record<string, unknown>).access_token));
    }
    return tokens;
  }
  const clientLogin = (user: Seeded, device: Record<string, unknown>): Promise<ApiResponse> =>
    api(app.running.baseUrl, 'POST', '/client-auth/login', {
      headers: { 'idempotency-key': randomUUID() },
      body: { phone: user.phone.local, password: ADMIN_PASSWORD, device },
    });
  const clientMe = async (token: string): Promise<number> => (await api(app.running.baseUrl, 'GET', '/client-auth/me', { bearer: token })).status;

  beforeAll(async () => {
    runScript('admin-web-build.mjs');
    tlsDir = mkdtempSync(join(tmpdir(), 'admin-account-lock-tls-'));
    runScript('admin-web-cert.mjs', [tlsDir, '1']);
    const certPath = join(tlsDir, 'cert.pem');
    const spki = new X509Certificate(readFileSync(certPath)).publicKey.export({ type: 'spki', format: 'der' });
    const spkiHash = createHash('sha256').update(spki).digest('base64');
    const port = await freePort();
    origin = `https://localhost:${String(port)}`;
    app = await startAdminApp({ allowedOrigins: [origin, ADMIN_ORIGIN], activationDisabledTest: true, userAccountMutations: true });
    front = await startFront({
      ADMIN_WEB_PORT: String(port),
      ADMIN_WEB_HOST: 'localhost',
      ADMIN_WEB_BACKEND: app.running.baseUrl,
      ADMIN_WEB_TLS_CERT: certPath,
      ADMIN_WEB_TLS_KEY: join(tlsDir, 'key.pem'),
    });
    browser = await launchChrome(spkiHash);

    hash = await new Argon2idPasswordHasher().hash(ADMIN_PASSWORD);
    system = await systemSession(app);
    adminFull = await activatedAdmin(rights(['CUSTOMER', true, true], ['DRIVER', true, true]), `Quản trị Đủ ${tag}`);
    adminPartial = await activatedAdmin(rights(['CUSTOMER', true, true], ['DRIVER', true, false]), `Quản trị Thiếu ${tag}`);
    adminShop = await activatedAdmin(rights(['SHOP', true, true]), `Quản trị Quán ${tag}`);
    fullLogin = await login(adminFull);
    partialLogin = await login(adminPartial);
    shopLogin = await login(adminShop);
  }, 300_000);

  afterAll(async () => {
    await browser?.close();
    front?.kill('SIGTERM');
    await app?.close();
    if (tlsDir !== '') {
      rmSync(tlsDir, { recursive: true, force: true });
    }
  });

  it('SYSTEM locks: every Food/Ship session is revoked in the same commit, one audit with the reason, one outbox event; unlock revives nothing', async () => {
    const target = await seedUser({ roles: ['CUSTOMER', 'DRIVER'], name: `Khách Khóa ${tag}` });
    const [food, ship] = (await appSessions(target, true)) as [string, string];
    expect(await clientMe(food)).toBe(200);
    expect(await clientMe(ship)).toBe(200);
    expect(await liveSessions(target.id)).toBe(2);
    const adminSessionsBefore = await count(app.pool, 'SELECT 1 FROM app.admin_sessions WHERE revoked_at IS NULL');
    const rolesBefore = await app.pool.query('SELECT role FROM app.user_roles WHERE user_id = $1::uuid ORDER BY role', [target.id]);
    const driverBefore = await app.pool.query('SELECT status FROM app.drivers WHERE user_id = $1::uuid', [target.id]);

    const hint = adminData(await detail(target.id, systemLogin()));
    expect(hint.allowed_actions).toEqual(['LOCK', 'DELETE']);
    const key = randomUUID();
    const locked = await change('lock', target.id, systemLogin(), body(1, '  Vi phạm điều khoản  '), { key });
    expect(locked.status).toBe(200);
    expect(locked.headers['cache-control']).toBe('no-store');
    const ack = adminData(locked);
    expect(Object.keys(ack).sort()).toEqual(['account_status', 'changed_at', 'command_id', 'user_id', 'version']);
    expect(ack).toMatchObject({ user_id: target.id, account_status: 'DISABLED', version: 2 });
    expect(String(ack.command_id)).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(String(ack.changed_at)).toISOString()).toBe(ack.changed_at);

    expect(await userRow(target.id)).toEqual({ status: 'DISABLED', version: 2 });
    expect(await liveSessions(target.id)).toBe(0);
    expect(await allSessions(target.id)).toBe(2); // history and TTL stay
    expect(await clientMe(food)).toBe(401);
    expect(await clientMe(ship)).toBe(401);
    expect((await clientLogin(target, { device_id: 'web-food-0001', platform: 'WEB', app: 'FOOD' })).status).not.toBe(200);
    expect(await count(app.pool, 'SELECT 1 FROM app.admin_sessions WHERE revoked_at IS NULL')).toBe(adminSessionsBefore);

    const audit = await app.pool.query<{ actor_type: string; actor_id: string; resource_version: string; outcome: string; metadata: Record<string, unknown> }>(
      'SELECT actor_type, actor_id, resource_version::text, outcome, metadata FROM app.audit_logs WHERE resource_id = $1 AND action = $2',
      [target.id, LOCK_ACTION],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({
      actor_type: 'SYSTEM',
      actor_id: system.account.userId,
      resource_version: '2',
      outcome: 'SUCCESS',
      metadata: { target_user_id: target.id, from_status: 'ACTIVE', to_status: 'DISABLED', version: 2, reason: 'Vi phạm điều khoản', revoked_sessions: 2 },
    });
    const outbox = await app.pool.query<{ event_type: string; event_schema_version: number; payload: Record<string, unknown> }>(
      'SELECT event_type, event_schema_version, payload FROM app.outbox_events WHERE resource_id = $1',
      [target.id],
    );
    expect(outbox.rows).toEqual([{ event_type: 'user.account.locked.v1', event_schema_version: 1, payload: { user_id: target.id, account_status: 'DISABLED', version: 2 } }]);
    expect(JSON.stringify(outbox.rows)).not.toContain('Vi phạm');
    expect(JSON.stringify(outbox.rows)).not.toContain(target.phone.local);
    expect(await count(app.pool, "SELECT 1 FROM app.idempotency_records WHERE scope_type = 'admin_user' AND scope_id = $1 AND operation_id = 'admin.user.lock.v1'", [system.account.userId])).toBeGreaterThanOrEqual(1);

    // Replay: same key and body is the original acknowledgement; nothing is updated, revoked, audited or published twice.
    const before = await sideEffects(target.id);
    const replay = await change('lock', target.id, systemLogin(), body(1, '  Vi phạm điều khoản  '), { key });
    expect(replay.status).toBe(200);
    expect(adminData(replay)).toEqual(ack);
    expect(await sideEffects(target.id)).toEqual(before);
    expect(await userRow(target.id)).toEqual({ status: 'DISABLED', version: 2 });
    // The same key with another body, and another user with the same key, are different requests.
    const reused = await change('lock', target.id, systemLogin(), body(1, 'lý do khác'), { key });
    expect(codeOf(reused)).toEqual({ status: 409, code: 'IDEMPOTENCY_KEY_REUSED' });
    const hintLocked = adminData(await detail(target.id, systemLogin()));
    expect(hintLocked).toMatchObject({ account_status: 'DISABLED', version: 2, allowed_actions: ['UNLOCK'] });

    // Version first, then state.
    expect(codeOf(await change('lock', target.id, systemLogin(), body(1)))).toEqual({ status: 409, code: 'USER_ACCOUNT_VERSION_CONFLICT' });
    expect(codeOf(await change('lock', target.id, systemLogin(), body(2)))).toEqual({ status: 409, code: 'USER_ACCOUNT_ALREADY_IN_STATE' });
    expect(codeOf(await change('unlock', target.id, systemLogin(), body(1)))).toEqual({ status: 409, code: 'USER_ACCOUNT_VERSION_CONFLICT' });
    expect(await sideEffects(target.id)).toEqual(before);

    // Unlock: ACTIVE again, version + 1, the old sessions stay dead, roles and profiles are untouched, a fresh login works.
    const unlockKey = randomUUID();
    const unlocked = await change('unlock', target.id, systemLogin(), body(2, 'Đã làm rõ'), { key: unlockKey });
    expect(unlocked.status).toBe(200);
    expect(adminData(unlocked)).toMatchObject({ user_id: target.id, account_status: 'ACTIVE', version: 3 });
    expect(await userRow(target.id)).toEqual({ status: 'ACTIVE', version: 3 });
    expect(await liveSessions(target.id)).toBe(0);
    expect(await clientMe(food)).toBe(401);
    expect(await clientMe(ship)).toBe(401);
    expect((await app.pool.query('SELECT role FROM app.user_roles WHERE user_id = $1::uuid ORDER BY role', [target.id])).rows).toEqual(rolesBefore.rows);
    expect((await app.pool.query('SELECT status FROM app.drivers WHERE user_id = $1::uuid', [target.id])).rows).toEqual(driverBefore.rows);
    const fresh = await clientLogin(target, { device_id: 'web-food-0001', platform: 'WEB', app: 'FOOD' });
    expect(fresh.status).toBe(200);
    expect(await clientMe(String((fresh.body.data as Record<string, unknown>).access_token))).toBe(200);
    expect(await auditCount(target.id, UNLOCK_ACTION)).toBe(1);
    expect((await app.pool.query('SELECT event_type FROM app.outbox_events WHERE resource_id = $1 ORDER BY occurred_at, event_type', [target.id])).rows.map((row: { event_type: string }) => row.event_type).sort()).toEqual([
      'user.account.locked.v1',
      'user.account.unlocked.v1',
    ]);
    const unlockReplay = await change('unlock', target.id, systemLogin(), body(2, 'Đã làm rõ'), { key: unlockKey });
    expect(adminData(unlockReplay)).toEqual(adminData(unlocked));
    expect(await auditCount(target.id, UNLOCK_ACTION)).toBe(1);
    expect(adminData(await detail(target.id, systemLogin())).allowed_actions).toEqual(['LOCK', 'DELETE']);
  });

  it('a request is validated before it runs: transport, CSRF, key, strict body; nothing changes on a refusal', async () => {
    const target = await seedUser({ roles: ['CUSTOMER'], name: `Khách Kiểm ${tag}` });
    const [food] = (await appSessions(target, false)) as [string];
    const before = await sideEffects(target.id);
    const refusals: Array<[string, () => Promise<AdminResponse>, number, string | undefined]> = [
      ['no cookie', () => app.call('POST', `/users/${target.id}/lock`, { basePath: ADMIN_BASE, body: body(1), csrf: fullLogin.csrf, headers: { 'idempotency-key': randomUUID() } }), 401, 'ADMIN_SESSION_INVALID'],
      ['no csrf', () => change('lock', target.id, systemLogin(), body(1), { csrf: null }), 403, 'ADMIN_CSRF_INVALID'],
      ['wrong csrf', () => change('lock', target.id, systemLogin(), body(1), { csrf: 'x'.repeat(40) }), 403, 'ADMIN_CSRF_INVALID'],
      ['foreign origin', () => change('lock', target.id, systemLogin(), body(1), { origin: 'https://evil.example' }), 403, 'ADMIN_CSRF_INVALID'],
      ['no origin', () => change('lock', target.id, systemLogin(), body(1), { origin: null }), 403, 'ADMIN_CSRF_INVALID'],
      ['no key', () => change('lock', target.id, systemLogin(), body(1), { key: null }), 400, 'IDEMPOTENCY_KEY_REQUIRED'],
      ['bad key', () => change('lock', target.id, systemLogin(), body(1), { key: 'not-a-uuid' }), 400, 'INVALID_IDEMPOTENCY_KEY'],
      ['empty reason', () => change('lock', target.id, systemLogin(), body(1, '   ')), 400, 'ADMIN_INPUT_INVALID'],
      ['long reason', () => change('lock', target.id, systemLogin(), body(1, 'x'.repeat(501))), 400, 'ADMIN_INPUT_INVALID'],
      ['version 0', () => change('lock', target.id, systemLogin(), { expected_version: 0, reason: 'r' }), 400, 'ADMIN_INPUT_INVALID'],
      ['status from client', () => change('lock', target.id, systemLogin(), { ...body(1), status: 'ACTIVE' }), 400, 'ADMIN_INPUT_INVALID'],
      ['actor from client', () => change('lock', target.id, systemLogin(), { ...body(1), actor_user_id: system.account.userId }), 400, 'ADMIN_INPUT_INVALID'],
      ['bad id', () => change('lock', 'not-a-uuid', systemLogin(), body(1)), 400, 'ADMIN_INPUT_INVALID'],
      ['not json', () => change('lock', target.id, systemLogin(), body(1), { contentType: 'text/plain' }), 400, undefined],
      ['bearer is no credential', () => app.call('POST', `/users/${target.id}/lock`, { basePath: ADMIN_BASE, body: body(1), headers: { authorization: `Bearer ${food}`, 'idempotency-key': randomUUID() }, csrf: 'x' }), 401, 'ADMIN_SESSION_INVALID'],
    ];
    for (const [name, run, status, code] of refusals) {
      await app.clearLimits();
      const response = await run();
      expect([name, response.status, adminErrorCode(response)]).toEqual([name, status, code ?? adminErrorCode(response)]);
    }
    expect(await sideEffects(target.id)).toEqual(before);
    expect(await userRow(target.id)).toEqual({ status: 'ACTIVE', version: 1 });
    expect(await clientMe(food)).toBe(200);
  });

  it('an ADMIN needs view + lock on EVERY domain of the target; a missing scope is 403, an unreadable target 404; the hint follows the rights', async () => {
    const multi = await seedUser({ roles: ['CUSTOMER', 'DRIVER'], name: `Hoa Đa Vai ${tag}` });
    const customerOnly = await seedUser({ roles: ['CUSTOMER'], name: `Khách Một Vai ${tag}` });
    const [multiFood, multiShip] = (await appSessions(multi, true)) as [string, string];

    // One scope short (DRIVER view without lock): visible, hint empty, refused, nothing changed.
    expect(adminData(await detail(multi.id, partialLogin)).allowed_actions).toEqual([]);
    expect(codeOf(await change('lock', multi.id, partialLogin, body(1)))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    // The role selected in a session is irrelevant: the full set decides.
    expect(adminData(await detail(multi.id, fullLogin)).allowed_actions).toEqual(['LOCK', 'DELETE']);
    // The same admin may lock an account that only has the covered domain.
    expect(adminData(await detail(customerOnly.id, partialLogin)).allowed_actions).toEqual(['LOCK', 'DELETE']);
    // An admin without any view of the target's domains cannot even read it.
    expect(codeOf(await detail(customerOnly.id, shopLogin))).toEqual({ status: 404, code: 'USER_NOT_AVAILABLE' });
    expect(codeOf(await change('lock', customerOnly.id, shopLogin, body(1)))).toEqual({ status: 404, code: 'USER_NOT_AVAILABLE' });
    expect(codeOf(await change('lock', multi.id, shopLogin, body(1)))).toEqual({ status: 404, code: 'USER_NOT_AVAILABLE' });
    expect(await userRow(multi.id)).toEqual({ status: 'ACTIVE', version: 1 });
    expect(await liveSessions(multi.id)).toBe(2);
    expect(await sideEffects(multi.id)).toEqual([0, 0, 0, 2]);

    // A covered ADMIN locks: audit names the ADMIN, both sessions die.
    const key = randomUUID();
    const locked = await change('lock', multi.id, fullLogin, body(1, 'Gian lận'), { key });
    expect(locked.status).toBe(200);
    expect(await clientMe(multiFood)).toBe(401);
    expect(await clientMe(multiShip)).toBe(401);
    const audit = await app.pool.query<{ actor_type: string; actor_id: string }>('SELECT actor_type, actor_id FROM app.audit_logs WHERE resource_id = $1 AND action = $2', [multi.id, LOCK_ACTION]);
    expect(audit.rows).toEqual([{ actor_type: 'ADMIN', actor_id: adminFull.userId }]);

    // The replay is authorized AGAIN with the CURRENT rights: take the DRIVER lock right away and the same key is refused.
    const before = await sideEffects(multi.id);
    expect(adminData(await change('lock', multi.id, fullLogin, body(1, 'Gian lận'), { key })).version).toBe(2);
    await app.pool.query("UPDATE app.admin_app_permissions SET can_lock = false WHERE user_id = $1::uuid AND app = 'DRIVER'", [adminFull.userId]);
    try {
      expect(codeOf(await change('lock', multi.id, fullLogin, body(1, 'Gian lận'), { key }))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
      expect(adminData(await detail(multi.id, fullLogin)).allowed_actions).toEqual([]);
      expect(codeOf(await change('unlock', multi.id, fullLogin, body(2)))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    } finally {
      await app.pool.query("UPDATE app.admin_app_permissions SET can_lock = true WHERE user_id = $1::uuid AND app = 'DRIVER'", [adminFull.userId]);
    }
    expect(await sideEffects(multi.id)).toEqual(before);
    // A new role the ADMIN does not cover also stops the replay (the full role set is read again).
    await grantStrayRole(app.pool, multi.id, 'SHOP');
    try {
      expect(codeOf(await change('lock', multi.id, fullLogin, body(1, 'Gian lận'), { key }))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    } finally {
      await app.pool.query("DELETE FROM app.user_roles WHERE user_id = $1::uuid AND role = 'SHOP'", [multi.id]);
    }
    // SYSTEM is not limited by scopes.
    expect((await change('unlock', multi.id, systemLogin(), body(2), { key: randomUUID() })).status).toBe(200);
  });

  it('only ordinary accounts are targets: an ADMIN, the SYSTEM and an origin outside the policy are "not available"; a roleless account is SYSTEM-only', async () => {
    const adminTarget = await app.pool.query('SELECT version FROM app.users WHERE user_id = $1::uuid', [adminShop.userId]);
    const unverified = await seedUser({ roles: ['CUSTOMER'], origin: 'TEST_UNVERIFIED' });
    const legacy = await seedUser({ roles: [] });
    const attempts: Array<[string, string, AdminLogin]> = [
      ['an ADMIN by SYSTEM', adminShop.userId, systemLogin()],
      ['an ADMIN by another ADMIN', adminShop.userId, fullLogin],
      ['the SYSTEM by itself', system.account.userId, systemLogin()],
      ['an unknown id', randomUUID(), systemLogin()],
      ['an origin outside the policy', unverified.id, systemLogin()],
    ];
    for (const [name, id, who] of attempts) {
      for (const kind of ['lock', 'unlock'] as const) {
        expect([name, kind, codeOf(await change(kind, id, who, body(1)))]).toEqual([name, kind, { status: 404, code: 'USER_NOT_AVAILABLE' }]);
      }
    }
    expect(codeOf(await detail(unverified.id, systemLogin()))).toEqual({ status: 200, code: undefined });
    expect(adminData(await detail(unverified.id, systemLogin())).allowed_actions).toEqual([]);
    expect((await app.pool.query('SELECT version FROM app.users WHERE user_id = $1::uuid', [adminShop.userId])).rows).toEqual(adminTarget.rows);
    expect(await userRow(unverified.id)).toEqual({ status: 'ACTIVE', version: 1 });
    expect(await count(app.pool, "SELECT 1 FROM app.audit_logs WHERE action IN ('admin.user.lock.v1','admin.user.unlock.v1') AND resource_id = ANY($1::text[])", [[adminShop.userId, system.account.userId, unverified.id]])).toBe(0);

    // A user without a role: not readable by an ADMIN, lockable by SYSTEM.
    expect(codeOf(await change('lock', legacy.id, fullLogin, body(1)))).toEqual({ status: 404, code: 'USER_NOT_AVAILABLE' });
    expect(adminData(await detail(legacy.id, systemLogin())).allowed_actions).toEqual(['LOCK', 'DELETE']);
    expect((await change('lock', legacy.id, systemLogin(), body(1))).status).toBe(200);
  });

  it('the lock is atomic: a failure after the update rolls back the status, the revocation and the key; the same key then succeeds', async () => {
    const target = await seedUser({ roles: ['CUSTOMER'], name: `Khách Nguyên Tử ${tag}` });
    const [food] = (await appSessions(target, false)) as [string];
    const key = randomUUID();
    await installFault(app.pool, 'fault_lock_audit', 'app.audit_logs', 'INSERT', `NEW.action = '${LOCK_ACTION}' AND NEW.resource_id = '${target.id}'`);
    try {
      const failed = await change('lock', target.id, systemLogin(), body(1), { key });
      expect(failed.status).toBeGreaterThanOrEqual(500);
      expect(await userRow(target.id)).toEqual({ status: 'ACTIVE', version: 1 });
      expect(await liveSessions(target.id)).toBe(1);
      expect(await clientMe(food)).toBe(200);
      expect(await sideEffects(target.id)).toEqual([0, 0, 0, 1]);
      expect(await count(app.pool, "SELECT 1 FROM app.idempotency_records WHERE scope_id = $1 AND operation_id = 'admin.user.lock.v1'", [system.account.userId])).toBe(
        await count(app.pool, "SELECT 1 FROM app.idempotency_records WHERE scope_id = $1 AND operation_id = 'admin.user.lock.v1' AND idempotency_key <> $2", [system.account.userId, key]),
      );
    } finally {
      await removeFault(app.pool, 'fault_lock_audit', 'app.audit_logs');
    }
    expect((await change('lock', target.id, systemLogin(), body(1), { key })).status).toBe(200);
    expect(await sideEffects(target.id)).toEqual([1, 0, 1, 0]);
    expect(await clientMe(food)).toBe(401);
  });

  it('real browser: SYSTEM locks and unlocks from the user page; old tokens die; an ADMIN short of one scope gets no action', async () => {
    const target = await seedUser({ roles: ['CUSTOMER', 'DRIVER'], name: `Khách Trình Duyệt ${tag}` });
    const [food, ship] = (await appSessions(target, true)) as [string, string];
    const page: Page = await (browser as Browser).newPage();
    await page.viewport(1280, 800, false);
    await page.send('Network.clearBrowserCookies');
    const pressButton = (text: string): Promise<boolean> =>
      page.evaluate<boolean>(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent ?? '').trim() === ${JSON.stringify(text)} && !x.disabled); if (!b) return false; b.click(); return true; })()`);
    const dialogConfirm = (text: string): Promise<boolean> =>
      page.evaluate<boolean>(`(() => { const b = [...document.querySelectorAll('.dialog-actions button')].find((x) => (x.textContent ?? '').trim() === ${JSON.stringify(text)} && !x.disabled); if (!b) return false; b.click(); return true; })()`);

    // SYSTEM signs in and opens the user.
    await app.clearLimits();
    await page.goto(`${origin}/`);
    await page.waitFor(`document.querySelector('#login-title')`);
    await page.fill('#phone', system.account.phone.local);
    await page.fill('#password', system.account.password);
    await page.pressEnter();
    await page.waitFor(`document.querySelector('#verify-title')`);
    await rewindAcceptedStep(app, system.account.userId);
    await page.fill('#verify-code', totpNow(system.login.secret));
    await page.pressEnter();
    await page.waitFor(`document.querySelector('#shell-title')`);
    await page.goto(`${origin}/accounts/users/${target.id}`);
    await page.waitFor(`document.body.innerText.includes(${JSON.stringify(`Khách Trình Duyệt ${tag}`)}) && [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Khóa tài khoản')`);

    // The dialog needs a reason; Enter never confirms; nothing is sent until the red button is pressed.
    expect(await pressButton('Khóa tài khoản')).toBe(true);
    await page.waitFor(`document.querySelector('#lock-reason')`);
    expect(await dialogConfirm('Khóa')).toBe(true);
    await page.waitFor(`document.querySelector('#lock-reason-error').textContent.includes('Nhập lý do')`);
    await page.fill('#lock-reason', 'Nhiều phản ánh về đơn hàng');
    await page.pressEnter();
    expect(await userRow(target.id)).toEqual({ status: 'ACTIVE', version: 1 });
    expect(await clientMe(food)).toBe(200);
    expect(await dialogConfirm('Khóa')).toBe(true);
    await page.waitFor(`!document.querySelector('.dialog') && document.body.innerText.includes('Đang khóa') && [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Mở khóa')`);
    expect(await userRow(target.id)).toEqual({ status: 'DISABLED', version: 2 });
    expect(await clientMe(food)).toBe(401);
    expect(await clientMe(ship)).toBe(401);
    expect(await auditCount(target.id, LOCK_ACTION)).toBe(1);

    // Unlock: a new reason, the account is ACTIVE again, the old tokens stay dead, a new login works.
    expect(await pressButton('Mở khóa')).toBe(true);
    await page.waitFor(`document.querySelector('#lock-reason')`);
    await page.fill('#lock-reason', 'Đã xác minh xong');
    expect(await dialogConfirm('Mở khóa')).toBe(true);
    await page.waitFor(`!document.querySelector('.dialog') && [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Khóa tài khoản')`);
    expect(await userRow(target.id)).toEqual({ status: 'ACTIVE', version: 3 });
    expect(await clientMe(food)).toBe(401);
    expect((await clientLogin(target, { device_id: 'web-food-0001', platform: 'WEB', app: 'FOOD' })).status).toBe(200);
    expect(await auditCount(target.id, UNLOCK_ACTION)).toBe(1);

    // A stale page: another admin changed the account meanwhile -> the dialog says so and nothing is changed.
    expect(await pressButton('Khóa tài khoản')).toBe(true);
    await page.waitFor(`document.querySelector('#lock-reason')`);
    await app.pool.query("UPDATE app.users SET version = version + 1, updated_at = clock_timestamp() WHERE user_id = $1::uuid", [target.id]);
    await page.fill('#lock-reason', 'Lý do thử');
    expect(await dialogConfirm('Khóa')).toBe(true);
    await page.waitFor(`document.body.innerText.includes('Dữ liệu tài khoản đã thay đổi')`);
    expect(await userRow(target.id)).toEqual({ status: 'ACTIVE', version: 4 });
    expect(await dialogConfirm('Tải lại chi tiết')).toBe(true);
    await page.waitFor(`!document.querySelector('.dialog') && document.body.innerText.includes('4')`);

    // The ADMIN short of the DRIVER lock right sees the account but gets no action; the server refuses a direct call too.
    await page.evaluate('fetch("/v1/admin-auth/logout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then(() => true)').catch(() => undefined);
    await app.pool.query('UPDATE app.admin_sessions SET revoked_at = clock_timestamp() WHERE user_id = $1::uuid AND revoked_at IS NULL', [system.account.userId]);
    await app.clearLimits();
    await page.goto(`${origin}/`);
    await page.waitFor(`document.querySelector('#login-title')`);
    await page.fill('#phone', adminPartial.phone.local);
    await page.fill('#password', ADMIN_PASSWORD);
    await page.pressEnter();
    await page.waitFor(`document.querySelector('#verify-title')`);
    await rewindAcceptedStep(app, adminPartial.userId);
    await page.fill('#verify-code', totpNow(adminPartial.secret));
    await page.pressEnter();
    await page.waitFor(`document.querySelector('a[href="/accounts/users"]')`);
    await page.goto(`${origin}/accounts/users/${target.id}`);
    await page.waitFor(`document.body.innerText.includes(${JSON.stringify(`Khách Trình Duyệt ${tag}`)}) && document.body.innerText.includes('Bạn không có thao tác khóa, mở khóa hoặc xóa')`);
    expect(await page.evaluate<boolean>(`![...document.querySelectorAll('button')].some((b) => /Khóa tài khoản|Mở khóa/.test(b.textContent ?? ''))`)).toBe(true);
    expect(page.consoleErrors).toEqual([]);
    await page.close();
  }, 300_000);
});

describe('admin account lock with the gate closed (the default)', () => {
  let app: AdminApp;
  let system: SystemSession;

  beforeAll(async () => {
    app = await startAdminApp({ activationDisabledTest: true });
    system = await systemSession(app);
  }, 300_000);

  afterAll(async () => {
    await app?.close();
  });

  it('refuses USER_ACCOUNT_IMPACT_REVIEW_REQUIRED, changes nothing and offers no action', async () => {
    const phone = randomPhone();
    app.track(phone.normalized);
    const id = randomUUID();
    const hash = await new Argon2idPasswordHasher().hash(ADMIN_PASSWORD);
    await app.pool.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
       VALUES ($1::uuid, $2, $3, clock_timestamp(), 'PHONE_VERIFIED', 'ACTIVE', 1, clock_timestamp(), clock_timestamp())`,
      [id, phone.normalized, hash],
    );
    await grantStrayRole(app.pool, id, 'CUSTOMER');
    const who = { cookie: system.login.cookie, csrf: system.login.csrf };
    const hint = await app.call('GET', `/users/${id}`, { basePath: ADMIN_BASE, cookies: sessionCookies(who) });
    expect(adminData(hint).allowed_actions).toEqual([]);
    for (const kind of ['lock', 'unlock']) {
      const response = await app.call('POST', `/users/${id}/${kind}`, {
        basePath: ADMIN_BASE,
        body: { expected_version: 1, reason: 'thử' },
        cookies: sessionCookies(who),
        csrf: who.csrf,
        headers: { 'idempotency-key': randomUUID() },
      });
      expect([response.status, adminErrorCode(response)]).toEqual([409, 'USER_ACCOUNT_IMPACT_REVIEW_REQUIRED']);
      expect(response.text).not.toContain('thử');
    }
    const row = await app.pool.query('SELECT status, version::text AS version FROM app.users WHERE user_id = $1::uuid', [id]);
    expect(row.rows).toEqual([{ status: 'ACTIVE', version: '1' }]);
    expect(await count(app.pool, "SELECT 1 FROM app.audit_logs WHERE resource_id = $1", [id])).toBe(0);
  });
});
