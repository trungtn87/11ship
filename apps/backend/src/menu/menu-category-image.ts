import { AppError } from '../common/app-errors';
import { sniffImageType } from './menu-validation';

// Icon picture of one dish group (issue #412). Stored as jsonb in app.menu_categories.image, like the shop logo. The type is decided by
// the BYTES (magic numbers), never by a declared content type. Only PNG and WebP; a square of at least 256 x 256 pixels; at most 1 MiB.
// The header of PNG and WebP is read here (no image library in the backend).

export const CATEGORY_IMAGE_MAX_BYTES = 1_048_576;
/** Base64 length of CATEGORY_IMAGE_MAX_BYTES (4 characters per 3 bytes, padded). Mirrors the CHECK of the migration. */
export const CATEGORY_IMAGE_BASE64_MAX = 1_398_104;
export const CATEGORY_IMAGE_MIN_SIDE = 256;

export type CategoryImageType = 'image/png' | 'image/webp';

export interface CategoryImage {
  readonly contentType: CategoryImageType;
  readonly bytes: Buffer;
}

export interface CategoryImageUploadInput {
  readonly expectedVersion: number;
  readonly image: CategoryImage;
}

export interface CategoryImageRemoveInput {
  readonly expectedVersion: number;
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function invalidBody(): never {
  throw new AppError('ADMIN_INPUT_INVALID');
}

function plain(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalidBody();
  }
  return value as Record<string, unknown>;
}

function expectedVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    invalidBody();
  }
  return value;
}

/** Width and height read from the header of a PNG or WebP file. null when the header is not readable. */
export function categoryImageDimensions(bytes: Buffer, type: CategoryImageType): { width: number; height: number } | null {
  if (type === 'image/png') {
    if (bytes.length < 24 || bytes.toString('latin1', 12, 16) !== 'IHDR') return null;
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length < 25 || bytes.toString('latin1', 8, 12) !== 'WEBP') return null;
  const chunk = bytes.toString('latin1', 12, 16);
  if (chunk === 'VP8 ') {
    if (bytes.length < 30) return null;
    // Lossy: start code 9d 01 2a, then 14-bit width and height (little endian).
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    // Lossless: signature 0x2f, then 14-bit (width - 1) and 14-bit (height - 1) packed in four bytes.
    if (bytes[20] !== 0x2f) return null;
    const width = 1 + (((bytes[22] & 0x3f) << 8) | bytes[21]);
    const height = 1 + (((bytes[24] & 0x0f) << 10) | (bytes[23] << 2) | (bytes[22] >> 6));
    return { width, height };
  }
  if (chunk === 'VP8X') {
    if (bytes.length < 30) return null;
    // Extended: canvas width - 1 and height - 1 as 24-bit little-endian values.
    return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
  }
  return null;
}

/** Decodes and checks the picture. Every failure is a specific, public error code (the admin screen says what to change). */
export function parseCategoryImage(dataBase64: unknown): CategoryImage {
  if (typeof dataBase64 !== 'string' || dataBase64.length === 0 || dataBase64.length % 4 !== 0 || !BASE64.test(dataBase64)) {
    throw new AppError('CATEGORY_IMAGE_INVALID_FORMAT');
  }
  if (dataBase64.length > CATEGORY_IMAGE_BASE64_MAX) {
    throw new AppError('CATEGORY_IMAGE_TOO_LARGE');
  }
  const bytes = Buffer.from(dataBase64, 'base64');
  if (bytes.length === 0 || bytes.toString('base64') !== dataBase64) {
    throw new AppError('CATEGORY_IMAGE_INVALID_FORMAT');
  }
  if (bytes.length > CATEGORY_IMAGE_MAX_BYTES) {
    throw new AppError('CATEGORY_IMAGE_TOO_LARGE');
  }
  const sniffed = sniffImageType(bytes);
  if (sniffed !== 'image/png' && sniffed !== 'image/webp') {
    throw new AppError('CATEGORY_IMAGE_INVALID_FORMAT');
  }
  const size = categoryImageDimensions(bytes, sniffed);
  if (size === null) {
    throw new AppError('CATEGORY_IMAGE_INVALID_FORMAT');
  }
  if (size.width < CATEGORY_IMAGE_MIN_SIDE || size.height < CATEGORY_IMAGE_MIN_SIDE) {
    throw new AppError('CATEGORY_IMAGE_TOO_SMALL');
  }
  if (size.width !== size.height) {
    throw new AppError('CATEGORY_IMAGE_NOT_SQUARE');
  }
  return { contentType: sniffed, bytes };
}

/** Body of POST …/image: { expected_version, data_base64 }. The content type is never accepted from the client. */
export function parseCategoryImageUploadBody(body: unknown): CategoryImageUploadInput {
  const source = plain(body);
  const keys = Object.keys(source);
  if (keys.length !== 2 || !Object.hasOwn(source, 'expected_version') || !Object.hasOwn(source, 'data_base64')) {
    invalidBody();
  }
  return { expectedVersion: expectedVersion(source.expected_version), image: parseCategoryImage(source.data_base64) };
}

/** Body of POST …/image/remove: { expected_version }. */
export function parseCategoryImageRemoveBody(body: unknown): CategoryImageRemoveInput {
  const source = plain(body);
  if (Object.keys(source).length !== 1 || !Object.hasOwn(source, 'expected_version')) {
    invalidBody();
  }
  return { expectedVersion: expectedVersion(source.expected_version) };
}
