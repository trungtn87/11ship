import { BadRequestException } from '@nestjs/common';
import { isWellFormed } from '../auth/auth-validation';
import { AppError } from '../common/app-errors';
import { isCanonicalUuid } from '../shared/identifiers';
import {
  DRIVER_FULL_NAME_MAX_LENGTH,
  DRIVER_PLATE_NUMBER_MAX_LENGTH,
  DRIVER_SERVICE_AREAS_MAX,
} from './onboarding-constants';

// Strict request-body parser of Driver onboarding (M01-A2D, task section 9). Like the Shop and Auth parsers it
// is pure: no I/O and no Nest pipeline magic. A body is accepted only when it is a plain JSON object whose keys
// are a subset of {full_name, plate_number, service_area_ids} and include full_name and service_area_ids, so a
// security-sensitive extra field (driver_type, status, accepting_deliveries, user_id, role, an admin or a
// wallet/bank flag, ...) is refused instead of ignored.
//
// The three small text helpers below repeat the ones of shop-onboarding-validation.ts on purpose: the A2S files
// are left untouched by A2D, and a later slice may move both copies to one shared module.
//
// Failures never echo the offending value or key: a malformed shape is a plain 400 BAD_REQUEST. A duplicate
// service area is a well-formed request naming one area twice, and is INVALID_SERVICE_AREA (task section 14).

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

/**
 * At least one and at most DRIVER_SERVICE_AREAS_MAX canonical UUIDs, none twice. The result is sorted by UUID
 * (the text order of a canonical lower-case UUID is PostgreSQL's order), which is both the idempotency
 * fingerprint's order and the order the rows are locked in.
 */
function serviceAreaIds(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > DRIVER_SERVICE_AREAS_MAX) {
    return reject();
  }
  const ids: string[] = [];
  for (const entry of value as unknown[]) {
    // A malformed identifier is a malformed request; a well-formed one that names no ACTIVE area is
    // INVALID_SERVICE_AREA, decided by the service under lock.
    if (typeof entry !== 'string' || !isCanonicalUuid(entry)) {
      return reject();
    }
    ids.push(entry);
  }
  if (new Set(ids).size !== ids.length) {
    throw new AppError('INVALID_SERVICE_AREA');
  }
  return ids.sort();
}

export interface DriverOnboardingInput {
  readonly fullName: string;
  readonly plateNumber: string | null;
  /** Unique and sorted by UUID. */
  readonly serviceAreaIds: readonly string[];
}

/**
 * POST /v1/onboarding/driver. full_name and service_area_ids are required; plate_number may be absent or null.
 * The result is the NORMALIZED request: it is also what the idempotency fingerprint is built from, so a retry
 * that spells "absent" and "null", or lists the same areas in another order, is still the same request.
 */
export function parseDriverOnboardingBody(body: unknown): DriverOnboardingInput {
  const parsed = objectWithKeys(body, ['full_name', 'service_area_ids'], ['plate_number']);
  return {
    fullName: boundedText(parsed.full_name, DRIVER_FULL_NAME_MAX_LENGTH),
    plateNumber: optionalText(parsed.plate_number, DRIVER_PLATE_NUMBER_MAX_LENGTH),
    serviceAreaIds: serviceAreaIds(parsed.service_area_ids),
  };
}
