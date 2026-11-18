import { safeJsonNumber } from '../driver-wallet/driver-wallet-validation';
import { JsonObject } from '../idempotency/idempotency-executor';
import { IncomeDayRow, IncomeTotalsRow, INCOME_TIME_ZONE } from '../wallet/wallet-income-repository';
import { IncomePeriod } from './driver-income-validation';

// Builds the JSON the Shipper's Thu nhập screen reads (issue #395). Pure: no database, no clock.
// Definitions (Owner decisions, 18/11/2026):
//  - completed_count: completed assignments of the Shipper in the period, each counted once.
//  - fee_vnd ("Tổng thu nhập"): sum of the final fee of those deliveries. It is an ESTIMATE of what the Shipper receives outside the app.
//  - platform_commission_vnd: the real COMMISSION_DEBIT rows, as a NEGATIVE amount (a deduction). 0 means none was recorded.
//  - net_estimated_vnd: fee_vnd + platform_commission_vnd ("Thu nhập ước tính sau hoa hồng").
//  - average_fee_vnd: fee_vnd / completed_count, rounded half up to a whole VND; null when there is no completed delivery (not 0).
//  - net_is_provisional: true when a completed delivery has no commission debit yet, or its debit differs from the snapshot. The screen then says "tạm tính".

export interface IncomeFigures {
  readonly completedCount: number;
  readonly feeVnd: number;
  readonly platformCommissionVnd: number;
  readonly netEstimatedVnd: number;
  readonly netIsProvisional: boolean;
}

/** fee / count rounded half up to a whole VND (non-negative amounts); null when count is 0. */
export function averageFee(feeVnd: bigint, count: bigint): bigint | null {
  if (count === 0n) {
    return null;
  }
  return (2n * feeVnd + count) / (2n * count);
}

function figuresOf(totals: IncomeTotalsRow): IncomeFigures {
  return {
    completedCount: safeJsonNumber(totals.completedCount),
    feeVnd: safeJsonNumber(totals.feeVnd),
    platformCommissionVnd: safeJsonNumber(totals.commissionVnd),
    netEstimatedVnd: safeJsonNumber(totals.feeVnd + totals.commissionVnd),
    netIsProvisional: totals.provisionalCount > 0n || totals.mismatchCount > 0n,
  };
}

function jsonOf(figures: IncomeFigures): JsonObject {
  return {
    completed_count: figures.completedCount,
    fee_vnd: figures.feeVnd,
    platform_commission_vnd: figures.platformCommissionVnd,
    net_estimated_vnd: figures.netEstimatedVnd,
    net_is_provisional: figures.netIsProvisional,
  };
}

export function buildIncomeSummary(
  period: IncomePeriod,
  totals: IncomeTotalsRow,
  days: readonly IncomeDayRow[],
  extra: { readonly driverStatus: string; readonly limitedAccess: boolean },
): JsonObject {
  const average = averageFee(totals.feeVnd, totals.completedCount);
  return {
    period: { from: period.from, to: period.to, days: period.days, timezone: INCOME_TIME_ZONE },
    summary: {
      ...jsonOf(figuresOf(totals)),
      average_fee_vnd: average === null ? null : safeJsonNumber(average),
    },
    daily: days.map((day) => ({ date: day.day, ...jsonOf(figuresOf(day)) })),
    driver_status: extra.driverStatus,
    limited_access: extra.limitedAccess,
  };
}
