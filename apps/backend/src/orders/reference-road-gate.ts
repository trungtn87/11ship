import { Inject, Injectable, Optional } from '@nestjs/common';
import { M14RouteClient, RouteLeg } from '../delivery/m14-route-client';
import { LatLng } from '../shipping-policy/shipping-eligibility';
import { ReferenceRoads } from './route-snapshot-view';

// P6-8b review fix (#294): the reference road of a legacy record is asked of M14 by READ endpoints, which can be many and repeated. This gate keeps
// that traffic bounded and never lets it take the slots of a checkout quote or a shop's discovery:
// - SINGLE-FLIGHT: concurrent asks for the same leg share one M14 call;
// - BOUNDED: at most MAX_CONCURRENT_REFERENCE_ROUTES calls run at once, MAX_QUEUED_REFERENCE_ROUTES wait; beyond that the answer is null at once
//   (no M14 call), the same shape as the discovery limiter (DiscoveryRouteService);
// - NEGATIVE COOLDOWN: a leg that gave no clean road (no route, timeout, a 429 or any other failure) is not asked again for COOLDOWN_MS.
// It has its OWN pool: quote and discovery routes go straight to M14RouteClient and never wait behind a reference road.

export const MAX_CONCURRENT_REFERENCE_ROUTES = 4;
export const MAX_QUEUED_REFERENCE_ROUTES = 60;
export const REFERENCE_COOLDOWN_MS = 60_000;
const COOLDOWN_CAP = 512;

const legKey = (from: LatLng, to: LatLng): string => `${from.lat.toFixed(5)},${from.lng.toFixed(5)}>${to.lat.toFixed(5)},${to.lng.toFixed(5)}`;

@Injectable()
export class ReferenceRoadGate implements ReferenceRoads {
  readonly #inFlight = new Map<string, Promise<RouteLeg | undefined>>();
  readonly #cooldown = new Map<string, number>();
  #running = 0;
  readonly #waiting: (() => void)[] = [];

  constructor(@Optional() @Inject(M14RouteClient) private readonly routes?: M14RouteClient) {}

  /** One leg, or undefined: no service, a full gate, a leg in cooldown, or any failed answer. Never throws and never retries inside the cooldown. */
  async route(from: LatLng, to: LatLng, nowMs: number = Date.now()): Promise<RouteLeg | undefined> {
    const routes = this.routes;
    if (routes === undefined) {
      return undefined;
    }
    const key = legKey(from, to);
    const coolingUntil = this.#cooldown.get(key);
    if (coolingUntil !== undefined && nowMs < coolingUntil) {
      return undefined;
    }
    const shared = this.#inFlight.get(key);
    if (shared !== undefined) {
      return shared;
    }
    if (this.#running >= MAX_CONCURRENT_REFERENCE_ROUTES && this.#waiting.length >= MAX_QUEUED_REFERENCE_ROUTES) {
      return undefined;
    }
    const work = this.#limited(() => routes.route(from, to, nowMs).catch((): undefined => undefined));
    this.#inFlight.set(key, work);
    try {
      const leg = await work;
      if (leg === undefined) {
        this.#remember(key, nowMs);
      }
      return leg;
    } finally {
      this.#inFlight.delete(key);
    }
  }

  #remember(key: string, nowMs: number): void {
    if (this.#cooldown.size >= COOLDOWN_CAP) {
      for (const [old, until] of this.#cooldown) {
        if (nowMs >= until) {
          this.#cooldown.delete(old);
        }
      }
      if (this.#cooldown.size >= COOLDOWN_CAP) {
        const oldest = this.#cooldown.keys().next();
        if (oldest.done !== true) {
          this.#cooldown.delete(oldest.value);
        }
      }
    }
    this.#cooldown.set(key, nowMs + REFERENCE_COOLDOWN_MS);
  }

  async #limited<T>(work: () => Promise<T>): Promise<T> {
    if (this.#running >= MAX_CONCURRENT_REFERENCE_ROUTES) {
      await new Promise<void>((resolve) => this.#waiting.push(resolve));
    } else {
      this.#running += 1;
    }
    try {
      return await work();
    } finally {
      const next = this.#waiting.shift();
      if (next === undefined) {
        this.#running -= 1;
      } else {
        next();
      }
    }
  }
}
