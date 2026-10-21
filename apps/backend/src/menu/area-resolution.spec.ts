import { describe, expect, it } from "@jest/globals";
import { BadRequestException } from '@nestjs/common';
import { containingServiceArea } from '../shop/service-area-repository';
import { parseAreaPosition } from './discovery-validation';

const areas = [
  { serviceAreaId: 'large', name: 'Large', latitude: 22.67, longitude: 106.25, radiusMeters: 10000 },
  { serviceAreaId: 'small', name: 'Small', latitude: 22.67, longitude: 106.25, radiusMeters: 1000 },
  { serviceAreaId: 'other', name: 'Other', latitude: 21.02, longitude: 105.84, radiusMeters: 3000 },
];

describe('GPS area containment', () => {
  it('contains real coordinates; handles overlap deterministically without a nearest-area fallback', () => {
    expect(containingServiceArea(areas, 22.67, 106.25)?.serviceAreaId).toBe('small');
    expect(containingServiceArea([...areas].reverse(), 22.67, 106.25)?.serviceAreaId).toBe('small');
    expect(containingServiceArea(areas, 22.69, 106.25)?.serviceAreaId).toBe('large');
    expect(containingServiceArea(areas, 21.02, 105.84)?.serviceAreaId).toBe('other');
    expect(containingServiceArea(areas, 10, 106)).toBeUndefined();
    expect(containingServiceArea([], 22.67, 106.25)).toBeUndefined();
  });
  it('includes the circle boundary and handles the antimeridian', () => {
    const boundary = 1000 / 6371008.8 * 180 / Math.PI;
    const circle = [{ ...areas[0]!, latitude: 0, longitude: 0, radiusMeters: 1000 }];
    expect(containingServiceArea(circle, boundary, 0)).toBeDefined();
    expect(containingServiceArea(circle, boundary + 0.000001, 0)).toBeUndefined();
    expect(containingServiceArea([{ ...circle[0]!, longitude: 180 }], 0, -180)).toBeDefined();
  });
  it('parses only finite, complete, single coordinates within latitude/longitude bounds', () => {
    expect(parseAreaPosition({ latitude: '22.67', longitude: '106.25' })).toEqual({ latitude: 22.67, longitude: 106.25 });
    for (const query of [null, {}, { latitude: 'NaN', longitude: '0' }, { latitude: '91', longitude: '0' },
      { latitude: '0', longitude: '-181' }, { latitude: ['1', '2'], longitude: '0' },
      { latitude: '1', longitude: '0', area_id: 'old' }, { latitude: '', longitude: '0' }]) {
      expect(() => parseAreaPosition(query)).toThrow(BadRequestException);
    }
  });
});
