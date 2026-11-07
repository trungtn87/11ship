import { describe, expect, it } from '@jest/globals';
import {
  createAccountOriginPolicy,
  isAccountOrigin,
  isClientLoginOrigin,
  isOrdinaryClientAccount,
  phoneVerificationStatusOf,
  standardAccountOriginPolicy,
} from './account-origin';
import { bindOtpProvider } from './otp-provider-binding';
import { FakeOtpProvider } from './fake-otp-provider';
import { StartupConfigError } from '../config/startup-config-error';

const PHONE = '+84911111111';
const verified = { accountOrigin: 'PHONE_VERIFIED', phoneNormalized: PHONE } as const;
const fixture = { accountOrigin: 'STAGING_FIXTURE', phoneNormalized: PHONE } as const;
const administration = { accountOrigin: 'ADMIN_PROVISIONED', phoneNormalized: PHONE } as const;

describe('account origin policy (staging fixture mode removed, Owner 2026-11-07)', () => {
  it('the standard policy allows verified accounts and never a legacy fixture or an administration account', () => {
    const policy = standardAccountOriginPolicy();
    expect(policy.allows(verified)).toBe(true);
    expect(policy.allows({ accountOrigin: 'PHONE_UNVERIFIED', phoneNormalized: PHONE })).toBe(true);
    expect(policy.allows(fixture)).toBe(false);
    expect(policy.allows(administration)).toBe(false);
  });

  it.each(['production', 'staging', 'development', 'test', undefined] as const)(
    'a policy built for %s NEVER allows a legacy STAGING_FIXTURE row, whatever else is passed in',
    (appEnv) => {
      const policy = createAccountOriginPolicy({ appEnv, unverifiedTestModeEnabled: true });
      expect(policy.allows(fixture)).toBe(false);
      expect(policy.allows(administration)).toBe(false);
      expect(policy.allows(verified)).toBe(true);
    },
  );

  it('an origin the code does not know is never allowed', () => {
    expect(createAccountOriginPolicy({ appEnv: 'staging' }).allows({ accountOrigin: 'SOMETHING_ELSE' as never, phoneNormalized: PHONE })).toBe(false);
    expect(standardAccountOriginPolicy().allows({ accountOrigin: 'SOMETHING_ELSE' as never, phoneNormalized: PHONE })).toBe(false);
  });

  it('maps origin to the display status, and still recognises the stored origins (the legacy one included)', () => {
    expect(phoneVerificationStatusOf('PHONE_VERIFIED')).toBe('VERIFIED');
    expect(phoneVerificationStatusOf('STAGING_FIXTURE')).toBe('UNVERIFIED_TEST');
    // A no-proof test account is never shown as VERIFIED.
    expect(phoneVerificationStatusOf('TEST_UNVERIFIED')).toBe('UNVERIFIED_TEST');
    expect(isAccountOrigin('TEST_UNVERIFIED')).toBe(true);
    expect(isAccountOrigin('PHONE_VERIFIED')).toBe(true);
    expect(isAccountOrigin('STAGING_FIXTURE')).toBe(true); // the CHECK constraint still allows it: reading such a row must not crash
    expect(isAccountOrigin('ADMIN_PROVISIONED')).toBe(true);
    for (const value of ['', 'verified', null, undefined, 1, 'ADMIN', 'admin_provisioned']) {
      expect(isAccountOrigin(value)).toBe(false);
    }
  });
});

describe('bindOtpProvider (no staging fixture mode any more)', () => {
  it('refuses staging and production without the SMS gateway, naming only OTP_PROVIDER', () => {
    for (const attempt of [() => bindOtpProvider('staging'), () => bindOtpProvider('production')]) {
      try {
        attempt();
        throw new Error('expected a failure');
      } catch (error) {
        expect(error).toBeInstanceOf(StartupConfigError);
        expect((error as StartupConfigError).invalid).toEqual(['OTP_PROVIDER']);
      }
    }
  });

  it('the fake stays development and test only', () => {
    expect(bindOtpProvider('development')).toBeInstanceOf(FakeOtpProvider);
    expect(bindOtpProvider('test')).toBeInstanceOf(FakeOtpProvider);
  });
});

const testUnverified = { accountOrigin: 'TEST_UNVERIFIED', phoneNormalized: PHONE } as const;

describe('account origin policy — TEST_UNVERIFIED (no-OTP test registration)', () => {
  it('is allowed only while the no-proof test mode is on in development/test', () => {
    for (const appEnv of ['development', 'test'] as const) {
      const on = createAccountOriginPolicy({ appEnv, unverifiedTestModeEnabled: true });
      expect(on.unverifiedTestMode).toBe(true);
      expect(on.allows(testUnverified)).toBe(true);
      // Verified accounts keep working next to it; registration stays open.
      expect(on.allows(verified)).toBe(true);
      const off = createAccountOriginPolicy({ appEnv, unverifiedTestModeEnabled: false });
      expect(off.unverifiedTestMode).toBe(false);
      expect(off.allows(testUnverified)).toBe(false);
    }
  });

  it('is never allowed in staging, production or an unknown environment, whatever is passed in', () => {
    for (const appEnv of ['staging', 'production', undefined] as const) {
      const policy = createAccountOriginPolicy({ appEnv, unverifiedTestModeEnabled: true });
      expect(policy.unverifiedTestMode).toBe(false);
      expect(policy.allows(testUnverified)).toBe(false);
    }
    expect(standardAccountOriginPolicy().unverifiedTestMode).toBe(false);
    expect(standardAccountOriginPolicy().allows(testUnverified)).toBe(false);
  });

  it('does not change who a legacy fixture or an administration account is', () => {
    const policy = createAccountOriginPolicy({ appEnv: 'test', unverifiedTestModeEnabled: true });
    expect(policy.allows(fixture)).toBe(false);
    expect(policy.allows(administration)).toBe(false);
  });
});

describe('isOrdinaryClientAccount / isClientLoginOrigin (the one row-shape rule of a client account)', () => {
  it('accepts a verified account with a time and a test account without one, never with an administration membership', () => {
    expect(isOrdinaryClientAccount({ accountOrigin: 'PHONE_VERIFIED', phoneVerified: true, hasAdminMembership: false })).toBe(true);
    expect(isOrdinaryClientAccount({ accountOrigin: 'TEST_UNVERIFIED', phoneVerified: false, hasAdminMembership: false })).toBe(true);
    expect(isOrdinaryClientAccount({ accountOrigin: 'PHONE_VERIFIED', phoneVerified: true, hasAdminMembership: true })).toBe(false);
    expect(isOrdinaryClientAccount({ accountOrigin: 'TEST_UNVERIFIED', phoneVerified: false, hasAdminMembership: true })).toBe(false);
  });

  it('refuses a corrupt pairing and every other origin', () => {
    expect(isOrdinaryClientAccount({ accountOrigin: 'PHONE_VERIFIED', phoneVerified: false, hasAdminMembership: false })).toBe(false);
    expect(isOrdinaryClientAccount({ accountOrigin: 'TEST_UNVERIFIED', phoneVerified: true, hasAdminMembership: false })).toBe(false);
    for (const accountOrigin of ['ADMIN_PROVISIONED', 'STAGING_FIXTURE', 'SOMETHING_ELSE']) {
      expect(isOrdinaryClientAccount({ accountOrigin, phoneVerified: false, hasAdminMembership: false })).toBe(false);
      expect(isOrdinaryClientAccount({ accountOrigin, phoneVerified: true, hasAdminMembership: false })).toBe(false);
    }
  });

  it('lets only the two client origins reach a password check', () => {
    expect(isClientLoginOrigin('PHONE_VERIFIED')).toBe(true);
    expect(isClientLoginOrigin('TEST_UNVERIFIED')).toBe(true);
    expect(isClientLoginOrigin('ADMIN_PROVISIONED')).toBe(false);
    expect(isClientLoginOrigin('STAGING_FIXTURE')).toBe(false);
  });
});
