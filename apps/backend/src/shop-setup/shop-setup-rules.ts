import { ShopSnapshot } from '../shop/shop-availability-reader';
import { AvailabilityReason, ShopAvailability } from '../shop/shop-types';

// Shop setup readiness (issue #190, Owner decision 2026-10-24). The server decides from the REAL rows; nothing the app sends counts:
//   1 ACCOUNT    the owner account exists (registration with the OTP succeeded: a shop only exists behind it)
//   2 SHOP_INFO  name, typed address, contact phone, an ACTIVE service area, and a weekly schedule
//   3 LOCATION   a stored pickup point (GPS); a typed address is never a point
//   4 FIRST_ITEM one dish on sale with a price > 0 and a picture
// All four met, the shop ACTIVE and its owner not locked => the shop is publicly visible and takes orders (when open). Readiness is derived on every
// read, never stored, so losing a condition later (no dish on sale, no point) blocks NEW orders at once and touches no order already created.

export const SETUP_STEP_KEYS = ['ACCOUNT', 'SHOP_INFO', 'LOCATION', 'FIRST_ITEM'] as const;
export type SetupStepKey = (typeof SETUP_STEP_KEYS)[number];

export const SETUP_MISSING_CODES = ['NAME', 'ADDRESS', 'CONTACT_PHONE', 'SERVICE_AREA', 'BUSINESS_HOURS', 'PICKUP_POINT', 'SELLABLE_ITEM'] as const;
export type SetupMissingCode = (typeof SETUP_MISSING_CODES)[number];

/** INCOMPLETE = not set up yet; ACTIVATED = set up (public); LOCKED = disabled by an administrator or the owner account is locked; NEEDS_REVIEW = was set up but lost a condition, or an administrator asked for a completion. */
export const SETUP_STATES = ['INCOMPLETE', 'ACTIVATED', 'LOCKED', 'NEEDS_REVIEW'] as const;
export type SetupState = (typeof SETUP_STATES)[number];

export interface SetupFacts {
  readonly status: string;
  readonly ownerLocked: boolean;
  readonly name: string;
  readonly addressText: string;
  readonly contactPhone: string;
  readonly serviceAreaId: string | null;
  readonly areaStatus: string | null;
  readonly hasHours: boolean;
  readonly hasPickupPoint: boolean;
  readonly hasSellableItem: boolean;
  readonly activatedAt: string | null;
  readonly requestPending: boolean;
}

export interface SetupStep {
  readonly key: SetupStepKey;
  readonly done: boolean;
  readonly missing: readonly SetupMissingCode[];
}

export interface SetupEvaluation {
  readonly steps: readonly SetupStep[];
  readonly missing: readonly SetupMissingCode[];
  readonly completedSteps: number;
  /** Every one of the four conditions holds (whatever the status or a lock says). */
  readonly complete: boolean;
  readonly state: SetupState;
  /** Customers may see the shop and its menu (ACTIVE, not locked, complete). Closed-now shops are still public. */
  readonly publicVisible: boolean;
}

export function evaluateSetup(facts: SetupFacts): SetupEvaluation {
  const info: SetupMissingCode[] = [];
  if (facts.name.trim() === '') info.push('NAME');
  if (facts.addressText.trim() === '') info.push('ADDRESS');
  if (facts.contactPhone.trim() === '') info.push('CONTACT_PHONE');
  if (facts.serviceAreaId === null || facts.areaStatus !== 'ACTIVE') info.push('SERVICE_AREA');
  if (!facts.hasHours) info.push('BUSINESS_HOURS');
  const steps: SetupStep[] = [
    { key: 'ACCOUNT', done: true, missing: [] },
    { key: 'SHOP_INFO', done: info.length === 0, missing: info },
    { key: 'LOCATION', done: facts.hasPickupPoint, missing: facts.hasPickupPoint ? [] : ['PICKUP_POINT'] },
    { key: 'FIRST_ITEM', done: facts.hasSellableItem, missing: facts.hasSellableItem ? [] : ['SELLABLE_ITEM'] },
  ];
  const complete = steps.every((step) => step.done);
  const locked = facts.status === 'DISABLED' || facts.ownerLocked;
  const publicVisible = complete && facts.status === 'ACTIVE' && !facts.ownerLocked;
  let state: SetupState;
  if (locked) {
    state = 'LOCKED';
  } else if (facts.requestPending) {
    state = 'NEEDS_REVIEW';
  } else if (!complete) {
    state = facts.activatedAt === null ? 'INCOMPLETE' : 'NEEDS_REVIEW';
  } else {
    state = facts.status === 'ACTIVE' ? 'ACTIVATED' : 'INCOMPLETE';
  }
  return { steps, missing: steps.flatMap((step) => step.missing), completedSteps: steps.filter((step) => step.done).length, complete, state, publicVisible };
}

export function factsOf(snapshot: ShopSnapshot, hasSellableItem: boolean): SetupFacts {
  return {
    status: snapshot.status,
    ownerLocked: snapshot.ownerLocked,
    name: snapshot.name,
    addressText: snapshot.addressText,
    contactPhone: snapshot.contactPhoneNormalized,
    serviceAreaId: snapshot.serviceAreaId,
    areaStatus: snapshot.areaStatus,
    hasHours: snapshot.hours.length > 0,
    hasPickupPoint: snapshot.hasPickupPoint,
    hasSellableItem,
    activatedAt: snapshot.activatedAt,
    requestPending: snapshot.setupRequest !== null,
  };
}

/**
 * The availability a customer-side or owner-side screen may state: the snapshot's answer, except that an otherwise open-or-closed shop without a
 * sellable dish is NO_SELLABLE_ITEM (not set up), never ONLINE or "closed". The snapshot cannot know it: dishes are the Menu module's fact.
 */
export function effectiveAvailability(availability: ShopAvailability, hasSellableItem: boolean): ShopAvailability {
  const reason: AvailabilityReason = availability.reason;
  if (!hasSellableItem && (reason === 'ONLINE' || reason === 'OUTSIDE_BUSINESS_HOURS')) {
    return { online: false, reason: 'NO_SELLABLE_ITEM', evaluatedAt: availability.evaluatedAt };
  }
  return availability;
}

/** The reasons under which customers may see the shop and its menu: set up and ACTIVE. ONLINE may order; OUTSIDE_BUSINESS_HOURS may only look. */
export function isPublicReason(reason: AvailabilityReason): boolean {
  return reason === 'ONLINE' || reason === 'OUTSIDE_BUSINESS_HOURS';
}
