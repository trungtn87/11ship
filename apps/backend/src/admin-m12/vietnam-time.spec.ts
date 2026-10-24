import { describe, expect, it } from '@jest/globals';
import { AppError } from '../common/app-errors';
import { resolvePeriod, startOfVietnamDay, vietnamDay } from './vietnam-time';

// 2026-10-18T18:30:00Z is already 01:30 of 2026-10-19 in Vietnam: the day that counts is the Vietnam one.
const NOW = Date.UTC(2026, 9, 18, 18, 30, 0);
const at = (iso: string): number => Date.parse(iso);

describe('vietnam-time', () => {
  it('starts a day at 00:00 Vietnam (17:00 UTC of the day before)', () => {
    expect(new Date(startOfVietnamDay(NOW)).toISOString()).toBe('2026-10-18T17:00:00.000Z');
    expect(vietnamDay(startOfVietnamDay(NOW))).toBe('2026-10-19');
    // The last millisecond before midnight Vietnam still belongs to the previous day; midnight itself starts the next.
    expect(vietnamDay(startOfVietnamDay(at('2026-10-18T16:59:59.999Z')))).toBe('2026-10-18');
    expect(vietnamDay(startOfVietnamDay(at('2026-10-18T17:00:00.000Z')))).toBe('2026-10-19');
  });

  it('resolves the named ranges on the Vietnam calendar', () => {
    const today = resolvePeriod('today', NOW);
    expect([today.fromDay, today.toDay, new Date(today.fromMs).toISOString(), new Date(today.toMs).toISOString()]).toEqual(['2026-10-19', '2026-10-19', '2026-10-18T17:00:00.000Z', '2026-10-19T17:00:00.000Z']);
    const yesterday = resolvePeriod('yesterday', NOW);
    expect([yesterday.fromDay, yesterday.toDay, yesterday.toMs]).toEqual(['2026-10-18', '2026-10-18', today.fromMs]);
    const week = resolvePeriod('7d', NOW);
    expect([week.fromDay, week.toDay]).toEqual(['2026-10-13', '2026-10-19']);
    const month = resolvePeriod('month', NOW);
    expect([month.fromDay, month.toDay]).toEqual(['2026-10-01', '2026-10-31']);
  });

  it('knows month ends: the month of 31 Oct 17:00Z is already November in Vietnam', () => {
    const month = resolvePeriod('month', at('2026-10-31T17:00:00Z'));
    expect([month.fromDay, month.toDay]).toEqual(['2026-11-01', '2026-11-30']);
    const december = resolvePeriod('month', at('2026-12-31T16:59:59Z'));
    expect([december.fromDay, december.toDay]).toEqual(['2026-12-01', '2026-12-31']);
  });

  it('accepts a custom range inside the limits and refuses everything else', () => {
    const custom = resolvePeriod('custom', NOW, { from: '2026-10-01', to: '2026-10-19' });
    expect([custom.fromDay, custom.toDay]).toEqual(['2026-10-01', '2026-10-19']);
    const bad: Array<{ from: string; to: string } | undefined> = [
      undefined,
      { from: '2026-10-20', to: '2026-10-19' },
      { from: '2026-10-01', to: '2026-10-20' },
      { from: '2026-02-30', to: '2026-03-01' },
      { from: '2026-07-01', to: '2026-10-19' },
      { from: 'x', to: 'y' },
    ];
    for (const input of bad) {
      expect(() => resolvePeriod('custom', NOW, input)).toThrow(AppError);
    }
  });
});
