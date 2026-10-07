import { Keyring, parseKeyringConfig } from '../crypto/keyring';
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

export interface AppConfig {
  appEnv: AppEnvironment;
  nodeEnv: NodeEnvironment | undefined;
  host: string;
  port: number;
  database: DatabaseConfig;
  transaction: TransactionConfig;
  /** Idempotency windows and lock budgets (M00-C1A1). Always present, with defaults. */
  idempotency: IdempotencyConfig;
  /**
   * Immutable crypto keyring. Optional at the config level; when either variable is set both must be
   * valid. It is REQUIRED wherever the idempotency executor is wired: IdempotencyModule refuses to
   * start without it (see requireKeyring in idempotency.module.ts), naming only the variables.
   */
  crypto: Keyring | undefined;
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
      database: { url: databaseUrl, poolMax, connectTimeoutMs, queryTimeoutMs, statementTimeoutMs },
      transaction: { timeoutMs: transactionTimeoutMs, idleInTransactionTimeoutMs },
      idempotency: { advisoryWaitMs, businessLockTimeoutMs, replayTtlSeconds, dedupeTtlSeconds },
      crypto,
    },
  };
}

export function formatInvalidConfigMessage(invalid: readonly string[]): string {
  return `Invalid or missing configuration. Check environment variable(s): ${invalid.join(', ')}`;
}
