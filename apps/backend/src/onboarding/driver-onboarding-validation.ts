import { BadRequestException } from '@nestjs/common';
import { isWellFormed } from '../auth/auth-validation';
import { DRIVER_FULL_NAME_MAX_LENGTH, DRIVER_PLATE_NUMBER_MAX_LENGTH } from './onboarding-constants';

// Strict request-body parser of Driver onboarding (M01-A2D, task section 9). Like the Shop and Auth parsers it
// is pure: no I/O and no Nest pipeline magic. A body is accepted only when it is a plain JSON object whose keys
// are a subset of {full_name, plate_number} and include full_name, so a
// security-sensitive extra field (driver_type, status, accepting_deliveries, user_id, role, an admin or a
// wallet/bank flag, and the superseded service_area_ids of task section 22) is refused instead of ignored.
//
// The three small text helpers below repeat the ones of shop-onboarding-validation.ts on purpose: the A2S files
// are left untouched by A2D, and a later slice may move both copies to one shared module.
//
// Failures never echo the offending value or key: a malformed shape is a plain 400 BAD_REQUEST.

function reject(): never {
  throw new BadRequestException();
}

function objectWithKeys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return reject();
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set<string>([...required, ...optional]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      return reject();
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(record, key)) {
      return reject();
    }
  }
  return record;
}

/**
 * Outer-trimmed, non-empty text of at most `max` characters. A lone surrogate cannot be encoded as UTF-8 and a
 * NUL character cannot be stored in a PostgreSQL text column, so both are refused here rather than turned into
 * a database error.
 */
function boundedText(value: unknown, max: number): string {
  if (typeof value !== 'string' || !isWellFormed(value) || value.includes('\u0000')) {
    return reject();
  }
  const trimmed = value.trim();
  // UTF-16 units are never fewer than characters: this cheap bound keeps a huge string away from the spread.
  if (trimmed.length === 0 || trimmed.length > max * 2 || [...trimmed].length > max) {
    return reject();
  }
  return trimmed;
}

/** Absent and null both mean "no value": the two are the same logical request. */
function optionalText(value: unknown, max: number): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return boundedText(value, max);
}

export interface DriverOnboardingInput {
  readonly fullName: string;
  readonly plateNumber: string | null;
}

/**
 * POST /v1/onboarding/driver. full_name is required; plate_number may be absent or null.
 * The result is the NORMALIZED request: it is also what the idempotency fingerprint is built from, so a retry
 * that spells "absent" and "null", is still the same request.
 */
export function parseDriverOnboardingBody(body: unknown): DriverOnboardingInput {
  const parsed = objectWithKeys(body, ['full_name'], ['plate_number']);
  return {
    fullName: boundedText(parsed.full_name, DRIVER_FULL_NAME_MAX_LENGTH),
    plateNumber: optionalText(parsed.plate_number, DRIVER_PLATE_NUMBER_MAX_LENGTH),
  };
}
