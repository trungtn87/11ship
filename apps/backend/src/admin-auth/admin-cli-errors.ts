/**
 * Fixed outcomes of the operator commands that mean "refused". The code is the whole message: nothing from the input
 * (phone, password, key), the database or the environment is ever put into it.
 */
export type AdminCliErrorCode =
  | 'LIMIT_CONFIG_MISSING'
  | 'LIMIT_CONFIG_MISMATCH'
  | 'SYSTEM_ACCOUNT_DIFFERENT'
  | 'PHONE_ALREADY_REGISTERED';

export class AdminCliError extends Error {
  readonly code: AdminCliErrorCode;

  constructor(code: AdminCliErrorCode) {
    super(code);
    this.name = 'AdminCliError';
    this.code = code;
  }
}
