import { describe, expect, it } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { M14RouteClient } from '../delivery/m14-route-client';
import { ShopSnapshot } from '../shop/shop-availability-reader';
import { gateOf } from '../shop-setup/shop-setup-gate';
import { TransactionContext } from '../transaction/transaction-context';
import { DiscoveryRouteService, MAX_CONCURRENT_ROUTES } from './discovery-route-service';
import { parseRouteDistancesBody } from './discovery-route-validation';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

describe('route distances: strict body', () => {
  it('accepts an origin and 1-20 distinct shop ids, and rounds the position to ~11 m', () => {
    expect(parseRouteDistancesBody({ origin: { lat: 22.666612, lng: 106.257799 }, shop_ids: [A, B] })).toEqual({ origin: { lat: 22.6666, lng: 106.2578 }, shopIds: [A, B] });
  });

  it.each([
    [null],
    [[]],
    [{ origin: { lat: 22, lng: 106 } }],
    [{ origin: { lat: 22, lng: 106 }, shop_ids: [] }],
    [{ origin: { lat: 22, lng: 106 }, shop_ids: [A, A] }],
    [{ origin: { lat: 22, lng: 106 }, shop_ids: ['nope'] }],
    [{ origin: { lat: 22, lng: 106 }, shop_ids: Array.from({ length: 21 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`) }],
    [{ origin: { lat: 91, lng: 106 }, shop_ids: [A] }],
    [{ origin: { lat: 22, lng: 181 }, shop_ids: [A] }],
    [{ origin: { lat: '22', lng: 106 }, shop_ids: [A] }],
    [{ origin: { lat: Number.NaN, lng: 106 }, shop_ids: [A] }],
    [{ origin: { lat: 22, lng: 106, accuracy: 5 }, shop_ids: [A] }],
    [{ origin: { lat: 22, lng: 106 }, shop_ids: [A], user_id: B }],
  ])('refuses %j', (body) => {
    expect(() => parseRouteDistancesBody(body)).toThrow(BadRequestException);
  });
});

function snapshotOf(shopId: string, over: Partial<ShopSnapshot> = {}): ShopSnapshot {
  return {
    shopId,
    name: 'Quán',
    contactPhoneNormalized: '+84900000001',
    zalo: null,
    facebook: null,
    addressText: 'Địa chỉ',
    pickupLat: 22.66,
    pickupLng: 106.25,
    serviceAreaId: A,
    status: 'ACTIVE',
    version: 2,
    hours: [{ weekday: 1, startMinute: 0, endMinute: 1440, endDayOffset: 0 }] as unknown as ShopSnapshot['hours'],
    availability: { online: true, reason: 'ONLINE', evaluatedAt: '2026-10-25T01:00:00.000Z' },
    hasPickupPoint: true,
    activatedAt: null,
    setupRequest: null,
    ownerLocked: false,
    areaStatus: 'ACTIVE',
    ...over,
  };
}

function service(options: { shops: Record<string, ShopSnapshot>; routes: Pick<M14RouteClient, 'available' | 'route'> }): DiscoveryRouteService {
  const transactions = { withTransaction: async <T>(work: (context: TransactionContext) => Promise<T>): Promise<T> => work({} as TransactionContext) };
  const reader = { snapshotOfShop: async (_c: unknown, id: string) => options.shops[id] };
  const gate = { evaluate: async (_c: unknown, snapshot: ShopSnapshot) => gateOf(snapshot, true) };
  return new DiscoveryRouteService(transactions as never, reader as never, gate as never, options.routes as unknown as M14RouteClient);
}

describe('DiscoveryRouteService', () => {
  const origin = { lat: 22.6666, lng: 106.2578 };

  it('routes from the customer position to the PICKUP point of each public shop (never the delivery leg), in request order', async () => {
    const asked: unknown[] = [];
    const routes = {
      available: true,
      route: async (from: unknown, to: unknown) => {
        asked.push([from, to]);
        return { distanceM: 3400, seconds: 600 };
      },
    };
    const result = await service({ shops: { [A]: snapshotOf(A) }, routes }).distances({ origin, shopIds: [A] });
    expect(result).toEqual({ routing_available: true, distances: [{ shop_id: A, status: 'ROUTE', distance_m: 3400 }] });
    expect(asked).toEqual([[origin, { lat: 22.66, lng: 106.25 }]]);
  });

  it('a shop that is not public, unknown or has no point is UNAVAILABLE without a routing call, and a failed route is UNAVAILABLE (no straight line, no zero)', async () => {
    let calls = 0;
    const routes = { available: true, route: async () => { calls += 1; return undefined; } };
    const shops = {
      [A]: snapshotOf(A),
      [B]: snapshotOf(B, { status: 'DISABLED', availability: { online: false, reason: 'SHOP_DISABLED', evaluatedAt: '2026-10-25T01:00:00.000Z' } }),
    };
    const result = await service({ shops, routes }).distances({ origin, shopIds: [A, B, C] });
    expect(result.distances).toEqual([
      { shop_id: A, status: 'UNAVAILABLE', distance_m: null },
      { shop_id: B, status: 'UNAVAILABLE', distance_m: null },
      { shop_id: C, status: 'UNAVAILABLE', distance_m: null },
    ]);
    expect(calls).toBe(1);
  });

  it('without a routing service nothing is invented', async () => {
    const result = await service({ shops: { [A]: snapshotOf(A) }, routes: { available: false, route: async () => ({ distanceM: 1, seconds: 1 }) } }).distances({ origin, shopIds: [A] });
    expect(result).toEqual({ routing_available: false, distances: [{ shop_id: A, status: 'UNAVAILABLE', distance_m: null }] });
  });

  it('never has more routes in flight than the limit, even across requests, and still answers all of them', async () => {
    let inFlight = 0;
    let peak = 0;
    const routes = {
      available: true,
      route: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return { distanceM: 1000, seconds: 100 };
      },
    };
    const ids = Array.from({ length: 12 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`);
    const shops = Object.fromEntries(ids.map((id) => [id, snapshotOf(id)]));
    const subject = service({ shops, routes });
    const [one, two] = await Promise.all([subject.distances({ origin, shopIds: ids }), subject.distances({ origin, shopIds: ids.slice(0, 6) })]);
    expect(peak).toBeLessThanOrEqual(MAX_CONCURRENT_ROUTES);
    expect(one.distances.every((entry) => entry.status === 'ROUTE')).toBe(true);
    expect(two.distances.every((entry) => entry.status === 'ROUTE')).toBe(true);
  });
});
