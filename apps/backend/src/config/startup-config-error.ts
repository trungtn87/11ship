import { formatInvalidConfigMessage } from './app-config';

/**
 * Raised while the application graph is being built when a module needs configuration that is
 * missing (for example the crypto keyring where the idempotency executor is wired). It carries only
 * the NAMES of the variables, never a value, so it is always safe to print.
 */
export class StartupConfigError extends Error {
  readonly invalid: readonly string[];

  constructor(invalid: readonly string[]) {
    super(formatInvalidConfigMessage(invalid));
    this.name = 'StartupConfigError';
    this.invalid = [...invalid];
  }
}
