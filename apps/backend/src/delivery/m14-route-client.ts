import { Inject, Injectable, Optional } from '@nestjs/common';
import { M14RoutingConfig } from '../config/m14-routing-config';
import { isValidPoint, LatLng } from '../shipping-policy/shipping-eligibility';
import { RouteMatrixPort, RouteMatrixResult } from '../shipping-policy/shipping-ports';

// M14 routing for M07: road distance and travel time between two points, asked of the M14 routing service (ops/m14: POST /route with exactly two
// points, motorcycle costing, no fallback). Called OUTSIDE any database transaction. An answer that is not a clean route is "unavailable": the
// caller keeps the fee unknown / refuses the batch, and NEVER replaces the route with a straight line. Only coordinates are sent and nothing is
// logged or kept beyond a short in-memory cache of recent legs (no history of positions).

export const M14_ROUTING = Symbol('M14_ROUTING');
export const M14_FETCH = Symbol('M14_FETCH');

export interface RouteLeg {
  /** Road distance in whole metres. */
  readonly distanceM: number;
  /** Travel time in whole seconds. */
  readonly seconds: number;
}

export type RouteFailureReason = 'ROUTING_NOT_CONFIGURED' | 'POINT_INVALID' | 'ROUTE_TIMEOUT' | 'ROUTE_UNAVAILABLE';
export type RouteResult = { readonly status: 'ROUTE'; readonly leg: RouteLeg } | { readonly status: 'UNAVAILABLE'; readonly reason: RouteFailureReason };

export type Fetcher = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Largest number of legs one matrix may ask for (the routing service allows few requests per minute; beyond this the answer is "unavailable"). */
export const MAX_MATRIX_LEGS = 20;
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX = 256;

const obj = (value: unknown): Record<string, unknown> | undefined => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined);

/** Reads a Valhalla-style trip summary strictly: length in kilometres and time in seconds, both finite and non-negative. */
export function parseLeg(body: unknown): RouteLeg | undefined {
  const summary = obj(obj(obj(body)?.trip)?.summary);
  const length = summary?.length;
  const time = summary?.time;
  if (typeof length !== 'number' || typeof time !== 'number' || !Number.isFinite(length) || !Number.isFinite(time) || length < 0 || time < 0 || length > 2000 || time > 172_800) {
    return undefined;
  }
  return { distanceM: Math.round(length * 1000), seconds: Math.round(time) };
}

@Injectable()
export class M14RouteClient implements RouteMatrixPort {
  readonly #cache = new Map<string, { readonly leg: RouteLeg; readonly atMs: number }>();

  constructor(
    @Optional() @Inject(M14_ROUTING) private readonly config?: M14RoutingConfig,
    @Optional() @Inject(M14_FETCH) private readonly fetcher?: Fetcher,
  ) {}

  /** True when a routing service is configured at all. */
  get available(): boolean {
    return this.config !== undefined;
  }

  /** One leg, or undefined when there is no service, no route, an invalid point or any failure. */
  async route(from: LatLng, to: LatLng, nowMs: number = Date.now()): Promise<RouteLeg | undefined> {
    const result = await this.routeResult(from, to, nowMs);
    return result.status === 'ROUTE' ? result.leg : undefined;
  }

  /** A diagnostic result for quote/call-shipping flows. It remains PII-free and never invents a distance. */
  async routeResult(from: LatLng, to: LatLng, nowMs: number = Date.now()): Promise<RouteResult> {
    const config = this.config;
    if (config === undefined) return { status: 'UNAVAILABLE', reason: 'ROUTING_NOT_CONFIGURED' };
    if (!isValidPoint(from) || !isValidPoint(to)) return { status: 'UNAVAILABLE', reason: 'POINT_INVALID' };
    if (from.lat === to.lat && from.lng === to.lng) {
      return { status: 'ROUTE', leg: { distanceM: 0, seconds: 0 } };
    }
    const key = `${from.lat.toFixed(5)},${from.lng.toFixed(5)}>${to.lat.toFixed(5)},${to.lng.toFixed(5)}`;
    const cached = this.#cache.get(key);
    if (cached !== undefined && nowMs - cached.atMs < CACHE_TTL_MS) {
      return { status: 'ROUTE', leg: cached.leg };
    }
    try {
      const fetcher: Fetcher = this.fetcher ?? ((url, init) => fetch(url, init));
      const response = await fetcher(`${config.origin}/route`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ locations: [{ lat: from.lat, lon: from.lng }, { lat: to.lat, lon: to.lng }] }),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      if (!response.ok) {
        return { status: 'UNAVAILABLE', reason: 'ROUTE_UNAVAILABLE' };
      }
      const leg = parseLeg(await response.json());
      if (leg === undefined) {
        return { status: 'UNAVAILABLE', reason: 'ROUTE_UNAVAILABLE' };
      }
      if (this.#cache.size >= CACHE_MAX) {
        const oldest = this.#cache.keys().next();
        if (oldest.done !== true) {
          this.#cache.delete(oldest.value);
        }
      }
      this.#cache.set(key, { leg, atMs: nowMs });
      return { status: 'ROUTE', leg };
    } catch (error) {
      const name = typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : '';
      return { status: 'UNAVAILABLE', reason: name === 'TimeoutError' || name === 'AbortError' ? 'ROUTE_TIMEOUT' : 'ROUTE_UNAVAILABLE' };
    }
  }

  /** The matrix M06 asks for, built from legs. Any missing leg makes the whole answer unavailable (no guess); too many legs is unavailable too. */
  async durations(points: readonly LatLng[]): Promise<RouteMatrixResult> {
    const size = points.length;
    if (this.config === undefined || size < 2 || size * (size - 1) > MAX_MATRIX_LEGS) {
      return { kind: 'unavailable' };
    }
    const seconds: (number | null)[][] = points.map(() => points.map(() => 0));
    for (let from = 0; from < size; from += 1) {
      for (let to = 0; to < size; to += 1) {
        if (from === to) {
          continue;
        }
        const leg = await this.route(points[from] as LatLng, points[to] as LatLng);
        if (leg === undefined) {
          return { kind: 'unavailable' };
        }
        (seconds[from] as (number | null)[])[to] = leg.seconds;
      }
    }
    return { kind: 'ok', seconds, routeVersion: 'm14-route-v1' };
  }
}
