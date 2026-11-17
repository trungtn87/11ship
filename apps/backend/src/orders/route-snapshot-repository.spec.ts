import { describe, expect, it } from '@jest/globals';
import { encodePolyline6 } from '../delivery/m14-route-client';
import { parsePlaceBody } from './order-validation';
import { routeSnapshotMatchesLeg, RouteSnapshotRow } from './route-snapshot-repository';

// P6-2 (#294): a quote is re-checked against its snapshot by the exact route answer: version, metres, seconds and road.
const ROAD = encodePolyline6([{ lat: 21.0, lng: 105.82 }, { lat: 21.02, lng: 105.84 }]);
const OTHER_ROAD = encodePolyline6([{ lat: 21.0, lng: 105.82 }, { lat: 21.0, lng: 105.9 }, { lat: 21.02, lng: 105.84 }]);
const row: RouteSnapshotRow = { id: '00000000-0000-4000-8000-000000000001', routeVersion: 'v1', distanceM: 2500, durationS: 420, geometry: ROAD };
const leg = { distanceM: 2500, seconds: 420, geometry: ROAD, routeVersion: 'v1' };

describe('routeSnapshotMatchesLeg', () => {
  it('matches only the same engine version, metres, time and road', () => {
    expect(routeSnapshotMatchesLeg(row, leg)).toBe(true);
    expect(routeSnapshotMatchesLeg(row, { ...leg, distanceM: 2501 })).toBe(false);
    expect(routeSnapshotMatchesLeg(row, { ...leg, seconds: 421 })).toBe(false);
    expect(routeSnapshotMatchesLeg(row, { ...leg, routeVersion: 'v2' })).toBe(false);
  });

  it('a different road with the same metres is a different route (the geometry is part of the quote)', () => {
    expect(routeSnapshotMatchesLeg(row, { ...leg, geometry: OTHER_ROAD })).toBe(false);
  });
});

describe('parsePlaceBody route_snapshot_id', () => {
  const base = {
    client_ref: '00000000-0000-4000-8000-0000000000aa',
    shop_id: '00000000-0000-4000-8000-0000000000bb',
    lines: [{ item_id: '00000000-0000-4000-8000-0000000000cc', quantity: 1, unit_price_vnd: 45000 }],
    recipient_name: 'An',
    recipient_phone: '0912345678',
    address: { address_text: 'x', lat: 21, lng: 105.8 },
    items_total_vnd: 45000,
  };
  const quote = { status: 'PRICED', distance_m: 2500, fee_vnd: 10000, reason: null, policy_version: 1, snapshot: 's' };

  it('reads the snapshot id the customer saw, and treats absence as a client from before snapshots', () => {
    const id = '00000000-0000-4000-8000-0000000000dd';
    expect(parsePlaceBody({ ...base, expected_quote: { ...quote, route_snapshot_id: id } }).expectedQuote?.routeSnapshotId).toBe(id);
    expect(parsePlaceBody({ ...base, expected_quote: quote }).expectedQuote?.routeSnapshotId).toBeNull();
    expect(parsePlaceBody({ ...base, expected_quote: { ...quote, route_snapshot_id: null } }).expectedQuote?.routeSnapshotId).toBeNull();
  });

  it('refuses a snapshot id that is not a canonical UUID', () => {
    expect(() => parsePlaceBody({ ...base, expected_quote: { ...quote, route_snapshot_id: 'not-a-uuid' } })).toThrow();
  });
});
