import { BusinessInterval } from './business-hours';

/** Delay until the next schedule boundary, measured from the PostgreSQL snapshot instant.
 * This only schedules a re-read; it never grants permission to order. */
export function businessHoursRefreshMs(hours: readonly BusinessInterval[], evaluatedAt: string): number | null {
  const now = Date.parse(evaluatedAt);
  if (!Number.isFinite(now) || hours.length === 0) return null;
  const local = new Date(now + 7 * 3600000);
  const weekMs = 7 * 86400000;
  const intoWeek = ((local.getUTCDay() + 6) % 7) * 86400000 + local.getUTCHours() * 3600000 + local.getUTCMinutes() * 60000 + local.getUTCSeconds() * 1000 + local.getUTCMilliseconds();
  return Math.min(...hours.flatMap((h) => [
    ((h.weekday - 1) * 1440 + h.startMinute) * 60000,
    ((h.weekday - 1 + h.endDayOffset) * 1440 + h.endMinute) * 60000,
  ]).map((boundary) => ((boundary - intoWeek) % weekMs + weekMs) % weekMs || weekMs));
}
