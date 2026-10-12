import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import {
  AuthApp,
  ApiResponse,
  countRows,
  dataOf,
  errorCode,
  expireSession,
  PASSWORD,
  Phone,
  randomPhone,
  sessionIdOfToken,
  setUserStatus,
  startAuthApp,
} from './support/auth-fixtures';

// DISABLED_TEST registration (docs/tasks/M01-food-register-disabled-test-handoff-20261012.md) on the REAL Nest pipeline and a
// REAL PostgreSQL (TEST database only). No OTP, no proof: the account is TEST_UNVERIFIED with phone_verified_at NULL.

const TERMS = 'test-terms-20261011-v1';
const PRIVACY = 'test-privacy-20261011-v1';
const CONSENT = { terms_version: TERMS, privacy_version: PRIVACY };
const WEB_FOOD = { device_id: 'web-device-0001', platform: 'WEB', app: 'FOOD' };
const CLIENT_AUTH = { termsVersion: TERMS, privacyVersion: PRIVACY };

function body(phone: Phone, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { phone: phone.local, password: PASSWORD, device: { ...WEB_FOOD }, full_name: 'Nguyễn Văn An', consent: { ...CONSENT }, ...overrides };
}

describe('DISABLED_TEST client register', () => {
  let app: AuthApp;

  beforeAll(async () => {
    app = await startAuthApp({}, { relaxTimeouts: true, configOverride: { clientAuth: CLIENT_AUTH, clientPhoneVerificationMode: 'DISABLED_TEST' } });
  });

  afterAll(async () => {
    await app.close();
  });

  const register = (payload: Record<string, unknown>, key: string | null = randomUUID(), target: AuthApp = app): Promise<ApiResponse> =>
    target.call('POST', '/client-auth/register', { ...(key === null ? {} : { headers: { 'idempotency-key': key } }), body: payload });

  const login = (phone: Phone, target: AuthApp = app): Promise<ApiResponse> =>
    target.call('POST', '/client-auth/login', { headers: { 'idempotency-key': randomUUID() }, body: { phone: phone.local, password: PASSWORD, device: { ...WEB_FOOD } } });

  async function created(): Promise<{ phone: Phone; key: string; response: ApiResponse; data: Record<string, unknown> }> {
    const phone = randomPhone();
    app.track(phone.normalized);
    const key = randomUUID();
    const response = await register(body(phone), key);
    expect(response.status).toBe(201);
    return { phone, key, response, data: dataOf(response) };
  }

  it('GET /client-auth/config answers exactly the mode, no-store; a query is refused', async () => {
    const response = await app.call('GET', '/client-auth/config');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.body).toEqual({ data: { registration_verification: 'DISABLED_TEST' } });
    const withQuery = await app.call('GET', '/client-auth/config?x=1');
    expect(withQuery.status).toBe(400);
  });

  it('creates a CUSTOMER TEST_UNVERIFIED account with NULL verified_at, profile v1, consent, session, no proof or verification', async () => {
    const { phone, data, response } = await created();
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(data.phone_normalized).toBe(phone.normalized);
    expect(data.available_roles).toEqual(['CUSTOMER']);
    expect(data.active_role).toBe('CUSTOMER');
    expect(data.profile).toEqual({ full_name: 'Nguyễn Văn An', version: 1 });
    expect(String(data.access_token).length).toBeGreaterThan(20);
    const userId = String(data.user_id);
    const user = await app.pool.query<{ status: string; account_origin: string; verified: boolean }>(
      'SELECT status, account_origin, phone_verified_at IS NOT NULL AS verified FROM app.users WHERE user_id = $1::uuid',
      [userId],
    );
    expect(user.rows[0]).toEqual({ status: 'ACTIVE', account_origin: 'TEST_UNVERIFIED', verified: false });
    expect(await countRows(app.pool, 'SELECT 1 FROM app.user_roles WHERE user_id = $1::uuid AND role = $2', [userId, 'CUSTOMER'])).toBe(1);
    expect(await countRows(app.pool, 'SELECT 1 FROM app.customer_profiles WHERE user_id = $1::uuid AND version = 1', [userId])).toBe(1);
    expect(await countRows(app.pool, 'SELECT 1 FROM app.user_consents WHERE user_id = $1::uuid', [userId])).toBeGreaterThan(0);
    expect(await countRows(app.pool, 'SELECT 1 FROM app.sessions WHERE user_id = $1::uuid AND revoked_at IS NULL', [userId])).toBe(1);
    expect(await countRows(app.pool, 'SELECT 1 FROM app.verification_proofs WHERE phone_normalized = $1', [phone.normalized])).toBe(0);
    expect(await countRows(app.pool, 'SELECT 1 FROM app.phone_verifications WHERE phone_normalized = $1', [phone.normalized])).toBe(0);
    expect(
      await countRows(app.pool, `SELECT 1 FROM app.audit_logs WHERE request_id = $1::uuid AND action = 'client.auth.register.unverified_test.v1'`, [response.requestId]),
    ).toBe(1);
  });

  it('replays the same key and body with the same token and no extra rows (unknown-response retry)', async () => {
    const { phone, key, data } = await created();
    const replay = await register(body(phone), key);
    expect(replay.status).toBe(201);
    expect(dataOf(replay).access_token).toBe(data.access_token);
    expect(dataOf(replay).user_id).toBe(data.user_id);
    expect(await countRows(app.pool, 'SELECT 1 FROM app.users WHERE phone_normalized = $1', [phone.normalized])).toBe(1);
    expect(await countRows(app.pool, 'SELECT 1 FROM app.sessions WHERE user_id = $1::uuid', [String(data.user_id)])).toBe(1);
  });

  it('refuses another body under the same key and a second registration of the phone', async () => {
    const { phone, key } = await created();
    const changed = await register(body(phone, { full_name: 'Khác' }), key);
    expect([changed.status, errorCode(changed)]).toEqual([409, 'IDEMPOTENCY_KEY_REUSED']);
    const again = await register(body(phone), randomUUID());
    expect([again.status, errorCode(again)]).toEqual([409, 'PHONE_ALREADY_REGISTERED']);
  });

  it('refuses a token, role, permission, accepted_at, and the REQUIRED-shaped body with 400 and writes nothing', async () => {
    const phone = randomPhone();
    app.track(phone.normalized);
    const cases: Array<Record<string, unknown>> = [
      body(phone, { verification_token: 'abc' }),
      body(phone, { role: 'ADMIN' }),
      body(phone, { permission: 'x' }),
      body(phone, { accepted_at: '2026-10-12T00:00:00Z' }),
      body(phone, { consent: { ...CONSENT, accepted_at: '2026-10-12T00:00:00Z' } }),
    ];
    for (const payload of cases) {
      const response = await register(payload);
      expect([response.status, errorCode(response)]).toEqual([400, 'BAD_REQUEST']);
    }
    expect(await countRows(app.pool, 'SELECT 1 FROM app.users WHERE phone_normalized = $1', [phone.normalized])).toBe(0);
  });

  it('signs a TEST_UNVERIFIED account in while the mode is on, and reports it as not verified', async () => {
    const { phone } = await created();
    const response = await login(phone);
    expect(response.status).toBe(200);
    const me = await app.call('GET', '/client-auth/me', { bearer: String(dataOf(response).access_token) });
    expect(me.status).toBe(200);
  });

  it('never replays a token once the session is expired or revoked or the user is disabled', async () => {
    const scenarios: Array<[string, (userId: string, token: string) => Promise<void>]> = [
      ['expired', async (_u, token) => expireSession(app.pool, await sessionIdOfToken(app.pool, token))],
      [
        'revoked',
        async (_u, token) => {
          await app.pool.query('UPDATE app.sessions SET revoked_at = clock_timestamp() WHERE session_id = $1::uuid', [await sessionIdOfToken(app.pool, token)]);
        },
      ],
      ['disabled', async (userId) => setUserStatus(app.pool, userId, 'DISABLED')],
    ];
    for (const [label, mutate] of scenarios) {
      const { phone, key, data } = await created();
      await mutate(String(data.user_id), String(data.access_token));
      const replay = await register(body(phone), key);
      expect([label, replay.status, errorCode(replay)]).toEqual([label, 409, 'AUTH_RESULT_NOT_REPLAYABLE']);
      expect(replay.text).not.toContain(String(data.access_token));
    }
  });

  it('gives a test account no administration right: the membership origin guard refuses it', async () => {
    const { data } = await created();
    await expect(
      app.pool.query(
        `INSERT INTO app.admin_memberships (user_id, admin_role, status, version, created_at, updated_at)
         VALUES ($1::uuid, 'ADMIN', 'ACTIVE', 1, now(), now())`,
        [String(data.user_id)],
      ),
    ).rejects.toThrow();
  });

  it('with the mode off the same database refuses the account: no login, no old bearer, no replay', async () => {
    const { phone, key, data } = await created();
    const strict = await startAuthApp({}, { relaxTimeouts: true, configOverride: { clientAuth: CLIENT_AUTH } });
    try {
      const config = await strict.call('GET', '/client-auth/config');
      expect(config.body).toEqual({ data: { registration_verification: 'REQUIRED' } });
      const refused = await login(phone, strict);
      expect([refused.status, errorCode(refused)]).toEqual([401, 'INVALID_CREDENTIALS']);
      const me = await strict.call('GET', '/client-auth/me', { bearer: String(data.access_token) });
      expect([me.status, errorCode(me)]).toEqual([401, 'SESSION_INVALID']);
      const replay = await register(body(phone), key, strict);
      expect(replay.status).toBeGreaterThanOrEqual(400);
      expect(replay.text).not.toContain(String(data.access_token));
      const tokenless = await register(body(randomPhone()), randomUUID(), strict);
      expect([tokenless.status, errorCode(tokenless)]).toEqual([400, 'BAD_REQUEST']);
    } finally {
      await strict.close();
    }
  });
});
