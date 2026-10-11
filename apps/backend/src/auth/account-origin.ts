import { AppError } from '../common/app-errors';
import { AppEnvironment } from '../config/app-config';
import { PhoneAllowlist } from '../config/staging-fixtures-config';

// Account origin policy (M00-D2 reconciled with the administration Auth of main, issue #49).
//
// users.account_origin says HOW an account came to exist:
//   PHONE_VERIFIED     registered through a real OTP proof (the application accounts: customer/shop/driver);
//   ADMIN_PROVISIONED  created for the administration web (SYSTEM bootstrap, invitation activation). It is NOT
//                      phone-verified, and it never signs in through the application Auth;
//   STAGING_FIXTURE    created by the operator seed command on staging; its phone number was never proven.
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

export type AccountOrigin = 'PHONE_VERIFIED' | 'ADMIN_PROVISIONED' | 'STAGING_FIXTURE';

/** Display value on login and /me. It is NOT an authorization source: the database row is. */
export type PhoneVerificationStatus = 'VERIFIED' | 'UNVERIFIED_TEST';

export const ACCOUNT_ORIGINS: readonly AccountOrigin[] = Object.freeze([
  'PHONE_VERIFIED',
  'ADMIN_PROVISIONED',
  'STAGING_FIXTURE',
]);

export function isAccountOrigin(value: unknown): value is AccountOrigin {
  return value === 'PHONE_VERIFIED' || value === 'ADMIN_PROVISIONED' || value === 'STAGING_FIXTURE';
}

/** Only a staging fixture is "unverified"; everything the application Auth accepts otherwise is a verified account. */
export function phoneVerificationStatusOf(origin: AccountOrigin): PhoneVerificationStatus {
  return origin === 'STAGING_FIXTURE' ? 'UNVERIFIED_TEST' : 'VERIFIED';
}

/** What the policy needs from a user row. */
export interface PolicySubject {
  readonly accountOrigin: AccountOrigin;
  readonly phoneNormalized: string;
}

export interface AccountOriginPolicy {
  /** True only for APP_ENV=staging with the fixture mode switched on. */
  readonly fixtureMode: boolean;
  /** May this account authenticate through the application Auth in this process right now? */
  allows(subject: PolicySubject): boolean;
  /** OTP request/verify and register are closed while the fixture mode is on. */
  assertRegistrationOpen(): void;
}

export interface AccountOriginPolicyInput {
  readonly appEnv: AppEnvironment | undefined;
  readonly fixtureModeEnabled: boolean;
  readonly allowedPhones: PhoneAllowlist | undefined;
}

class Policy implements AccountOriginPolicy {
  constructor(
    readonly fixtureMode: boolean,
    private readonly allowed: PhoneAllowlist,
  ) {}

  allows(subject: PolicySubject): boolean {
    switch (subject.accountOrigin) {
      case 'PHONE_VERIFIED':
        // Fixture mode is a closed testing mode: accounts that registered through a proof are not used in it.
        return !this.fixtureMode;
      case 'STAGING_FIXTURE':
        return this.fixtureMode && this.allowed.has(subject.phoneNormalized);
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
  return new Policy(active, active ? (input.allowedPhones ?? NO_PHONES) : NO_PHONES);
}

/** The policy of every process without fixture mode: verified accounts only, no fixture, registration open. */
export function standardAccountOriginPolicy(): AccountOriginPolicy {
  return new Policy(false, NO_PHONES);
}

/** Injection token of the policy. */
export const ACCOUNT_ORIGIN_POLICY = Symbol('ACCOUNT_ORIGIN_POLICY');
