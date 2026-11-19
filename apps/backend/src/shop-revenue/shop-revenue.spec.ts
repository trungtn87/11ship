import { describe, expect, it } from '@jest/globals';
import { averageOf } from './shop-revenue-service';
import { encodeRevenueCursor, parseRevenueOrdersQuery, parseRevenueSummaryQuery, SHOP_REVENUE_MAX_LIMIT } from './shop-revenue-validation';

const ORDER = '11111111-1111-4111-8111-111111111111';

describe('#391 shop revenue query', () => {
  it('accepts one inclusive Vietnam period and counts both ends', () => {
    expect(parseRevenueSummaryQuery({ from: '2026-11-18', to: '2026-11-18' })).toEqual({ period: { from: '2026-11-18', to: '2026-11-18' }, days: 1 });
    expect(parseRevenueSummaryQuery({ from: '2026-08-01', to: '2026-10-31' }).days).toBe(92);
  });

  it('refuses 93 days, a reversed period, an impossible date, a shop id from the client, and any unknown key', () => {
    expect(() => parseRevenueSummaryQuery({ from: '2026-07-31', to: '2026-10-31' })).toThrow();
    expect(() => parseRevenueSummaryQuery({ from: '2026-11-18', to: '2026-11-17' })).toThrow();
    expect(() => parseRevenueSummaryQuery({ from: '2026-02-30', to: '2026-03-01' })).toThrow();
    expect(() => parseRevenueSummaryQuery({ from: '2026-11-18', to: '2026-11-18', shop_id: ORDER })).toThrow();
    expect(() => parseRevenueSummaryQuery(undefined)).toThrow();
  });

  it('limits the page size and rejects a malformed cursor', () => {
    expect(parseRevenueOrdersQuery({ from: '2026-11-18', to: '2026-11-18' }).limit).toBe(20);
    expect(() => parseRevenueOrdersQuery({ from: '2026-11-18', to: '2026-11-18', limit: String(SHOP_REVENUE_MAX_LIMIT + 1) })).toThrow();
    expect(() => parseRevenueOrdersQuery({ from: '2026-11-18', to: '2026-11-18', limit: '0' })).toThrow();
    expect(() => parseRevenueOrdersQuery({ from: '2026-11-18', to: '2026-11-18', cursor: '%%%' })).toThrow();
    expect(() => parseRevenueOrdersQuery({ from: '2026-11-18', to: '2026-11-18', cursor: encodeRevenueCursor({ endedAt: 'not-a-time', orderId: ORDER }) })).toThrow();
  });

  it('a cursor round-trips the exact instant, microseconds included', () => {
    const cursor = { endedAt: '2026-11-17T16:59:59.123456Z', orderId: ORDER };
    const parsed = parseRevenueOrdersQuery({ from: '2026-11-17', to: '2026-11-18', cursor: encodeRevenueCursor(cursor) });
    expect(parsed.cursor).toEqual(cursor);
  });
});

describe('#391 average per order', () => {
  it('is the same numerator and denominator as the total, rounded half up, and null (not 0) with no order', () => {
    expect(averageOf(42_000n, 4n)).toBe(10_500n);
    expect(averageOf(5n, 2n)).toBe(3n);
    expect(averageOf(4n, 2n)).toBe(2n);
    expect(averageOf(0n, 0n)).toBeNull();
  });
});
