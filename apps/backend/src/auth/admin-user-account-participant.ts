import { Inject, Injectable } from '@nestjs/common';
import { isCanonicalUuid } from '../shared/identifiers';
import { TransactionContext } from '../transaction/transaction-context';
import { ACCOUNT_ORIGIN_POLICY, AccountOriginPolicy, isOrdinaryClientAccount } from './account-origin';
import { SessionRepository } from './session-repository';
import { AdminLockTargetRow, LockReason, UserRepository, UserStatus } from './user-repository';

/** An ordinary account (customer / shop / driver) as the administration lock sees it, locked by the caller's transaction. */
export interface OrdinaryAccount {
  readonly userId: string;
  readonly status: UserStatus;
  readonly version: number;
  /** The FULL set of role rows (storage names), not a projection narrowed to what the actor may view. */
  readonly roles: readonly string[];
  /** Why the account is locked (DISABLED rows only; older rows carry none). */
  readonly lockReason?: LockReason;
}

/**
 * The ONE decision "is this row an ordinary account the administration may lock", shared by the lock command, its replay
 * authorization and the allowed_actions hint of the detail: not an administration account, the row shape of an ordinary
 * client account, and an origin that THIS process's account origin policy accepts. A fixture or a test account the process
 * does not serve is not ordinary here, whatever its status says.
 */
export function isLockableAccount(policy: AccountOriginPolicy, row: Pick<AdminLockTargetRow, 'accountOrigin' | 'phoneNormalized' | 'phoneVerified' | 'hasAdminMembership'>): boolean {
  return (
    isOrdinaryClientAccount({ accountOrigin: row.accountOrigin, phoneVerified: row.phoneVerified, hasAdminMembership: row.hasAdminMembership }) &&
    policy.allows({ accountOrigin: row.accountOrigin, phoneNormalized: row.phoneNormalized })
  );
}

/**
 * Narrow, Auth-owned access to the users and sessions of ordinary accounts for the administration lock / unlock (M01-ADMIN,
 * D15). All SQL against app.users and app.sessions stays in their repositories. It is a PARTICIPANT: it receives the
 * caller's TransactionContext, opens no transaction and decides no right (the administration module authorizes).
 */
@Injectable()
export class AdminUserAccountParticipant {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    @Inject(ACCOUNT_ORIGIN_POLICY) private readonly policy: AccountOriginPolicy,
  ) {}

  /**
   * Locks the target (FOR UPDATE, or FOR SHARE for a replay check) and reads its full role set. Undefined for an id that does
   * not exist, an administration account and anything that is not an ordinary account of this process.
   */
  async lockOrdinary(context: TransactionContext, userId: string, mode: 'write' | 'read'): Promise<OrdinaryAccount | undefined> {
    if (!isCanonicalUuid(userId)) {
      return undefined;
    }
    const row = await this.users.lockAdminTarget(context, userId, mode);
    if (row === undefined || !isLockableAccount(this.policy, row)) {
      return undefined;
    }
    return {
      userId: row.userId,
      status: row.status,
      version: row.version,
      roles: await this.users.allRoles(context, userId),
      ...(row.lockReason === undefined ? {} : { lockReason: row.lockReason }),
    };
  }

  /**
   * ACTIVE -> DISABLED and every unrevoked session of the account revoked, in the caller's transaction. Undefined when the
   * row no longer is ACTIVE at the expected version.
   */
  async disable(
    context: TransactionContext,
    account: OrdinaryAccount,
    expectedVersion: number,
    lockReason: LockReason,
  ): Promise<{ version: number; changedAtMs: number; revokedSessions: number } | undefined> {
    const changed = await this.users.setAccountStatus(context, { userId: account.userId, from: 'ACTIVE', to: 'DISABLED', expectedVersion, lockReason });
    if (changed === undefined) {
      return undefined;
    }
    return { ...changed, revokedSessions: await this.sessions.revokeAllForUser(context, account.userId) };
  }

  /**
   * Permanent deletion of an account that has no business data (the caller asked the registry first; the database function checks the shop
   * and the driver profile again). The account's own sessions, device bindings, consents, profile and roles go with it. False when the row
   * is not an APP_USER account any more.
   */
  async purge(context: TransactionContext, account: OrdinaryAccount): Promise<boolean> {
    return this.users.purgeAppUser(context, account.userId);
  }

  /** DISABLED -> ACTIVE. No role, profile or session is touched: an old session stays revoked; the lock reason is cleared. */
  async enable(context: TransactionContext, account: OrdinaryAccount, expectedVersion: number): Promise<{ version: number; changedAtMs: number } | undefined> {
    return this.users.setAccountStatus(context, { userId: account.userId, from: 'DISABLED', to: 'ACTIVE', expectedVersion });
  }
}
