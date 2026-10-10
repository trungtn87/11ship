import { ActivationErrorDetails } from '../common/app-errors';
import { PASSWORD_DEADLINE_MS, OTP_WRONG_LIMIT, TOTP_WRONG_LIMIT } from './admin-activation-constants';
import { AttemptRow, ChallengeRow } from './admin-activation-repository';

// The ONLY non-sensitive view of an activation attempt (contract section 6.3). It is built from values the service read
// under its own transaction or snapshot, and it can never carry: a phone (not even masked, OD-12), a name, a note, a
// user id, a factor id, permissions, a password or hash, a TOTP secret, an OTP, an invitation token or a CSRF nonce.
// snake_case keys, like the rest of the administration API; times are ISO 8601.

export interface ViewInput {
  readonly attempt: AttemptRow;
  readonly newestChallenge: ChallengeRow | undefined;
  readonly invitation: { readonly status: string; readonly expiresAtMs: number };
  /** The database clock the decisions of this view are made with (epoch milliseconds). */
  readonly nowMs: number;
}

export type OtpStatus = 'NONE' | 'SUBMITTED' | 'EXPIRED' | 'LOCKED' | 'FAILED';

const iso = (ms: number): string => new Date(ms).toISOString();

/** `otp.status` from the NEWEST challenge of the attempt, in any status (section 6.3). */
export function otpStatusOf(challenge: ChallengeRow | undefined, nowMs: number): OtpStatus {
  if (challenge === undefined) {
    return 'NONE';
  }
  switch (challenge.status) {
    case 'PENDING_DELIVERY':
    case 'PENDING':
      return nowMs >= challenge.expiresAtMs ? 'EXPIRED' : 'SUBMITTED';
    case 'LOCKED':
      return 'LOCKED';
    case 'DELIVERY_FAILED':
      return 'FAILED';
    default:
      return 'NONE';
  }
}

/** The wire reason of an INVALIDATED attempt (OD-8: closed and expired links share one message). */
export function wireReason(reason: AttemptRow['invalidatedReason']): string {
  switch (reason) {
    case 'SUPERSEDED':
      return 'REPLACED';
    case 'INVITATION_CLOSED':
      return 'LINK_UNAVAILABLE';
    case 'PHONE_CONFLICT':
      return 'PHONE_CONFLICT';
    default:
      return 'ATTEMPTS_EXHAUSTED';
  }
}

/** Table of section 6.1.1: live attempts and INVALIDATED(ATTEMPTS_EXHAUSTED) get a CSRF token, nothing else does. */
export function stateGetsCsrf(attempt: AttemptRow): boolean {
  if (attempt.status === 'INVALIDATED') {
    return attempt.invalidatedReason === 'ATTEMPTS_EXHAUSTED';
  }
  return attempt.status !== 'COMPLETED';
}

export function passwordDeadlineMs(attempt: AttemptRow): number | null {
  return attempt.otpVerifiedAtMs === null ? null : attempt.otpVerifiedAtMs + PASSWORD_DEADLINE_MS;
}

/** The state body (GET state / 409 details). `csrf` is set by the caller only where the table of 6.1.1 allows it. */
export function stateBody(input: ViewInput, csrf: string | undefined): ActivationErrorDetails & Record<string, unknown> {
  const { attempt, nowMs } = input;
  const body: Record<string, string | number | boolean | null | Record<string, string | number | boolean | null>> = {
    state: attempt.status,
  };
  switch (attempt.status) {
    case 'STARTED': {
      const challenge = input.newestChallenge;
      const status = otpStatusOf(challenge, nowMs);
      const otp: Record<string, string | number | boolean | null> = { status };
      if (status === 'SUBMITTED' && challenge !== undefined) {
        otp.resend_at = iso(challenge.resendNotBeforeMs);
        otp.attempts_left = Math.max(0, OTP_WRONG_LIMIT - challenge.attemptCount);
      }
      body.otp = otp;
      break;
    }
    case 'OTP_VERIFIED': {
      const deadline = passwordDeadlineMs(attempt);
      body.password_deadline = deadline === null ? null : iso(deadline);
      body.restart_required = deadline !== null && nowMs > deadline;
      break;
    }
    case 'TOTP_ISSUED':
      body.totp_attempts_left = Math.max(0, TOTP_WRONG_LIMIT - attempt.totpAttemptCount);
      break;
    case 'COMPLETED':
      body.next = 'LOGIN';
      break;
    case 'INVALIDATED': {
      const exhausted = attempt.invalidatedReason === 'ATTEMPTS_EXHAUSTED';
      body.reason = wireReason(attempt.invalidatedReason);
      body.can_restart = exhausted && input.invitation.status === 'PENDING' && nowMs < input.invitation.expiresAtMs;
      break;
    }
    default:
      break;
  }
  if (attempt.status !== 'COMPLETED' && attempt.status !== 'INVALIDATED') {
    body.expires_at = iso(attempt.expiresAtMs);
  }
  if (csrf !== undefined && stateGetsCsrf(attempt)) {
    body.csrf_token = csrf;
  }
  return body;
}
