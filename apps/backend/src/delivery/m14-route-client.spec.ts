import { describe, expect, it } from '@jest/globals';
import { M14RouteClient, MATRIX_CONCURRENCY, MAX_MATRIX_LEGS, parseLeg } from './m14-route-client';

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

describe('M14 matrix limits (issue #257)', () => {
  const config = { origin: 'https://route.test', timeoutMs: 50 };
  const points = (n: number) => Array.from({ length: n }, (_, i) => ({ lat: 22.6 + i * 0.01, lng: 106.2 + i * 0.01 }));
  const reply = (length: number) => ({ ok: true, status: 200, json: async () => ({ trip: { summary: { length, time: 100 } } }) });

  it('exactly 20 legs (5 points) are computed with bounded concurrency and a full matrix', async () => {
    let inFlight = 0;
    let peak = 0;
    let calls = 0;
    const client = new M14RouteClient(config, async () => {
      calls += 1;
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return reply(1 + calls / 1000);
    });
    const result = await client.durations(points(5));
    expect(result.kind).toBe('ok');
    expect(calls).toBe(MAX_MATRIX_LEGS);
    expect(peak).toBeLessThanOrEqual(MATRIX_CONCURRENCY);
    expect(peak).toBeGreaterThan(1);
    if (result.kind === 'ok') {
      expect(result.seconds).toHaveLength(5);
      expect(result.seconds[0]?.[0]).toBe(0);
      expect(result.seconds.flat().filter((v) => v === 100)).toHaveLength(MAX_MATRIX_LEGS);
    }
  });

  it('more than the limit (6 points = 30 legs) fails closed and asks the routing service nothing', async () => {
    let calls = 0;
    const client = new M14RouteClient(config, async () => {
      calls += 1;
      return reply(1);
    });
    await expect(client.durations(points(6))).resolves.toEqual({ kind: 'unavailable' });
    expect(calls).toBe(0);
  });

  it('one missing leg makes the whole matrix unavailable, stops asking for more, and invents nothing', async () => {
    let calls = 0;
    const client = new M14RouteClient(config, async () => {
      calls += 1;
      if (calls === 2) {
        throw new DOMException('timed out', 'TimeoutError');
      }
      return reply(1);
    });
    await expect(client.durations(points(5))).resolves.toEqual({ kind: 'unavailable' });
    expect(calls).toBeLessThan(MAX_MATRIX_LEGS);
  });
});
