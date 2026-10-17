import { describe, expect, it } from '@jest/globals';
import { AppError } from '../common/app-errors';
import { computeShippingFee, FeePolicy, samePolicy, validateFeePolicy } from './shipping-fee-policy';
import { evaluateQuote, recheckQuote } from './shipping-fee-quote';
import { parseApplyBody, parsePreviewBody, parseSaveDraftBody } from './shipping-fee-policy-validation';

const POLICY: FeePolicy = {
  tiers: [
    { fromM: 0, toM: 2000, feeVnd: 10000 },
    { fromM: 2000, toM: 4000, feeVnd: 12000 },
    { fromM: 4000, toM: 7000, feeVnd: 15000 },
    { fromM: 7000, toM: 10000, feeVnd: 20000 },
  ],
  tail: { baseFeeVnd: 20000, stepM: 1000, stepFeeVnd: 3000 },
};

const fee = (m: number): number => computeShippingFee(POLICY, m).feeVnd;
const codes = (policy: FeePolicy): string[] => validateFeePolicy(policy).map((i) => i.code);
const withTiers = (tiers: FeePolicy['tiers']): FeePolicy => ({ ...POLICY, tiers });

describe('M06-A computeShippingFee', () => {
  it('prices every band, the exact boundaries (they belong to the next band) and distances past the last band', () => {
    expect(fee(0)).toBe(10000);
    expect(fee(1999)).toBe(10000);
    expect(fee(2000)).toBe(12000);
    expect(fee(3999)).toBe(12000);
    expect(fee(4000)).toBe(15000);
    expect(fee(6999)).toBe(15000);
    expect(fee(7000)).toBe(20000);
    expect(fee(9999)).toBe(20000);
    expect(fee(10000)).toBe(20000);
    expect(fee(10999)).toBe(20000);
    expect(fee(11000)).toBe(23000);
    expect(fee(14500)).toBe(32000);
    expect(computeShippingFee(POLICY, 15000)).toEqual({ feeVnd: 35000, band: 'TAIL' });
  });

  it('uses the metre value as is: a display rounding to km never moves a fee', () => {
    expect(fee(1999.9)).toBe(10000); // would round to 2 km (12.000) if km were rounded first
    expect(fee(2000.1)).toBe(12000);
    expect(fee(10999.9)).toBe(20000);
  });

  it('is not the fixed "+5.000 per 5 km" formula: the fee follows whatever the Admin entered', () => {
    const odd: FeePolicy = { tiers: [{ fromM: 0, toM: 700, feeVnd: 4321 }, { fromM: 700, toM: 4100, feeVnd: 4000 }], tail: { baseFeeVnd: 9999, stepM: 250, stepFeeVnd: 7 } };
    expect(computeShippingFee(odd, 699).feeVnd).toBe(4321);
    expect(computeShippingFee(odd, 700).feeVnd).toBe(4000); // a cheaper band after a dearer one is allowed
    expect(computeShippingFee(odd, 4100).feeVnd).toBe(9999);
    expect(computeShippingFee(odd, 4350).feeVnd).toBe(10006);
  });

  it('refuses an invalid policy or distance instead of guessing', () => {
    expect(() => computeShippingFee(withTiers([{ fromM: 0, toM: 100, feeVnd: 1 }, { fromM: 200, toM: 300, feeVnd: 1 }]), 50)).toThrow('INVALID_FEE_POLICY');
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, 2_000_000]) {
      expect(() => computeShippingFee(POLICY, bad)).toThrow('INVALID_DISTANCE');
    }
  });
});

describe('M06-A validateFeePolicy', () => {
  it('accepts a continuous table', () => {
    expect(codes(POLICY)).toEqual([]);
  });

  it('rejects gaps, overlaps, a first band not at 0, empty bands, negative or too-high fees, decimals and an empty table', () => {
    expect(codes(withTiers([{ fromM: 0, toM: 1000, feeVnd: 1 }, { fromM: 1500, toM: 2000, feeVnd: 1 }]))).toEqual(['GAP']);
    expect(codes(withTiers([{ fromM: 0, toM: 1000, feeVnd: 1 }, { fromM: 900, toM: 2000, feeVnd: 1 }]))).toEqual(['OVERLAP']);
    expect(codes(withTiers([{ fromM: 10, toM: 1000, feeVnd: 1 }]))).toEqual(['FIRST_NOT_ZERO']);
    expect(codes(withTiers([{ fromM: 0, toM: 0, feeVnd: 1 }]))).toContain('RANGE_EMPTY');
    expect(codes(withTiers([{ fromM: 0, toM: 1000, feeVnd: -1 }]))).toEqual(['FEE_NEGATIVE']);
    expect(codes(withTiers([{ fromM: 0, toM: 1000, feeVnd: 10_000_001 }]))).toEqual(['FEE_TOO_HIGH']);
    expect(codes(withTiers([{ fromM: 0, toM: 1000.5, feeVnd: 1 }]))).toEqual(['NOT_INTEGER']);
    expect(codes(withTiers([]))).toEqual(['TIERS_EMPTY']);
    expect(codes(withTiers([{ fromM: 0, toM: 1_000_001, feeVnd: 1 }]))).toEqual(['DISTANCE_TOO_LARGE']);
  });

  it('rejects an unusable tail (no step, negative fee)', () => {
    expect(codes({ ...POLICY, tail: { ...POLICY.tail, stepM: 0 } })).toEqual(['TAIL_INVALID']);
    expect(codes({ ...POLICY, tail: { ...POLICY.tail, stepFeeVnd: -1 } })).toEqual(['TAIL_INVALID']);
    expect(codes({ ...POLICY, tail: { ...POLICY.tail, baseFeeVnd: -1 } })).toEqual(['TAIL_INVALID']);
  });

  it('samePolicy compares content', () => {
    expect(samePolicy(POLICY, JSON.parse(JSON.stringify(POLICY)) as FeePolicy)).toBe(true);
    expect(samePolicy(POLICY, { ...POLICY, tail: { ...POLICY.tail, stepFeeVnd: 1 } })).toBe(false);
  });
});

describe('M06 evaluateQuote / recheckQuote', () => {
  const snapshot = { versionNo: 3, policy: POLICY };

  it('has no route -> no fee (null, never 0); no table -> no fee', () => {
    for (const missing of [null, undefined, Number.NaN, -5]) {
      expect(evaluateQuote(snapshot, missing)).toEqual({ status: 'UNPRICED', feeVnd: null, reason: 'ROUTE_DATA_UNAVAILABLE' });
    }
    expect(evaluateQuote(null, 3000)).toEqual({ status: 'UNPRICED', feeVnd: null, reason: 'POLICY_NOT_CONFIGURED' });
    expect(evaluateQuote(snapshot, 5500)).toEqual({ status: 'PRICED', feeVnd: 15000, distanceM: 5500, policyVersionNo: 3, band: 2 });
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

describe('M06-A body parsers', () => {
  const body = { expected_version: 1, tiers: [{ from_m: 0, to_m: 2000, fee_vnd: 10000 }], tail: { base_fee_vnd: 1, step_m: 1000, step_fee_vnd: 1 } };
  const code = (fn: () => unknown): string | undefined => {
    try {
      fn();
      return undefined;
    } catch (error) {
      return error instanceof AppError ? error.code : 'OTHER';
    }
  };

  it('separates a malformed body (ADMIN_INPUT_INVALID) from a table that breaks a rule (SHIPPING_POLICY_INVALID)', () => {
    expect(parseSaveDraftBody(body).policy.tiers).toHaveLength(1);
    expect(code(() => parseSaveDraftBody({ ...body, extra: 1 }))).toBe('ADMIN_INPUT_INVALID');
    expect(code(() => parseSaveDraftBody({ ...body, expected_version: 0 }))).toBe('ADMIN_INPUT_INVALID');
    expect(code(() => parseSaveDraftBody({ ...body, tiers: [{ from_m: 0, to_m: 2000 }] }))).toBe('ADMIN_INPUT_INVALID');
    expect(code(() => parseSaveDraftBody({ ...body, tiers: [{ from_m: 5, to_m: 2000, fee_vnd: 1 }] }))).toBe('SHIPPING_POLICY_INVALID');
  });

  it('parses apply notes and the preview shape', () => {
    expect(parseApplyBody({ expected_version: 2, note: '  ok  ' })).toEqual({ expectedVersion: 2, note: 'ok' });
    expect(parseApplyBody({ expected_version: 2 }).note).toBeNull();
    expect(code(() => parseApplyBody({ expected_version: 2, note: 'x'.repeat(201) }))).toBe('ADMIN_INPUT_INVALID');
    expect(parsePreviewBody({ distance_m: 5500 })).toEqual({ distanceM: 5500, policy: null });
    expect(parsePreviewBody({ distance_m: 5500, tiers: body.tiers, tail: body.tail }).policy).not.toBeNull();
    expect(code(() => parsePreviewBody({ distance_m: -1 }))).toBe('ADMIN_INPUT_INVALID');
  });
});
