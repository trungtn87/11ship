import { describe, expect, it } from '@jest/globals';
import { KINDS } from './notification-constants';
import { DRAFT_CLASS, isHighPriorityKind, isTimeBound } from './notification-stale';

describe('M08-R-09 stale event classification (P6-9)', () => {
  it('every notification kind has an explicit class (the table covers the whole catalogue, no extra keys)', () => {
    expect(Object.keys(DRAFT_CLASS).sort()).toEqual([...KINDS].sort());
    for (const kind of KINDS) {
      expect(['TIME_BOUND', 'DURABLE']).toContain(DRAFT_CLASS[kind]);
    }
  });

  it('time-bound drafts: offers, search and pickup notices, timeout warnings, and the order that waits for the shop (ORDER_PLACED included)', () => {
    const timeBound = KINDS.filter((k) => DRAFT_CLASS[k] === 'TIME_BOUND').sort();
    expect(timeBound).toEqual(['NEW_OFFERS', 'ORDER_CONFIRMATION_REMINDER', 'ORDER_PLACED', 'ORDER_SCHEDULE_REMINDER', 'PICKUP_REMINDER', 'PICKUP_TIMEOUT_WARNING', 'SEARCH_REMINDER', 'SEARCH_STOPPED']);
    for (const kind of timeBound) {
      expect(isTimeBound(kind, null)).toBe(true);
    }
  });

  it('durable drafts: money, account, complaint, end states, chat and finance are never dropped by their type', () => {
    for (const kind of ['FINANCE_UPDATED', 'TOPUP_CONFIRMED', 'WITHDRAWAL_PAID', 'PROFILE_REJECTED', 'COMPLAINT_UPDATED', 'DELIVERY_COMPLETED', 'ORDER_COMPLETED', 'ORDER_CHAT_MESSAGE', 'REVIEW_REMINDER'] as const) {
      expect(isTimeBound(kind, null)).toBe(false);
    }
  });

  it('a draft that carries its own validity window is time-bound whatever its kind', () => {
    expect(isTimeBound('ORDER_COMPLETED', 60_000)).toBe(true);
  });

  it('only wallet/profile kinds (finance and account) raise the HIGH alert', () => {
    const high = KINDS.filter(isHighPriorityKind);
    expect(high).toEqual(expect.arrayContaining(['FINANCE_UPDATED', 'TOPUP_CONFIRMED', 'WITHDRAWAL_PAID', 'PROFILE_APPROVED']));
    expect(high.every((k) => DRAFT_CLASS[k] === 'DURABLE')).toBe(true);
    expect(isHighPriorityKind('DELIVERY_COMPLETED')).toBe(false);
  });
});
