// Shipping-fee table (M06-A): the pure rules. No I/O, no clock, no built-in price. The database enforces the same shape
// (app.shipping_fee_tiers_valid and the CHECKs of the policy tables); this file is the single place the application decides a fee.
//
// Distances are METRES exactly as M14 reports them: nothing here rounds to km. Bands are half-open [fromM, toM): a distance equal to a
// boundary belongs to the NEXT band. Beyond the last band: base + floor((d - lastToM) / stepM) * stepFee, so a distance on a step
// boundary belongs to the next step and every distance has one fee.

export const MAX_TIERS = 50;
export const MAX_DISTANCE_M = 1_000_000;
export const MAX_FEE_VND = 10_000_000;
export const MAX_TAIL_STEP_M = 100_000;

export interface FeeTier {
  readonly fromM: number;
  readonly toM: number;
  readonly feeVnd: number;
}

export interface FeeTail {
  readonly baseFeeVnd: number;
  readonly stepM: number;
  readonly stepFeeVnd: number;
}

export interface FeePolicy {
  readonly tiers: readonly FeeTier[];
  readonly tail: FeeTail;
}

export type PolicyIssueCode =
  | 'TIERS_EMPTY'
  | 'TIERS_TOO_MANY'
  | 'NOT_INTEGER'
  | 'FIRST_NOT_ZERO'
  | 'RANGE_EMPTY'
  | 'OVERLAP'
  | 'GAP'
  | 'FEE_NEGATIVE'
  | 'FEE_TOO_HIGH'
  | 'DISTANCE_TOO_LARGE'
  | 'TAIL_INVALID';

export interface PolicyIssue {
  readonly code: PolicyIssueCode;
  /** Zero-based tier index, or undefined for the tail / the whole table. */
  readonly index?: number;
}

const isWhole = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);

/** Every reason the table cannot be saved; empty means valid. */
export function validateFeePolicy(policy: FeePolicy): PolicyIssue[] {
  const issues: PolicyIssue[] = [];
  const { tiers, tail } = policy;
  if (tiers.length === 0) {
    issues.push({ code: 'TIERS_EMPTY' });
  }
  if (tiers.length > MAX_TIERS) {
    issues.push({ code: 'TIERS_TOO_MANY' });
  }
  let expectedFrom = 0;
  tiers.forEach((tier, index) => {
    if (!isWhole(tier.fromM) || !isWhole(tier.toM) || !isWhole(tier.feeVnd)) {
      issues.push({ code: 'NOT_INTEGER', index });
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
  if (
    !isWhole(tail.baseFeeVnd) ||
    !isWhole(tail.stepM) ||
    !isWhole(tail.stepFeeVnd) ||
    tail.baseFeeVnd < 0 ||
    tail.baseFeeVnd > MAX_FEE_VND ||
    tail.stepFeeVnd < 0 ||
    tail.stepFeeVnd > MAX_FEE_VND ||
    tail.stepM < 1 ||
    tail.stepM > MAX_TAIL_STEP_M
  ) {
    issues.push({ code: 'TAIL_INVALID' });
  }
  return issues;
}

export interface FeeResult {
  readonly feeVnd: number;
  /** Zero-based index of the band that priced it, or 'TAIL' beyond the last band. */
  readonly band: number | 'TAIL';
}

/**
 * The fee for a distance in metres. Throws on an invalid policy or distance: callers decide first (quote evaluation maps
 * "no distance" to an unpriced result, never to a number).
 */
export function computeShippingFee(policy: FeePolicy, distanceM: number): FeeResult {
  if (validateFeePolicy(policy).length > 0) {
    throw new RangeError('INVALID_FEE_POLICY');
  }
  if (typeof distanceM !== 'number' || !Number.isFinite(distanceM) || distanceM < 0 || distanceM > MAX_DISTANCE_M) {
    throw new RangeError('INVALID_DISTANCE');
  }
  for (let index = 0; index < policy.tiers.length; index += 1) {
    const tier = policy.tiers[index] as FeeTier;
    if (distanceM >= tier.fromM && distanceM < tier.toM) {
      return { feeVnd: tier.feeVnd, band: index };
    }
  }
  const last = policy.tiers[policy.tiers.length - 1] as FeeTier;
  const steps = Math.floor((distanceM - last.toM) / policy.tail.stepM);
  return { feeVnd: policy.tail.baseFeeVnd + steps * policy.tail.stepFeeVnd, band: 'TAIL' };
}

/** Same content, same table (used to refuse an "apply" that changes nothing). */
export function samePolicy(a: FeePolicy, b: FeePolicy): boolean {
  return (
    a.tail.baseFeeVnd === b.tail.baseFeeVnd &&
    a.tail.stepM === b.tail.stepM &&
    a.tail.stepFeeVnd === b.tail.stepFeeVnd &&
    a.tiers.length === b.tiers.length &&
    a.tiers.every((tier, i) => {
      const other = b.tiers[i] as FeeTier;
      return tier.fromM === other.fromM && tier.toM === other.toM && tier.feeVnd === other.feeVnd;
    })
  );
}
