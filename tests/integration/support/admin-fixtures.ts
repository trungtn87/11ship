import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { Readable } from 'node:stream';
import { Pool } from 'pg';
import { runAdminAuthCli } from '../../../apps/backend/src/admin-auth/cli/admin-auth-cli';
import { ADMIN_PREAUTH_COOKIE, ADMIN_SESSION_COOKIE } from '../../../apps/backend/src/admin-auth/admin-auth-constants';
import { base32Decode } from '../../../apps/backend/src/admin-auth/base32';
import { hotp, stepAt } from '../../../apps/backend/src/admin-auth/totp';
import { Argon2idPasswordHasher } from '../../../apps/backend/src/auth/password-hasher';
import { FakeOtpProvider } from '../../../apps/backend/src/auth/fake-otp-provider';
import { ActivationOtpProvider } from '../../../apps/backend/src/admin-activation/activation-otp-provider';
import { AdminActivationConfig, DEFAULT_ACTIVATION_LIMITS } from '../../../apps/backend/src/config/admin-activation-config';
import { AdminAuthConfig, loadLimiterConfig } from '../../../apps/backend/src/config/admin-auth-config';
import { AppConfig } from '../../../apps/backend/src/config/app-config';
import { Keyring } from '../../../apps/backend/src/crypto/keyring';
import { fixtureKeyring } from '../../../apps/backend/src/crypto/test-keys.fixture';
import { authTestConfig, purgePhone, randomPhone } from './auth-fixtures';
import { loadIntegrationConfig, RunningApp, startApp } from './test-helpers';
import { testPool } from './transaction-fixtures';

// Shared fixtures of the M01-D-LOGIN administration suites. They talk to the REAL PostgreSQL test database through the
// REAL Nest pipeline. SYSTEM accounts are created the only supported way - the operator bootstrap command, run in
// process against the guarded test database. ADMIN-role members have no public path at all, so a fixture inserts the
// membership directly (test database only). Rate-limit state is test-owned and is cleared between cases.

export const ADMIN_ORIGIN = 'https://admin.example.test';
export const ADMIN_PASSWORD = 'Correct-Horse-Battery-9';
export const ADMIN_DEVICE = Object.freeze({ device_id: 'admin-web-0001', platform: 'WEB', app: 'ADMIN_WEB' });
export const LIMITER_KEY_BASE64 = Buffer.alloc(32, 11).toString('base64');
export const LIMITER_KEY_ID = 'limiter-test-1';
const BASE = '/v1/admin-auth';

export function adminTestEnv(extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    APP_ENV: 'test',
    DATABASE_URL: process.env.DATABASE_URL,
    ADMIN_RATE_LIMIT_HMAC_KEY: LIMITER_KEY_BASE64,
    ADMIN_RATE_LIMIT_KEY_ID: LIMITER_KEY_ID,
    ...extra,
  };
}

export interface CliResult {
  readonly code: number;
  readonly out: string[];
  readonly err: string[];
}

export async function runCli(
  command: string,
  env: Record<string, string | undefined>,
  stdin: string | undefined = undefined,
): Promise<CliResult> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runAdminAuthCli(command, {
    env,
    stdin: Readable.from(stdin === undefined ? [] : [stdin]),
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  });
  return { code, out, err };
}

export function initLimitConfig(): Promise<CliResult> {
  return runCli('init-limit-config', adminTestEnv());
}

export function bootstrapSystem(phoneLocal: string, password: string = ADMIN_PASSWORD): Promise<CliResult> {
  return runCli('bootstrap-system', adminTestEnv(), JSON.stringify({ phone: phoneLocal, password }));
}

export interface AdminResponse {
  readonly status: number;
  readonly requestId: string;
  readonly text: string;
  readonly headers: http.IncomingHttpHeaders;
  readonly setCookie: string[];
  readonly body: {
    data?: Record<string, unknown>;
    error?: { code: string; message: string; request_id: string; details: unknown };
  };
}

export interface AdminCallOptions {
  readonly body?: unknown;
  readonly rawBody?: string;
  /** Extra request headers; a header set to undefined is not sent. */
  readonly headers?: Record<string, string | undefined>;
  readonly cookies?: Readonly<Record<string, string>>;
  /** Default: the allowed origin for POST, none for GET. null = send no Origin at all. */
  readonly origin?: string | null;
  /** Default '/v1/admin-auth'. M01-D-ADMIN-1B routes live under '/v1/admin'. */
  readonly basePath?: string;
  readonly csrf?: string;
  readonly contentType?: string | null;
}

export function adminCall(
  baseUrl: string,
  method: 'GET' | 'POST',
  path: string,
  options: AdminCallOptions = {},
): Promise<AdminResponse> {
  const url = new URL(`${baseUrl}${options.basePath ?? BASE}${path}`);
  const headers: Record<string, string> = {};
  let payload: string | undefined;
  if (options.rawBody !== undefined) {
    payload = options.rawBody;
  } else if (options.body !== undefined) {
    payload = JSON.stringify(options.body);
  }
  if (payload !== undefined && options.contentType !== null) {
    headers['content-type'] = options.contentType ?? 'application/json';
  }
  const origin = options.origin === undefined ? (method === 'POST' ? ADMIN_ORIGIN : null) : options.origin;
  if (origin !== null) {
    headers['origin'] = origin;
  }
  if (options.csrf !== undefined) {
    headers['x-csrf-token'] = options.csrf;
  }
  if (options.cookies !== undefined && Object.keys(options.cookies).length > 0) {
    headers['cookie'] = Object.entries(options.cookies)
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    if (value !== undefined) {
      headers[name.toLowerCase()] = value;
    }
  }
  if (payload !== undefined) {
    headers['content-length'] = String(Buffer.byteLength(payload));
  }
  return new Promise((resolve, reject) => {
    const request = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname + url.search, method, headers },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let body: AdminResponse['body'] = {};
          try {
            body = JSON.parse(text) as AdminResponse['body'];
          } catch {
            // empty or not JSON
          }
          const raw = response.headers['set-cookie'];
          resolve({
            status: response.statusCode ?? 0,
            requestId: String(response.headers['x-request-id'] ?? ''),
            text,
            headers: response.headers,
            setCookie: raw === undefined ? [] : raw,
            body,
          });
        });
      },
    );
    request.on('error', reject);
    if (payload !== undefined) {
      request.write(payload);
    }
    request.end();
  });
}

export function adminErrorCode(response: AdminResponse): string | undefined {
  return response.body.error?.code;
}

export function adminData(response: AdminResponse): Record<string, unknown> {
  if (response.body.data === undefined) {
    throw new Error(`expected a data envelope, got status ${response.status}: ${response.text}`);
  }
  return response.body.data;
}

/** The value of one cookie from a response's Set-Cookie list ('' when it was cleared), or undefined when not set. */
export function cookieFrom(response: AdminResponse, name: string): string | undefined {
  for (const line of response.setCookie) {
    if (line.startsWith(`${name}=`)) {
      return line.slice(name.length + 1).split(';')[0];
    }
  }
  return undefined;
}

export interface AdminApp {
  readonly running: RunningApp;
  readonly config: AppConfig;
  readonly pool: Pool;
  call(method: 'GET' | 'POST', path: string, options?: AdminCallOptions): Promise<AdminResponse>;
  /** Registers a normalized phone whose Auth and administration rows are removed on close. */
  track(normalizedPhone: string): void;
  clearLimits(): Promise<void>;
  close(): Promise<void>;
}

export interface StartAdminOptions {
  readonly trustedProxyIps?: readonly string[];
  readonly activeKeyId?: string;
  /** A complete keyring instead of the two fixture keys (for example one that no longer holds a historical key). */
  readonly keyring?: Keyring;
  /** Do not clear the rate-limit state at start (a restart keeps its locks). */
  readonly keepLimits?: boolean;
  /** M01-D-ADMIN-1B: lock_timeout of business row locks (executor and 1B transactions). Default 10 s for barrier tests. */
  readonly businessLockTimeoutMs?: number;
  /** M01-D-ADMIN-1B: lifetime of a new invitation. Default 72 hours. */
  readonly invitationTtlSeconds?: number;
  /** M01-D-ADMIN-1C: enables the activation routes with this (fake) provider. Omitted: the routes are not wired. */
  readonly activationProvider?: ActivationOtpProvider;
  /**
   * Local test contract (2026-10-13): wires the activation with ADMIN_ACTIVATION_PHONE_VERIFICATION_MODE=DISABLED_TEST. There is
   * no OTP step and therefore NO provider; combining it with `activationProvider` is a mistake the application refuses.
   */
  readonly activationDisabledTest?: boolean;
  readonly activationConfig?: Partial<AdminActivationConfig>;
  /** Exact HTTPS origins accepted on POST (default: ADMIN_ORIGIN). The browser test passes its local HTTPS front. */
  readonly allowedOrigins?: readonly string[];
  /** Origin the invitation link is built on (default: ADMIN_ORIGIN). The browser test passes its local HTTPS front. */
  readonly activationOrigin?: string;
  /** Issue #49: runs after configureApp and before init, where main.ts installs the Admin web hosting. */
  readonly beforeListen?: (app: INestApplication) => void;
}

export async function startAdminApp(options: StartAdminOptions = {}): Promise<AdminApp> {
  // The operator command runs BEFORE the application starts, exactly as in a real deployment.
  const init = await initLimitConfig();
  if (init.code !== 0) {
    throw new Error(`init-limit-config failed: ${init.err.join(' | ')}`);
  }
  const limiter = loadLimiterConfig(adminTestEnv());
  if (!limiter.ok) {
    throw new Error('test limiter configuration is invalid');
  }
  const loaded = loadIntegrationConfig();
  const adminAuth: AdminAuthConfig = {
    allowedOrigins: options.allowedOrigins ?? [ADMIN_ORIGIN],
    trustedProxyIps: options.trustedProxyIps ?? [],
    limiter: limiter.limiter,
    invitationTtlSeconds: options.invitationTtlSeconds ?? 72 * 3600,
    activationOrigin: options.activationOrigin ?? ADMIN_ORIGIN,
  };
  const config: AppConfig = {
    ...loaded,
    // Roomier than the production defaults: Argon2 and several lock waits happen in one test.
    database: { ...loaded.database, queryTimeoutMs: 20_000, statementTimeoutMs: 15_000 },
    transaction: { timeoutMs: 25_000, idleInTransactionTimeoutMs: 10_000 },
    idempotency: { ...loaded.idempotency, businessLockTimeoutMs: options.businessLockTimeoutMs ?? 10_000 },
    crypto: options.keyring ?? fixtureKeyring(options.activeKeyId ?? 'k1'),
    auth: authTestConfig(),
    adminAuth,
    ...(options.activationProvider === undefined && options.activationDisabledTest !== true
      ? {}
      : {
          adminActivation: {
            phoneVerificationMode: options.activationDisabledTest === true ? ('DISABLED_TEST' as const) : ('REQUIRED' as const),
            otpMode: options.activationDisabledTest === true ? undefined : ('FAKE' as const),
            providerTimeoutMs: 8000,
            promoteGraceMs: 10_000,
            limits: DEFAULT_ACTIVATION_LIMITS,
            ...options.activationConfig,
          },
        }),
  };
  const running = await startApp(config, {
    auth: { otpProvider: new FakeOtpProvider() },
    ...(options.activationProvider === undefined ? {} : { activationOtpProvider: options.activationProvider }),
    ...(options.beforeListen === undefined ? {} : { beforeListen: options.beforeListen }),
  });
  const pool = testPool(loaded.database, { poolMax: 6 });
  const tracked = new Set<string>();
  const clearLimits = async (): Promise<void> => {
    await pool.query('DELETE FROM app.admin_auth_limits');
  };
  if (options.keepLimits !== true) {
    await clearLimits();
  }

  return {
    running,
    config,
    pool,
    call: (method, path, callOptions) => adminCall(running.baseUrl, method, path, callOptions),
    track: (phone) => {
      tracked.add(phone);
    },
    clearLimits,
    async close(): Promise<void> {
      try {
        for (const phone of tracked) {
          await purgePhone(pool, phone);
        }
        await clearLimits();
      } finally {
        await pool.end();
        await running.app.close();
      }
    },
  };
}

export interface SystemAccount {
  readonly phone: ReturnType<typeof randomPhone>;
  readonly password: string;
  readonly userId: string;
}

/** Removes any SYSTEM account first (there can be only one), then bootstraps a fresh one through the operator command. */
export async function createSystem(app: AdminApp, password: string = ADMIN_PASSWORD): Promise<SystemAccount> {
  await purgeSystem(app.pool);
  const phone = randomPhone();
  app.track(phone.normalized);
  const result = await bootstrapSystem(phone.local, password);
  if (result.code !== 0) {
    throw new Error(`bootstrap-system failed: ${result.err.join(' | ')}`);
  }
  const row = await app.pool.query<{ user_id: string }>('SELECT user_id FROM app.users WHERE phone_normalized = $1', [
    phone.normalized,
  ]);
  return { phone, password, userId: (row.rows[0] as { user_id: string }).user_id };
}

export async function purgeSystem(pool: Pool): Promise<void> {
  const rows = await pool.query<{ phone_normalized: string }>(
    `SELECT u.phone_normalized FROM app.admin_memberships m JOIN app.users u ON u.user_id = m.user_id
      WHERE m.admin_role = 'SYSTEM'`,
  );
  for (const row of rows.rows) {
    await purgePhone(pool, row.phone_normalized);
  }
}

/** A non-SYSTEM member. There is no public path that creates one, so the fixture writes the membership directly. */
export async function createAdminMember(app: AdminApp, password: string = ADMIN_PASSWORD): Promise<SystemAccount> {
  const phone = randomPhone();
  app.track(phone.normalized);
  const hash = await new Argon2idPasswordHasher().hash(password);
  const userId = randomUUID();
  await app.pool.query(
    `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
     VALUES ($1::uuid, $2, $3, NULL, 'ADMIN_PROVISIONED', 'ACTIVE', 1, now(), now())`,
    [userId, phone.normalized, hash],
  );
  await app.pool.query(
    `INSERT INTO app.admin_memberships (user_id, admin_role, status, version, created_at, updated_at)
     VALUES ($1::uuid, 'ADMIN', 'ACTIVE', 1, now(), now())`,
    [userId],
  );
  return { phone, password, userId };
}

export function loginBody(account: SystemAccount, overrides: { password?: string; device?: Record<string, unknown> } = {}): Record<string, unknown> {
  return { phone: account.phone.local, password: overrides.password ?? account.password, device: overrides.device ?? { ...ADMIN_DEVICE } };
}

export interface Preauth {
  readonly cookie: string;
  readonly csrf: string;
  readonly nextStep: string;
  readonly response: AdminResponse;
}

export async function loginStep(app: AdminApp, account: SystemAccount, ip?: string): Promise<Preauth> {
  const response = await app.call('POST', '/login', {
    body: loginBody(account),
    ...(ip === undefined ? {} : { headers: { 'x-forwarded-for': ip } }),
  });
  if (response.status !== 200) {
    throw new Error(`login failed: ${response.status} ${response.text}`);
  }
  const cookie = cookieFrom(response, ADMIN_PREAUTH_COOKIE);
  if (cookie === undefined || cookie === '') {
    throw new Error('login did not set the preauth cookie');
  }
  const data = adminData(response);
  return { cookie, csrf: String(data.csrf_token), nextStep: String(data.next_step), response };
}

export function preauthCookies(preauth: Preauth): Record<string, string> {
  return { [ADMIN_PREAUTH_COOKIE]: preauth.cookie };
}

/** The TOTP code for a Base32 secret at the current (or an offset) 30-second step. */
export function totpNow(secretBase32: string, stepOffset = 0): string {
  const secret = base32Decode(secretBase32);
  if (secret === undefined) {
    throw new Error('not a Base32 secret');
  }
  return hotp(secret, stepAt(Math.floor(Date.now() / 1000)) + stepOffset);
}

/** A six-digit code that is NOT valid for the previous, the current or the next step of the secret. */
export function wrongCode(secretBase32: string): string {
  const valid = new Set([totpNow(secretBase32, -1), totpNow(secretBase32, 0), totpNow(secretBase32, 1)]);
  const free = ['000000', '111111', '222222', '333333'].find((candidate) => !valid.has(candidate));
  if (free === undefined) {
    throw new Error('no free wrong code');
  }
  return free;
}

/**
 * Test database only: moves the factor's last accepted step back, so the CURRENT step's code counts as a first use
 * again. It stands in for "a later 30-second step", which a test cannot wait for on every case.
 */
export async function rewindAcceptedStep(app: AdminApp, userId: string, steps = 10): Promise<void> {
  await app.pool.query(
    'UPDATE app.admin_totp_factors SET last_accepted_step = last_accepted_step - $2::int WHERE user_id = $1::uuid',
    [userId, steps],
  );
}

export interface SessionLogin {
  readonly cookie: string;
  readonly csrf: string;
  readonly secret: string;
  readonly response: AdminResponse;
}

/** Full first login: password, enrollment, first code. Returns the session cookie and the TOTP secret for later logins. */
export async function enrollAndLogin(app: AdminApp, account: SystemAccount, ip?: string): Promise<SessionLogin> {
  const headers = ip === undefined ? {} : { headers: { 'x-forwarded-for': ip } };
  const preauth = await loginStep(app, account, ip);
  const started = await app.call('POST', '/totp/enrollment', { body: {}, cookies: preauthCookies(preauth), csrf: preauth.csrf, ...headers });
  if (started.status !== 200) {
    throw new Error(`enrollment failed: ${started.status} ${started.text}`);
  }
  const secret = String(adminData(started).secret);
  const verified = await app.call('POST', '/totp/enrollment/verify', {
    body: { code: totpNow(secret) },
    cookies: preauthCookies(preauth),
    csrf: preauth.csrf,
    ...headers,
  });
  if (verified.status !== 200) {
    throw new Error(`enrollment verify failed: ${verified.status} ${verified.text}`);
  }
  const cookie = cookieFrom(verified, ADMIN_SESSION_COOKIE);
  if (cookie === undefined || cookie === '') {
    throw new Error('verify did not set the session cookie');
  }
  return { cookie, csrf: String(adminData(verified).csrf_token), secret, response: verified };
}

export function sessionCookies(login: { cookie: string }): Record<string, string> {
  return { [ADMIN_SESSION_COOKIE]: login.cookie };
}

export async function count(pool: Pool, sql: string, values: unknown[] = []): Promise<number> {
  const result = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM (${sql}) q`, values);
  return Number((result.rows[0] as { n: string }).n);
}
