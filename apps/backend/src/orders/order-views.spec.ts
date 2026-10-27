import { describe, expect, it } from '@jest/globals';
import { OrderRow } from './order-repository';
import { moneyView } from './order-views';

const historical = (over: Partial<OrderRow>): OrderRow => ({
  orderId: '11111111-1111-4111-8111-111111111111',
  status: 'PENDING_CONFIRMATION',
  version: 1,
  itemsOriginalTotalVnd: 45_000,
  itemsTotalVnd: 45_000,
  paidVnd: 0,
  feeEstimateVnd: null,
  feeEstimateDistanceM: null,
  addressLat: null,
  addressLng: null,
  createdAtMs: 1_800_000_000_000,
  ...over,
} as OrderRow);

describe('M10 historical quote reason projection', () => {
  it('does not invent a missing-pin, routing, policy, or out-of-range reason when the old snapshot did not store one', () => {
    for (const order of [
      historical({ addressLat: null, addressLng: null }),
      historical({ addressLat: 21, addressLng: 105.82 }),
      historical({ addressLat: 21, addressLng: 105.82, feeEstimateDistanceM: 20_000 }),
    ]) {
      expect(moneyView(order, undefined).fee).toMatchObject({ status: 'UNAVAILABLE', fee_vnd: null, reason: null });
    }
  });
});
