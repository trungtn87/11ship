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
