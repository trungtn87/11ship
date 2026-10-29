import { describe, expect, it } from '@jest/globals';
import { businessHoursRefreshMs } from './business-hours-refresh';

const hours = Array.from({ length: 7 }, (_, i) => ({ weekday: i + 1, startMinute: 900, endMinute: 1320, endDayOffset: 0 }));
describe('server-relative schedule refresh (#204)', () => {
  it.each([
    ['2026-10-25T14:59:59Z', 1000], // Sunday 21:59:59 -> close
    ['2026-10-25T15:00:00Z', 17 * 3600000], // Sunday 22:00 -> Monday 15:00
    ['2026-10-26T07:59:59Z', 1000], // Monday 14:59:59 -> open
    ['2026-10-26T08:00:00Z', 7 * 3600000],
  ])('%s refreshes at next boundary', (at, expected) => {
    expect(businessHoursRefreshMs(hours, at)).toBe(expected);
  });
  it('handles Sunday overnight, 24:00 and empty schedules', () => {
    expect(businessHoursRefreshMs([{ weekday: 7, startMinute: 1320, endMinute: 120, endDayOffset: 1 }], '2026-10-25T18:59:59Z')).toBe(1000);
    expect(businessHoursRefreshMs([{ weekday: 7, startMinute: 0, endMinute: 1440, endDayOffset: 0 }], '2026-10-25T16:59:59Z')).toBe(1000);
    expect(businessHoursRefreshMs([], '2026-10-25T15:00:00Z')).toBeNull();
  });
});
