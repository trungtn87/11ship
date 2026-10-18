// Shipping-fee table (M06-A, v1.1): the pure rules. No I/O, no clock, no built-in price. The database enforces the same shape
// (app.shipping_fee_three_tiers_valid and the CHECKs of the policy tables); this file is the single place the application decides a base fee.
//
// EXACTLY THREE bands over the real route distance in METRES from M14 (never rounded, never a straight line): [0, b1) [b1, b2) [b2, b3] with
// 0 < b1 < b2 < b3. A distance equal to b1 belongs to band 2, equal to b2 to band 3, and equal to b3 still to band 3. Beyond b3 there is NO fee
// (null, reason OUT_OF_PRICE_RANGE): nothing is added automatically, it is never 0, and it never turns into an agreed fee by itself.

export const TIER_COUNT = 3;
export const MAX_DISTANCE_M = 1_000_000;
export const MAX_FEE_VND = 10_000_000;

export interface FeeTier {
  readonly fromM: number;
  readonly toM: number;
  readonly feeVnd: number;
}

export interface FeePolicy {
  readonly tiers: readonly FeeTier[];
}

export type PolicyIssueCode = 'TIERS_COUNT' | 'NOT_INTEGER' | 'FIRST_NOT_ZERO' | 'RANGE_EMPTY' | 'OVERLAP' | 'GAP' | 'FEE_NEGATIVE' | 'FEE_TOO_HIGH' | 'DISTANCE_TOO_LARGE';

export interface PolicyIssue {
  readonly code: PolicyIssueCode;
  /** Zero-based band index, or undefined for the table as a whole. */
  readonly index?: number;
}

const isWhole = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);

/** Every reason the table cannot be saved; empty means valid. */
export function validateFeePolicy(policy: FeePolicy): PolicyIssue[] {
  const issues: PolicyIssue[] = [];
  const { tiers } = policy;
  if (tiers.length !== TIER_COUNT) {
    issues.push({ code: 'TIERS_COUNT' });
  }
  let expectedFrom = 0;
  tiers.forEach((tier, index) => {
    if (!isWhole(tier.fromM) || !isWhole(tier.toM) || !isWhole(tier.feeVnd)) {
      issues.push({ code: 'NOT_INTEGER', index });
      expectedFrom = isWhole(tier.toM) ? tier.toM : expectedFrom; // keep the next band's continuity check meaningful
      return;
    }
    if (index === 0 && tier.fromM !== 0) {
      issues.push({ code: 'FIRST_NOT_ZERO', index });
    } else if (index > 0 && tier.fromM < expectedFrom) {
      issues.push({ code: 'OVERLAP', index });
    } else if (index > 0 && tier.fromM > expectedFrom) {
      issues.push({ code: 'GAP', index });
    }
    if (tier.toM <= tier.fromM) {
      issues.push({ code: 'RANGE_EMPTY', index });
    }
    if (tier.feeVnd < 0) {
      issues.push({ code: 'FEE_NEGATIVE', index });
    } else if (tier.feeVnd > MAX_FEE_VND) {
      issues.push({ code: 'FEE_TOO_HIGH', index });
    }
    if (tier.toM > MAX_DISTANCE_M) {
      issues.push({ code: 'DISTANCE_TOO_LARGE', index });
    }
    expectedFrom = tier.toM;
  });
  return issues;
}

export type FeeResult =
  | { readonly status: 'PRICED'; readonly feeVnd: number; /** Zero-based band that priced it. */ readonly band: number }
  | { readonly status: 'OUT_OF_PRICE_RANGE'; readonly feeVnd: null };

/**
 * The base fee for a distance in metres. Throws on an invalid policy or distance: callers decide first (quote evaluation maps "no distance" to an
 * unpriced result, never to a number).
 */
export function computeShippingFee(policy: FeePolicy, distanceM: number): FeeResult {
  if (validateFeePolicy(policy).length > 0) {
    throw new RangeError('INVALID_FEE_POLICY');
  }
  if (typeof distanceM !== 'number' || !Number.isFinite(distanceM) || distanceM < 0) {
    throw new RangeError('INVALID_DISTANCE');
  }
  const last = policy.tiers.length - 1;
  for (let index = 0; index <= last; index += 1) {
    const tier = policy.tiers[index] as FeeTier;
    // Half-open [from, to) for the first two bands; the last band also includes its upper bound.
    if (distanceM >= tier.fromM && (distanceM < tier.toM || (index === last && distanceM === tier.toM))) {
      return { status: 'PRICED', feeVnd: tier.feeVnd, band: index };
    }
  }
  return { status: 'OUT_OF_PRICE_RANGE', feeVnd: null };
}

/** Same content, same table (used to refuse an "apply" that changes nothing). */
export function samePolicy(a: FeePolicy, b: FeePolicy): boolean {
  return (
    a.tiers.length === b.tiers.length &&
    a.tiers.every((tier, i) => {
      const other = b.tiers[i] as FeeTier;
      return tier.fromM === other.fromM && tier.toM === other.toM && tier.feeVnd === other.feeVnd;
    })
  );
}
