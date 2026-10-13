import { describe, expect, it } from '@jest/globals';
import { loadConfig } from './app-config';
import { ACCOUNT_RECOVERY_MODE_ENV, parseAccountRecoveryMode } from './account-recovery-config';

const NAME = ACCOUNT_RECOVERY_MODE_ENV;

describe('parseAccountRecoveryMode', () => {
  it('is closed when unset or UNAVAILABLE, in every environment', () => {
    for (const appEnv of ['development', 'test', 'staging', 'production']) {
      for (const modeRaw of [undefined, 'UNAVAILABLE']) {
        expect(parseAccountRecoveryMode({ appEnv, host: '127.0.0.1', modeRaw })).toEqual({ ok: true, mode: 'UNAVAILABLE' });
      }
    }
  });

  it('allows DISABLED_TEST only for development/test on a loopback bind', () => {
    for (const appEnv of ['development', 'test']) {
      for (const host of ['127.0.0.1', 'localhost', '::1']) {
        expect(parseAccountRecoveryMode({ appEnv, host, modeRaw: 'DISABLED_TEST' })).toEqual({ ok: true, mode: 'DISABLED_TEST' });
      }
    }
  });

  it('refuses DISABLED_TEST in staging, production and on a non-loopback bind, naming only the variable', () => {
    const refused = { ok: false, invalid: [NAME] };
    expect(parseAccountRecoveryMode({ appEnv: 'staging', host: '127.0.0.1', modeRaw: 'DISABLED_TEST' })).toEqual(refused);
    expect(parseAccountRecoveryMode({ appEnv: 'production', host: '127.0.0.1', modeRaw: 'DISABLED_TEST' })).toEqual(refused);
    expect(parseAccountRecoveryMode({ appEnv: 'test', host: '0.0.0.0', modeRaw: 'DISABLED_TEST' })).toEqual(refused);
    expect(parseAccountRecoveryMode({ appEnv: 'development', host: '10.0.0.5', modeRaw: 'DISABLED_TEST' })).toEqual(refused);
  });

  it('refuses any other value, including case variants and blanks', () => {
    for (const modeRaw of ['', 'disabled_test', 'REQUIRED', 'true', 'DISABLED_TEST ']) {
      expect(parseAccountRecoveryMode({ appEnv: 'test', host: '127.0.0.1', modeRaw })).toEqual({ ok: false, invalid: [NAME] });
    }
  });
});

describe('loadConfig ACCOUNT_RECOVERY_MODE', () => {
  const base = { DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/d' };

  it('production and staging stop startup with the variable name only', () => {
    for (const appEnv of ['production', 'staging']) {
      const result = loadConfig({ ...base, APP_ENV: appEnv, ACCOUNT_RECOVERY_MODE: 'DISABLED_TEST' });
      expect(result.ok).toBe(false);
      expect(result.ok ? [] : result.invalid).toContain(NAME);
    }
  });

  it('is absent from the config by default and present as DISABLED_TEST on local test', () => {
    const closed = loadConfig({ ...base, APP_ENV: 'test' });
    expect(closed.ok && closed.config.accountRecoveryMode).toBeFalsy();
    const open = loadConfig({ ...base, APP_ENV: 'test', ACCOUNT_RECOVERY_MODE: 'DISABLED_TEST' });
    expect(open.ok && open.config.accountRecoveryMode).toBe('DISABLED_TEST');
  });
});
