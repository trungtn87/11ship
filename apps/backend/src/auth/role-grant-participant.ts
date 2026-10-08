import { Injectable } from '@nestjs/common';
import { AppError, TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { UserRepository } from './user-repository';

/**
 * The only roles an onboarding coordinator may ask Auth to grant: SHOP (A2S) and DRIVER (A2D). It is a literal
 * type on purpose: Auth stays the sole writer of user_roles, and this participant offers no way to grant ADMIN,
 * SYSTEM or any other privilege. Each slice that needs another role widens the type deliberately.
 */
export type GrantableRole = 'SHOP' | 'DRIVER';

const GRANTABLE_ROLES: readonly string[] = ['SHOP', 'DRIVER'];

/**
 * The narrow M01 participant an onboarding coordinator uses (M01-A2S). It is a PARTICIPANT, not a coordinator:
 * both methods receive the caller's existing TransactionContext and nothing else. It has no pool, no
 * transaction manager and no way to open, commit or roll back a transaction, so a role can only ever be
 * granted together with the business change that earned it, and can only roll back with it.
 */
@Injectable()
export class RoleGrantParticipant {
  constructor(private readonly users: UserRepository) {}

  /**
   * Step 2 of the A2 lock order: takes the user row FOR UPDATE and re-checks, after the lock, that the account
   * is still ACTIVE. The user lock is what serializes every command of one user (concurrent profile creates,
   * two completions, and role selection), so the rows below it are read in a stable state.
   */
  async lockActiveUser(context: TransactionContext, userId: string): Promise<void> {
    const user = await this.users.lockById(context, userId);
    if (user === undefined) {
      throw new AppError('SESSION_INVALID');
    }
    if (user.status !== 'ACTIVE') {
      throw new AppError('ACCOUNT_DISABLED');
    }
  }

  /**
   * Grants the role idempotently (no error when the user already holds it). Returns true when this call
   * created the grant. Requires the caller to hold the user lock from lockActiveUser.
   */
  async grant(context: TransactionContext, userId: string, role: GrantableRole): Promise<boolean> {
    if (!GRANTABLE_ROLES.includes(role)) {
      // A programming error of the caller (the type forbids it), never client input.
      throw new TechnicalError('internal', 'Role cannot be granted through this participant');
    }
    return this.users.grantRole(context, userId, role);
  }
}
