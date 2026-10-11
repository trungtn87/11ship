// Fixed vocabulary and constants of Auth Core (M01-A1). Nothing here is configuration: the values are part of
// the locked contract (ADR-002, ADR-003 section 13 and docs/tasks/M01-A1-auth-core.md) and are deliberately
// not readable from the environment.

/**
 * The business roles A1 may select. PLATFORM and EXTERNAL are driver classifications and ADMIN/SYSTEM are
 * administrative levels: none of them is an Auth role, and none can be selected through role/select.
 * Sorted, so the list can be returned as is.
 */
export const SUPPORTED_ROLES = ['DRIVER', 'SHOP'] as const;
export type SupportedRole = (typeof SUPPORTED_ROLES)[number];

export function isSupportedRole(value: unknown): value is SupportedRole {
  return typeof value === 'string' && (SUPPORTED_ROLES as readonly string[]).includes(value);
}

/**
 * M01.02: the storage role of a customer. It is deliberately NOT part of SUPPORTED_ROLES: the legacy /auth routes
 * (login, me, role/select) keep offering exactly DRIVER and SHOP, so a CUSTOMER row is invisible to them. SHOP stays the
 * storage name of the shop owner; SHOP_OWNER is a public alias of the new client API only and is never stored.
 */
export const CUSTOMER_ROLE = 'CUSTOMER';

/** M01.02: the client apps a consent row may name. Mirrors the schema CHECK user_consents_client_app_ck. */
export const CONSENT_CLIENT_APPS = ['FOOD', 'SHIP'] as const;
export type ConsentClientApp = (typeof CONSENT_CLIENT_APPS)[number];

/** M01.02: grammar of one consent version token. Mirrors the schema CHECKs on terms_version and privacy_version. */
export const CONSENT_VERSION_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/** The only verification purpose A1 issues. */
export const REGISTER_PURPOSE = 'REGISTER';

/** OTP: exactly this many ASCII digits, drawn from the operating system CSPRNG. */
export const OTP_LENGTH = 6;

/** Opaque tokens (verification proof, session access token): 32 CSPRNG bytes, base64url, no padding. */
export const TOKEN_BYTES = 32;
export const TOKEN_LENGTH = 43;

/** Domain separators (versioned, so a future change cannot collide with these derivations). */
export const OTP_REQUEST_LOCK_DOMAIN = '11ship.auth.otp.request.v1';
export const OTP_DIGEST_DOMAIN = '11ship.auth.otp.v1';

/** Idempotency identity of register (ADR-003 section 3.1 and 13.2). */
export const REGISTER_SCOPE_TYPE = 'verification_proof';
export const REGISTER_OPERATION_ID = 'auth.register.v1';

/** Password length bounds, in characters (code points), as specified by docs 4.2 section 2.4. */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Upper bound of one OTP provider call. The provider is called outside any transaction, so a hung provider
 * holds no database resource; the bound only keeps one request from waiting forever. It is an
 * infrastructure safety limit, not a business threshold, and is not configurable.
 */
export const OTP_PROVIDER_TIMEOUT_MS = 5000;

/** Audit action names (dotted, versioned). */
export const AUDIT_ACTIONS = Object.freeze({
  register: 'auth.register.v1',
  login: 'auth.login.v1',
  roleSelect: 'auth.role_select.v1',
  otpVerify: 'auth.otp_verify.v1',
  sessionRevoke: 'auth.session_revoke.v1',
  stagingFixtureCreated: 'auth.staging_fixture_created.v1',
});

/**
 * M00-D2 staging fixture seed. The advisory-lock domain serializes every seed run (one fixed key); the audit actor
 * is a FIXED operator label, never a user and never SYSTEM: the operator holds no authority in the product.
 */
export const STAGING_SEED_LOCK_DOMAIN = '11ship.auth.staging_seed.v1';
export const STAGING_SEED_ACTOR_TYPE = 'OPERATOR';
export const STAGING_SEED_ACTOR_ID = 'staging-seed-cli';

/** Outbox event of a completed registration. */
export const USER_REGISTERED_EVENT_TYPE = 'auth.user_registered.v1';
export const USER_REGISTERED_EVENT_SCHEMA_VERSION = 1;
