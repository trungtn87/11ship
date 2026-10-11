import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createAccountOriginPolicy, standardAccountOriginPolicy } from '../../apps/backend/src/auth/account-origin';
import { Argon2idPasswordHasher } from '../../apps/backend/src/auth/password-hasher';
import { PhoneAllowlist } from '../../apps/backend/src/config/staging-fixtures-config';
import { api, AuthApp, dataOf, errorCode, loginUser, PASSWORD, Phone, randomPhone, startAuthApp } from './support/auth-fixtures';

// Issue #49 — the staging fixture mode through the REAL Nest pipeline and PostgreSQL: login, /me, closed registration,
// roleless fixtures, an administration account that never signs in here, and an allowlist change that invalidates the
// sessions of the previous process without revoking them (policy rejection is not revocation).
describe('issue #49 — staging fixture mode (application Auth)', () => {
  const hasher = new Argon2idPasswordHasher();
  let hash: string;
  let fixtureApp: AuthApp;
  let narrowedApp: AuthApp;
  let standardApp: AuthApp;
  const allowed = randomPhone();
  const removed = randomPhone();
  const verifiedPhone = randomPhone();
  const adminPhone = randomPhone();
  const unlisted = randomPhone();

  const policyFor = (phones: readonly string[]) =>
    createAccountOriginPolicy({ appEnv: 'staging', fixtureModeEnabled: true, allowedPhones: new PhoneAllowlist(phones) });

  async function insert(phone: Phone, origin: 'PHONE_VERIFIED' | 'ADMIN_PROVISIONED' | 'STAGING_FIXTURE'): Promise<string> {
    const userId = randomUUID();
    fixtureApp.track(phone.normalized);
    await fixtureApp.pool.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
       VALUES ($1::uuid, $2, $3, ${origin === 'PHONE_VERIFIED' ? 'now()' : 'NULL'}, $4, 'ACTIVE', 1, now(), now())`,
      [userId, phone.normalized, hash, origin],
    );
    return userId;
  }
  const me = (app: AuthApp, token: string) => api(app.running.baseUrl, 'GET', '/auth/me', { bearer: token });

  beforeAll(async () => {
    hash = await hasher.hash(PASSWORD);
    // Process 1: fixture mode, allowlist = allowed + removed. Process 2: the same database, allowlist = allowed only.
    fixtureApp = await startAuthApp({}, { fixturePolicy: policyFor([allowed.normalized, removed.normalized]) });
    narrowedApp = await startAuthApp({}, { fixturePolicy: policyFor([allowed.normalized]) });
    standardApp = await startAuthApp({}, {});
    for (const [phone, origin] of [
      [allowed, 'STAGING_FIXTURE'], [removed, 'STAGING_FIXTURE'], [unlisted, 'STAGING_FIXTURE'],
      [verifiedPhone, 'PHONE_VERIFIED'], [adminPhone, 'ADMIN_PROVISIONED'],
    ] as const) {
      await insert(phone, origin);
    }
  }, 60_000);

  afterAll(async () => {
    await narrowedApp.close();
    await standardApp.close();
    await fixtureApp.close();
  });

  it('an allowlisted fixture signs in with its password: UNVERIFIED_TEST, no role, /me works', async () => {
    const response = await loginUser(fixtureApp, { phone: allowed, password: PASSWORD });
    expect(response.status).toBe(200);
    const data = dataOf(response);
    expect(data.phone_verification_status).toBe('UNVERIFIED_TEST');
    expect(data.available_roles).toEqual([]);
    expect(data.active_role).toBeNull();
    const profile = await me(fixtureApp, String(data.access_token));
    expect(profile.status).toBe(200);
    // No role can be selected: the fixture owns no role, shop or driver profile.
    for (const role of ['CUSTOMER', 'SHOP', 'DRIVER']) {
      const selected = await api(fixtureApp.running.baseUrl, 'POST', '/auth/role/select', { bearer: String(data.access_token), body: { role } });
      expect(selected.status).toBeGreaterThanOrEqual(400);
    }
    const roles = await fixtureApp.pool.query('SELECT 1 FROM app.user_roles WHERE user_id = $1::uuid', [String(data.user_id)]);
    expect(roles.rowCount).toBe(0);
  });

  it('a wrong password, a fixture outside the allowlist, a verified account and an administration account all look like a wrong password', async () => {
    const wrong = await loginUser(fixtureApp, { phone: allowed, password: 'Wrong-Passw0rd-Entirely' });
    expect([wrong.status, errorCode(wrong)]).toEqual([401, 'INVALID_CREDENTIALS']);
    for (const phone of [unlisted, verifiedPhone, adminPhone]) {
      const response = await loginUser(fixtureApp, { phone, password: PASSWORD });
      expect([response.status, errorCode(response)]).toEqual([401, 'INVALID_CREDENTIALS']);
      expect(response.text.replace(/"request_id":"[^"]+"/, '')).toBe(wrong.text.replace(/"request_id":"[^"]+"/, ''));
    }
  });

  it('registration and phone verification are closed (503 AUTH_REGISTRATION_UNAVAILABLE) and no challenge is stored', async () => {
    const phone = randomPhone();
    fixtureApp.track(phone.normalized);
    const response = await api(fixtureApp.running.baseUrl, 'POST', '/auth/phone-verifications', { body: { phone: phone.local, purpose: 'REGISTER' } });
    expect([response.status, errorCode(response)]).toEqual([503, 'AUTH_REGISTRATION_UNAVAILABLE']);
    const stored = await fixtureApp.pool.query('SELECT 1 FROM app.phone_verifications WHERE phone_normalized = $1', [phone.normalized]);
    expect(stored.rowCount).toBe(0);
  });

  it('a process without fixture mode never accepts a fixture, and still accepts a verified account', async () => {
    const fixture = await loginUser(standardApp, { phone: allowed, password: PASSWORD });
    expect([fixture.status, errorCode(fixture)]).toEqual([401, 'INVALID_CREDENTIALS']);
    const verified = await loginUser(standardApp, { phone: verifiedPhone, password: PASSWORD });
    expect(verified.status).toBe(200);
    expect(dataOf(verified).phone_verification_status).toBe('VERIFIED');
    expect(createAccountOriginPolicy({ appEnv: 'production', fixtureModeEnabled: true, allowedPhones: new PhoneAllowlist([allowed.normalized]) }).fixtureMode).toBe(false);
    expect(standardAccountOriginPolicy().fixtureMode).toBe(false);
  });

  it('narrowing the allowlist invalidates the old session in the new process, WITHOUT revoking it, and the old process still accepts it', async () => {
    const login = await loginUser(fixtureApp, { phone: removed, password: PASSWORD });
    expect(login.status).toBe(200);
    const token = String(dataOf(login).access_token);
    expect((await me(fixtureApp, token)).status).toBe(200);

    const denied = await me(narrowedApp, token);
    expect([denied.status, errorCode(denied)]).toEqual([401, 'SESSION_INVALID']);
    const row = await fixtureApp.pool.query<{ revoked_at: Date | null }>(
      `SELECT s.revoked_at FROM app.sessions s JOIN app.users u ON u.user_id = s.user_id WHERE u.phone_normalized = $1`,
      [removed.normalized],
    );
    expect(row.rows.length).toBeGreaterThan(0);
    expect(row.rows.every((r) => r.revoked_at === null)).toBe(true);
    // Allowing the number again (the first process) works with the same, never revoked, token.
    expect((await me(fixtureApp, token)).status).toBe(200);
    // And the login itself is refused by the narrowed process.
    const refused = await loginUser(narrowedApp, { phone: removed, password: PASSWORD });
    expect([refused.status, errorCode(refused)]).toEqual([401, 'INVALID_CREDENTIALS']);
  });

  it('a session of a verified account is not usable in fixture mode, nor a fixture session in the standard process', async () => {
    const verified = await loginUser(standardApp, { phone: verifiedPhone, password: PASSWORD });
    const verifiedToken = String(dataOf(verified).access_token);
    const denied = await me(fixtureApp, verifiedToken);
    expect([denied.status, errorCode(denied)]).toEqual([401, 'SESSION_INVALID']);

    const fixture = await loginUser(fixtureApp, { phone: allowed, password: PASSWORD });
    const deniedStandard = await me(standardApp, String(dataOf(fixture).access_token));
    expect([deniedStandard.status, errorCode(deniedStandard)]).toEqual([401, 'SESSION_INVALID']);
  });
});
