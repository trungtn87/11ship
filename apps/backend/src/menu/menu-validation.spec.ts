import { describe, expect, it } from '@jest/globals';
import { AppError } from '../common/app-errors';
import { parseImageUploadBody, parseItemCreateBody, parseItemUpdateBody, parseItemVersionBody, sniffImageType } from './menu-validation';

const CATEGORY = '11111111-1111-4111-8111-111111111111';
const IMAGE = '22222222-2222-4222-8222-222222222222';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

describe('menu request parsers', () => {
  it('normalizes a dish and keeps image_id null when there is no picture', () => {
    expect(parseItemCreateBody({ name: '  Ốc  ', price_vnd: 120000, category_id: CATEGORY, image_id: null })).toEqual({
      name: 'Ốc',
      priceVnd: 120000,
      categoryId: CATEGORY,
      imageId: null,
    });
    expect(parseItemCreateBody({ name: 'Ốc', price_vnd: 1, category_id: CATEGORY, image_id: IMAGE }).imageId).toBe(IMAGE);
  });

  it('counts Vietnamese combining marks and emoji as graphemes; empty clears, omission preserves (#207)', () => {
    const base = { name: 'A', price_vnd: 10, category_id: CATEGORY, image_id: null };
    const text = '👨‍👩‍👦'.repeat(298) + 'a\u0306\u0301\r\n';
    expect(parseItemCreateBody({ ...base, description: text }).description).toBe('👨‍👩‍👦'.repeat(298) + 'ắ\n');
    expect(() => parseItemCreateBody({ ...base, description: '👨‍👩‍👦'.repeat(301) })).toThrow();
    expect(parseItemCreateBody({ ...base, description: '  1 đĩa  500g\nít cay  ' }).description).toBe('  1 đĩa  500g\nít cay  ');
    expect(parseItemUpdateBody({ ...base, expected_version: 1 }).description).toBeUndefined();
    for (const description of ['', '  \n', null]) {
      expect(parseItemUpdateBody({ ...base, expected_version: 1, description }).description).toBeNull();
    }
    for (const description of [5, {}, 'bad\u0000text']) {
      expect(() => parseItemCreateBody({ ...base, description })).toThrow();
    }
  });

  it('refuses a missing key, an extra key, a bad price and a bad id', () => {
    const base = { name: 'A', price_vnd: 10, category_id: CATEGORY, image_id: null };
    for (const body of [
      { name: 'A', price_vnd: 10, category_id: CATEGORY },
      { ...base, shop_id: CATEGORY },
      { ...base, price_vnd: 0 },
      { ...base, price_vnd: -5 },
      { ...base, price_vnd: 1.5 },
      { ...base, price_vnd: 100_000_000 },
      { ...base, price_vnd: Number.NaN },
      { ...base, category_id: 'x' },
      { ...base, image_id: 'x' },
      { ...base, name: '' },
      null,
      [],
    ]) {
      expect(() => parseItemCreateBody(body)).toThrow();
    }
  });

  it('an update and an action need a positive integer version and nothing else', () => {
    const body = { expected_version: 3, name: 'A', price_vnd: 10, category_id: CATEGORY, image_id: null };
    expect(parseItemUpdateBody(body).expectedVersion).toBe(3);
    expect(() => parseItemUpdateBody({ ...body, expected_version: 0 })).toThrow();
    expect(() => parseItemUpdateBody({ ...body, status: 'VISIBLE' })).toThrow();
    expect(parseItemVersionBody({ expected_version: 7 })).toBe(7);
    expect(() => parseItemVersionBody({ expected_version: 7, status: 'HIDDEN' })).toThrow();
    expect(() => parseItemVersionBody({})).toThrow();
  });

  it('a picture must be the format it declares, valid base64 and within the limit', () => {
    expect(sniffImageType(JPEG)).toBe('image/jpeg');
    expect(sniffImageType(Buffer.from('<svg/>'))).toBeNull();
    const ok = parseImageUploadBody({ content_type: 'image/jpeg', data_base64: JPEG.toString('base64') });
    expect(ok.contentType).toBe('image/jpeg');
    expect(ok.bytes.equals(JPEG)).toBe(true);
    for (const body of [
      { content_type: 'image/png', data_base64: JPEG.toString('base64') },
      { content_type: 'image/jpeg', data_base64: '***' },
      { content_type: 'image/jpeg', data_base64: Buffer.alloc(3_000_000).toString('base64') },
    ]) {
      expect(() => parseImageUploadBody(body)).toThrow(AppError);
    }
  });
});
