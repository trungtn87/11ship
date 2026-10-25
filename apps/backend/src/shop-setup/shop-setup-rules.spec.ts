import { describe, expect, it } from '@jest/globals';
import { effectiveAvailability, evaluateSetup, isPublicReason, SetupFacts } from './shop-setup-rules';

const complete: SetupFacts = {
  status: 'ACTIVE',
  ownerLocked: false,
  name: 'Quán A',
  addressText: '1 Phố B',
  contactPhone: '+84987654321',
  serviceAreaId: '11111111-1111-4111-8111-111111111111',
  areaStatus: 'ACTIVE',
  hasHours: true,
  hasPickupPoint: true,
  hasSellableItem: true,
  activatedAt: null,
  requestPending: false,
};

describe('shop setup rules (issue #190)', () => {
  it('four steps; every condition met on an ACTIVE shop is activated and public', () => {
    const result = evaluateSetup(complete);
    expect(result.steps.map((step) => [step.key, step.done])).toEqual([['ACCOUNT', true], ['SHOP_INFO', true], ['LOCATION', true], ['FIRST_ITEM', true]]);
    expect(result).toMatchObject({ complete: true, completedSteps: 4, missing: [], state: 'ACTIVATED', publicVisible: true });
  });

  it.each([
    ['no schedule', { hasHours: false }, ['BUSINESS_HOURS'], 3],
    ['no pickup point', { hasPickupPoint: false }, ['PICKUP_POINT'], 3],
    ['no sellable dish', { hasSellableItem: false }, ['SELLABLE_ITEM'], 3],
    ['blank address and phone', { addressText: ' ', contactPhone: '' }, ['ADDRESS', 'CONTACT_PHONE'], 3],
    ['no service area', { serviceAreaId: null, areaStatus: null }, ['SERVICE_AREA'], 3],
    ['a stopped service area', { areaStatus: 'INACTIVE' }, ['SERVICE_AREA'], 3],
  ] as [string, Partial<SetupFacts>, string[], number][])('%s is not set up', (_label, patch, missing, steps) => {
    const result = evaluateSetup({ ...complete, ...patch });
    expect(result).toMatchObject({ complete: false, missing, completedSteps: steps, state: 'INCOMPLETE', publicVisible: false });
  });

  it('everything missing is 1/4 and lists each missing code in step order', () => {
    const result = evaluateSetup({ ...complete, hasHours: false, hasPickupPoint: false, hasSellableItem: false });
    expect(result).toMatchObject({ completedSteps: 1, missing: ['BUSINESS_HOURS', 'PICKUP_POINT', 'SELLABLE_ITEM'] });
  });

  it('a shop that was activated and lost a condition needs a check; a pending request also does; both stay hidden while incomplete', () => {
    expect(evaluateSetup({ ...complete, hasSellableItem: false, activatedAt: '2026-10-24T01:00:00.000Z' })).toMatchObject({ state: 'NEEDS_REVIEW', publicVisible: false });
    expect(evaluateSetup({ ...complete, hasHours: false, requestPending: true })).toMatchObject({ state: 'NEEDS_REVIEW', publicVisible: false });
    // A request on a complete shop does not hide it: the request is a note, not a condition.
    expect(evaluateSetup({ ...complete, requestPending: true })).toMatchObject({ state: 'NEEDS_REVIEW', publicVisible: true });
  });

  it('locked (disabled shop or locked owner) wins over everything and is never public, even when complete', () => {
    expect(evaluateSetup({ ...complete, status: 'DISABLED' })).toMatchObject({ state: 'LOCKED', complete: true, publicVisible: false });
    expect(evaluateSetup({ ...complete, ownerLocked: true, requestPending: true })).toMatchObject({ state: 'LOCKED', publicVisible: false });
  });

  it('an INCOMPLETE profile is never public even if the rows look complete', () => {
    expect(evaluateSetup({ ...complete, status: 'INCOMPLETE' })).toMatchObject({ state: 'INCOMPLETE', publicVisible: false });
  });

  it('closed-now is a schedule matter (still public); a missing dish turns an open-or-closed shop into NO_SELLABLE_ITEM', () => {
    const at = '2026-10-25T01:00:00.000Z';
    expect(isPublicReason('ONLINE')).toBe(true);
    expect(isPublicReason('OUTSIDE_BUSINESS_HOURS')).toBe(true);
    for (const reason of ['NO_BUSINESS_HOURS', 'NO_PICKUP_POINT', 'NO_SELLABLE_ITEM', 'SHOP_DISABLED', 'SHOP_INCOMPLETE', 'SERVICE_AREA_INACTIVE'] as const) {
      expect(isPublicReason(reason)).toBe(false);
    }
    expect(effectiveAvailability({ online: true, reason: 'ONLINE', evaluatedAt: at }, false)).toEqual({ online: false, reason: 'NO_SELLABLE_ITEM', evaluatedAt: at });
    expect(effectiveAvailability({ online: false, reason: 'OUTSIDE_BUSINESS_HOURS', evaluatedAt: at }, false).reason).toBe('NO_SELLABLE_ITEM');
    expect(effectiveAvailability({ online: false, reason: 'NO_BUSINESS_HOURS', evaluatedAt: at }, false).reason).toBe('NO_BUSINESS_HOURS');
    expect(effectiveAvailability({ online: false, reason: 'OUTSIDE_BUSINESS_HOURS', evaluatedAt: at }, true).reason).toBe('OUTSIDE_BUSINESS_HOURS');
  });
});
