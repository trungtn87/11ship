import { describe, expect, it } from '@jest/globals';
import { customerMayCancel, displayStatusOf, goodsDescriptionOf, mayCallShipper, mergeCartLines, needsAttention, newOrderCode, scheduleInWindow, totalOf } from './order-rules';

describe('M10 order rules', () => {
  it('merges the same dish with the same note and keeps different notes on their own line', () => {
    const merged = mergeCartLines([
      { itemId: 'a', quantity: 1, note: 'ít cay' },
      { itemId: 'a', quantity: 2, note: '  Ít  cay ' },
      { itemId: 'a', quantity: 1, note: null },
      { itemId: 'a', quantity: 1, note: '   ' },
      { itemId: 'b', quantity: 3, note: null },
      { itemId: 'a', quantity: 1, note: 'không hành' },
    ]);
    expect(merged).toEqual([
      { itemId: 'a', quantity: 3, note: 'ít cay' },
      { itemId: 'a', quantity: 2, note: null },
      { itemId: 'b', quantity: 3, note: null },
      { itemId: 'a', quantity: 1, note: 'không hành' },
    ]);
  });

  it('totals whole VND and leaves removed lines out', () => {
    expect(totalOf([{ unitPriceVnd: 45_000, quantity: 2 }, { unitPriceVnd: 5_000, quantity: 1, removed: true }, { unitPriceVnd: 10_000, quantity: 3 }])).toBe(120_000);
  });

  it('cuts the goods text to 120 characters', () => {
    expect(goodsDescriptionOf([{ name: 'Phở bò', quantity: 2 }, { name: 'Trà đá', quantity: 1 }])).toBe('2× Phở bò, 1× Trà đá');
    const long = goodsDescriptionOf(Array.from({ length: 20 }, (_, i) => ({ name: `Món số ${String(i)} rất dài`, quantity: 1 })));
    expect([...long].length).toBeLessThanOrEqual(120);
    expect(long.endsWith('…')).toBe(true);
  });

  it('lets the customer cancel only before confirmation', () => {
    expect(customerMayCancel('PENDING_CONFIRMATION')).toBe(true);
    expect(customerMayCancel('PREPARING')).toBe(false);
    expect(customerMayCancel('CANCELLED_BY_CUSTOMER')).toBe(false);
  });

  it('bounds the wanted time of a scheduled order', () => {
    const now = Date.UTC(2026, 9, 18, 5, 0, 0);
    expect(scheduleInWindow(now + 10 * 60_000, now)).toBe('TOO_SOON');
    expect(scheduleInWindow(now + 30 * 60_000, now)).toBe('OK');
    expect(scheduleInWindow(now + 8 * 24 * 3_600_000, now)).toBe('TOO_FAR');
  });

  it('shows one status from the order and its latest delivery', () => {
    expect(displayStatusOf('PENDING_CONFIRMATION', false, null)).toBe('AWAITING_SHOP');
    expect(displayStatusOf('PREPARING', false, null)).toBe('PREPARING');
    expect(displayStatusOf('PREPARING', true, null)).toBe('READY');
    expect(displayStatusOf('PREPARING', false, 'waiting_driver')).toBe('SEARCHING_SHIPPER');
    expect(displayStatusOf('PREPARING', false, 'accepted')).toBe('SHIPPER_COMING');
    expect(displayStatusOf('PREPARING', true, 'accepted')).toBe('READY');
    expect(displayStatusOf('PREPARING', true, 'delivering')).toBe('DELIVERING');
    expect(displayStatusOf('PREPARING', false, 'search_stopped')).toBe('SEARCH_STOPPED');
    expect(displayStatusOf('PREPARING', false, 'failed')).toBe('DELIVERY_FAILED');
    // a delivery cancelled on its own does not cancel the order
    expect(displayStatusOf('PREPARING', false, 'cancelled_by_merchant')).toBe('PREPARING');
    expect(displayStatusOf('COMPLETED', true, 'completed')).toBe('COMPLETED');
    expect(displayStatusOf('REJECTED_BY_SHOP', false, null)).toBe('REJECTED');
    expect(displayStatusOf('NOT_COMPLETED', false, 'failed')).toBe('NOT_COMPLETED');
  });

  it('flags a stopped search and a failed delivery for the shop, and allows a new call only when no delivery is running', () => {
    expect(needsAttention('PREPARING', 'search_stopped')).toBe(true);
    expect(needsAttention('PREPARING', 'failed')).toBe(true);
    expect(needsAttention('PREPARING', 'delivering')).toBe(false);
    expect(needsAttention('COMPLETED', 'search_stopped')).toBe(false);
    expect(mayCallShipper('PREPARING', null)).toBe(true);
    expect(mayCallShipper('PREPARING', 'search_stopped')).toBe(true);
    expect(mayCallShipper('PREPARING', 'waiting_driver')).toBe(false);
    expect(mayCallShipper('PREPARING', 'delivering')).toBe(false);
    expect(mayCallShipper('PENDING_CONFIRMATION', null)).toBe(false);
    expect(mayCallShipper('COMPLETED', null)).toBe(false);
  });

  it('makes a readable order code', () => {
    expect(newOrderCode()).toMatch(/^DH-[2-9A-HJ-NP-Z]{6}$/u);
  });
});
