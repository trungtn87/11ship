import { AppError } from '../common/app-errors';

const UUID_CANONICAL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/** Validates a required Idempotency-Key and normalizes hexadecimal characters to lowercase. */
export function normalizeIdempotencyKey(raw: unknown): string {
  if (raw === undefined || raw === null || raw === '') {
    throw new AppError('IDEMPOTENCY_KEY_REQUIRED');
  }
  if (typeof raw !== 'string') {
    throw new AppError('INVALID_IDEMPOTENCY_KEY');
  }
  const normalized = raw.toLowerCase();
  if (!UUID_CANONICAL.test(normalized) || normalized === NIL_UUID) {
    throw new AppError('INVALID_IDEMPOTENCY_KEY');
  }
  return normalized;
}
