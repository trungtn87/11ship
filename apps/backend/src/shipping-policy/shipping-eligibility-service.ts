import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../common/app-errors';
import { DriverBankRepository } from '../driver/driver-bank-repository';
import { DriverRepository } from '../driver/driver-repository';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { EligibilityParametersRepository } from './eligibility-parameters-repository';
import { batchStops, BatchOrder, BatchReason, DEFAULT_BATCH_BUDGET, evaluateBatch } from './shipping-batching';
import { EligibilityFacts, EligibilityReason, evaluateEligibility, LatLng } from './shipping-eligibility';
import {
  AVAILABLE_BALANCE_PORT,
  AvailableBalancePort,
  DELIVERY_OFFER_PORT,
  DeliveryOffer,
  DeliveryOfferPort,
  ROUTE_MATRIX_PORT,
  RouteMatrixPort,
  SHIPPER_LOCATION_PORT,
  SHIPPER_WORK_PORT,
  ShipperLocation,
  ShipperLocationPort,
  ShipperWorkPort,
} from './shipping-ports';

/** How long a route computed by `preview` may back a `confirm` (the places must also be unchanged). */
export const ROUTE_SNAPSHOT_TTL_MS = 60_000;

export type DecisionReason = EligibilityReason | BatchReason | 'ROUTE_STALE';

export interface RouteSnapshot {
  readonly points: readonly LatLng[];
  readonly seconds: readonly (readonly (number | null)[])[];
  readonly routeVersion: string;
  readonly computedAtMs: number;
}

export interface Decision {
  readonly eligible: boolean;
  /** Empty when eligible. A fixed vocabulary M07 and the apps turn into short sentences. */
  readonly reasons: readonly DecisionReason[];
  readonly distanceToShopM: number | null;
  readonly batch: { readonly applicable: boolean; readonly sequence: readonly string[]; readonly delaysSeconds: Readonly<Record<string, number>> } | null;
}

export interface Preview {
  readonly decision: Decision;
  /** Pass it back to `confirm` inside the commit transaction; undefined when no route was needed or computed. */
  readonly route: RouteSnapshot | undefined;
}

interface Gathered {
  readonly facts: EligibilityFacts;
  readonly offer: DeliveryOffer | undefined;
  readonly location: ShipperLocation | undefined;
  readonly open: readonly BatchOrder[];
  readonly params: { readonly maxDelaySeconds: number; readonly pickupServiceSeconds: number; readonly handoffServiceSeconds: number };
}

/**
 * M06-B/C entry point for M07. It decides; it never accepts, assigns, holds money or notifies.
 *
 *  - `preview`: read-only, in its own short transactions. The route service (M14) is called OUTSIDE any transaction.
 *  - `confirm`: for M07's commit transaction. It locks the Shipper's row FIRST (the same root lock every money/assignment path uses, so two
 *    simultaneous acceptances by one Shipper are serialized and the second sees the first's assignment and hold), re-reads every fact, requires
 *    the route snapshot to still describe the same places and be young, and decides again. M07 must insert the assignment and take the hold in
 *    that same transaction; the lock holds until it commits.
 *
 * Every fact comes from its owner through a port whose default answer is "not connected": the check then refuses (fail closed).
 */
@Injectable()
export class ShippingEligibilityService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly drivers: DriverRepository,
    private readonly banks: DriverBankRepository,
    private readonly parameters: EligibilityParametersRepository,
    @Inject(DELIVERY_OFFER_PORT) private readonly offers: DeliveryOfferPort,
    @Inject(SHIPPER_WORK_PORT) private readonly work: ShipperWorkPort,
    @Inject(SHIPPER_LOCATION_PORT) private readonly locations: ShipperLocationPort,
    @Inject(ROUTE_MATRIX_PORT) private readonly routes: RouteMatrixPort,
    @Inject(AVAILABLE_BALANCE_PORT) private readonly balances: AvailableBalancePort,
  ) {}

  async preview(request: { driverId: string; deliveryId: string }, nowMs: number): Promise<Preview> {
    const gathered = await this.transactions.withTransaction((context) => this.#gather(context, request, false, nowMs));
    const verdict = evaluateEligibility(gathered.facts);
    if (!verdict.eligible) {
      return { decision: { eligible: false, reasons: verdict.reasons, distanceToShopM: verdict.distanceToShopM, batch: null }, route: undefined };
    }
    // The route is asked for outside any transaction, and only when there is work to protect and the data to ask with.
    let route: RouteSnapshot | undefined;
    const points = this.#points(gathered);
    if (points !== undefined) {
      const answer = await this.routes.durations(points);
      if (answer.kind === 'ok') {
        route = { points, seconds: answer.seconds, routeVersion: answer.routeVersion, computedAtMs: nowMs };
      }
    }
    return { decision: this.#decide(gathered, route, verdict.distanceToShopM), route };
  }

  /**
   * Read-only, in ONE short transaction: the eligibility RULES (not the batching route) for several deliveries, to list what a Shipper may take. It asks M14 for
   * nothing; a listed "eligible" is a promise of nothing: `confirm` decides again at the commit. Order of the answers = order of `deliveryIds`.
   */
  async precheck(request: { driverId: string; deliveryIds: readonly string[] }, nowMs: number): Promise<Decision[]> {
    return this.transactions.withTransaction(async (context) => {
      const decisions: Decision[] = [];
      for (const deliveryId of request.deliveryIds) {
        const gathered = await this.#gather(context, { driverId: request.driverId, deliveryId }, false, nowMs);
        const verdict = evaluateEligibility(gathered.facts);
        decisions.push({ eligible: verdict.eligible, reasons: verdict.reasons, distanceToShopM: verdict.distanceToShopM, batch: null });
      }
      return decisions;
    });
  }

  async confirm(context: TransactionContext, request: { driverId: string; deliveryId: string }, route: RouteSnapshot | undefined, nowMs: number): Promise<Decision> {
    const gathered = await this.#gather(context, request, true, nowMs);
    const verdict = evaluateEligibility(gathered.facts);
    if (!verdict.eligible) {
      return { eligible: false, reasons: verdict.reasons, distanceToShopM: verdict.distanceToShopM, batch: null };
    }
    const points = this.#points(gathered);
    if (points !== undefined && (route === undefined || nowMs - route.computedAtMs > ROUTE_SNAPSHOT_TTL_MS || !samePoints(points, route.points))) {
      return { eligible: false, reasons: ['ROUTE_STALE'], distanceToShopM: verdict.distanceToShopM, batch: null };
    }
    return this.#decide(gathered, route, verdict.distanceToShopM);
  }

  /** [driver, ...stops] when batching applies (the Shipper has open work) and every point exists; otherwise undefined. */
  #points(g: Gathered): readonly LatLng[] | undefined {
    if (g.open.length === 0 || g.location === undefined || g.offer === undefined) {
      return undefined;
    }
    const stops = batchStops(g.open, { orderId: g.offer.deliveryId, pickup: g.offer.shop, dropoff: g.offer.dropoff });
    return stops === undefined ? undefined : [g.location.point, ...stops.map((s) => s.point)];
  }

  #decide(g: Gathered, route: RouteSnapshot | undefined, distanceToShopM: number | null): Decision {
    const location = g.location as ShipperLocation;
    const offer = g.offer as DeliveryOffer;
    const batch = evaluateBatch({
      nowMs: g.facts.nowMs,
      driver: { fresh: location.fresh, valid: location.valid },
      open: g.open,
      candidate: { orderId: offer.deliveryId, pickup: offer.shop, dropoff: offer.dropoff },
      params: g.params,
      matrix: route?.seconds,
      budget: DEFAULT_BATCH_BUDGET,
    });
    if (!batch.feasible) {
      return { eligible: false, reasons: [batch.reason], distanceToShopM, batch: null };
    }
    return { eligible: true, reasons: [], distanceToShopM, batch: { applicable: batch.applicable, sequence: batch.sequence, delaysSeconds: batch.delaysSeconds } };
  }

  async #gather(context: TransactionContext, request: { driverId: string; deliveryId: string }, lock: boolean, nowMs: number): Promise<Gathered> {
    const driver = lock ? await this.drivers.lockById(context, request.driverId) : await this.drivers.findById(context, request.driverId);
    if (driver === undefined) {
      throw new AppError('DRIVER_NOT_FOUND');
    }
    const bank = await this.banks.find(context, driver.driverId);
    const params = await this.parameters.read(context);
    const offer = await this.offers.offer(context, request.deliveryId);
    const openWork = await this.work.openWork(context, driver.driverId);
    const location = await this.locations.current(context, driver.driverId);
    const availableVnd = await this.balances.availableVnd(context, driver.driverId);
    const facts: EligibilityFacts = {
      nowMs,
      driver: { status: driver.status, acceptingDeliveries: driver.acceptingDeliveries, driverType: driver.driverType, bankVerified: bank?.verificationState === 'VERIFIED' },
      delivery:
        offer === undefined
          ? undefined
          : { searching: offer.searching, hasShipper: offer.hasShipper, searchExpiresAtMs: offer.searchExpiresAtMs, shop: offer.shop, requiredHoldVnd: offer.requiredHoldVnd, locationOptional: offer.locationOptional },
      location: location === undefined ? undefined : { point: location.point, fresh: location.fresh, valid: location.valid },
      activeCount: openWork?.activeCount,
      availableVnd,
      externalMaxDeliveries: params.externalMaxDeliveries,
    };
    return {
      facts,
      offer,
      location,
      open: openWork?.orders ?? [],
      params: { maxDelaySeconds: params.batchMaxDelaySeconds, pickupServiceSeconds: params.pickupServiceSeconds, handoffServiceSeconds: params.handoffServiceSeconds },
    };
  }
}

const samePoints = (a: readonly LatLng[], b: readonly LatLng[]): boolean => a.length === b.length && a.every((p, i) => p.lat === (b[i] as LatLng).lat && p.lng === (b[i] as LatLng).lng);
