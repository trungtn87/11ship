import { OwnerShopEligibility } from '../shop/shop-types';

/**
 * The roles a user can actually SELECT, from the roles the user holds (M01-A2S, task section 7).
 *
 * DRIVER is unchanged: holding the role is enough. SHOP additionally needs an ACTIVE shop owned by the user,
 * so a stray SHOP role (a row without a completed profile) is neither listed nor selectable. The same rule
 * decides what login, /me and role selection report, so a client is never offered a role the server would
 * then refuse.
 *
 * `held` is the sorted list of supported roles read from user_roles; the order is kept.
 */
export function availableRoles(held: readonly string[], shop: OwnerShopEligibility): string[] {
  return held.filter((role) => role !== 'SHOP' || shop.selectable);
}

/** The three role-context fields login, /me and role selection all report. */
export interface RoleContext {
  readonly available_roles: string[];
  readonly onboarding_required: boolean;
  readonly role_selection_required: boolean;
}

/**
 * The one place that decides `onboarding_required` and `role_selection_required` (A2S review addendum), so
 * login and /me cannot drift apart.
 *
 * - `onboarding_required`: the user has no selectable role AND Shop onboarding is not finished (NOT_STARTED or
 *   INCOMPLETE). A stray SHOP role without a profile still needs onboarding.
 * - A COMPLETED shop never asks for onboarding again, even when it is DISABLED and therefore not selectable:
 *   the profile endpoints would refuse that user, so sending them back to onboarding would be a dead end.
 * - `role_selection_required`: there is something to select and this session has selected nothing. With no
 *   selectable role it is false, whatever the shop state.
 *
 * DRIVER is untouched: holding the role makes it selectable, and any selectable role turns onboarding off.
 */
export function roleContext(
  held: readonly string[],
  shop: OwnerShopEligibility,
  activeRole: string | null,
): RoleContext {
  const roles = availableRoles(held, shop);
  return {
    available_roles: roles,
    onboarding_required: roles.length === 0 && shop.onboarding !== 'COMPLETED',
    role_selection_required: roles.length > 0 && activeRole === null,
  };
}
