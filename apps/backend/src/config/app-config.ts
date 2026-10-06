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
  queryTimeoutMs: number;
}

export interface AppConfig {
  appEnv: AppEnvironment;
  nodeEnv: NodeEnvironment | undefined;
  host: string;
  port: number;
  database: DatabaseConfig;
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
      database: { url: databaseUrl, poolMax, connectTimeoutMs, queryTimeoutMs },
    },
  };
}

export function formatInvalidConfigMessage(invalid: readonly string[]): string {
  return `Invalid or missing configuration. Check environment variable(s): ${invalid.join(', ')}`;
}
