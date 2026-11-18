import { BadRequestException } from '@nestjs/common';

// GET /v1/driver/income/summary?from=YYYY-MM-DD&to=YYYY-MM-DD: the Shipper's income period, as Vietnam calendar dates (both ends inclusive).
// Only these two keys exist. A failure never echoes the offending value.

/** The longest period one request may cover (Owner decision, issue #395: "khoảng tối đa khoảng 92 ngày"). */
export const INCOME_MAX_DAYS = 92;

export interface IncomePeriod {
  /** Inclusive first Vietnam calendar day, YYYY-MM-DD. */
  readonly from: string;
  /** Inclusive last Vietnam calendar day, YYYY-MM-DD. */
  readonly to: string;
  /** Number of calendar days in [from, to]; 1..INCOME_MAX_DAYS. */
  readonly days: number;
}

const DAY_MS = 86_400_000;
const DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

function reject(): never {
  throw new BadRequestException();
}

/** A calendar date string that names a real day (rejects 2026-02-30 and the like). */
function dayMs(value: unknown): number {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    return reject();
  }
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value) {
    return reject();
  }
  return ms;
}

export function parseIncomePeriod(query: unknown): IncomePeriod {
  if (typeof query !== 'object' || query === null || Array.isArray(query)) {
    return reject();
  }
  const source = query as Record<string, unknown>;
  if (!Object.keys(source).every((key) => key === 'from' || key === 'to')) {
    return reject();
  }
  const fromMs = dayMs(source.from);
  const toMs = dayMs(source.to);
  if (toMs < fromMs) {
    return reject();
  }
  const days = Math.round((toMs - fromMs) / DAY_MS) + 1;
  if (days > INCOME_MAX_DAYS) {
    return reject();
  }
  return { from: source.from as string, to: source.to as string, days };
}
