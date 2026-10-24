import { AppError } from '../common/app-errors';

// M12: every period of the administration (overview, reports, exports) is a stretch of days of the Vietnam clock (Asia/Ho_Chi_Minh, UTC+7, no daylight
// saving since 1975). A period is [fromMs, toMs): the first instant of its first day up to, and excluding, the first instant of the day after its last day.
// Nothing here reads the process time zone: the instant comes in as an argument (the PostgreSQL clock, read by the caller).

export const VIETNAM_OFFSET_MS = 7 * 3_600_000;
export const DAY_MS = 86_400_000;
export const MAX_CUSTOM_DAYS = 92;

export const OVERVIEW_RANGES = ['today', 'yesterday', '7d', 'month', 'custom'] as const;
export type OverviewRange = (typeof OVERVIEW_RANGES)[number];

export interface Period {
  readonly range: OverviewRange;
  readonly fromMs: number;
  readonly toMs: number;
  /** First and last day of the period as typed on the Vietnam calendar (YYYY-MM-DD), for display and for links. */
  readonly fromDay: string;
  readonly toDay: string;
}

/** The first instant of the Vietnam day that contains `ms`. */
export function startOfVietnamDay(ms: number): number {
  return Math.floor((ms + VIETNAM_OFFSET_MS) / DAY_MS) * DAY_MS - VIETNAM_OFFSET_MS;
}

/** `YYYY-MM-DD` of the Vietnam day that starts at `dayStartMs`. */
export function vietnamDay(dayStartMs: number): string {
  return new Date(dayStartMs + VIETNAM_OFFSET_MS).toISOString().slice(0, 10);
}

/** Start of the Vietnam day named `YYYY-MM-DD`, or undefined when it is not a real calendar day. */
export function parseVietnamDay(text: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match === null) {
    return undefined;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const at = Date.UTC(year, month - 1, day);
  const check = new Date(at);
  if (year < 2020 || check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return undefined;
  }
  return at - VIETNAM_OFFSET_MS;
}

function startOfVietnamMonth(ms: number): number {
  const local = new Date(ms + VIETNAM_OFFSET_MS);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - VIETNAM_OFFSET_MS;
}

function startOfNextVietnamMonth(ms: number): number {
  const local = new Date(ms + VIETNAM_OFFSET_MS);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1) - VIETNAM_OFFSET_MS;
}

function periodOf(range: OverviewRange, fromMs: number, toMs: number): Period {
  return { range, fromMs, toMs, fromDay: vietnamDay(fromMs), toDay: vietnamDay(toMs - DAY_MS) };
}

/**
 * Resolves a named range at the instant `nowMs`. `custom` needs `from` and `to` (both days of the Vietnam calendar, inclusive), `from <= to`, at most
 * MAX_CUSTOM_DAYS days, and `to` not after today. Anything else is ADMIN_INPUT_INVALID: a period is never guessed.
 */
export function resolvePeriod(range: OverviewRange, nowMs: number, custom?: { from: string; to: string }): Period {
  const today = startOfVietnamDay(nowMs);
  switch (range) {
    case 'today':
      return periodOf(range, today, today + DAY_MS);
    case 'yesterday':
      return periodOf(range, today - DAY_MS, today);
    case '7d':
      return periodOf(range, today - 6 * DAY_MS, today + DAY_MS);
    case 'month':
      return periodOf(range, startOfVietnamMonth(nowMs), startOfNextVietnamMonth(nowMs));
    case 'custom': {
      const from = custom === undefined ? undefined : parseVietnamDay(custom.from);
      const to = custom === undefined ? undefined : parseVietnamDay(custom.to);
      if (from === undefined || to === undefined || from > to || to > today || (to - from) / DAY_MS + 1 > MAX_CUSTOM_DAYS) {
        throw new AppError('ADMIN_INPUT_INVALID');
      }
      return periodOf(range, from, to + DAY_MS);
    }
  }
}
