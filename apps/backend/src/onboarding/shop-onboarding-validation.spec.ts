import { describe, expect, it } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { AppError } from '../common/app-errors';
import { parseShopCompleteBody, parseShopProfileBody } from './shop-onboarding-validation';

const AREA = '123e4567-e89b-42d3-a456-426614174000';
const VALID = { name: ' Quán A ', contact_phone: '0987654321', address_text: ' 1 Phố B ' };

function bad(body: unknown): unknown {
  try {
    parseShopProfileBody(body);
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('parseShopProfileBody (M01-A2S section 8.1)', () => {
  it('normalizes a minimal body: trimmed text, +84 phone, every optional value null', () => {
    expect(parseShopProfileBody(VALID)).toEqual({
      name: 'Quán A',
      contactPhoneNormalized: '+84987654321',
      addressText: '1 Phố B',
      zalo: null,
      facebook: null,
      pickupLat: null,
      pickupLng: null,
      serviceAreaId: null,
      expectedVersion: null,
    });
  });

  it('treats absent and null as the same logical request', () => {
    const explicit = parseShopProfileBody({
      ...VALID,
      zalo: null,
      facebook: null,
      pickup_lat: null,
      pickup_lng: null,
      service_area_id: null,
      expected_version: null,
    });
    expect(explicit).toEqual(parseShopProfileBody(VALID));
  });

  it('accepts a full body, and turns -0 into 0', () => {
    const parsed = parseShopProfileBody({
      ...VALID,
      zalo: ' z ',
      facebook: 'fb',
      pickup_lat: -0,
      pickup_lng: 105.8,
      service_area_id: AREA,
      expected_version: 3,
    });
    expect(parsed.zalo).toBe('z');
    expect(Object.is(parsed.pickupLat, 0)).toBe(true);
    expect(parsed.pickupLng).toBe(105.8);
    expect(parsed.serviceAreaId).toBe(AREA);
    expect(parsed.expectedVersion).toBe(3);
  });

  it('refuses security-sensitive and unknown fields instead of ignoring them', () => {
    for (const extra of [
      { user_id: AREA },
      { shop_id: AREA },
      { role: 'SHOP' },
      { roles: ['SHOP'] },
      { status: 'ACTIVE' },
      { accepting_orders: true },
      { is_admin: true },
      { anything: 1 },
    ]) {
      expect(bad({ ...VALID, ...extra })).toBeInstanceOf(BadRequestException);
    }
  });

  it('refuses a non-object body and missing required fields', () => {
    for (const body of [undefined, null, 'x', 1, [], [VALID]]) {
      expect(bad(body)).toBeInstanceOf(BadRequestException);
    }
    for (const key of Object.keys(VALID)) {
      const { [key]: _removed, ...rest } = VALID as Record<string, unknown>;
      void _removed;
      expect(bad(rest)).toBeInstanceOf(BadRequestException);
    }
  });

  it('refuses blank, over-long, NUL and lone-surrogate text', () => {
    expect(bad({ ...VALID, name: '   ' })).toBeInstanceOf(BadRequestException);
    expect(bad({ ...VALID, name: 'a'.repeat(121) })).toBeInstanceOf(BadRequestException);
    expect(parseShopProfileBody({ ...VALID, name: 'a'.repeat(120) }).name).toHaveLength(120);
    expect(bad({ ...VALID, address_text: 'a'.repeat(501) })).toBeInstanceOf(BadRequestException);
    expect(bad({ ...VALID, zalo: 'a'.repeat(161) })).toBeInstanceOf(BadRequestException);
    expect(bad({ ...VALID, facebook: 'a'.repeat(301) })).toBeInstanceOf(BadRequestException);
    expect(bad({ ...VALID, name: 'a\u0000b' })).toBeInstanceOf(BadRequestException);
    expect(bad({ ...VALID, name: 'a\ud800b' })).toBeInstanceOf(BadRequestException);
    expect(bad({ ...VALID, zalo: '' })).toBeInstanceOf(BadRequestException);
    expect(bad({ ...VALID, name: 5 })).toBeInstanceOf(BadRequestException);
  });

  it('counts characters, not UTF-16 units', () => {
    expect(parseShopProfileBody({ ...VALID, name: '😀'.repeat(120) }).name).toBe('😀'.repeat(120));
    expect(bad({ ...VALID, name: '😀'.repeat(121) })).toBeInstanceOf(BadRequestException);
  });

  it('a bad contact phone is INVALID_PHONE', () => {
    for (const phone of ['', 'abc', '123', 5, null]) {
      const error = bad({ ...VALID, contact_phone: phone });
      expect(error instanceof AppError ? error.code : error).toBe('INVALID_PHONE');
    }
  });

  it('refuses a lone coordinate, out-of-range, non-finite and non-number coordinates', () => {
    expect(bad({ ...VALID, pickup_lat: 10 })).toBeInstanceOf(BadRequestException);
    expect(bad({ ...VALID, pickup_lng: 10 })).toBeInstanceOf(BadRequestException);
    for (const [lat, lng] of [
      [90.0001, 0],
      [-91, 0],
      [0, 180.5],
      [0, -181],
      ['1', '2'],
      [Number.POSITIVE_INFINITY, 0],
      [Number.NaN, 0],
    ]) {
      expect(bad({ ...VALID, pickup_lat: lat, pickup_lng: lng })).toBeInstanceOf(BadRequestException);
    }
    expect(parseShopProfileBody({ ...VALID, pickup_lat: 90, pickup_lng: -180 }).pickupLat).toBe(90);
  });

  it('refuses a malformed service_area_id and a bad expected_version', () => {
    for (const id of ['x', AREA.toUpperCase(), 5, '']) {
      expect(bad({ ...VALID, service_area_id: id })).toBeInstanceOf(BadRequestException);
    }
    for (const version of [0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1, true]) {
      expect(bad({ ...VALID, expected_version: version })).toBeInstanceOf(BadRequestException);
    }
  });

  it('never echoes the offending value in the failure', () => {
    const error = bad({ ...VALID, name: 'SECRET-NAME\u0000' }) as BadRequestException;
    expect(JSON.stringify(error.getResponse())).not.toContain('SECRET');
  });
});

describe('parseShopCompleteBody (M01-A2S section 8.2)', () => {
  it('accepts exactly {expected_version: integer >= 1}', () => {
    expect(parseShopCompleteBody({ expected_version: 1 })).toEqual({ expectedVersion: 1 });
  });

  it('refuses everything else', () => {
    for (const body of [
      undefined,
      null,
      [],
      {},
      { expected_version: null },
      { expected_version: 0 },
      { expected_version: '1' },
      { expected_version: 1.2 },
      { expected_version: 1, shop_id: AREA },
      { expected_version: 1, status: 'ACTIVE' },
    ]) {
      expect(() => parseShopCompleteBody(body)).toThrow(BadRequestException);
    }
  });
});
