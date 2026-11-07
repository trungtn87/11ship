import { AppEnvironment } from '../config/app-config';
import { StartupConfigError } from '../config/startup-config-error';
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
   * environment and takes precedence over the development/test fake; it can never be combined with the test inbox.
   */
  readonly smsGatewayEnabled?: boolean;
  /**
   * The test inbox adapter (M01.22). Supplied by main.ts ONLY when the explicit TEST_INBOX selection was accepted; it is
   * honoured in development/test and refused everywhere else, so no environment can reach it by accident.
   */
  readonly testInboxProvider?: OtpProvider;
}

/**
 * The OTP provider main.ts binds (task section 7, extended by M00-D2). The in-memory fake exists for development and
 * tests ONLY. Staging and production need the real SMS gateway (SMS_GATEWAY_ENABLED=true), otherwise startup is refused with a fixed
 * message that names only OTP_PROVIDER. There is no silent fallback to a fake that would "deliver" codes nowhere.
 */
export function bindOtpProvider(appEnv: AppEnvironment, options?: OtpBindingOptions & { readonly smsGatewayEnabled?: false }): OtpProvider;
export function bindOtpProvider(appEnv: AppEnvironment, options: OtpBindingOptions): OtpProvider | SmsGatewayBinding;
export function bindOtpProvider(appEnv: AppEnvironment, options: OtpBindingOptions = {}): OtpProvider | SmsGatewayBinding {
  if (options.smsGatewayEnabled === true) {
    if (options.testInboxProvider !== undefined) {
      throw new StartupConfigError(['OTP_PROVIDER']);
    }
    return SMS_GATEWAY_BINDING;
  }
  if (appEnv === 'development' || appEnv === 'test') {
    return options.testInboxProvider ?? new FakeOtpProvider();
  }
  // The test inbox adapter outside development/test is never honoured.
  if (options.testInboxProvider !== undefined) {
    throw new StartupConfigError(['OTP_PROVIDER']);
  }
  throw new StartupConfigError(['OTP_PROVIDER']);
}
