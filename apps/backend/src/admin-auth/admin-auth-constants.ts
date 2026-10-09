// Fixed contract values of the administration web authentication (M01-D-LOGIN). They are constants on purpose:
// none of them is readable from the environment, so no variable can silently loosen a gate.

export const ADMIN_SESSION_COOKIE = '__Host-11admin';
export const ADMIN_PREAUTH_COOKIE = '__Host-11admin-pre';

export const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60;
export const ADMIN_PREAUTH_TTL_SECONDS = 5 * 60;

export const ADMIN_PLATFORM = 'WEB';
export const ADMIN_APP = 'ADMIN_WEB';

export const CSRF_HEADER = 'x-csrf-token';

/** Ingress request quotas: fixed window from the first request, per client address, shared in PostgreSQL. */
export const LOGIN_REQUEST_LIMIT = 10;
export const TOTP_REQUEST_LIMIT = 30;
export const REQUEST_WINDOW_SECONDS = 60;

/** Failure budgets: fixed window from the first failure, then a lock for the same length. */
export const PASSWORD_FAILURE_LIMIT = 10;
export const PASSWORD_FAILURE_WINDOW_SECONDS = 15 * 60;
export const TOTP_FAILURE_LIMIT = 5;
export const TOTP_FAILURE_WINDOW_SECONDS = 15 * 60;
export const FAILURE_LOCK_SECONDS = 15 * 60;
/** Wrong codes one preauth step can take before it is consumed. */
export const CHALLENGE_ATTEMPT_LIMIT = 5;

/** TOTP (RFC 6238): SHA-1, 6 digits, 30 seconds, 20-byte secret, current and previous step accepted. */
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const TOTP_SECRET_BYTES = 20;
export const TOTP_ISSUER = '11ship';

export const LIMIT_KINDS = Object.freeze({
  loginPhone: 'LOGIN_PHONE',
  loginIp: 'LOGIN_IP',
  loginRequestIp: 'LOGIN_REQUEST_IP',
  totpUser: 'TOTP_USER',
  totpRequestIp: 'TOTP_REQUEST_IP',
});
export type LimitKind = (typeof LIMIT_KINDS)[keyof typeof LIMIT_KINDS];

export const ADMIN_ROLES = ['SYSTEM', 'ADMIN'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ADMIN_AUDIT_ACTIONS = Object.freeze({
  systemBootstrapped: 'admin_auth.system_bootstrapped.v1',
  loginPreauth: 'admin_auth.login_preauth.v1',
  totpEnrolled: 'admin_auth.totp_enrolled.v1',
  loginCompleted: 'admin_auth.login_completed.v1',
  logout: 'admin_auth.logout.v1',
});

/** Advisory-lock key text of the serialized operator commands (hashed by PostgreSQL). */
export const BOOTSTRAP_LOCK_KEY = '11ship.admin-auth.bootstrap.v1';
export const LIMIT_CONFIG_LOCK_KEY = '11ship.admin-auth.limit-config.v1';
