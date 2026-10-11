import { APP_CONFIG, AppConfig } from '../config/app-config';
import { AdminActivationConfig } from '../config/admin-activation-config';
import { StartupConfigError } from '../config/startup-config-error';

/** Injection token of the validated activation configuration. */
export const ADMIN_ACTIVATION_CONFIG = Symbol('ADMIN_ACTIVATION_CONFIG');

/** The activation is only wired when its configuration is complete; a missing part stops startup naming the variable. */
export function requireAdminActivationConfig(config: AppConfig): AdminActivationConfig {
  if (config.adminActivation === undefined) {
    throw new StartupConfigError(['ADMIN_ACTIVATION_ENABLED']);
  }
  return config.adminActivation;
}

export const adminActivationConfigProvider = {
  provide: ADMIN_ACTIVATION_CONFIG,
  inject: [APP_CONFIG],
  useFactory: (config: AppConfig): AdminActivationConfig => requireAdminActivationConfig(config),
};
