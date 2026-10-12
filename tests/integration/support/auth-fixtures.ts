import { createHash, randomInt, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { AccountOriginPolicy } from '../../../apps/backend/src/auth/account-origin';
import { DisabledOtpProvider } from '../../../apps/backend/src/auth/disabled-otp-provider';
import { FakeOtpProvider } from '../../../apps/backend/src/auth/fake-otp-provider';
import { unverifiedTestScopeId } from '../../../apps/backend/src/client-auth/client-registration-service';
import { AppConfig } from '../../../apps/backend/src/config/app-config';
import { AuthConfig, OtpHmacKey } from '../../../apps/backend/src/config/auth-config';
import { fixtureKeyring } from '../../../apps/backend/src/crypto/test-keys.fixture';
import { loadIntegrationConfig, RunningApp, startApp } from './test-helpers';
import { testPool } from './transaction-fixtures';

// Shared fixtures of the M01-A1 Auth Core integration suites. Everything talks to the REAL PostgreSQL test
// database through the REAL Nest pipeline. Each test owns random phone numbers and removes only its own
// Auth rows afterwards. app.audit_logs is append-only and is never cleaned: tests find their audit rows by
// the X-Request-ID of the response, their outbox events by the user id.

export const PASSWORD = 'Correct-Horse-Battery-9';
export const OTHER_PASSWORD = 'Another-Passw0rd-Entirely';
export const DEVICE = Object.freeze({ device_id: 'device-test-0001', platform: 'ANDROID', app: 'SHIP11' });

export const TEST_OTP_KEY_BYTES = Buffer.alloc(32, 7);

export function authTestConfig(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return {
    otpTtlSeconds: 300,
    otpResendSeconds: 60,
    otpMaxAttempts: 5,
    proofTtlSeconds: 600,
    sessionTtlSeconds: 604_800,
    otpHmacKey: new OtpHmacKey(TEST_OTP_KEY_BYTES),
    ...overrides,
  };
}

/** A fresh Vietnamese mobile number: local form (0XXXXXXXXX) and its normalized form. */
export function randomPhone(): { local: string; normalized: string; international: string } {
  const subscriber = `9${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
  return { local: `0${subscriber}`, normalized: `+84${subscriber}`, international: `84${subscriber}` };
}

export interface ApiResponse {
  readonly status: number;
  readonly requestId: string;
  readonly text: string;
  /** Response headers (M01.03: no-store on the client-auth routes). */
  readonly headers: Headers;
  readonly body: {
    data?: Record<string, unknown>;
    error?: { code: string; message: string; request_id: string; details: unknown };
  };
}

export interface ApiOptions {
  readonly body?: unknown;
  /** Raw body text (to send malformed JSON). Wins over `body`. */
  readonly rawBody?: string;
  readonly headers?: Record<string, string>;
  readonly bearer?: string;
}

export async function api(
  baseUrl: string,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  options: ApiOptions = {},
): Promise<ApiResponse> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  let payload: string | undefined;
  if (options.rawBody !== undefined) {
    payload = options.rawBody;
    headers['content-type'] = 'application/json';
  } else if (options.body !== undefined) {
    payload = JSON.stringify(options.body);
    headers['content-type'] = 'application/json';
  }
  if (options.bearer !== undefined) {
    headers['authorization'] = `Bearer ${options.bearer}`;
  }
  const response = await fetch(`${baseUrl}/v1${path}`, {
    method,
    headers,
    ...(payload === undefined ? {} : { body: payload }),
  });
  const text = await response.text();
  let body: ApiResponse['body'] = {};
  try {
    body = JSON.parse(text) as ApiResponse['body'];
  } catch {
    // not JSON (for example an empty body): leave {}
  }
  return { status: response.status, requestId: response.headers.get('x-request-id') ?? '', text, headers: response.headers, body };
}

export function errorCode(response: ApiResponse): string | undefined {
  return response.body.error?.code;
}

export function dataOf(response: ApiResponse): Record<string, unknown> {
  if (response.body.data === undefined) {
    throw new Error(`expected a data envelope, got status ${response.status}: ${response.text}`);
  }
  return response.body.data;
}

export interface AuthApp {
  readonly running: RunningApp;
  readonly config: AppConfig;
  readonly provider: FakeOtpProvider;
  readonly pool: Pool;
  call(method: 'GET' | 'POST' | 'PUT', path: string, options?: ApiOptions): Promise<ApiResponse>;
  /** Registers a normalized phone for cleanup when the app closes. */
  track(normalizedPhone: string): void;
  close(): Promise<void>;
}

export async function startAuthApp(
  authOverrides: Partial<AuthConfig> = {},
  extra: {
    activeKeyId?: string;
    relaxTimeouts?: boolean;
    fixturePolicy?: AccountOriginPolicy;
    /** M01.03: configuration fields to override on top of the loaded one (clientAuth, host, appEnv). */
    configOverride?: Partial<AppConfig>;
  } = {},
): Promise<AuthApp> {
  const loaded = loadIntegrationConfig();
  // Concurrency tests hold locks for a moment on purpose. The production defaults (800 ms statement timeout,
  // 500 ms lock budget) would turn that deliberate wait into a timeout, so those tests ask for roomier limits.
  const base: AppConfig = extra.relaxTimeouts
    ? {
        ...loaded,
        database: { ...loaded.database, queryTimeoutMs: 20_000, statementTimeoutMs: 15_000 },
        transaction: { timeoutMs: 25_000, idleInTransactionTimeoutMs: 10_000 },
        idempotency: { ...loaded.idempotency, advisoryWaitMs: 5_000, businessLockTimeoutMs: 10_000 },
      }
    : loaded;
  const config: AppConfig = {
    ...base,
    crypto: fixtureKeyring(extra.activeKeyId ?? 'k1'),
    auth: authTestConfig(authOverrides),
    ...(extra.configOverride ?? {}),
  };
  const provider = new FakeOtpProvider();
  // Issue #49: with a fixture policy the app is bound exactly as staging fixture mode binds it (DisabledOtpProvider + the policy).
  const running = await startApp(config, {
    auth:
      extra.fixturePolicy === undefined
        ? { otpProvider: provider }
        : { otpProvider: new DisabledOtpProvider(), accountOriginPolicy: extra.fixturePolicy },
  });
  const pool = testPool(loaded.database, { poolMax: 6 });
  const tracked = new Set<string>();

  return {
    running,
    config,
    provider,
    pool,
    call: (method, path, options) => api(running.baseUrl, method, path, options),
    track: (phone) => {
      tracked.add(phone);
    },
    async close(): Promise<void> {
      try {
        for (const phone of tracked) {
          await purgePhone(pool, phone);
        }
        await purgeTestServiceAreas(pool);
      } finally {
        await pool.end();
        await running.app.close();
      }
    },
  };
}

/** Removes every Auth row of one phone number (and the register idempotency records of its proofs). */
export async function purgePhone(pool: Pool, normalizedPhone: string): Promise<void> {
  // M01-A2S: shops owned by the user, their memberships and the user-scoped onboarding idempotency records.
  await pool.query(
    `DELETE FROM app.idempotency_records
      WHERE scope_type = 'user'
        AND scope_id IN (SELECT user_id::text FROM app.users WHERE phone_normalized = $1)`,
    [normalizedPhone],
  );
  // M01-A2D: the Driver profile of the user (it references the user purged below).
  await pool.query(
    'DELETE FROM app.drivers WHERE user_id IN (SELECT user_id FROM app.users WHERE phone_normalized = $1)',
    [normalizedPhone],
  );
  // M02-A: the weekly schedule of those shops (it references the shop deleted below).
  await pool.query(
    `DELETE FROM app.shop_business_hours
      WHERE shop_id IN (SELECT shop_id FROM app.shop_members
                         WHERE user_id IN (SELECT user_id FROM app.users WHERE phone_normalized = $1))`,
    [normalizedPhone],
  );
  // Memberships first, then the shops no member points at any more (a shop of this user has exactly one member).
  await pool.query(
    `WITH owned AS (
       DELETE FROM app.shop_members
        WHERE user_id IN (SELECT user_id FROM app.users WHERE phone_normalized = $1)
        RETURNING shop_id
     )
     DELETE FROM app.shops WHERE shop_id IN (SELECT shop_id FROM owned)`,
    [normalizedPhone],
  );
  await pool.query(
    `DELETE FROM app.idempotency_records
      WHERE scope_type IN ('verification_proof', 'client_verification_proof')
        AND scope_id IN (SELECT proof_id::text FROM app.verification_proofs WHERE phone_normalized = $1)`,
    [normalizedPhone],
  );
  // DISABLED_TEST register: its idempotency scope is the hash of the normalized phone, not a proof.
  await pool.query(
    `DELETE FROM app.idempotency_records WHERE scope_type = 'client_unverified_test_phone' AND scope_id = $1`,
    [unverifiedTestScopeId(normalizedPhone)],
  );
  // M01-D-ADMIN-1B: the SYSTEM-scoped idempotency records of the invitation routes.
  await pool.query(
    `DELETE FROM app.idempotency_records
      WHERE scope_type = 'admin_user'
        AND scope_id IN (SELECT user_id::text FROM app.users WHERE phone_normalized = $1)`,
    [normalizedPhone],
  );
  // M01-D-ADMIN-1A/1B: invitations and step-up operations reference the SYSTEM membership/session (and, later, an
  // accepted user). Their tables refuse DELETE by trigger, so when any row still points at this user the three tables
  // are emptied with TRUNCATE (test database only; the integration suites run one at a time).
  const provisioning = await pool.query(
    `SELECT 1 FROM app.admin_sensitive_operations
      WHERE actor_user_id IN (SELECT user_id FROM app.users WHERE phone_normalized = $1)
     UNION ALL
     SELECT 1 FROM app.admin_invitations
      WHERE created_by IN (SELECT user_id FROM app.users WHERE phone_normalized = $1)
         OR accepted_user_id IN (SELECT user_id FROM app.users WHERE phone_normalized = $1)
     LIMIT 1`,
    [normalizedPhone],
  );
  if ((provisioning.rowCount ?? 0) > 0) {
    await pool.query(
      'TRUNCATE app.admin_app_permissions, app.admin_profiles, app.admin_activation_otp_challenges, app.admin_activation_attempts, app.admin_sensitive_operations, app.admin_invitation_permissions, app.admin_invitations',
    );
  }
  // M01-D-LOGIN: the administration state of the user (factor -> challenge, session, membership), before the user.
  for (const table of [
    'admin_app_permissions',
    'admin_profiles',
    'admin_totp_factors',
    'admin_auth_challenges',
    'admin_sessions',
    'admin_memberships',
  ]) {
    await pool.query(
      `DELETE FROM app.${table} WHERE user_id IN (SELECT user_id FROM app.users WHERE phone_normalized = $1)`,
      [normalizedPhone],
    );
  }
  // M01.02: a customer profile or a consent row that references the user must go before the user (both foreign keys are
  // RESTRICT). A consent refuses DELETE by trigger for every role, so when one exists for this phone the test-only table
  // is emptied with TRUNCATE (test database only; the integration suites run one at a time).
  const consents = await pool.query(
    'SELECT 1 FROM app.user_consents WHERE user_id IN (SELECT user_id FROM app.users WHERE phone_normalized = $1) LIMIT 1',
    [normalizedPhone],
  );
  if ((consents.rowCount ?? 0) > 0) {
    await pool.query('TRUNCATE app.user_consents');
  }
  await pool.query(
    'DELETE FROM app.customer_profiles WHERE user_id IN (SELECT user_id FROM app.users WHERE phone_normalized = $1)',
    [normalizedPhone],
  );
  // M01.04: the idempotency records of client login (scope = the user) and of the context switch (scope = the session).
  await pool.query(
    `DELETE FROM app.idempotency_records
      WHERE scope_type = 'client_login'
        AND scope_id IN (SELECT user_id::text FROM app.users WHERE phone_normalized = $1)`,
    [normalizedPhone],
  );
  await pool.query(
    `DELETE FROM app.idempotency_records
      WHERE scope_type = 'client_session'
        AND scope_id IN (SELECT session_id::text FROM app.sessions
                          WHERE user_id IN (SELECT user_id FROM app.users WHERE phone_normalized = $1))`,
    [normalizedPhone],
  );
  // M01.05: the idempotency records of the own-profile update (scope = the user).
  await pool.query(
    `DELETE FROM app.idempotency_records
      WHERE scope_type = 'customer_profile'
        AND scope_id IN (SELECT user_id::text FROM app.users WHERE phone_normalized = $1)`,
    [normalizedPhone],
  );
  await pool.query(
    'DELETE FROM app.sessions WHERE user_id IN (SELECT user_id FROM app.users WHERE phone_normalized = $1)',
    [normalizedPhone],
  );
  await pool.query(
    'DELETE FROM app.user_roles WHERE user_id IN (SELECT user_id FROM app.users WHERE phone_normalized = $1)',
    [normalizedPhone],
  );
  await pool.query('DELETE FROM app.users WHERE phone_normalized = $1', [normalizedPhone]);
  await pool.query('DELETE FROM app.verification_proofs WHERE phone_normalized = $1', [normalizedPhone]);
  await pool.query('DELETE FROM app.phone_verifications WHERE phone_normalized = $1', [normalizedPhone]);
}

export interface Phone {
  readonly local: string;
  readonly normalized: string;
  readonly international: string;
}

/** Request OTP + read it from the fake provider + verify: returns the one-time proof token. */
export async function obtainProof(
  app: AuthApp,
  phone: Phone = randomPhone(),
): Promise<{ phone: Phone; verificationId: string; proofToken: string }> {
  app.track(phone.normalized);
  const requested = await app.call('POST', '/auth/phone-verifications', {
    body: { phone: phone.local, purpose: 'REGISTER' },
  });
  if (requested.status !== 201) {
    throw new Error(`OTP request failed: ${requested.status} ${requested.text}`);
  }
  const verificationId = String(dataOf(requested).verification_id);
  const otp = app.provider.lastOtpFor(phone.normalized);
  if (otp === undefined) {
    throw new Error('the fake provider did not receive an OTP');
  }
  const verified = await app.call('POST', `/auth/phone-verifications/${verificationId}/verify`, { body: { otp } });
  if (verified.status !== 200) {
    throw new Error(`OTP verify failed: ${verified.status} ${verified.text}`);
  }
  return { phone, verificationId, proofToken: String(dataOf(verified).verification_token) };
}

export function registerBody(
  phone: Phone,
  proofToken: string,
  overrides: { password?: string; device?: Record<string, unknown>; extra?: Record<string, unknown> } = {},
): Record<string, unknown> {
  return {
    phone: phone.local,
    password: overrides.password ?? PASSWORD,
    verification_token: proofToken,
    device: overrides.device ?? { ...DEVICE },
    ...(overrides.extra ?? {}),
  };
}

export interface Registered {
  readonly phone: Phone;
  readonly password: string;
  readonly proofToken: string;
  readonly key: string;
  readonly response: ApiResponse;
  readonly userId: string;
  readonly accessToken: string;
}

/** The whole happy path: OTP, proof, register. Throws unless register answered 201. */
export async function registerUser(
  app: AuthApp,
  options: { phone?: Phone; password?: string; key?: string; device?: Record<string, unknown> } = {},
): Promise<Registered> {
  const proof = await obtainProof(app, options.phone ?? randomPhone());
  const key = options.key ?? randomUUID();
  const password = options.password ?? PASSWORD;
  const response = await app.call('POST', '/auth/register', {
    headers: { 'idempotency-key': key },
    body: registerBody(proof.phone, proof.proofToken, {
      password,
      ...(options.device === undefined ? {} : { device: options.device }),
    }),
  });
  if (response.status !== 201) {
    throw new Error(`register failed: ${response.status} ${response.text}`);
  }
  const data = dataOf(response);
  return {
    phone: proof.phone,
    password,
    proofToken: proof.proofToken,
    key,
    response,
    userId: String(data.user_id),
    accessToken: String(data.access_token),
  };
}

export async function loginUser(
  app: AuthApp,
  user: { phone: Phone; password: string },
  device: Record<string, unknown> = { ...DEVICE },
): Promise<ApiResponse> {
  return app.call('POST', '/auth/login', { body: { phone: user.phone.local, password: user.password, device } });
}

/** A service area fixture with a unique code. Removed by purgeTestServiceAreas when the app closes. */
export async function createServiceArea(
  pool: Pool,
  status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE',
): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO app.service_areas (service_area_id, code, name, status, version, created_at, updated_at)
     VALUES ($1::uuid, $2, 'Test area', $3, 1, clock_timestamp(), clock_timestamp())`,
    [id, `ZT-${id}`, status],
  );
  return id;
}

/** Removes the test areas no shop references any more (areas still in use are left for their shops' purge). */
export async function purgeTestServiceAreas(pool: Pool): Promise<void> {
  await pool.query(
    `DELETE FROM app.service_areas a
      WHERE a.code LIKE 'ZT-%'
        AND NOT EXISTS (SELECT 1 FROM app.shops s WHERE s.service_area_id = a.service_area_id)`,
  );
}

/** An ACTIVE shop owned by the user, complete as onboarding would have left it (accepting_orders=false). */
export async function createActiveShopFor(pool: Pool, userId: string, serviceAreaId?: string): Promise<string> {
  const areaId = serviceAreaId ?? (await createServiceArea(pool));
  const shopId = randomUUID();
  await pool.query(
    `INSERT INTO app.shops (shop_id, name, contact_phone_normalized, address_text, pickup_lat, pickup_lng,
                            service_area_id, status, accepting_orders, version, created_at, updated_at)
     VALUES ($1::uuid, 'Fixture shop', '+84900000001', 'Fixture address', 21.0, 105.8, $2::uuid, 'ACTIVE', false, 2,
             clock_timestamp(), clock_timestamp())`,
    [shopId, areaId],
  );
  await pool.query(
    `INSERT INTO app.shop_members (shop_id, user_id, member_role, created_at)
     VALUES ($1::uuid, $2::uuid, 'OWNER', clock_timestamp())`,
    [shopId, userId],
  );
  return shopId;
}

/**
 * A Driver profile owned by the user, as onboarding would have left it (EXTERNAL, accepting_deliveries=false,
 * version 1) unless the status says otherwise. A Driver has no operating area (task section 22). It does NOT grant
 * the DRIVER role row.
 */
export async function createDriverFor(pool: Pool, userId: string, options: { status?: string } = {}): Promise<string> {
  const driverId = randomUUID();
  await pool.query(
    `INSERT INTO app.drivers (driver_id, user_id, full_name, plate_number, driver_type, status,
                              accepting_deliveries, version, created_at, updated_at)
     VALUES ($1::uuid, $2::uuid, 'Fixture driver', NULL, 'EXTERNAL', $3, false, 1, clock_timestamp(), clock_timestamp())`,
    [driverId, userId, options.status ?? 'PENDING'],
  );
  return driverId;
}

/**
 * Grants a role directly. Since M01-A2S a SHOP role is only selectable together with an ACTIVE owned shop, and
 * since M01-A2D a DRIVER role only together with a Driver profile that is not CLOSED, so granting 'SHOP' or
 * 'DRIVER' here also creates that profile: the A1 suites keep exercising "a user who is a shop / a driver".
 * Use grantStrayRole to get the bare role row without a profile.
 */
export async function grantRole(pool: Pool, userId: string, role: string): Promise<void> {
  await grantStrayRole(pool, userId, role);
  if (role === 'SHOP') {
    await createActiveShopFor(pool, userId);
  }
  if (role === 'DRIVER') {
    await createDriverFor(pool, userId);
  }
}

/** The bare user_roles row, whatever the role (for the stray SHOP role cases and for ADMIN-like rows). */
export async function grantStrayRole(pool: Pool, userId: string, role: string): Promise<void> {
  await pool.query(
    'INSERT INTO app.user_roles (user_id, role, created_at) VALUES ($1::uuid, $2, clock_timestamp())',
    [userId, role],
  );
}

export async function setUserStatus(pool: Pool, userId: string, status: 'ACTIVE' | 'DISABLED'): Promise<void> {
  await pool.query('UPDATE app.users SET status = $2, updated_at = clock_timestamp() WHERE user_id = $1::uuid', [
    userId,
    status,
  ]);
}

/** Moves the instants of a verification back together, keeping every table CHECK valid. */
export async function ageVerification(pool: Pool, verificationId: string, seconds: number): Promise<void> {
  const result = await pool.query(
    `UPDATE app.phone_verifications
        SET created_at = created_at - make_interval(secs => $2::double precision),
            expires_at = expires_at - make_interval(secs => $2::double precision),
            resend_not_before = resend_not_before - make_interval(secs => $2::double precision)
      WHERE verification_id = $1::uuid`,
    [verificationId, seconds],
  );
  if (result.rowCount !== 1) {
    throw new Error('verification to age was not found');
  }
}

export async function ageProof(pool: Pool, proofToken: string, seconds: number): Promise<void> {
  const digest = createHash('sha256').update(proofToken, 'utf8').digest('hex');
  const result = await pool.query(
    `UPDATE app.verification_proofs
        SET created_at = created_at - make_interval(secs => $2::double precision),
            expires_at = expires_at - make_interval(secs => $2::double precision)
      WHERE token_digest = $1`,
    [digest, seconds],
  );
  if (result.rowCount !== 1) {
    throw new Error('proof to age was not found');
  }
}

/** Makes a session's absolute expiry elapse by moving its instants back (CHECK-safe). */
export async function expireSession(pool: Pool, sessionId: string): Promise<void> {
  await pool.query(
    `UPDATE app.sessions
        SET created_at = created_at - interval '2 days',
            updated_at = updated_at - interval '2 days',
            expires_at = clock_timestamp() - interval '1 second'
      WHERE session_id = $1::uuid`,
    [sessionId],
  );
}

export async function sessionIdOfToken(pool: Pool, accessToken: string): Promise<string> {
  const digest = createHash('sha256').update(accessToken, 'utf8').digest('hex');
  const result = await pool.query<{ session_id: string }>(
    'SELECT session_id FROM app.sessions WHERE token_digest = $1',
    [digest],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error('session not found for token');
  }
  return row.session_id;
}

export async function countRows(pool: Pool, sql: string, values: unknown[] = []): Promise<number> {
  const result = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM (${sql}) q`, values);
  return result.rows[0]?.n ?? -1;
}

export async function proofIdOfToken(pool: Pool, proofToken: string): Promise<string> {
  const digest = createHash('sha256').update(proofToken, 'utf8').digest('hex');
  const result = await pool.query<{ proof_id: string }>(
    'SELECT proof_id FROM app.verification_proofs WHERE token_digest = $1',
    [digest],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error('proof not found for token');
  }
  return row.proof_id;
}

export interface RegisterRecord {
  record_id: string;
  response_status: number;
  replay_guard: Record<string, unknown>;
  replay_ciphertext: Buffer | null;
}

export async function registerRecordsOf(pool: Pool, proofId: string): Promise<RegisterRecord[]> {
  const result = await pool.query<RegisterRecord>(
    `SELECT record_id, response_status, replay_guard, replay_ciphertext
       FROM app.idempotency_records
      WHERE scope_type = 'verification_proof' AND scope_id = $1 AND operation_id = 'auth.register.v1'`,
    [proofId],
  );
  return result.rows;
}

/**
 * Moves a register idempotency record back in time (all three instants together, CHECK-safe) until its
 * replay window, or its whole dedupe window, has just elapsed. No sleeping.
 */
export async function ageRegisterRecord(pool: Pool, proofId: string, window: 'replay' | 'dedupe'): Promise<void> {
  const column = window === 'replay' ? 'replay_expires_at' : 'dedupe_expires_at';
  const result = await pool.query(
    `UPDATE app.idempotency_records r
        SET created_at = r.created_at - s.shift,
            replay_expires_at = r.replay_expires_at - s.shift,
            dedupe_expires_at = r.dedupe_expires_at - s.shift
       FROM (
         SELECT record_id, make_interval(secs => extract(epoch FROM (${column} - created_at)) + 10) AS shift
           FROM app.idempotency_records
          WHERE scope_type = 'verification_proof' AND scope_id = $1 AND operation_id = 'auth.register.v1'
       ) s
      WHERE r.record_id = s.record_id`,
    [proofId],
  );
  if (result.rowCount !== 1) {
    throw new Error('register record to age was not found');
  }
}

/** Installs a stall: a row trigger on app.audit_logs that waits for an advisory lock a test holds. */
export async function installRegisterAuditStall(
  pool: Pool,
  key: readonly [number, number],
  action = 'auth.register.v1',
): Promise<void> {
  await pool.query(
    `CREATE FUNCTION app.test_stall_register_audit() RETURNS trigger LANGUAGE plpgsql AS $$
     BEGIN
       IF NEW.action = '${action}' THEN
         PERFORM pg_advisory_xact_lock(${key[0]}, ${key[1]});
       END IF;
       RETURN NEW;
     END $$`,
  );
  await pool.query(
    `CREATE TRIGGER test_stall_register_audit BEFORE INSERT ON app.audit_logs
       FOR EACH ROW EXECUTE FUNCTION app.test_stall_register_audit()`,
  );
}

export async function removeRegisterAuditStall(pool: Pool): Promise<void> {
  await pool.query('DROP TRIGGER IF EXISTS test_stall_register_audit ON app.audit_logs');
  await pool.query('DROP FUNCTION IF EXISTS app.test_stall_register_audit()');
}

/**
 * Installs a stall for role selection: a row trigger on app.sessions that waits for an advisory lock a test
 * holds, but ONLY for the statement that moves a session INTO the SHOP context (active_role changes to SHOP
 * on an unrevoked row). The revoke of an earlier SHOP session keeps active_role = 'SHOP' and is not stalled.
 * By the time a selection reaches this trigger it already holds the user row and its own session row.
 */
export async function installRoleSelectShopStall(pool: Pool, key: readonly [number, number]): Promise<void> {
  await pool.query(
    `CREATE FUNCTION app.test_stall_role_select_shop() RETURNS trigger LANGUAGE plpgsql AS $$
     BEGIN
       IF NEW.active_role = 'SHOP' AND OLD.active_role IS DISTINCT FROM 'SHOP' AND NEW.revoked_at IS NULL THEN
         PERFORM pg_advisory_xact_lock(${key[0]}, ${key[1]});
       END IF;
       RETURN NEW;
     END $$`,
  );
  await pool.query(
    `CREATE TRIGGER test_stall_role_select_shop BEFORE UPDATE ON app.sessions
       FOR EACH ROW EXECUTE FUNCTION app.test_stall_role_select_shop()`,
  );
}

export async function removeRoleSelectShopStall(pool: Pool): Promise<void> {
  await pool.query('DROP TRIGGER IF EXISTS test_stall_role_select_shop ON app.sessions');
  await pool.query('DROP FUNCTION IF EXISTS app.test_stall_role_select_shop()');
}

/**
 * Backends currently blocked behind another transaction's row lock: either waiting for its transaction id, or
 * queued on the row's tuple lock (PostgreSQL shows a waiter in one of the two forms).
 */
export async function rowLockWaiters(pool: Pool): Promise<number> {
  const result = await pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM pg_locks WHERE locktype IN ('transactionid', 'tuple') AND NOT granted",
  );
  return result.rows[0]?.n ?? 0;
}

/**
 * Backends blocked behind another transaction's row lock WHILE running a statement whose text matches the
 * given LIKE pattern. It names the waiter: "the /auth/me FOR SHARE on the user row is the statement that
 * waits", not merely "something waits". The pattern travels as a parameter, so this query never matches itself.
 */
export async function rowLockWaitersRunning(pool: Pool, queryLike: string): Promise<number> {
  const result = await pool.query<{ n: number }>(
    `SELECT count(DISTINCT l.pid)::int AS n
       FROM pg_locks l
       JOIN pg_stat_activity a ON a.pid = l.pid
      WHERE l.locktype IN ('transactionid', 'tuple') AND NOT l.granted
        AND a.wait_event_type = 'Lock'
        AND a.query LIKE $1`,
    [queryLike],
  );
  return result.rows[0]?.n ?? 0;
}

/** True while some backend waits for the given (int, int) advisory lock. */
export async function advisoryWaiterExists(pool: Pool, key: readonly [number, number]): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM pg_locks
      WHERE locktype = 'advisory' AND NOT granted AND classid = $1::oid AND objid = $2::oid AND objsubid = 2`,
    [key[0], key[1]],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Number of backends currently waiting for a transaction id (a row lock or a unique-index conflict). */
export async function transactionWaiters(pool: Pool): Promise<number> {
  const result = await pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'transactionid' AND NOT granted",
  );
  return result.rows[0]?.n ?? 0;
}

/** Fault injection: a trigger that raises a non-AppError server error for matching rows. */
export async function installFault(
  pool: Pool,
  name: string,
  table: string,
  events: 'INSERT' | 'UPDATE',
  condition: string,
): Promise<void> {
  if (!/^[a-z_]+$/.test(name) || !/^app\.[a-z_]+$/.test(table)) {
    throw new Error('unsafe fault identifiers');
  }
  await pool.query(
    `CREATE FUNCTION app.${name}() RETURNS trigger LANGUAGE plpgsql AS $$
     BEGIN
       IF ${condition} THEN
         RAISE EXCEPTION 'injected fault' USING ERRCODE = 'XX001';
       END IF;
       RETURN NEW;
     END $$`,
  );
  await pool.query(
    `CREATE TRIGGER ${name} BEFORE ${events} ON ${table} FOR EACH ROW EXECUTE FUNCTION app.${name}()`,
  );
}

export async function removeFault(pool: Pool, name: string, table: string): Promise<void> {
  await pool.query(`DROP TRIGGER IF EXISTS ${name} ON ${table}`);
  await pool.query(`DROP FUNCTION IF EXISTS app.${name}()`);
}

/**
 * M01-A2S barrier: a row trigger on app.shops that waits for an advisory lock a test holds, but ONLY for the
 * statement that turns a shop ACTIVE. By then the completing request already holds the user row, the owner
 * membership, the shop row and the service-area row FOR SHARE, so "a backend waits on the advisory lock"
 * proves it is inside its transaction with all of them held.
 */
export async function installShopActivateStall(pool: Pool, key: readonly [number, number]): Promise<void> {
  await pool.query(
    `CREATE FUNCTION app.test_stall_shop_activate() RETURNS trigger LANGUAGE plpgsql AS $$
     BEGIN
       IF NEW.status = 'ACTIVE' AND OLD.status IS DISTINCT FROM 'ACTIVE' THEN
         PERFORM pg_advisory_xact_lock(${key[0]}, ${key[1]});
       END IF;
       RETURN NEW;
     END $$`,
  );
  await pool.query(
    `CREATE TRIGGER test_stall_shop_activate BEFORE UPDATE ON app.shops
       FOR EACH ROW EXECUTE FUNCTION app.test_stall_shop_activate()`,
  );
}

export async function removeShopActivateStall(pool: Pool): Promise<void> {
  await pool.query('DROP TRIGGER IF EXISTS test_stall_shop_activate ON app.shops');
  await pool.query('DROP FUNCTION IF EXISTS app.test_stall_shop_activate()');
}

/** The default valid profile body. Callers override fields; the contact phone is a fresh number. */
export function shopProfileBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Quán Bún Chả',
    contact_phone: randomPhone().local,
    address_text: '12 Hàng Mã, Hoàn Kiếm',
    zalo: 'zalo.example',
    facebook: 'fb.example/shop',
    ...overrides,
  };
}

/**
 * M01-A2D barrier: a row trigger on app.drivers that waits for an advisory lock a test holds, on the Driver
 * INSERT of ONE user (other suites' fixtures are not stalled). By then the creating request already holds the idempotency record and the user row FOR UPDATE, so "a backend waits on the advisory lock" proves it is inside its transaction with all of them.
 */
export async function installDriverInsertStall(pool: Pool, key: readonly [number, number], userId: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/.test(userId)) {
    throw new Error('unsafe user id');
  }
  await pool.query(
    `CREATE FUNCTION app.test_stall_driver_insert() RETURNS trigger LANGUAGE plpgsql AS $$
     BEGIN
       IF NEW.user_id = '${userId}'::uuid THEN
         PERFORM pg_advisory_xact_lock(${key[0]}, ${key[1]});
       END IF;
       RETURN NEW;
     END $$`,
  );
  await pool.query(
    `CREATE TRIGGER test_stall_driver_insert BEFORE INSERT ON app.drivers
       FOR EACH ROW EXECUTE FUNCTION app.test_stall_driver_insert()`,
  );
}

export async function removeDriverInsertStall(pool: Pool): Promise<void> {
  await pool.query('DROP TRIGGER IF EXISTS test_stall_driver_insert ON app.drivers');
  await pool.query('DROP FUNCTION IF EXISTS app.test_stall_driver_insert()');
}

/** The default valid Driver onboarding body. Callers override fields. */
export function driverBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    full_name: 'Nguyễn Văn Tài',
    plate_number: '29A-123.45',
    ...overrides,
  };
}
