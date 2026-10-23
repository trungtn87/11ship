import { TechnicalError } from '../common/app-errors';

// Small helpers shared by the M13 repositories. Times are read as epoch milliseconds and written with the database clock (never an application clock) unless a
// caller states an observation time it measured itself.

export const CLOCK = `date_trunc('milliseconds', clock_timestamp())`;

/** `(extract(epoch FROM col) * 1000)::bigint::text AS alias` */
export const ms = (column: string, alias: string): string => `(extract(epoch FROM ${column}) * 1000)::bigint::text AS ${alias}`;

/** A bigint/numeric column arrives as text: a safe JavaScript integer or an internal error. */
export function num(raw: unknown): number {
  const value = typeof raw === 'string' && /^-?[0-9]{1,16}$/.test(raw) ? Number(raw) : typeof raw === 'number' ? raw : Number.NaN;
  if (!Number.isSafeInteger(value)) {
    throw new TechnicalError('internal', 'Database returned an unexpected number');
  }
  return value;
}

export const numOrNull = (raw: unknown): number | null => (raw === null || raw === undefined ? null : num(raw));

/** A timestamp the caller measured: epoch milliseconds -> timestamptz placeholder expression. */
export const fromMs = (placeholder: string): string => `to_timestamp(${placeholder}::double precision / 1000.0)`;

export function jsonOf(value: unknown): string {
  return JSON.stringify(value ?? {});
}

/** `LIKE` pattern for a user-typed fragment (escapes the wildcards). */
export function likePattern(fragment: string): string {
  return `%${fragment.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
