import { AppError } from '../common/app-errors';
import { AppEnvironment } from '../config/app-config';
import { PhoneAllowlist } from '../config/staging-fixtures-config';

// Account origin policy (M00-D2 reconciled with the administration Auth of main, issue #49).
//
// users.account_origin says HOW an account came to exist:
//   PHONE_VERIFIED     registered through a real OTP proof (the application accounts: customer/shop/driver);
//   ADMIN_PROVISIONED  created for the administration web (SYSTEM bootstrap, invitation activation). It is NOT
//                      phone-verified, and it never signs in through the application Auth;
//   STAGING_FIXTURE    created by the operator seed command on staging; its phone number was never proven;
//   TEST_UNVERIFIED    registered through the client API with CLIENT_AUTH_PHONE_VERIFICATION_MODE=DISABLED_TEST (development/
//                      test on loopback only): its phone number was never proven and nothing pretends it was
//                      (phone_verified_at stays NULL). Accepted by the application Auth ONLY while that mode is on.
//   PHONE_UNVERIFIED   registered while the SYSTEM setting otp_registration_enabled was OFF (Owner decision 2026-10-14): the
//                      phone number was never proven (phone_verified_at stays NULL). A normal application account in every other
//                      respect, accepted in every mode but the staging fixture mode; it carries NO privilege.
// The value is read from the database and never from a client. It carries NO privilege: administration rights come
// only from app.admin_memberships (+ MFA), which the database refuses for every origin except ADMIN_PROVISIONED.
//
// One policy object decides, for EVERY origin, whether an account may authenticate through the APPLICATION Auth in
// THIS process, and the same decision is applied at login, at bearer authentication and again, under the row locks,
// inside the participant that authorizes every command and /me. The decision depends on the process (APP_ENV,
// fixture mode, allowlist) and on the row (origin, phone), nothing else. Production can never allow a fixture:
// createAccountOriginPolicy only ever enables fixture mode for APP_ENV=staging, whatever else is passed in.
//
// The policy governs the application Auth only. The administration web authenticates through its own module and
// accepts ADMIN_PROVISIONED accounts only; a fixture is refused there as well.

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

/** A staging fixture and a test-unverified account are "unverified"; the rest the application Auth accepts is verified. */
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
  /** True only for APP_ENV=staging with the fixture mode switched on. */
  readonly fixtureMode: boolean;
  /** True only for APP_ENV=development|test with the client phone verification mode DISABLED_TEST. */
  readonly unverifiedTestMode: boolean;
  /** May this account authenticate through the application Auth in this process right now? */
  allows(subject: PolicySubject): boolean;
  /** OTP request/verify and register are closed while the fixture mode is on. */
  assertRegistrationOpen(): void;
}

export interface AccountOriginPolicyInput {
  readonly appEnv: AppEnvironment | undefined;
  readonly fixtureModeEnabled: boolean;
  readonly allowedPhones: PhoneAllowlist | undefined;
  /** CLIENT_AUTH_PHONE_VERIFICATION_MODE=DISABLED_TEST was selected (startup already limits it to development/test on loopback). */
  readonly unverifiedTestModeEnabled?: boolean;
}

class Policy implements AccountOriginPolicy {
  constructor(
    readonly fixtureMode: boolean,
    private readonly allowed: PhoneAllowlist,
    readonly unverifiedTestMode: boolean = false,
  ) {}

  allows(subject: PolicySubject): boolean {
    switch (subject.accountOrigin) {
      case 'PHONE_VERIFIED':
        // Fixture mode is a closed testing mode: accounts that registered through a proof are not used in it.
        return !this.fixtureMode;
      case 'STAGING_FIXTURE':
        return this.fixtureMode && this.allowed.has(subject.phoneNormalized);
      case 'TEST_UNVERIFIED':
        // Only while the no-proof test mode is on in this process; with it off (or in staging/production) the account and
        // every token it ever got are simply not accepted. It never becomes PHONE_VERIFIED by being refused or accepted.
        return this.unverifiedTestMode;
      case 'PHONE_UNVERIFIED':
        // A normal application account whose phone was never proven; only the fixture mode (a closed testing mode) refuses it.
        return !this.fixtureMode;
      case 'ADMIN_PROVISIONED':
        // An administration account has no application session, whatever the mode is.
        return false;
      default:
        // An origin the code does not know (a future value, or corrupted data) is never accepted.
        return false;
    }
  }

  assertRegistrationOpen(): void {
    if (this.fixtureMode) {
      throw new AppError('AUTH_REGISTRATION_UNAVAILABLE');
    }
  }
}

const NO_PHONES = new PhoneAllowlist([]);

/**
 * Builds the policy of this process. Fixture mode is honoured ONLY for APP_ENV=staging; for any other
 * environment (production, development, test, or unknown) the flag is ignored here as well, so a harness that
 * builds a policy by hand cannot open fixtures outside staging either. Startup configuration additionally
 * refuses the flag outside staging (loadConfig), so this is the second, independent barrier.
 */
export function createAccountOriginPolicy(input: AccountOriginPolicyInput): AccountOriginPolicy {
  const active = input.appEnv === 'staging' && input.fixtureModeEnabled && input.allowedPhones !== undefined;
  // Second, independent barrier of the no-proof test mode: it is honoured only for development/test, whatever else is passed.
  const unverifiedTest =
    (input.appEnv === 'development' || input.appEnv === 'test') && input.unverifiedTestModeEnabled === true;
  return new Policy(active, active ? (input.allowedPhones ?? NO_PHONES) : NO_PHONES, unverifiedTest);
}

/** The policy of every process without fixture mode: verified accounts only, no fixture, registration open. */
export function standardAccountOriginPolicy(): AccountOriginPolicy {
  return new Policy(false, NO_PHONES);
}

/** Injection token of the policy. */
export const ACCOUNT_ORIGIN_POLICY = Symbol('ACCOUNT_ORIGIN_POLICY');
