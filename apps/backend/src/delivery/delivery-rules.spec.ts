import { describe, expect, it } from '@jest/globals';
import { DELIVERY_STATES } from './delivery-constants';
import { shouldShareLocation } from './shipper-location';
import {
  dropoffAreaOf,
  dueSearchReminders,
  feeStatusOf,
  freshnessOf,
  locationValid,
  mayRecall,
  newDeliveryCode,
  originalEtaMs,
  pickupReminderDue,
  searchExpired,
  shipperMayRelease,
  shopMayCancel,
  stateAfterRelease,
} from './delivery-rules';

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 18, 9, 0, 0);

describe('M07 rules — position freshness (M14)', () => {
  it('LIVE up to 2 minutes, STALE up to 10, LOST after; an invalid position is LOST whatever its age', () => {
    expect(freshnessOf(0, true)).toBe('LIVE');
    expect(freshnessOf(120, true)).toBe('LIVE');
    expect(freshnessOf(121, true)).toBe('STALE');
    expect(freshnessOf(600, true)).toBe('STALE');
    expect(freshnessOf(601, true)).toBe('LOST');
    expect(freshnessOf(5, false)).toBe('LOST');
    expect(freshnessOf(-1, true)).toBe('LOST');
    expect(freshnessOf(Number.NaN, true)).toBe('LOST');
  });

  it('validity: coordinates in range and a plausible accuracy', () => {
    expect(locationValid(22.66, 106.25, 12)).toBe(true);
    expect(locationValid(22.66, 106.25, null)).toBe(true);
    expect(locationValid(91, 106, null)).toBe(false);
    expect(locationValid(22, 181, null)).toBe(false);
    expect(locationValid(22, 106, 501)).toBe(false);
    expect(locationValid(Number.NaN, 106, null)).toBe(false);
  });
});

describe('M07 rules — who may end a delivery before pickup', () => {
  it('the shop cancels before pickup (and closes a stopped search), never after', () => {
    for (const state of DELIVERY_STATES) {
      const expected = ['waiting_driver', 'accepted', 'location_confirmed', 'search_stopped'].includes(state);
      expect([state, shopMayCancel(state)]).toEqual([state, expected]);
    }
  });

  it('the Shipper gives up only an accepted delivery that is not picked up', () => {
    for (const state of DELIVERY_STATES) {
      expect([state, shipperMayRelease(state)]).toEqual([state, state === 'accepted' || state === 'location_confirmed']);
    }
  });

  it('a released delivery goes back to the search only inside the ORIGINAL window; the deadline is never moved', () => {
    const expires = T0 + 30 * MIN;
    expect(stateAfterRelease(T0 + 29 * MIN + 59_000, expires)).toBe('waiting_driver');
    expect(stateAfterRelease(expires, expires)).toBe('search_stopped');
    expect(stateAfterRelease(expires + MIN, expires)).toBe('search_stopped');
  });
});

describe('M07 rules — search clock and reminders', () => {
  it('expires exactly at 30 minutes', () => {
    expect(searchExpired(T0 + 30 * MIN - 1, T0 + 30 * MIN)).toBe(false);
    expect(searchExpired(T0 + 30 * MIN, T0 + 30 * MIN)).toBe(true);
  });

  it('the 5 and 15 minute reminders are due once each, together if the worker was down, and never at or after the end', () => {
    const none = { m5: false, m15: false };
    expect(dueSearchReminders(T0 + 4 * MIN, T0, none)).toEqual([]);
    expect(dueSearchReminders(T0 + 5 * MIN, T0, none)).toEqual([5]);
    expect(dueSearchReminders(T0 + 5 * MIN, T0, { m5: true, m15: false })).toEqual([]);
    expect(dueSearchReminders(T0 + 16 * MIN, T0, none)).toEqual([5, 15]);
    expect(dueSearchReminders(T0 + 16 * MIN, T0, { m5: true, m15: false })).toEqual([15]);
    expect(dueSearchReminders(T0 + 30 * MIN, T0, none)).toEqual([]);
  });

  it('the pickup reminder repeats every 5 minutes from the accept or the last reminder', () => {
    expect(pickupReminderDue(T0 + 4 * MIN, T0, null)).toBe(false);
    expect(pickupReminderDue(T0 + 5 * MIN, T0, null)).toBe(true);
    expect(pickupReminderDue(T0 + 7 * MIN, T0, T0 + 5 * MIN)).toBe(false);
    expect(pickupReminderDue(T0 + 10 * MIN, T0, T0 + 5 * MIN)).toBe(true);
  });
});

describe('M07 rules — calling again', () => {
  it('only from a stopped or cancelled request, or a failed one whose goods are settled', () => {
    expect(mayRecall('search_stopped', false)).toBe(true);
    expect(mayRecall('cancelled_by_merchant', false)).toBe(true);
    expect(mayRecall('failed', true)).toBe(false);
    expect(mayRecall('failed', false)).toBe(true);
    for (const state of ['waiting_driver', 'accepted', 'location_confirmed', 'picked_up', 'delivering', 'completed'] as const) {
      expect([state, mayRecall(state, false)]).toEqual([state, false]);
    }
  });
});

describe('M07 rules — what a Shipper sees of the drop-off before accepting', () => {
  it('the street line is never part of the area; a single-line address has no area', () => {
    expect(dropoffAreaOf('Số 12 Đường Hoàng Văn Thụ, Phường Hợp Giang, TP. Cao Bằng')).toBe('Phường Hợp Giang, TP. Cao Bằng');
    expect(dropoffAreaOf('Số 12 Đường Hoàng Văn Thụ')).toBeNull();
    expect(dropoffAreaOf('  ,  ')).toBeNull();
  });

  it('a segment that looks like a phone or a long number is dropped', () => {
    expect(dropoffAreaOf('Nhà 5, 0912345678, Phường A')).toBe('Phường A');
    expect(dropoffAreaOf('Nhà 5, 0912345678')).toBeNull();
  });

  it('is bounded', () => {
    expect([...(dropoffAreaOf(`x, ${'a'.repeat(400)}`) ?? '')].length).toBe(160);
  });
});

describe('M07 rules — codes, ETA and fee status', () => {
  it('a delivery code is G- and six characters without look-alikes', () => {
    for (let index = 0; index < 50; index += 1) {
      expect(newDeliveryCode()).toMatch(/^G-[2-9A-HJ-NP-Z]{6}$/);
    }
  });

  it('the original ETA is the sum of the legs and service times; unknown if a leg is unknown', () => {
    expect(originalEtaMs(T0, 300, 600, 120, 60)).toBe(T0 + 1080_000);
    expect(originalEtaMs(T0, null, 600, 120, 60)).toBeNull();
    expect(originalEtaMs(T0, 300, null, 120, 60)).toBeNull();
  });

  it('an unknown fee stays UNKNOWN (never 0); an open agreement is pending, not final', () => {
    expect(feeStatusOf({ feeVnd: null, agreementStatus: null })).toBe('UNKNOWN');
    expect(feeStatusOf({ feeVnd: 0, agreementStatus: null })).toBe('FINAL');
    expect(feeStatusOf({ feeVnd: 15000, agreementStatus: 'ACCEPTED' })).toBe('FINAL');
    expect(feeStatusOf({ feeVnd: null, agreementStatus: 'PROPOSED' })).toBe('PENDING_AGREEMENT');
    expect(feeStatusOf({ feeVnd: null, agreementStatus: 'COUNTERED' })).toBe('PENDING_AGREEMENT');
    expect(feeStatusOf({ feeVnd: null, agreementStatus: 'AWAITING_CUSTOMER' })).toBe('AWAITING_CUSTOMER');
    expect(feeStatusOf({ feeVnd: null, agreementStatus: 'EXPIRED' })).toBe('UNKNOWN');
  });
});

describe('M14 — when the position must keep being shared', () => {
  it.each([
    ['ACTIVE', true, false, true],
    ['ACTIVE', false, false, false],
    // Issue #265: switching off stops the position even with a delivery in progress; the duty is not affected.
    ['ACTIVE', false, true, false],
    ['ACTIVE', true, true, true],
    ['CLOSING', true, false, false],
    ['CLOSING', false, true, false],
    ['SUSPENDED', true, false, false],
    ['PENDING', false, false, false],
  ] as const)('%s, switch %s, work in progress %s -> share %s', (status, accepting, work, expected) => {
    expect(shouldShareLocation({ status, acceptingDeliveries: accepting })).toBe(expected); // `work` is in the title only: it no longer changes the answer
  });
});
