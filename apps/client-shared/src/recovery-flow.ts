import { AuthClient, AuthResult } from './auth/client.js';
import { RecoveryMode } from './auth/contract.js';
import { FailureCode } from './states.js';

// The no-OTP test password reset of F13 / S15 as ONE in-memory object (M01-RESET, Owner decision 2026-10-13).
//
// The screen shows ONE form (phone, new password, confirmation) when - and only when - the server says its reset mode is
// DISABLED_TEST (GET /v1/account-recovery/config). Until a valid answer arrived (or after a failed one) the mode is unknown and the
// screen keeps its submit locked: nothing is guessed. There is no code step, no proof, no auto login. The confirmation is checked
// by the screen only; it is never sent. One call at a time; an unknown answer is retried with the SAME key and body when the person
// submits the same form again (the adapter keeps them); leaving the screen drops them and makes an answer on its way stale.

export type RecoveryStepResult =
  | { readonly kind: 'ok' }
  | { readonly kind: 'failure'; readonly code: FailureCode; readonly retryAfterSeconds?: number; readonly unresolved: boolean }
  | { readonly kind: 'stale' };

export interface RecoveryController {
  /** Asks the server whether the test reset is on. Each call asks again; concurrent calls share one request. */
  loadMode(): Promise<AuthResult<RecoveryMode>>;
  /** The server's answer of the latest `loadMode`, or undefined while it has none (never a default). */
  mode(): RecoveryMode | undefined;
  /** Resets the password of the phone number. Refused (without a request) unless the server answered DISABLED_TEST. */
  reset(form: { readonly phone: string; readonly password: string }): Promise<RecoveryStepResult>;
  /** The person left the screen: wipes what was kept and makes every answer on its way stale. */
  cancel(): void;
}

export function createRecoveryController(options: { readonly auth: AuthClient }): RecoveryController {
  const { auth } = options;
  let serverMode: RecoveryMode | undefined;
  let modeRun: Promise<AuthResult<RecoveryMode>> | undefined;

  function loadMode(): Promise<AuthResult<RecoveryMode>> {
    if (modeRun !== undefined) {
      return modeRun;
    }
    const run: Promise<AuthResult<RecoveryMode>> = auth.recoveryConfig().then((result) => {
      if (modeRun === run) {
        modeRun = undefined;
      }
      serverMode = result.kind === 'ok' ? result.value : undefined;
      return result;
    });
    modeRun = run;
    return run;
  }

  async function reset(form: { readonly phone: string; readonly password: string }): Promise<RecoveryStepResult> {
    if (serverMode !== 'DISABLED_TEST') {
      return { kind: 'failure', code: 'UNKNOWN', unresolved: false };
    }
    const result = await auth.resetPasswordTest({ phone: form.phone.trim(), password: form.password });
    if (result.kind === 'stale') {
      return { kind: 'stale' };
    }
    if (result.kind === 'ok') {
      return { kind: 'ok' };
    }
    return { kind: 'failure', code: result.code, unresolved: result.unresolved, ...(result.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: result.retryAfterSeconds }) };
  }

  return { loadMode, mode: () => serverMode, reset, cancel: () => auth.cancelPasswordReset() };
}
