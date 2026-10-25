import { Injectable } from '@nestjs/common';
import { M14RouteClient } from '../delivery/m14-route-client';
import { ShopSetupGate } from '../shop-setup/shop-setup-gate';
import { ShopAvailabilityReader } from '../shop/shop-availability-reader';
import { LatLng } from '../shipping-policy/shipping-eligibility';
import { TransactionManager } from '../transaction/transaction-manager';
import { RouteDistancesInput } from './discovery-route-validation';

export type RouteDistanceStatus = 'ROUTE' | 'UNAVAILABLE';

export interface RouteDistanceEntry {
  readonly shop_id: string;
  readonly status: RouteDistanceStatus;
  /** Road distance in whole metres from the customer's position to the shop's pickup point; null unless status is ROUTE. */
  readonly distance_m: number | null;
}

/** Routes asked of the routing service at once, for ALL requests together (the service allows few requests per minute; the rest waits for a slot). */
export const MAX_CONCURRENT_ROUTES = 4;
/** Requests that may be waiting for a slot; beyond this a shop is answered UNAVAILABLE at once instead of queueing without limit. */
export const MAX_QUEUED_ROUTES = 60;

/**
 * Road distance for the shop cards of Home and Search (issue #190, section 6): from the customer's CURRENT position to the PICKUP POINT of each shop,
 * by the M14 routing service. It is NOT the leg shop -> delivery address that M06 prices an order with; the two never share a value.
 *
 * Only shops customers may see are routed (the same gate as the shop page), and the pickup point comes from the server's own row, never from the
 * request. No route, no routing service, a point without a road, a timeout or too much load is UNAVAILABLE: no straight line and no invented number
 * ever stands in for it (the client may show its own straight line, labelled as such). The routing client keeps a short cache of recent legs; this
 * service bounds how many legs are in flight and how many wait. The position and the legs are not stored or logged.
 */
@Injectable()
export class DiscoveryRouteService {
  #inFlight = 0;
  readonly #waiting: (() => void)[] = [];

  constructor(
    private readonly transactions: TransactionManager,
    private readonly reader: ShopAvailabilityReader,
    private readonly gate: ShopSetupGate,
    private readonly routes: M14RouteClient,
  ) {}

  async distances(input: RouteDistancesInput): Promise<{ routing_available: boolean; distances: RouteDistanceEntry[] }> {
    const pickups = await this.transactions.withTransaction(async (context) => {
      const found = new Map<string, LatLng>();
      for (const shopId of input.shopIds) {
        const snapshot = await this.reader.snapshotOfShop(context, shopId);
        if (snapshot === undefined || snapshot.pickupLat === null || snapshot.pickupLng === null || !snapshot.hasPickupPoint) {
          continue;
        }
        if ((await this.gate.evaluate(context, snapshot)).publicVisible) {
          found.set(shopId, { lat: snapshot.pickupLat, lng: snapshot.pickupLng });
        }
      }
      return found;
    });
    const available = this.routes.available;
    const distances = await Promise.all(
      input.shopIds.map(async (shopId): Promise<RouteDistanceEntry> => {
        const pickup = pickups.get(shopId);
        if (!available || pickup === undefined) {
          return { shop_id: shopId, status: 'UNAVAILABLE', distance_m: null };
        }
        const leg = await this.#limited(() => this.routes.route(input.origin, pickup));
        return leg === undefined ? { shop_id: shopId, status: 'UNAVAILABLE', distance_m: null } : { shop_id: shopId, status: 'ROUTE', distance_m: leg.distanceM };
      }),
    );
    return { routing_available: available, distances };
  }

  async #limited<T>(work: () => Promise<T | undefined>): Promise<T | undefined> {
    if (this.#inFlight >= MAX_CONCURRENT_ROUTES) {
      if (this.#waiting.length >= MAX_QUEUED_ROUTES) {
        return undefined;
      }
      await new Promise<void>((resolve) => this.#waiting.push(resolve));
    } else {
      this.#inFlight += 1;
    }
    try {
      return await work();
    } finally {
      const next = this.#waiting.shift();
      if (next === undefined) {
        this.#inFlight -= 1;
      } else {
        next();
      }
    }
  }
}
