import { parseShopLogo } from '../shop/shop-logo';
import { requireNormalizedPhone } from '../auth/phone';
import {
  boundedText,
  LATITUDE_LIMIT,
  LONGITUDE_LIMIT,
  objectWithKeys,
  optionalText,
  positiveVersion,
  reject,
} from '../onboarding/shop-onboarding-validation';
import {
  SHOP_ADDRESS_MAX_LENGTH,
  SHOP_FACEBOOK_MAX_LENGTH,
  SHOP_NAME_MAX_LENGTH,
  SHOP_ZALO_MAX_LENGTH,
} from '../onboarding/onboarding-constants';
import { isCanonicalUuid } from '../shared/identifiers';
import {
  BusinessInterval,
  canonicalizeBusinessHours,
  MAX_INTERVALS_PER_WEEK,
} from '../shop/business-hours';
import { ShopProfileFields } from '../shop/shop-repository';
import { AppError } from '../common/app-errors';

// Strict request-body parsers of Shop management (M02-A, task section 4). Like the A2S parsers they are pure: no I/O
// and no Nest pipeline magic. A body is accepted only when it is a plain JSON object whose keys are a subset of the
// allowed ones and include every required one, so a security-sensitive extra field (user_id, shop_id, role, status,
// accepting_orders, ...) is refused instead of ignored. Failures never echo the offending value or key.
//
// Two kinds of failure, on purpose:
//   - the SHAPE of the body (not an object, an unknown or missing key, a wrong JSON type, a non-integer where an
//     integer is required) is the generic 400 BAD_REQUEST of the existing convention;
//   - the CONTENT of a schedule (a value out of range, an interval that breaks the span rule, an overlap, more than
//     28 intervals) is the typed 400 INVALID_BUSINESS_HOURS.
// Profile text uses the A2S bounds and normalizers unchanged (they are imported, not copied).

/** null is allowed ONLY for zalo and facebook: a number, a date or a service area is never null. */
function requiredCoordinate(value: unknown, limit: number): number {
  // JSON.parse turns 1e999 into Infinity, so finiteness is checked explicitly.
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > limit) {
    return reject();
  }
  // -0 is stored and fingerprinted as 0.
  return value === 0 ? 0 : value;
}

function requiredServiceAreaId(value: unknown): string {
  // A malformed identifier is a malformed request; a well-formed one that names no ACTIVE area is
  // INVALID_SERVICE_AREA, decided by the service under lock.
  if (typeof value !== 'string' || !isCanonicalUuid(value)) {
    return reject();
  }
  return value;
}

export interface ShopProfileUpdateInput {
  readonly profile: ShopProfileFields;
  readonly expectedVersion: number;
}

/**
 * PUT /v1/shop/me/profile: a FULL replacement. expected_version, name, contact_phone, address_text, pickup_lat,
 * pickup_lng and service_area_id are required; zalo and facebook may be absent or null (the same logical request).
 * The result is the NORMALIZED request, which is also what the idempotency fingerprint is built from.
 */
export function parseShopProfileUpdateBody(body: unknown): ShopProfileUpdateInput {
  const parsed = objectWithKeys(
    body,
    ['expected_version', 'name', 'contact_phone', 'address_text', 'pickup_lat', 'pickup_lng', 'service_area_id'],
    ['zalo', 'facebook', 'logo'],
  );
  const expectedVersion = positiveVersion(parsed.expected_version);
  const name = boundedText(parsed.name, SHOP_NAME_MAX_LENGTH);
  const contactPhoneNormalized = requireNormalizedPhone(parsed.contact_phone);
  const addressText = boundedText(parsed.address_text, SHOP_ADDRESS_MAX_LENGTH);
  const zalo = optionalText(parsed.zalo, SHOP_ZALO_MAX_LENGTH);
  const facebook = optionalText(parsed.facebook, SHOP_FACEBOOK_MAX_LENGTH);
  const pickupLat = requiredCoordinate(parsed.pickup_lat, LATITUDE_LIMIT);
  const pickupLng = requiredCoordinate(parsed.pickup_lng, LONGITUDE_LIMIT);
  const serviceAreaId = requiredServiceAreaId(parsed.service_area_id);
  return {
    expectedVersion,
    profile: { name, contactPhoneNormalized, zalo, facebook, addressText, pickupLat, pickupLng, serviceAreaId, ...(parsed.logo === undefined ? {} : { logo: parseShopLogo(parsed.logo) }) },
  };
}

export interface BusinessHoursReplaceInput {
  /** Validated and CANONICAL: normalized, sorted by weekday, start, end, offset. */
  readonly intervals: readonly BusinessInterval[];
  readonly expectedVersion: number;
}

/** A JSON number that is an integer: anything else (a string, null, a boolean, 1.5, NaN) is a malformed shape. */
function integerField(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    return reject();
  }
  // -0 is stored and fingerprinted as 0.
  return value === 0 ? 0 : value;
}

function parseInterval(entry: unknown): BusinessInterval {
  const parsed = objectWithKeys(entry, ['weekday', 'start_minute', 'end_minute', 'end_day_offset'], []);
  return {
    weekday: integerField(parsed.weekday),
    startMinute: integerField(parsed.start_minute),
    endMinute: integerField(parsed.end_minute),
    endDayOffset: integerField(parsed.end_day_offset),
  };
}

/**
 * PUT /v1/shop/me/business-hours: exactly {expected_version, intervals}. `intervals` is a FULL replacement and [] is
 * the legal "closed all week" schedule. There is no weekday 0 / "all week" value and no accepting_orders field: the
 * client expands "Ca tuan" into weekdays 1..7 itself. The order of the array has no meaning: the result is sorted and
 * canonical, so a reordered retry is the same logical request.
 */
export function parseBusinessHoursBody(body: unknown): BusinessHoursReplaceInput {
  const parsed = objectWithKeys(body, ['expected_version', 'intervals'], []);
  const expectedVersion = positiveVersion(parsed.expected_version);
  const raw = parsed.intervals;
  if (!Array.isArray(raw)) {
    return reject();
  }
  // The bound is checked BEFORE any element is parsed, so a huge array costs nothing.
  if (raw.length > MAX_INTERVALS_PER_WEEK) {
    throw new AppError('INVALID_BUSINESS_HOURS');
  }
  const intervals = canonicalizeBusinessHours(raw.map(parseInterval));
  return { intervals, expectedVersion };
}

