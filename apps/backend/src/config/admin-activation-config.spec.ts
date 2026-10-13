import { describe, expect, it } from '@jest/globals';
import {
  ACTIVATION_PHONE_VERIFICATION_MODE_ENV,
  DEFAULT_ACTIVATION_LIMITS,
  LIMIT_SPECS,
  loadAdminActivationConfig,
} from './admin-activation-config';

// The tests give the host explicitly: a loopback bind unless the case is about it.
const load = (env: Record<string, string | undefined>, appEnv: string | undefined, adminAuthEnabled: boolean, host = '127.0.0.1') =>
  loadAdminActivationConfig(env, appEnv, adminAuthEnabled, host);

describe('loadAdminActivationConfig', () => {
  it('is disabled by default and ignores every other variable', () => {
    expect(load({}, 'test', true)).toEqual({ ok: true, config: undefined });
    expect(load({ ADMIN_ACTIVATION_ENABLED: 'false', ADMIN_ACTIVATION_OTP_MODE: 'bogus' }, 'test', true)).toEqual({
      ok: true,
      config: undefined,
    });
  });

  it('refuses anything but true/false, and refuses true without the administration module', () => {
    expect(load({ ADMIN_ACTIVATION_ENABLED: 'yes' }, 'test', true)).toEqual({ ok: false, invalid: ['ADMIN_ACTIVATION_ENABLED'] });
    expect(load({ ADMIN_ACTIVATION_ENABLED: 'true', ADMIN_ACTIVATION_OTP_MODE: 'FAKE' }, 'test', false)).toEqual({
      ok: false,
      invalid: ['ADMIN_ACTIVATION_ENABLED'],
    });
  });

  it('needs an explicit OTP mode: there is no default and no fallback', () => {
    expect(load({ ADMIN_ACTIVATION_ENABLED: 'true' }, 'test', true)).toEqual({
      ok: false,
      invalid: ['ADMIN_ACTIVATION_OTP_MODE'],
    });
    expect(load({ ADMIN_ACTIVATION_ENABLED: 'true', ADMIN_ACTIVATION_OTP_MODE: 'fake' }, 'test', true)).toEqual({
      ok: false,
      invalid: ['ADMIN_ACTIVATION_OTP_MODE'],
    });
  });

  it('allows the test modes only in development / test', () => {
    for (const mode of ['FAKE', 'TEST_DISPLAY']) {
      for (const env of ['development', 'test']) {
        expect(load({ ADMIN_ACTIVATION_ENABLED: 'true', ADMIN_ACTIVATION_OTP_MODE: mode }, env, true).ok).toBe(true);
      }
      for (const env of ['staging', 'production', undefined]) {
        expect(load({ ADMIN_ACTIVATION_ENABLED: 'true', ADMIN_ACTIVATION_OTP_MODE: mode }, env, true)).toEqual({
          ok: false,
          invalid: ['ADMIN_ACTIVATION_OTP_MODE'],
        });
      }
    }
  });

  it('accepts SMS as a mode (the missing adapter stops startup at binding, not here)', () => {
    expect(load({ ADMIN_ACTIVATION_ENABLED: 'true', ADMIN_ACTIVATION_OTP_MODE: 'SMS' }, 'production', true)).toEqual({
      ok: true,
      config: { phoneVerificationMode: 'REQUIRED', otpMode: 'SMS', providerTimeoutMs: 8000, promoteGraceMs: 10_000, limits: DEFAULT_ACTIVATION_LIMITS },
    });
  });

  it('reads the two tunables within hard bounds and reports names only', () => {
    const base = { ADMIN_ACTIVATION_ENABLED: 'true', ADMIN_ACTIVATION_OTP_MODE: 'FAKE' };
    expect(
      load({ ...base, ADMIN_ACTIVATION_OTP_PROVIDER_TIMEOUT_MS: '2000', ADMIN_ACTIVATION_OTP_PROMOTE_GRACE_MS: '5000' }, 'test', true),
    ).toEqual({ ok: true, config: { phoneVerificationMode: 'REQUIRED', otpMode: 'FAKE', providerTimeoutMs: 2000, promoteGraceMs: 5000, limits: DEFAULT_ACTIVATION_LIMITS } });
    for (const bad of ['0', '-1', '1.5', '499', '30001', ' 8000', '8e3', 'abc', '']) {
      const result = load({ ...base, ADMIN_ACTIVATION_OTP_PROVIDER_TIMEOUT_MS: bad }, 'test', true);
      expect(result).toEqual({ ok: false, invalid: ['ADMIN_ACTIVATION_OTP_PROVIDER_TIMEOUT_MS'] });
    }
    for (const bad of ['999', '60001']) {
      expect(load({ ...base, ADMIN_ACTIVATION_OTP_PROMOTE_GRACE_MS: bad }, 'test', true)).toEqual({
        ok: false,
        invalid: ['ADMIN_ACTIVATION_OTP_PROMOTE_GRACE_MS'],
      });
    }
  });

  describe('phone verification mode (local test contract of 2026-10-13)', () => {
    const base = { ADMIN_ACTIVATION_ENABLED: 'true' };
    const disabled = { ...base, [ACTIVATION_PHONE_VERIFICATION_MODE_ENV]: 'DISABLED_TEST' };

    it('is REQUIRED when unset or REQUIRED, and then the OTP mode is still mandatory', () => {
      for (const extra of [{}, { [ACTIVATION_PHONE_VERIFICATION_MODE_ENV]: 'REQUIRED' }]) {
        expect(load({ ...base, ...extra }, 'test', true)).toEqual({ ok: false, invalid: ['ADMIN_ACTIVATION_OTP_MODE'] });
        expect(load({ ...base, ...extra, ADMIN_ACTIVATION_OTP_MODE: 'FAKE' }, 'test', true)).toMatchObject({
          ok: true,
          config: { phoneVerificationMode: 'REQUIRED', otpMode: 'FAKE' },
        });
      }
    });

    it('refuses every unknown value, by name only (case and spaces included)', () => {
      for (const bad of ['', 'disabled_test', 'DISABLED', 'TEST', ' REQUIRED', 'REQUIRED ', 'true', 'NONE']) {
        expect(load({ ...base, ADMIN_ACTIVATION_OTP_MODE: 'FAKE', [ACTIVATION_PHONE_VERIFICATION_MODE_ENV]: bad }, 'test', true)).toEqual({
          ok: false,
          invalid: [ACTIVATION_PHONE_VERIFICATION_MODE_ENV],
        });
      }
    });

    it('DISABLED_TEST is accepted in development/test on a loopback bind and needs no OTP mode or provider', () => {
      for (const appEnv of ['development', 'test']) {
        for (const host of ['127.0.0.1', 'localhost', '::1']) {
          expect(load(disabled, appEnv, true, host)).toEqual({
            ok: true,
            config: { phoneVerificationMode: 'DISABLED_TEST', otpMode: undefined, providerTimeoutMs: 8000, promoteGraceMs: 10_000, limits: DEFAULT_ACTIVATION_LIMITS },
          });
        }
      }
    });

    it('DISABLED_TEST does not read ADMIN_ACTIVATION_OTP_MODE at all (no test provider is chosen by it)', () => {
      for (const mode of ['FAKE', 'TEST_DISPLAY', 'TEST_INBOX', 'SMS', 'bogus']) {
        expect(load({ ...disabled, ADMIN_ACTIVATION_OTP_MODE: mode }, 'test', true)).toMatchObject({
          ok: true,
          config: { phoneVerificationMode: 'DISABLED_TEST', otpMode: undefined },
        });
      }
    });

    it('DISABLED_TEST is refused in staging, production and for a non-loopback bind', () => {
      for (const appEnv of ['staging', 'production']) {
        expect(load(disabled, appEnv, true)).toEqual({ ok: false, invalid: [ACTIVATION_PHONE_VERIFICATION_MODE_ENV] });
        expect(load({ ...disabled, ADMIN_ACTIVATION_OTP_MODE: 'SMS' }, appEnv, true)).toEqual({ ok: false, invalid: [ACTIVATION_PHONE_VERIFICATION_MODE_ENV] });
      }
      for (const host of ['0.0.0.0', '::', '192.168.1.20', '10.0.0.5', 'example.com', '']) {
        expect(load(disabled, 'development', true, host)).toEqual({ ok: false, invalid: [ACTIVATION_PHONE_VERIFICATION_MODE_ENV] });
        expect(load(disabled, 'test', true, host)).toEqual({ ok: false, invalid: [ACTIVATION_PHONE_VERIFICATION_MODE_ENV] });
      }
    });

    it('DISABLED_TEST needs the administration module like the activation itself, and is ignored while the activation is off', () => {
      expect(load(disabled, 'test', false)).toEqual({ ok: false, invalid: ['ADMIN_ACTIVATION_ENABLED'] });
      expect(load({ [ACTIVATION_PHONE_VERIFICATION_MODE_ENV]: 'DISABLED_TEST' }, 'production', true)).toEqual({ ok: true, config: undefined });
      expect(load({ ADMIN_ACTIVATION_ENABLED: 'false', [ACTIVATION_PHONE_VERIFICATION_MODE_ENV]: 'DISABLED_TEST' }, 'production', true)).toEqual({
        ok: true,
        config: undefined,
      });
    });

    it('an invalid APP_ENV is reported by its own variable, not by this one', () => {
      expect(load(disabled, undefined, true).ok).toBe(true);
    });
  });

  describe('section 7 TTLs and thresholds (section 16: configurable, defaults = section 7)', () => {
    const base = { ADMIN_ACTIVATION_ENABLED: 'true', ADMIN_ACTIVATION_OTP_MODE: 'FAKE' };
    const limitsOf = (extra: Record<string, string>) => {
      const result = load({ ...base, ...extra }, 'test', true);
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
        expect(load({ ...base, [env]: bad }, 'test', true)).toEqual({ ok: false, invalid: [env] });
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
        load({ ...base, ADMIN_ACTIVATION_OTP_TTL_SECONDS: '601', ADMIN_ACTIVATION_ATTEMPT_TTL_SECONDS: '3601' }, 'test', true),
      ).toEqual({ ok: false, invalid: ['ADMIN_ACTIVATION_ATTEMPT_TTL_SECONDS', 'ADMIN_ACTIVATION_OTP_TTL_SECONDS'] });
    });
  });
});
