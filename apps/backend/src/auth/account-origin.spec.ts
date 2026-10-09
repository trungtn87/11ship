import { describe, expect, it } from '@jest/globals';
import { AppError } from '../common/app-errors';
import { PhoneAllowlist } from '../config/staging-fixtures-config';
import {
  createAccountOriginPolicy,
  isAccountOrigin,
  phoneVerificationStatusOf,
  standardAccountOriginPolicy,
} from './account-origin';
import { bindOtpProvider } from './otp-provider-binding';
import { DisabledOtpProvider } from './disabled-otp-provider';
import { FakeOtpProvider } from './fake-otp-provider';
import { StartupConfigError } from '../config/startup-config-error';

const PHONE = '+84911111111';
const OTHER = '+84922222222';
const allowlist = new PhoneAllowlist([PHONE]);
const verified = { accountOrigin: 'PHONE_VERIFIED', phoneNormalized: PHONE } as const;
const fixture = { accountOrigin: 'STAGING_FIXTURE', phoneNormalized: PHONE } as const;

describe('account origin policy (M00-D2 section 4)', () => {
  it('the standard policy (no fixture mode) allows verified accounts and never a fixture; registration is open', () => {
    const policy = standardAccountOriginPolicy();
    expect(policy.fixtureMode).toBe(false);
    expect(policy.allows(verified)).toBe(true);
    expect(policy.allows(fixture)).toBe(false);
    expect(() => policy.assertRegistrationOpen()).not.toThrow();
  });

  it('staging with the mode on allows only an allowlisted fixture, refuses verified accounts, and closes registration', () => {
    const policy = createAccountOriginPolicy({ appEnv: 'staging', fixtureModeEnabled: true, allowedPhones: allowlist });
    expect(policy.fixtureMode).toBe(true);
    expect(policy.allows(fixture)).toBe(true);
    expect(policy.allows({ ...fixture, phoneNormalized: OTHER })).toBe(false);
    expect(policy.allows(verified)).toBe(false);
    expect(() => policy.assertRegistrationOpen()).toThrow(AppError);
    try {
      policy.assertRegistrationOpen();
    } catch (error) {
      expect((error as AppError).code).toBe('AUTH_REGISTRATION_UNAVAILABLE');
      expect((error as AppError).status).toBe(503);
    }
  });

  it('staging with the mode off, or without an allowlist, behaves like the standard policy', () => {
    for (const policy of [
      createAccountOriginPolicy({ appEnv: 'staging', fixtureModeEnabled: false, allowedPhones: allowlist }),
      createAccountOriginPolicy({ appEnv: 'staging', fixtureModeEnabled: true, allowedPhones: undefined }),
    ]) {
      expect(policy.fixtureMode).toBe(false);
      expect(policy.allows(fixture)).toBe(false);
      expect(policy.allows(verified)).toBe(true);
    }
  });

  it.each(['production', 'development', 'test', undefined] as const)(
    'a policy built for %s can NEVER allow a fixture, even with the mode forced on and the phone allowlisted',
    (appEnv) => {
      const policy = createAccountOriginPolicy({ appEnv, fixtureModeEnabled: true, allowedPhones: allowlist });
      expect(policy.fixtureMode).toBe(false);
      expect(policy.allows(fixture)).toBe(false);
      expect(() => policy.assertRegistrationOpen()).not.toThrow();
    },
  );

  it('an origin the code does not know is never allowed', () => {
    const policy = createAccountOriginPolicy({ appEnv: 'staging', fixtureModeEnabled: true, allowedPhones: allowlist });
    expect(policy.allows({ accountOrigin: 'SOMETHING_ELSE' as never, phoneNormalized: PHONE })).toBe(false);
    expect(standardAccountOriginPolicy().allows({ accountOrigin: 'SOMETHING_ELSE' as never, phoneNormalized: PHONE })).toBe(false);
  });

  it('maps origin to the display status, and recognises only the two origins', () => {
    expect(phoneVerificationStatusOf('PHONE_VERIFIED')).toBe('VERIFIED');
    expect(phoneVerificationStatusOf('STAGING_FIXTURE')).toBe('UNVERIFIED_TEST');
    expect(isAccountOrigin('PHONE_VERIFIED')).toBe(true);
    expect(isAccountOrigin('STAGING_FIXTURE')).toBe(true);
    for (const value of ['', 'verified', null, undefined, 1, 'ADMIN']) {
      expect(isAccountOrigin(value)).toBe(false);
    }
  });
});

describe('bindOtpProvider with the staging fixture mode (M00-D2 section 3)', () => {
  it('binds the explicit DisabledOtpProvider on staging with the mode on, never a fake', () => {
    const provider = bindOtpProvider('staging', { stagingFixtureMode: true });
    expect(provider).toBeInstanceOf(DisabledOtpProvider);
    expect(provider).not.toBeInstanceOf(FakeOtpProvider);
  });

  it('still refuses staging without the mode, and production with or without it, naming only OTP_PROVIDER', () => {
    const attempts: Array<() => unknown> = [
      () => bindOtpProvider('staging'),
      () => bindOtpProvider('staging', { stagingFixtureMode: false }),
      () => bindOtpProvider('production'),
      () => bindOtpProvider('production', { stagingFixtureMode: true }),
    ];
    for (const attempt of attempts) {
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
    expect(bindOtpProvider('test', { stagingFixtureMode: true })).toBeInstanceOf(FakeOtpProvider);
  });

  it('the disabled provider fails every send without carrying the phone number or the code', async () => {
    const provider = new DisabledOtpProvider();
    await expect((provider as unknown as { sendRegisterOtp(p: string, o: string): Promise<void> }).sendRegisterOtp('+84977777777', '987654')).rejects.toThrow();
    try {
      await (provider as unknown as { sendRegisterOtp(p: string, o: string): Promise<void> }).sendRegisterOtp('+84977777777', '987654');
    } catch (error) {
      expect(String((error as Error).message)).not.toMatch(/977777777|987654/);
    }
  });
});
