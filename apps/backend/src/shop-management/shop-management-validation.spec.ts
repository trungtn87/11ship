import { describe, expect, it } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { AppError } from '../common/app-errors';
import { parseBusinessHoursBody, parseShopProfileUpdateBody } from './shop-management-validation';

const AREA = '123e4567-e89b-42d3-a456-426614174000';
const PROFILE = {
  expected_version: 2,
  name: ' Quán A ',
  contact_phone: '0987654321',
  address_text: ' 1 Phố B ',
  pickup_lat: 21.0,
  pickup_lng: 105.8,
  service_area_id: AREA,
};

function thrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('parseShopProfileUpdateBody (M02-A section 4)', () => {
  it('normalizes a full replacement; zalo and facebook absent or null are the same request', () => {
    const parsed = parseShopProfileUpdateBody(PROFILE);
    expect(parsed.expectedVersion).toBe(2);
    expect(parsed.profile).toEqual({
      name: 'Quán A',
      contactPhoneNormalized: '+84987654321',
      zalo: null,
      facebook: null,
      addressText: '1 Phố B',
      pickupLat: 21,
      pickupLng: 105.8,
      serviceAreaId: AREA,
    });
    expect(parseShopProfileUpdateBody({ ...PROFILE, zalo: null, facebook: null })).toEqual(parsed);
  });

  it('turns -0 into 0', () => {
    const parsed = parseShopProfileUpdateBody({ ...PROFILE, pickup_lat: -0 });
    expect(Object.is(parsed.profile.pickupLat, 0)).toBe(true);
  });

  it.each(['expected_version', 'name', 'contact_phone', 'address_text', 'pickup_lat', 'pickup_lng', 'service_area_id'])(
    'rejects a body without %s',
    (key) => {
      const body: Record<string, unknown> = { ...PROFILE };
      delete body[key];
      expect(thrown(() => parseShopProfileUpdateBody(body))).toBeInstanceOf(BadRequestException);
    },
  );

  it.each(['name', 'address_text', 'pickup_lat', 'pickup_lng', 'service_area_id', 'expected_version'])(
    'rejects null for the required %s',
    (key) => {
      expect(thrown(() => parseShopProfileUpdateBody({ ...PROFILE, [key]: null }))).toBeInstanceOf(
        BadRequestException,
      );
    },
  );

  it.each(['user_id', 'shop_id', 'status', 'role', 'version', 'accepting_orders', 'availability', 'online'])(
    'rejects the extra key %s',
    (key) => {
      expect(thrown(() => parseShopProfileUpdateBody({ ...PROFILE, [key]: 'x' }))).toBeInstanceOf(
        BadRequestException,
      );
    },
  );

  it.each([
    ['latitude out of range', { pickup_lat: 90.5 }],
    ['longitude out of range', { pickup_lng: -181 }],
    ['infinite latitude', { pickup_lat: Number.POSITIVE_INFINITY }],
    ['string latitude', { pickup_lat: '21' }],
    ['malformed service area', { service_area_id: 'not-a-uuid' }],
    ['version 0', { expected_version: 0 }],
    ['version 1.5', { expected_version: 1.5 }],
    ['blank name', { name: '   ' }],
  ])('rejects %s as a generic 400', (_label, patch) => {
    expect(thrown(() => parseShopProfileUpdateBody({ ...PROFILE, ...patch }))).toBeInstanceOf(BadRequestException);
  });

  it.each([null, '123', 5])('rejects the contact phone %p with the existing INVALID_PHONE error', (phone) => {
    const error = thrown(() => parseShopProfileUpdateBody({ ...PROFILE, contact_phone: phone }));
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('INVALID_PHONE');
  });

  it.each([null, undefined, 'x', 3, [], [PROFILE]])('rejects a non-object body %p', (body) => {
    expect(thrown(() => parseShopProfileUpdateBody(body))).toBeInstanceOf(BadRequestException);
  });
});

const HOURS = { expected_version: 1, intervals: [] as unknown[] };
const iv = (weekday: number, start: number, end: number, offset: number) => ({
  weekday,
  start_minute: start,
  end_minute: end,
  end_day_offset: offset,
});

describe('parseBusinessHoursBody (M02-A section 4)', () => {
  it('accepts [] as the closed-all-week schedule', () => {
    expect(parseBusinessHoursBody(HOURS)).toEqual({ expectedVersion: 1, intervals: [] });
  });

  it('returns a canonical, sorted schedule whatever the request order', () => {
    const a = parseBusinessHoursBody({ ...HOURS, intervals: [iv(3, 600, 900, 0), iv(1, 0, 0, 1)] });
    const b = parseBusinessHoursBody({ ...HOURS, intervals: [iv(1, 0, 1440, 0), iv(3, 600, 900, 0)] });
    expect(a).toEqual(b);
    expect(a.intervals[0]).toEqual({ weekday: 1, startMinute: 0, endMinute: 1440, endDayOffset: 0 });
  });

  it('normalizes -0 to 0', () => {
    const parsed = parseBusinessHoursBody({ ...HOURS, intervals: [iv(2, -0, 600, 0)] });
    expect(Object.is(parsed.intervals[0]?.startMinute, 0)).toBe(true);
  });

  it('accepts exactly 28 intervals and rejects 29 as INVALID_BUSINESS_HOURS', () => {
    const day = (d: number) => [iv(d, 0, 100, 0), iv(d, 200, 300, 0), iv(d, 400, 500, 0), iv(d, 600, 700, 0)];
    const full = [1, 2, 3, 4, 5, 6, 7].flatMap(day);
    expect(parseBusinessHoursBody({ ...HOURS, intervals: full }).intervals).toHaveLength(28);
    const error = thrown(() => parseBusinessHoursBody({ ...HOURS, intervals: [...full, iv(1, 800, 900, 0)] }));
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('INVALID_BUSINESS_HOURS');
  });

  it.each([
    ['weekday 0', iv(0, 0, 60, 0)],
    ['weekday 8', iv(8, 0, 60, 0)],
    ['start 1440', iv(1, 1440, 1440, 0)],
    ['end 1441', iv(1, 0, 1441, 0)],
    ['same day end = start', iv(1, 60, 60, 0)],
    ['offset 2', iv(1, 60, 30, 2)],
    ['next day end > start', iv(1, 60, 120, 1)],
    ['next day end 1440', iv(1, 60, 1440, 1)],
  ])('rejects %s as INVALID_BUSINESS_HOURS', (_label, interval) => {
    const error = thrown(() => parseBusinessHoursBody({ ...HOURS, intervals: [interval] }));
    expect((error as AppError).code).toBe('INVALID_BUSINESS_HOURS');
  });

  it('rejects an overlap, a duplicate and the Sunday-Monday wrap overlap', () => {
    for (const intervals of [
      [iv(1, 0, 100, 0), iv(1, 50, 150, 0)],
      [iv(1, 0, 100, 0), iv(1, 0, 100, 0)],
      [iv(7, 1080, 120, 1), iv(1, 60, 200, 0)],
    ]) {
      const error = thrown(() => parseBusinessHoursBody({ ...HOURS, intervals }));
      expect((error as AppError).code).toBe('INVALID_BUSINESS_HOURS');
    }
  });

  it('accepts adjacency and the legal Sunday-Monday wrap', () => {
    expect(parseBusinessHoursBody({ ...HOURS, intervals: [iv(1, 0, 100, 0), iv(1, 100, 200, 0)] }).intervals).toHaveLength(2);
    expect(parseBusinessHoursBody({ ...HOURS, intervals: [iv(7, 1080, 120, 1), iv(1, 120, 300, 0)] }).intervals).toHaveLength(2);
  });

  it.each([
    ['unknown body key', { ...HOURS, accepting_orders: true }],
    ['shop_id', { ...HOURS, shop_id: AREA }],
    ['missing intervals', { expected_version: 1 }],
    ['missing version', { intervals: [] }],
    ['intervals not an array', { ...HOURS, intervals: {} }],
    ['interval not an object', { ...HOURS, intervals: [5] }],
    ['interval extra key', { ...HOURS, intervals: [{ ...iv(1, 0, 60, 0), day: 1 }] }],
    ['interval missing key', { ...HOURS, intervals: [{ weekday: 1, start_minute: 0, end_minute: 60 }] }],
    ['string minute', { ...HOURS, intervals: [{ ...iv(1, 0, 60, 0), start_minute: '0' }] }],
    ['fractional minute', { ...HOURS, intervals: [{ ...iv(1, 0, 60, 0), end_minute: 60.5 }] }],
    ['null weekday', { ...HOURS, intervals: [{ ...iv(1, 0, 60, 0), weekday: null }] }],
    ['version 0', { ...HOURS, expected_version: 0 }],
  ])('rejects %s as a generic 400', (_label, body) => {
    expect(thrown(() => parseBusinessHoursBody(body))).toBeInstanceOf(BadRequestException);
  });
});
