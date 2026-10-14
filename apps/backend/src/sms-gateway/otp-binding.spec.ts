import { describe, expect, it } from '@jest/globals';
import { FakeOtpProvider } from '../auth/fake-otp-provider';
import { bindOtpProvider, isSmsGatewayBinding, SMS_GATEWAY_BINDING } from '../auth/otp-provider-binding';
import { StartupConfigError } from '../config/startup-config-error';

describe('bindOtpProvider with the SMS gateway (issue #102)', () => {
  it('selects the real gateway adapter in every environment when it was configured, never a fake', () => {
    for (const env of ['development', 'test', 'staging', 'production'] as const) {
      const bound = bindOtpProvider(env, { smsGatewayEnabled: true });
      expect(isSmsGatewayBinding(bound)).toBe(true);
      expect(bound).toBe(SMS_GATEWAY_BINDING);
    }
  });

  it('does not change the default: without the gateway development/test keep the fake and staging/production stay closed', () => {
    expect(bindOtpProvider('test')).toBeInstanceOf(FakeOtpProvider);
    expect(bindOtpProvider('development', { smsGatewayEnabled: false })).toBeInstanceOf(FakeOtpProvider);
    for (const env of ['staging', 'production'] as const) {
      expect(() => bindOtpProvider(env)).toThrow(StartupConfigError);
      expect(() => bindOtpProvider(env, { smsGatewayEnabled: false })).toThrow(StartupConfigError);
    }
  });

  it('cannot be combined with the staging fixture mode or the test inbox', () => {
    expect(() => bindOtpProvider('staging', { smsGatewayEnabled: true, stagingFixtureMode: true })).toThrow(StartupConfigError);
    expect(() => bindOtpProvider('development', { smsGatewayEnabled: true, testInboxProvider: new FakeOtpProvider() })).toThrow(StartupConfigError);
  });
});
