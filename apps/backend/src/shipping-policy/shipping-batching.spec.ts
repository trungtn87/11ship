import { describe, expect, it } from '@jest/globals';
import { BatchInput, BatchOrder, BatchVerdict, evaluateBatch } from './shipping-batching';

// A line world: a point is a position x on one road and travel time = |a - b| minutes. The matrix is built like the service does it:
// [driver, ...stops] in the order batchStops() lists them (old orders in order, pickup before drop-off, then the candidate's pickup, drop-off).
const P = (x: number) => ({ lat: 22 + x / 1000, lng: 106 });
const at = (h: number, m: number, s = 0) => Date.UTC(2026, 9, 17, h, m, s);
const NOW = at(18, 20);
const PARAMS = { maxDelaySeconds: 300, pickupServiceSeconds: 0, handoffServiceSeconds: 0 };
const minutes = (xs: number[]): number[][] => xs.map((a) => xs.map((b) => Math.abs(a - b) * 60));

/** A on board, drop-off 10 min away, original ETA 18:30 (so alone it arrives exactly on time). */
const A = (eta = at(18, 30)): BatchOrder => ({ orderId: 'A', originalEtaMs: eta, pickedUp: true, pickup: null, dropoff: P(10) });
/** B on board, drop-off 1.5 min behind the driver. */
const B = (eta = at(18, 21, 30)): BatchOrder => ({ orderId: 'B', originalEtaMs: eta, pickedUp: true, pickup: null, dropoff: P(-1.5) });

function run(over: Partial<BatchInput> & { open: BatchOrder[]; candidate: BatchInput['candidate']; xs: number[] }): BatchVerdict {
  const { xs, ...rest } = over;
  return evaluateBatch({ nowMs: NOW, driver: { fresh: true, valid: true }, params: PARAMS, matrix: minutes([0, ...xs]), budget: 100_000, ...rest });
}
const reason = (v: BatchVerdict): string | undefined => (v.feasible ? undefined : v.reason);

describe('M06-C evaluateBatch', () => {
  it('a Shipper with nothing in hand needs no route (a drop-off without GPS is fine)', () => {
    expect(evaluateBatch({ nowMs: NOW, driver: { fresh: false, valid: false }, open: [], candidate: { orderId: 'N', pickup: null, dropoff: null }, params: PARAMS, matrix: undefined, budget: 10 })).toEqual({
      feasible: true,
      applicable: false,
      sequence: [],
      delaysSeconds: {},
    });
  });

  it('A (original ETA 18:30) + B: the fastest plan delays A by 3 minutes, which is inside the 5-minute limit', () => {
    // [Bp, Bd, A] finishes in 13 min and A arrives 18:33; [A, Bp, Bd] would finish in 23.5 min, so the forecast is the first.
    const verdict = run({ open: [A()], candidate: { orderId: 'B', pickup: P(-1.5), dropoff: P(-1.5) }, xs: [10, -1.5, -1.5] });
    expect(verdict).toMatchObject({ feasible: true, applicable: true, delaysSeconds: { A: 180 } });
    expect(verdict.feasible && verdict.sequence).toEqual(['PICKUP:B', 'DROPOFF:B', 'DROPOFF:A']);
  });

  it('then C would make A arrive 18:37 (+7 min against the ORIGINAL 18:30): refused at the second acceptance', () => {
    const second = run({ open: [A(), B()], candidate: { orderId: 'C', pickup: P(-3.5), dropoff: P(-3.5) }, xs: [10, -1.5, -3.5, -3.5] });
    expect(second).toEqual({ feasible: false, reason: 'BATCH_DELAY_EXCEEDED' });
  });

  it('the original ETA is never reset: had A been judged against the already-delayed 18:33 the same plan (A at 18:37) would have passed', () => {
    const wrong = run({ open: [A(at(18, 33)), B()], candidate: { orderId: 'C', pickup: P(-3.5), dropoff: P(-3.5) }, xs: [10, -1.5, -3.5, -3.5] });
    expect(wrong).toMatchObject({ feasible: true, delaysSeconds: { A: 240 } });
  });

  it('the limit is inclusive: exactly 300 s passes, 301 s does not', () => {
    const candidate = { orderId: 'N', pickup: P(-2.5), dropoff: P(-2.5) };
    // [Np, Nd, A]: A arrives after 2.5 + 12.5 = 15 min -> 18:35 -> exactly +300 s against 18:30.
    expect(run({ open: [A()], candidate, xs: [10, -2.5, -2.5] })).toMatchObject({ feasible: true, delaysSeconds: { A: 300 } });
    expect(reason(run({ open: [A(at(18, 29, 59))], candidate, xs: [10, -2.5, -2.5] }))).toBe('BATCH_DELAY_EXCEEDED');
  });

  it('counts the time to take and hand over the goods', () => {
    const candidate = { orderId: 'B', pickup: P(-1.5), dropoff: P(-1.5) };
    const slow = run({ open: [A()], candidate, xs: [10, -1.5, -1.5], params: { maxDelaySeconds: 300, pickupServiceSeconds: 120, handoffServiceSeconds: 60 } });
    // pickup 2 min + hand-over 1 min added before A: +180 s becomes +360 s
    expect(slow).toEqual({ feasible: false, reason: 'BATCH_DELAY_EXCEEDED' });
    expect(run({ open: [A()], candidate, xs: [10, -1.5, -1.5], params: { maxDelaySeconds: 600, pickupServiceSeconds: 120, handoffServiceSeconds: 60 } })).toMatchObject({ feasible: true, delaysSeconds: { A: 360 + 60 } });
  });

  it('always visits a pickup before its own drop-off, even when the drop-off is nearer', () => {
    // The candidate's drop-off (x=1) is right next to the driver but its pickup is at x=-4: the plan must still go to the pickup first.
    const verdict = run({ open: [A(at(18, 59))], candidate: { orderId: 'N', pickup: P(-4), dropoff: P(1) }, xs: [10, -4, 1] });
    expect(verdict.feasible).toBe(true);
    if (verdict.feasible) {
      expect(verdict.sequence.indexOf('PICKUP:N')).toBeLessThan(verdict.sequence.indexOf('DROPOFF:N'));
    }
  });

  it('an order not yet picked up contributes its pickup stop too', () => {
    const notPicked: BatchOrder = { orderId: 'A', originalEtaMs: at(18, 45), pickedUp: false, pickup: P(2), dropoff: P(10) };
    const verdict = run({ open: [notPicked], candidate: { orderId: 'N', pickup: P(3), dropoff: P(4) }, xs: [2, 10, 3, 4] });
    expect(verdict.feasible && verdict.sequence).toEqual(['PICKUP:A', 'PICKUP:N', 'DROPOFF:N', 'DROPOFF:A']);
  });

  it('refuses an old order without an ETA or without coordinates, and a candidate without coordinates', () => {
    const candidate = { orderId: 'N', pickup: P(1), dropoff: P(2) };
    expect(reason(run({ open: [{ ...A(), originalEtaMs: null }], candidate, xs: [10, 1, 2] }))).toBe('BATCH_ORDER_DATA_MISSING');
    expect(reason(run({ open: [{ ...A(), dropoff: null }], candidate, xs: [10, 1, 2] }))).toBe('BATCH_ORDER_DATA_MISSING');
    expect(reason(run({ open: [A()], candidate: { orderId: 'N', pickup: P(1), dropoff: null }, xs: [10, 1, 2] }))).toBe('BATCH_ORDER_DATA_MISSING');
    expect(reason(run({ open: [A()], candidate: { orderId: 'N', pickup: null, dropoff: P(2) }, xs: [10, 1, 2] }))).toBe('BATCH_ORDER_DATA_MISSING');
  });

  it('refuses when the route data or the GPS cannot be trusted (never a straight-line guess)', () => {
    const candidate = { orderId: 'N', pickup: P(1), dropoff: P(2) };
    const okMatrix = minutes([0, 10, 1, 2]);
    expect(reason(evaluateBatch({ nowMs: NOW, driver: { fresh: true, valid: true }, open: [A()], candidate, params: PARAMS, matrix: undefined, budget: 1000 }))).toBe('ROUTE_DATA_UNAVAILABLE');
    const withHole = okMatrix.map((row) => [...row]) as (number | null)[][];
    (withHole[1] as (number | null)[])[2] = null;
    expect(reason(evaluateBatch({ nowMs: NOW, driver: { fresh: true, valid: true }, open: [A()], candidate, params: PARAMS, matrix: withHole, budget: 1000 }))).toBe('ROUTE_DATA_UNAVAILABLE');
    const negative = okMatrix.map((row) => [...row]);
    (negative[0] as number[])[3] = -5;
    expect(reason(evaluateBatch({ nowMs: NOW, driver: { fresh: true, valid: true }, open: [A()], candidate, params: PARAMS, matrix: negative, budget: 1000 }))).toBe('ROUTE_DATA_UNAVAILABLE');
    expect(reason(evaluateBatch({ nowMs: NOW, driver: { fresh: true, valid: true }, open: [A()], candidate, params: PARAMS, matrix: okMatrix.slice(1), budget: 1000 }))).toBe('ROUTE_DATA_UNAVAILABLE');
    expect(reason(run({ open: [A()], candidate, xs: [10, 1, 2], driver: { fresh: false, valid: true } }))).toBe('LOCATION_STALE');
    expect(reason(run({ open: [A()], candidate, xs: [10, 1, 2], driver: { fresh: true, valid: false } }))).toBe('LOCATION_STALE');
  });

  it('has a search budget and refuses (BATCH_BUDGET_EXCEEDED) instead of silently shortening the search or limiting the number of orders', () => {
    const open = [A(), B()];
    const candidate = { orderId: 'C', pickup: P(-3.5), dropoff: P(-3.5) };
    expect(reason(run({ open, candidate, xs: [10, -1.5, -3.5, -3.5], budget: 2 }))).toBe('BATCH_BUDGET_EXCEEDED');
    // A PLATFORM Shipper with many open deliveries is still evaluated (no order-count cap) when the budget allows it.
    const many: BatchOrder[] = Array.from({ length: 6 }, (_, i) => ({ orderId: `O${String(i)}`, originalEtaMs: at(20, 0), pickedUp: true, pickup: null, dropoff: P(i + 1) }));
    const verdict = run({ open: many, candidate: { orderId: 'N', pickup: P(0.5), dropoff: P(7) }, xs: [1, 2, 3, 4, 5, 6, 0.5, 7] });
    expect(verdict).toMatchObject({ feasible: true, applicable: true });
  });
});
