import { Injectable } from '@nestjs/common';
import { isCanonicalUuid } from '../shared/identifiers';
import { TransactionContext } from '../transaction/transaction-context';
import { AccountOrigin, UserRepository, UserStatus } from './user-repository';

/** What the administration module may know about an account. Nothing here grants a right. */
export interface AdminIdentity {
  readonly userId: string;
  readonly phoneNormalized: string;
  /** The current Argon2id PHC string. The administration module only feeds it to AdminPasswordVerifier and to its
   *  keyed password binding; it never stores, logs or returns it. */
  readonly passwordHash: string;
  readonly status: UserStatus;
  readonly accountOrigin: AccountOrigin;
}

/**
 * Narrow, Auth-owned access to app.users for the administration module (M01-D-LOGIN). All SQL against app.users
 * stays in UserRepository; the administration repositories only write administration tables. It is a PARTICIPANT:
 * it receives the caller's TransactionContext, opens no transaction and never nests one.
 */
@Injectable()
export class AdminIdentityParticipant {
  constructor(private readonly users: UserRepository) {}

  /** Plain read by normalized phone (no lock): the precheck before the password is verified outside a transaction. */
  async findByPhone(context: TransactionContext, phoneNormalized: string): Promise<AdminIdentity | undefined> {
    return this.users.findByPhone(context, phoneNormalized);
  }

  /** The account row FOR UPDATE: the writer lock of the administration lock order (user, then membership...). */
  async lockById(context: TransactionContext, userId: string): Promise<AdminIdentity | undefined> {
    return isCanonicalUuid(userId) ? this.users.lockById(context, userId) : undefined;
  }

  /** The account row FOR SHARE, for administration readers that must see one coherent password/status state. */
  async lockByIdShared(context: TransactionContext, userId: string): Promise<AdminIdentity | undefined> {
    return isCanonicalUuid(userId) ? this.users.lockByIdForShare(context, userId) : undefined;
  }

  /**
   * Operator bootstrap: creates the ACTIVE, ADMIN_PROVISIONED, not-phone-verified account. Returns false when the
   * phone already belongs to an account. Nothing else is written (no role, no proof, no verification time).
   */
  async insertProvisioned(
    context: TransactionContext,
    input: { userId: string; phoneNormalized: string; passwordHash: string },
  ): Promise<boolean> {
    return this.users.insertAdminProvisioned(context, input);
  }
}
