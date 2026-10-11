import { describe, expect, it } from '@jest/globals';
import { ADMIN_WEB_STAGING_ENABLED_VARIABLE, parseAdminWebHosting } from './admin-web-hosting-config';
import { createTestPki } from '../database/test-tls.fixture';
import { EnvSource, loadConfig } from './app-config';

describe('parseAdminWebHosting (ADMIN_WEB_STAGING_ENABLED)', () => {
  it('is off when unset or exactly "false", in every environment, with or without the administration module', () => {
    for (const appEnv of ['staging', 'production', 'development', 'test', undefined]) {
      for (const adminAuthEnabled of [true, false]) {
        for (const enabledRaw of [undefined, 'false']) {
          expect(parseAdminWebHosting({ appEnv, enabledRaw, adminAuthEnabled })).toEqual({ ok: true, config: undefined });
        }
      }
    }
  });

  it('is on only for staging with the administration module enabled', () => {
    expect(parseAdminWebHosting({ appEnv: 'staging', enabledRaw: 'true', adminAuthEnabled: true })).toEqual({
      ok: true,
      config: { enabled: true },
    });
  });

  it.each(['production', 'development', 'test', undefined])(
    '"true" is refused for APP_ENV=%s, naming only the variable',
    (appEnv) => {
      expect(parseAdminWebHosting({ appEnv, enabledRaw: 'true', adminAuthEnabled: true })).toEqual({
        ok: false,
        invalid: [ADMIN_WEB_STAGING_ENABLED_VARIABLE],
      });
    },
  );

  it('"true" is refused without the administration web authentication behind it', () => {
    expect(parseAdminWebHosting({ appEnv: 'staging', enabledRaw: 'true', adminAuthEnabled: false })).toEqual({
      ok: false,
      invalid: [ADMIN_WEB_STAGING_ENABLED_VARIABLE],
    });
  });

  it.each(['TRUE', 'True', '1', 'yes', ' true', 'true ', '', 'maybe', 'on'])('refuses the value %p (only "true" and "false" exist)', (raw) => {
    expect(parseAdminWebHosting({ appEnv: 'staging', enabledRaw: raw, adminAuthEnabled: true })).toEqual({
      ok: false,
      invalid: [ADMIN_WEB_STAGING_ENABLED_VARIABLE],
    });
  });
});

// The same rules through loadConfig, so the variable really is read, validated in every environment, and never echoed.
describe('loadConfig and ADMIN_WEB_STAGING_ENABLED', () => {
  const SECRET = 'SECRET_MARKER_HOSTING_CFG_52';
  const TEST_CA = createTestPki().caPem;
  const BASE: EnvSource = {
    APP_ENV: 'test',
    DATABASE_URL: `postgres://ship11_test:${SECRET}@127.0.0.1:5433/ship11_test`,
  };
  const ADMIN_ENABLED: EnvSource = {
    ADMIN_AUTH_ENABLED: 'true',
    ADMIN_AUTH_ALLOWED_ORIGINS: '["https://admin.example.test"]',
    ADMIN_RATE_LIMIT_HMAC_KEY: Buffer.alloc(32, 9).toString('base64'),
    ADMIN_RATE_LIMIT_KEY_ID: 'limiter-1',
    ADMIN_ACTIVATION_ORIGIN: 'https://admin.example.test',
  };
  const STAGING: EnvSource = { ...BASE, APP_ENV: 'staging', NODE_ENV: 'production', DB_SSL_CA: TEST_CA };

  function invalidOf(env: EnvSource): readonly string[] {
    const result = loadConfig(env);
    if (result.ok) {
      throw new Error('expected the configuration to be rejected');
    }
    return result.invalid;
  }

  it('is absent from the configuration by default and when "false"', () => {
    for (const env of [BASE, { ...BASE, ADMIN_WEB_STAGING_ENABLED: 'false' }]) {
      const result = loadConfig(env);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.config.adminWebHosting).toBeUndefined();
      }
    }
  });

  it('is present for staging with the administration module enabled', () => {
    const result = loadConfig({ ...STAGING, ...ADMIN_ENABLED, ADMIN_WEB_STAGING_ENABLED: 'true' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.adminWebHosting).toEqual({ enabled: true });
      expect(result.config.adminAuth).toBeDefined();
    }
  });

  it('stops startup for "true" without the administration module, naming only the variable', () => {
    expect(invalidOf({ ...STAGING, ADMIN_WEB_STAGING_ENABLED: 'true' })).toEqual([ADMIN_WEB_STAGING_ENABLED_VARIABLE]);
  });

  it('stops startup for "true" outside staging (test, development, production), never echoing a value', () => {
    for (const appEnv of ['test', 'development', 'production']) {
      const base = appEnv === 'production' ? { ...BASE, NODE_ENV: 'production', DB_SSL_CA: TEST_CA } : BASE;
      const invalid = invalidOf({ ...base, ...ADMIN_ENABLED, APP_ENV: appEnv, ADMIN_WEB_STAGING_ENABLED: 'true' });
      expect(invalid).toEqual([ADMIN_WEB_STAGING_ENABLED_VARIABLE]);
      expect(JSON.stringify(invalid)).not.toContain(SECRET);
    }
  });

  it('stops startup for an unknown value', () => {
    expect(invalidOf({ ...BASE, ADMIN_WEB_STAGING_ENABLED: 'maybe' })).toEqual([ADMIN_WEB_STAGING_ENABLED_VARIABLE]);
  });
});
