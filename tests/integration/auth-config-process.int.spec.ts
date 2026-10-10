import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from '@jest/globals';
import { FIXTURE_KEYRING_ENV } from '../../apps/backend/src/crypto/test-keys.fixture';
import { createTestPki } from '../../apps/backend/src/database/test-tls.fixture';
import { COMPILED_MAIN, minimalChildEnv } from './support/test-helpers';

// M01-A1 section 9: the real compiled entry point refuses invalid Auth configuration with a nonzero exit,
// names ONLY the offending variables and never prints a value. Staging and production refuse to boot because
// no production OTP provider exists yet (only OTP_PROVIDER is named). Every case is invalid, so the server
// never starts or hangs.
function startMain(env: Record<string, string | undefined>) {
  return spawnSync(process.execPath, [COMPILED_MAIN], {
    env: minimalChildEnv(env),
    encoding: 'utf8',
    timeout: 30_000,
  });
}

describe('M01-A1 — Auth configuration stops the process and leaks nothing', () => {
  const SECRET = 'SECRET_MARKER_M01A1_CFG_7a41';
  const base = {
    APP_ENV: 'test',
    DATABASE_URL: `postgres://ship11_test:${SECRET}@127.0.0.1:5433/ship11_test`,
  };
  const validSecret = randomBytes(32).toString('base64');
  const AUTH_NAMES = [
    'AUTH_OTP_TTL_SECONDS',
    'AUTH_OTP_RESEND_SECONDS',
    'AUTH_OTP_MAX_ATTEMPTS',
    'AUTH_PROOF_TTL_SECONDS',
    'AUTH_SESSION_TTL_SECONDS',
    'AUTH_OTP_HMAC_SECRET',
  ];

  it.each([
    ['AUTH_OTP_TTL_SECONDS', '29'],
    ['AUTH_OTP_TTL_SECONDS', '601'],
    ['AUTH_OTP_RESEND_SECONDS', '0'],
    ['AUTH_OTP_RESEND_SECONDS', '301'],
    ['AUTH_OTP_MAX_ATTEMPTS', '0'],
    ['AUTH_OTP_MAX_ATTEMPTS', '11'],
    ['AUTH_PROOF_TTL_SECONDS', '59'],
    ['AUTH_PROOF_TTL_SECONDS', '1801'],
    ['AUTH_SESSION_TTL_SECONDS', '299'],
    ['AUTH_SESSION_TTL_SECONDS', '2592001'],
  ])('exits nonzero for %s=%s and names only that variable', (name, value) => {
    const result = startMain({ ...base, [name]: value, AUTH_OTP_HMAC_SECRET: validSecret });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(name);
    for (const other of AUTH_NAMES.filter((n) => n !== name)) {
      expect(result.stderr).not.toContain(other);
    }
    expect(result.stderr).not.toContain('DATABASE_URL');
    expect(result.stderr).not.toContain(`=${value}`);
    expect(result.stderr).not.toContain(validSecret);
    expect(result.stderr).not.toContain(SECRET);
    expect(result.stdout).not.toContain(SECRET);
  });

  it.each([
    ['too short', Buffer.alloc(31, 1).toString('base64')],
    ['too long', Buffer.alloc(33, 1).toString('base64')],
    ['not base64', `${SECRET}!!!`],
    ['empty', ''],
  ])('exits nonzero for a malformed AUTH_OTP_HMAC_SECRET (%s), naming only it and never the value', (_label, value) => {
    const result = startMain({ ...base, AUTH_OTP_HMAC_SECRET: value });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('AUTH_OTP_HMAC_SECRET');
    for (const other of AUTH_NAMES.filter((n) => n !== 'AUTH_OTP_HMAC_SECRET')) {
      expect(result.stderr).not.toContain(other);
    }
    if (value !== '') {
      expect(result.stderr).not.toContain(value);
    }
    expect(result.stderr).not.toContain(SECRET);
    expect(result.stdout).not.toContain(SECRET);
  });

  it('refuses to start without AUTH_OTP_HMAC_SECRET and names only that variable', () => {
    const result = startMain({
      ...base,
      CRYPTO_KEYRING: FIXTURE_KEYRING_ENV,
      CRYPTO_ACTIVE_KEY_ID: 'k1',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('AUTH_OTP_HMAC_SECRET');
    expect(result.stderr).not.toContain('CRYPTO');
    expect(result.stderr).not.toContain('DATABASE_URL');
    expect(result.stderr).not.toContain(SECRET);
    expect(result.stdout).not.toContain(SECRET);
  });

  it.each(['staging', 'production'])(
    'refuses to boot in APP_ENV=%s because no OTP provider exists, naming only OTP_PROVIDER',
    (appEnv) => {
      const result = startMain({
        ...base,
        APP_ENV: appEnv,
        // Staging/production also refuse to start without a database CA (M00-D1). Supplying one lets this case
        // reach the OTP gate it is about, which is evaluated after the configuration is accepted.
        DB_SSL_CA: createTestPki().caPem,
        AUTH_OTP_HMAC_SECRET: validSecret,
        CRYPTO_KEYRING: FIXTURE_KEYRING_ENV,
        CRYPTO_ACTIVE_KEY_ID: 'k1',
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('OTP_PROVIDER');
      for (const name of AUTH_NAMES) {
        expect(result.stderr).not.toContain(name);
      }
      expect(result.stderr).not.toContain('DATABASE_URL');
      expect(result.stderr).not.toContain(validSecret);
      expect(result.stderr).not.toContain(SECRET);
      expect(result.stdout).not.toContain('server_listening');
    },
  );

  // M00-D2: the staging fixture mode switch is validated at startup, names only its own variable, never a value.
  describe('M00-D2 staging fixture mode', () => {
    const PHONE = '+84901234567';
    const stagingEnv = (extra: Record<string, string | undefined>) => ({
      ...base,
      APP_ENV: 'staging',
      DB_SSL_CA: createTestPki().caPem,
      AUTH_OTP_HMAC_SECRET: validSecret,
      CRYPTO_KEYRING: FIXTURE_KEYRING_ENV,
      CRYPTO_ACTIVE_KEY_ID: 'k1',
      ...extra,
    });

    it('production refuses AUTH_STAGING_FIXTURES_ENABLED=true and names only that variable', () => {
      const result = startMain(
        stagingEnv({ APP_ENV: 'production', AUTH_STAGING_FIXTURES_ENABLED: 'true', AUTH_STAGING_ALLOWED_PHONES: JSON.stringify([PHONE]) }),
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('AUTH_STAGING_FIXTURES_ENABLED');
      expect(result.stderr).not.toContain(PHONE);
      expect(result.stderr).not.toContain(SECRET);
      expect(result.stdout).not.toContain('server_listening');
    });

    it.each([
      ['staging with the mode on and no allowlist', { AUTH_STAGING_FIXTURES_ENABLED: 'true' }],
      ['staging with the mode on and an empty allowlist', { AUTH_STAGING_FIXTURES_ENABLED: 'true', AUTH_STAGING_ALLOWED_PHONES: '[]' }],
      ['staging with the mode off and an allowlist present', { AUTH_STAGING_FIXTURES_ENABLED: 'false', AUTH_STAGING_ALLOWED_PHONES: JSON.stringify([PHONE]) }],
      ['staging with a local-form phone in the allowlist', { AUTH_STAGING_FIXTURES_ENABLED: 'true', AUTH_STAGING_ALLOWED_PHONES: JSON.stringify(['0901234567']) }],
      ['staging with an unknown flag spelling', { AUTH_STAGING_FIXTURES_ENABLED: 'TRUE', AUTH_STAGING_ALLOWED_PHONES: JSON.stringify([PHONE]) }],
    ])('%s: exits 1 without echoing any value', (_name, extra) => {
      const result = startMain(stagingEnv(extra));
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/AUTH_STAGING_(FIXTURES_ENABLED|ALLOWED_PHONES)/);
      expect(result.stderr).not.toContain('0901234567');
      expect(result.stderr).not.toContain(PHONE);
      expect(result.stderr).not.toContain('DATABASE_URL');
      expect(result.stderr).not.toContain(validSecret);
      expect(result.stdout).not.toContain('server_listening');
    });
  });
});
