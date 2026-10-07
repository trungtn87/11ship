import { safeErrorCode } from '../common/safe-error';
import { StartupConfigError } from './startup-config-error';

/**
 * The one line printed when startup fails after the configuration was parsed. A missing-configuration
 * error names only its variables; anything else prints a short allow-listed code and nothing else.
 */
export function describeStartupFailure(error: unknown): string {
  if (error instanceof StartupConfigError) {
    return error.message;
  }
  return `Startup failed (${safeErrorCode(error)}).`;
}
