import { describe, expect, it } from '@jest/globals';
import { fitSketch, parseOpsMap, SKETCH_SIZE } from './ops-map';

const base = {
  generated_at: '2026-10-31T03:00:00.000Z',
  zones: [{ service_area_id: 'a1', name: 'Cao Bằng', status: 'ACTIVE', coverage: { lat: 22.665, lng: 106.258, radius_m: 10000 } }, { service_area_id: 'a2', name: 'Chưa cấu hình', status: 'INACTIVE', coverage: null }],
  shops: [{ shop_id: 's1', name: 'Quán A', lat: 22.67, lng: 106.26, service_area_id: 'a1' }],
  shops_without_pin: 2,
  shippers: [{ driver_id: 'd1', code: 'SH-1', name: null, lat: 22.66, lng: 106.25, age_seconds: 30, freshness: 'LIVE' }],
  shippers_online: 3,
  shippers_without_position: 2,
  truncated: false,
};

describe('operations map (issue #262)', () => {
  it('reads exactly the documented shape; what the actor may not see stays null and is never turned into an empty list', () => {
    const map = parseOpsMap(base);
    expect(map?.zones).toHaveLength(2);
    expect(map?.zones[1]?.coverage).toBeNull();
    expect(map?.shippers?.[0]).toMatchObject({ freshness: 'LIVE', name: null, code: 'SH-1' });
    const shopOnly = parseOpsMap({ ...base, shippers: null, shippers_online: null, shippers_without_position: null });
    expect(shopOnly?.shippers).toBeNull();
    expect(shopOnly?.shippersOnline).toBeNull();
    const shipperOnly = parseOpsMap({ ...base, shops: null, shops_without_pin: null });
    expect(shipperOnly?.shops).toBeNull();
  });

  it('refuses anything out of shape instead of half-drawing it', () => {
    expect(parseOpsMap({ ...base, truncated: 'no' })).toBeUndefined();
    expect(parseOpsMap({ ...base, shops: [{ shop_id: 's1', name: 'x', lat: 91, lng: 0 }] })).toBeUndefined();
    expect(parseOpsMap({ ...base, shippers: [{ ...base.shippers[0], freshness: 'LOST' }] })).toBeUndefined();
    expect(parseOpsMap({ ...base, shippers_online: -1 })).toBeUndefined();
    expect(parseOpsMap({ ...base, zones: [{ service_area_id: 'a', name: 'x', status: 'ACTIVE', coverage: { lat: 1, lng: 1, radius_m: 1.5 } }] })).toBeUndefined();
  });

  it('draws nothing when there is nothing to draw, and keeps a circle a circle with north up', () => {
    expect(fitSketch([], [])).toBeUndefined();
    const sketch = fitSketch([{ lat: 22.7, lng: 106.3 }, { lat: 22.6, lng: 106.2 }], [{ lat: 22.65, lng: 106.25, radiusM: 3000 }]);
    expect(sketch).toBeDefined();
    if (sketch === undefined) return;
    const north = sketch.project(22.7, 106.25);
    const south = sketch.project(22.6, 106.25);
    expect(north.y).toBeLessThan(south.y);
    for (const p of [north, south, sketch.project(22.65, 106.3), sketch.project(22.65, 106.2)]) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(SKETCH_SIZE);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(SKETCH_SIZE);
    }
    expect(sketch.scale * 3000).toBeGreaterThan(0);
  });
});
