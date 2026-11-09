import { describe, expect, it } from '@jest/globals';
import { KINDS } from './notification-constants';
import { isHighPriorityKind, isTimeBound, TIME_BOUND_KINDS } from './notification-stale';

describe('M08-R-09 stale event classification (P6-9)', () => {
  it('offers, reminders and timeout warnings are time-bound; money, account, end states, complaints and chat are not', () => {
    for (const kind of ['NEW_OFFERS', 'SEARCH_REMINDER', 'SEARCH_STOPPED', 'PICKUP_REMINDER', 'PICKUP_TIMEOUT_WARNING', 'ORDER_CONFIRMATION_REMINDER', 'ORDER_SCHEDULE_REMINDER'] as const) {
      expect(isTimeBound(kind, null)).toBe(true);
    }
    for (const kind of ['FINANCE_UPDATED', 'TOPUP_CONFIRMED', 'WITHDRAWAL_PAID', 'PROFILE_REJECTED', 'COMPLAINT_UPDATED', 'DELIVERY_COMPLETED', 'ORDER_COMPLETED', 'ORDER_CHAT_MESSAGE', 'REVIEW_REMINDER'] as const) {
      expect(isTimeBound(kind, null)).toBe(false);
    }
  });

  it('a draft with a validity window is time-bound whatever its kind', () => {
    expect(isTimeBound('ORDER_COMPLETED', 60_000)).toBe(true);
  });

  it('only wallet/profile kinds (finance and account) raise the HIGH alert', () => {
    const high = KINDS.filter(isHighPriorityKind);
    expect(high).toEqual(expect.arrayContaining(['FINANCE_UPDATED', 'TOPUP_CONFIRMED', 'WITHDRAWAL_PAID', 'PROFILE_APPROVED']));
    expect(high.some((k) => TIME_BOUND_KINDS.has(k))).toBe(false);
    expect(isHighPriorityKind('DELIVERY_COMPLETED')).toBe(false);
  });
});
