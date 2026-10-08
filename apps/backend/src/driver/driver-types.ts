// Vocabulary of M03 Driver (M01-A2D). The values mirror the CHECK constraints of
// database/migrations/1791676800000_create-driver-onboarding.sql; keep the two in step.

/** A classification, never a role. Legacy SYSTEM is not a driver type (the SYSTEM role is a different thing). */
export const DRIVER_TYPES = ['EXTERNAL', 'PLATFORM'] as const;
export type DriverType = (typeof DRIVER_TYPES)[number];

export const DRIVER_STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSING', 'CLOSED'] as const;
export type DriverStatus = (typeof DRIVER_STATUSES)[number];

/**
 * How far a user got with Driver onboarding, as /auth/me reports it. PENDING_APPROVAL is the state of a
 * profile whose status is PENDING: onboarding is finished, an operator has not approved the driver yet.
 */
export const DRIVER_ONBOARDING_STATES = [
  'NOT_STARTED',
  'PENDING_APPROVAL',
  'ACTIVE',
  'SUSPENDED',
  'CLOSING',
  'CLOSED',
] as const;
export type DriverOnboardingState = (typeof DRIVER_ONBOARDING_STATES)[number];

/**
 * What Auth may learn about the user's Driver profile through the read-only eligibility port: how far
 * onboarding got and whether the profile may be SELECTED as a role context (the precondition, together with the
 * DRIVER role, of selecting DRIVER). Selecting a role is not permission to take deliveries: that is the stronger
 * active guard.
 */
export interface OwnerDriverEligibility {
  readonly onboarding: DriverOnboardingState;
  readonly selectable: boolean;
}
