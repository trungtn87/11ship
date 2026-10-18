import { describe, expect, it } from '@jest/globals';
import { EligibilityFacts, evaluateEligibility, haversineMeters, SHIPPER_SEARCH_RADIUS_M } from './shipping-eligibility';

const SHOP = { lat: 22.665, lng: 106.257 };
const NEAR = { lat: 22.67, lng: 106.257 }; // ~556 m
const FAR = { lat: 22.72, lng: 106.257 }; // ~6.1 km
/** A point `metres` north of the shop on the same meridian (great-circle distance = metres, to well under a millimetre). */
const northOf = (metres: number) => ({ lat: SHOP.lat + (metres / 6_371_008.8) * (180 / Math.PI), lng: SHOP.lng });

const base = (over: Partial<EligibilityFacts> = {}): EligibilityFacts => ({
  nowMs: 1_000_000,
  driver: { status: 'ACTIVE', acceptingDeliveries: true, driverType: 'EXTERNAL', bankVerified: true },
  delivery: { searching: true, hasShipper: false, searchExpiresAtMs: 2_000_000, shop: SHOP, requiredHoldVnd: 5000n },
  location: { point: NEAR, fresh: true, valid: true },
  activeCount: 0,
  availableVnd: 100_000n,
  externalMaxDeliveries: 3,
  ...over,
});
const reasons = (facts: EligibilityFacts): string[] => [...evaluateEligibility(facts).reasons];

describe('M06-B evaluateEligibility', () => {
  it('is eligible when profile, delivery, GPS, radius, count and wallet are all fine', () => {
    const verdict = evaluateEligibility(base());
    expect(verdict).toMatchObject({ eligible: true, reasons: [] });
    expect(verdict.distanceToShopM).toBeGreaterThan(400);
    expect(verdict.distanceToShopM).toBeLessThan(700);
  });

  it('keeps the radius fixed at 3 km (straight line shop -> GPS): up to 3.000 m is inside, above it is refused for EXTERNAL; 4-6 km is outside', () => {
    expect(SHIPPER_SEARCH_RADIUS_M).toBe(3000);
    expect(haversineMeters(SHOP, northOf(3000))).toBeCloseTo(3000, 3);
    expect(reasons(base({ location: { point: northOf(2999.99), fresh: true, valid: true } }))).toEqual([]);
    expect(reasons(base({ location: { point: northOf(3000.01), fresh: true, valid: true } }))).toEqual(['OUT_OF_SEARCH_RADIUS']);
    expect(reasons(base({ location: { point: northOf(4000), fresh: true, valid: true } }))).toEqual(['OUT_OF_SEARCH_RADIUS']); // the old 5 km radius no longer applies
    expect(haversineMeters(SHOP, FAR)).toBeGreaterThan(5000);
    expect(reasons(base({ location: { point: FAR, fresh: true, valid: true } }))).toEqual(['OUT_OF_SEARCH_RADIUS']);
  });

  it('PLATFORM is exempt from the radius and the count, but never from GPS, the shop position, the wallet or the delivery state', () => {
    const platform = { status: 'ACTIVE', acceptingDeliveries: true, driverType: 'PLATFORM' as const, bankVerified: true };
    expect(reasons(base({ driver: platform, location: { point: FAR, fresh: true, valid: true }, activeCount: 50 }))).toEqual([]);
    expect(reasons(base({ driver: platform, location: undefined }))).toEqual(['LOCATION_UNAVAILABLE']);
    // PLATFORM skips only the radius: a missing shop position is still a missing fact for the check.
    expect(reasons(base({ driver: platform, delivery: { searching: true, hasShipper: false, searchExpiresAtMs: 2_000_000, shop: null, requiredHoldVnd: 0n } }))).toEqual(['SHOP_LOCATION_MISSING']);
    expect(reasons(base({ driver: platform, location: { point: NEAR, fresh: false, valid: true } }))).toEqual(['LOCATION_STALE']);
    expect(reasons(base({ driver: platform, availableVnd: 1n }))).toEqual(['BALANCE_TOO_LOW']);
    expect(reasons(base({ driver: platform, availableVnd: undefined }))).toEqual(['WALLET_UNAVAILABLE']);
    expect(reasons(base({ driver: platform, delivery: { searching: true, hasShipper: true, searchExpiresAtMs: 2_000_000, shop: SHOP, requiredHoldVnd: 0n } }))).toEqual(['DELIVERY_NOT_AVAILABLE']);
  });

  it('caps EXTERNAL at the configured number of open deliveries (default 3): the 3rd is allowed, the 4th is not', () => {
    expect(reasons(base({ activeCount: 2 }))).toEqual([]);
    expect(reasons(base({ activeCount: 3 }))).toEqual(['ACTIVE_LIMIT_REACHED']);
    expect(reasons(base({ activeCount: 4, externalMaxDeliveries: 5 }))).toEqual([]);
  });

  it('refuses a delivery that already has a Shipper, is no longer searching, or whose search time is over', () => {
    const delivery = (over: object) => ({ searching: true, hasShipper: false, searchExpiresAtMs: 2_000_000, shop: SHOP, requiredHoldVnd: 0n, ...over });
    expect(reasons(base({ delivery: delivery({ hasShipper: true }) }))).toEqual(['DELIVERY_NOT_AVAILABLE']);
    expect(reasons(base({ delivery: delivery({ searching: false }) }))).toEqual(['DELIVERY_NOT_AVAILABLE']);
    expect(reasons(base({ delivery: delivery({ searchExpiresAtMs: 1_000_000 }) }))).toEqual(['DELIVERY_SEARCH_EXPIRED']);
    expect(reasons(base({ delivery: delivery({ searchExpiresAtMs: 999_999 }) }))).toEqual(['DELIVERY_SEARCH_EXPIRED']);
  });

  it('refuses a Shipper whose profile, accepting switch or bank is not ready', () => {
    expect(reasons(base({ driver: { status: 'SUSPENDED', acceptingDeliveries: true, driverType: 'EXTERNAL', bankVerified: true } }))).toEqual(['DRIVER_NOT_ACTIVE']);
    expect(reasons(base({ driver: { status: 'ACTIVE', acceptingDeliveries: false, driverType: 'EXTERNAL', bankVerified: true } }))).toEqual(['DRIVER_NOT_ACCEPTING']);
    expect(reasons(base({ driver: { status: 'ACTIVE', acceptingDeliveries: true, driverType: 'EXTERNAL', bankVerified: false } }))).toEqual(['DRIVER_BANK_NOT_VERIFIED']);
  });

  it('fails closed on a fact its owner cannot give: M07 delivery/work, M14 location, M04 wallet, a missing shop position', () => {
    expect(reasons(base({ delivery: undefined }))).toContain('DEPENDENCY_NOT_READY');
    expect(reasons(base({ activeCount: undefined }))).toEqual(['DEPENDENCY_NOT_READY']);
    expect(reasons(base({ location: undefined }))).toEqual(['LOCATION_UNAVAILABLE']);
    expect(reasons(base({ location: { point: NEAR, fresh: true, valid: false } }))).toEqual(['LOCATION_UNAVAILABLE']);
    expect(reasons(base({ availableVnd: undefined }))).toEqual(['WALLET_UNAVAILABLE']);
    expect(reasons(base({ delivery: { searching: true, hasShipper: false, searchExpiresAtMs: 2_000_000, shop: SHOP, requiredHoldVnd: null } }))).toEqual(['WALLET_UNAVAILABLE']);
    expect(reasons(base({ delivery: { searching: true, hasShipper: false, searchExpiresAtMs: 2_000_000, shop: null, requiredHoldVnd: 0n } }))).toEqual(['SHOP_LOCATION_MISSING']);
  });

  it('compares the available balance with the hold exactly (equal is enough, one VND less is not)', () => {
    expect(reasons(base({ availableVnd: 5000n }))).toEqual([]);
    expect(reasons(base({ availableVnd: 4999n }))).toEqual(['BALANCE_TOO_LOW']);
  });

  it('reports every reason at once, in a fixed order', () => {
    const verdict = evaluateEligibility(base({ driver: { status: 'PENDING', acceptingDeliveries: false, driverType: 'EXTERNAL', bankVerified: false }, activeCount: 3, availableVnd: 0n }));
    expect(verdict.reasons).toEqual(['DRIVER_NOT_ACTIVE', 'DRIVER_NOT_ACCEPTING', 'DRIVER_BANK_NOT_VERIFIED', 'ACTIVE_LIMIT_REACHED', 'BALANCE_TOO_LOW']);
  });
});
