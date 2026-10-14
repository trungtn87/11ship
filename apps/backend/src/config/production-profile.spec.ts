import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createTestPki } from '../database/test-tls.fixture';
import { loadConfig } from './app-config';
import { EnvSource } from './admin-auth-config';

// The real operating build (Owner decision 2026-10-14): APP_ENV=production on the VPS, loopback bind behind nginx. These tests
// load the COMPLETE production variable set through loadConfig and prove (1) it is accepted and every production feature is
// really switched on, and (2) each guard still refuses the wrong shape — a missing trust input, a non-loopback bind, a test or
// fixture mode, a missing gateway — naming only variables, never a value.

const SECRET = 'SECRET_MARKER_PRODUCTION_PROFILE_91';
const SIGNER = 'ab'.repeat(32);

describe('production profile (APP_ENV=production, loopback bind)', () => {
  let dir: string;
  let production: EnvSource;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'prod-profile-'));
    const ca = createTestPki().caPem;
    writeFileSync(path.join(dir, 'roots.pem'), ca);
    writeFileSync(
      path.join(dir, 'signers.json'),
      JSON.stringify({
        FOOD: { package_name: 'vn.eleven.food.test', signer_sha256: SIGNER },
        SHIP: { package_name: 'vn.eleven.ship.test', signer_sha256: SIGNER },
      }),
    );
    writeFileSync(path.join(dir, 'revocation.json'), JSON.stringify({ fetched_at: '2026-10-14T00:00:00Z', entries: {} }));
    production = {
      APP_ENV: 'production',
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: '3000',
      DATABASE_URL: `postgres://ship11_app:${SECRET}@localhost:5432/ship11_staging`,
      DB_SSL_CA: ca,
      AUTH_OTP_HMAC_SECRET: Buffer.alloc(32, 3).toString('base64'),
      CRYPTO_ACTIVE_KEY_ID: 'prod-1',
      CRYPTO_KEYRING: `prod-1:${Buffer.alloc(32, 4).toString('base64')}`,
      ADMIN_WEB_STAGING_ENABLED: 'true',
      ADMIN_AUTH_ENABLED: 'true',
      ADMIN_AUTH_ALLOWED_ORIGINS: '["https://103.9.78.67.sslip.io"]',
      ADMIN_ACTIVATION_ORIGIN: 'https://103.9.78.67.sslip.io',
      ADMIN_AUTH_TRUSTED_PROXY_IPS: '["127.0.0.1"]',
      ADMIN_RATE_LIMIT_KEY_ID: 'prod-1',
      ADMIN_RATE_LIMIT_HMAC_KEY: Buffer.alloc(32, 9).toString('base64'),
      ADMIN_ACTIVATION_ENABLED: 'true',
      ADMIN_ACTIVATION_OTP_MODE: 'SMS',
      ADMIN_USER_ACCOUNT_MUTATIONS_ENABLED: 'true',
      SMS_GATEWAY_ENABLED: 'true',
      SMS_GATEWAY_ALLOWLIST: '0912345678',
      ACCOUNT_RECOVERY_MODE: 'SMS_OTP',
      CLIENT_AUTH_TERMS_VERSION: '2026-10-14',
      CLIENT_AUTH_PRIVACY_VERSION: '2026-10-14',
      CLIENT_AUTH_ANDROID_ENABLED: 'true',
      CLIENT_DEVICE_ENVIRONMENT: 'production',
      CLIENT_DEVICE_ALLOWED_SIGNERS_FILE: path.join(dir, 'signers.json'),
      CLIENT_DEVICE_ATTESTATION_ROOTS_FILE: path.join(dir, 'roots.pem'),
      CLIENT_DEVICE_ATTESTATION_REVOCATION_FILE: path.join(dir, 'revocation.json'),
    };
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const invalidOf = (env: EnvSource): readonly string[] => {
    const result = loadConfig(env);
    if (result.ok) {
      throw new Error('expected the configuration to be rejected');
    }
    expect(JSON.stringify(result.invalid)).not.toContain(SECRET);
    return result.invalid;
  };

  it('is accepted, with every production feature really switched on and no test/fixture mode', () => {
    const result = loadConfig(production);
    if (!result.ok) {
      throw new Error(`rejected: ${result.invalid.join(',')}`);
    }
    const { config } = result;
    expect(config.appEnv).toBe('production');
    expect(config.adminWebHosting).toEqual({ enabled: true });
    expect(config.adminUserAccountMutations).toEqual({ enabled: true });
    expect(config.adminActivation).toMatchObject({ phoneVerificationMode: 'REQUIRED', otpMode: 'SMS' });
    expect(config.smsGateway?.recipientMode).toBe('ALLOWLIST');
    expect(config.accountRecoveryMode).toBe('SMS_OTP');
    expect(config.clientAuth).toEqual({ termsVersion: '2026-10-14', privacyVersion: '2026-10-14' });
    expect(config.clientPhoneVerificationMode).toBeUndefined(); // absent = REQUIRED (no DISABLED_TEST)
    expect(config.clientAndroid?.signers.FOOD.signerSha256).toBe(SIGNER);
    expect(config.clientAndroid?.attestationRoots.length).toBeGreaterThan(0);
    expect(config.stagingFixtures).toBeUndefined();
    expect(config.testInbox).toBeUndefined();
    expect(config.database.tls).toBeDefined();
  });

  it.each([
    ['CLIENT_DEVICE_ALLOWED_SIGNERS_FILE'],
    ['CLIENT_DEVICE_ATTESTATION_ROOTS_FILE'],
    ['CLIENT_DEVICE_ATTESTATION_REVOCATION_FILE'],
    ['CLIENT_DEVICE_ENVIRONMENT'],
  ])('refuses native Android binding without %s (no fixture, no accept-all)', (name) => {
    const env = { ...production };
    delete env[name];
    expect(invalidOf(env)).toEqual([name]);
  });

  it('refuses the binding on a non-loopback bind and in staging', () => {
    expect(invalidOf({ ...production, HOST: '0.0.0.0' })).toEqual(expect.arrayContaining(['CLIENT_AUTH_ANDROID_ENABLED']));
    expect(invalidOf({ ...production, APP_ENV: 'staging' })).toEqual(expect.arrayContaining(['CLIENT_AUTH_ANDROID_ENABLED']));
  });

  it('refuses every test, fixture and bypass switch in production', () => {
    for (const extra of [
      { CLIENT_AUTH_PHONE_VERIFICATION_MODE: 'DISABLED_TEST' },
      { ACCOUNT_RECOVERY_MODE: 'DISABLED_TEST' },
      { ADMIN_ACTIVATION_PHONE_VERIFICATION_MODE: 'DISABLED_TEST' },
      { ADMIN_ACTIVATION_OTP_MODE: 'FAKE' },
      { ADMIN_ACTIVATION_OTP_MODE: 'TEST_DISPLAY' },
      { AUTH_STAGING_FIXTURES_ENABLED: 'true', AUTH_STAGING_ALLOWED_PHONES: '["+84912345678"]' },
    ]) {
      const names = invalidOf({ ...production, ...extra });
      expect(names.length).toBeGreaterThan(0);
    }
  });

  it('refuses the SMS modes without the gateway (no silent fallback, no bypass of the OTP)', () => {
    const env = { ...production };
    delete env.SMS_GATEWAY_ENABLED;
    delete env.SMS_GATEWAY_ALLOWLIST;
    expect(invalidOf(env)).toEqual(expect.arrayContaining(['ACCOUNT_RECOVERY_MODE', 'ADMIN_ACTIVATION_OTP_MODE']));
  });

  it('keeps database TLS mandatory', () => {
    const env = { ...production };
    delete env.DB_SSL_CA;
    expect(invalidOf(env)).toEqual(expect.arrayContaining(['DB_SSL_CA']));
    expect(invalidOf({ ...production, NODE_TLS_REJECT_UNAUTHORIZED: '0' }).length).toBeGreaterThan(0);
  });

  it('keeps the Admin web, the USER lock and the activation behind the administration module', () => {
    const env = { ...production };
    for (const name of Object.keys(env).filter((key) => key.startsWith('ADMIN_AUTH_') || key.startsWith('ADMIN_RATE_LIMIT') || key === 'ADMIN_ACTIVATION_ORIGIN')) {
      delete env[name];
    }
    expect(invalidOf(env)).toEqual(expect.arrayContaining(['ADMIN_WEB_STAGING_ENABLED', 'ADMIN_USER_ACCOUNT_MUTATIONS_ENABLED', 'ADMIN_ACTIVATION_ENABLED']));
  });
});
