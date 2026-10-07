import { AppEnvironment } from '../config/app-config';
import { StartupConfigError } from '../config/startup-config-error';
import { FakeOtpProvider } from './fake-otp-provider';
import { OtpProvider } from './otp-provider';

/**
 * The OTP provider main.ts binds (task section 7). The in-memory fake exists for development and tests
 * ONLY. In staging and production there is no provider yet (the production SMS adapter is a later task), so
 * startup is refused with a fixed message that names only OTP_PROVIDER: there is no silent fallback to a fake
 * that would "deliver" codes nowhere.
 */
export function bindOtpProvider(appEnv: AppEnvironment): OtpProvider {
  if (appEnv === 'development' || appEnv === 'test') {
    return new FakeOtpProvider();
  }
  throw new StartupConfigError(['OTP_PROVIDER']);
}
