import { describe, expect, it } from '@jest/globals';
import { loadConfig } from './app-config';
import { isDisabledTestAllowed, isLocalWebMode, parseClientAuth, parseClientPhoneVerificationMode } from './client-auth-config';

// M01.03: the consent pair is configuration, fail-closed, local/test only, and only variable NAMES are ever reported.
const TERMS = 'test-terms-20261011-v1';
const PRIVACY = 'test-privacy-20261011-v1';

describe('parseClientAuth', () => {
  it('returns no config when both are unset (the endpoint stays closed)', () => {
    expect(parseClientAuth({ appEnv: 'test', termsRaw: undefined, privacyRaw: undefined })).toEqual({ ok: true, config: undefined });
    expect(parseClientAuth({ appEnv: 'production', termsRaw: undefined, privacyRaw: undefined })).toEqual({ ok: true, config: undefined });
  });

  it('accepts the approved pair in development and test', () => {
    for (const appEnv of ['development', 'test']) {
      expect(parseClientAuth({ appEnv, termsRaw: TERMS, privacyRaw: PRIVACY })).toEqual({
        ok: true,
        config: { termsVersion: TERMS, privacyVersion: PRIVACY },
      });
    }
  });

  it('refuses the variables in staging and production, naming only the set ones', () => {
    for (const appEnv of ['staging', 'production']) {
      expect(parseClientAuth({ appEnv, termsRaw: TERMS, privacyRaw: PRIVACY })).toEqual({
        ok: false,
        invalid: ['CLIENT_AUTH_TERMS_VERSION', 'CLIENT_AUTH_PRIVACY_VERSION'],
      });
      expect(parseClientAuth({ appEnv, termsRaw: TERMS, privacyRaw: undefined })).toEqual({ ok: false, invalid: ['CLIENT_AUTH_TERMS_VERSION'] });
    }
  });

  it('refuses one missing or malformed token without echoing a value', () => {
    expect(parseClientAuth({ appEnv: 'test', termsRaw: TERMS, privacyRaw: undefined })).toEqual({ ok: false, invalid: ['CLIENT_AUTH_PRIVACY_VERSION'] });
    expect(parseClientAuth({ appEnv: 'test', termsRaw: undefined, privacyRaw: PRIVACY })).toEqual({ ok: false, invalid: ['CLIENT_AUTH_TERMS_VERSION'] });
    for (const bad of ['', 'has space', 'x'.repeat(65), 'a/b', 'é']) {
      const result = parseClientAuth({ appEnv: 'test', termsRaw: bad, privacyRaw: PRIVACY });
      expect(result).toEqual({ ok: false, invalid: ['CLIENT_AUTH_TERMS_VERSION'] });
      expect(JSON.stringify(result)).not.toContain(bad === '' ? 'zzz-never' : bad);
    }
  });
});

describe('isLocalWebMode', () => {
  it('needs an explicit development/test environment AND a loopback bind', () => {
    expect(isLocalWebMode('test', '127.0.0.1')).toBe(true);
    expect(isLocalWebMode('development', 'localhost')).toBe(true);
    expect(isLocalWebMode('development', '0.0.0.0')).toBe(false);
    expect(isLocalWebMode('test', '192.168.1.5')).toBe(false);
    expect(isLocalWebMode('staging', '127.0.0.1')).toBe(false);
    expect(isLocalWebMode('production', '127.0.0.1')).toBe(false);
  });
});

describe('loadConfig client auth', () => {
  const base = {
    DATABASE_URL: 'postgres://u:p@127.0.0.1:5433/ship11_test',
    APP_ENV: 'test',
    AUTH_OTP_HMAC_SECRET: Buffer.alloc(32, 1).toString('base64'),
  };
  it('exposes the pair and rejects it outside development/test by variable name only', () => {
    const ok = loadConfig({ ...base, CLIENT_AUTH_TERMS_VERSION: TERMS, CLIENT_AUTH_PRIVACY_VERSION: PRIVACY });
    if (ok.ok) {
      expect(ok.config.clientAuth).toEqual({ termsVersion: TERMS, privacyVersion: PRIVACY });
    } else {
      expect(ok.invalid).not.toContain('CLIENT_AUTH_TERMS_VERSION');
    }
    const bad = loadConfig({ ...base, APP_ENV: 'production', CLIENT_AUTH_TERMS_VERSION: TERMS, CLIENT_AUTH_PRIVACY_VERSION: PRIVACY });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.invalid).toEqual(expect.arrayContaining(['CLIENT_AUTH_TERMS_VERSION', 'CLIENT_AUTH_PRIVACY_VERSION']));
    }
  });
});

describe('parseClientPhoneVerificationMode (CLIENT_AUTH_PHONE_VERIFICATION_MODE)', () => {
  const NAME = ['CLIENT_AUTH_PHONE_VERIFICATION_MODE'];

  it('defaults to REQUIRED when unset, in every environment', () => {
    for (const appEnv of ['development', 'test', 'staging', 'production', undefined]) {
      expect(parseClientPhoneVerificationMode({ appEnv, host: '0.0.0.0', modeRaw: undefined })).toEqual({ ok: true, mode: 'REQUIRED' });
    }
  });

  it('accepts an explicit REQUIRED anywhere', () => {
    for (const appEnv of ['development', 'test', 'staging', 'production']) {
      expect(parseClientPhoneVerificationMode({ appEnv, host: '0.0.0.0', modeRaw: 'REQUIRED' })).toEqual({ ok: true, mode: 'REQUIRED' });
    }
  });

  it('accepts DISABLED_TEST only in development/test on a loopback bind', () => {
    for (const appEnv of ['development', 'test']) {
      for (const host of ['127.0.0.1', 'localhost', '::1']) {
        expect(parseClientPhoneVerificationMode({ appEnv, host, modeRaw: 'DISABLED_TEST' })).toEqual({ ok: true, mode: 'DISABLED_TEST' });
      }
    }
    expect(isDisabledTestAllowed('test', '127.0.0.1')).toBe(true);
  });

  it('refuses DISABLED_TEST in staging and production, and on a non-loopback bind, naming only the variable', () => {
    for (const [appEnv, host] of [
      ['staging', '127.0.0.1'],
      ['production', '127.0.0.1'],
      ['development', '0.0.0.0'],
      ['test', '192.168.1.5'],
      ['test', '::'],
    ] as const) {
      expect(parseClientPhoneVerificationMode({ appEnv, host, modeRaw: 'DISABLED_TEST' })).toEqual({ ok: false, invalid: NAME });
    }
  });

  it('refuses any other value (case, spaces, empty, lookalikes) without echoing it', () => {
    for (const bad of ['', 'disabled_test', 'required', ' DISABLED_TEST', 'DISABLED_TEST ', 'OFF', 'true', 'NONE', 'DISABLED']) {
      const result = parseClientPhoneVerificationMode({ appEnv: 'test', host: '127.0.0.1', modeRaw: bad });
      expect(result).toEqual({ ok: false, invalid: NAME });
      expect(JSON.stringify(result)).not.toContain(bad === '' ? 'zzz-never' : bad.trim());
    }
  });

  it('leaves an invalid APP_ENV to its own report', () => {
    expect(parseClientPhoneVerificationMode({ appEnv: undefined, host: '127.0.0.1', modeRaw: 'DISABLED_TEST' })).toEqual({ ok: true, mode: 'REQUIRED' });
  });
});

describe('loadConfig phone verification mode', () => {
  const base = {
    DATABASE_URL: 'postgres://u:p@127.0.0.1:5433/ship11_test',
    APP_ENV: 'test',
    AUTH_OTP_HMAC_SECRET: Buffer.alloc(32, 1).toString('base64'),
  };

  it('carries no mode by default (REQUIRED) and DISABLED_TEST only when valid', () => {
    const none = loadConfig({ ...base });
    expect(none.ok).toBe(true);
    if (none.ok) {
      expect(none.config.clientPhoneVerificationMode).toBeUndefined();
    }
    const on = loadConfig({ ...base, CLIENT_AUTH_PHONE_VERIFICATION_MODE: 'DISABLED_TEST' });
    expect(on.ok).toBe(true);
    if (on.ok) {
      expect(on.config.clientPhoneVerificationMode).toBe('DISABLED_TEST');
    }
    const required = loadConfig({ ...base, CLIENT_AUTH_PHONE_VERIFICATION_MODE: 'REQUIRED' });
    expect(required.ok).toBe(true);
    if (required.ok) {
      expect(required.config.clientPhoneVerificationMode).toBeUndefined();
    }
  });

  it('stops startup for DISABLED_TEST in staging/production and for a non-loopback HOST, naming only the variable', () => {
    for (const env of [
      { APP_ENV: 'production' },
      { APP_ENV: 'staging' },
      { HOST: '0.0.0.0' },
      { HOST: '10.0.0.5' },
    ]) {
      const result = loadConfig({ ...base, ...env, CLIENT_AUTH_PHONE_VERIFICATION_MODE: 'DISABLED_TEST' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.invalid).toContain('CLIENT_AUTH_PHONE_VERIFICATION_MODE');
      }
    }
  });

  it('stops startup for an unknown value', () => {
    const result = loadConfig({ ...base, CLIENT_AUTH_PHONE_VERIFICATION_MODE: 'MAYBE' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.invalid).toContain('CLIENT_AUTH_PHONE_VERIFICATION_MODE');
    }
  });
});

describe('M01 VPS staging registration consent gate', () => {
  const staged = {
    appEnv: 'staging', host: '127.0.0.1',
    smsGatewayEnabled: true,
    phoneVerificationMode: 'REQUIRED',
    stagingFixturesEnabled: false,
    stagingConsentApprovedRaw: 'true',
    termsRaw: 'staging-terms-v1',
    privacyRaw: 'staging-privacy-v1',
  };

  it('accepts a separate approved staging pair only with real SMS and REQUIRED OTP', () => {
    expect(parseClientAuth(staged)).toEqual({
      ok: true,
      config: { termsVersion: 'staging-terms-v1', privacyVersion: 'staging-privacy-v1' },
    });
  });

  it('rejects missing approval, missing versions, test consent and every weaker transport/OTP setting', () => {
    const rejected = [
      { ...staged, stagingConsentApprovedRaw: undefined },
      { ...staged, stagingConsentApprovedRaw: 'yes' },
      { ...staged, termsRaw: undefined },
      { ...staged, privacyRaw: undefined },
      { ...staged, termsRaw: TERMS, privacyRaw: PRIVACY },
      { ...staged, smsGatewayEnabled: false },
      { ...staged, phoneVerificationMode: 'DISABLED_TEST' },
      { ...staged, stagingFixturesEnabled: true },
      { ...staged, host: '0.0.0.0' },
      { ...staged, appEnv: 'production' },
    ];
    for (const candidate of rejected) {
      expect(parseClientAuth(candidate).ok).toBe(false);
    }
  });

  it('keeps the registration endpoint closed when staging versions and approval are absent', () => {
    expect(parseClientAuth({ appEnv: 'staging', termsRaw: undefined, privacyRaw: undefined })).toEqual({
      ok: true, config: undefined,
    });
  });
});
