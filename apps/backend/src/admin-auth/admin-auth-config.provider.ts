import { APP_CONFIG, AppConfig } from '../config/app-config';
import { AdminAuthConfig } from '../config/admin-auth-config';
import { StartupConfigError } from '../config/startup-config-error';

/** Injection token of the validated administration configuration. */
export const ADMIN_AUTH_CONFIG = Symbol('ADMIN_AUTH_CONFIG');

/** The module is only wired when the configuration is complete; a missing part stops startup, naming the variable. */
export function requireAdminAuthConfig(config: AppConfig): AdminAuthConfig {
  if (config.adminAuth === undefined) {
    throw new StartupConfigError(['ADMIN_AUTH_ENABLED']);
  }
  return config.adminAuth;
}

export const adminAuthConfigProvider = {
  provide: ADMIN_AUTH_CONFIG,
  inject: [APP_CONFIG],
  useFactory: (config: AppConfig): AdminAuthConfig => requireAdminAuthConfig(config),
};
