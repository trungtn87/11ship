import { PermissionRow, UserDetailRow } from '../admin-accounts/admin-account-read-repository';
import { AccountOriginPolicy } from '../auth/account-origin';
import { isLockableAccount } from '../auth/admin-user-account-participant';

// The ONE rule that says whether an administrator may lock / unlock an account, from the actor's CURRENT permissions and the
// target's FULL role set (D15). It is pure: the lock command, its replay authorization and the allowed_actions hint of the
// detail all call it, so they cannot drift apart.
//
//   SYSTEM  every ordinary account, including one that has no role yet.
//   ADMIN   needs can_view AND can_lock on EVERY domain the target belongs to (CUSTOMER, SHOP, DRIVER); the role selected in
//           a session is irrelevant. An account without any role, or with a role outside those three domains, is never
//           covered by an ADMIN.
//
// NOT_AVAILABLE = the administrator could not even read the target (same answer as an unknown id); FORBIDDEN = it is visible
// but at least one of its domains lacks view or lock.

export type LockEligibility = 'OK' | 'NOT_AVAILABLE' | 'FORBIDDEN';

const DOMAINS: readonly string[] = ['CUSTOMER', 'SHOP', 'DRIVER'];

export function lockEligibility(
  actor: { readonly role: 'SYSTEM' | 'ADMIN'; readonly permissions: readonly PermissionRow[] },
  roles: readonly string[],
): LockEligibility {
  if (actor.role === 'SYSTEM') {
    return 'OK';
  }
  const viewable = new Set(actor.permissions.filter((row) => row.canView).map((row) => row.app as string));
  if (!roles.some((role) => viewable.has(role))) {
    return 'NOT_AVAILABLE';
  }
  const covered = roles.every((role) => DOMAINS.includes(role) && actor.permissions.some((row) => row.app === role && row.canView && row.canLock));
  return covered ? 'OK' : 'FORBIDDEN';
}

export type LifecycleAction = 'LOCK' | 'UNLOCK' | 'DELETE';

/**
 * The UI hint of the detail: LOCK for ACTIVE, UNLOCK for DISABLED, and DELETE for any account (the delete command decides between a
 * permanent deletion and a lock; the detail says which one would happen). Nothing when the right, the account shape or the gate is
 * missing.
 */
export function allowedLockActions(input: {
  readonly eligible: boolean;
  readonly gateOpen: boolean;
  readonly status: 'ACTIVE' | 'DISABLED';
}): LifecycleAction[] {
  if (!input.eligible || !input.gateOpen) {
    return [];
  }
  return input.status === 'ACTIVE' ? ['LOCK', 'DELETE'] : ['UNLOCK', 'DELETE'];
}

/** allowed_actions of a USER detail: the same rules as the command, evaluated on the row the detail already read. */
export function detailAllowedActions(input: {
  readonly policy: AccountOriginPolicy;
  readonly actor: { readonly role: 'SYSTEM' | 'ADMIN'; readonly permissions: readonly PermissionRow[] };
  readonly row: UserDetailRow;
  readonly gateOpen: boolean;
}): LifecycleAction[] {
  const { row } = input;
  // The detail only ever selects accounts without an administration membership (USER_BASE), hence hasAdminMembership: false.
  const ordinary = isLockableAccount(input.policy, {
    accountOrigin: row.lock.accountOrigin,
    phoneNormalized: row.phoneNormalized,
    phoneVerified: row.lock.phoneVerified,
    hasAdminMembership: false,
  });
  return allowedLockActions({
    eligible: ordinary && lockEligibility(input.actor, row.lock.allRoles) === 'OK',
    gateOpen: input.gateOpen,
    status: row.status,
  });
}
