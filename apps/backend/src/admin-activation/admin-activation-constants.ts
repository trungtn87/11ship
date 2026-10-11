// Fixed values of M01-D-ADMIN-1C (administration account activation). The TTLs and thresholds of section 7 are
// configuration (config/admin-activation-config.ts, defaults = section 7, OD-7/OD-9); what stays here is what the
// database CHECKs fix and the transport/domain names.

/** Activation-session cookie. Distinct from the login cookies; never accepted in place of them. */
export const ACTIVATION_COOKIE = '__Host-11admin-act';

export const ACTIVATION_ROUTE_PREFIX = 'admin-activation';

// ----- counters the SCHEMA fixes (section 7) ---------------------------------------------------------------------
// Not configuration: CHECK attempt_count <= 5 / totp_attempt_count <= 5 (and LOCKED / ATTEMPTS_EXHAUSTED at 5). The TOTP
// bucket limit equals the per-attempt limit on purpose: the fifth wrong code invalidates the attempt AND locks the bucket.
export const OTP_WRONG_LIMIT = 5;
export const TOTP_WRONG_LIMIT = 5;
export const TOTP_FAILURE_LIMIT = 5;

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
