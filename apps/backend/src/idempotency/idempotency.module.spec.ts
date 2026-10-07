import { describe, expect, it } from '@jest/globals';
import { AppConfig, formatInvalidConfigMessage, loadConfig } from '../config/app-config';
import { describeStartupFailure } from '../config/startup-failure';
import { StartupConfigError } from '../config/startup-config-error';
import { FIXTURE_KEYRING_ENV } from '../crypto/test-keys.fixture';
import { requireKeyring } from './idempotency.module';

const SECRET = 'SECRET_MARKER_MODULE_6b1d';

function configWith(extra: Record<string, string>): AppConfig {
  const result = loadConfig({
    APP_ENV: 'test',
    DATABASE_URL: `postgres://ship11_test:${SECRET}@127.0.0.1:5433/ship11_test`,
    ...extra,
  });
  if (!result.ok) {
    throw new Error('expected the configuration to be accepted');
  }
  return result.config;
}

describe('requireKeyring: the keyring is mandatory where the executor is wired', () => {
  it('returns the keyring when it is configured', () => {
    const config = configWith({ CRYPTO_KEYRING: FIXTURE_KEYRING_ENV, CRYPTO_ACTIVE_KEY_ID: 'k2' });
    expect(requireKeyring(config).activeKeyId).toBe('k2');
  });

  it('stops startup with an error that names only the two variables', () => {
    const config = configWith({});
    let caught: unknown;
    try {
      requireKeyring(config);
    } catch (error) {
      caught = error;
    }
    expect(caught instanceof StartupConfigError).toBe(true);
    const error = caught as StartupConfigError;
    expect(error.invalid).toEqual(['CRYPTO_KEYRING', 'CRYPTO_ACTIVE_KEY_ID']);
    expect(error.message).toBe(formatInvalidConfigMessage(['CRYPTO_KEYRING', 'CRYPTO_ACTIVE_KEY_ID']));
    expect(error.message).not.toContain(SECRET);
    expect(error.message).not.toContain('DATABASE_URL');
  });
});

describe('describeStartupFailure', () => {
  it('prints the variable names of a StartupConfigError and nothing else', () => {
    expect(describeStartupFailure(new StartupConfigError(['CRYPTO_KEYRING']))).toBe(
      formatInvalidConfigMessage(['CRYPTO_KEYRING']),
    );
  });

  it('prints only a short allow-listed code for any other failure', () => {
    const line = describeStartupFailure(
      Object.assign(new Error(`postgres://u:${SECRET}@h/db`), { code: 'ECONNREFUSED' }),
    );
    expect(line).toBe('Startup failed (ECONNREFUSED).');
    expect(line).not.toContain(SECRET);
    expect(describeStartupFailure(new Error(SECRET))).toBe('Startup failed (UNKNOWN).');
  });
});
