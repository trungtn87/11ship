import { describe, expect, it } from '@jest/globals';
import { AppError, TechnicalError } from '../common/app-errors';
import { AppConfig } from '../config/app-config';
import {
  assertConsentSupported,
  assertDeviceAllowed,
  assertPlatformAllowed,
  ClientAuthSettings,
  clientAuthSettingsFrom,
} from './client-auth-policy';

const PAIR = { termsVersion: 'test-terms-20261011-v1', privacyVersion: 'test-privacy-20261011-v1' };
const LEGACY = { termsVersion: 'terms-20261014-v1', privacyVersion: 'privacy-20261017-v1' };
const OFFICIAL = { termsVersion: 'terms-20261114-v3', privacyVersion: 'privacy-20261114-v3' };
// Mixed pairs: each half is published, but the two halves come from different releases.
const CROSS_OFFICIAL_TERMS = { termsVersion: OFFICIAL.termsVersion, privacyVersion: LEGACY.privacyVersion };
const CROSS_LEGACY_TERMS = { termsVersion: LEGACY.termsVersion, privacyVersion: OFFICIAL.privacyVersion };
const web = { deviceId: 'd-1', platform: 'WEB', app: 'FOOD' } as const;
const android = { deviceId: 'd-2', platform: 'ANDROID', app: 'SHIP' } as const;

const settingsWith = (consent: ClientAuthSettings['consent'], localWeb = false): ClientAuthSettings => ({
  consent,
  phoneVerificationMode: 'REQUIRED',
  localWeb,
});

describe('assertDeviceAllowed', () => {
  it('accepts WEB only in LOCAL_WEB mode', () => {
    expect(() => assertDeviceAllowed({ consent: PAIR, phoneVerificationMode: 'REQUIRED', localWeb: true }, web)).not.toThrow();
    expect(() => assertDeviceAllowed({ consent: PAIR, phoneVerificationMode: 'REQUIRED', localWeb: false }, web)).toThrow(AppError);
    try {
      assertDeviceAllowed({ consent: PAIR, phoneVerificationMode: 'REQUIRED', localWeb: false }, web);
    } catch (error) {
      expect((error as AppError).code).toBe('DEVICE_PROOF_REQUIRED');
    }
  });

  it('accepts Android password authentication without a hardware verifier', () => {
    for (const localWeb of [true, false]) {
      expect(() => assertDeviceAllowed({ consent: PAIR, phoneVerificationMode: 'REQUIRED', localWeb }, android)).not.toThrow();
    }
  });
});

describe('assertPlatformAllowed (the platform recorded on a session)', () => {
  it('serves WEB only locally and allows Android without hardware trust', () => {
    expect(() => assertPlatformAllowed({ consent: PAIR, phoneVerificationMode: 'REQUIRED', localWeb: true }, 'WEB')).not.toThrow();
    expect(() => assertPlatformAllowed({ consent: PAIR, phoneVerificationMode: 'REQUIRED', localWeb: false }, 'WEB')).toThrow(AppError);
    for (const localWeb of [true, false]) {
      expect(() => assertPlatformAllowed({ consent: PAIR, phoneVerificationMode: 'REQUIRED', localWeb }, 'ANDROID')).not.toThrow();
    }
  });
});

describe('assertConsentSupported: only the two published pairs are ever accepted', () => {
  it('returns the configured pair on an exact match when it is a published pair', () => {
    for (const published of [LEGACY, OFFICIAL]) {
      expect(assertConsentSupported(settingsWith(published), published)).toEqual(published);
    }
  });

  it('refuses any mismatch (swapped, partial, other version) against a published configuration', () => {
    const settings = settingsWith(OFFICIAL);
    for (const consent of [
      { termsVersion: OFFICIAL.privacyVersion, privacyVersion: OFFICIAL.termsVersion },
      { termsVersion: OFFICIAL.termsVersion, privacyVersion: 'x' },
      { termsVersion: 'x', privacyVersion: OFFICIAL.privacyVersion },
    ]) {
      expect(() => assertConsentSupported(settings, consent)).toThrow(AppError);
    }
  });

  it('fails closed when no pair is configured', () => {
    expect(() => assertConsentSupported(settingsWith(undefined), OFFICIAL)).toThrow(TechnicalError);
  });

  // Regression: the exact-match branch used to return before the allowlist was checked, so an arbitrary or mixed pair in the
  // environment was accepted whenever the request repeated the same values, and user_consents stored that pair.
  it('a configured pair that is not published closes the endpoint, even when the request repeats it', () => {
    for (const configured of [PAIR, CROSS_OFFICIAL_TERMS, CROSS_LEGACY_TERMS]) {
      expect(() => assertConsentSupported(settingsWith(configured), configured)).toThrow(TechnicalError);
    }
  });

  it('an arbitrary configured pair opens no version, not even the published ones', () => {
    for (const consent of [PAIR, LEGACY, OFFICIAL]) {
      expect(() => assertConsentSupported(settingsWith(PAIR, true), consent)).toThrow(TechnicalError);
    }
  });
});

describe('approved consent version transition', () => {
  for (const configured of [LEGACY, OFFICIAL]) {
    it(`accepts either published pair while the server is configured with ${configured.termsVersion}`, () => {
      const settings = settingsWith(configured);
      expect(assertConsentSupported(settings, OFFICIAL)).toEqual(OFFICIAL);
      expect(assertConsentSupported(settings, LEGACY)).toEqual(LEGACY);
    });

    it(`refuses a mixed pair (cross-released halves) while configured with ${configured.termsVersion}`, () => {
      const settings = settingsWith(configured);
      for (const mixed of [CROSS_OFFICIAL_TERMS, CROSS_LEGACY_TERMS]) {
        let code: string | undefined;
        try {
          assertConsentSupported(settings, mixed);
        } catch (error) {
          code = (error as AppError).code;
        }
        expect(code).toBe('CONSENT_VERSION_UNSUPPORTED');
      }
    });
  }

  it('refuses a mixed pair even when the environment itself is configured with it', () => {
    for (const mixed of [CROSS_OFFICIAL_TERMS, CROSS_LEGACY_TERMS]) {
      expect(() => assertConsentSupported(settingsWith(mixed), mixed)).toThrow(TechnicalError);
      expect(() => assertConsentSupported(settingsWith(mixed), OFFICIAL)).toThrow(TechnicalError);
    }
  });
});

describe('clientAuthSettingsFrom (the phone verification mode comes from the validated startup configuration only)', () => {
  const base = { appEnv: 'test', host: '127.0.0.1' } as unknown as AppConfig;

  it('is REQUIRED when the configuration carries no mode', () => {
    expect(clientAuthSettingsFrom(base).phoneVerificationMode).toBe('REQUIRED');
  });

  it('is DISABLED_TEST only when the configuration says so', () => {
    expect(clientAuthSettingsFrom({ ...base, clientPhoneVerificationMode: 'DISABLED_TEST' }).phoneVerificationMode).toBe('DISABLED_TEST');
  });

  it('keeps the LOCAL_WEB device gate independent of the mode (no proof of phone is not a proof of device)', () => {
    const settings = clientAuthSettingsFrom({ ...base, clientPhoneVerificationMode: 'DISABLED_TEST' });
    expect(() => assertDeviceAllowed(settings, web)).not.toThrow();
    expect(() => assertDeviceAllowed(settings, android)).not.toThrow();
    const remote = clientAuthSettingsFrom({ ...base, host: '0.0.0.0', clientPhoneVerificationMode: 'DISABLED_TEST' });
    expect(() => assertDeviceAllowed(remote, web)).toThrow(AppError);
  });
});
