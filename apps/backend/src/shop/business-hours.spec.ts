import { describe, expect, it } from '@jest/globals';
import { AppError } from '../common/app-errors';
import {
  BusinessInterval,
  canonicalizeBusinessHours,
  durationMinutes,
  fromWire,
  isOpenAt,
  isOpenAtWeekMillisecond,
  MAX_INTERVALS_PER_WEEK,
  MINUTES_PER_WEEK,
  normalizeInterval,
  toWire,
  weekMillisecondAt,
} from './business-hours';

// M02-A acceptance A04 (schedules), A05 (past midnight, Sunday -> Monday, overlap, adjacency), A06 and A18 (the
// boundary rules and the canonical forms) on the PURE rules. The same boundaries are proven against the real
// PostgreSQL statement in tests/integration/shop-availability.int.spec.ts.

function interval(weekday: number, startMinute: number, endMinute: number, endDayOffset = 0): BusinessInterval {
  return { weekday, startMinute, endMinute, endDayOffset };
}

function hm(hours: number, minutes = 0): number {
  return hours * 60 + minutes;
}

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof AppError ? error.code : `OTHER:${String(error)}`;
  }
  return 'OK';
}

const MS_PER_MINUTE = 60_000;

/** An instant given as its Asia/Ho_Chi_Minh wall clock (UTC+7 all year). */
function local(year: number, month: number, day: number, hours = 0, minutes = 0, seconds = 0, ms = 0): number {
  return Date.UTC(year, month - 1, day, hours - 7, minutes, seconds, ms);
}

describe('canonicalizeBusinessHours — legal schedules (A04, A05)', () => {
  it('accepts an ordinary day, several intervals on one day, and the empty schedule', () => {
    expect(canonicalizeBusinessHours([interval(1, hm(8), hm(22))])).toEqual([interval(1, hm(8), hm(22))]);
    const split = [interval(1, hm(8), hm(11)), interval(1, hm(13), hm(22))];
    expect(canonicalizeBusinessHours(split)).toEqual(split);
    expect(canonicalizeBusinessHours([])).toEqual([]);
  });

  it('accepts 00:00-24:00, an interval past midnight, one that closes exactly at midnight, and a 24-hour interval', () => {
    expect(canonicalizeBusinessHours([interval(3, 0, 1440)])).toEqual([interval(3, 0, 1440)]);
    expect(canonicalizeBusinessHours([interval(1, hm(18), hm(2), 1)])).toEqual([interval(1, hm(18), hm(2), 1)]);
    // 18:00 until 00:00 of the next day: end_minute = 0 with offset 1 is valid when the interval does not start at 0.
    expect(canonicalizeBusinessHours([interval(4, hm(18), 0, 1)])).toEqual([interval(4, hm(18), 0, 1)]);
    // 24 hours that start at 06:00 is written start = end with offset 1.
    expect(canonicalizeBusinessHours([interval(6, hm(6), hm(6), 1)])).toEqual([interval(6, hm(6), hm(6), 1)]);
  });

  it('adjacent intervals are legal and are never merged', () => {
    const adjacent = [interval(2, hm(8), hm(12)), interval(2, hm(12), hm(18))];
    expect(canonicalizeBusinessHours(adjacent)).toEqual(adjacent);
    // Past midnight into the next day's first interval.
    const overnight = [interval(2, hm(22), 0, 1), interval(3, 0, hm(6))];
    expect(canonicalizeBusinessHours(overnight)).toEqual(overnight);
    // Sunday 22:00 until Monday 00:00, then Monday from 00:00: adjacency across the week boundary.
    const wrapAdjacent = [interval(7, hm(22), 0, 1), interval(1, 0, hm(8))];
    expect(canonicalizeBusinessHours(wrapAdjacent)).toEqual([interval(1, 0, hm(8)), interval(7, hm(22), 0, 1)]);
  });

  it('a 24-hour interval that ends exactly when the next one starts is adjacent, also across Sunday -> Monday', () => {
    const wrap24 = [interval(7, hm(10), hm(10), 1), interval(1, hm(10), hm(12))];
    expect(canonicalizeBusinessHours(wrap24)).toHaveLength(2);
  });

  it('returns the schedule sorted by weekday, start, end and offset whatever the request order', () => {
    const shuffled = [interval(7, hm(9), hm(10)), interval(2, hm(13), hm(14)), interval(2, hm(8), hm(9)), interval(1, hm(1), hm(2))];
    expect(canonicalizeBusinessHours(shuffled)).toEqual([
      interval(1, hm(1), hm(2)),
      interval(2, hm(8), hm(9)),
      interval(2, hm(13), hm(14)),
      interval(7, hm(9), hm(10)),
    ]);
    expect(canonicalizeBusinessHours([...shuffled].reverse())).toEqual(canonicalizeBusinessHours(shuffled));
  });

  it('never mutates its input', () => {
    const input = Object.freeze([interval(2, hm(13), hm(14)), interval(1, hm(8), hm(9))]);
    const before = JSON.stringify(input);
    canonicalizeBusinessHours(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('canonicalizeBusinessHours — the two spellings of a full day (A18)', () => {
  it('(0, 1440, +0) and (0, 0, +1) are one meaning with ONE canonical form: 0 to 1440', () => {
    expect(normalizeInterval(interval(2, 0, 0, 1))).toEqual(interval(2, 0, 1440, 0));
    expect(canonicalizeBusinessHours([interval(2, 0, 0, 1)])).toEqual(canonicalizeBusinessHours([interval(2, 0, 1440, 0)]));
    expect(canonicalizeBusinessHours([interval(2, 0, 0, 1)])).toEqual([interval(2, 0, 1440, 0)]);
  });

  it('a 24-hour interval that starts at another time keeps its only spelling (start = end, +1)', () => {
    expect(normalizeInterval(interval(5, hm(6), hm(6), 1))).toEqual(interval(5, hm(6), hm(6), 1));
    expect(normalizeInterval(interval(5, 1, 1, 1))).toEqual(interval(5, 1, 1, 1));
  });

  it('both spellings of the same day collide as a duplicate instead of both being stored', () => {
    expect(codeOf(() => canonicalizeBusinessHours([interval(2, 0, 1440), interval(2, 0, 0, 1)]))).toBe('INVALID_BUSINESS_HOURS');
  });

  it('durations: a 24-hour interval is exactly 1440 minutes in both spellings, an ordinary one is its length', () => {
    expect(durationMinutes(interval(2, 0, 1440))).toBe(1440);
    expect(durationMinutes(interval(2, 0, 0, 1))).toBe(1440);
    expect(durationMinutes(interval(6, hm(6), hm(6), 1))).toBe(1440);
    expect(durationMinutes(interval(1, hm(18), hm(2), 1))).toBe(hm(8));
    expect(durationMinutes(interval(1, hm(8), hm(8, 1)))).toBe(1);
  });
});

describe('canonicalizeBusinessHours — what is refused (A04, A05)', () => {
  const REFUSED: ReadonlyArray<readonly [string, BusinessInterval]> = [
    ['weekday 0 (there is no "all week" value)', interval(0, hm(8), hm(9))],
    ['weekday 8', interval(8, hm(8), hm(9))],
    ['a fractional weekday', interval(1.5, hm(8), hm(9))],
    ['a negative start', interval(1, -1, hm(9))],
    ['a start of 1440', interval(1, 1440, 1441)],
    ['an end of 1441', interval(1, hm(8), 1441)],
    ['a negative end', interval(1, hm(8), -1)],
    ['an offset of 2', interval(1, hm(8), hm(9), 2)],
    ['a negative offset', interval(1, hm(8), hm(9), -1)],
    ['a fractional minute', interval(1, 0.5, hm(9))],
    ['NaN', interval(1, Number.NaN, hm(9))],
    ['an unsafe integer', interval(1, Number.MAX_SAFE_INTEGER + 1, hm(9))],
    ['a zero-length same-day interval', interval(1, hm(8), hm(8))],
    ['a same-day interval that closes before it opens', interval(1, hm(9), hm(8))],
    ['a next-day interval that closes after it opens (more than 24 hours)', interval(1, hm(8), hm(8, 1), 1)],
    ['a next-day interval that closes at 24:00', interval(1, hm(8), 1440, 1)],
  ];

  it.each(REFUSED)('refuses %s with INVALID_BUSINESS_HOURS', (_name, bad) => {
    expect(codeOf(() => canonicalizeBusinessHours([bad]))).toBe('INVALID_BUSINESS_HOURS');
  });

  it('refuses every kind of overlap on the week ring, with INVALID_BUSINESS_HOURS and never a merge', () => {
    const overlapping: ReadonlyArray<readonly [string, BusinessInterval[]]> = [
      ['two overlapping intervals of one day', [interval(2, hm(8), hm(12)), interval(2, hm(11), hm(14))]],
      ['one interval inside another', [interval(2, hm(8), hm(18)), interval(2, hm(10), hm(11))]],
      ['two identical intervals', [interval(2, hm(8), hm(12)), interval(2, hm(8), hm(12))]],
      ['two intervals with the same start', [interval(2, hm(8), hm(12)), interval(2, hm(8), hm(10))]],
      ['an overnight interval and the next day (the PREVIOUS day overlaps the NEXT)', [interval(2, hm(22), hm(2), 1), interval(3, hm(1), hm(3))]],
      ['the next day overlapping an earlier overnight interval, listed first', [interval(3, hm(1), hm(3)), interval(2, hm(22), hm(2), 1)]],
      ['a full day and a part of the same day', [interval(4, 0, 1440), interval(4, hm(12), hm(13))]],
      ['Sunday past midnight and Monday (the wrap Sunday -> Monday)', [interval(7, hm(22), hm(2), 1), interval(1, hm(1), hm(3))]],
      ['a 24-hour interval that starts on Sunday and Monday morning', [interval(7, hm(10), hm(10), 1), interval(1, hm(9), hm(12))]],
      ['an overnight interval and the one that starts inside its tail on the same weekday number', [interval(7, hm(23), hm(23), 1), interval(7, hm(23, 30), hm(23, 45))]],
    ];
    for (const [name, intervals] of overlapping) {
      expect([name, codeOf(() => canonicalizeBusinessHours(intervals))]).toEqual([name, 'INVALID_BUSINESS_HOURS']);
    }
  });

  it('accepts exactly 28 intervals and refuses the 29th even when nothing overlaps', () => {
    const slots = [
      [hm(0), hm(1)],
      [hm(6), hm(7)],
      [hm(12), hm(13)],
      [hm(18), hm(19)],
    ] as const;
    const twentyEight: BusinessInterval[] = [];
    for (let weekday = 1; weekday <= 7; weekday += 1) {
      for (const [start, end] of slots) {
        twentyEight.push(interval(weekday, start, end));
      }
    }
    expect(twentyEight).toHaveLength(MAX_INTERVALS_PER_WEEK);
    expect(canonicalizeBusinessHours(twentyEight)).toHaveLength(28);
    expect(codeOf(() => canonicalizeBusinessHours([...twentyEight, interval(1, hm(20), hm(21))]))).toBe('INVALID_BUSINESS_HOURS');
  });
});

describe('wire conversion', () => {
  it('round-trips an interval through its API shape', () => {
    const original = interval(5, hm(18), hm(2), 1);
    expect(toWire(original)).toEqual({ weekday: 5, start_minute: 1080, end_minute: 120, end_day_offset: 1 });
    expect(fromWire(toWire(original))).toEqual(original);
  });
});

describe('the reference time model: Asia/Ho_Chi_Minh, open inclusive, close exclusive (A06, A18)', () => {
  it('week milliseconds count from LOCAL Monday 00:00, whatever the process time zone', () => {
    // Monday 5 October 2026 00:00 in Ho Chi Minh City is Sunday 4 October 17:00 UTC.
    expect(weekMillisecondAt(Date.UTC(2026, 9, 4, 17, 0, 0))).toBe(0);
    expect(weekMillisecondAt(local(2026, 10, 5, 18, 0))).toBe(hm(18) * MS_PER_MINUTE);
    expect(weekMillisecondAt(local(2026, 10, 6, 0, 0))).toBe(1440 * MS_PER_MINUTE);
    expect(weekMillisecondAt(local(2026, 10, 11, 23, 59, 59, 999))).toBe(MINUTES_PER_WEEK * MS_PER_MINUTE - 1);
    // The next Monday starts a new week line.
    expect(weekMillisecondAt(local(2026, 10, 12, 0, 0))).toBe(0);
    // 1970-01-01T00:00:00Z was Thursday 07:00 local: three days and seven hours into the week.
    expect(weekMillisecondAt(0)).toBe(3 * 1440 * MS_PER_MINUTE + hm(7) * MS_PER_MINUTE);
  });

  it('the open minute is inclusive and the close minute is exclusive, to the millisecond', () => {
    const schedule = [interval(1, hm(8), hm(17))];
    expect(isOpenAt(schedule, local(2026, 10, 5, 7, 59, 59, 999))).toBe(false);
    expect(isOpenAt(schedule, local(2026, 10, 5, 8, 0, 0, 0))).toBe(true);
    expect(isOpenAt(schedule, local(2026, 10, 5, 8, 0, 0, 1))).toBe(true);
    expect(isOpenAt(schedule, local(2026, 10, 5, 16, 59, 59, 999))).toBe(true);
    expect(isOpenAt(schedule, local(2026, 10, 5, 17, 0, 0, 0))).toBe(false);
  });

  it('seconds inside the close minute are CLOSED and seconds inside the open minute are OPEN', () => {
    const schedule = [interval(3, hm(9, 30), hm(10, 15))];
    expect(isOpenAt(schedule, local(2026, 10, 7, 9, 29, 59))).toBe(false);
    expect(isOpenAt(schedule, local(2026, 10, 7, 9, 30, 0))).toBe(true);
    expect(isOpenAt(schedule, local(2026, 10, 7, 9, 30, 30))).toBe(true);
    expect(isOpenAt(schedule, local(2026, 10, 7, 10, 14, 59))).toBe(true);
    expect(isOpenAt(schedule, local(2026, 10, 7, 10, 15, 0))).toBe(false);
    expect(isOpenAt(schedule, local(2026, 10, 7, 10, 15, 1))).toBe(false);
  });

  it('an interval past midnight is open into the next day and closed exactly at its end minute', () => {
    const schedule = [interval(1, hm(18), hm(2), 1)];
    expect(isOpenAt(schedule, local(2026, 10, 5, 17, 59, 59, 999))).toBe(false);
    expect(isOpenAt(schedule, local(2026, 10, 5, 18, 0))).toBe(true);
    expect(isOpenAt(schedule, local(2026, 10, 5, 23, 59, 59, 999))).toBe(true);
    expect(isOpenAt(schedule, local(2026, 10, 6, 0, 0))).toBe(true);
    expect(isOpenAt(schedule, local(2026, 10, 6, 1, 59, 59, 999))).toBe(true);
    expect(isOpenAt(schedule, local(2026, 10, 6, 2, 0))).toBe(false);
    // The same wall clock on the next day belongs to Tuesday, which has no interval of its own.
    expect(isOpenAt(schedule, local(2026, 10, 6, 18, 0))).toBe(false);
  });

  it('closes at 00:00 of the next day (end_minute 0, +1) and is closed from that instant on', () => {
    const schedule = [interval(4, hm(18), 0, 1)];
    expect(isOpenAt(schedule, local(2026, 10, 8, 23, 59, 59, 999))).toBe(true);
    expect(isOpenAt(schedule, local(2026, 10, 9, 0, 0))).toBe(false);
  });

  it('Sunday past midnight is open on Monday morning and closes exactly at its end minute (the wrap)', () => {
    const schedule = [interval(7, hm(22), hm(2), 1)];
    // Sunday 11 October 22:00 opens; the Monday that follows (12 October) is already the next week line.
    expect(isOpenAt(schedule, local(2026, 10, 11, 21, 59, 59, 999))).toBe(false);
    expect(isOpenAt(schedule, local(2026, 10, 11, 22, 0))).toBe(true);
    expect(isOpenAt(schedule, local(2026, 10, 12, 0, 0))).toBe(true);
    expect(isOpenAt(schedule, local(2026, 10, 12, 1, 59, 59, 999))).toBe(true);
    expect(isOpenAt(schedule, local(2026, 10, 12, 2, 0))).toBe(false);
    // Monday of the FIRST week line is the tail of the previous Sunday, so the wrap is a property of the ring.
    expect(isOpenAt(schedule, local(2026, 10, 5, 1, 59, 59, 999))).toBe(true);
    expect(isOpenAt(schedule, local(2026, 10, 5, 2, 0))).toBe(false);
  });

  it('a 24-hour interval is open for the whole of its day in both spellings and closed the next day at 00:00', () => {
    for (const spelling of [interval(2, 0, 1440), normalizeInterval(interval(2, 0, 0, 1))]) {
      expect(isOpenAt([spelling], local(2026, 10, 5, 23, 59, 59, 999))).toBe(false);
      expect(isOpenAt([spelling], local(2026, 10, 6, 0, 0))).toBe(true);
      expect(isOpenAt([spelling], local(2026, 10, 6, 23, 59, 59, 999))).toBe(true);
      expect(isOpenAt([spelling], local(2026, 10, 7, 0, 0))).toBe(false);
    }
    // 24 hours that start at 06:00 close exactly 24 hours later.
    const fromSix = [interval(2, hm(6), hm(6), 1)];
    expect(isOpenAt(fromSix, local(2026, 10, 6, 5, 59, 59, 999))).toBe(false);
    expect(isOpenAt(fromSix, local(2026, 10, 6, 6, 0))).toBe(true);
    expect(isOpenAt(fromSix, local(2026, 10, 7, 5, 59, 59, 999))).toBe(true);
    expect(isOpenAt(fromSix, local(2026, 10, 7, 6, 0))).toBe(false);
  });

  it('adjacent intervals leave no closed gap and no overlap at the shared minute', () => {
    const schedule = [interval(2, hm(8), hm(12)), interval(2, hm(12), hm(18))];
    expect(isOpenAt(schedule, local(2026, 10, 6, 11, 59, 59, 999))).toBe(true);
    expect(isOpenAt(schedule, local(2026, 10, 6, 12, 0))).toBe(true);
    expect(isOpenAt(schedule, local(2026, 10, 6, 17, 59, 59, 999))).toBe(true);
    expect(isOpenAt(schedule, local(2026, 10, 6, 18, 0))).toBe(false);
  });

  it('the empty schedule is never open', () => {
    expect(isOpenAt([], local(2026, 10, 5, 12, 0))).toBe(false);
    expect(isOpenAtWeekMillisecond([], 0)).toBe(false);
  });

  it('the wall clock of the instant, not the UTC date, picks the weekday', () => {
    // Sunday 4 October 18:00 UTC is already Monday 5 October 01:00 in Ho Chi Minh City.
    const schedule = [interval(1, hm(0), hm(2))];
    expect(isOpenAt(schedule, Date.UTC(2026, 9, 4, 18, 0, 0))).toBe(true);
    expect(isOpenAt(schedule, Date.UTC(2026, 9, 4, 19, 0, 0))).toBe(false);
  });
});
