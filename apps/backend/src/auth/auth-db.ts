import { TechnicalError } from '../common/app-errors';

// Small helpers shared by the Auth repositories. Timestamps that take part in a comparison are read as
// integer epoch milliseconds computed by PostgreSQL, so no JavaScript Date parsing (and no application clock)
// ever decides an expiry.

/** SQL expression: epoch milliseconds (bigint) of a timestamptz expression. */
export function epochMs(expression: string): string {
  return `floor(extract(epoch FROM ${expression}) * 1000)::bigint`;
}

/** A bigint column arrives as text; this returns a safe JavaScript integer or raises an internal error. */
export function toSafeInteger(raw: unknown): number {
  const value = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new TechnicalError('internal', 'Database returned an unexpected number');
  }
  return value;
}

/**
 * One PostgreSQL timestamp that is shared by every value of one statement: "now" truncated to the
 * millisecond precision used by the audit and outbox rows. Used as a CTE/subquery named `clock`.
 */
export const CLOCK_CTE = "SELECT date_trunc('milliseconds', clock_timestamp()) AS t";
