import { describe, expect, it } from '@jest/globals';
import { M14RouteClient, parseLeg } from './m14-route-client';

const from = { lat: 22.665, lng: 106.258 };
const to = { lat: 22.682, lng: 106.245 };

describe('M14 route result', () => {
  it('keeps Valhalla kilometres as whole metres, including a valid zero route', () => {
    expect(parseLeg({ trip: { summary: { length: 3.4564, time: 321.4 } } })).toEqual({ distanceM: 3456, seconds: 321 });
    expect(parseLeg({ trip: { summary: { length: 0, time: 0 } } })).toEqual({ distanceM: 0, seconds: 0 });
  });

  it('distinguishes missing configuration, timeout, and an invalid response without inventing zero', async () => {
    await expect(new M14RouteClient().routeResult(from, to)).resolves.toEqual({ status: 'UNAVAILABLE', reason: 'ROUTING_NOT_CONFIGURED' });
    const config = { origin: 'https://route.test', timeoutMs: 50 };
    const timeout = new M14RouteClient(config, async () => { throw new DOMException('timed out', 'TimeoutError'); });
    await expect(timeout.routeResult(from, to)).resolves.toEqual({ status: 'UNAVAILABLE', reason: 'ROUTE_TIMEOUT' });
    const invalid = new M14RouteClient(config, async () => ({ ok: true, status: 200, json: async () => ({ trip: { summary: { length: null, time: 2 } } }) }));
    await expect(invalid.routeResult(from, to)).resolves.toEqual({ status: 'UNAVAILABLE', reason: 'ROUTE_UNAVAILABLE' });
    await expect(invalid.route(from, to)).resolves.toBeUndefined();
  });

  it('caches only a valid road leg for the same ordered point pair', async () => {
    let calls = 0;
    const client = new M14RouteClient({ origin: 'https://route.test', timeoutMs: 50 }, async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => ({ trip: { summary: { length: 6.2, time: 600 } } }) };
    });
    await expect(client.routeResult(from, to, 1000)).resolves.toEqual({ status: 'ROUTE', leg: { distanceM: 6200, seconds: 600 } });
    await expect(client.routeResult(from, to, 2000)).resolves.toEqual({ status: 'ROUTE', leg: { distanceM: 6200, seconds: 600 } });
    expect(calls).toBe(1);
  });
});
