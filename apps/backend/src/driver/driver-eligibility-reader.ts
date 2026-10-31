import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../transaction/transaction-context';
import { DriverOnboardingState, DriverStatus, OwnerDriverEligibility } from './driver-types';

const ONBOARDING_STATE_OF: Readonly<Record<DriverStatus, DriverOnboardingState>> = Object.freeze({
  PENDING: 'PENDING_APPROVAL',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  CLOSING: 'CLOSING',
  CLOSED: 'CLOSED',
});

/**
 * The read-only Driver eligibility/status port M03 offers to Auth (M01-A2D). It is the ONLY way Auth learns
 * anything about drivers: Auth never issues SQL against M03 tables. It reads, locks nothing and writes nothing.
 *
 * Consistency: every writer of a driver's existence or status first locks the owner's user row (A2D creation
 * does), and Auth's role selection and /auth/me hold that same lock (FOR UPDATE and FOR SHARE) while they call
 * this port, so the answer cannot change under them. A later slice that changes a driver's status (approval,
 * suspension, closure) must take the user lock first too, or this guarantee is gone.
 */
@Injectable()
export class DriverEligibilityReader {
  /**
   * How far the user got with Driver onboarding and whether the Driver profile may be selected.
   * - no Driver profile           -> NOT_STARTED, not selectable
   * - PENDING                     -> PENDING_APPROVAL, selectable (the driver app shows the status)
   * - ACTIVE / SUSPENDED / CLOSING -> as named, selectable
   * - CLOSED                      -> CLOSED (onboarding was finished), not selectable
   */
  async ownerDriverEligibility(context: TransactionContext, userId: string): Promise<OwnerDriverEligibility> {
    const result = await context.query<{ status: DriverStatus }>(
      `SELECT status
         FROM app.drivers
        WHERE user_id = $1::uuid`,
      [userId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return { onboarding: 'NOT_STARTED', selectable: false };
    }
    return { onboarding: ONBOARDING_STATE_OF[row.status], selectable: row.status !== 'CLOSED' };
  }

  /** The id of the user's driver profile in ANY status, or undefined: the account lifecycle resolves the shipper side of an account through this port. */
  async driverIdOf(context: TransactionContext, userId: string): Promise<string | undefined> {
    const result = await context.query<{ driver_id: string }>('SELECT driver_id FROM app.drivers WHERE user_id = $1::uuid', [userId]);
    return result.rows[0]?.driver_id;
  }

  /** Does the user have a driver profile in ANY status? The account lifecycle reads this as "the account has business data" (never deleted, locked). */
  async hasProfile(context: TransactionContext, userId: string): Promise<boolean> {
    const result = await context.query('SELECT 1 FROM app.drivers WHERE user_id = $1::uuid LIMIT 1', [userId]);
    return result.rows.length > 0;
  }
}
