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
  /** The road geometry as an encoded polyline (precision 6, [lat, lng] pairs), bounded by MAX_SHAPE_CHARS / MAX_SHAPE_POINTS. Never a straight line between two points. */
  readonly geometry: string;
  /** Engine + profile + map data version, as reported by the routing service's own configuration (see ops/m14/server.py). */
  readonly routeVersion: string;
}

/** Version of a leg between two identical points: no routing service was consulted. */
export const ZERO_LENGTH_ROUTE_VERSION = 'ZERO_LENGTH';
/** Longest accepted shape string and its largest decoded point count; a bigger answer is "unavailable", never truncated. */
export const MAX_SHAPE_CHARS = 60_000;
export const MAX_SHAPE_POINTS = 5000;
const ROUTE_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/+:-]{0,127}$/;

/**
 * ROUTE_GATEWAY_OUTDATED: the answer has a readable distance and time but no route_version or no shape, i.e. a routing gateway older than this backend.
 * It stays unavailable (no straight line). Callers collapse it to ROUTE_UNAVAILABLE so the client never sees the internal reason.
 */
export type RouteFailureReason = 'ROUTING_NOT_CONFIGURED' | 'POINT_INVALID' | 'ROUTE_TIMEOUT' | 'ROUTE_UNAVAILABLE' | 'ROUTE_GATEWAY_OUTDATED';
export type RouteResult = { readonly status: 'ROUTE'; readonly leg: RouteLeg } | { readonly status: 'UNAVAILABLE'; readonly reason: RouteFailureReason };

export type Fetcher = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Largest number of legs one matrix may ask for (the routing service allows few requests per minute; beyond this the answer is "unavailable"). */
export const MAX_MATRIX_LEGS = 20;
/** Legs asked of the routing service at the same time (issue #257): enough to stay inside the 60 s snapshot window, few enough not to flood a small server. */
export const MATRIX_CONCURRENCY = 4;
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX = 256;

const obj = (value: unknown): Record<string, unknown> | undefined => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined);

/** Number of points in a strictly valid polyline6, or undefined when the string is malformed (bad character, truncated value, out-of-range coordinate) or too long/large. */
export function polyline6PointCount(shape: string): number | undefined {
  if (shape.length === 0 || shape.length > MAX_SHAPE_CHARS) return undefined;
  let index = 0;
  let lat = 0;
  let lng = 0;
  let count = 0;
  const next = (): number | undefined => {
    let result = 0;
    let factor = 1;
    for (let chunks = 0; chunks < 7; chunks += 1) {
      if (index >= shape.length) return undefined;
      const code = shape.charCodeAt(index++) - 63;
      if (code < 0 || code > 63) return undefined;
      result += (code & 0x1f) * factor;
      if (code < 0x20) return result % 2 === 1 ? -(result + 1) / 2 : result / 2;
      factor *= 32;
    }
    return undefined;
  };
  while (index < shape.length) {
    const dLat = next();
    const dLng = next();
    if (dLat === undefined || dLng === undefined) return undefined;
    lat += dLat;
    lng += dLng;
    if (Math.abs(lat) > 90e6 || Math.abs(lng) > 180e6) return undefined;
    count += 1;
    if (count > MAX_SHAPE_POINTS) return undefined;
  }
  return count;
}

function encodeValue(value: number): string {
  let rest = value < 0 ? -value * 2 - 1 : value * 2;
  let out = '';
  while (rest >= 0x20) {
    out += String.fromCharCode(((rest % 32) | 0x20) + 63);
    rest = Math.floor(rest / 32);
  }
  return out + String.fromCharCode(rest + 63);
}

/** Polyline6 of the given points (used only for the zero-length leg, where no engine is asked). */
export function encodePolyline6(points: readonly LatLng[]): string {
  let lat = 0;
  let lng = 0;
  let out = '';
  for (const point of points) {
    const nextLat = Math.round(point.lat * 1e6);
    const nextLng = Math.round(point.lng * 1e6);
    out += encodeValue(nextLat - lat) + encodeValue(nextLng - lng);
    lat = nextLat;
    lng = nextLng;
  }
  return out;
}

/**
 * Reads an M14 answer strictly: trip summary (length in kilometres, time in seconds, finite and non-negative), exactly one leg with a bounded valid
 * polyline6 shape of at least two points, and the service's route_version. Anything missing, oversized or malformed is undefined (no straight-line fallback).
 */
export function parseLeg(body: unknown): RouteLeg | undefined {
  const root = obj(body);
  const trip = obj(root?.trip);
  const summary = obj(trip?.summary);
  const routeVersion = root?.route_version;
  const legs = trip?.legs;
  const shape = Array.isArray(legs) && legs.length === 1 ? obj(legs[0])?.shape : undefined;
  if (typeof routeVersion !== 'string' || !ROUTE_VERSION_PATTERN.test(routeVersion) || typeof shape !== 'string') return undefined;
  const points = polyline6PointCount(shape);
  if (points === undefined || points < 2) return undefined;
  const length = summary?.length;
  const time = summary?.time;
  if (typeof length !== 'number' || typeof time !== 'number' || !Number.isFinite(length) || !Number.isFinite(time) || length < 0 || time < 0 || length > 2000 || time > 172_800) {
    return undefined;
  }
  return { distanceM: Math.round(length * 1000), seconds: Math.round(time), geometry: shape, routeVersion };
}

/**
 * True when the distance and time are readable but the answer has no route_version or no single shape: the signature of a gateway that predates
 * this contract. Used only to pick the failure reason; the leg itself is never built from such an answer.
 */
export function isGatewayOutdated(body: unknown): boolean {
  const root = obj(body);
  const summary = obj(obj(root?.trip)?.summary);
  if (summary === undefined || typeof summary.length !== 'number' || typeof summary.time !== 'number') return false;
  const legs = obj(root?.trip)?.legs;
  const hasShape = Array.isArray(legs) && legs.length === 1 && typeof obj(legs[0])?.shape === 'string';
  return root?.route_version === undefined || !hasShape;
}

interface CacheEntry {
  /** Exact endpoints of the cached leg. The map key rounds to 5 decimals (about 1 m) only to bucket lookups: a hit needs the exact same endpoints. */
  readonly from: LatLng;
  readonly to: LatLng;
  readonly leg: RouteLeg;
  readonly atMs: number;
}

const samePoint = (a: LatLng, b: LatLng): boolean => a.lat === b.lat && a.lng === b.lng;

@Injectable()
export class M14RouteClient implements RouteMatrixPort {
  readonly #cache = new Map<string, CacheEntry>();
  /** The route_version of the last answer the gateway gave. A different version clears the cache, so no leg of an earlier profile or map data survives. */
  #servedRouteVersion: string | undefined;

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
      return { status: 'ROUTE', leg: { distanceM: 0, seconds: 0, geometry: encodePolyline6([from, to]), routeVersion: ZERO_LENGTH_ROUTE_VERSION } };
    }
    const key = `${from.lat.toFixed(5)},${from.lng.toFixed(5)}>${to.lat.toFixed(5)},${to.lng.toFixed(5)}`;
    const cached = this.#cache.get(key);
    if (cached !== undefined && samePoint(cached.from, from) && samePoint(cached.to, to) && nowMs - cached.atMs < CACHE_TTL_MS) {
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
      const body = await response.json();
      const leg = parseLeg(body);
      if (leg === undefined) {
        return { status: 'UNAVAILABLE', reason: isGatewayOutdated(body) ? 'ROUTE_GATEWAY_OUTDATED' : 'ROUTE_UNAVAILABLE' };
      }
      if (this.#servedRouteVersion !== undefined && this.#servedRouteVersion !== leg.routeVersion) {
        this.#cache.clear();
      }
      this.#servedRouteVersion = leg.routeVersion;
      if (this.#cache.size >= CACHE_MAX) {
        const oldest = this.#cache.keys().next();
        if (oldest.done !== true) {
          this.#cache.delete(oldest.value);
        }
      }
      this.#cache.set(key, { from, to, leg, atMs: nowMs });
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
    const pairs: [number, number][] = [];
    for (let from = 0; from < size; from += 1) {
      for (let to = 0; to < size; to += 1) {
        if (from !== to) {
          pairs.push([from, to]);
        }
      }
    }
    // Bounded concurrency, all or nothing: one worker pool; the first missing leg stops new requests and the whole answer is "unavailable" (no guess, no partial matrix).
    let next = 0;
    let failed = false;
    let routeVersion: string | undefined;
    const worker = async (): Promise<void> => {
      while (!failed && next < pairs.length) {
        const [from, to] = pairs[next++] as [number, number];
        const leg = await this.route(points[from] as LatLng, points[to] as LatLng);
        if (leg === undefined) {
          failed = true;
          return;
        }
        // Every leg of one matrix must come from the same engine/profile/data version; a mix (e.g. a flag flipped mid-matrix) is "unavailable".
        // A zero-length leg (two points at the same place) asked no engine, so it carries no engine version and joins any matrix.
        if (leg.routeVersion !== ZERO_LENGTH_ROUTE_VERSION) {
          if (routeVersion !== undefined && routeVersion !== leg.routeVersion) {
            failed = true;
            return;
          }
          routeVersion = leg.routeVersion;
        }
        (seconds[from] as (number | null)[])[to] = leg.seconds;
      }
    };
    await Promise.all(Array.from({ length: Math.min(MATRIX_CONCURRENCY, pairs.length) }, () => worker()));
    if (failed) {
      return { kind: 'unavailable' };
    }
    return { kind: 'ok', seconds, routeVersion: routeVersion ?? ZERO_LENGTH_ROUTE_VERSION };
  }
}
