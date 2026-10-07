import { APP_CONFIG, AppConfig } from '../config/app-config';
import { AuthConfig } from '../config/auth-config';
import { StartupConfigError } from '../config/startup-config-error';

/** Injection token of the validated Auth configuration. */
export const AUTH_CONFIG = Symbol('AUTH_CONFIG');

/**
 * Auth needs AUTH_OTP_HMAC_SECRET. Where the Auth module is wired and the secret is missing, startup stops
 * with an error that names only the variable.
 */
export function requireAuthConfig(config: AppConfig): AuthConfig {
  if (config.auth === undefined) {
    throw new StartupConfigError(['AUTH_OTP_HMAC_SECRET']);
  }
  return config.auth;
}

export const authConfigProvider = {
  provide: AUTH_CONFIG,
  inject: [APP_CONFIG],
  useFactory: (config: AppConfig): AuthConfig => requireAuthConfig(config),
};
