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
const web = { deviceId: 'd-1', platform: 'WEB', app: 'FOOD' } as const;
const android = { deviceId: 'd-2', platform: 'ANDROID', app: 'SHIP' } as const;

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

describe('assertConsentSupported', () => {
  const settings: ClientAuthSettings = { consent: PAIR, phoneVerificationMode: 'REQUIRED', localWeb: true };
  it('returns the configured pair on an exact match', () => {
    expect(assertConsentSupported(settings, PAIR)).toEqual(PAIR);
  });
  it('refuses any mismatch (swapped, partial, other version)', () => {
    for (const consent of [
      { termsVersion: PAIR.privacyVersion, privacyVersion: PAIR.termsVersion },
      { termsVersion: PAIR.termsVersion, privacyVersion: 'x' },
      { termsVersion: 'x', privacyVersion: PAIR.privacyVersion },
    ]) {
      expect(() => assertConsentSupported(settings, consent)).toThrow(AppError);
    }
  });
  it('fails closed when no pair is configured', () => {
    expect(() => assertConsentSupported({ consent: undefined, phoneVerificationMode: 'REQUIRED', localWeb: true }, PAIR)).toThrow(TechnicalError);
  });
});

describe('approved consent version transition', () => {
  const legacy = { termsVersion: 'terms-20261014-v1', privacyVersion: 'privacy-20261017-v1' };
  const official = { termsVersion: 'terms-20261114-v3', privacyVersion: 'privacy-20261114-v3' };

  for (const configured of [legacy, official]) {
    it('accepts either published pair while storing the exact agreed version', () => {
      const settings: ClientAuthSettings = { consent: configured, phoneVerificationMode: 'REQUIRED', localWeb: false };
      expect(assertConsentSupported(settings, official)).toEqual(official);
      expect(assertConsentSupported(settings, legacy)).toEqual(legacy);
    });
    it('rejects mixing a legacy policy with an official policy', () => {
      const settings: ClientAuthSettings = { consent: configured, phoneVerificationMode: 'REQUIRED', localWeb: false };
      expect(() => assertConsentSupported(settings, { termsVersion: official.termsVersion, privacyVersion: legacy.privacyVersion })).toThrow(AppError);
      expect(() => assertConsentSupported(settings, { termsVersion: legacy.termsVersion, privacyVersion: official.privacyVersion })).toThrow(AppError);
    });
  }
  it('does not open up extra versions on arbitrary development configuration', () => {
    const settings: ClientAuthSettings = { consent: PAIR, phoneVerificationMode: 'REQUIRED', localWeb: true };
    expect(() => assertConsentSupported(settings, official)).toThrow(AppError);
    expect(() => assertConsentSupported(settings, legacy)).toThrow(AppError);
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
