import { Injectable } from '@nestjs/common';
import { DeliveryRepository } from '../delivery/delivery-repository';
import { ShipperLocationRepository } from '../delivery/shipper-location';
import { DriverRepository } from '../driver/driver-repository';
import { ComplaintRepository } from '../feedback/complaint-repository';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { OrderRepository } from '../orders/order-repository';
import { ShopRepository } from '../shop/shop-repository';
import { ShippingFeeAgreementService } from '../shipping-policy/shipping-fee-agreement-service';
import { TransactionContext } from '../transaction/transaction-context';
import { TopupRequestRepository } from '../wallet/topup-request-repository';

// Read-only lookups that turn an identifier from an event into the ACCOUNT that receives the notification, THROUGH the repositories of the modules that own
// the tables (Shop, Driver, Wallet, Delivery, M06): M08 issues no SQL against them. The recipient is always an account that owns the business object (the
// shop's owner, the Shipper who holds or held the delivery, the Shipper whose top-up it is). A phone number typed into an order is never resolved to an
// account: a recipient who only exists as typed text receives nothing in the app.

export interface OfferDeliveryFacts {
  readonly state: string;
  readonly version: number;
  readonly pickupLat: number;
  readonly pickupLng: number;
  readonly remainingMs: number;
}

export interface ReminderFacts {
  readonly code: string;
  readonly state: string;
  readonly searchOpen: boolean;
  readonly shopOwner: string | null;
  readonly assignmentWaiting: boolean;
  readonly assignmentUser: string | null;
}

@Injectable()
export class NotificationRecipients {
  constructor(
    private readonly shops: ShopRepository,
    private readonly drivers: DriverRepository,
    private readonly deliveries: DeliveryRepository,
    private readonly locations: ShipperLocationRepository,
    private readonly topups: TopupRequestRepository,
    private readonly agreements: ShippingFeeAgreementService,
    private readonly complaints: ComplaintRepository,
    private readonly orders: OrderRepository,
  ) {}

  shopOwner(context: TransactionContext, shopId: string): Promise<string | undefined> {
    return this.shops.ownerUserIdOfShop(context, shopId);
  }

  /** The account that placed the Order (re-read: the event only carries the id). Never a phone typed into the Order. */
  async orderCustomer(context: TransactionContext, orderId: string): Promise<string | undefined> {
    return (await this.orders.findById(context, orderId))?.customerUserId;
  }

  /**
   * Does this account have a right to open this Order now? The customer who placed it, or the owner of its shop. `ended` tells the app to show it as history.
   * Nothing about the Order is returned when the right is gone.
   */
  async orderAccessFor(context: TransactionContext, orderId: string, userId: string, role: 'CUSTOMER' | 'SHOP'): Promise<{ access: boolean; ended: boolean; status: string | null }> {
    const order = await this.orders.findById(context, orderId);
    if (order === undefined) {
      return { access: false, ended: false, status: null };
    }
    const access = role === 'CUSTOMER' ? order.customerUserId === userId : (await this.shops.ownerUserIdOfShop(context, order.shopId)) === userId;
    return { access, ended: order.endedAtMs !== null, status: access ? order.status : null };
  }

  /**
   * The Order a delivery belongs to, for a FOOD session that opens an old notification of that delivery: the Order id is read from the delivery row (never guessed
   * from a code), and the right to the Order is the shop owner's, checked here again. `none`: the delivery is a direct call (it opens as itself).
   */
  async orderOfDeliveryForShop(context: TransactionContext, deliveryId: string, userId: string): Promise<{ kind: 'none' } | { kind: 'order'; orderId: string; access: boolean; ended: boolean; status: string | null }> {
    const d = await this.deliveries.findById(context, deliveryId);
    if (d === undefined || d.source !== 'ORDER' || d.orderId === null) {
      return { kind: 'none' };
    }
    const facts = await this.orderAccessFor(context, d.orderId, userId, 'SHOP');
    return { kind: 'order', orderId: d.orderId, ...facts };
  }

  async driverUser(context: TransactionContext, driverId: string): Promise<string | undefined> {
    return (await this.drivers.findById(context, driverId))?.userId;
  }

  /**
   * The Shipper a fee agreement is bound to (the one who countered), or, when a refusal released the binding, the Shipper whose counter-offer was just answered
   * (they are told the answer, the delivery stays open to everybody). Undefined when there is none.
   */
  async agreementDriverUser(context: TransactionContext, deliveryId: string): Promise<string | undefined> {
    const agreement = await this.agreements.readByDelivery(context, deliveryId);
    if (agreement === undefined) {
      return undefined;
    }
    const driverId = agreement.boundDriverId ?? (await this.agreements.lastAnsweredDriver(context, agreement.agreementId));
    return driverId === undefined ? undefined : this.driverUser(context, driverId);
  }

  async topupOwner(context: TransactionContext, requestId: string): Promise<string | undefined> {
    const request = await this.topups.findById(context, requestId);
    return request === undefined ? undefined : this.driverUser(context, request.driverId);
  }

  async deliveryOfferFacts(context: TransactionContext, deliveryId: string): Promise<OfferDeliveryFacts | undefined> {
    const d = await this.deliveries.findById(context, deliveryId);
    return d === undefined ? undefined : { state: d.state, version: d.version, pickupLat: d.pickupLat, pickupLng: d.pickupLng, remainingMs: d.searchExpiresAtMs - (await freshClockMs(context)) };
  }

  /**
   * Shippers worth asking M06 about: ACTIVE, switched on, with a live 11Ship session and a latest position inside a box around the pickup point. A cheap
   * prefilter only; the eligibility decision (radius, freshness, wallet, load, batching rules) is M06's and is asked afterwards.
   */
  async candidateShippers(context: TransactionContext, pickupLat: number, pickupLng: number, radiusM: number, limit: number): Promise<{ driverId: string; userId: string }[]> {
    const near = await this.locations.driversNear(context, pickupLat, pickupLng, radiusM, limit);
    const accepting = await this.drivers.listAcceptingAmong(context, near);
    const byDriver = new Map(accepting.map((a) => [a.driverId, a]));
    const out: { driverId: string; userId: string }[] = [];
    for (const driverId of near) {
      const found = byDriver.get(driverId);
      if (found !== undefined && (await this.#hasLiveShipSession(context, found.userId))) {
        out.push(found);
      }
    }
    return out;
  }

  async #hasLiveShipSession(context: TransactionContext, userId: string): Promise<boolean> {
    const result = await context.query(`SELECT 1 FROM app.sessions WHERE user_id = $1::uuid AND app = 'SHIP' AND revoked_at IS NULL AND expires_at > clock_timestamp() LIMIT 1`, [userId]);
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * What a reminder must be true of, read under the database clock at the moment of sending: the delivery's state and code, whether its search window is still
   * open, whether the shop still has an owner and, for a pickup reminder, whether THAT assignment is still ACTIVE, not picked up and still held by an account
   * that may work (ACTIVE or CLOSING Shipper).
   */
  async reminderFacts(context: TransactionContext, deliveryId: string, assignmentId: string | null): Promise<ReminderFacts> {
    const d = await this.deliveries.findById(context, deliveryId);
    if (d === undefined) {
      return { code: '', state: 'missing', searchOpen: false, shopOwner: null, assignmentWaiting: false, assignmentUser: null };
    }
    const nowMs = await freshClockMs(context);
    const assignment = assignmentId === null ? undefined : await this.deliveries.findAssignment(context, assignmentId);
    const mine = assignment !== undefined && assignment.deliveryId === deliveryId ? assignment : undefined;
    const driver = mine === undefined ? undefined : await this.drivers.findById(context, mine.driverId);
    return {
      code: d.code,
      state: d.state,
      searchOpen: d.state === 'waiting_driver' && nowMs < d.searchExpiresAtMs,
      shopOwner: (await this.shops.ownerUserIdOfShop(context, d.shopId)) ?? null,
      assignmentWaiting: mine !== undefined && mine.status === 'ACTIVE' && mine.pickedUpAtMs === null && (d.state === 'accepted' || d.state === 'location_confirmed'),
      assignmentUser: driver !== undefined && (driver.status === 'ACTIVE' || driver.status === 'CLOSING') ? driver.userId : null,
    };
  }

  /** The delivery as the receiving app must treat it right now: does it exist, may THIS account see it, and has it ended. */
  async deliveryAccessFor(context: TransactionContext, deliveryId: string, userId: string, app: 'FOOD' | 'SHIP'): Promise<{ exists: boolean; access: boolean; state: string | null; ended: boolean }> {
    const d = await this.deliveries.findById(context, deliveryId);
    if (d === undefined) {
      return { exists: false, access: false, state: null, ended: true };
    }
    let access = false;
    if (app === 'FOOD') {
      access = await this.shops.isOwnerOfShop(context, d.shopId, userId);
    } else {
      for (const assignment of await this.deliveries.listAssignments(context, deliveryId)) {
        if ((await this.drivers.findById(context, assignment.driverId))?.userId === userId) {
          access = true;
          break;
        }
      }
    }
    return { exists: true, access, state: d.state, ended: ['completed', 'failed', 'cancelled_by_merchant','cancelled_by_system', 'search_stopped'].includes(d.state) };
  }

  /**
   * The complaint as the receiving account must treat it right now: does it exist, may THIS account read it (its submitter, or a related party to which something
   * was shown), and is it closed. Read through M11's own repository: M08 issues no SQL against M11's tables.
   */
  async complaintAccessFor(context: TransactionContext, complaintId: string, userId: string): Promise<{ exists: boolean; access: boolean; status: string | null; ended: boolean }> {
    const c = await this.complaints.findById(context, complaintId);
    if (c === undefined) {
      return { exists: false, access: false, status: null, ended: true };
    }
    let access = c.submitterUserId === userId;
    if (!access && c.submitterRole !== 'SHOP' && (await this.shops.isOwnerOfShop(context, c.shopId, userId))) {
      access = await this.complaints.partyMayRead(context, c.complaintId, 'SHOP', c.shopId);
    }
    if (!access && c.submitterRole !== 'SHIPPER' && c.driverId !== null && (await this.drivers.findById(context, c.driverId))?.userId === userId) {
      access = await this.complaints.partyMayRead(context, c.complaintId, 'SHIPPER', c.driverId);
    }
    return { exists: true, access, status: c.status, ended: c.status === 'RESOLVED' || c.status === 'CLOSED_NO_ACTION' };
  }
}
