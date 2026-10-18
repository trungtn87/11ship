import { computeShippingFee, FeePolicy } from './shipping-fee-policy';

// Quote evaluation (M06, v1.1): turns "a policy version + a route distance from M14" into a priced or an UNPRICED answer. An unpriced quote has
// feeVnd null: never 0, never a straight-line guess. M06 never calls the route service itself; the caller hands the distance in.

export type UnpricedReason = 'POLICY_NOT_CONFIGURED' | 'ROUTE_DATA_UNAVAILABLE' | 'OUT_OF_PRICE_RANGE';

export interface PolicySnapshot {
  readonly versionNo: number;
  readonly policy: FeePolicy;
}

export type QuoteOutcome =
  | { readonly status: 'PRICED'; readonly feeVnd: number; readonly distanceM: number; readonly policyVersionNo: number; readonly band: number }
  | { readonly status: 'UNPRICED'; readonly feeVnd: null; readonly reason: UnpricedReason };

export function evaluateQuote(snapshot: PolicySnapshot | null, distanceM: number | null | undefined): QuoteOutcome {
  if (snapshot === null) {
    return { status: 'UNPRICED', feeVnd: null, reason: 'POLICY_NOT_CONFIGURED' };
  }
  if (typeof distanceM !== 'number' || !Number.isFinite(distanceM) || distanceM < 0) {
    return { status: 'UNPRICED', feeVnd: null, reason: 'ROUTE_DATA_UNAVAILABLE' };
  }
  const result = computeShippingFee(snapshot.policy, distanceM);
  if (result.status === 'OUT_OF_PRICE_RANGE') {
    // Beyond the last band: no fee (null, never 0) and nothing is added or agreed automatically.
    return { status: 'UNPRICED', feeVnd: null, reason: 'OUT_OF_PRICE_RANGE' };
  }
  return { status: 'PRICED', feeVnd: result.feeVnd, distanceM, policyVersionNo: snapshot.versionNo, band: result.band };
}

export interface QuoteSnapshot {
  readonly policyVersionNo: number;
  readonly expiresAtMs: number;
  /** Opaque keys of the pickup and drop-off places the quote was priced for (changing either invalidates it). */
  readonly pickupKey: string;
  readonly dropoffKey: string;
}

export type QuoteRecheck = 'VALID' | 'EXPIRED' | 'POLICY_CHANGED' | 'LOCATION_CHANGED';

/** An unaccepted quote is only usable while unexpired, on the same places and under the policy version still in force. */
export function recheckQuote(quote: QuoteSnapshot, nowMs: number, current: { policyVersionNo: number | null; pickupKey: string; dropoffKey: string }): QuoteRecheck {
  if (nowMs >= quote.expiresAtMs) {
    return 'EXPIRED';
  }
  if (quote.pickupKey !== current.pickupKey || quote.dropoffKey !== current.dropoffKey) {
    return 'LOCATION_CHANGED';
  }
  if (current.policyVersionNo !== quote.policyVersionNo) {
    return 'POLICY_CHANGED';
  }
  return 'VALID';
}
