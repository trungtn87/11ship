import { OwnerDriverEligibility } from '../driver/driver-types';
import { OwnerShopEligibility } from '../shop/shop-types';

/**
 * The roles a user can actually SELECT, from the roles the user holds (M01-A2S and M01-A2D, task section 10.1).
 *
 * Holding a role is not enough for either business role. SHOP additionally needs an ACTIVE shop owned by the
 * user. DRIVER additionally needs a Driver profile that is not CLOSED: PENDING, SUSPENDED and CLOSING profiles
 * stay selectable so the driver can enter the app and see the status (taking deliveries is the stronger active
 * guard, not this rule). So a stray role (a user_roles row without its profile) is neither listed nor
 * selectable. The same rule decides what login, /me and role selection report, so a client is never offered a
 * role the server would then refuse.
 *
 * `held` is the sorted list of supported roles read from user_roles; the order is kept.
 */
export function availableRoles(
  held: readonly string[],
  shop: OwnerShopEligibility,
  driver: OwnerDriverEligibility,
): string[] {
  return held.filter((role) => (role !== 'SHOP' || shop.selectable) && (role !== 'DRIVER' || driver.selectable));
}

/**
 * The role a session REALLY has, from the role stored on its row (M00/M01 post-merge repair, section 3): the stored
 * role when it is still one of the available roles, otherwise null. A stored role goes stale when the profile that
 * earned it changes (Driver CLOSED, Shop DISABLED), when the role row is removed or when there is no profile. The
 * session row is never rewritten to hide that: it is only not REPORTED, so a client is never routed into a role the
 * server would refuse. login, /me and role selection all answer `active_role` through this one function.
 */
export function effectiveActiveRole(available: readonly string[], stored: string | null): string | null {
  return stored !== null && available.includes(stored) ? stored : null;
}

/** The three role-context fields login, /me and role selection all report. */
export interface RoleContext {
  readonly available_roles: string[];
  readonly onboarding_required: boolean;
  readonly role_selection_required: boolean;
}

/**
 * The one place that decides `onboarding_required` and `role_selection_required` (A2S review addendum, extended
 * by A2D), so login and /me cannot drift apart.
 *
 * - `onboarding_required`: the user has no selectable role AND has finished no onboarding. Shop onboarding is
 *   finished once it is COMPLETED, Driver onboarding once a Driver profile exists. A stray role without a
 *   profile still needs onboarding.
 * - A COMPLETED shop never asks for onboarding again, even when it is DISABLED and therefore not selectable,
 *   and a Driver profile never does either, even a CLOSED one: the onboarding endpoints would refuse that user
 *   (SHOP_ONBOARDING_EXISTS, DRIVER_PROFILE_EXISTS), so sending them back would be a dead end. With no Driver
 *   profile this is exactly the A2S rule.
 * - `role_selection_required`: there is something to select and this session has no EFFECTIVE active role (see
 *   effectiveActiveRole: a stored role that is no longer available counts as none). With no selectable role it is
 *   false, whatever the profile states, so nobody is routed into an invalid role or forced through a finished
 *   onboarding again.
 */
export function roleContext(
  held: readonly string[],
  shop: OwnerShopEligibility,
  driver: OwnerDriverEligibility,
  activeRole: string | null,
): RoleContext {
  const roles = availableRoles(held, shop, driver);
  return {
    available_roles: roles,
    onboarding_required:
      roles.length === 0 && shop.onboarding !== 'COMPLETED' && driver.onboarding === 'NOT_STARTED',
    role_selection_required: roles.length > 0 && effectiveActiveRole(roles, activeRole) === null,
  };
}
