import { describe, expect, it } from '@jest/globals';
import { AppError } from '../common/app-errors';
import { computeShippingFee, FeePolicy, samePolicy, validateFeePolicy } from './shipping-fee-policy';
import { evaluateQuote, recheckQuote } from './shipping-fee-quote';
import { parseApplyBody, parsePreviewBody, parseSaveDraftBody } from './shipping-fee-policy-validation';

// The v1.1 example table of the approved design (NOT a seeded price): 0-<3 km 10.000, 3-<6 km 15.000, 6-10 km 20.000 (10 km included).
const POLICY: FeePolicy = {
  tiers: [
    { fromM: 0, toM: 3000, feeVnd: 10000 },
    { fromM: 3000, toM: 6000, feeVnd: 15000 },
    { fromM: 6000, toM: 10000, feeVnd: 20000 },
  ],
};

const priced = (m: number): number | null => computeShippingFee(POLICY, m).feeVnd;
const codes = (policy: FeePolicy): string[] => validateFeePolicy(policy).map((i) => i.code);
const withTiers = (tiers: FeePolicy['tiers']): FeePolicy => ({ tiers });

describe('M06-A v1.1 computeShippingFee: exactly three bands', () => {
  it('prices every band and every boundary: 3 km is band 2, 6 km is band 3, exactly 10 km is still band 3', () => {
    expect(priced(0)).toBe(10000);
    expect(priced(2999)).toBe(10000);
    expect(priced(2999.9)).toBe(10000); // metres as M14 gives them: no km rounding
    expect(priced(3000)).toBe(15000);
    expect(priced(5999)).toBe(15000);
    expect(priced(6000)).toBe(20000);
    expect(priced(9999)).toBe(20000);
    expect(priced(10000)).toBe(20000);
    expect(computeShippingFee(POLICY, 3000)).toEqual({ status: 'PRICED', feeVnd: 15000, band: 1 });
    expect(computeShippingFee(POLICY, 10000)).toEqual({ status: 'PRICED', feeVnd: 20000, band: 2 });
  });

  it('beyond the last bound there is NO fee: null (never 0, never extrapolated), reason OUT_OF_PRICE_RANGE', () => {
    expect(computeShippingFee(POLICY, 10000.1)).toEqual({ status: 'OUT_OF_PRICE_RANGE', feeVnd: null });
    expect(computeShippingFee(POLICY, 10001)).toEqual({ status: 'OUT_OF_PRICE_RANGE', feeVnd: null });
    expect(computeShippingFee(POLICY, 999_999)).toEqual({ status: 'OUT_OF_PRICE_RANGE', feeVnd: null });
    // No huge fee can come out of any distance: a fee is only ever one of the three entered amounts or null.
    for (const m of [0, 1, 2999, 3000, 5999, 6000, 10000, 10001, 50_000, 1_000_000, 5_000_000]) {
      const fee = computeShippingFee(POLICY, m).feeVnd;
      expect(fee === null || [10000, 15000, 20000].includes(fee)).toBe(true);
    }
  });

  it('follows whatever the Admin entered (the example is not a built-in price)', () => {
    const own: FeePolicy = { tiers: [{ fromM: 0, toM: 1500, feeVnd: 7000 }, { fromM: 1500, toM: 4200, feeVnd: 7000 }, { fromM: 4200, toM: 8000, feeVnd: 3000 }] };
    expect(computeShippingFee(own, 1499).feeVnd).toBe(7000);
    expect(computeShippingFee(own, 1500).feeVnd).toBe(7000);
    expect(computeShippingFee(own, 4200).feeVnd).toBe(3000); // a cheaper band after a dearer one is allowed
    expect(computeShippingFee(own, 8000).feeVnd).toBe(3000);
    expect(computeShippingFee(own, 8001).feeVnd).toBeNull();
  });

  it('refuses an invalid policy or distance instead of guessing', () => {
    expect(() => computeShippingFee(withTiers([{ fromM: 0, toM: 100, feeVnd: 1 }]), 50)).toThrow('INVALID_FEE_POLICY');
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => computeShippingFee(POLICY, bad)).toThrow('INVALID_DISTANCE');
    }
  });
});

describe('M06-A v1.1 validateFeePolicy', () => {
  it('accepts exactly three continuous bands', () => {
    expect(codes(POLICY)).toEqual([]);
  });

  it('refuses any other number of bands (no 4th band, no fewer)', () => {
    expect(codes(withTiers([]))).toEqual(['TIERS_COUNT']);
    expect(codes(withTiers(POLICY.tiers.slice(0, 2)))).toEqual(['TIERS_COUNT']);
    expect(codes(withTiers([...POLICY.tiers, { fromM: 10000, toM: 12000, feeVnd: 25000 }]))).toEqual(['TIERS_COUNT']);
  });

  it('refuses gaps, overlaps, a first band not at 0, empty or reversed bands (0 < b1 < b2 < b3), negative or too-high fees, decimals', () => {
    const [a, b, c] = POLICY.tiers as [FeePolicy['tiers'][number], FeePolicy['tiers'][number], FeePolicy['tiers'][number]];
    expect(codes(withTiers([a, { ...b, fromM: 3500 }, c]))).toEqual(['GAP']);
    expect(codes(withTiers([a, { ...b, fromM: 2500 }, c]))).toEqual(['OVERLAP']);
    expect(codes(withTiers([{ ...a, fromM: 10 }, b, c]))).toEqual(['FIRST_NOT_ZERO']);
    expect(codes(withTiers([{ ...a, toM: 0 }, b, c]))).toContain('RANGE_EMPTY');
    expect(codes(withTiers([a, { ...b, toM: 3000 }, { ...c, fromM: 3000 }]))).toContain('RANGE_EMPTY');
    expect(codes(withTiers([{ ...a, feeVnd: -1 }, b, c]))).toEqual(['FEE_NEGATIVE']);
    expect(codes(withTiers([a, b, { ...c, feeVnd: 10_000_001 }]))).toEqual(['FEE_TOO_HIGH']);
    expect(codes(withTiers([{ ...a, feeVnd: 10000.5 }, b, c]))).toEqual(['NOT_INTEGER']);
    expect(codes(withTiers([a, b, { ...c, toM: 1_000_001 }]))).toEqual(['DISTANCE_TOO_LARGE']);
  });

  it('allows a last bound beyond 10 km (about 10 km is the survey, not a hard technical limit)', () => {
    expect(codes(withTiers([POLICY.tiers[0] as never, POLICY.tiers[1] as never, { fromM: 6000, toM: 14000, feeVnd: 20000 }]))).toEqual([]);
  });

  it('samePolicy compares content', () => {
    expect(samePolicy(POLICY, JSON.parse(JSON.stringify(POLICY)) as FeePolicy)).toBe(true);
    expect(samePolicy(POLICY, withTiers([POLICY.tiers[0] as never, POLICY.tiers[1] as never, { fromM: 6000, toM: 10000, feeVnd: 20001 }]))).toBe(false);
  });
});

describe('M06 evaluateQuote / recheckQuote', () => {
  const snapshot = { versionNo: 3, policy: POLICY };

  it('has no route -> no fee (null, never 0); no table -> no fee; beyond the last band -> OUT_OF_PRICE_RANGE (null)', () => {
    for (const missing of [null, undefined, Number.NaN, -5]) {
      expect(evaluateQuote(snapshot, missing)).toEqual({ status: 'UNPRICED', feeVnd: null, reason: 'ROUTE_DATA_UNAVAILABLE' });
    }
    expect(evaluateQuote(null, 3000)).toEqual({ status: 'UNPRICED', feeVnd: null, reason: 'POLICY_NOT_CONFIGURED' });
    expect(evaluateQuote(snapshot, 12_000)).toEqual({ status: 'UNPRICED', feeVnd: null, reason: 'OUT_OF_PRICE_RANGE' });
    expect(evaluateQuote(snapshot, 5500)).toEqual({ status: 'PRICED', feeVnd: 15000, distanceM: 5500, policyVersionNo: 3, band: 1 });
  });

  it('an unaccepted quote must be priced again after its TTL, a changed place or a new policy version', () => {
    const quote = { policyVersionNo: 3, expiresAtMs: 10_000, pickupKey: 'shop-1', dropoffKey: 'addr-1' };
    const now = { policyVersionNo: 3, pickupKey: 'shop-1', dropoffKey: 'addr-1' };
    expect(recheckQuote(quote, 9_999, now)).toBe('VALID');
    expect(recheckQuote(quote, 10_000, now)).toBe('EXPIRED');
    expect(recheckQuote(quote, 5_000, { ...now, dropoffKey: 'addr-2' })).toBe('LOCATION_CHANGED');
    expect(recheckQuote(quote, 5_000, { ...now, pickupKey: 'shop-2' })).toBe('LOCATION_CHANGED');
    expect(recheckQuote(quote, 5_000, { ...now, policyVersionNo: 4 })).toBe('POLICY_CHANGED');
    expect(recheckQuote(quote, 5_000, { ...now, policyVersionNo: null })).toBe('POLICY_CHANGED');
  });
});

describe('M06-A v1.1 body parsers', () => {
  const tiers = [{ from_m: 0, to_m: 3000, fee_vnd: 10000 }, { from_m: 3000, to_m: 6000, fee_vnd: 15000 }, { from_m: 6000, to_m: 10000, fee_vnd: 20000 }];
  const body = { expected_version: 1, tiers };
  const code = (fn: () => unknown): string | undefined => {
    try {
      fn();
      return undefined;
    } catch (error) {
      return error instanceof AppError ? error.code : 'OTHER';
    }
  };

  it('separates a malformed body (ADMIN_INPUT_INVALID) from a table that breaks a rule (SHIPPING_POLICY_INVALID); no tail any more', () => {
    expect(parseSaveDraftBody(body).policy.tiers).toHaveLength(3);
    expect(code(() => parseSaveDraftBody({ ...body, tail: { base_fee_vnd: 1, step_m: 1000, step_fee_vnd: 1 } }))).toBe('ADMIN_INPUT_INVALID');
    expect(code(() => parseSaveDraftBody({ ...body, extra: 1 }))).toBe('ADMIN_INPUT_INVALID');
    expect(code(() => parseSaveDraftBody({ ...body, expected_version: 0 }))).toBe('ADMIN_INPUT_INVALID');
    expect(code(() => parseSaveDraftBody({ ...body, tiers: [{ from_m: 0, to_m: 2000 }, ...tiers.slice(1)] }))).toBe('ADMIN_INPUT_INVALID');
    expect(code(() => parseSaveDraftBody({ ...body, tiers: tiers.slice(0, 2) }))).toBe('SHIPPING_POLICY_INVALID');
    expect(code(() => parseSaveDraftBody({ ...body, tiers: [...tiers, { from_m: 10000, to_m: 12000, fee_vnd: 1 }] }))).toBe('SHIPPING_POLICY_INVALID');
    expect(code(() => parseSaveDraftBody({ ...body, tiers: [{ ...tiers[0], from_m: 5 }, ...tiers.slice(1)] }))).toBe('SHIPPING_POLICY_INVALID');
  });

  it('parses apply notes and the preview shape', () => {
    expect(parseApplyBody({ expected_version: 2, note: '  ok  ' })).toEqual({ expectedVersion: 2, note: 'ok' });
    expect(parseApplyBody({ expected_version: 2 }).note).toBeNull();
    expect(code(() => parseApplyBody({ expected_version: 2, note: 'x'.repeat(201) }))).toBe('ADMIN_INPUT_INVALID');
    expect(parsePreviewBody({ distance_m: 5500 })).toEqual({ distanceM: 5500, policy: null });
    expect(parsePreviewBody({ distance_m: 5500, tiers }).policy).not.toBeNull();
    expect(code(() => parsePreviewBody({ distance_m: -1 }))).toBe('ADMIN_INPUT_INVALID');
    expect(code(() => parsePreviewBody({ distance_m: 5500, tiers, tail: {} }))).toBe('ADMIN_INPUT_INVALID');
  });
});
