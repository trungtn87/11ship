import { describe, expect, it } from '@jest/globals';
import { averageFee, buildIncomeSummary } from './driver-income-summary';
import { IncomeDayRow, IncomeTotalsRow } from '../wallet/wallet-income-repository';
import { INCOME_MAX_DAYS, parseIncomePeriod } from './driver-income-validation';

const totals = (over: Partial<IncomeTotalsRow> = {}): IncomeTotalsRow => ({
  completedCount: 0n,
  feeVnd: 0n,
  commissionVnd: 0n,
  provisionalCount: 0n,
  mismatchCount: 0n,
  ...over,
});

const day = (date: string, over: Partial<IncomeTotalsRow> = {}): IncomeDayRow => ({ day: date, ...totals(over) });

describe('#395 income period query', () => {
  it('accepts one inclusive VN calendar period, counting both ends', () => {
    expect(parseIncomePeriod({ from: '2026-11-18', to: '2026-11-18' })).toEqual({ from: '2026-11-18', to: '2026-11-18', days: 1 });
    expect(parseIncomePeriod({ from: '2026-11-12', to: '2026-11-18' })).toEqual({ from: '2026-11-12', to: '2026-11-18', days: 7 });
  });

  it('allows exactly 92 days and refuses 93', () => {
    expect(parseIncomePeriod({ from: '2026-08-01', to: '2026-10-31' }).days).toBe(INCOME_MAX_DAYS);
    expect(() => parseIncomePeriod({ from: '2026-07-31', to: '2026-10-31' })).toThrow();
  });

  it('refuses a missing bound, a reversed range, a bad or impossible date, and any extra key', () => {
    expect(() => parseIncomePeriod(undefined)).toThrow();
    expect(() => parseIncomePeriod({ from: '2026-11-18' })).toThrow();
    expect(() => parseIncomePeriod({ from: '2026-11-18', to: '2026-11-17' })).toThrow();
    expect(() => parseIncomePeriod({ from: '2026-02-30', to: '2026-03-01' })).toThrow();
    expect(() => parseIncomePeriod({ from: '18/11/2026', to: '18/11/2026' })).toThrow();
    expect(() => parseIncomePeriod({ from: '2026-11-18', to: '2026-11-18', driver_id: 'x' })).toThrow();
    expect(() => parseIncomePeriod({ from: ['2026-11-18'], to: '2026-11-18' })).toThrow();
  });
});

describe('#395 income summary definitions', () => {
  const period = { from: '2026-11-17', to: '2026-11-18', days: 2 };
  const extra = { driverStatus: 'ACTIVE', limitedAccess: false };

  it('net = fee + commission, commission is a negative deduction, and the average rounds half up', () => {
    const body = buildIncomeSummary(period, totals({ completedCount: 3n, feeVnd: 100_000n, commissionVnd: -3_000n }), [], extra) as {
      summary: Record<string, unknown>;
    };
    expect(body.summary).toMatchObject({
      completed_count: 3,
      fee_vnd: 100_000,
      platform_commission_vnd: -3_000,
      net_estimated_vnd: 97_000,
      average_fee_vnd: 33_333,
      net_is_provisional: false,
    });
  });

  it('average is null (not 0) with no completed delivery, and half rounds up', () => {
    expect(averageFee(0n, 0n)).toBeNull();
    expect(averageFee(5n, 2n)).toBe(3n);
    expect(averageFee(4n, 2n)).toBe(2n);
    expect(averageFee(10n, 3n)).toBe(3n);
  });

  it('marks the figure provisional when a completed delivery has no debit yet or a debit differs from its snapshot', () => {
    const missing = buildIncomeSummary(period, totals({ completedCount: 1n, feeVnd: 20_000n, provisionalCount: 1n }), [], extra) as { summary: { net_is_provisional: boolean } };
    const mismatch = buildIncomeSummary(period, totals({ completedCount: 1n, feeVnd: 20_000n, mismatchCount: 1n, commissionVnd: -2_000n }), [], extra) as {
      summary: { net_is_provisional: boolean };
    };
    expect(missing.summary.net_is_provisional).toBe(true);
    expect(mismatch.summary.net_is_provisional).toBe(true);
  });

  it('daily rows are returned for every day, zero days included, with the same net rule', () => {
    const body = buildIncomeSummary(period, totals({ completedCount: 1n, feeVnd: 20_000n, commissionVnd: -1_000n }), [day('2026-11-17'), day('2026-11-18', { completedCount: 1n, feeVnd: 20_000n, commissionVnd: -1_000n })], extra) as {
      daily: Array<Record<string, unknown>>;
    };
    expect(body.daily).toEqual([
      { date: '2026-11-17', completed_count: 0, fee_vnd: 0, platform_commission_vnd: 0, net_estimated_vnd: 0, net_is_provisional: false },
      { date: '2026-11-18', completed_count: 1, fee_vnd: 20_000, platform_commission_vnd: -1_000, net_estimated_vnd: 19_000, net_is_provisional: false },
    ]);
  });
});
