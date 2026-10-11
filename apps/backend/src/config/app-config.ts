import { AdminActivationConfig, loadAdminActivationConfig } from './admin-activation-config';
import { AdminAuthConfig, loadAdminAuthConfig } from './admin-auth-config';
import { AdminWebHostingConfig, parseAdminWebHosting } from './admin-web-hosting-config';
import { Keyring, parseKeyringConfig } from '../crypto/keyring';
import { DatabaseTls, resolveDatabaseTls } from '../database/tls-config';
import { parseStagingFixtures, StagingFixturesConfig } from './staging-fixtures-config';
import { loadTestInboxConfig, TestInboxConfig } from '../test-sms/test-sms-config';
import {
  AuthConfig,
  DEFAULT_AUTH_OTP_MAX_ATTEMPTS,
  DEFAULT_AUTH_OTP_RESEND_SECONDS,
  DEFAULT_AUTH_OTP_TTL_SECONDS,
  DEFAULT_AUTH_PROOF_TTL_SECONDS,
  DEFAULT_AUTH_SESSION_TTL_SECONDS,
  MAX_AUTH_OTP_MAX_ATTEMPTS,
  MAX_AUTH_OTP_RESEND_SECONDS,
  MAX_AUTH_OTP_TTL_SECONDS,
  MAX_AUTH_PROOF_TTL_SECONDS,
  MAX_AUTH_SESSION_TTL_SECONDS,
  MIN_AUTH_OTP_MAX_ATTEMPTS,
  MIN_AUTH_OTP_RESEND_SECONDS,
  MIN_AUTH_OTP_TTL_SECONDS,
  MIN_AUTH_PROOF_TTL_SECONDS,
  MIN_AUTH_SESSION_TTL_SECONDS,
  parseOtpHmacSecret,
} from './auth-config';
import {
  DEFAULT_ADVISORY_WAIT_MS,
  DEFAULT_BUSINESS_LOCK_TIMEOUT_MS,
  DEFAULT_DEDUPE_TTL_SECONDS,
  DEFAULT_REPLAY_TTL_SECONDS,
  IdempotencyConfig,
  MAX_ADVISORY_WAIT_MS,
  MAX_BUSINESS_LOCK_TIMEOUT_MS,
  MAX_TTL_SECONDS,
  MIN_ADVISORY_WAIT_MS,
  MIN_BUSINESS_LOCK_TIMEOUT_MS,
  MIN_TTL_SECONDS,
} from '../idempotency/idempotency-config';
import {
  DEFAULT_OUTBOX_BACKOFF_BASE_MS,
  DEFAULT_OUTBOX_BACKOFF_CAP_MS,
  DEFAULT_OUTBOX_BATCH_SIZE,
  DEFAULT_OUTBOX_LEASE_MS,
  DEFAULT_OUTBOX_MAX_ATTEMPTS,
  DEFAULT_OUTBOX_PUBLISH_CONCURRENCY,
  DEFAULT_OUTBOX_PUBLISH_TIMEOUT_MS,
  isValidBackoffRelation,
  isValidLeaseRelation,
  MAX_OUTBOX_BATCH_SIZE,
  MAX_OUTBOX_DURATION_MS,
  MAX_OUTBOX_MAX_ATTEMPTS,
  MAX_OUTBOX_PUBLISH_CONCURRENCY,
  MIN_OUTBOX_BATCH_SIZE,
  MIN_OUTBOX_DURATION_MS,
  MIN_OUTBOX_MAX_ATTEMPTS,
  MIN_OUTBOX_PUBLISH_CONCURRENCY,
  OutboxConfig,
} from './outbox-config';

export const APP_ENVIRONMENTS = ['development', 'test', 'staging', 'production'] as const;
export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];

// Runtime NODE_ENV follows the Node convention. "staging" is deliberately not allowed here;
// it only exists as an APP_ENV value.
export const NODE_ENVIRONMENTS = ['development', 'test', 'production'] as const;
export type NodeEnvironment = (typeof NODE_ENVIRONMENTS)[number];

export const APP_CONFIG = Symbol('APP_CONFIG');

export interface DatabaseConfig {
  url: string;
  poolMax: number;
  connectTimeoutMs: number;
  /** Client-side per-query timeout. Must be larger than the server statement timeout. */
  queryTimeoutMs: number;
  /** Server-side statement_timeout. Must be smaller than the client query timeout. */
  statementTimeoutMs: number;
  /**
   * Strict TLS (M00-D1). Always present in staging/production (startup is refused without it); present in
   * development/test only when DB_SSL_CA or DB_SSL_CA_FILE is set. When undefined the pool is built exactly as
   * before M00-D1 (no `ssl` option), which is what local PostgreSQL and CI rely on.
   */
  tls?: DatabaseTls;
}

export interface TransactionConfig {
  /** Total wall-clock budget of one transaction. Must be larger than the statement timeout. */
  timeoutMs: number;
  /** idle_in_transaction_session_timeout. */
  idleInTransactionTimeoutMs: number;
}

export interface AppConfig {
  appEnv: AppEnvironment;
  nodeEnv: NodeEnvironment | undefined;
  host: string;
  port: number;
  database: DatabaseConfig;
  transaction: TransactionConfig;
  /** Idempotency windows and lock budgets (M00-C1A1). Always present, with defaults. */
  idempotency: IdempotencyConfig;
  /** Outbox dispatcher bounds (M00-C1C). Always present, with defaults. Nothing starts a dispatcher by itself. */
  outbox: OutboxConfig;
  /**
   * Immutable crypto keyring. Optional at the config level; when either variable is set both must be
   * valid. It is REQUIRED wherever the idempotency executor is wired: IdempotencyModule refuses to
   * start without it (see requireKeyring in idempotency.module.ts), naming only the variables.
   */
  crypto: Keyring | undefined;
  /**
   * Auth Core settings (M01-A1). Optional at the config level, exactly like the keyring: it is present only when
   * AUTH_OTP_HMAC_SECRET is set and valid, and it is REQUIRED wherever the Auth module is wired (AuthModule
   * refuses to start without it, naming only the variable). The other AUTH_* variables are always validated.
   */
  auth: AuthConfig | undefined;
  /**
   * Administration web authentication (M01-D-LOGIN). Present only when ADMIN_AUTH_ENABLED=true and every required
   * variable is valid; absent otherwise (the module is then not wired and exposes nothing).
   */
  adminAuth?: AdminAuthConfig;
  /**
   * Administration account activation (M01-D-ADMIN-1C). Present only when ADMIN_ACTIVATION_ENABLED=true (which also
   * requires ADMIN_AUTH_ENABLED=true) and every variable is valid; absent otherwise (nothing is wired or exposed).
   */
  adminActivation?: AdminActivationConfig;
  /**
   * Staging fixture mode (M00-D2). Present ONLY when AUTH_STAGING_FIXTURES_ENABLED=true, which is valid only for
   * APP_ENV=staging and then requires a valid AUTH_STAGING_ALLOWED_PHONES. Absent everywhere else.
   */
  stagingFixtures?: StagingFixturesConfig;
  /**
   * Same-origin hosting of the administration web (issue #49). Present ONLY when ADMIN_WEB_STAGING_ENABLED=true, which is
   * valid only for APP_ENV=staging with the administration web authentication enabled. Absent everywhere else.
   */
  adminWebHosting?: AdminWebHostingConfig;
  /**
   * Test SMS inbox (M01.22). Present ONLY when TEST_INBOX was selected explicitly (OTP_PROVIDER=TEST_INBOX for REGISTER
   * and/or ADMIN_ACTIVATION_OTP_MODE=TEST_INBOX with the activation enabled) in a development/test environment on a
   * loopback target. Absent everywhere else: nothing of the test inbox is then created, and no listener is opened.
   */
  testInbox?: TestInboxConfig;
}

export type EnvSource = Readonly<Record<string, string | undefined>>;

export type ConfigResult =
  | { ok: true; config: AppConfig }
  | { ok: false; invalid: readonly string[] };

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3000;
const DEFAULT_POOL_MAX = 10;
const DEFAULT_CONNECT_TIMEOUT_MS = 1000;
const DEFAULT_QUERY_TIMEOUT_MS = 1000;
// Server statement timeout is deliberately smaller than the client query timeout, so PostgreSQL's own
// cancellation arrives before the client gives up and the connection stays usable.
const DEFAULT_STATEMENT_TIMEOUT_MS = 800;
const DEFAULT_TRANSACTION_TIMEOUT_MS = 5000;
const DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS = 2000;

function pickEnum<T extends string>(raw: string | undefined, allowed: readonly T[]): T | undefined {
  return allowed.find((candidate) => candidate === raw);
}

// Unset means "use the default". A value that is set but empty or malformed is invalid.
function readInteger(
  env: EnvSource,
  name: string,
  fallback: number,
  min: number,
  max: number,
  invalid: string[],
): number {
  const raw = env[name];
  if (raw === undefined) {
    return fallback;
  }
  if (!/^\d+$/.test(raw)) {
    invalid.push(name);
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    invalid.push(name);
    return fallback;
  }
  return value;
}

function isValidDatabaseUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      (url.protocol === 'postgres:' || url.protocol === 'postgresql:') &&
      url.hostname !== '' &&
      url.pathname.length > 1
    );
  } catch {
    return false;
  }
}

function isValidHost(raw: string): boolean {
  return raw.length > 0 && raw.length <= 255 && !/\s/.test(raw);
}

/**
 * Validates configuration from an environment-like object.
 * On failure it returns the NAMES of the invalid variables only — never their values —
 * so a bad DATABASE_URL can never leak credentials through an error message.
 * There are no fallbacks for APP_ENV or DATABASE_URL in any environment.
 */
export function loadConfig(env: EnvSource): ConfigResult {
  const invalid: string[] = [];

  const appEnv = pickEnum(env.APP_ENV, APP_ENVIRONMENTS);
  if (appEnv === undefined) {
    invalid.push('APP_ENV');
  }

  let nodeEnv: NodeEnvironment | undefined;
  if (env.NODE_ENV !== undefined) {
    nodeEnv = pickEnum(env.NODE_ENV, NODE_ENVIRONMENTS);
    if (nodeEnv === undefined) {
      invalid.push('NODE_ENV');
    }
  }

  const databaseUrl = env.DATABASE_URL;
  if (databaseUrl === undefined || !isValidDatabaseUrl(databaseUrl)) {
    invalid.push('DATABASE_URL');
  }

  const host = env.HOST === undefined ? DEFAULT_HOST : env.HOST;
  if (!isValidHost(host)) {
    invalid.push('HOST');
  }

  const port = readInteger(env, 'PORT', DEFAULT_PORT, 1, 65535, invalid);
  const poolMax = readInteger(env, 'DB_POOL_MAX', DEFAULT_POOL_MAX, 1, 50, invalid);
  const connectTimeoutMs = readInteger(
    env,
    'DB_CONNECT_TIMEOUT_MS',
    DEFAULT_CONNECT_TIMEOUT_MS,
    100,
    30000,
    invalid,
  );
  const queryTimeoutMs = readInteger(
    env,
    'DB_QUERY_TIMEOUT_MS',
    DEFAULT_QUERY_TIMEOUT_MS,
    100,
    30000,
    invalid,
  );

  const statementTimeoutMs = readInteger(
    env,
    'DB_STATEMENT_TIMEOUT_MS',
    DEFAULT_STATEMENT_TIMEOUT_MS,
    100,
    30000,
    invalid,
  );
  const transactionTimeoutMs = readInteger(
    env,
    'DB_TRANSACTION_TIMEOUT_MS',
    DEFAULT_TRANSACTION_TIMEOUT_MS,
    100,
    30000,
    invalid,
  );
  const idleInTransactionTimeoutMs = readInteger(
    env,
    'DB_IDLE_IN_TRANSACTION_TIMEOUT_MS',
    DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS,
    100,
    30000,
    invalid,
  );

  // Relations between the timeouts (ADR-003 §13.1). Only checked when the individual values are
  // valid, so one bad value is reported once and by its own name.
  const flag = (name: string): void => {
    if (!invalid.includes(name)) {
      invalid.push(name);
    }
  };
  const individuallyValid = (...names: string[]): boolean =>
    names.every((name) => !invalid.includes(name));
  if (
    individuallyValid('DB_QUERY_TIMEOUT_MS', 'DB_STATEMENT_TIMEOUT_MS') &&
    queryTimeoutMs <= statementTimeoutMs
  ) {
    flag('DB_STATEMENT_TIMEOUT_MS');
    flag('DB_QUERY_TIMEOUT_MS');
  }
  if (
    individuallyValid('DB_TRANSACTION_TIMEOUT_MS', 'DB_STATEMENT_TIMEOUT_MS') &&
    transactionTimeoutMs <= statementTimeoutMs
  ) {
    flag('DB_STATEMENT_TIMEOUT_MS');
    flag('DB_TRANSACTION_TIMEOUT_MS');
  }

  // Idempotency (ADR-003 sections 3.2, 5, 13.1, 13.4). Both lock budgets must stay below the server
  // statement timeout, otherwise PostgreSQL would cancel the statement before the lock timeout could
  // fire and a lock wait would be reported as a generic query timeout.
  const advisoryWaitMs = readInteger(
    env,
    'IDEMPOTENCY_ADVISORY_WAIT_MS',
    DEFAULT_ADVISORY_WAIT_MS,
    MIN_ADVISORY_WAIT_MS,
    MAX_ADVISORY_WAIT_MS,
    invalid,
  );
  const businessLockTimeoutMs = readInteger(
    env,
    'IDEMPOTENCY_BUSINESS_LOCK_TIMEOUT_MS',
    DEFAULT_BUSINESS_LOCK_TIMEOUT_MS,
    MIN_BUSINESS_LOCK_TIMEOUT_MS,
    MAX_BUSINESS_LOCK_TIMEOUT_MS,
    invalid,
  );
  const replayTtlSeconds = readInteger(
    env,
    'IDEMPOTENCY_REPLAY_TTL_SECONDS',
    DEFAULT_REPLAY_TTL_SECONDS,
    MIN_TTL_SECONDS,
    MAX_TTL_SECONDS,
    invalid,
  );
  const dedupeTtlSeconds = readInteger(
    env,
    'IDEMPOTENCY_DEDUPE_TTL_SECONDS',
    DEFAULT_DEDUPE_TTL_SECONDS,
    MIN_TTL_SECONDS,
    MAX_TTL_SECONDS,
    invalid,
  );
  // Validity is sampled BEFORE any of these relation flags is raised, so the verdict on one budget does
  // not depend on whether the other budget already flagged the statement timeout.
  const advisoryAgainstStatement =
    individuallyValid('IDEMPOTENCY_ADVISORY_WAIT_MS', 'DB_STATEMENT_TIMEOUT_MS') &&
    advisoryWaitMs >= statementTimeoutMs;
  const businessAgainstStatement =
    individuallyValid('IDEMPOTENCY_BUSINESS_LOCK_TIMEOUT_MS', 'DB_STATEMENT_TIMEOUT_MS') &&
    businessLockTimeoutMs >= statementTimeoutMs;
  if (advisoryAgainstStatement) {
    flag('IDEMPOTENCY_ADVISORY_WAIT_MS');
    flag('DB_STATEMENT_TIMEOUT_MS');
  }
  if (businessAgainstStatement) {
    flag('IDEMPOTENCY_BUSINESS_LOCK_TIMEOUT_MS');
    flag('DB_STATEMENT_TIMEOUT_MS');
  }
  if (
    individuallyValid('IDEMPOTENCY_REPLAY_TTL_SECONDS', 'IDEMPOTENCY_DEDUPE_TTL_SECONDS') &&
    replayTtlSeconds > dedupeTtlSeconds
  ) {
    flag('IDEMPOTENCY_REPLAY_TTL_SECONDS');
    flag('IDEMPOTENCY_DEDUPE_TTL_SECONDS');
  }

  // Outbox dispatcher (ADR-003 §13.6). Bounds first, then the two relations; a relation is only judged when
  // both of its variables are individually valid, so one bad value is reported once and by its own name.
  const outboxMaxAttempts = readInteger(
    env,
    'OUTBOX_MAX_ATTEMPTS',
    DEFAULT_OUTBOX_MAX_ATTEMPTS,
    MIN_OUTBOX_MAX_ATTEMPTS,
    MAX_OUTBOX_MAX_ATTEMPTS,
    invalid,
  );
  const outboxBatchSize = readInteger(
    env,
    'OUTBOX_BATCH_SIZE',
    DEFAULT_OUTBOX_BATCH_SIZE,
    MIN_OUTBOX_BATCH_SIZE,
    MAX_OUTBOX_BATCH_SIZE,
    invalid,
  );
  const outboxPublishConcurrency = readInteger(
    env,
    'OUTBOX_PUBLISH_CONCURRENCY',
    DEFAULT_OUTBOX_PUBLISH_CONCURRENCY,
    MIN_OUTBOX_PUBLISH_CONCURRENCY,
    MAX_OUTBOX_PUBLISH_CONCURRENCY,
    invalid,
  );
  const outboxPublishTimeoutMs = readInteger(
    env,
    'OUTBOX_PUBLISH_TIMEOUT_MS',
    DEFAULT_OUTBOX_PUBLISH_TIMEOUT_MS,
    MIN_OUTBOX_DURATION_MS,
    MAX_OUTBOX_DURATION_MS,
    invalid,
  );
  const outboxLeaseMs = readInteger(
    env,
    'OUTBOX_LEASE_MS',
    DEFAULT_OUTBOX_LEASE_MS,
    MIN_OUTBOX_DURATION_MS,
    MAX_OUTBOX_DURATION_MS,
    invalid,
  );
  const outboxBackoffBaseMs = readInteger(
    env,
    'OUTBOX_BACKOFF_BASE_MS',
    DEFAULT_OUTBOX_BACKOFF_BASE_MS,
    MIN_OUTBOX_DURATION_MS,
    MAX_OUTBOX_DURATION_MS,
    invalid,
  );
  const outboxBackoffCapMs = readInteger(
    env,
    'OUTBOX_BACKOFF_CAP_MS',
    DEFAULT_OUTBOX_BACKOFF_CAP_MS,
    MIN_OUTBOX_DURATION_MS,
    MAX_OUTBOX_DURATION_MS,
    invalid,
  );
  // Both verdicts are sampled before either flag is raised, so neither depends on the other.
  const leaseRelationBroken =
    individuallyValid('OUTBOX_LEASE_MS', 'OUTBOX_PUBLISH_TIMEOUT_MS') &&
    !isValidLeaseRelation(outboxLeaseMs, outboxPublishTimeoutMs);
  const backoffRelationBroken =
    individuallyValid('OUTBOX_BACKOFF_BASE_MS', 'OUTBOX_BACKOFF_CAP_MS') &&
    !isValidBackoffRelation(outboxBackoffBaseMs, outboxBackoffCapMs);
  if (leaseRelationBroken) {
    flag('OUTBOX_LEASE_MS');
    flag('OUTBOX_PUBLISH_TIMEOUT_MS');
  }
  if (backoffRelationBroken) {
    flag('OUTBOX_BACKOFF_BASE_MS');
    flag('OUTBOX_BACKOFF_CAP_MS');
  }

  // Database TLS (M00-D1). Staging and production must verify the server certificate against a supplied CA, so a
  // missing or malformed CA (or a weakening URL query / NODE_TLS_REJECT_UNAUTHORIZED=0) refuses startup. The
  // URL is only inspected when it is itself valid; an invalid URL is already reported as DATABASE_URL.
  // Only variable NAMES are ever reported: never the CA text, the file path or the URL.
  let databaseTls: DatabaseTls | undefined;
  if (appEnv !== undefined) {
    const tlsResult = resolveDatabaseTls({
      env,
      required: appEnv === 'staging' || appEnv === 'production',
      databaseUrl:
        databaseUrl !== undefined && !invalid.includes('DATABASE_URL') ? databaseUrl : undefined,
    });
    if (tlsResult.ok) {
      databaseTls = tlsResult.tls;
    } else {
      tlsResult.invalid.forEach(flag);
    }
  }

  // Crypto keyring: optional at this level, but all-or-nothing and strictly validated when present.
  // Only variable NAMES are ever reported; key material is never echoed.
  let crypto: Keyring | undefined;
  const rawKeyring = env.CRYPTO_KEYRING;
  const rawActiveKeyId = env.CRYPTO_ACTIVE_KEY_ID;
  if (rawKeyring !== undefined || rawActiveKeyId !== undefined) {
    if (rawKeyring === undefined) {
      flag('CRYPTO_KEYRING');
    }
    if (rawActiveKeyId === undefined) {
      flag('CRYPTO_ACTIVE_KEY_ID');
    }
    if (rawKeyring !== undefined && rawActiveKeyId !== undefined) {
      const parsed = parseKeyringConfig(rawKeyring, rawActiveKeyId);
      if (parsed.ok) {
        crypto = parsed.keyring;
      } else {
        parsed.invalid.forEach(flag);
      }
    }
  }

  // Auth Core (M01-A1 task section 9). Bounds first; the HMAC secret is all-or-nothing and, like the keyring, only
  // its NAME is ever reported. Argon2 parameters are constants (ADR-002), not variables.
  const authOtpTtlSeconds = readInteger(
    env,
    'AUTH_OTP_TTL_SECONDS',
    DEFAULT_AUTH_OTP_TTL_SECONDS,
    MIN_AUTH_OTP_TTL_SECONDS,
    MAX_AUTH_OTP_TTL_SECONDS,
    invalid,
  );
  const authOtpResendSeconds = readInteger(
    env,
    'AUTH_OTP_RESEND_SECONDS',
    DEFAULT_AUTH_OTP_RESEND_SECONDS,
    MIN_AUTH_OTP_RESEND_SECONDS,
    MAX_AUTH_OTP_RESEND_SECONDS,
    invalid,
  );
  const authOtpMaxAttempts = readInteger(
    env,
    'AUTH_OTP_MAX_ATTEMPTS',
    DEFAULT_AUTH_OTP_MAX_ATTEMPTS,
    MIN_AUTH_OTP_MAX_ATTEMPTS,
    MAX_AUTH_OTP_MAX_ATTEMPTS,
    invalid,
  );
  const authProofTtlSeconds = readInteger(
    env,
    'AUTH_PROOF_TTL_SECONDS',
    DEFAULT_AUTH_PROOF_TTL_SECONDS,
    MIN_AUTH_PROOF_TTL_SECONDS,
    MAX_AUTH_PROOF_TTL_SECONDS,
    invalid,
  );
  const authSessionTtlSeconds = readInteger(
    env,
    'AUTH_SESSION_TTL_SECONDS',
    DEFAULT_AUTH_SESSION_TTL_SECONDS,
    MIN_AUTH_SESSION_TTL_SECONDS,
    MAX_AUTH_SESSION_TTL_SECONDS,
    invalid,
  );
  let auth: AuthConfig | undefined;
  const rawOtpHmacSecret = env.AUTH_OTP_HMAC_SECRET;
  if (rawOtpHmacSecret !== undefined) {
    const otpHmacKey = parseOtpHmacSecret(rawOtpHmacSecret);
    if (otpHmacKey === undefined) {
      flag('AUTH_OTP_HMAC_SECRET');
    } else {
      auth = {
        otpTtlSeconds: authOtpTtlSeconds,
        otpResendSeconds: authOtpResendSeconds,
        otpMaxAttempts: authOtpMaxAttempts,
        proofTtlSeconds: authProofTtlSeconds,
        sessionTtlSeconds: authSessionTtlSeconds,
        otpHmacKey,
      };
    }
  }

  // Administration web authentication (M01-D-LOGIN). Names only; disabled by default.
  const adminAuthResult = loadAdminAuthConfig(env);
  let adminAuth: AdminAuthConfig | undefined;
  if (adminAuthResult.ok) {
    adminAuth = adminAuthResult.config;
  } else {
    adminAuthResult.invalid.forEach(flag);
  }

  // Administration activation (M01-D-ADMIN-1C). Names only; disabled by default; needs the administration module.
  const adminActivationResult = loadAdminActivationConfig(env, appEnv, !adminAuthResult.ok || adminAuth !== undefined);
  let adminActivation: AdminActivationConfig | undefined;
  if (adminActivationResult.ok) {
    adminActivation = adminActivationResult.config;
  } else {
    adminActivationResult.invalid.forEach(flag);
  }

  // Staging fixture mode (M00-D2): fail closed in every environment. Names only, never a value.
  const stagingFixtures = parseStagingFixtures({
    appEnv,
    enabledRaw: env.AUTH_STAGING_FIXTURES_ENABLED,
    phonesRaw: env.AUTH_STAGING_ALLOWED_PHONES,
  });
  if (!stagingFixtures.ok) {
    stagingFixtures.invalid.forEach(flag);
  }

  // Same-origin hosting of the administration web (issue #49): fail closed in every environment. Names only.
  const adminWebHosting = parseAdminWebHosting({
    appEnv,
    enabledRaw: env.ADMIN_WEB_STAGING_ENABLED,
    adminAuthEnabled: adminAuth !== undefined,
  });
  if (!adminWebHosting.ok) {
    adminWebHosting.invalid.forEach(flag);
  }

  // Test SMS inbox (M01.22): explicit, development/test and loopback only. Names only, never a value.
  const testInboxResult = loadTestInboxConfig({
    env,
    appEnv,
    host,
    databaseUrl,
    activationEnabled: adminActivation !== undefined,
  });
  let testInbox: TestInboxConfig | undefined;
  if (testInboxResult.ok) {
    testInbox = testInboxResult.config;
  } else {
    testInboxResult.invalid.forEach(flag);
  }

  if (invalid.length > 0 || appEnv === undefined || databaseUrl === undefined) {
    return { ok: false, invalid };
  }

  return {
    ok: true,
    config: {
      appEnv,
      nodeEnv,
      host,
      port,
      database: {
        url: databaseUrl,
        poolMax,
        connectTimeoutMs,
        queryTimeoutMs,
        statementTimeoutMs,
        // The key is omitted (not set to undefined) when there is no TLS, so local/CI configs are unchanged.
        ...(databaseTls === undefined ? {} : { tls: databaseTls }),
      },
      transaction: { timeoutMs: transactionTimeoutMs, idleInTransactionTimeoutMs },
      idempotency: { advisoryWaitMs, businessLockTimeoutMs, replayTtlSeconds, dedupeTtlSeconds },
      outbox: {
        maxAttempts: outboxMaxAttempts,
        batchSize: outboxBatchSize,
        publishConcurrency: outboxPublishConcurrency,
        publishTimeoutMs: outboxPublishTimeoutMs,
        leaseMs: outboxLeaseMs,
        backoffBaseMs: outboxBackoffBaseMs,
        backoffCapMs: outboxBackoffCapMs,
      },
      crypto,
      auth,
      ...(adminAuth === undefined ? {} : { adminAuth }),
      ...(adminActivation === undefined ? {} : { adminActivation }),
      ...(stagingFixtures.ok && stagingFixtures.config !== undefined
        ? { stagingFixtures: stagingFixtures.config }
        : {}),
      ...(adminWebHosting.ok && adminWebHosting.config !== undefined
        ? { adminWebHosting: adminWebHosting.config }
        : {}),
      ...(testInbox === undefined ? {} : { testInbox }),
    },
  };
}

export function formatInvalidConfigMessage(invalid: readonly string[]): string {
  return `Invalid or missing configuration. Check environment variable(s): ${invalid.join(', ')}`;
}
