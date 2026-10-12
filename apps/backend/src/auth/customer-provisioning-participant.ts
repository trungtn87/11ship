import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { isCanonicalUuid } from '../shared/identifiers';
import { TransactionContext } from '../transaction/transaction-context';
import {
  CONSENT_CLIENT_APPS,
  CONSENT_VERSION_PATTERN,
  ConsentClientApp,
  CUSTOMER_ROLE,
} from './auth-constants';
import { CustomerProfileRepository } from './customer-profile-repository';
import { UserRepository } from './user-repository';

/** One acceptance to record together with the customer role. Versions are the pair the server publishes. */
export interface CustomerConsentInput {
  readonly termsVersion: string;
  readonly privacyVersion: string;
  readonly clientApp: ConsentClientApp;
}

/** Optional initialization of the profile of a NEW customer (M01.03). It never touches an existing profile. */
export interface CustomerProvisioningOptions {
  /** The already normalized full name (NFC, collapsed whitespace, 1..120 code points), written with version 1. */
  readonly initialFullName?: string;
}

export interface CustomerProvisioningResult {
  /** True when this call created the CUSTOMER role row. */
  readonly roleGranted: boolean;
  /** True when this call created the (empty) profile. */
  readonly profileCreated: boolean;
  /** True when this call wrote the consent row; false when no consent was asked for or it already existed. */
  readonly consentRecorded: boolean;
}

/**
 * The M01.02 participant that gives an ordinary phone-verified user the CUSTOMER storage role, an empty customer profile
 * and, when asked, one consent row. It is a PARTICIPANT, not a coordinator: it receives the caller's existing
 * TransactionContext and nothing else. It has no pool, no transaction manager and no way to open, commit or roll back a
 * transaction, so everything it writes commits or rolls back with the caller's business change (for example a register
 * that also creates the user, the session, the audit row and the outbox event).
 *
 * It does not authorize the caller and it does not create the user. It re-checks the one thing it must never get wrong:
 * the target account is an ordinary PHONE_VERIFIED account with a verification time and no administration membership
 * at all. Anything else is refused as a programming error of the caller (never client input), before any write.
 *
 * Locking: it takes the ROOT user row lock through CustomerProfileRepository.lockEligibility, which is re-entrant for a
 * transaction that already holds it and takes no other lock, so the existing lock order is unchanged.
 *
 * It is idempotent: a repeat adds no row and overwrites no name, version or earlier consent. The optional initial name
 * (M01.03) is written ONLY into a profile this call creates, with version 1; an existing profile keeps its name and version. It issues no endpoint, no
 * session change and no audit/outbox row; those belong to the later register slice.
 */
@Injectable()
export class CustomerProvisioningParticipant {
  constructor(
    private readonly users: UserRepository,
    private readonly customers: CustomerProfileRepository,
  ) {}

  async provision(
    context: TransactionContext,
    userId: string,
    consent?: CustomerConsentInput,
    options: CustomerProvisioningOptions = {},
  ): Promise<CustomerProvisioningResult> {
    // Shape errors first: nothing is read or written for an input the caller should never have built.
    if (!isCanonicalUuid(userId)) {
      throw new TechnicalError('internal', 'Customer provisioning needs a canonical user id');
    }
    if (consent !== undefined && !isValidConsent(consent)) {
      throw new TechnicalError('internal', 'Customer provisioning got an invalid consent input');
    }
    if (options.initialFullName !== undefined && !isValidInitialName(options.initialFullName)) {
      throw new TechnicalError('internal', 'Customer provisioning got an invalid initial name');
    }

    const eligibility = await this.customers.lockEligibility(context, userId);
    if (
      eligibility === undefined ||
      eligibility.accountOrigin !== 'PHONE_VERIFIED' ||
      !eligibility.phoneVerified ||
      eligibility.hasAdminMembership
    ) {
      throw new TechnicalError('internal', 'Account is not eligible for the customer role');
    }

    const roleGranted = await this.users.grantRole(context, userId, CUSTOMER_ROLE);
    // Without a name the call is exactly the M01.02 one (the empty profile); with one it initializes the NEW profile.
    const profileCreated =
      options.initialFullName === undefined
        ? await this.customers.insertProfileIfAbsent(context, userId)
        : await this.customers.insertProfileIfAbsent(context, userId, options.initialFullName);
    const consentRecorded =
      consent === undefined
        ? false
        : await this.customers.insertConsentIfAbsent(context, {
            consentId: randomUUID(),
            userId,
            termsVersion: consent.termsVersion,
            privacyVersion: consent.privacyVersion,
            clientApp: consent.clientApp,
          });

    return { roleGranted, profileCreated, consentRecorded };
  }
}

/** The service normalizes the name before it gets here; this only refuses what the schema CHECK would refuse anyway. */
function isValidInitialName(name: string): boolean {
  if (typeof name !== 'string') {
    return false;
  }
  const length = [...name].length;
  return length >= 1 && length <= 120;
}

function isValidConsent(consent: CustomerConsentInput): boolean {
  return (
    typeof consent.termsVersion === 'string' &&
    CONSENT_VERSION_PATTERN.test(consent.termsVersion) &&
    typeof consent.privacyVersion === 'string' &&
    CONSENT_VERSION_PATTERN.test(consent.privacyVersion) &&
    (CONSENT_CLIENT_APPS as readonly string[]).includes(consent.clientApp)
  );
}
