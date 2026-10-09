import { AppError } from '../common/app-errors';
import { AppEnvironment } from '../config/app-config';
import { PhoneAllowlist } from '../config/staging-fixtures-config';

// Account origin policy (M00-D2, docs/tasks/M00-D2-staging-fixtures.md sections 3 and 4).
//
// users.account_origin says HOW an account came to exist: PHONE_VERIFIED (registered through a real OTP proof)
// or STAGING_FIXTURE (created by the operator seed command on staging; its phone number was never proven). The
// value is read from the database and never from a client. One policy object decides, for BOTH origins, whether
// an account may authenticate in THIS process, and the same decision is applied at login, at bearer
// authentication and again, under the row locks, inside the participant that authorizes every command and /me.
//
// The decision depends on the process (APP_ENV, fixture mode, allowlist) and on the row (origin, phone), nothing
// else. Production can never allow a fixture: createAccountOriginPolicy only ever enables fixture mode for
// APP_ENV=staging, whatever else is passed in.

export type AccountOrigin = 'PHONE_VERIFIED' | 'STAGING_FIXTURE';

/** Display value on login and /me. It is NOT an authorization source: the database row is. */
export type PhoneVerificationStatus = 'VERIFIED' | 'UNVERIFIED_TEST';

export const ACCOUNT_ORIGINS: readonly AccountOrigin[] = Object.freeze(['PHONE_VERIFIED', 'STAGING_FIXTURE']);

export function isAccountOrigin(value: unknown): value is AccountOrigin {
  return value === 'PHONE_VERIFIED' || value === 'STAGING_FIXTURE';
}

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
  /** May this account authenticate in this process right now? */
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
    if (subject.accountOrigin === 'PHONE_VERIFIED') {
      // Fixture mode is a closed testing mode: accounts that registered through a proof are not used in it.
      return !this.fixtureMode;
    }
    if (subject.accountOrigin === 'STAGING_FIXTURE') {
      return this.fixtureMode && this.allowed.has(subject.phoneNormalized);
    }
    // An origin the code does not know (a future value, or corrupted data) is never accepted.
    return false;
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
