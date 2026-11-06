import { createHash, randomBytes, randomUUID } from 'node:crypto';
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
  const me = (app: AuthApp, token: string) => api(app.running.baseUrl, 'GET', '/client-auth/me', { bearer: token });
  /**
   * OD-1: no client login exists for a STAGING_FIXTURE account (the legacy /auth/login that served it is gone), so a fixture
   * session is minted as the removed login left it: a WEB/FOOD session row of the account, token digest = SHA-256 of the token.
   */
  async function mintSession(phone: Phone): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await fixtureApp.pool.query(
      `INSERT INTO app.sessions (session_id, user_id, token_digest, device_id, platform, app, active_role, expires_at, created_at, updated_at)
       SELECT $1::uuid, user_id, $2, 'fixture-device-1', 'WEB', 'FOOD', NULL, clock_timestamp() + interval '1 hour', clock_timestamp(), clock_timestamp()
         FROM app.users WHERE phone_normalized = $3`,
      [randomUUID(), createHash('sha256').update(token, 'utf8').digest('hex'), phone.normalized],
    );
    return token;
  }

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

  it('an allowlisted fixture has no client login (like an unknown phone), and a fixture-origin session is no client session', async () => {
    // OD-1 (N): the legacy /auth/login that signed a fixture in (UNVERIFIED_TEST, no role) is gone and /client-auth has no
    // equivalent: client login and the client session guard both refuse a STAGING_FIXTURE origin in every mode.
    const response = await loginUser(fixtureApp, { phone: allowed, password: PASSWORD });
    expect([response.status, errorCode(response)]).toEqual([401, 'INVALID_CREDENTIALS']);
    const denied = await me(fixtureApp, await mintSession(allowed));
    expect([denied.status, errorCode(denied)]).toEqual([401, 'SESSION_INVALID']);
    const roles = await fixtureApp.pool.query(
      'SELECT 1 FROM app.user_roles r JOIN app.users u ON u.user_id = r.user_id WHERE u.phone_normalized = $1',
      [allowed.normalized],
    );
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

  it('narrowing the allowlist: the narrowed process still refuses the removed number at login', async () => {
    const refused = await loginUser(narrowedApp, { phone: removed, password: PASSWORD });
    expect([refused.status, errorCode(refused)]).toEqual([401, 'INVALID_CREDENTIALS']);
  });

  it('a session of a verified account is not usable in fixture mode, nor a minted fixture session in the standard process', async () => {
    const verified = await loginUser(standardApp, { phone: verifiedPhone, password: PASSWORD });
    const verifiedToken = String(dataOf(verified).access_token);
    const denied = await me(fixtureApp, verifiedToken);
    expect([denied.status, errorCode(denied)]).toEqual([401, 'SESSION_INVALID']);

    const deniedStandard = await me(standardApp, await mintSession(allowed));
    expect([deniedStandard.status, errorCode(deniedStandard)]).toEqual([401, 'SESSION_INVALID']);
  });
});
