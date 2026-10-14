import { describe, expect, it } from '@jest/globals';
import { parseAccountRecoveryMode } from './account-recovery-config';
import { parseSmsGateway } from './sms-gateway-config';

const OK_ENV = { SMS_GATEWAY_ENABLED: 'true', SMS_GATEWAY_ALLOWLIST: '0912345678, +84987654321' };

describe('parseSmsGateway (issue #102)', () => {
  it('is OFF by default: unset or false produces no configuration at all', () => {
    expect(parseSmsGateway({ env: {} })).toEqual({ ok: true, config: undefined });
    expect(parseSmsGateway({ env: { SMS_GATEWAY_ENABLED: 'false' } })).toEqual({ ok: true, config: undefined });
    // Other settings alone never switch it on.
    expect(parseSmsGateway({ env: { SMS_GATEWAY_RECIPIENT_MODE: 'OPEN' } })).toEqual({ ok: true, config: undefined });
  });

  it('refuses any other enable value, naming only the variable', () => {
    for (const value of ['TRUE', '1', 'yes', '', 'on']) {
      expect(parseSmsGateway({ env: { SMS_GATEWAY_ENABLED: value } })).toEqual({ ok: false, invalid: ['SMS_GATEWAY_ENABLED'] });
    }
  });

  it('defaults to the ALLOWLIST recipient mode with the low Owner-test limits and normalizes the numbers', () => {
    const result = parseSmsGateway({ env: OK_ENV });
    expect(result.ok).toBe(true);
    if (!result.ok || result.config === undefined) {
      throw new Error('expected a configuration');
    }
    expect(result.config.recipientMode).toBe('ALLOWLIST');
    expect([...result.config.allowlist].sort()).toEqual(['+84912345678', '+84987654321']);
    expect([result.config.limitPhonePerHour, result.config.limitPhonePerDay, result.config.limitGlobalPerDay]).toEqual([3, 5, 30]);
    expect([result.config.onlineWindowSeconds, result.config.leaseSeconds, result.config.pollSeconds]).toEqual([90, 60, 5]);
  });

  it('needs a non-empty valid allowlist unless the recipient mode is explicitly OPEN', () => {
    expect(parseSmsGateway({ env: { SMS_GATEWAY_ENABLED: 'true' } })).toEqual({ ok: false, invalid: ['SMS_GATEWAY_ALLOWLIST'] });
    expect(parseSmsGateway({ env: { SMS_GATEWAY_ENABLED: 'true', SMS_GATEWAY_ALLOWLIST: '0912345678,12345' } })).toEqual({
      ok: false,
      invalid: ['SMS_GATEWAY_ALLOWLIST'],
    });
    expect(parseSmsGateway({ env: { SMS_GATEWAY_ENABLED: 'true', SMS_GATEWAY_ALLOWLIST: '' } })).toEqual({ ok: false, invalid: ['SMS_GATEWAY_ALLOWLIST'] });
    const open = parseSmsGateway({ env: { SMS_GATEWAY_ENABLED: 'true', SMS_GATEWAY_RECIPIENT_MODE: 'OPEN' } });
    expect(open.ok && open.config?.recipientMode).toBe('OPEN');
    expect(parseSmsGateway({ env: { ...OK_ENV, SMS_GATEWAY_RECIPIENT_MODE: 'ALL' } })).toEqual({ ok: false, invalid: ['SMS_GATEWAY_RECIPIENT_MODE'] });
  });

  it('bounds every number and never echoes a value', () => {
    for (const [name, value] of [
      ['SMS_GATEWAY_LIMIT_PHONE_PER_HOUR', '0'],
      ['SMS_GATEWAY_LIMIT_PHONE_PER_DAY', '-1'],
      ['SMS_GATEWAY_LIMIT_GLOBAL_PER_DAY', '1e3'],
      ['SMS_GATEWAY_ONLINE_WINDOW_SECONDS', '5'],
      ['SMS_GATEWAY_LEASE_SECONDS', '1000'],
      ['SMS_GATEWAY_POLL_SECONDS', '1'],
    ] as const) {
      const result = parseSmsGateway({ env: { ...OK_ENV, [name]: value } });
      expect(result).toEqual({ ok: false, invalid: [name] });
      expect(JSON.stringify(result)).not.toContain(value === '0' ? '"0"' : value);
    }
    expect(JSON.stringify(parseSmsGateway({ env: { SMS_GATEWAY_ENABLED: 'true', SMS_GATEWAY_ALLOWLIST: '0912345678,bad' } }))).not.toContain('0912345678');
  });
});

describe('ACCOUNT_RECOVERY_MODE=SMS_OTP (issue #102)', () => {
  it('is accepted only with the real SMS gateway configured, in every environment', () => {
    for (const appEnv of ['development', 'test', 'staging', 'production']) {
      expect(parseAccountRecoveryMode({ appEnv, host: '0.0.0.0', modeRaw: 'SMS_OTP', smsGatewayEnabled: true })).toEqual({ ok: true, mode: 'SMS_OTP' });
      expect(parseAccountRecoveryMode({ appEnv, host: '0.0.0.0', modeRaw: 'SMS_OTP' })).toEqual({ ok: false, invalid: ['ACCOUNT_RECOVERY_MODE'] });
      expect(parseAccountRecoveryMode({ appEnv, host: '0.0.0.0', modeRaw: 'SMS_OTP', smsGatewayEnabled: false })).toEqual({ ok: false, invalid: ['ACCOUNT_RECOVERY_MODE'] });
    }
  });

  it('does not loosen DISABLED_TEST: still development/test on loopback only, even when the gateway is on', () => {
    expect(parseAccountRecoveryMode({ appEnv: 'production', host: '127.0.0.1', modeRaw: 'DISABLED_TEST', smsGatewayEnabled: true })).toEqual({
      ok: false,
      invalid: ['ACCOUNT_RECOVERY_MODE'],
    });
    expect(parseAccountRecoveryMode({ appEnv: 'staging', host: '127.0.0.1', modeRaw: 'DISABLED_TEST', smsGatewayEnabled: true }).ok).toBe(false);
  });
});
