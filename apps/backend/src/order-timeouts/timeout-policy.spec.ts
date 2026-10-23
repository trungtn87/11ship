import { describe, expect, it } from '@jest/globals';
import { parseTimeoutParameters, TIMEOUT_DEFAULTS, timeoutDue } from './timeout-policy';
import { composeDeliveryChange, composeOrderChange } from '../notifications/notification-composer';
describe('#153 stage deadlines', () => {
  it('validates all seven bounded integers and timer relationships', () => {
    expect(parseTimeoutParameters(TIMEOUT_DEFAULTS)).toEqual(TIMEOUT_DEFAULTS);
    for (const p of [
      { ...TIMEOUT_DEFAULTS, search_stop: 61 },
      { ...TIMEOUT_DEFAULTS, pickup_warning: 60 },
      { ...TIMEOUT_DEFAULTS, confirmation_reminder: 30 },
      { ...TIMEOUT_DEFAULTS, confirmation_interval: 0 },
      { ...TIMEOUT_DEFAULTS, pickup_cancel: 1.2 },
      { ...TIMEOUT_DEFAULTS, other: 1 },
    ])
      expect(() => parseTimeoutParameters(p)).toThrow();
  });
  it('the exact deadline is due; one millisecond before is not', () => {
    const s = {
      rule_version: 1,
      started_at: '2026-10-21T00:00:00Z',
      warning_at: '2026-10-21T00:30:00Z',
      cancel_at: '2026-10-21T01:00:00Z',
      reminder_interval: 5,
    };
    expect(timeoutDue(s, Date.parse(s.cancel_at) - 1)).toBe(false);
    expect(timeoutDue(s, Date.parse(s.cancel_at))).toBe(true);
  });
  it('warns three parties and notifies only the intended parties of each cancellation', () => {
    const d = {
      deliveryId: 'd',
      orderId: 'o',
      code: 'G-TEST',
      shopId: 's',
      change: 'pickup_timeout_warning',
      state: 'accepted',
      version: 2,
      assignmentId: 'a',
      driverId: 'r',
    };
    const recipients = (x: ReturnType<typeof composeDeliveryChange>) => x.map((n) => (n.type === 'NOTIFY' ? n.draft.audience : null));
    expect(recipients(composeDeliveryChange(d)).sort()).toEqual(['CUSTOMER', 'DRIVER', 'SHOP']);
    expect(recipients(composeDeliveryChange({ ...d, change: 'cancelled_by_system' }))).toEqual(['DRIVER']);
    const o = { orderId: 'o', code: 'D-TEST', shopId: 's', customerUserId: 'c', change: 'confirmation_timeout', status: 'CANCELLED_BY_SYSTEM', version: 2 };
    expect(recipients(composeOrderChange(o))).toEqual(['CUSTOMER']);
    expect(recipients(composeOrderChange({ ...o, change: 'delivery_timeout' }))).toEqual(['CUSTOMER', 'SHOP']);
  });
});
