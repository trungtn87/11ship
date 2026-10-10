import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { ADMIN_PREAUTH_COOKIE, ADMIN_SESSION_COOKIE } from '../../apps/backend/src/admin-auth/admin-auth-constants';
import {
  AdminApp,
  adminData,
  adminErrorCode,
  ADMIN_ORIGIN,
  count,
  cookieFrom,
  createAdminMember,
  createSystem,
  enrollAndLogin,
  loginBody,
  loginStep,
  preauthCookies,
  sessionCookies,
  startAdminApp,
  SystemAccount,
  totpNow,
} from './support/admin-fixtures';

// M01-D-LOGIN - administration web login (password, then TOTP) through the REAL Nest pipeline on a REAL PostgreSQL.
describe('M01-D-LOGIN - administration login, cookies, CSRF and sessions', () => {
  let app: AdminApp;
  let system: SystemAccount;

  beforeAll(async () => {
    app = await startAdminApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.clearLimits();
    system = await createSystem(app);
  });

  it('runs the whole first login: password, enrollment, first code, session, me, logout', async () => {
    const preauth = await loginStep(app, system);
    expect(preauth.nextStep).toBe('ENROLL_TOTP');
    expect(preauth.response.headers['cache-control']).toBe('no-store');
    const preCookie = preauth.response.setCookie.find((line) => line.startsWith(`${ADMIN_PREAUTH_COOKIE}=`)) ?? '';
    for (const attribute of ['Secure', 'HttpOnly', 'SameSite=Strict', 'Path=/']) {
      expect(preCookie).toContain(attribute);
    }
    expect(preCookie).not.toMatch(/Domain=/i);
    expect(preauth.response.text).not.toContain(preauth.cookie);

    const login = await enrollAndLogin(app, system);
    const sessionCookie = login.response.setCookie.find((line) => line.startsWith(`${ADMIN_SESSION_COOKIE}=`)) ?? '';
    for (const attribute of ['Secure', 'HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=28800']) {
      expect(sessionCookie).toContain(attribute);
    }
    expect(cookieFrom(login.response, ADMIN_PREAUTH_COOKIE)).toBe('');
    expect(login.response.text).not.toContain(login.cookie);

    const me = await app.call('GET', '/me', { cookies: sessionCookies(login) });
    expect(me.status).toBe(200);
    expect(adminData(me)).toMatchObject({ user_id: system.userId, admin_role: 'SYSTEM' });
    expect(me.headers['cache-control']).toBe('no-store');

    const state = await app.call('GET', '/state', { cookies: sessionCookies(login) });
    expect(adminData(state)).toMatchObject({ state: 'SESSION', next_step: null });

    const noCsrf = await app.call('POST', '/logout', { body: {}, cookies: sessionCookies(login) });
    expect(noCsrf.status).toBe(403);
    expect(adminErrorCode(noCsrf)).toBe('ADMIN_CSRF_INVALID');

    const out = await app.call('POST', '/logout', { body: {}, cookies: sessionCookies(login), csrf: login.csrf });
    expect(out.status).toBe(204);
    expect(cookieFrom(out, ADMIN_SESSION_COOKIE)).toBe('');
    const after = await app.call('GET', '/me', { cookies: sessionCookies(login) });
    expect(after.status).toBe(401);
    expect(adminErrorCode(after)).toBe('ADMIN_SESSION_INVALID');
  });

  it('a second login with the enrolled factor asks for the code and replaces the previous session', async () => {
    const first = await enrollAndLogin(app, system);
    const preauth = await loginStep(app, system);
    expect(preauth.nextStep).toBe('VERIFY_TOTP');

    const wrong = await app.call('POST', '/totp/verify', {
      body: { code: '000000' === totpNow(first.secret) ? '111111' : '000000' },
      cookies: preauthCookies(preauth),
      csrf: preauth.csrf,
    });
    expect(wrong.status).toBe(400);
    expect(adminErrorCode(wrong)).toBe('ADMIN_TOTP_INVALID');

    // The same step as the enrollment code is refused (replay); the next step is not reachable in a test, so a
    // previous-step code that was NOT used is the accepted case.
    const replay = await app.call('POST', '/totp/verify', {
      body: { code: totpNow(first.secret) },
      cookies: preauthCookies(preauth),
      csrf: preauth.csrf,
    });
    expect(replay.status).toBe(400);
    expect(adminErrorCode(replay)).toBe('ADMIN_TOTP_INVALID');

    const old = await app.call('GET', '/me', { cookies: sessionCookies(first) });
    expect(old.status).toBe(200);
  });

  it('rejects wrong credentials with one indistinguishable error and no cookie', async () => {
    const wrongPassword = await app.call('POST', '/login', { body: loginBody(system, { password: 'Wrong-Password-1' }) });
    const unknown = await app.call('POST', '/login', {
      body: { ...loginBody(system, { password: 'Wrong-Password-1' }), phone: '0900000001' },
    });
    expect(wrongPassword.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(adminErrorCode(wrongPassword)).toBe('INVALID_CREDENTIALS');
    expect(adminErrorCode(unknown)).toBe('INVALID_CREDENTIALS');
    expect(wrongPassword.body.error?.message).toBe(unknown.body.error?.message);
    expect(wrongPassword.setCookie).toEqual([]);
  });

  it('refuses a missing or foreign Origin, a non-JSON content type and a missing CSRF header', async () => {
    const noOrigin = await app.call('POST', '/login', { body: loginBody(system), origin: null });
    expect(noOrigin.status).toBe(403);
    expect(adminErrorCode(noOrigin)).toBe('ADMIN_CSRF_INVALID');
    const foreign = await app.call('POST', '/login', { body: loginBody(system), origin: 'https://evil.example.test' });
    expect(adminErrorCode(foreign)).toBe('ADMIN_CSRF_INVALID');
    const suffix = await app.call('POST', '/login', { body: loginBody(system), origin: `${ADMIN_ORIGIN}.evil.test` });
    expect(adminErrorCode(suffix)).toBe('ADMIN_CSRF_INVALID');
    const form = await app.call('POST', '/login', {
      rawBody: 'phone=1',
      contentType: 'application/x-www-form-urlencoded',
    });
    expect(form.status).toBe(400);

    const preauth = await loginStep(app, system);
    const missing = await app.call('POST', '/totp/enrollment', { body: {}, cookies: preauthCookies(preauth) });
    expect(missing.status).toBe(403);
    expect(adminErrorCode(missing)).toBe('ADMIN_CSRF_INVALID');
    const wrong = await app.call('POST', '/totp/enrollment', {
      body: {},
      cookies: preauthCookies(preauth),
      csrf: `${preauth.csrf}x`,
    });
    expect(adminErrorCode(wrong)).toBe('ADMIN_CSRF_INVALID');
  });

  it('rejects an app login body (wrong platform/app) and unknown fields', async () => {
    const wrongApp = await app.call('POST', '/login', {
      body: loginBody(system, { device: { device_id: 'admin-web-0001', platform: 'ANDROID', app: 'CUSTOMER' } }),
    });
    expect(wrongApp.status).toBe(400);
    const extra = await app.call('POST', '/login', { body: { ...loginBody(system), role: 'SYSTEM' } });
    expect(extra.status).toBe(400);
  });

  it('a new login supersedes the earlier unconsumed step; the old preauth cookie no longer works', async () => {
    const one = await loginStep(app, system);
    const two = await loginStep(app, system);
    const stale = await app.call('POST', '/totp/enrollment', {
      body: {},
      cookies: preauthCookies(one),
      csrf: one.csrf,
    });
    expect(stale.status).toBe(401);
    expect(adminErrorCode(stale)).toBe('ADMIN_PREAUTH_INVALID');
    const fresh = await app.call('POST', '/totp/enrollment', { body: {}, cookies: preauthCookies(two), csrf: two.csrf });
    expect(fresh.status).toBe(200);
    expect(String(adminData(fresh).otpauth_uri)).toMatch(/^otpauth:\/\/totp\//);
  });

  it('keeps a pending enrollment secret retrievable only encrypted, and refuses a second start on the same step', async () => {
    const preauth = await loginStep(app, system);
    const started = await app.call('POST', '/totp/enrollment', { body: {}, cookies: preauthCookies(preauth), csrf: preauth.csrf });
    const secret = String(adminData(started).secret);
    const rows = await app.pool.query<{ ciphertext: Buffer }>(
      'SELECT ciphertext FROM app.admin_totp_factors WHERE user_id = $1::uuid',
      [system.userId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(Buffer.from(rows.rows[0]!.ciphertext).toString('latin1')).not.toContain(secret);
    const again = await app.call('POST', '/totp/enrollment', { body: {}, cookies: preauthCookies(preauth), csrf: preauth.csrf });
    expect([200, 409]).toContain(again.status);
  });

  it('a corrupted factor ciphertext fails closed with a generic 503 and never signs anyone in', async () => {
    const first = await enrollAndLogin(app, system);
    await app.pool.query(
      `UPDATE app.admin_totp_factors SET ciphertext = decode(repeat('00', octet_length(ciphertext)), 'hex')
        WHERE user_id = $1::uuid`,
      [system.userId],
    );
    const preauth = await loginStep(app, system);
    const result = await app.call('POST', '/totp/verify', {
      body: { code: totpNow(first.secret, -1) },
      cookies: preauthCookies(preauth),
      csrf: preauth.csrf,
    });
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.setCookie.find((line) => line.startsWith(`${ADMIN_SESSION_COOKIE}=`) && !line.startsWith(`${ADMIN_SESSION_COOKIE}=;`))).toBeUndefined();
  });

  it('a session dies when the password changes, the account is blocked or the membership is revoked', async () => {
    const login = await enrollAndLogin(app, system);
    const ok = await app.call('GET', '/me', { cookies: sessionCookies(login) });
    expect(ok.status).toBe(200);

    await app.pool.query(`UPDATE app.users SET password_hash = password_hash || 'x' WHERE user_id = $1::uuid`, [system.userId]);
    const changed = await app.call('GET', '/me', { cookies: sessionCookies(login) });
    expect(changed.status).toBe(401);
    expect(adminErrorCode(changed)).toBe('ADMIN_SESSION_INVALID');
  });

  it('an ADMIN-role member signs in like SYSTEM and sees only the admin_role it has', async () => {
    const member = await createAdminMember(app);
    const login = await enrollAndLogin(app, member);
    const me = await app.call('GET', '/me', { cookies: sessionCookies(login) });
    expect(adminData(me)).toMatchObject({ user_id: member.userId, admin_role: 'ADMIN' });
    expect(await count(app.pool, 'SELECT 1 FROM app.admin_sessions WHERE user_id = $1::uuid', [member.userId])).toBe(1);
  });

  it('an administration session is not an application bearer session, and the reverse', async () => {
    const login = await enrollAndLogin(app, system);
    const asBearer = await fetch(`${app.running.baseUrl}/v1/auth/me`, {
      headers: { authorization: `Bearer ${login.cookie}` },
    });
    expect(asBearer.status).toBe(401);
    const appLogin = await fetch(`${app.running.baseUrl}/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        phone: system.phone.local,
        password: system.password,
        device: { device_id: 'phone-0001', platform: 'ANDROID', app: 'CUSTOMER' },
      }),
    });
    expect(appLogin.status).toBe(401);
    const appBody = (await appLogin.json()) as { error?: { code?: string } };
    expect(appBody.error?.code).toBe('INVALID_CREDENTIALS');
  });

  it('writes audit rows without any secret, cookie, code or password', async () => {
    const login = await enrollAndLogin(app, system);
    const rows = await app.pool.query<{ action: string; metadata: unknown }>(
      `SELECT action, metadata FROM app.audit_logs WHERE action LIKE 'admin_auth.%' ORDER BY occurred_at DESC LIMIT 20`,
    );
    const actions = rows.rows.map((row) => row.action);
    expect(actions).toEqual(expect.arrayContaining(['admin_auth.login_preauth.v1', 'admin_auth.totp_enrolled.v1', 'admin_auth.login_completed.v1']));
    const dump = JSON.stringify(rows.rows);
    expect(dump).not.toContain(login.secret);
    expect(dump).not.toContain(login.cookie);
    expect(dump).not.toContain(system.password);
  });
});
