import { describe, expect, it } from '@jest/globals';
import { parseCreateAreaBody, parseImpactQuery, parseStatusAreaBody, parseUpdateAreaBody } from './admin-service-area-validation';

const circle = { lat: 21, lng: 105, radius_m: 5000 };
const create = (over: Record<string, unknown> = {}): unknown => ({ code: 'CB-01', name: 'Cao Bằng', reason: 'Tạo', ...over });

describe('service area input (issue #253)', () => {
  it('create: no geometry and INACTIVE unless sent; nothing is defaulted', () => {
    expect(parseCreateAreaBody(create())).toEqual({ code: 'CB-01', name: 'Cao Bằng', status: 'INACTIVE', coverage: null, reason: 'Tạo' });
    expect(parseCreateAreaBody(create({ coverage: circle })).coverage).toEqual({ latitude: 21, longitude: 105, radiusMeters: 5000 });
  });

  it.each([
    ['radius 0', { coverage: { ...circle, radius_m: 0 } }],
    ['radius over 100000', { coverage: { ...circle, radius_m: 100001 } }],
    ['fractional radius', { coverage: { ...circle, radius_m: 10.5 } }],
    ['lat out of range', { coverage: { ...circle, lat: 90.1 } }],
    ['lng out of range', { coverage: { ...circle, lng: 180.1 } }],
    ['two of three values', { coverage: { lat: 21, lng: 105 } }],
    ['string number', { coverage: { ...circle, lat: '21' } }],
    ['unknown key', { coverage: { ...circle, tolerance: 1 } }],
    ['blank name', { name: '  ' }],
    ['code with spaces or accents', { code: 'cao bằng' }],
    ['no reason', { reason: '' }],
    ['unknown field', { owner: 'x' }],
  ])('create refuses %s', (_label, over) => {
    expect(() => parseCreateAreaBody(create(over))).toThrow();
  });

  it('accepts the exact bounds', () => {
    for (const coverage of [{ lat: -90, lng: -180, radius_m: 1 }, { lat: 90, lng: 180, radius_m: 100000 }]) {
      expect(() => parseCreateAreaBody(create({ coverage }))).not.toThrow();
    }
  });

  it('update: geometry absent keeps it, null is refused (a circle is never cleared)', () => {
    expect(parseUpdateAreaBody({ expected_version: 3, name: 'X', reason: 'r' }).coverage).toBeUndefined();
    expect(() => parseUpdateAreaBody({ expected_version: 3, name: 'X', coverage: null, reason: 'r' })).toThrow();
    expect(() => parseUpdateAreaBody({ name: 'X', reason: 'r' })).toThrow();
    expect(parseUpdateAreaBody({ expected_version: 1, name: 'X', reason: 'r', confirm_impact: true }).confirmImpact).toBe(true);
  });

  it('status and impact queries are strict', () => {
    expect(parseStatusAreaBody({ expected_version: 1, status: 'ACTIVE', reason: 'r' }).confirmImpact).toBe(false);
    expect(() => parseStatusAreaBody({ expected_version: 1, status: 'DELETED', reason: 'r' })).toThrow();
    expect(parseImpactQuery({ status: 'INACTIVE' })).toEqual({ status: 'INACTIVE', coverage: null });
    expect(parseImpactQuery({ lat: '21', lng: '105', radius_m: '2000' }).coverage).toEqual({ latitude: 21, longitude: 105, radiusMeters: 2000 });
    expect(() => parseImpactQuery({ lat: '21' })).toThrow();
    expect(() => parseImpactQuery({ other: '1' })).toThrow();
  });
});
