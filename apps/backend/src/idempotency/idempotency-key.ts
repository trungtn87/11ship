import { AppError } from '../common/app-errors';

// Idempotency-Key contract (ADR-003 section 3.1): a canonical 36-character UUID. Hex digits may arrive
// in either case and are normalized to lowercase; the nil UUID is refused. No version/variant is
// enforced (v4 is only a recommendation to clients). No trimming: a value with extra whitespace is
// not a canonical UUID.
const UUID_SHAPE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * Parses the raw `Idempotency-Key` header of an operation that REQUIRES one.
 *  - header absent -> IDEMPOTENCY_KEY_REQUIRED;
 *  - present but empty, repeated, not a canonical UUID, or the nil UUID -> INVALID_IDEMPOTENCY_KEY.
 * Returns the lowercase canonical form. The value is never echoed into an error.
 */
export function parseIdempotencyKey(header: string | readonly string[] | undefined | null): string {
  if (header === undefined || header === null) {
    throw new AppError('IDEMPOTENCY_KEY_REQUIRED');
  }

  let value: unknown;
  if (typeof header === 'string') {
    value = header;
  } else if (header.length === 0) {
    throw new AppError('IDEMPOTENCY_KEY_REQUIRED');
  } else if (header.length === 1) {
    value = header[0];
  } else {
    // The same header sent more than once is ambiguous: refuse it rather than pick one.
    throw new AppError('INVALID_IDEMPOTENCY_KEY');
  }

  if (typeof value !== 'string' || !UUID_SHAPE.test(value)) {
    throw new AppError('INVALID_IDEMPOTENCY_KEY');
  }
  const normalized = value.toLowerCase();
  if (normalized === NIL_UUID) {
    throw new AppError('INVALID_IDEMPOTENCY_KEY');
  }
  return normalized;
}
