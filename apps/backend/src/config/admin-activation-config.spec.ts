import { describe, expect, it } from '@jest/globals';
import { loadAdminActivationConfig } from './admin-activation-config';

describe('loadAdminActivationConfig', () => {
  it('is disabled by default and ignores every other variable', () => {
    expect(loadAdminActivationConfig({}, 'test', true)).toEqual({ ok: true, config: undefined });
    expect(loadAdminActivationConfig({ ADMIN_ACTIVATION_ENABLED: 'false', ADMIN_ACTIVATION_OTP_MODE: 'bogus' }, 'test', true)).toEqual({
      ok: true,
      config: undefined,
    });
  });

  it('refuses anything but true/false, and refuses true without the administration module', () => {
    expect(loadAdminActivationConfig({ ADMIN_ACTIVATION_ENABLED: 'yes' }, 'test', true)).toEqual({ ok: false, invalid: ['ADMIN_ACTIVATION_ENABLED'] });
    expect(loadAdminActivationConfig({ ADMIN_ACTIVATION_ENABLED: 'true', ADMIN_ACTIVATION_OTP_MODE: 'FAKE' }, 'test', false)).toEqual({
      ok: false,
      invalid: ['ADMIN_ACTIVATION_ENABLED'],
    });
  });

  it('needs an explicit OTP mode: there is no default and no fallback', () => {
    expect(loadAdminActivationConfig({ ADMIN_ACTIVATION_ENABLED: 'true' }, 'test', true)).toEqual({
      ok: false,
      invalid: ['ADMIN_ACTIVATION_OTP_MODE'],
    });
    expect(loadAdminActivationConfig({ ADMIN_ACTIVATION_ENABLED: 'true', ADMIN_ACTIVATION_OTP_MODE: 'fake' }, 'test', true)).toEqual({
      ok: false,
      invalid: ['ADMIN_ACTIVATION_OTP_MODE'],
    });
  });

  it('allows the test modes only in development / test', () => {
    for (const mode of ['FAKE', 'TEST_DISPLAY']) {
      for (const env of ['development', 'test']) {
        expect(loadAdminActivationConfig({ ADMIN_ACTIVATION_ENABLED: 'true', ADMIN_ACTIVATION_OTP_MODE: mode }, env, true).ok).toBe(true);
      }
      for (const env of ['staging', 'production', undefined]) {
        expect(loadAdminActivationConfig({ ADMIN_ACTIVATION_ENABLED: 'true', ADMIN_ACTIVATION_OTP_MODE: mode }, env, true)).toEqual({
          ok: false,
          invalid: ['ADMIN_ACTIVATION_OTP_MODE'],
        });
      }
    }
  });

  it('accepts SMS as a mode (the missing adapter stops startup at binding, not here)', () => {
    expect(loadAdminActivationConfig({ ADMIN_ACTIVATION_ENABLED: 'true', ADMIN_ACTIVATION_OTP_MODE: 'SMS' }, 'production', true)).toEqual({
      ok: true,
      config: { otpMode: 'SMS', providerTimeoutMs: 8000, promoteGraceMs: 10_000 },
    });
  });

  it('reads the two tunables within hard bounds and reports names only', () => {
    const base = { ADMIN_ACTIVATION_ENABLED: 'true', ADMIN_ACTIVATION_OTP_MODE: 'FAKE' };
    expect(
      loadAdminActivationConfig({ ...base, ADMIN_ACTIVATION_OTP_PROVIDER_TIMEOUT_MS: '2000', ADMIN_ACTIVATION_OTP_PROMOTE_GRACE_MS: '5000' }, 'test', true),
    ).toEqual({ ok: true, config: { otpMode: 'FAKE', providerTimeoutMs: 2000, promoteGraceMs: 5000 } });
    for (const bad of ['0', '-1', '1.5', '499', '30001', ' 8000', '8e3', 'abc', '']) {
      const result = loadAdminActivationConfig({ ...base, ADMIN_ACTIVATION_OTP_PROVIDER_TIMEOUT_MS: bad }, 'test', true);
      expect(result).toEqual({ ok: false, invalid: ['ADMIN_ACTIVATION_OTP_PROVIDER_TIMEOUT_MS'] });
    }
    for (const bad of ['999', '60001']) {
      expect(loadAdminActivationConfig({ ...base, ADMIN_ACTIVATION_OTP_PROMOTE_GRACE_MS: bad }, 'test', true)).toEqual({
        ok: false,
        invalid: ['ADMIN_ACTIVATION_OTP_PROMOTE_GRACE_MS'],
      });
    }
  });
});
