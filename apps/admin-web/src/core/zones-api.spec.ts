import { describe, expect, it } from '@jest/globals';
import { parseImpact, parseZone, parseZoneList, validateCoverage } from './zones-api';

const wire = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  service_area_id: '11111111-1111-4111-8111-111111111111', code: 'CB', name: 'Cao Bằng', status: 'ACTIVE', version: 3,
  coverage: { lat: 22.66, lng: 106.25, radius_m: 10000 }, gps_configured: true, shops_total: 4, shops_public: 3, pins_outside: 1, updated_at: '2026-10-30T00:00:00.000Z', ...over,
});

describe('zones api parsers (issue #253)', () => {
  it('parses an area, with and without geometry ("Chưa cấu hình GPS" is coverage null)', () => {
    expect(parseZone(wire())).toMatchObject({ code: 'CB', coverage: { lat: 22.66, lng: 106.25, radiusM: 10000 }, shopsPublic: 3, pinsOutside: 1, ordersOpen: null });
    expect(parseZone(wire({ coverage: null, orders_open: 2, active_deliveries: 1 }))).toMatchObject({ coverage: null, ordersOpen: 2, activeDeliveries: 1 });
  });

  it('refuses an answer that does not have the documented shape', () => {
    expect(parseZone(wire({ status: 'DELETED' }))).toBeUndefined();
    expect(parseZone(wire({ version: '3' }))).toBeUndefined();
    expect(parseZone(wire({ coverage: { lat: 1, lng: 2 } }))).toBeUndefined();
    expect(parseZoneList({ items: [wire(), wire({ shops_total: -1 })] })).toBeUndefined();
    expect(parseZoneList({ items: [wire()] })).toHaveLength(1);
  });

  it('parses the impact preview', () => {
    const impact = { shops_total: 2, shops_public: 2, pins_outside_current: 0, pins_outside_proposed: 1, public_shops_newly_outside: 1, orders_open: 0, active_deliveries: 1, requires_confirmation: true };
    expect(parseImpact(impact)).toMatchObject({ publicShopsNewlyOutside: 1, requiresConfirmation: true });
    expect(parseImpact({ ...impact, requires_confirmation: 'yes' })).toBeUndefined();
  });

  it('checks coverage with the server bounds', () => {
    expect(validateCoverage(21, 105, 1)).toBeUndefined();
    expect(validateCoverage(21, 105, 100000)).toBeUndefined();
    expect(validateCoverage(91, 105, 10)).toBeDefined();
    expect(validateCoverage(21, 181, 10)).toBeDefined();
    expect(validateCoverage(21, 105, 0)).toBeDefined();
    expect(validateCoverage(21, 105, 100001)).toBeDefined();
    expect(validateCoverage(21, 105, 2.5)).toBeDefined();
  });
});
