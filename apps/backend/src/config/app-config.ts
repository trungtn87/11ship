import { Keyring, parseKeyringConfig } from '../crypto/keyring';

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
}

export interface TransactionConfig {
  /** Total wall-clock budget of one transaction. Must be larger than the statement timeout. */
  timeoutMs: number;
  /** idle_in_transaction_session_timeout. */
  idleInTransactionTimeoutMs: number;
}

export interface IdempotencyConfig {
  /** Bounded wait only for pg_advisory_xact_lock. */
  advisoryWaitMs: number;
  /** lock_timeout restored immediately after advisory acquisition for business row locks. */
  businessLockTimeoutMs: number;
  replayTtlSeconds: number;
  dedupeTtlSeconds: number;
}

export interface AppConfig {
  appEnv: AppEnvironment;
  nodeEnv: NodeEnvironment | undefined;
  host: string;
  port: number;
  database: DatabaseConfig;
  transaction: TransactionConfig;
  idempotency: IdempotencyConfig;
  /** Immutable crypto keyring. Required from M00-C1A1 because the executor persists HMAC/encrypted replay. */
  crypto: Keyring;
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
const DEFAULT_IDEMPOTENCY_ADVISORY_WAIT_MS = 250;
const DEFAULT_BUSINESS_LOCK_TIMEOUT_MS = 500;
const DEFAULT_REPLAY_TTL_SECONDS = 900;
const DEFAULT_DEDUPE_TTL_SECONDS = 604800;

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
  const advisoryWaitMs = readInteger(
    env,
    'IDEMPOTENCY_ADVISORY_WAIT_MS',
    DEFAULT_IDEMPOTENCY_ADVISORY_WAIT_MS,
    1,
    5000,
    invalid,
  );
  const businessLockTimeoutMs = readInteger(
    env,
    'DB_BUSINESS_LOCK_TIMEOUT_MS',
    DEFAULT_BUSINESS_LOCK_TIMEOUT_MS,
    1,
    30000,
    invalid,
  );
  const replayTtlSeconds = readInteger(
    env,
    'IDEMPOTENCY_REPLAY_TTL_SECONDS',
    DEFAULT_REPLAY_TTL_SECONDS,
    1,
    604800,
    invalid,
  );
  const dedupeTtlSeconds = readInteger(
    env,
    'IDEMPOTENCY_DEDUPE_TTL_SECONDS',
    DEFAULT_DEDUPE_TTL_SECONDS,
    1,
    604800,
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
  if (
    individuallyValid('IDEMPOTENCY_ADVISORY_WAIT_MS', 'DB_STATEMENT_TIMEOUT_MS') &&
    advisoryWaitMs >= statementTimeoutMs
  ) {
    flag('IDEMPOTENCY_ADVISORY_WAIT_MS');
    flag('DB_STATEMENT_TIMEOUT_MS');
  }
  if (
    individuallyValid('DB_BUSINESS_LOCK_TIMEOUT_MS', 'DB_STATEMENT_TIMEOUT_MS') &&
    businessLockTimeoutMs >= statementTimeoutMs
  ) {
    flag('DB_BUSINESS_LOCK_TIMEOUT_MS');
    flag('DB_STATEMENT_TIMEOUT_MS');
  }
  if (
    individuallyValid('IDEMPOTENCY_REPLAY_TTL_SECONDS', 'IDEMPOTENCY_DEDUPE_TTL_SECONDS') &&
    replayTtlSeconds > dedupeTtlSeconds
  ) {
    flag('IDEMPOTENCY_REPLAY_TTL_SECONDS');
    flag('IDEMPOTENCY_DEDUPE_TTL_SECONDS');
  }

  // Crypto keyring is required from C1A1. Only variable NAMES are ever reported; key material is never echoed.
  let crypto: Keyring | undefined;
  const rawKeyring = env.CRYPTO_KEYRING;
  const rawActiveKeyId = env.CRYPTO_ACTIVE_KEY_ID;
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

  if (invalid.length > 0 || appEnv === undefined || databaseUrl === undefined || crypto === undefined) {
    return { ok: false, invalid };
  }

  return {
    ok: true,
    config: {
      appEnv,
      nodeEnv,
      host,
      port,
      database: { url: databaseUrl, poolMax, connectTimeoutMs, queryTimeoutMs, statementTimeoutMs },
      transaction: { timeoutMs: transactionTimeoutMs, idleInTransactionTimeoutMs },
      idempotency: {
        advisoryWaitMs,
        businessLockTimeoutMs,
        replayTtlSeconds,
        dedupeTtlSeconds,
      },
      crypto,
    },
  };
}

export function formatInvalidConfigMessage(invalid: readonly string[]): string {
  return `Invalid or missing configuration. Check environment variable(s): ${invalid.join(', ')}`;
}
