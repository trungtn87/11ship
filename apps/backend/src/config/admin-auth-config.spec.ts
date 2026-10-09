import { describe, expect, it } from '@jest/globals';
import { inspect } from 'node:util';
import { formatInvalidConfigMessage, loadConfig } from './app-config';
import {
  isCanonicalHttpsOrigin,
  loadAdminAuthConfig,
  loadLimiterConfig,
  normalizeIp,
  parseAllowedOrigins,
  parseTrustedProxyIps,
} from './admin-auth-config';

const KEY_B64 = Buffer.alloc(32, 9).toString('base64');
const SECRET = 'SECRET_MARKER_ADMIN_CFG_41';
const ENABLED = {
  ADMIN_AUTH_ENABLED: 'true',
  ADMIN_AUTH_ALLOWED_ORIGINS: '["https://admin.example.test"]',
  ADMIN_RATE_LIMIT_HMAC_KEY: KEY_B64,
  ADMIN_RATE_LIMIT_KEY_ID: 'limiter-1',
};
const BASE = {
  APP_ENV: 'test',
  DATABASE_URL: `postgres://ship11_test:${SECRET}@127.0.0.1:5433/ship11_test`,
};

function invalidOf(env: Record<string, string | undefined>): readonly string[] {
  const result = loadAdminAuthConfig(env);
  if (result.ok) {
    throw new Error('expected rejection');
  }
  return result.invalid;
}

describe('ADMIN_AUTH_ENABLED', () => {
  it('is disabled by default and then validates and creates nothing', () => {
    for (const env of [{}, { ADMIN_AUTH_ENABLED: 'false' }, { ADMIN_AUTH_ENABLED: 'false', ADMIN_RATE_LIMIT_HMAC_KEY: 'junk' }]) {
      expect(loadAdminAuthConfig(env)).toEqual({ ok: true, config: undefined });
    }
    const loaded = loadConfig(BASE);
    if (!loaded.ok) throw new Error('expected valid');
    expect('adminAuth' in loaded.config).toBe(false);
  });

  it.each(['TRUE', '1', 'yes', '', ' true'])('rejects the non-canonical flag %p by name', (value) => {
    expect(invalidOf({ ADMIN_AUTH_ENABLED: value })).toEqual(['ADMIN_AUTH_ENABLED']);
  });

  it('accepts a complete enabled configuration and defaults the trusted proxies to none', () => {
    const result = loadAdminAuthConfig(ENABLED);
    if (!result.ok || result.config === undefined) throw new Error('expected valid');
    expect(result.config.allowedOrigins).toEqual(['https://admin.example.test']);
    expect(result.config.trustedProxyIps).toEqual([]);
    expect(result.config.limiter.keyId).toBe('limiter-1');
  });

  it('requires origins, key and key id when enabled, reporting names only', () => {
    expect(invalidOf({ ADMIN_AUTH_ENABLED: 'true' })).toEqual([
      'ADMIN_AUTH_ALLOWED_ORIGINS',
      'ADMIN_RATE_LIMIT_HMAC_KEY',
      'ADMIN_RATE_LIMIT_KEY_ID',
    ]);
  });

  it('is surfaced through loadConfig, with names only and the whole config refused', () => {
    const invalid = invalidOf({ ...ENABLED, ADMIN_RATE_LIMIT_HMAC_KEY: SECRET });
    expect(invalid).toEqual(['ADMIN_RATE_LIMIT_HMAC_KEY']);
    const result = loadConfig({ ...BASE, ...ENABLED, ADMIN_RATE_LIMIT_HMAC_KEY: SECRET });
    if (result.ok) throw new Error('expected rejection');
    expect(result.invalid).toEqual(['ADMIN_RATE_LIMIT_HMAC_KEY']);
    expect(formatInvalidConfigMessage(result.invalid)).not.toContain(SECRET);
    const good = loadConfig({ ...BASE, ...ENABLED });
    if (!good.ok) throw new Error('expected valid');
    expect(good.config.adminAuth?.allowedOrigins).toEqual(['https://admin.example.test']);
  });
});

describe('allowed origins', () => {
  it.each([
    ['["https://admin.example.test"]', true],
    ['["https://admin.example.test:8443","https://other.example.test"]', true],
    ['[]', false],
    ['"https://admin.example.test"', false],
    ['not json', false],
    ['["http://admin.example.test"]', false],
    ['["https://admin.example.test/"]', false],
    ['["https://admin.example.test/path"]', false],
    ['["https://admin.example.test?x=1"]', false],
    ['["https://user@admin.example.test"]', false],
    ['["https://*.example.test"]', false],
    ['["https://ADMIN.example.test"]', false],
    ['["https://admin.example.test:443"]', false],
    ['["https://admin.example.test","https://admin.example.test"]', false],
    ['[1]', false],
  ])('%s -> accepted=%p', (raw, accepted) => {
    expect(parseAllowedOrigins(raw) !== undefined).toBe(accepted);
  });

  it('knows a canonical origin only', () => {
    expect(isCanonicalHttpsOrigin('https://a.test')).toBe(true);
    expect(isCanonicalHttpsOrigin('https://a.test/')).toBe(false);
    expect(isCanonicalHttpsOrigin(undefined)).toBe(false);
  });
});

describe('trusted proxy IPs', () => {
  it.each([
    ['["10.0.0.1"]', true],
    ['["::1"]', true],
    ['["2001:db8::1"]', true],
    ['[]', true],
    ['["10.0.0.0/8"]', false],
    ['["10.0.0.1:80"]', false],
    ['["*"]', false],
    ['["proxy.local"]', false],
    ['["2001:DB8::1"]', false],
    ['["fe80::1%eth0"]', false],
    ['"10.0.0.1"', false],
  ])('%s -> accepted=%p', (raw, accepted) => {
    expect(parseTrustedProxyIps(raw) !== undefined).toBe(accepted);
  });

  it('defaults to an empty allowlist', () => {
    expect(parseTrustedProxyIps(undefined)).toEqual([]);
  });

  it('normalizes addresses: mapped IPv4 is IPv4, IPv6 is compressed lowercase, junk is refused', () => {
    expect(normalizeIp('::ffff:10.1.2.3')).toBe('10.1.2.3');
    expect(normalizeIp('2001:DB8:0:0:0:0:0:1')).toBe('2001:db8::1');
    expect(normalizeIp('10.1.2.3')).toBe('10.1.2.3');
    for (const junk of ['', 'abc', '10.1.2', '10.1.2.3.4', '1.2.3.4, 5.6.7.8', 'fe80::1%eth0', '[::1]']) {
      expect(normalizeIp(junk)).toBeUndefined();
    }
  });
});

describe('limiter key', () => {
  it('requires canonical 32-byte base64 and a bounded id', () => {
    expect(loadLimiterConfig({ ADMIN_RATE_LIMIT_HMAC_KEY: KEY_B64, ADMIN_RATE_LIMIT_KEY_ID: 'a_b-1' }).ok).toBe(true);
    for (const key of [Buffer.alloc(31).toString('base64'), Buffer.alloc(33).toString('base64'), 'x', KEY_B64.replace('=', '')]) {
      expect(loadLimiterConfig({ ADMIN_RATE_LIMIT_HMAC_KEY: key, ADMIN_RATE_LIMIT_KEY_ID: 'a' })).toEqual({
        ok: false,
        invalid: ['ADMIN_RATE_LIMIT_HMAC_KEY'],
      });
    }
    for (const id of ['', 'a b', 'x'.repeat(65), 'é']) {
      expect(loadLimiterConfig({ ADMIN_RATE_LIMIT_HMAC_KEY: KEY_B64, ADMIN_RATE_LIMIT_KEY_ID: id })).toEqual({
        ok: false,
        invalid: ['ADMIN_RATE_LIMIT_KEY_ID'],
      });
    }
  });

  it('derives stable, kind-separated bucket keys and a key check, and never prints the key', () => {
    const result = loadLimiterConfig({ ADMIN_RATE_LIMIT_HMAC_KEY: KEY_B64, ADMIN_RATE_LIMIT_KEY_ID: 'a' });
    if (!result.ok) throw new Error('expected valid');
    const { key } = result.limiter;
    expect(key.bucketKey('LOGIN_PHONE', '+84900000001')).toMatch(/^[0-9a-f]{64}$/);
    expect(key.bucketKey('LOGIN_PHONE', '+84900000001')).toBe(key.bucketKey('LOGIN_PHONE', '+84900000001'));
    expect(key.bucketKey('LOGIN_PHONE', '+84900000001')).not.toBe(key.bucketKey('LOGIN_IP', '+84900000001'));
    expect(key.keyCheck()).toMatch(/^[0-9a-f]{64}$/);
    const other = loadLimiterConfig({ ADMIN_RATE_LIMIT_HMAC_KEY: Buffer.alloc(32, 1).toString('base64'), ADMIN_RATE_LIMIT_KEY_ID: 'a' });
    if (!other.ok) throw new Error('expected valid');
    expect(other.limiter.key.keyCheck()).not.toBe(key.keyCheck());
    for (const text of [JSON.stringify(result.limiter), inspect(result.limiter), String(key)]) {
      expect(text).not.toContain(KEY_B64);
    }
  });
});
