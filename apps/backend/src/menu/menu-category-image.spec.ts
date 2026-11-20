import { describe, expect, it } from '@jest/globals';
import { AppError } from '../common/app-errors';
import {
  CATEGORY_IMAGE_BASE64_MAX,
  CATEGORY_IMAGE_MAX_BYTES,
  categoryImageDimensions,
  parseCategoryImage,
  parseCategoryImageRemoveBody,
  parseCategoryImageUploadBody,
} from './menu-category-image';

// Issue #412: icon of a dish group. Fixtures are minimal valid headers; the parser reads headers only (no image library).

function png(width: number, height: number): Buffer {
  const header = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12, 'latin1');
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return header;
}

function riff(chunk: string, payload: Buffer): Buffer {
  const size = Buffer.alloc(4);
  size.writeUInt32LE(4 + 8 + payload.length, 0);
  const head = Buffer.concat([Buffer.from('RIFF', 'latin1'), size, Buffer.from('WEBP', 'latin1'), Buffer.from(chunk, 'latin1')]);
  const chunkSize = Buffer.alloc(4);
  chunkSize.writeUInt32LE(payload.length, 0);
  return Buffer.concat([head, chunkSize, payload]);
}

function webpVp8x(width: number, height: number): Buffer {
  const payload = Buffer.alloc(10);
  payload.writeUIntLE(width - 1, 4, 3);
  payload.writeUIntLE(height - 1, 7, 3);
  return riff('VP8X', payload);
}

function webpVp8(width: number, height: number): Buffer {
  const payload = Buffer.alloc(10);
  payload[3] = 0x9d;
  payload[4] = 0x01;
  payload[5] = 0x2a;
  payload.writeUInt16LE(width, 6);
  payload.writeUInt16LE(height, 8);
  return riff('VP8 ', payload);
}

function webpVp8l(width: number, height: number): Buffer {
  const payload = Buffer.alloc(10);
  payload[0] = 0x2f;
  const w = width - 1;
  const h = height - 1;
  payload[1] = w & 0xff;
  payload[2] = ((w >> 8) & 0x3f) | ((h & 0x03) << 6);
  payload[3] = (h >> 2) & 0xff;
  payload[4] = (h >> 10) & 0x0f;
  return riff('VP8L', payload);
}

const b64 = (bytes: Buffer): string => bytes.toString('base64');

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof AppError ? error.code : 'OTHER';
  }
  return undefined;
}

describe('dish group icon: type and size from the bytes', () => {
  it('accepts a square PNG of at least 256 x 256 and reports the type from the bytes', () => {
    const image = parseCategoryImage(b64(png(256, 256)));
    expect(image.contentType).toBe('image/png');
    expect(image.bytes.length).toBe(33);
  });

  it('accepts square WebP in the three encodings (lossy, lossless, extended)', () => {
    expect(parseCategoryImage(b64(webpVp8(256, 256))).contentType).toBe('image/webp');
    expect(parseCategoryImage(b64(webpVp8l(300, 300))).contentType).toBe('image/webp');
    expect(parseCategoryImage(b64(webpVp8x(512, 512))).contentType).toBe('image/webp');
  });

  it('reads the dimensions of each WebP encoding exactly', () => {
    expect(categoryImageDimensions(webpVp8(256, 256), 'image/webp')).toEqual({ width: 256, height: 256 });
    expect(categoryImageDimensions(webpVp8l(1000, 257), 'image/webp')).toEqual({ width: 1000, height: 257 });
    expect(categoryImageDimensions(webpVp8x(700, 300), 'image/webp')).toEqual({ width: 700, height: 300 });
  });

  it('refuses JPEG, SVG and text even when the file is named as a PNG', () => {
    expect(codeOf(() => parseCategoryImage(b64(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])))))
      .toBe('CATEGORY_IMAGE_INVALID_FORMAT');
    expect(codeOf(() => parseCategoryImage(b64(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))))).toBe('CATEGORY_IMAGE_INVALID_FORMAT');
    expect(codeOf(() => parseCategoryImage(b64(Buffer.from('hello world, not a picture'))))).toBe('CATEGORY_IMAGE_INVALID_FORMAT');
  });

  it('refuses a PNG whose signature is fine but whose header is cut short', () => {
    const truncated = png(256, 256).subarray(0, 20);
    expect(codeOf(() => parseCategoryImage(b64(truncated)))).toBe('CATEGORY_IMAGE_INVALID_FORMAT');
  });

  it('refuses a picture smaller than 256 x 256 in either side', () => {
    expect(codeOf(() => parseCategoryImage(b64(png(255, 255))))).toBe('CATEGORY_IMAGE_TOO_SMALL');
    expect(codeOf(() => parseCategoryImage(b64(png(1024, 128))))).toBe('CATEGORY_IMAGE_TOO_SMALL');
  });

  it('refuses a picture that is not square', () => {
    expect(codeOf(() => parseCategoryImage(b64(png(256, 300))))).toBe('CATEGORY_IMAGE_NOT_SQUARE');
    expect(codeOf(() => parseCategoryImage(b64(webpVp8l(512, 300))))).toBe('CATEGORY_IMAGE_NOT_SQUARE');
  });

  it('refuses more than 1 MiB of bytes, and text longer than the base64 limit before decoding', () => {
    const big = Buffer.concat([png(256, 256), Buffer.alloc(CATEGORY_IMAGE_MAX_BYTES - 33 + 1)]);
    expect(big.length).toBeGreaterThan(CATEGORY_IMAGE_MAX_BYTES);
    expect(codeOf(() => parseCategoryImage(b64(big)))).toBe('CATEGORY_IMAGE_TOO_LARGE');
    expect(codeOf(() => parseCategoryImage('A'.repeat(CATEGORY_IMAGE_BASE64_MAX + 4)))).toBe('CATEGORY_IMAGE_TOO_LARGE');
  });

  it('accepts exactly 1 MiB of picture', () => {
    const exact = Buffer.concat([png(256, 256), Buffer.alloc(CATEGORY_IMAGE_MAX_BYTES - 33)]);
    expect(exact.length).toBe(CATEGORY_IMAGE_MAX_BYTES);
    expect(parseCategoryImage(b64(exact)).bytes.length).toBe(CATEGORY_IMAGE_MAX_BYTES);
  });

  it('refuses base64 that is not canonical', () => {
    expect(codeOf(() => parseCategoryImage('not base64!'))).toBe('CATEGORY_IMAGE_INVALID_FORMAT');
    expect(codeOf(() => parseCategoryImage(''))).toBe('CATEGORY_IMAGE_INVALID_FORMAT');
    expect(codeOf(() => parseCategoryImage(42))).toBe('CATEGORY_IMAGE_INVALID_FORMAT');
  });
});

describe('dish group icon request bodies', () => {
  it('upload body is exactly { expected_version, data_base64 }; the content type is never accepted from the client', () => {
    const data = b64(png(256, 256));
    expect(parseCategoryImageUploadBody({ expected_version: 3, data_base64: data }).expectedVersion).toBe(3);
    expect(codeOf(() => parseCategoryImageUploadBody({ expected_version: 3, data_base64: data, content_type: 'image/png' }))).toBe('ADMIN_INPUT_INVALID');
    expect(codeOf(() => parseCategoryImageUploadBody({ expected_version: 0, data_base64: data }))).toBe('ADMIN_INPUT_INVALID');
    expect(codeOf(() => parseCategoryImageUploadBody({ data_base64: data }))).toBe('ADMIN_INPUT_INVALID');
    expect(codeOf(() => parseCategoryImageUploadBody([]))).toBe('ADMIN_INPUT_INVALID');
  });

  it('remove body is exactly { expected_version }', () => {
    expect(parseCategoryImageRemoveBody({ expected_version: 2 })).toEqual({ expectedVersion: 2 });
    expect(codeOf(() => parseCategoryImageRemoveBody({ expected_version: 2, data_base64: 'AA==' }))).toBe('ADMIN_INPUT_INVALID');
    expect(codeOf(() => parseCategoryImageRemoveBody({}))).toBe('ADMIN_INPUT_INVALID');
  });
});
