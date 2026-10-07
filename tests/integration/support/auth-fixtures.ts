import { createHash, randomInt, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { FakeOtpProvider } from '../../../apps/backend/src/auth/fake-otp-provider';
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
  method: 'GET' | 'POST',
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
  return { status: response.status, requestId: response.headers.get('x-request-id') ?? '', text, body };
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
  call(method: 'GET' | 'POST', path: string, options?: ApiOptions): Promise<ApiResponse>;
  /** Registers a normalized phone for cleanup when the app closes. */
  track(normalizedPhone: string): void;
  close(): Promise<void>;
}

export async function startAuthApp(
  authOverrides: Partial<AuthConfig> = {},
  extra: { activeKeyId?: string; relaxTimeouts?: boolean } = {},
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
  };
  const provider = new FakeOtpProvider();
  const running = await startApp(config, { auth: { otpProvider: provider } });
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
      } finally {
        await pool.end();
        await running.app.close();
      }
    },
  };
}

/** Removes every Auth row of one phone number (and the register idempotency records of its proofs). */
export async function purgePhone(pool: Pool, normalizedPhone: string): Promise<void> {
  await pool.query(
    `DELETE FROM app.idempotency_records
      WHERE scope_type = 'verification_proof'
        AND scope_id IN (SELECT proof_id::text FROM app.verification_proofs WHERE phone_normalized = $1)`,
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

export async function grantRole(pool: Pool, userId: string, role: string): Promise<void> {
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
export async function installRegisterAuditStall(pool: Pool, key: readonly [number, number]): Promise<void> {
  await pool.query(
    `CREATE FUNCTION app.test_stall_register_audit() RETURNS trigger LANGUAGE plpgsql AS $$
     BEGIN
       IF NEW.action = 'auth.register.v1' THEN
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
