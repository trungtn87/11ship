import { AppEnvironment } from '../config/app-config';
import { StartupConfigError } from '../config/startup-config-error';
import { DisabledOtpProvider } from './disabled-otp-provider';
import { FakeOtpProvider } from './fake-otp-provider';
import { OtpProvider } from './otp-provider';

export interface OtpBindingOptions {
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
export function bindOtpProvider(appEnv: AppEnvironment, options: OtpBindingOptions = {}): OtpProvider {
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
