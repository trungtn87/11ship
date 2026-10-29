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

  it('shows the exact unavailable reason persisted for a newly placed Order', () => {
    expect(moneyView(historical({ feeEstimateReason: 'POLICY_NOT_CONFIGURED', addressLat: 21, addressLng: 105.82 }), undefined).fee)
      .toMatchObject({ status: 'UNAVAILABLE', fee_vnd: null, reason: 'POLICY_NOT_CONFIGURED' });
  });
});

describe('M10 item payment projection', () => {
  it('keeps paid and remaining item money separate and never returns a negative remainder', () => {
    expect(moneyView(historical({ itemsTotalVnd: 45_000, paidVnd: 20_000 }), undefined)).toMatchObject({ paid_vnd: 20_000, items_remaining_vnd: 25_000 });
    expect(moneyView(historical({ itemsTotalVnd: 45_000, paidVnd: 50_000 }), undefined)).toMatchObject({ paid_vnd: 50_000, items_remaining_vnd: 0 });
  });
});

describe('M10 customer fee proposal projection', () => {
  it('marks only a fee that the customer raised above the canonical quote', () => {
    expect(moneyView(historical({ feeQuoteVnd: 10_000, feeEstimateVnd: 30_000 }), undefined).fee).toMatchObject({ customer_proposed: true, estimate_vnd: 30_000 });
    expect(moneyView(historical({ feeQuoteVnd: 10_000, feeEstimateVnd: 10_000 }), undefined).fee).toMatchObject({ customer_proposed: false, estimate_vnd: 10_000 });
    expect(moneyView(historical({ feeEstimateVnd: 10_000 }), undefined).fee).toMatchObject({ customer_proposed: false });
  });
});
