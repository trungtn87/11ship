import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../transaction/transaction-context';
import { WalletService } from '../wallet/wallet-service';
import { BatchOrder } from './shipping-batching';
import { LatLng } from './shipping-eligibility';

// What M06 needs from the modules that own the facts (M07 delivery/assignment, M14 location and routing, M04 wallet). Each port has a default
// binding that is honest about "not connected": it answers `undefined`/unavailable, so a check that needs the fact REFUSES (fail closed). Nothing
// here ever invents a position, a route, a balance or an order. When an owner lands it binds its own implementation to the token.

/** M07 — what M06 may know about a delivery on offer (no phone, no address text, only what the rules need). */
export interface DeliveryOffer {
  readonly deliveryId: string;
  readonly searching: boolean;
  readonly hasShipper: boolean;
  readonly searchExpiresAtMs: number;
  readonly shop: LatLng | null;
  readonly dropoff: LatLng | null;
  /** The commission hold M04 would take; null while M07/M04 cannot say. */
  readonly requiredHoldVnd: bigint | null;
  readonly locationOptional?: boolean;
}

export interface DeliveryOfferPort {
  offer(context: TransactionContext, deliveryId: string): Promise<DeliveryOffer | undefined>;
}
export const DELIVERY_OFFER_PORT = Symbol('DELIVERY_OFFER_PORT');

/** M07 — the open work of a Shipper: how many deliveries and, for each, what the batching rule needs (the ORIGINAL ETA is M07's, immutable). */
export interface ShipperOpenWork {
  readonly activeCount: number;
  readonly orders: readonly BatchOrder[];
}

export interface ShipperWorkPort {
  openWork(context: TransactionContext, driverId: string): Promise<ShipperOpenWork | undefined>;
}
export const SHIPPER_WORK_PORT = Symbol('SHIPPER_WORK_PORT');

/** M14 — the Shipper's latest position with M14's own verdicts on its freshness and validity. */
export interface ShipperLocation {
  readonly point: LatLng;
  readonly recordedAtMs: number;
  readonly fresh: boolean;
  readonly valid: boolean;
}

export interface ShipperLocationPort {
  /** Runs in the CALLER's transaction (the eligibility check holds its locks): the reader opens none of its own. */
  current(context: TransactionContext, driverId: string): Promise<ShipperLocation | undefined>;
}
export const SHIPPER_LOCATION_PORT = Symbol('SHIPPER_LOCATION_PORT');

/** M14 — travel times between points (seconds). Called OUTSIDE any database transaction. `unavailable` is an honest "cannot compute". */
export type RouteMatrixResult = { readonly kind: 'ok'; readonly seconds: readonly (readonly (number | null)[])[]; readonly routeVersion: string } | { readonly kind: 'unavailable' };

export interface RouteMatrixPort {
  durations(points: readonly LatLng[]): Promise<RouteMatrixResult>;
}
export const ROUTE_MATRIX_PORT = Symbol('ROUTE_MATRIX_PORT');

/** M04 — the Shipper's available balance (balance minus holds), or undefined when it cannot be read. */
export interface AvailableBalancePort {
  availableVnd(context: TransactionContext, driverId: string): Promise<bigint | undefined>;
}
export const AVAILABLE_BALANCE_PORT = Symbol('AVAILABLE_BALANCE_PORT');

@Injectable()
export class NotIntegratedDeliveryOfferPort implements DeliveryOfferPort {
  offer(): Promise<undefined> {
    return Promise.resolve(undefined);
  }
}

@Injectable()
export class NotIntegratedShipperWorkPort implements ShipperWorkPort {
  openWork(): Promise<undefined> {
    return Promise.resolve(undefined);
  }
}

@Injectable()
export class NotIntegratedShipperLocationPort implements ShipperLocationPort {
  current(): Promise<undefined> {
    return Promise.resolve(undefined);
  }
}

@Injectable()
export class NotIntegratedRouteMatrixPort implements RouteMatrixPort {
  durations(): Promise<RouteMatrixResult> {
    return Promise.resolve({ kind: 'unavailable' });
  }
}

/** The real M04 read model (M04-A1): a wallet that does not exist is 0 available, never a made-up amount. */
@Injectable()
export class WalletAvailableBalancePort implements AvailableBalancePort {
  constructor(private readonly wallets: WalletService) {}

  async availableVnd(context: TransactionContext, driverId: string): Promise<bigint> {
    return (await this.wallets.readWallet(context, driverId)).availableVnd;
  }
}
