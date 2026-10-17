import { AppError } from '../common/app-errors';
import {
  boundedText,
  objectWithKeys,
  positiveVersion,
  reject,
} from '../onboarding/shop-onboarding-validation';
import { isCanonicalUuid } from '../shared/identifiers';
import {
  MENU_IMAGE_CONTENT_TYPES,
  MENU_IMAGE_MAX_BYTES,
  MENU_ITEM_NAME_MAX_LENGTH,
  MENU_PRICE_MAX_VND,
  MenuImageContentType,
} from './menu-constants';

// Strict request-body parsers of Menu (M02-MON). Pure like the Shop ones: a body is a plain JSON object whose keys are exactly the
// allowed ones (a privileged extra such as shop_id, status or user_id is refused, never ignored). A malformed SHAPE is the generic
// 400; failures never echo the offending value.

export interface MenuItemFields {
  readonly name: string;
  readonly priceVnd: number;
  readonly categoryId: string;
  readonly imageId: string | null;
}

function uuid(value: unknown): string {
  if (typeof value !== 'string' || !isCanonicalUuid(value)) {
    return reject();
  }
  return value;
}

function price(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > MENU_PRICE_MAX_VND) {
    return reject();
  }
  return value;
}

function fields(parsed: Record<string, unknown>): MenuItemFields {
  return {
    name: boundedText(parsed.name, MENU_ITEM_NAME_MAX_LENGTH),
    priceVnd: price(parsed.price_vnd),
    categoryId: uuid(parsed.category_id),
    imageId: parsed.image_id === null ? null : uuid(parsed.image_id),
  };
}

/** POST /v1/shop/me/menu/items. image_id is required but may be null (no picture). */
export function parseItemCreateBody(body: unknown): MenuItemFields {
  return fields(objectWithKeys(body, ['name', 'price_vnd', 'category_id', 'image_id'], []));
}

export interface ItemUpdateInput extends MenuItemFields {
  readonly expectedVersion: number;
}

/** PUT /v1/shop/me/menu/items/:id: a FULL replacement of the editable fields at an exact version. */
export function parseItemUpdateBody(body: unknown): ItemUpdateInput {
  const parsed = objectWithKeys(body, ['expected_version', 'name', 'price_vnd', 'category_id', 'image_id'], []);
  return { ...fields(parsed), expectedVersion: positiveVersion(parsed.expected_version) };
}

/** POST .../hide, .../show, .../delete: exactly {expected_version}. */
export function parseItemVersionBody(body: unknown): number {
  return positiveVersion(objectWithKeys(body, ['expected_version'], []).expected_version);
}

/** A path id: a malformed one names no dish. */
export function parseItemId(value: unknown): string {
  if (typeof value !== 'string' || !isCanonicalUuid(value)) {
    throw new AppError('MENU_ITEM_NOT_FOUND');
  }
  return value;
}

export interface ImageUploadInput {
  readonly contentType: MenuImageContentType;
  readonly bytes: Buffer;
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** The picture's real format, from its first bytes: the declared content type is not trusted on its own. */
export function sniffImageType(bytes: Buffer): MenuImageContentType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

/** POST /v1/shop/me/menu/images {content_type, data_base64}. A bad picture is INVALID_MENU_IMAGE (typed), a bad shape the generic 400. */
export function parseImageUploadBody(body: unknown): ImageUploadInput {
  const parsed = objectWithKeys(body, ['content_type', 'data_base64'], []);
  const declared = parsed.content_type;
  const data = parsed.data_base64;
  if (typeof declared !== 'string' || typeof data !== 'string') {
    return reject();
  }
  // Bound before decoding: 4 base64 characters carry 3 bytes.
  if (data.length === 0 || data.length > Math.ceil((MENU_IMAGE_MAX_BYTES * 4) / 3) + 4 || data.length % 4 !== 0 || !BASE64.test(data)) {
    throw new AppError('INVALID_MENU_IMAGE');
  }
  const bytes = Buffer.from(data, 'base64');
  const sniffed = sniffImageType(bytes);
  if (
    bytes.length === 0 ||
    bytes.length > MENU_IMAGE_MAX_BYTES ||
    sniffed === null ||
    sniffed !== declared ||
    !(MENU_IMAGE_CONTENT_TYPES as readonly string[]).includes(declared)
  ) {
    throw new AppError('INVALID_MENU_IMAGE');
  }
  return { contentType: sniffed, bytes };
}
