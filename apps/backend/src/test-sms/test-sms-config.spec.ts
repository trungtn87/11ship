import { describe, expect, it } from '@jest/globals';
import { loadConfig } from '../config/app-config';
import { loadTestInboxConfig } from './test-sms-config';

const DB = 'postgres://ship11_dev:secret@127.0.0.1:5432/ship11_dev';

function load(
  env: Record<string, string | undefined>,
  appEnv: string | undefined,
  options: { host?: string; databaseUrl?: string | undefined; activationEnabled?: boolean } = {},
): ReturnType<typeof loadTestInboxConfig> {
  return loadTestInboxConfig({
    env,
    appEnv,
    host: options.host ?? '127.0.0.1',
    databaseUrl: 'databaseUrl' in options ? options.databaseUrl : DB,
    activationEnabled: options.activationEnabled ?? false,
  });
}

describe('loadTestInboxConfig (explicit TEST_INBOX, development/test, loopback only)', () => {
  it('is absent when nothing selects TEST_INBOX, whatever APP_ENV is: no listener just because of APP_ENV', () => {
    for (const appEnv of ['development', 'test', 'staging', 'production']) {
      expect(load({}, appEnv)).toEqual({ ok: true, config: undefined });
    }
    expect(load({ ADMIN_ACTIVATION_OTP_MODE: 'FAKE' }, 'development', { activationEnabled: true })).toEqual({ ok: true, config: undefined });
    expect(load({ ADMIN_ACTIVATION_OTP_MODE: 'TEST_DISPLAY' }, 'test', { activationEnabled: true })).toEqual({ ok: true, config: undefined });
  });

  it('OTP_PROVIDER=TEST_INBOX selects REGISTER in development and test', () => {
    for (const appEnv of ['development', 'test']) {
      expect(load({ OTP_PROVIDER: 'TEST_INBOX' }, appEnv)).toEqual({ ok: true, config: { register: true, activation: false } });
    }
  });

  it('ADMIN_ACTIVATION_OTP_MODE=TEST_INBOX selects the activation only when the activation is enabled', () => {
    expect(load({ ADMIN_ACTIVATION_OTP_MODE: 'TEST_INBOX' }, 'development', { activationEnabled: true })).toEqual({
      ok: true,
      config: { register: false, activation: true },
    });
    // Disabled activation: nothing would feed the inbox, so nothing opens.
    expect(load({ ADMIN_ACTIVATION_OTP_MODE: 'TEST_INBOX' }, 'development', { activationEnabled: false })).toEqual({ ok: true, config: undefined });
  });

  it('shares ONE inbox config when both channels select it', () => {
    expect(load({ OTP_PROVIDER: 'TEST_INBOX', ADMIN_ACTIVATION_OTP_MODE: 'TEST_INBOX' }, 'test', { activationEnabled: true })).toEqual({
      ok: true,
      config: { register: true, activation: true },
    });
  });

  it('refuses every TEST_INBOX selection in staging and production, naming only the selecting variable', () => {
    for (const appEnv of ['staging', 'production']) {
      expect(load({ OTP_PROVIDER: 'TEST_INBOX' }, appEnv)).toEqual({ ok: false, invalid: ['OTP_PROVIDER'] });
      expect(load({ ADMIN_ACTIVATION_OTP_MODE: 'TEST_INBOX' }, appEnv, { activationEnabled: true })).toEqual({
        ok: false,
        invalid: ['ADMIN_ACTIVATION_OTP_MODE'],
      });
      // Even when the activation is disabled: a TEST_INBOX selection is never silently ignored outside local.
      expect(load({ ADMIN_ACTIVATION_OTP_MODE: 'TEST_INBOX' }, appEnv, { activationEnabled: false })).toEqual({
        ok: false,
        invalid: ['ADMIN_ACTIVATION_OTP_MODE'],
      });
      expect(load({ OTP_PROVIDER: 'TEST_INBOX', ADMIN_ACTIVATION_OTP_MODE: 'TEST_INBOX' }, appEnv, { activationEnabled: true })).toEqual({
        ok: false,
        invalid: ['OTP_PROVIDER', 'ADMIN_ACTIVATION_OTP_MODE'],
      });
    }
  });

  it('rejects any other OTP_PROVIDER value by name only (a new variable: no other value has a meaning)', () => {
    for (const value of ['FAKE', 'SMS', '', 'test_inbox', 'TEST_INBOX ']) {
      expect(load({ OTP_PROVIDER: value }, 'development')).toEqual({ ok: false, invalid: ['OTP_PROVIDER'] });
    }
  });

  it('requires a loopback API host and a loopback database (the local target guard)', () => {
    for (const host of ['0.0.0.0', '::', '192.168.1.5', 'example.com', '10.0.0.4']) {
      const result = load({ OTP_PROVIDER: 'TEST_INBOX' }, 'development', { host });
      expect(result).toEqual({ ok: false, invalid: ['HOST', 'OTP_PROVIDER'] });
    }
    for (const host of ['127.0.0.1', 'localhost', '::1']) {
      expect(load({ OTP_PROVIDER: 'TEST_INBOX' }, 'test', { host }).ok).toBe(true);
    }
    expect(load({ OTP_PROVIDER: 'TEST_INBOX' }, 'development', { databaseUrl: 'postgres://u:p@db.example.com:5432/x' })).toEqual({
      ok: false,
      invalid: ['DATABASE_URL', 'OTP_PROVIDER'],
    });
    expect(load({ OTP_PROVIDER: 'TEST_INBOX' }, 'development', { databaseUrl: undefined })).toEqual({
      ok: false,
      invalid: ['DATABASE_URL', 'OTP_PROVIDER'],
    });
    expect(load({ OTP_PROVIDER: 'TEST_INBOX' }, 'development', { databaseUrl: 'postgres://u:p@[::1]:5432/x' }).ok).toBe(true);
  });

  it('never echoes a value of the environment', () => {
    const result = load({ OTP_PROVIDER: 'super-secret-value' }, 'development');
    expect(JSON.stringify(result)).not.toContain('super-secret-value');
  });
});

describe('loadConfig wiring of TEST_INBOX', () => {
  const base = { APP_ENV: 'development', DATABASE_URL: DB };

  it('leaves AppConfig.testInbox absent by default (no inbox, no listener)', () => {
    const result = loadConfig(base);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect('testInbox' in result.config).toBe(false);
    }
  });

  it('exposes testInbox only for an explicit local selection', () => {
    const result = loadConfig({ ...base, OTP_PROVIDER: 'TEST_INBOX' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.testInbox).toEqual({ register: true, activation: false });
    }
  });

  it('refuses staging with OTP_PROVIDER=TEST_INBOX before anything else, naming only the variable(s)', () => {
    const result = loadConfig({ APP_ENV: 'staging', DATABASE_URL: DB, OTP_PROVIDER: 'TEST_INBOX' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.invalid).toContain('OTP_PROVIDER');
      expect(result.invalid.join(',')).not.toContain('TEST_INBOX');
    }
  });

  it('refuses a non-loopback HOST with TEST_INBOX', () => {
    const result = loadConfig({ ...base, OTP_PROVIDER: 'TEST_INBOX', HOST: '0.0.0.0' });
    expect(result).toEqual({ ok: false, invalid: ['HOST', 'OTP_PROVIDER'] });
  });
});
