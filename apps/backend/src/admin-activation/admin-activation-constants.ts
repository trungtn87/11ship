// Fixed values of M01-D-ADMIN-1C (administration account activation). Constants on purpose, like those of 1A/1B: the
// contract (docs/tasks/M01-D-ADMIN-1C-technical-contract.md, sections 6-8) fixes them, the Owner approved them (OD-7),
// the database CHECKs cap them, and no environment variable can loosen them. Only the provider timeout and the
// promote grace are configuration (AdminActivationConfig).

/** Activation-session cookie. Distinct from the login cookies; never accepted in place of them. */
export const ACTIVATION_COOKIE = '__Host-11admin-act';

export const ACTIVATION_ROUTE_PREFIX = 'admin-activation';

// ----- lifetimes (section 7) --------------------------------------------------------------------------------------
export const ATTEMPT_TTL_MS = 30 * 60 * 1000;
export const OTP_TTL_MS = 300 * 1000;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
/** After OTP verification the password must be set within this time (passwordDeadline). */
export const PASSWORD_DEADLINE_MS = 600 * 1000;

// ----- counters (sections 7 and 8) ---------------------------------------------------------------------------------
export const OTP_WRONG_LIMIT = 5;
export const TOTP_WRONG_LIMIT = 5;

/** Ingress quota (R0): 30 requests / 60 s / client address. The slot is never given back. */
export const ACTIVATION_REQUEST_LIMIT = 30;
export const ACTIVATION_REQUEST_WINDOW_SECONDS = 60;

/** Wrong invitation token at start: 10 / 15 min / address, then a 15 min lock. */
export const LINK_FAILURE_LIMIT = 10;
export const LINK_FAILURE_WINDOW_SECONDS = 15 * 60;
export const LINK_FAILURE_LOCK_SECONDS = 15 * 60;

/** OTP sends: 5 / hour / invitation (the bucket is the invitation, never a phone). */
export const OTP_SEND_LIMIT = 5;
export const OTP_SEND_WINDOW_SECONDS = 3600;

/** Wrong TOTP at complete: 5 / 15 min / invitation, then a 15 min lock. */
export const TOTP_FAILURE_LIMIT = 5;
export const TOTP_FAILURE_WINDOW_SECONDS = 15 * 60;
export const TOTP_FAILURE_LOCK_SECONDS = 15 * 60;

// ----- transport (section 6.1) -------------------------------------------------------------------------------------
export const MAX_BODY_BYTES = 4096;
export const CSRF_HEADER = 'x-csrf-token';

// ----- domain values -----------------------------------------------------------------------------------------------
export const OTP_PURPOSE = 'ADMIN_ACTIVATION';
export const ACTOR_ANONYMOUS = 'ANONYMOUS';
export const ACTOR_USER = 'USER';
export const RESOURCE_ATTEMPT = 'admin_activation_attempt';
export const RESOURCE_CHALLENGE = 'admin_activation_otp_challenge';
export const RESOURCE_INVITATION = 'admin_invitation';

export type AttemptStatus = 'STARTED' | 'OTP_VERIFIED' | 'PASSWORD_SET' | 'TOTP_ISSUED' | 'COMPLETED' | 'INVALIDATED';
export type InvalidatedReason = 'SUPERSEDED' | 'INVITATION_CLOSED' | 'PHONE_CONFLICT' | 'ATTEMPTS_EXHAUSTED';
export type ChallengeStatus = 'PENDING_DELIVERY' | 'PENDING' | 'VERIFIED' | 'LOCKED' | 'INVALIDATED' | 'DELIVERY_FAILED';

export const LIVE_ATTEMPT_STATUSES: readonly AttemptStatus[] = Object.freeze([
  'STARTED',
  'OTP_VERIFIED',
  'PASSWORD_SET',
  'TOTP_ISSUED',
]);

/** Audit actions (section 15). Metadata never carries an OTP, password, hash, TOTP secret, token, phone or displayed code. */
export const ACTIVATION_AUDIT_ACTIONS = Object.freeze({
  attemptStarted: 'admin_activation.attempt_started.v1',
  attemptRestarted: 'admin_activation.attempt_restarted.v1',
  attemptSuperseded: 'admin_activation.attempt_superseded.v1',
  attemptInvalidated: 'admin_activation.attempt_invalidated.v1',
  otpRequested: 'admin_activation.otp_requested.v1',
  otpDeliveryUnknown: 'admin_activation.otp_delivery_unknown.v1',
  otpDeliveryFailed: 'admin_activation.otp_delivery_failed.v1',
  otpDeliveryPromoted: 'admin_activation.otp_delivery_promoted.v1',
  otpWrong: 'admin_activation.otp_wrong.v1',
  otpVerified: 'admin_activation.otp_verified.v1',
  passwordSet: 'admin_activation.password_set.v1',
  totpIssued: 'admin_activation.totp_issued.v1',
  totpWrong: 'admin_activation.totp_wrong.v1',
  phoneConflict: 'admin_activation.phone_conflict.v1',
  completed: 'admin_activation.completed.v1',
  anomaly: 'admin_activation.anomaly.v1',
});
