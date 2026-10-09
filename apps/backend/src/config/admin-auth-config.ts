// Administration web authentication configuration (M01-D-LOGIN). Pure data and validation: nothing here reads the
// environment by itself or talks to a database. TTLs, thresholds and window sizes are NOT configuration: they are
// constants of the admin-auth module, so no variable can silently loosen a gate. Only the names of invalid variables
// are ever reported, never their values.
import { createHmac } from 'node:crypto';
import { inspect } from 'node:util';
import { isIP } from 'node:net';

export const ADMIN_RATE_LIMIT_HMAC_KEY_BYTES = 32;
const SECRET_BASE64 = /^[A-Za-z0-9+/]{43}=$/;
export const ADMIN_RATE_LIMIT_KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_ORIGINS = 8;
const MAX_PROXIES = 16;

const KEY_CHECK_CONTEXT = '11ship.admin-auth.limit-config.v1';

/** Redacting holder of the limiter key. The only operations are keyed digests; the bytes are never exposed. */
export class AdminLimiterKey {
  readonly #key: Buffer;

  constructor(key: Buffer) {
    if (!Buffer.isBuffer(key) || key.length !== ADMIN_RATE_LIMIT_HMAC_KEY_BYTES) {
      throw new RangeError('Limiter key must be exactly 32 bytes');
    }
    this.#key = Buffer.from(key);
    Object.freeze(this);
  }

  /** HMAC-SHA-256 hex over the canonical tuple (kind, identity): the bucket_key stored in admin_auth_limits. */
  bucketKey(kind: string, identity: string): string {
    return createHmac('sha256', this.#key)
      .update(JSON.stringify(['admin-auth-limit.v1', kind, identity]), 'utf8')
      .digest('hex');
  }

  /** Keyed check value stored in admin_auth_limit_config: proves the configured secret is the original one. */
  keyCheck(): string {
    return createHmac('sha256', this.#key).update(KEY_CHECK_CONTEXT, 'utf8').digest('hex');
  }

  toJSON(): string {
    return '[REDACTED]';
  }

  toString(): string {
    return '[REDACTED]';
  }

  [inspect.custom](): string {
    return '[REDACTED]';
  }
}

export interface AdminLimiterConfig {
  readonly keyId: string;
  readonly key: AdminLimiterKey;
}

export interface AdminAuthConfig {
  /** Exact canonical HTTPS origins allowed in the Origin header of administration POSTs. */
  readonly allowedOrigins: readonly string[];
  /** Exact proxy addresses whose single X-Forwarded-For entry is believed. Default: none. */
  readonly trustedProxyIps: readonly string[];
  readonly limiter: AdminLimiterConfig;
}

export type EnvSource = Readonly<Record<string, string | undefined>>;

export function parseLimiterKey(raw: string): AdminLimiterKey | undefined {
  if (!SECRET_BASE64.test(raw)) {
    return undefined;
  }
  const bytes = Buffer.from(raw, 'base64');
  if (bytes.length !== ADMIN_RATE_LIMIT_HMAC_KEY_BYTES || bytes.toString('base64') !== raw) {
    return undefined;
  }
  return new AdminLimiterKey(bytes);
}

/** The limiter key id and secret, as the operator command and the module both read them. Names only on failure. */
export function loadLimiterConfig(
  env: EnvSource,
): { ok: true; limiter: AdminLimiterConfig } | { ok: false; invalid: readonly string[] } {
  const invalid: string[] = [];
  const rawKey = env.ADMIN_RATE_LIMIT_HMAC_KEY;
  const rawId = env.ADMIN_RATE_LIMIT_KEY_ID;
  const key = rawKey === undefined ? undefined : parseLimiterKey(rawKey);
  if (key === undefined) {
    invalid.push('ADMIN_RATE_LIMIT_HMAC_KEY');
  }
  if (rawId === undefined || !ADMIN_RATE_LIMIT_KEY_ID_PATTERN.test(rawId)) {
    invalid.push('ADMIN_RATE_LIMIT_KEY_ID');
  }
  if (invalid.length > 0 || key === undefined || rawId === undefined) {
    return { ok: false, invalid };
  }
  return { ok: true, limiter: { keyId: rawId, key } };
}

function parseJsonArray(raw: string): unknown[] | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Canonical HTTPS origin: scheme + host[:port] only, as the browser would send it. No path, query, userinfo, wildcard. */
export function isCanonicalHttpsOrigin(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 255 || value.includes('*')) {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === '' &&
      url.origin === value
    );
  } catch {
    return false;
  }
}

const MAPPED_V4 = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i;

/**
 * Canonical text of an IPv4/IPv6 literal, or undefined when the text is not exactly one address (zone ids, ports,
 * brackets and CIDR are refused). IPv4-mapped IPv6 is reported as the IPv4 address.
 */
export function normalizeIp(raw: string): string | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const mapped = MAPPED_V4.exec(raw);
  const candidate = mapped?.[1] ?? raw;
  const family = isIP(candidate);
  if (family === 4) {
    return candidate;
  }
  if (family === 6 && !candidate.includes('%')) {
    try {
      return new URL(`http://[${candidate}]`).hostname.slice(1, -1);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function parseAllowedOrigins(raw: string | undefined): readonly string[] | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const list = parseJsonArray(raw);
  if (list === undefined || list.length < 1 || list.length > MAX_ORIGINS) {
    return undefined;
  }
  if (!list.every(isCanonicalHttpsOrigin) || new Set(list).size !== list.length) {
    return undefined;
  }
  return Object.freeze([...(list as string[])]);
}

export function parseTrustedProxyIps(raw: string | undefined): readonly string[] | undefined {
  if (raw === undefined) {
    return Object.freeze([]);
  }
  const list = parseJsonArray(raw);
  if (list === undefined || list.length > MAX_PROXIES) {
    return undefined;
  }
  const normalized: string[] = [];
  for (const item of list) {
    const ip = typeof item === 'string' ? normalizeIp(item) : undefined;
    // Exact literals only: the configured text must already be the canonical form, so what is compared is what was written.
    if (ip === undefined || ip !== item) {
      return undefined;
    }
    normalized.push(ip);
  }
  return Object.freeze([...new Set(normalized)]);
}

/**
 * ADMIN_AUTH_ENABLED (default false). Disabled: the module is not wired, nothing is validated beyond the flag itself
 * and no limiter is created. Enabled: ADMIN_AUTH_ALLOWED_ORIGINS, ADMIN_RATE_LIMIT_HMAC_KEY and ADMIN_RATE_LIMIT_KEY_ID
 * are required and ADMIN_AUTH_TRUSTED_PROXY_IPS (default []) must be valid when set.
 */
export function loadAdminAuthConfig(
  env: EnvSource,
): { ok: true; config: AdminAuthConfig | undefined } | { ok: false; invalid: readonly string[] } {
  const rawEnabled = env.ADMIN_AUTH_ENABLED;
  if (rawEnabled === undefined || rawEnabled === 'false') {
    return { ok: true, config: undefined };
  }
  if (rawEnabled !== 'true') {
    return { ok: false, invalid: ['ADMIN_AUTH_ENABLED'] };
  }
  const invalid: string[] = [];
  const allowedOrigins = parseAllowedOrigins(env.ADMIN_AUTH_ALLOWED_ORIGINS);
  if (allowedOrigins === undefined) {
    invalid.push('ADMIN_AUTH_ALLOWED_ORIGINS');
  }
  const trustedProxyIps = parseTrustedProxyIps(env.ADMIN_AUTH_TRUSTED_PROXY_IPS);
  if (trustedProxyIps === undefined) {
    invalid.push('ADMIN_AUTH_TRUSTED_PROXY_IPS');
  }
  const limiter = loadLimiterConfig(env);
  if (!limiter.ok) {
    invalid.push(...limiter.invalid);
  }
  if (invalid.length > 0 || allowedOrigins === undefined || trustedProxyIps === undefined || !limiter.ok) {
    return { ok: false, invalid };
  }
  return { ok: true, config: { allowedOrigins, trustedProxyIps, limiter: limiter.limiter } };
}
