import { isLocalWebMode } from './client-auth-config';

// Account recovery mode (M01-RESET, Owner decision 2026-10-13: no OTP in the test build).
//
//   ACCOUNT_RECOVERY_MODE  unset | UNAVAILABLE (closed, the default) | DISABLED_TEST | SMS_OTP (needs SMS_GATEWAY_ENABLED=true)
//
// DISABLED_TEST lets USER / ADMIN accounts reset a password by phone number WITHOUT any proof of owning that number. It is an
// Owner-approved exception for the test build only: APP_ENV must be explicitly development or test AND the server must be
// bound to a loopback address (a test VPS reaches it through a reverse proxy on the loopback interface). Any other value, and
// DISABLED_TEST anywhere else (staging, production, a non-loopback bind), stops startup naming only the variable. Nothing about
// a request (header, body field, app label) can switch the mode.

export const ACCOUNT_RECOVERY_MODE_ENV = 'ACCOUNT_RECOVERY_MODE';

export type AccountRecoveryMode = 'UNAVAILABLE' | 'DISABLED_TEST' | 'SMS_OTP';

export type AccountRecoveryModeResult =
  | { readonly ok: true; readonly mode: AccountRecoveryMode }
  | { readonly ok: false; readonly invalid: readonly string[] };

export interface AccountRecoveryModeInput {
  /** Undefined when APP_ENV itself is invalid (that variable is reported on its own). */
  readonly appEnv: string | undefined;
  readonly host: string;
  readonly modeRaw: string | undefined;
  /** True only when SMS_GATEWAY_ENABLED=true was validated: SMS_OTP needs the real gateway (issue #102). */
  readonly smsGatewayEnabled?: boolean;
}

export function parseAccountRecoveryMode(input: AccountRecoveryModeInput): AccountRecoveryModeResult {
  if (input.modeRaw === undefined || input.modeRaw === 'UNAVAILABLE') {
    return { ok: true, mode: 'UNAVAILABLE' };
  }
  if (input.modeRaw === 'SMS_OTP') {
    // SMS_OTP (issue #102) resets a password only after an OTP delivered through the paired SMS gateway. It is refused
    // (startup stops, naming only the variable) unless the real gateway is configured; it is valid in every environment.
    return input.smsGatewayEnabled === true
      ? { ok: true, mode: 'SMS_OTP' }
      : { ok: false, invalid: [ACCOUNT_RECOVERY_MODE_ENV] };
  }
  if (input.modeRaw !== 'DISABLED_TEST') {
    return { ok: false, invalid: [ACCOUNT_RECOVERY_MODE_ENV] };
  }
  if (input.appEnv === undefined) {
    return { ok: true, mode: 'UNAVAILABLE' };
  }
  if (!isLocalWebMode(input.appEnv, input.host)) {
    return { ok: false, invalid: [ACCOUNT_RECOVERY_MODE_ENV] };
  }
  return { ok: true, mode: 'DISABLED_TEST' };
}
