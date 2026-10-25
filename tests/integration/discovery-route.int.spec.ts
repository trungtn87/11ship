import http from 'node:http';
import { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { M14_ROUTING } from '../../apps/backend/src/delivery/m14-route-client';
import { haversineMeters } from '../../apps/backend/src/shipping-policy/shipping-eligibility';
import { AuthApp, dataOf, startAuthApp } from './support/auth-fixtures';
import { createCategory } from './support/menu-fixtures';
import { completeSetup, createShopOwner, ShopOwner } from './support/shop-management-fixtures';

// Issue #190, section 6 — the road distance on the shop cards: from the customer's position to the PICKUP point of each public shop, by the M14 routing
// service (here a stand-in that answers a fixed road length, longer than any straight line), through the real Nest pipeline.
describe('issue #190 — POST /v1/discovery/route-distances', () => {
  let app: AuthApp;
  let router: http.Server;
  let hits: unknown[] = [];
  let reachable = true;
  let group: string;
  const ROAD_KM = 11.2;

  beforeAll(async () => {
    router = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        hits.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        response.setHeader('content-type', 'application/json');
        if (!reachable) {
          response.statusCode = 400;
          response.end(JSON.stringify({ error_code: 442 }));
          return;
        }
        response.end(JSON.stringify({ trip: { summary: { length: ROAD_KM, time: 1200 } } }));
      });
    });
    await new Promise<void>((resolve) => router.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(router.address() as AddressInfo).port}`;
    app = await startAuthApp({}, { overrides: [{ provide: M14_ROUTING, useValue: { origin, timeoutMs: 3000 } }] });
    group = await createCategory(app.pool, 'Nhóm đường đi 190', 'ACTIVE', 1);
  });

  afterAll(async () => {
    await app.close();
    await new Promise<void>((resolve) => router.close(() => resolve()));
  });

  const ask = (body: unknown) => app.call('POST', '/discovery/route-distances', { body });
  const entries = (response: Awaited<ReturnType<typeof ask>>) => dataOf(response).distances as { shop_id: string; status: string; distance_m: number | null }[];

  async function publicShop(): Promise<ShopOwner> {
    const owner = await createShopOwner(app);
    await completeSetup(app, owner, { categoryId: group });
    return owner;
  }

  it('answers the ROAD length from the customer position to the shop pickup point, not a straight line, and not the leg an order is priced with', async () => {
    hits = [];
    const shop = await publicShop();
    const origin = { lat: 21.05, lng: 105.85 };
    const response = await ask({ origin, shop_ids: [shop.shopId] });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(entries(response)).toEqual([{ shop_id: shop.shopId, status: 'ROUTE', distance_m: Math.round(ROAD_KM * 1000) }]);
    // The fixture's road is not the straight line: this is what proves the number is a route and not Haversine.
    const straight = haversineMeters(origin, { lat: 21.0, lng: 105.8 });
    expect(Math.abs(straight - ROAD_KM * 1000)).toBeGreaterThan(2000);
    // The routing service was asked customer -> pickup (two points, pickup from the server's own row).
    expect(hits).toEqual([{ locations: [{ lat: 21.05, lon: 105.85 }, { lat: 21, lon: 105.8 }] }]);
  });

  it('a repeated question with the same position is answered from the short cache: no new routing call', async () => {
    const shop = await publicShop();
    const body = { origin: { lat: 21.0501, lng: 105.8501 }, shop_ids: [shop.shopId] };
    await ask(body);
    hits = [];
    expect(entries(await ask(body))[0]).toMatchObject({ status: 'ROUTE' });
    expect(entries(await ask({ origin: { lat: 21.05011, lng: 105.85011 }, shop_ids: [shop.shopId] }))[0]).toMatchObject({ status: 'ROUTE' });
    expect(hits).toHaveLength(0);
  });

  it('a shop that is not public (not set up, unknown) gets no distance and no routing call; the others still do', async () => {
    const shop = await publicShop();
    const bare = await createShopOwner(app);
    hits = [];
    const response = await ask({ origin: { lat: 21.06, lng: 105.86 }, shop_ids: [bare.shopId, shop.shopId, '99999999-9999-4999-8999-999999999999'] });
    expect(entries(response)).toEqual([
      { shop_id: bare.shopId, status: 'UNAVAILABLE', distance_m: null },
      { shop_id: shop.shopId, status: 'ROUTE', distance_m: 11200 },
      { shop_id: '99999999-9999-4999-8999-999999999999', status: 'UNAVAILABLE', distance_m: null },
    ]);
    expect(hits).toHaveLength(1);
    expect(response.text).not.toMatch(/pickup|lat|lng/);
  });

  it('a point with no road is UNAVAILABLE, never 0 and never the straight line', async () => {
    const shop = await publicShop();
    reachable = false;
    try {
      const response = await ask({ origin: { lat: 21.07, lng: 105.87 }, shop_ids: [shop.shopId] });
      expect(response.status).toBe(200);
      expect(entries(response)).toEqual([{ shop_id: shop.shopId, status: 'UNAVAILABLE', distance_m: null }]);
    } finally {
      reachable = true;
    }
  });

  it('refuses a malformed body and a session is not needed', async () => {
    expect((await ask({ origin: { lat: 21, lng: 105 }, shop_ids: [] })).status).toBe(400);
    expect((await ask({ origin: { lat: 99, lng: 105 }, shop_ids: ['99999999-9999-4999-8999-999999999999'] })).status).toBe(400);
    expect((await ask({ origin: { lat: 21, lng: 105 }, shop_ids: ['x'] })).status).toBe(400);
    expect((await ask('nope')).status).toBe(400);
  });
});
