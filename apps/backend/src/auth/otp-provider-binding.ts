import { AppEnvironment } from '../config/app-config';
import { StartupConfigError } from '../config/startup-config-error';
import { DisabledOtpProvider } from './disabled-otp-provider';
import { FakeOtpProvider } from './fake-otp-provider';
import { OtpProvider } from './otp-provider';

/**
 * Issue #102: the SMS gateway adapter needs the transaction manager and the keyring, which exist only inside the Nest graph, so
 * main.ts cannot build it. bindOtpProvider returns this marker instead and AuthModule wires the real adapter from it.
 */
export const SMS_GATEWAY_BINDING = Object.freeze({ kind: 'SMS_GATEWAY' as const });
export type SmsGatewayBinding = typeof SMS_GATEWAY_BINDING;

export function isSmsGatewayBinding(value: unknown): value is SmsGatewayBinding {
  return value === SMS_GATEWAY_BINDING;
}

export interface OtpBindingOptions {
  /**
   * True only when loadConfig produced the SMS gateway config (SMS_GATEWAY_ENABLED=true). It selects the real adapter in every
   * environment and takes precedence over the development/test fake; it can never be combined with the test inbox or the
   * staging fixture mode.
   */
  readonly smsGatewayEnabled?: boolean;
  /** True only when loadConfig produced a staging fixture mode (AUTH_STAGING_FIXTURES_ENABLED=true on staging). */
  readonly stagingFixtureMode?: boolean;
  /**
   * The test inbox adapter (M01.22). Supplied by main.ts ONLY when the explicit TEST_INBOX selection was accepted; it is
   * honoured in development/test and refused everywhere else, so no environment can reach it by accident.
   */
  readonly testInboxProvider?: OtpProvider;
}

/**
 * The OTP provider main.ts binds (task section 7, extended by M00-D2). The in-memory fake exists for development and
 * tests ONLY. Staging binds the explicit DisabledOtpProvider, and ONLY with the fixture mode on: staging without
 * it still has no provider, so startup is refused with a fixed message that names only OTP_PROVIDER. Production
 * has no provider until a real SMS adapter is approved, so it is always refused, with the fixture mode or not.
 * There is no silent fallback to a fake that would "deliver" codes nowhere.
 */
export function bindOtpProvider(appEnv: AppEnvironment, options?: OtpBindingOptions & { readonly smsGatewayEnabled?: false }): OtpProvider;
export function bindOtpProvider(appEnv: AppEnvironment, options: OtpBindingOptions): OtpProvider | SmsGatewayBinding;
export function bindOtpProvider(appEnv: AppEnvironment, options: OtpBindingOptions = {}): OtpProvider | SmsGatewayBinding {
  if (options.smsGatewayEnabled === true) {
    if (options.testInboxProvider !== undefined || options.stagingFixtureMode === true) {
      throw new StartupConfigError(['OTP_PROVIDER']);
    }
    return SMS_GATEWAY_BINDING;
  }
  if (appEnv === 'development' || appEnv === 'test') {
    return options.testInboxProvider ?? new FakeOtpProvider();
  }
  // The test inbox adapter outside development/test is never honoured, with or without the staging fixture mode.
  if (options.testInboxProvider !== undefined) {
    throw new StartupConfigError(['OTP_PROVIDER']);
  }
  if (appEnv === 'staging' && options.stagingFixtureMode === true) {
    return new DisabledOtpProvider();
  }
  throw new StartupConfigError(['OTP_PROVIDER']);
}
