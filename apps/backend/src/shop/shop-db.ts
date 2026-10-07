import { TechnicalError } from '../common/app-errors';

// Small helpers of the Shop repositories. M02 does not import from Auth (the dependency runs the other way),
// so the two tiny helpers it needs live here.

/** A bigint column arrives as text; this returns a safe JavaScript integer or raises an internal error. */
export function toSafeInteger(raw: unknown): number {
  const value = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new TechnicalError('internal', 'Database returned an unexpected number');
  }
  return value;
}

/**
 * One PostgreSQL timestamp shared by every value of one statement: "now" truncated to the millisecond
 * precision used by the audit and outbox rows. Used as a subquery named `clock`.
 */
export const CLOCK_CTE = "SELECT date_trunc('milliseconds', clock_timestamp()) AS t";
