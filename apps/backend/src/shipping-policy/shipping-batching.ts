import { isValidPoint, LatLng } from './shipping-eligibility';

// M06-C: may this delivery be added to the work the Shipper already has? Pure rules over a time matrix that M14 supplies.
//
// The protection: every delivery the Shipper already accepted keeps its ORIGINAL ETA (stored once by M07, never reset). A new delivery may
// delay each of them by at most `maxDelaySeconds` IN TOTAL against that original ETA, so a first +3 min followed by a second +7 min is refused at
// the second (the second is compared with the original, not with the already-delayed one).
//
// The forecast route used for that check is the plan that finishes ALL remaining stops soonest (every pickup before its own drop-off, the time
// to take and hand over the goods counted; ties go to the plan that delays the old deliveries least). Checking "some order exists" would be
// empty, since the old deliveries can always be served first. The forecast is only an evaluation at the moment of acceptance: the Shipper still
// chooses the real order of delivery and nothing here forces a direction or changes an ETA.
//
// ASSUMPTION to confirm with the Owner: "forecast route = fastest complete plan". The approved text fixes the limit and the examples
// (A 18:30 -> 18:33 allowed -> 18:37 refused), not the planner.

export type BatchReason = 'LOCATION_STALE' | 'ROUTE_DATA_UNAVAILABLE' | 'BATCH_ORDER_DATA_MISSING' | 'BATCH_DELAY_EXCEEDED' | 'BATCH_BUDGET_EXCEEDED';

export interface BatchOrder {
  readonly orderId: string;
  /** Original ETA of the drop-off (completion of the hand-over), epoch ms. Required for an order already accepted. */
  readonly originalEtaMs: number | null;
  /** True when the goods are already on board: only the drop-off remains. */
  readonly pickedUp: boolean;
  readonly pickup: LatLng | null;
  readonly dropoff: LatLng | null;
}

export interface CandidateOrder {
  readonly orderId: string;
  readonly pickup: LatLng | null;
  readonly dropoff: LatLng | null;
}

export interface BatchParams {
  readonly maxDelaySeconds: number;
  readonly pickupServiceSeconds: number;
  readonly handoffServiceSeconds: number;
}

export interface BatchStop {
  readonly orderId: string;
  readonly kind: 'PICKUP' | 'DROPOFF';
  readonly point: LatLng;
}

/** The points, in a fixed order, for which M14 must give a duration matrix: the Shipper first, then every remaining stop. */
export function batchStops(open: readonly BatchOrder[], candidate: CandidateOrder): BatchStop[] | undefined {
  const stops: BatchStop[] = [];
  for (const order of open) {
    if (!order.pickedUp) {
      if (!isValidPoint(order.pickup)) {
        return undefined;
      }
      stops.push({ orderId: order.orderId, kind: 'PICKUP', point: order.pickup });
    }
    if (!isValidPoint(order.dropoff)) {
      return undefined;
    }
    stops.push({ orderId: order.orderId, kind: 'DROPOFF', point: order.dropoff });
  }
  if (!isValidPoint(candidate.pickup) || !isValidPoint(candidate.dropoff)) {
    return undefined;
  }
  stops.push({ orderId: candidate.orderId, kind: 'PICKUP', point: candidate.pickup }, { orderId: candidate.orderId, kind: 'DROPOFF', point: candidate.dropoff });
  return stops;
}

export interface BatchInput {
  readonly nowMs: number;
  readonly driver: { readonly fresh: boolean; readonly valid: boolean };
  readonly open: readonly BatchOrder[];
  readonly candidate: CandidateOrder;
  readonly params: BatchParams;
  /**
   * seconds[i][j] = travel time from point i to point j, over [driver, ...batchStops(open, candidate)] in that order; null/NaN/negative or a
   * missing matrix means M14 could not compute it. Never a straight-line guess.
   */
  readonly matrix: readonly (readonly (number | null)[])[] | undefined;
  /** Upper bound of search steps; exceeding it is a refusal, never a silent shortcut. */
  readonly budget: number;
}

export type BatchVerdict =
  | { readonly feasible: true; readonly applicable: boolean; readonly sequence: readonly string[]; readonly delaysSeconds: Readonly<Record<string, number>> }
  | { readonly feasible: false; readonly reason: BatchReason };

export const DEFAULT_BATCH_BUDGET = 100_000;

export function evaluateBatch(input: BatchInput): BatchVerdict {
  const { open, candidate, params } = input;
  // A Shipper with nothing in hand: nothing to protect, so no route is needed (they may take an order whose drop-off has no GPS yet).
  if (open.length === 0) {
    return { feasible: true, applicable: false, sequence: [], delaysSeconds: {} };
  }
  if (!input.driver.valid || !input.driver.fresh) {
    return { feasible: false, reason: 'LOCATION_STALE' };
  }
  if (open.some((order) => order.originalEtaMs === null || !Number.isFinite(order.originalEtaMs))) {
    return { feasible: false, reason: 'BATCH_ORDER_DATA_MISSING' };
  }
  const stops = batchStops(open, candidate);
  if (stops === undefined) {
    return { feasible: false, reason: 'BATCH_ORDER_DATA_MISSING' };
  }
  const n = stops.length + 1;
  const matrix = input.matrix;
  if (matrix === undefined || matrix.length !== n || matrix.some((row) => row.length !== n)) {
    return { feasible: false, reason: 'ROUTE_DATA_UNAVAILABLE' };
  }
  const seconds = (i: number, j: number): number => (matrix[i] as readonly (number | null)[])[j] as number;
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      const value = (matrix[i] as readonly (number | null)[])[j];
      if (i !== j && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
        return { feasible: false, reason: 'ROUTE_DATA_UNAVAILABLE' };
      }
    }
  }

  const limitMs = params.maxDelaySeconds * 1000;
  const originalEta = new Map(open.map((order) => [order.orderId, order.originalEtaMs as number]));
  // Stop k (0-based) is matrix node k + 1. A drop-off may only follow its own pickup; a picked-up order has no pickup stop.
  const pickupIndexOf = new Map<string, number>();
  stops.forEach((stop, k) => {
    if (stop.kind === 'PICKUP') {
      pickupIndexOf.set(stop.orderId, k);
    }
  });
  const total = stops.length;
  if (total > 30) {
    return { feasible: false, reason: 'BATCH_BUDGET_EXCEEDED' };
  }
  const allDone = (1 << total) - 1;
  let steps = 0;
  let exhausted = false;
  const path: number[] = [];
  const delays: Record<string, number> = {};
  let best: { makespanMs: number; worstDelayMs: number; path: number[]; delays: Record<string, number> } | undefined;

  const dfs = (node: number, done: number, timeMs: number, worstDelayMs: number): void => {
    if (done === allDone) {
      if (best === undefined || timeMs < best.makespanMs || (timeMs === best.makespanMs && worstDelayMs < best.worstDelayMs)) {
        best = { makespanMs: timeMs, worstDelayMs, path: [...path], delays: { ...delays } };
      }
      return;
    }
    const choices: Array<{ k: number; travel: number }> = [];
    for (let k = 0; k < total; k += 1) {
      if ((done & (1 << k)) !== 0) {
        continue;
      }
      const stop = stops[k] as BatchStop;
      if (stop.kind === 'DROPOFF') {
        const pickup = pickupIndexOf.get(stop.orderId);
        if (pickup !== undefined && (done & (1 << pickup)) === 0) {
          continue; // a drop-off never precedes its own pickup
        }
      }
      choices.push({ k, travel: node === k + 1 ? 0 : seconds(node, k + 1) });
    }
    choices.sort((a, b) => a.travel - b.travel || a.k - b.k);
    for (const { k, travel } of choices) {
      steps += 1;
      if (steps > input.budget) {
        exhausted = true;
        return;
      }
      const stop = stops[k] as BatchStop;
      const finish = timeMs + travel * 1000 + (stop.kind === 'PICKUP' ? params.pickupServiceSeconds : params.handoffServiceSeconds) * 1000;
      if (best !== undefined && finish > best.makespanMs) {
        continue; // time only grows along a path: it cannot beat the best plan found
      }
      let worst = worstDelayMs;
      const isOld = stop.kind === 'DROPOFF' && originalEta.has(stop.orderId);
      if (isOld) {
        const delay = finish - (originalEta.get(stop.orderId) as number);
        worst = Math.max(worst, delay);
        delays[stop.orderId] = Math.round(delay / 1000);
      }
      path.push(k);
      dfs(k + 1, done | (1 << k), finish, worst);
      path.pop();
      if (isOld) {
        delete delays[stop.orderId];
      }
      if (exhausted) {
        return;
      }
    }
  };

  dfs(0, 0, input.nowMs, Number.NEGATIVE_INFINITY);
  if (exhausted || best === undefined) {
    return { feasible: false, reason: 'BATCH_BUDGET_EXCEEDED' };
  }
  const plan = best as { makespanMs: number; worstDelayMs: number; path: number[]; delays: Record<string, number> };
  if (plan.worstDelayMs > limitMs) {
    return { feasible: false, reason: 'BATCH_DELAY_EXCEEDED' };
  }
  return { feasible: true, applicable: true, sequence: plan.path.map((k) => `${(stops[k] as BatchStop).kind}:${(stops[k] as BatchStop).orderId}`), delaysSeconds: plan.delays };
}
