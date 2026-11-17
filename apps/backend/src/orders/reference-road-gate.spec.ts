import { describe, expect, it } from '@jest/globals';
import { encodePolyline6, Fetcher, M14RouteClient } from '../delivery/m14-route-client';
import { LatLng } from '../shipping-policy/shipping-eligibility';
import { MAX_CONCURRENT_REFERENCE_ROUTES, MAX_QUEUED_REFERENCE_ROUTES, ReferenceRoadGate, REFERENCE_COOLDOWN_MS } from './reference-road-gate';

// P6-8b review fix (#294): the reference road gate. A real M14RouteClient is used with a fake fetcher, so the 429 and timeout cases go through the
// client's own error mapping. Nothing here logs or stores coordinates.

const CONFIG = { origin: 'http://m14.test', timeoutMs: 5000 };
const A: LatLng = { lat: 10.7769, lng: 106.7009 };
const B: LatLng = { lat: 10.7829, lng: 106.6957 };

const okBody = (): unknown => ({
  route_version: 'valhalla-test/1',
  trip: { summary: { length: 2.5, time: 420 }, legs: [{ shape: encodePolyline6([A, B]) }] },
});

interface CountingFetcher {
  readonly fetcher: Fetcher;
  /** The starting latitude of every call, in call order (no coordinates are logged; this is test-only state). */
  readonly calls: number[];
  /** Opens the gate: every held call resolves, and later calls answer at once. */
  release(): void;
}

type Plan = { ok: boolean; status: number } | "timeout" | "hold";

/** A fetcher whose answer is chosen by the request's starting latitude; "hold" calls wait until release(). */
function countingFetcher(answer: (startLat: number) => Plan): CountingFetcher {
  const calls: number[] = [];
  const waiters: (() => void)[] = [];
  let open = false;
  const fetcher: Fetcher = async (_url, init) => {
    const body = JSON.parse(String(init.body)) as { locations: { lat: number }[] };
    const startLat = body.locations[0]?.lat ?? 0;
    calls.push(startLat);
    const plan = answer(startLat);
    if (plan === "timeout") {
      const error = new Error("timeout");
      error.name = "TimeoutError";
      throw error;
    }
    if (plan === "hold" && !open) {
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
    if (plan === "hold" || (plan as { ok: boolean }).ok) {
      return { ok: true, status: 200, json: async () => okBody() };
    }
    return { ok: false, status: (plan as { status: number }).status, json: async () => ({}) };
  };
  return {
    fetcher,
    calls,
    release: () => {
      open = true;
      for (const resolve of waiters.splice(0)) resolve();
    },
  };
}

/** Distinct legs: each one a different starting point, so none shares a single-flight entry or a cooldown. */
const leg = (i: number): { from: LatLng; to: LatLng } => ({ from: { lat: 10.7 + i * 0.001, lng: 106.7 }, to: B });

describe('P6-8b reference road gate: single-flight, bounded, with a negative cooldown', () => {
  it('concurrent asks for the same leg share ONE M14 call, and every caller gets the road', async () => {
    const counting = countingFetcher(() => 'hold');
    const gate = new ReferenceRoadGate(new M14RouteClient(CONFIG, counting.fetcher));
    const asks = Array.from({ length: 5 }, () => gate.route(A, B));
    counting.release();
    const legs = await Promise.all(asks);
    expect(counting.calls).toHaveLength(1);
    for (const result of legs) {
      expect(result?.distanceM).toBe(2500);
    }
  });

  it('a no-route answer is NOT asked again inside the cooldown, and is asked again after it', async () => {
    const counting = countingFetcher(() => ({ ok: false, status: 500 }));
    const gate = new ReferenceRoadGate(new M14RouteClient(CONFIG, counting.fetcher));
    const now = 1_000_000;
    expect(await gate.route(A, B, now)).toBeUndefined();
    expect(await gate.route(A, B, now + 1_000)).toBeUndefined();
    expect(counting.calls).toHaveLength(1);
    expect(await gate.route(A, B, now + REFERENCE_COOLDOWN_MS + 1)).toBeUndefined();
    expect(counting.calls).toHaveLength(2);
  });

  it('a 429 from M14 starts the same cooldown: not asked again while it lasts', async () => {
    const counting = countingFetcher(() => ({ ok: false, status: 429 }));
    const gate = new ReferenceRoadGate(new M14RouteClient(CONFIG, counting.fetcher));
    const now = 2_000_000;
    expect(await gate.route(A, B, now)).toBeUndefined();
    expect(await gate.route(A, B, now + 10)).toBeUndefined();
    expect(counting.calls).toHaveLength(1);
  });

  it('a timeout starts the same cooldown: not asked again while it lasts', async () => {
    const counting = countingFetcher(() => 'timeout');
    const gate = new ReferenceRoadGate(new M14RouteClient(CONFIG, counting.fetcher));
    const now = 3_000_000;
    expect(await gate.route(A, B, now)).toBeUndefined();
    expect(await gate.route(A, B, now + 10)).toBeUndefined();
    expect(counting.calls).toHaveLength(1);
  });

  it('a full gate answers null at once and calls M14 for nothing more', async () => {
    const counting = countingFetcher(() => 'hold');
    const gate = new ReferenceRoadGate(new M14RouteClient(CONFIG, counting.fetcher));
    const pending: Promise<unknown>[] = [];
    // The running slots and the queue, all distinct legs (no single-flight sharing).
    for (let i = 0; i < MAX_CONCURRENT_REFERENCE_ROUTES + MAX_QUEUED_REFERENCE_ROUTES; i += 1) {
      const { from, to } = leg(i);
      pending.push(gate.route(from, to));
    }
    // Only the running slots have reached M14 so far.
    expect(counting.calls).toHaveLength(MAX_CONCURRENT_REFERENCE_ROUTES);
    const { from, to } = leg(999);
    expect(await gate.route(from, to)).toBeUndefined();
    expect(counting.calls).toHaveLength(MAX_CONCURRENT_REFERENCE_ROUTES);
    counting.release();
    await Promise.all(pending);
  });

  it('quote and discovery routes are NOT queued behind a saturated reference gate', async () => {
    const counting = countingFetcher((startLat) => (startLat === 10.5 ? { ok: true, status: 200 } : 'hold'));
    const client = new M14RouteClient(CONFIG, counting.fetcher);
    const gate = new ReferenceRoadGate(client);
    const pending: Promise<unknown>[] = [];
    for (let i = 0; i < MAX_CONCURRENT_REFERENCE_ROUTES + MAX_QUEUED_REFERENCE_ROUTES; i += 1) {
      const { from, to } = leg(i);
      pending.push(gate.route(from, to));
    }
    // The gate is saturated. A quote (the client directly, as checkout and discovery call it) still reaches M14 at once.
    const quote = client.route({ lat: 10.5, lng: 106.5 }, B);
    expect(counting.calls).toHaveLength(MAX_CONCURRENT_REFERENCE_ROUTES + 1);
    expect(counting.calls[counting.calls.length - 1]).toBe(10.5);
    expect((await quote)?.distanceM).toBe(2500);
    counting.release();
    await Promise.all(pending);
  });
});
