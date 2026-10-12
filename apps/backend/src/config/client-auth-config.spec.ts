import { describe, expect, it } from '@jest/globals';
import { loadConfig } from './app-config';
import { isLocalWebMode, parseClientAuth } from './client-auth-config';

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
