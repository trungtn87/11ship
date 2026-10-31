import { describe, expect, it } from '@jest/globals';
import { AppError } from '../common/app-errors';
import { assertPinInArea, containingServiceArea, distanceMeters, placeOfPin, ServiceAreaRow } from './service-area-repository';

// Issue #252: the pin guard and the resolver share ONE distance formula, so a save and a public read cannot disagree.
const area: ServiceAreaRow = { serviceAreaId: '11111111-1111-4111-8111-111111111111', status: 'ACTIVE', coverage: { latitude: 21, longitude: 105, radiusMeters: 5000 } };
const north = (metres: number): number => 21 + metres / 111194.9266;

describe('pin placement against a configured circle', () => {
  it('inside, outside and on the edge (4990 m in, 5010 m out)', () => {
    expect(placeOfPin(area, 21, 105)).toBe('INSIDE');
    expect(placeOfPin(area, north(4990), 105)).toBe('INSIDE');
    expect(placeOfPin(area, north(5010), 105)).toBe('OUTSIDE');
    expect(placeOfPin(area, 10.5, 106.5)).toBe('OUTSIDE');
  });

  it('an area without geometry proves nothing: UNCONFIGURED, never INSIDE', () => {
    expect(placeOfPin({}, 21, 105)).toBe('UNCONFIGURED');
  });

  it('the guard refuses only a provable OUTSIDE and ignores a missing pin or a missing circle', () => {
    expect(() => assertPinInArea(area, north(5010), 105)).toThrow(AppError);
    expect(() => assertPinInArea(area, north(100), 105)).not.toThrow();
    expect(() => assertPinInArea(area, null, null)).not.toThrow();
    expect(() => assertPinInArea({ serviceAreaId: area.serviceAreaId, status: 'ACTIVE' }, 10.5, 106.5)).not.toThrow();
  });

  it('uses the very distance of the resolver (overlaps still pick the smaller circle, then the id)', () => {
    const rows = [
      { serviceAreaId: 'b', name: 'Lớn', latitude: 21, longitude: 105, radiusMeters: 9000 },
      { serviceAreaId: 'a', name: 'Nhỏ', latitude: 21, longitude: 105, radiusMeters: 3000 },
    ];
    expect(containingServiceArea(rows, north(2000), 105)?.serviceAreaId).toBe('a');
    expect(containingServiceArea(rows, north(4000), 105)?.serviceAreaId).toBe('b');
    expect(containingServiceArea(rows, north(9500), 105)).toBeUndefined();
    expect(Math.round(distanceMeters(21, 105, north(1000), 105))).toBe(1000);
  });
});
