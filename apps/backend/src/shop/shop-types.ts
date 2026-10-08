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

/**
 * Why a shop is ONLINE or OFFLINE (M02-A, task section 5). The order is the precedence: the first condition that
 * holds is the reason. ONLINE means every condition holds.
 */
export const AVAILABILITY_REASONS = [
  'SHOP_DISABLED',
  'SHOP_INCOMPLETE',
  'SERVICE_AREA_INACTIVE',
  'NO_BUSINESS_HOURS',
  'OUTSIDE_BUSINESS_HOURS',
  'ONLINE',
] as const;
export type AvailabilityReason = (typeof AVAILABILITY_REASONS)[number];

/**
 * The computed availability of a shop at one instant of the PostgreSQL clock. It is never stored: nothing marks a
 * shop open or closed, so nothing has to run when the schedule says a shop opens or closes.
 */
export interface ShopAvailability {
  readonly online: boolean;
  readonly reason: AvailabilityReason;
  /** ISO 8601 UTC, millisecond precision: the instant the membership test used. */
  readonly evaluatedAt: string;
}
