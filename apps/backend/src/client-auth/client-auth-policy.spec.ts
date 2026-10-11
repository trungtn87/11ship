import { describe, expect, it } from '@jest/globals';
import { AppError, TechnicalError } from '../common/app-errors';
import { assertConsentSupported, assertDeviceAllowed, ClientAuthSettings } from './client-auth-policy';

const PAIR = { termsVersion: 'test-terms-20261011-v1', privacyVersion: 'test-privacy-20261011-v1' };
const web = { deviceId: 'd-1', platform: 'WEB', app: 'FOOD' } as const;
const android = { deviceId: 'd-2', platform: 'ANDROID', app: 'SHIP' } as const;

describe('assertDeviceAllowed', () => {
  it('accepts WEB only in LOCAL_WEB mode', () => {
    expect(() => assertDeviceAllowed({ consent: PAIR, localWeb: true }, web)).not.toThrow();
    expect(() => assertDeviceAllowed({ consent: PAIR, localWeb: false }, web)).toThrow(AppError);
    try {
      assertDeviceAllowed({ consent: PAIR, localWeb: false }, web);
    } catch (error) {
      expect((error as AppError).code).toBe('DEVICE_PROOF_REQUIRED');
    }
  });

  it('answers unavailable for ANDROID whatever the mode (no verifier, no fallback)', () => {
    for (const localWeb of [true, false]) {
      expect(() => assertDeviceAllowed({ consent: PAIR, localWeb }, android)).toThrow(TechnicalError);
    }
  });
});

describe('assertConsentSupported', () => {
  const settings: ClientAuthSettings = { consent: PAIR, localWeb: true };
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
    expect(() => assertConsentSupported({ consent: undefined, localWeb: true }, PAIR)).toThrow(TechnicalError);
  });
});
