// Vocabulary of M02 Shop (M01-A2S). The values mirror the CHECK constraints of
// database/migrations/1791590400000_create-shop-onboarding.sql; keep the two in step.

export const SHOP_STATUSES = ['INCOMPLETE', 'ACTIVE', 'DISABLED'] as const;
export type ShopStatus = (typeof SHOP_STATUSES)[number];

export const SERVICE_AREA_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type ServiceAreaStatus = (typeof SERVICE_AREA_STATUSES)[number];

/** The only membership role A2S creates. Later slices may add others; the OWNER invariants stay as they are. */
export const OWNER_MEMBER_ROLE = 'OWNER';

/** How far a user got with Shop onboarding, as /auth/me reports it. */
export type ShopOnboardingState = 'NOT_STARTED' | 'INCOMPLETE' | 'COMPLETED';

/**
 * What Auth may learn about the user's Shop through the read-only eligibility port: how far onboarding got and
 * whether the user owns an ACTIVE shop (the precondition, together with the SHOP role, of selecting SHOP).
 */
export interface OwnerShopEligibility {
  readonly onboarding: ShopOnboardingState;
  readonly selectable: boolean;
}
