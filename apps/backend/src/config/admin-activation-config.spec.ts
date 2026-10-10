import { describe, expect, it } from '@jest/globals';
import { DEFAULT_ACTIVATION_LIMITS, LIMIT_SPECS, loadAdminActivationConfig } from './admin-activation-config';

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
      config: { otpMode: 'SMS', providerTimeoutMs: 8000, promoteGraceMs: 10_000, limits: DEFAULT_ACTIVATION_LIMITS },
    });
  });

  it('reads the two tunables within hard bounds and reports names only', () => {
    const base = { ADMIN_ACTIVATION_ENABLED: 'true', ADMIN_ACTIVATION_OTP_MODE: 'FAKE' };
    expect(
      loadAdminActivationConfig({ ...base, ADMIN_ACTIVATION_OTP_PROVIDER_TIMEOUT_MS: '2000', ADMIN_ACTIVATION_OTP_PROMOTE_GRACE_MS: '5000' }, 'test', true),
    ).toEqual({ ok: true, config: { otpMode: 'FAKE', providerTimeoutMs: 2000, promoteGraceMs: 5000, limits: DEFAULT_ACTIVATION_LIMITS } });
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

  describe('section 7 TTLs and thresholds (section 16: configurable, defaults = section 7)', () => {
    const base = { ADMIN_ACTIVATION_ENABLED: 'true', ADMIN_ACTIVATION_OTP_MODE: 'FAKE' };
    const limitsOf = (extra: Record<string, string>) => {
      const result = loadAdminActivationConfig({ ...base, ...extra }, 'test', true);
      return result.ok && result.config !== undefined ? result.config.limits : undefined;
    };

    it('the defaults are exactly the section 7 table', () => {
      expect(DEFAULT_ACTIVATION_LIMITS).toEqual({
        attemptTtlSeconds: 30 * 60,
        otpTtlSeconds: 300,
        otpResendCooldownSeconds: 60,
        passwordDeadlineSeconds: 600,
        otpSendLimit: 5,
        otpSendWindowSeconds: 3600,
        requestLimit: 30,
        requestWindowSeconds: 60,
        linkFailureLimit: 10,
        linkFailureWindowSeconds: 15 * 60,
        linkFailureLockSeconds: 15 * 60,
        totpFailureWindowSeconds: 15 * 60,
        totpFailureLockSeconds: 15 * 60,
      });
      expect(limitsOf({})).toEqual(DEFAULT_ACTIVATION_LIMITS);
    });

    it('has one variable per value, each default inside its own range, and the schema ceilings of the DDL', () => {
      expect(new Set(LIMIT_SPECS.map((spec) => spec.env)).size).toBe(LIMIT_SPECS.length);
      for (const spec of LIMIT_SPECS) {
        expect(spec.fallback).toBeGreaterThanOrEqual(spec.min);
        expect(spec.fallback).toBeLessThanOrEqual(spec.max);
        expect(spec.env).toMatch(/^ADMIN_ACTIVATION_[A-Z_]+$/);
      }
      const schema = Object.fromEntries(LIMIT_SPECS.filter((spec) => spec.ceiling === 'SCHEMA').map((spec) => [spec.key, spec.max]));
      expect(schema).toEqual({ attemptTtlSeconds: 3600, otpTtlSeconds: 600 });
    });

    it.each(LIMIT_SPECS.map((spec) => [spec.env, spec] as const))('%s: boundaries min, max accepted; min-1, max+1, junk refused by NAME only', (env, spec) => {
      expect(limitsOf({ [env]: String(spec.min) })?.[spec.key]).toBe(spec.min);
      expect(limitsOf({ [env]: String(spec.max) })?.[spec.key]).toBe(spec.max);
      for (const bad of [String(spec.min - 1), String(spec.max + 1), '1.5', '-1', ' 5', '5 ', '1e2', 'abc', '']) {
        expect(loadAdminActivationConfig({ ...base, [env]: bad }, 'test', true)).toEqual({ ok: false, invalid: [env] });
      }
    });

    it('the per-attempt wrong-code limits (OTP 5, TOTP 5) and the TOTP bucket limit are not variables: the schema fixes them', () => {
      for (const name of ['ADMIN_ACTIVATION_OTP_WRONG_LIMIT', 'ADMIN_ACTIVATION_TOTP_WRONG_LIMIT', 'ADMIN_ACTIVATION_TOTP_FAILURE_LIMIT']) {
        expect(LIMIT_SPECS.some((spec) => spec.env === name)).toBe(false);
        expect(limitsOf({ [name]: '3' })).toEqual(DEFAULT_ACTIVATION_LIMITS);
      }
    });

    it('several invalid values are all named, in a stable order', () => {
      expect(
        loadAdminActivationConfig({ ...base, ADMIN_ACTIVATION_OTP_TTL_SECONDS: '601', ADMIN_ACTIVATION_ATTEMPT_TTL_SECONDS: '3601' }, 'test', true),
      ).toEqual({ ok: false, invalid: ['ADMIN_ACTIVATION_ATTEMPT_TTL_SECONDS', 'ADMIN_ACTIVATION_OTP_TTL_SECONDS'] });
    });
  });
});
