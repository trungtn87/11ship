import { BadRequestException } from '@nestjs/common';
import { isWellFormed } from '../auth/auth-validation';
import { requireNormalizedPhone } from '../auth/phone';
import { AppError } from '../common/app-errors';
import { objectWithKeys, positiveVersion } from '../onboarding/shop-onboarding-validation';
import { isCanonicalUuid } from '../shared/identifiers';
import {
  ADDRESS_DESCRIPTION_MAX_LENGTH,
  ADDRESS_DISPLAY_NAME_MAX_LENGTH,
  ADDRESS_LABELS,
  ADDRESS_NOTE_MAX_LENGTH,
  ADDRESS_RECIPIENT_NAME_MAX_LENGTH,
  AddressLabel,
} from './customers-constants';

// Strict request parsing of the M05 endpoints. Pure: no I/O. Identity is never read from the request: no body, query or path
// names a user or a customer, so no customer_id can arrive. A body is a plain JSON object whose keys are exactly the allowed ones
// (an extra such as customer_id, user_id or is_active is refused, never ignored). A malformed SHAPE is the generic 400; a bad
// phone is INVALID_PHONE. Failures never echo the offending key or value.

export interface AddressFields {
  readonly label: AddressLabel;
  readonly displayName: string | null;
  readonly recipientName: string | null;
  /** E.164 (+84...), normalized by the Auth phone rules. */
  readonly contactPhone: string;
  readonly addressDescription: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly deliveryNote: string | null;
}

export interface AddressCreateInput extends AddressFields {
  readonly pickupDefault: boolean;
  readonly deliveryDefault: boolean;
}

/** A partial change: only the keys present are changed. null clears an optional field. */
export interface AddressPatch {
  readonly label?: AddressLabel;
  readonly displayName?: string | null;
  readonly recipientName?: string | null;
  readonly contactPhone?: string;
  readonly addressDescription?: string;
  readonly position?: { readonly latitude: number; readonly longitude: number } | null;
  readonly deliveryNote?: string | null;
  readonly pickupDefault?: boolean;
  readonly deliveryDefault?: boolean;
}

export interface AddressUpdateInput {
  readonly expectedVersion: number;
  readonly patch: AddressPatch;
}

function reject(): never {
  throw new BadRequestException();
}

function wellFormedString(value: unknown): string {
  if (typeof value !== 'string' || !isWellFormed(value) || value.includes('\u0000')) {
    return reject();
  }
  return value.trim();
}

function requiredText(value: unknown, max: number): string {
  const text = wellFormedString(value);
  if (text.length === 0 || text.length > max * 2 || [...text].length > max) {
    return reject();
  }
  return text;
}

/** Absent, null and a blank text are all "no value": the same logical request. */
function optionalText(value: unknown, max: number): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const text = wellFormedString(value);
  if (text.length === 0) {
    return null;
  }
  if (text.length > max * 2 || [...text].length > max) {
    return reject();
  }
  return text;
}

function label(value: unknown): AddressLabel {
  if (typeof value !== 'string' || !(ADDRESS_LABELS as readonly string[]).includes(value)) {
    return reject();
  }
  return value as AddressLabel;
}

function coordinate(value: unknown, limit: number): number {
  // JSON.parse turns 1e999 into Infinity, so finiteness is checked explicitly.
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > limit) {
    return reject();
  }
  // -0 is stored and fingerprinted as 0.
  return value === 0 ? 0 : value;
}

/** latitude and longitude come together (both numbers) or not at all (both absent or null). */
function position(latitude: unknown, longitude: unknown): { latitude: number; longitude: number } | null {
  const noLatitude = latitude === undefined || latitude === null;
  const noLongitude = longitude === undefined || longitude === null;
  if (noLatitude && noLongitude) {
    return null;
  }
  if (noLatitude || noLongitude) {
    return reject();
  }
  return { latitude: coordinate(latitude, 90), longitude: coordinate(longitude, 180) };
}

function phone(value: unknown): string {
  // A non-string or an unparseable number is INVALID_PHONE (the Auth phone contract), never an echo.
  return requireNormalizedPhone(value);
}

const FIELD_KEYS = ['label', 'display_name', 'recipient_name', 'contact_phone', 'address_description', 'latitude', 'longitude', 'delivery_note'] as const;

/** POST /v1/customers/me/addresses. label, contact_phone and address_description are required. */
export function parseAddressCreateBody(body: unknown): AddressCreateInput {
  const parsed = objectWithKeys(body, ['label', 'contact_phone', 'address_description'], [
    'display_name',
    'recipient_name',
    'latitude',
    'longitude',
    'delivery_note',
    'is_default',
    'is_pickup_default',
    'is_delivery_default',
  ]);
  for (const value of [parsed.is_default, parsed.is_pickup_default, parsed.is_delivery_default]) {
    if (value !== undefined && typeof value !== 'boolean') return reject();
  }
  if (parsed.is_default !== undefined && parsed.is_delivery_default !== undefined && parsed.is_default !== parsed.is_delivery_default) {
    return reject();
  }
  const where = position(parsed.latitude, parsed.longitude);
  return {
    label: label(parsed.label),
    displayName: optionalText(parsed.display_name, ADDRESS_DISPLAY_NAME_MAX_LENGTH),
    recipientName: optionalText(parsed.recipient_name, ADDRESS_RECIPIENT_NAME_MAX_LENGTH),
    contactPhone: phone(parsed.contact_phone),
    addressDescription: requiredText(parsed.address_description, ADDRESS_DESCRIPTION_MAX_LENGTH),
    latitude: where === null ? null : where.latitude,
    longitude: where === null ? null : where.longitude,
    deliveryNote: optionalText(parsed.delivery_note, ADDRESS_NOTE_MAX_LENGTH),
    pickupDefault: parsed.is_pickup_default === true,
    deliveryDefault: parsed.is_delivery_default === true || parsed.is_default === true,
  };
}

/**
 * PATCH /v1/customers/me/addresses/:id. expected_version is required and at least one change must come with it. latitude and
 * longitude are changed together. is_default accepts only true.
 */
export function parseAddressUpdateBody(body: unknown): AddressUpdateInput {
  const parsed = objectWithKeys(body, ['expected_version'], [...FIELD_KEYS, 'is_default', 'is_pickup_default', 'is_delivery_default']);
  const expectedVersion = positiveVersion(parsed.expected_version);
  const patch: {
    label?: AddressLabel;
    displayName?: string | null;
    recipientName?: string | null;
    contactPhone?: string;
    addressDescription?: string;
    position?: { latitude: number; longitude: number } | null;
    deliveryNote?: string | null;
    pickupDefault?: boolean;
    deliveryDefault?: boolean;
  } = {};
  if (Object.hasOwn(parsed, 'label')) {
    patch.label = label(parsed.label);
  }
  if (Object.hasOwn(parsed, 'display_name')) {
    patch.displayName = optionalText(parsed.display_name, ADDRESS_DISPLAY_NAME_MAX_LENGTH);
  }
  if (Object.hasOwn(parsed, 'recipient_name')) {
    patch.recipientName = optionalText(parsed.recipient_name, ADDRESS_RECIPIENT_NAME_MAX_LENGTH);
  }
  if (Object.hasOwn(parsed, 'contact_phone')) {
    patch.contactPhone = phone(parsed.contact_phone);
  }
  if (Object.hasOwn(parsed, 'address_description')) {
    patch.addressDescription = requiredText(parsed.address_description, ADDRESS_DESCRIPTION_MAX_LENGTH);
  }
  if (Object.hasOwn(parsed, 'latitude') || Object.hasOwn(parsed, 'longitude')) {
    // Both keys must be named, so a half-sent position can never change one coordinate alone.
    if (!Object.hasOwn(parsed, 'latitude') || !Object.hasOwn(parsed, 'longitude')) {
      return reject();
    }
    patch.position = position(parsed.latitude, parsed.longitude);
  }
  if (Object.hasOwn(parsed, 'delivery_note')) {
    patch.deliveryNote = optionalText(parsed.delivery_note, ADDRESS_NOTE_MAX_LENGTH);
  }
  if (Object.hasOwn(parsed, 'is_default')) {
    if (parsed.is_default !== true) {
      return reject();
    }
    patch.deliveryDefault = true;
  }
  if (Object.hasOwn(parsed, 'is_pickup_default')) {
    if (typeof parsed.is_pickup_default !== 'boolean') return reject();
    patch.pickupDefault = parsed.is_pickup_default;
  }
  if (Object.hasOwn(parsed, 'is_delivery_default')) {
    if (typeof parsed.is_delivery_default !== 'boolean') return reject();
    if (Object.hasOwn(parsed, 'is_default') && parsed.is_delivery_default !== true) return reject();
    patch.deliveryDefault = parsed.is_delivery_default;
  }
  if (Object.keys(patch).length === 0) {
    return reject();
  }
  return { expectedVersion, patch };
}

export type AddressDefaultKind = 'pickup' | 'delivery';

export function parseAddressDefaultKind(value: unknown): AddressDefaultKind {
  if (value !== 'pickup' && value !== 'delivery') return reject();
  return value;
}

/** A path id: a malformed one names no address of this customer. */
export function parseAddressId(value: unknown): string {
  if (typeof value !== 'string' || !isCanonicalUuid(value)) {
    throw new AppError('CUSTOMER_ADDRESS_NOT_FOUND');
  }
  return value;
}

/** No query parameter is accepted on these routes: the only caller identity is the authenticated principal. */
export function rejectQuery(query: unknown): void {
  if (query === undefined) {
    return;
  }
  if (typeof query !== 'object' || query === null || Object.keys(query).length > 0) {
    reject();
  }
}

interface HeaderBag {
  readonly headers: Record<string, string | string[] | undefined>;
}

/**
 * A GET (or a DELETE, or the body-less PUT of the default) takes neither a query nor a body. A body is recognized by its framing
 * headers (a Content-Length other than 0, or a Transfer-Encoding), so even an empty JSON object is refused, whatever the body parser
 * made of it.
 */
export function rejectBodyAndQuery(request: HeaderBag, query: unknown): void {
  rejectQuery(query);
  const length = request.headers['content-length'];
  if (request.headers['transfer-encoding'] !== undefined || (length !== undefined && length !== '0')) {
    reject();
  }
}
