import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../transaction/transaction-context';
import { OWNER_MEMBER_ROLE, OwnerShopEligibility, ShopStatus } from './shop-types';

/**
 * The read-only Shop eligibility/status port M02 offers to Auth (M01-A2S). It is the ONLY way Auth learns
 * anything about shops: Auth never issues SQL against M02 tables. It reads, locks nothing and writes nothing.
 *
 * Consistency: every writer of a shop's status (A2S completion) first locks the owner's user row, and Auth's
 * role selection holds that same lock while it calls this port, so the answer cannot change under it. A later
 * slice that changes shop status (suspension, for instance) must take the user lock first too.
 */
@Injectable()
export class ShopEligibilityReader {
  /**
   * How far the user got with Shop onboarding and whether the user owns an ACTIVE shop.
   * - no OWNER membership          -> NOT_STARTED, not selectable
   * - INCOMPLETE shop              -> INCOMPLETE, not selectable
   * - ACTIVE shop                  -> COMPLETED, selectable
   * - DISABLED shop                -> COMPLETED (onboarding was finished), not selectable
   */
  async ownerShopEligibility(context: TransactionContext, userId: string): Promise<OwnerShopEligibility> {
    const result = await context.query<{ status: ShopStatus }>(
      `SELECT s.status
         FROM app.shop_members m
         JOIN app.shops s ON s.shop_id = m.shop_id
        WHERE m.user_id = $1::uuid AND m.member_role = $2`,
      [userId, OWNER_MEMBER_ROLE],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return { onboarding: 'NOT_STARTED', selectable: false };
    }
    if (row.status === 'INCOMPLETE') {
      return { onboarding: 'INCOMPLETE', selectable: false };
    }
    return { onboarding: 'COMPLETED', selectable: row.status === 'ACTIVE' };
  }
}
