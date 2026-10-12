import { BadRequestException } from '@nestjs/common';
import { isWellFormed } from '../auth/auth-validation';
import { requireNormalizedPhone } from '../auth/phone';
import { isCanonicalUuid } from '../shared/identifiers';
import { ShopProfileFields } from '../shop/shop-repository';
import {
  SHOP_ADDRESS_MAX_LENGTH,
  SHOP_FACEBOOK_MAX_LENGTH,
  SHOP_NAME_MAX_LENGTH,
  SHOP_ZALO_MAX_LENGTH,
} from './onboarding-constants';

// Strict request-body parsers of Shop onboarding (M01-A2S, handoff sections 8 and 9). Like the Auth parsers
// they are pure: no I/O and no Nest pipeline magic. A body is accepted only when it is a plain JSON object whose
// keys are a subset of the allowed ones and include every required one, so a security-sensitive extra field
// (user_id, role, status, accepting_orders, shop_id, ...) is refused instead of ignored.
//
// Profile text is outer-trimmed and must not be empty afterwards; nothing else about it is repaired. Failures
// never echo the offending value or key: a malformed shape is a plain 400 BAD_REQUEST, a bad contact phone is
// INVALID_PHONE (the Auth phone contract, reused).

// The text, key-set and version helpers below are exported so that Shop management (M02-A) validates the same
// profile fields with the SAME bounds and normalizers instead of a second copy that could drift.
export const LATITUDE_LIMIT = 90;
export const LONGITUDE_LIMIT = 180;

export function reject(): never {
  throw new BadRequestException();
}

export function objectWithKeys(
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
export function boundedText(value: unknown, max: number): string {
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
export function optionalText(value: unknown, max: number): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return boundedText(value, max);
}

function optionalCoordinate(value: unknown, limit: number): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  // JSON.parse turns 1e999 into Infinity, so finiteness is checked explicitly.
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > limit) {
    return reject();
  }
  // -0 is stored and fingerprinted as 0.
  return value === 0 ? 0 : value;
}

function optionalServiceAreaId(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  // A malformed identifier is a malformed request; a well-formed one that names no ACTIVE area is
  // INVALID_SERVICE_AREA, decided by the service under lock.
  if (typeof value !== 'string' || !isCanonicalUuid(value)) {
    return reject();
  }
  return value;
}

function optionalVersion(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  return positiveVersion(value);
}

export function positiveVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    return reject();
  }
  return value;
}

export interface ShopProfileInput extends ShopProfileFields {
  /** null when the client creates the profile; the exact current version when it updates a draft. */
  readonly expectedVersion: number | null;
}

/**
 * PUT /v1/onboarding/shop/profile. name, contact_phone and address_text are required; everything else may be
 * absent or null. The result is the NORMALIZED request: it is also what the idempotency fingerprint is built
 * from, so a retry that spells "absent" and "null" differently is still the same request.
 */
export function parseShopProfileBody(body: unknown): ShopProfileInput {
  const parsed = objectWithKeys(
    body,
    ['name', 'contact_phone', 'address_text'],
    ['zalo', 'facebook', 'pickup_lat', 'pickup_lng', 'service_area_id', 'expected_version'],
  );

  const name = boundedText(parsed.name, SHOP_NAME_MAX_LENGTH);
  const contactPhoneNormalized = requireNormalizedPhone(parsed.contact_phone);
  const addressText = boundedText(parsed.address_text, SHOP_ADDRESS_MAX_LENGTH);
  const zalo = optionalText(parsed.zalo, SHOP_ZALO_MAX_LENGTH);
  const facebook = optionalText(parsed.facebook, SHOP_FACEBOOK_MAX_LENGTH);
  const pickupLat = optionalCoordinate(parsed.pickup_lat, LATITUDE_LIMIT);
  const pickupLng = optionalCoordinate(parsed.pickup_lng, LONGITUDE_LIMIT);
  if ((pickupLat === null) !== (pickupLng === null)) {
    // One coordinate without the other is not a point.
    return reject();
  }
  const serviceAreaId = optionalServiceAreaId(parsed.service_area_id);
  const expectedVersion = optionalVersion(parsed.expected_version);

  return {
    name,
    contactPhoneNormalized,
    zalo,
    facebook,
    addressText,
    pickupLat,
    pickupLng,
    serviceAreaId,
    expectedVersion,
  };
}

export interface ShopCompleteInput {
  readonly expectedVersion: number;
}

/** POST /v1/onboarding/shop/complete: exactly {"expected_version": <integer >= 1>}. */
export function parseShopCompleteBody(body: unknown): ShopCompleteInput {
  const parsed = objectWithKeys(body, ['expected_version'], []);
  return { expectedVersion: positiveVersion(parsed.expected_version) };
}

interface HeaderBag {
  readonly headers: Record<string, string | string[] | undefined>;
}

/**
 * A GET of Shop onboarding that takes neither a query nor a body (GET /v1/onboarding/shop/service-areas). A body is
 * recognized by its framing headers: a Content-Length other than 0 or a Transfer-Encoding. Nothing is echoed back.
 */
export function rejectQueryAndBody(request: HeaderBag, query: unknown): void {
  if (query !== undefined && (typeof query !== 'object' || query === null || Object.keys(query).length > 0)) {
    reject();
  }
  const length = request.headers['content-length'];
  if (request.headers['transfer-encoding'] !== undefined || (length !== undefined && length !== '0')) {
    reject();
  }
}
