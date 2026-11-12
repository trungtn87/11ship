import { describe, expect, it } from '@jest/globals';
import { encodePolyline6, M14RouteClient, MATRIX_CONCURRENCY, MAX_MATRIX_LEGS, MAX_SHAPE_CHARS, MAX_SHAPE_POINTS, parseLeg, polyline6PointCount, ZERO_LENGTH_ROUTE_VERSION } from './m14-route-client';

const from = { lat: 22.665, lng: 106.258 };
const to = { lat: 22.682, lng: 106.245 };
const VERSION = 'valhalla-3.9.1/motorcycle-shortest/abc123def456';
const SHAPE = encodePolyline6([from, { lat: 22.67, lng: 106.25 }, to]);
/** An M14 answer as ops/m14/server.py sends it: the engine trip with one leg shape, plus the service's route_version. */
const answer = (length: number, time: number, extra: { shape?: unknown; legs?: unknown; routeVersion?: unknown } = {}) => ({
  trip: { summary: { length, time }, legs: 'legs' in extra ? extra.legs : [{ shape: 'shape' in extra ? extra.shape : SHAPE }] },
  ...('routeVersion' in extra ? (extra.routeVersion === undefined ? {} : { route_version: extra.routeVersion }) : { route_version: VERSION }),
});

describe('M14 route result', () => {
  it('keeps Valhalla kilometres as whole metres, including a valid zero route', () => {
    expect(parseLeg(answer(3.4564, 321.4))).toEqual({ distanceM: 3456, seconds: 321, geometry: SHAPE, routeVersion: VERSION });
    expect(parseLeg(answer(0, 0))).toEqual({ distanceM: 0, seconds: 0, geometry: SHAPE, routeVersion: VERSION });
  });

  it('rejects a bad summary: not a number, NaN/Infinity, negative, or over the length/time ceilings', () => {
    for (const [length, time] of [[null, 2], [2, null], ['2', 2], [Number.NaN, 2], [2, Number.POSITIVE_INFINITY], [-1, 2], [2, -1], [2001, 2], [2, 172_801]]) {
      expect(parseLeg(answer(length as number, time as number))).toBeUndefined();
    }
    expect(parseLeg({ ...answer(1, 1), trip: { legs: [{ shape: SHAPE }] } })).toBeUndefined();
    expect(parseLeg(null)).toBeUndefined();
    expect(parseLeg('x')).toBeUndefined();
    expect(parseLeg({ trip: 1 })).toBeUndefined();
  });

  it('rejects a missing, wrong-typed, empty, or multi-leg shape', () => {
    expect(parseLeg(answer(1, 1, { legs: undefined }))).toBeUndefined();
    expect(parseLeg(answer(1, 1, { legs: [] }))).toBeUndefined();
    expect(parseLeg(answer(1, 1, { legs: [{ shape: SHAPE }, { shape: SHAPE }] }))).toBeUndefined();
    expect(parseLeg(answer(1, 1, { legs: [{}] }))).toBeUndefined();
    expect(parseLeg(answer(1, 1, { shape: 42 }))).toBeUndefined();
    expect(parseLeg(answer(1, 1, { shape: '' }))).toBeUndefined();
  });

  it('rejects a malformed shape: bad characters, truncated value, a single point, coordinates out of range', () => {
    expect(parseLeg(answer(1, 1, { shape: SHAPE + ' ' }))).toBeUndefined();
    expect(parseLeg(answer(1, 1, { shape: SHAPE.slice(0, -1) }))).toBeUndefined();
    expect(parseLeg(answer(1, 1, { shape: SHAPE + '~' }))).toBeUndefined();
    expect(parseLeg(answer(1, 1, { shape: encodePolyline6([from]) }))).toBeUndefined();
    expect(parseLeg(answer(1, 1, { shape: encodePolyline6([{ lat: 95, lng: 106 }, { lat: 96, lng: 106 }]) }))).toBeUndefined();
    expect(parseLeg(answer(1, 1, { shape: encodePolyline6([{ lat: 22, lng: 181 }, { lat: 22, lng: 182 }]) }))).toBeUndefined();
  });

  it('rejects a shape over the point or length ceiling and accepts one exactly at the point ceiling', () => {
    const points = (n: number) => Array.from({ length: n }, (_, i) => ({ lat: 22.6 + (i % 100) * 1e-5, lng: 106.2 + Math.floor(i / 100) * 1e-5 }));
    const atCeiling = encodePolyline6(points(MAX_SHAPE_POINTS));
    expect(polyline6PointCount(atCeiling)).toBe(MAX_SHAPE_POINTS);
    expect(parseLeg(answer(1, 1, { shape: atCeiling }))?.geometry).toBe(atCeiling);
    expect(parseLeg(answer(1, 1, { shape: encodePolyline6(points(MAX_SHAPE_POINTS + 1)) }))).toBeUndefined();
    expect(polyline6PointCount('_'.repeat(MAX_SHAPE_CHARS + 1))).toBeUndefined();
  });

  it('requires a route_version that looks like a version string (no value is invented)', () => {
    for (const routeVersion of [undefined, '', 7, 'has space', 'x'.repeat(129), '-leading']) {
      expect(parseLeg(answer(1, 1, { routeVersion }))).toBeUndefined();
    }
    expect(parseLeg(answer(1, 1, { routeVersion: 'valhalla-3.9.1/motorcycle-default/0' }))?.routeVersion).toBe('valhalla-3.9.1/motorcycle-default/0');
  });

  it('decodes the number of points of an encoded polyline6', () => {
    expect(polyline6PointCount(SHAPE)).toBe(3);
    expect(polyline6PointCount(encodePolyline6([{ lat: -1.5, lng: -179.999999 }, { lat: 0, lng: 0 }]))).toBe(2);
  });

  it('distinguishes missing configuration, timeout, and an invalid response without inventing zero', async () => {
    await expect(new M14RouteClient().routeResult(from, to)).resolves.toEqual({ status: 'UNAVAILABLE', reason: 'ROUTING_NOT_CONFIGURED' });
    const config = { origin: 'https://route.test', timeoutMs: 50 };
    const timeout = new M14RouteClient(config, async () => { throw new DOMException('timed out', 'TimeoutError'); });
    await expect(timeout.routeResult(from, to)).resolves.toEqual({ status: 'UNAVAILABLE', reason: 'ROUTE_TIMEOUT' });
    const invalid = new M14RouteClient(config, async () => ({ ok: true, status: 200, json: async () => answer(null as unknown as number, 2) }));
    await expect(invalid.routeResult(from, to)).resolves.toEqual({ status: 'UNAVAILABLE', reason: 'ROUTE_UNAVAILABLE' });
    await expect(invalid.route(from, to)).resolves.toBeUndefined();
  });

  it('an answer without a shape is UNAVAILABLE and never turned into a straight line', async () => {
    const config = { origin: 'https://route.test', timeoutMs: 50 };
    const noShape = new M14RouteClient(config, async () => ({ ok: true, status: 200, json: async () => ({ trip: { summary: { length: 3, time: 60 } }, route_version: VERSION }) }));
    await expect(noShape.routeResult(from, to)).resolves.toEqual({ status: 'UNAVAILABLE', reason: 'ROUTE_GATEWAY_OUTDATED' });
    await expect(noShape.route(from, to)).resolves.toBeUndefined();
  });

  it('the identical-point leg needs no engine: zero metres, a two-point geometry, and a marker version', async () => {
    let calls = 0;
    const client = new M14RouteClient({ origin: 'https://route.test', timeoutMs: 50 }, async () => { calls += 1; throw new Error('must not be asked'); });
    await expect(client.routeResult(from, from)).resolves.toEqual({ status: 'ROUTE', leg: { distanceM: 0, seconds: 0, geometry: encodePolyline6([from, from]), routeVersion: ZERO_LENGTH_ROUTE_VERSION } });
    expect(calls).toBe(0);
  });

  it('caches only a valid road leg for the same ordered point pair', async () => {
    let calls = 0;
    const client = new M14RouteClient({ origin: 'https://route.test', timeoutMs: 50 }, async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => answer(6.2, 600) };
    });
    const leg = { distanceM: 6200, seconds: 600, geometry: SHAPE, routeVersion: VERSION };
    await expect(client.routeResult(from, to, 1000)).resolves.toEqual({ status: 'ROUTE', leg });
    await expect(client.routeResult(from, to, 2000)).resolves.toEqual({ status: 'ROUTE', leg });
    await expect(client.route(from, to, 3000)).resolves.toEqual(leg);
    expect(calls).toBe(1);
    await client.routeResult(from, to, 1000 + 5 * 60_000 + 1);
    expect(calls).toBe(2);
  });
});

describe('M14 matrix limits (issue #257)', () => {
  const config = { origin: 'https://route.test', timeoutMs: 50 };
  const points = (n: number) => Array.from({ length: n }, (_, i) => ({ lat: 22.6 + i * 0.01, lng: 106.2 + i * 0.01 }));
  const reply = (length: number, routeVersion: string = VERSION) => ({ ok: true, status: 200, json: async () => answer(length, 100, { routeVersion }) });

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
      expect(result.routeVersion).toBe(VERSION);
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

  it('legs from different route versions never form one matrix', async () => {
    let calls = 0;
    const client = new M14RouteClient(config, async () => {
      calls += 1;
      return reply(1, calls === 3 ? 'valhalla-3.9.1/motorcycle-default/abc123def456' : VERSION);
    });
    await expect(client.durations(points(3))).resolves.toEqual({ kind: 'unavailable' });
  });

  it('points at the same place (zero-length legs) still form a matrix and keep the engine version (regression: two deliveries from one shop)', async () => {
    const same = { lat: 22.67, lng: 106.25 };
    const client = new M14RouteClient(config, async () => reply(1));
    const mixed = await client.durations([same, { ...same }, { lat: 22.68, lng: 106.26 }]);
    expect(mixed.kind).toBe('ok');
    if (mixed.kind === 'ok') {
      expect(mixed.routeVersion).toBe(VERSION);
      expect(mixed.seconds[0]?.[1]).toBe(0);
    }
    const allSame = await new M14RouteClient(config, async () => { throw new Error('must not be asked'); }).durations([same, { ...same }]);
    expect(allSame).toMatchObject({ kind: 'ok', routeVersion: ZERO_LENGTH_ROUTE_VERSION });
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

describe('M14 gateway contract: old gateway, version flips, exact endpoints (P6-1 review)', () => {
  const config = { origin: 'https://route.test', timeoutMs: 50 };
  const OTHER_VERSION = 'valhalla-3.9.1/motorcycle-default-0badc0de/abc123def456';
  const replying = (respond: () => unknown) => new M14RouteClient(config, async () => ({ ok: true, status: 200, json: async () => respond() }));

  it('an old gateway (distance and time only) is UNAVAILABLE with its own reason and never a straight line', async () => {
    const client = replying(() => ({ trip: { summary: { length: 3.4, time: 300 } } }));
    await expect(client.routeResult(from, to)).resolves.toEqual({ status: 'UNAVAILABLE', reason: 'ROUTE_GATEWAY_OUTDATED' });
    await expect(client.route(from, to)).resolves.toBeUndefined();
    await expect(client.durations([from, to])).resolves.toEqual({ kind: 'unavailable' });
  });

  it('a gateway that gives a version but no shape is outdated; a broken shape is an ordinary unavailable', async () => {
    await expect(replying(() => answer(3.4, 300, { legs: undefined })).routeResult(from, to)).resolves.toEqual({ status: 'UNAVAILABLE', reason: 'ROUTE_GATEWAY_OUTDATED' });
    await expect(replying(() => answer(3.4, 300, { shape: 'not a polyline ~~' })).routeResult(from, to)).resolves.toEqual({ status: 'UNAVAILABLE', reason: 'ROUTE_UNAVAILABLE' });
  });

  it('a changed route_version clears the cache: after a flip no leg of the earlier profile is served', async () => {
    let version = VERSION;
    let calls = 0;
    const client = new M14RouteClient(config, async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => answer(6.2, 600, { routeVersion: version }) };
    });
    const other = { lat: 22.66, lng: 106.25 };
    await client.routeResult(from, to, 1000);
    await client.routeResult(from, to, 2000);
    expect(calls).toBe(1);
    version = OTHER_VERSION;
    await client.routeResult(other, to, 3000);
    const afterFlip = await client.routeResult(from, to, 4000);
    expect(calls).toBe(3);
    expect(afterFlip).toMatchObject({ status: 'ROUTE', leg: { routeVersion: OTHER_VERSION } });
  });

  it('two endpoints in the same 5-decimal bucket never share a leg: the exact endpoints decide a hit', async () => {
    const near = { lat: 22.665001, lng: 106.258 };
    const nearer = { lat: 22.665004, lng: 106.258 };
    let calls = 0;
    const client = new M14RouteClient(config, async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => answer(calls, 60) };
    });
    const first = await client.routeResult(near, to, 1000);
    const second = await client.routeResult(nearer, to, 2000);
    expect(calls).toBe(2);
    expect(first).toMatchObject({ status: 'ROUTE', leg: { distanceM: 1000 } });
    expect(second).toMatchObject({ status: 'ROUTE', leg: { distanceM: 2000 } });
  });
});

describe('M14 request race (P6-1 review round 2, SỬA-5)', () => {
  type Reply = { ok: boolean; status: number; json(): Promise<unknown> };
  const config = { origin: 'https://route.test', timeoutMs: 50 };
  const OTHER_VERSION = 'valhalla-3.9.1/motorcycle-default-0badc0de/abc123def456';
  const p1 = { lat: 22.66, lng: 106.25 };
  const p2 = { lat: 22.67, lng: 106.26 };
  const p3 = { lat: 22.61, lng: 106.21 };
  const p4 = { lat: 22.62, lng: 106.22 };
  const reply = (routeVersion: string): Reply => ({ ok: true, status: 200, json: async () => answer(6.2, 600, { routeVersion }) });

  it('a request sent earlier that answers after a newer generation never replaces it: no old version in cache, served version or matrix', async () => {
    const waiting: Array<(value: Reply) => void> = [];
    const client = new M14RouteClient(config, () => new Promise<Reply>((resolve) => { waiting.push(resolve); }));

    const earlier = client.routeResult(p1, p2, 1000); // sent first, answered last
    const newer = client.routeResult(p3, p4, 1000); // sent second, answered first
    expect(waiting).toHaveLength(2);

    waiting[1]?.(reply(OTHER_VERSION));
    await expect(newer).resolves.toMatchObject({ status: 'ROUTE', leg: { routeVersion: OTHER_VERSION } });

    waiting[0]?.(reply(VERSION));
    // The late caller still gets the leg it asked for (its own answer), so nothing is lost for that caller.
    await expect(earlier).resolves.toMatchObject({ status: 'ROUTE', leg: { routeVersion: VERSION } });

    // Not cached: the older pair is asked again, not served from the late answer.
    const again = client.routeResult(p1, p2, 1500);
    expect(waiting).toHaveLength(3);
    waiting[2]?.(reply(OTHER_VERSION));
    await expect(again).resolves.toMatchObject({ status: 'ROUTE', leg: { routeVersion: OTHER_VERSION } });

    // The newer generation was not cleared by the late answer: its pair is still a cache hit (no request).
    const hit = client.routeResult(p3, p4, 1600);
    expect(waiting).toHaveLength(3);
    await expect(hit).resolves.toMatchObject({ status: 'ROUTE', leg: { routeVersion: OTHER_VERSION } });

    // A matrix after the race is built from the newer version only, never mixed with the old one.
    const matrix = client.durations([p1, p2]);
    expect(waiting).toHaveLength(5);
    waiting[3]?.(reply(OTHER_VERSION));
    waiting[4]?.(reply(OTHER_VERSION));
    await expect(matrix).resolves.toMatchObject({ kind: 'ok', routeVersion: OTHER_VERSION });
  });
});
