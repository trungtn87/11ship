import { AppError } from '../common/app-errors';

// The weekly business-hours rules of M02-A (docs/tasks/M02-A-shop-management.md sections 2, 3 and 10), as PURE
// functions: no I/O, no clock, no database. They decide what a legal schedule is and what its canonical form is; the
// repository stores exactly that form and the availability statement reads it.
//
// Time model: ISO weekday (Monday = 1), minutes since midnight, wall clock of Asia/Ho_Chi_Minh (a fixed UTC+7: Vietnam
// has no daylight saving time). An interval opens at startMinute of `weekday` and closes at endMinute of
// weekday + endDayOffset; the close is EXCLUSIVE. 18:00-02:00 is (1080, 120, +1 day); 00:00-24:00 is (0, 1440, +0).

export const MINUTES_PER_DAY = 1440;
export const MINUTES_PER_WEEK = 10080;
/** Seven days with up to four intervals each (task section 3). */
export const MAX_INTERVALS_PER_WEEK = 28;

export interface BusinessInterval {
  /** ISO weekday: Monday = 1 ... Sunday = 7. */
  readonly weekday: number;
  /** 0..1439. */
  readonly startMinute: number;
  /** 0..1440. */
  readonly endMinute: number;
  /** 0 = the close is on the same day, 1 = on the next day. */
  readonly endDayOffset: number;
}

/**
 * The API / JSON shape of an interval. A type alias, not an interface, on purpose: an object type alias is assignable
 * to the JsonValue index signature the idempotent result needs, an interface is not.
 */
export type BusinessIntervalWire = {
  readonly weekday: number;
  readonly start_minute: number;
  readonly end_minute: number;
  readonly end_day_offset: number;
};

export function toWire(interval: BusinessInterval): BusinessIntervalWire {
  return {
    weekday: interval.weekday,
    start_minute: interval.startMinute,
    end_minute: interval.endMinute,
    end_day_offset: interval.endDayOffset,
  };
}

export function fromWire(wire: BusinessIntervalWire): BusinessInterval {
  return {
    weekday: wire.weekday,
    startMinute: wire.start_minute,
    endMinute: wire.end_minute,
    endDayOffset: wire.end_day_offset,
  };
}

function invalid(): never {
  throw new AppError('INVALID_BUSINESS_HOURS');
}

function inRange(value: number, min: number, max: number): boolean {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

/**
 * The per-row rules of the database CHECK constraints, repeated here so that a bad row is a clean
 * INVALID_BUSINESS_HOURS and never a raw constraint violation: every field is an integer in range, a same-day
 * interval closes after it opens, a next-day interval closes at or before its open time (start = end is exactly 24
 * hours) and before 24:00.
 */
export function assertValidInterval(interval: BusinessInterval): void {
  if (
    !inRange(interval.weekday, 1, 7) ||
    !inRange(interval.startMinute, 0, MINUTES_PER_DAY - 1) ||
    !inRange(interval.endMinute, 0, MINUTES_PER_DAY) ||
    !inRange(interval.endDayOffset, 0, 1)
  ) {
    invalid();
  }
  if (interval.endDayOffset === 0) {
    if (interval.endMinute <= interval.startMinute) {
      invalid();
    }
    return;
  }
  if (interval.endMinute > interval.startMinute || interval.endMinute >= MINUTES_PER_DAY) {
    invalid();
  }
}

/** Length in minutes: more than 0 and at most 1440 for a valid interval. */
export function durationMinutes(interval: BusinessInterval): number {
  return interval.endDayOffset * MINUTES_PER_DAY + interval.endMinute - interval.startMinute;
}

/**
 * One canonical form per meaning: a full day that starts at midnight has two spellings, (0, 1440, +0) and (0, 0, +1);
 * the first one is canonical, so a reordered or re-spelled retry has the same fingerprint and the same stored rows.
 * A 24-hour interval that starts at any other time has exactly one spelling (start = end, +1) and is kept as it is.
 */
export function normalizeInterval(interval: BusinessInterval): BusinessInterval {
  assertValidInterval(interval);
  if (interval.endDayOffset === 1 && interval.startMinute === 0 && interval.endMinute === 0) {
    return { weekday: interval.weekday, startMinute: 0, endMinute: MINUTES_PER_DAY, endDayOffset: 0 };
  }
  return {
    weekday: interval.weekday,
    startMinute: interval.startMinute,
    endMinute: interval.endMinute,
    endDayOffset: interval.endDayOffset,
  };
}

/** Sort order of a canonical schedule: weekday, start, end, offset. Array order of a request has no meaning. */
export function compareIntervals(a: BusinessInterval, b: BusinessInterval): number {
  return (
    a.weekday - b.weekday ||
    a.startMinute - b.startMinute ||
    a.endMinute - b.endMinute ||
    a.endDayOffset - b.endDayOffset
  );
}

interface Segment {
  readonly start: number;
  readonly end: number;
}

/**
 * The interval as one or two pieces of the 10080-minute week line [0, 10080). One that runs past Sunday midnight
 * wraps: its tail lands at the start of the line (Sunday -> Monday), so it is compared with Monday's intervals too.
 */
function weekSegments(interval: BusinessInterval): Segment[] {
  const start = (interval.weekday - 1) * MINUTES_PER_DAY + interval.startMinute;
  const end = start + durationMinutes(interval);
  if (end <= MINUTES_PER_WEEK) {
    return [{ start, end }];
  }
  return [
    { start, end: MINUTES_PER_WEEK },
    { start: 0, end: end - MINUTES_PER_WEEK },
  ];
}

/**
 * Validates a whole schedule and returns its canonical form: sorted, each interval normalized. An empty list is the
 * valid "closed all week" schedule. Rejects with INVALID_BUSINESS_HOURS: more than 28 intervals, an invalid
 * interval, and ANY overlap on the week ring (duplicates and the wrap Sunday -> Monday included). Adjacent
 * intervals (one closes exactly when the next opens) are legal and are never merged.
 */
export function canonicalizeBusinessHours(input: readonly BusinessInterval[]): BusinessInterval[] {
  if (input.length > MAX_INTERVALS_PER_WEEK) {
    invalid();
  }
  const normalized = input.map(normalizeInterval).sort(compareIntervals);
  const segments = normalized.flatMap(weekSegments).sort((a, b) => a.start - b.start || a.end - b.end);
  let previousEnd = 0;
  for (const segment of segments) {
    if (segment.start < previousEnd) {
      invalid();
    }
    previousEnd = segment.end;
  }
  return normalized;
}

// --- Reference time model (used by the specs, and by the integration tests as the oracle for the SQL) -----------
//
// Production never calls these: availability is decided by ONE PostgreSQL statement on the PostgreSQL clock (see
// shop-availability-sql.ts). They state the same rule in plain arithmetic on integer milliseconds so that the
// boundaries (open inclusive, close exclusive, seconds and milliseconds, Sunday -> Monday) can be tested as a pure
// function of an instant, and so that the SQL can be compared with an independent oracle.

/** Asia/Ho_Chi_Minh is UTC+7 all year. */
export const VIETNAM_UTC_OFFSET_MS = 7 * 3_600_000;
const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = MINUTES_PER_DAY * MS_PER_MINUTE;
const MS_PER_WEEK = MINUTES_PER_WEEK * MS_PER_MINUTE;
/** 1970-01-01 was a Thursday: day index 3 when Monday is 0. */
const EPOCH_DAY_INDEX = 3;

/** Milliseconds since local Monday 00:00 (Asia/Ho_Chi_Minh) for an instant given as epoch milliseconds. */
export function weekMillisecondAt(instantEpochMs: number): number {
  const local = instantEpochMs + VIETNAM_UTC_OFFSET_MS;
  const day = Math.floor(local / MS_PER_DAY);
  const dayIndex = (((day + EPOCH_DAY_INDEX) % 7) + 7) % 7;
  return dayIndex * MS_PER_DAY + (local - day * MS_PER_DAY);
}

/**
 * Whether the schedule is open at that week millisecond. The open minute is inclusive and the close is exclusive.
 * An interval that runs past Sunday midnight is also tested one week earlier, which is the wrap into Monday.
 */
export function isOpenAtWeekMillisecond(intervals: readonly BusinessInterval[], weekMs: number): boolean {
  return intervals.some((interval) => {
    const open = ((interval.weekday - 1) * MINUTES_PER_DAY + interval.startMinute) * MS_PER_MINUTE;
    const close = ((interval.weekday - 1 + interval.endDayOffset) * MINUTES_PER_DAY + interval.endMinute) * MS_PER_MINUTE;
    return (weekMs >= open && weekMs < close) || (weekMs + MS_PER_WEEK >= open && weekMs + MS_PER_WEEK < close);
  });
}

export function isOpenAt(intervals: readonly BusinessInterval[], instantEpochMs: number): boolean {
  return isOpenAtWeekMillisecond(intervals, weekMillisecondAt(instantEpochMs));
}
