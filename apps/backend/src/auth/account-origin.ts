import { AppEnvironment } from '../config/app-config';

// Account origin policy (M00-D2 reconciled with the administration Auth of main, issue #49).
//
// users.account_origin says HOW an account came to exist:
//   PHONE_VERIFIED     registered through a real OTP proof (the application accounts: customer/shop/driver);
//   ADMIN_PROVISIONED  created for the administration web (SYSTEM bootstrap, invitation activation). It is NOT
//                      phone-verified, and it never signs in through the application Auth;
//   STAGING_FIXTURE    LEGACY value (staging fixture mode was removed, Owner 2026-11-07). The database CHECK still allows it and
//                      an old row may exist; the policy never accepts it and nothing creates it any more;
//   TEST_UNVERIFIED    registered through the client API with CLIENT_AUTH_PHONE_VERIFICATION_MODE=DISABLED_TEST (development/
//                      test on loopback only): its phone number was never proven and nothing pretends it was
//                      (phone_verified_at stays NULL). Accepted by the application Auth ONLY while that mode is on.
//   PHONE_UNVERIFIED   registered while the SYSTEM setting otp_registration_enabled was OFF (Owner decision 2026-10-14): the
//                      phone number was never proven (phone_verified_at stays NULL). A normal application account in every other
//                      respect, accepted in every mode; it carries NO privilege.
// The value is read from the database and never from a client. It carries NO privilege: administration rights come
// only from app.admin_memberships (+ MFA), which the database refuses for every origin except ADMIN_PROVISIONED.
//
// One policy object decides, for EVERY origin, whether an account may authenticate through the APPLICATION Auth in
// THIS process, and the same decision is applied at login, at bearer authentication and again, under the row locks,
// inside the participant that authorizes every command and /me. The decision depends on the process (APP_ENV, the no-proof
// test mode) and on the row (origin), nothing else.
//
// The policy governs the application Auth only. The administration web authenticates through its own module and
// accepts ADMIN_PROVISIONED accounts only.

export type AccountOrigin = 'PHONE_VERIFIED' | 'ADMIN_PROVISIONED' | 'STAGING_FIXTURE' | 'TEST_UNVERIFIED' | 'PHONE_UNVERIFIED';

/** Display value on login and /me. It is NOT an authorization source: the database row is. */
export type PhoneVerificationStatus = 'VERIFIED' | 'UNVERIFIED_TEST' | 'UNVERIFIED';

export const ACCOUNT_ORIGINS: readonly AccountOrigin[] = Object.freeze([
  'PHONE_VERIFIED',
  'ADMIN_PROVISIONED',
  'STAGING_FIXTURE',
  'TEST_UNVERIFIED',
  'PHONE_UNVERIFIED',
]);

export function isAccountOrigin(value: unknown): value is AccountOrigin {
  return (
    value === 'PHONE_VERIFIED' ||
    value === 'ADMIN_PROVISIONED' ||
    value === 'STAGING_FIXTURE' ||
    value === 'TEST_UNVERIFIED' ||
    value === 'PHONE_UNVERIFIED'
  );
}

/** A test-unverified (or legacy fixture) account is "unverified"; the rest the application Auth accepts is verified. */
export function phoneVerificationStatusOf(origin: AccountOrigin): PhoneVerificationStatus {
  if (origin === 'PHONE_UNVERIFIED') {
    return 'UNVERIFIED';
  }
  return origin === 'STAGING_FIXTURE' || origin === 'TEST_UNVERIFIED' ? 'UNVERIFIED_TEST' : 'VERIFIED';
}

/** What the customer eligibility read knows about a row (see CustomerProfileRepository). */
export interface CustomerOriginFacts {
  readonly accountOrigin: string;
  readonly phoneVerified: boolean;
  readonly hasAdminMembership: boolean;
}

/**
 * The ONE row-shape rule of an ordinary client account, shared by registration, login, replay, bearer sessions and the
 * CUSTOMER participant: PHONE_VERIFIED with a verification time, or TEST_UNVERIFIED / PHONE_UNVERIFIED without one, and never an
 * administration membership. A TEST_UNVERIFIED row that carries a verification time (or a PHONE_VERIFIED one that lacks it)
 * is corrupt and refused. Whether the process may serve the origin right now is the policy's `allows`, not this function.
 */
export function isOrdinaryClientAccount(facts: CustomerOriginFacts): boolean {
  if (facts.hasAdminMembership) {
    return false;
  }
  if (facts.accountOrigin === 'PHONE_VERIFIED') {
    return facts.phoneVerified;
  }
  if (facts.accountOrigin === 'TEST_UNVERIFIED' || facts.accountOrigin === 'PHONE_UNVERIFIED') {
    return !facts.phoneVerified;
  }
  return false;
}

/** The origins a client login may even try (the password of any other origin is never verified). */
export function isClientLoginOrigin(origin: AccountOrigin): boolean {
  return origin === 'PHONE_VERIFIED' || origin === 'TEST_UNVERIFIED' || origin === 'PHONE_UNVERIFIED';
}

/** What the policy needs from a user row. */
export interface PolicySubject {
  readonly accountOrigin: AccountOrigin;
  readonly phoneNormalized: string;
}

export interface AccountOriginPolicy {
  /** True only for APP_ENV=development|test with the client phone verification mode DISABLED_TEST. */
  readonly unverifiedTestMode: boolean;
  /** May this account authenticate through the application Auth in this process right now? */
  allows(subject: PolicySubject): boolean;
}

export interface AccountOriginPolicyInput {
  readonly appEnv: AppEnvironment | undefined;
  /** CLIENT_AUTH_PHONE_VERIFICATION_MODE=DISABLED_TEST was selected (startup already limits it to development/test on loopback). */
  readonly unverifiedTestModeEnabled?: boolean;
}

class Policy implements AccountOriginPolicy {
  constructor(readonly unverifiedTestMode: boolean = false) {}

  allows(subject: PolicySubject): boolean {
    switch (subject.accountOrigin) {
      case 'PHONE_VERIFIED':
      case 'PHONE_UNVERIFIED':
        // PHONE_UNVERIFIED is a normal application account whose phone was never proven (Owner decision 2026-10-14).
        return true;
      case 'STAGING_FIXTURE':
        // Legacy value of a removed mode: such an account is never served, whatever the process.
        return false;
      case 'TEST_UNVERIFIED':
        // Only while the no-proof test mode is on in this process; with it off (or in staging/production) the account and
        // every token it ever got are simply not accepted. It never becomes PHONE_VERIFIED by being refused or accepted.
        return this.unverifiedTestMode;
      case 'ADMIN_PROVISIONED':
        // An administration account has no application session, whatever the mode is.
        return false;
      default:
        // An origin the code does not know (a future value, or corrupted data) is never accepted.
        return false;
    }
  }
}

/**
 * Builds the policy of this process. The no-proof test mode is honoured ONLY for development/test, whatever else is passed in
 * (startup configuration additionally refuses it elsewhere, so this is the second, independent barrier).
 */
export function createAccountOriginPolicy(input: AccountOriginPolicyInput): AccountOriginPolicy {
  const unverifiedTest =
    (input.appEnv === 'development' || input.appEnv === 'test') && input.unverifiedTestModeEnabled === true;
  return new Policy(unverifiedTest);
}

/** The policy of every process without the no-proof test mode: verified and unverified-phone accounts only. */
export function standardAccountOriginPolicy(): AccountOriginPolicy {
  return new Policy(false);
}

/** Injection token of the policy. */
export const ACCOUNT_ORIGIN_POLICY = Symbol('ACCOUNT_ORIGIN_POLICY');
