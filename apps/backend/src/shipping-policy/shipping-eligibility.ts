// M06-B: may this Shipper take this delivery? Pure rules, no I/O and no clock. The caller (ShippingEligibilityService) reads the facts from their
// owners (M03 profile, M04 wallet, M07 open work, M14 location) and hands them in; a fact an owner cannot give is `undefined` and is a REASON to
// refuse, never a guess. A preview of "eligible" is not an acceptance: M07 re-checks under its own locks when it commits.

/** The search radius (M06 v1.1: 3 km) is fixed by the approved design: straight line from the shop position to the Shipper's current GPS. Never a setting, never widened. It is NOT the delivery distance from shop to customer. */
export const SHIPPER_SEARCH_RADIUS_M = 3000;

export type EligibilityReason =
  | 'DRIVER_NOT_ACTIVE'
  | 'DRIVER_NOT_ACCEPTING'
  | 'DRIVER_BANK_NOT_VERIFIED'
  | 'DELIVERY_NOT_AVAILABLE'
  | 'DELIVERY_SEARCH_EXPIRED'
  | 'LOCATION_UNAVAILABLE'
  | 'LOCATION_STALE'
  | 'SHOP_LOCATION_MISSING'
  | 'OUT_OF_SEARCH_RADIUS'
  | 'ACTIVE_LIMIT_REACHED'
  | 'WALLET_UNAVAILABLE'
  | 'BALANCE_TOO_LOW'
  | 'DEPENDENCY_NOT_READY';

export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

export interface EligibilityFacts {
  readonly nowMs: number;
  readonly driver: {
    readonly status: string;
    readonly acceptingDeliveries: boolean;
    readonly driverType: 'EXTERNAL' | 'PLATFORM';
    readonly bankVerified: boolean;
  };
  /** undefined: M07 could not give the delivery (unknown id or M07 not connected). */
  readonly delivery:
    | undefined
    | {
        readonly searching: boolean;
        readonly hasShipper: boolean;
        readonly searchExpiresAtMs: number;
        readonly shop: LatLng | null;
        /** The commission hold M04 would take for this delivery; null when M07/M04 cannot say yet (then the wallet cannot be judged). */
        readonly requiredHoldVnd: bigint | null;
      };
  /** undefined: M14 has no current position for the Shipper. `fresh` and `valid` are M14's own verdicts. */
  readonly location: undefined | { readonly point: LatLng; readonly fresh: boolean; readonly valid: boolean };
  /** Open deliveries of the Shipper according to M07; undefined when M07 is not connected. */
  readonly activeCount: number | undefined;
  /** Available (balance - held) according to M04; undefined when M04 cannot answer. */
  readonly availableVnd: bigint | undefined;
  readonly externalMaxDeliveries: number;
}

export interface EligibilityVerdict {
  readonly eligible: boolean;
  /** Every reason found, in a fixed order (empty when eligible). */
  readonly reasons: readonly EligibilityReason[];
  /** Straight-line shop -> Shipper distance in metres when both are known (information only; never shown before acceptance to a customer). */
  readonly distanceToShopM: number | null;
}

const EARTH_RADIUS_M = 6_371_008.8;

/** Great-circle distance in metres. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const isValidPoint = (p: LatLng | null | undefined): p is LatLng =>
  p !== null && p !== undefined && Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180;

export function evaluateEligibility(facts: EligibilityFacts): EligibilityVerdict {
  const reasons: EligibilityReason[] = [];
  const { driver, delivery, location } = facts;
  const platform = driver.driverType === 'PLATFORM';

  if (driver.status !== 'ACTIVE') {
    reasons.push('DRIVER_NOT_ACTIVE');
  }
  if (!driver.acceptingDeliveries) {
    reasons.push('DRIVER_NOT_ACCEPTING');
  }
  if (delivery === undefined) {
    reasons.push('DEPENDENCY_NOT_READY');
  } else if (!delivery.searching || delivery.hasShipper) {
    reasons.push('DELIVERY_NOT_AVAILABLE');
  } else if (facts.nowMs >= delivery.searchExpiresAtMs) {
    reasons.push('DELIVERY_SEARCH_EXPIRED');
  }

  // GPS is required for EXTERNAL and PLATFORM alike (PLATFORM is only exempt from the radius).
  let distance: number | null = null;
  if (location === undefined || !isValidPoint(location.point) || !location.valid) {
    reasons.push('LOCATION_UNAVAILABLE');
  } else if (!location.fresh) {
    reasons.push('LOCATION_STALE');
  } else if (delivery !== undefined) {
    if (!isValidPoint(delivery.shop)) {
      // The shop position is needed by EXTERNAL (the radius) and PLATFORM (the exemption is only from the radius) alike.
      reasons.push('SHOP_LOCATION_MISSING');
    } else {
      distance = haversineMeters(delivery.shop, location.point);
      if (!platform && distance > SHIPPER_SEARCH_RADIUS_M) {
        reasons.push('OUT_OF_SEARCH_RADIUS');
      }
    }
  }

  // EXTERNAL is capped; PLATFORM is not (but still needs the wallet and the ETA protection below).
  if (facts.activeCount === undefined) {
    if (!reasons.includes('DEPENDENCY_NOT_READY')) {
      reasons.push('DEPENDENCY_NOT_READY');
    }
  } else if (!platform && facts.activeCount >= facts.externalMaxDeliveries) {
    reasons.push('ACTIVE_LIMIT_REACHED');
  }

  if (facts.availableVnd === undefined || (delivery !== undefined && delivery.requiredHoldVnd === null)) {
    reasons.push('WALLET_UNAVAILABLE');
  } else if (delivery !== undefined && delivery.requiredHoldVnd !== null && (facts.availableVnd <= 0n || facts.availableVnd < delivery.requiredHoldVnd)) {
    reasons.push('BALANCE_TOO_LOW');
  }

  return { eligible: reasons.length === 0, reasons, distanceToShopM: distance === null ? null : Math.round(distance) };
}
