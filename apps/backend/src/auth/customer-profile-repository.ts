import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../transaction/transaction-context';
import { ConsentClientApp } from './auth-constants';

/** What the customer participant needs to know about a user before it grants anything. */
export interface CustomerEligibility {
  readonly accountOrigin: string;
  readonly phoneVerified: boolean;
  readonly hasAdminMembership: boolean;
}

interface RawEligibility {
  account_origin: string;
  phone_verified: boolean;
  has_admin_membership: boolean;
}

export interface ConsentRecord {
  readonly consentId: string;
  readonly userId: string;
  readonly termsVersion: string;
  readonly privacyVersion: string;
  readonly clientApp: ConsentClientApp;
}

/**
 * SQL for app.customer_profiles and app.user_consents (M01.02). Every method receives the caller's
 * TransactionContext; none opens, commits or rolls back a transaction. Nothing here decides WHO may become a customer
 * (CustomerProvisioningParticipant does) and nothing deletes or updates a consent (the schema forbids both).
 */
@Injectable()
export class CustomerProfileRepository {
  /**
   * Takes the ROOT user row lock (FOR UPDATE) and reads what decides eligibility in one statement. The lock is
   * re-entrant for a transaction that already holds it (the normal case) and no other lock is taken, so the existing
   * lock order is untouched. Returns undefined when the user does not exist.
   */
  async lockEligibility(context: TransactionContext, userId: string): Promise<CustomerEligibility | undefined> {
    const result = await context.query<RawEligibility>(
      `SELECT u.account_origin,
              (u.phone_verified_at IS NOT NULL) AS phone_verified,
              EXISTS (SELECT 1 FROM app.admin_memberships m WHERE m.user_id = u.user_id) AS has_admin_membership
         FROM app.users u
        WHERE u.user_id = $1::uuid
          FOR UPDATE OF u`,
      [userId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return undefined;
    }
    return {
      accountOrigin: row.account_origin,
      phoneVerified: row.phone_verified,
      hasAdminMembership: row.has_admin_membership,
    };
  }

  /**
   * Creates the empty profile (full_name NULL, version 1) unless one exists. An existing profile is never touched, so a
   * repeat can neither duplicate it nor overwrite a name or a version. True when this call created it.
   */
  async insertProfileIfAbsent(context: TransactionContext, userId: string): Promise<boolean> {
    const result = await context.query(
      `INSERT INTO app.customer_profiles (user_id) VALUES ($1::uuid)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId],
    );
    return result.rowCount === 1;
  }

  /**
   * Appends one acceptance unless the user already accepted exactly this pair of versions. accepted_at is the database
   * time (never client input). True when this call wrote the row.
   */
  async insertConsentIfAbsent(context: TransactionContext, input: ConsentRecord): Promise<boolean> {
    const result = await context.query(
      `INSERT INTO app.user_consents (id, user_id, terms_version, privacy_version, accepted_at, client_app)
       VALUES ($1::uuid, $2::uuid, $3, $4, transaction_timestamp(), $5)
       ON CONFLICT (user_id, terms_version, privacy_version) DO NOTHING`,
      [input.consentId, input.userId, input.termsVersion, input.privacyVersion, input.clientApp],
    );
    return result.rowCount === 1;
  }
}
