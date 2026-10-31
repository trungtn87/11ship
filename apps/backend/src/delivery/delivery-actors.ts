import { Injectable } from '@nestjs/common';
import { AuthPrincipal } from '../auth/auth-principal';
import { SessionActor, SessionAuthorizationParticipant } from '../auth/session-authorization-participant';
import { UserRepository } from '../auth/user-repository';
import { ClientActor, ClientSessionAuthority } from '../client-auth/client-session-authority';
import { AppError } from '../common/app-errors';
import { DriverRepository, DriverRow } from '../driver/driver-repository';
import { ShopRepository, ShopRow } from '../shop/shop-repository';
import { TransactionContext } from '../transaction/transaction-context';

// Who is calling, re-checked INSIDE the business transaction under the locks (the guard of the HTTP layer is only a precheck): the session, its
// role context and the ownership are decided from the locked rows, so a revocation, a role switch or an expiry during a lock wait refuses the
// command before any effect. Lock order: user row, CURRENT session row, then the shop membership + shop, or the Shipper (driver) row.

export interface ShopCaller {
  readonly actor: SessionActor;
  readonly shop: ShopRow;
}

export interface ShipperCaller {
  readonly actor: ClientActor;
  readonly driver: DriverRow;
}

@Injectable()
export class DeliveryActors {
  constructor(
    private readonly sessionAuth: SessionAuthorizationParticipant,
    private readonly authority: ClientSessionAuthority,
    private readonly users: UserRepository,
    private readonly shops: ShopRepository,
    private readonly drivers: DriverRepository,
  ) {}

  /** A Shop command: user FOR UPDATE, session FOR UPDATE, SHOP context, then the owned shop FOR UPDATE. The shop must be usable (ACTIVE) to call a Shipper. */
  async shopWriter(context: TransactionContext, principal: AuthPrincipal): Promise<ShopCaller> {
    const actor = { userId: principal.userId, sessionId: principal.sessionId };
    await this.sessionAuth.lockAuthorizedShopActor(context, actor);
    const shop = await this.shops.lockOwnedShop(context, actor.userId);
    if (shop === undefined) {
      throw new AppError('SHOP_NOT_FOUND');
    }
    return { actor, shop };
  }

  /** A Shop reader: shared locks, the shop is read (not locked). A DISABLED shop still reads its own history. */
  async shopReader(context: TransactionContext, principal: AuthPrincipal): Promise<ShopCaller> {
    const actor = { userId: principal.userId, sessionId: principal.sessionId };
    await this.sessionAuth.lockAuthorizedShopActorShared(context, actor);
    const shop = await this.shops.findOwnedShop(context, actor.userId);
    if (shop === undefined) {
      throw new AppError('SHOP_NOT_FOUND');
    }
    return { actor, shop };
  }

  /**
   * A Shipper command: user FOR UPDATE, session FOR UPDATE, the 11Ship app with the DRIVER hat, the DRIVER role still held, then the driver row FOR UPDATE
   * (the root lock of every assignment and money path). `working` allows a CLOSING Shipper (finishing open work); a SUSPENDED one only gives work back
   * through the Admin.
   */
  async shipperWriter(context: TransactionContext, principal: AuthPrincipal, options: { readonly acceptNew: boolean }): Promise<ShipperCaller> {
    const actor = await this.authority.lock(context, principal, 'update');
    await this.#assertShipDriver(context, actor);
    const driver = await this.drivers.lockByUserId(context, actor.userId);
    return { actor, driver: this.#usable(driver, options.acceptNew) };
  }

  async shipperReader(context: TransactionContext, principal: AuthPrincipal): Promise<ShipperCaller> {
    const actor = await this.authority.lock(context, principal, 'share');
    await this.#assertShipDriver(context, actor);
    const driver = await this.drivers.findByUserId(context, actor.userId);
    return { actor, driver: this.#usable(driver, false) };
  }

  /**
   * Read-only access to the Shipper's OWN assignments (issue #258): a SUSPENDED Shipper may no longer take or change work, but must still read the
   * delivery they already hold (the shop to call, the address, the state). Every caller filters by this driver id; nothing is ever written through it.
   */
  async shipperHolderReader(context: TransactionContext, principal: AuthPrincipal): Promise<ShipperCaller> {
    const actor = await this.authority.lock(context, principal, 'share');
    await this.#assertShipDriver(context, actor);
    const driver = await this.drivers.findByUserId(context, actor.userId);
    return { actor, driver: driver?.status === 'SUSPENDED' ? driver : this.#usable(driver, false) };
  }

  /**
   * The writer of a Shipper whose account may be SUSPENDED but who still HOLDS a delivery (issue #258, Owner 2026-10-31): only the two steps that end that hold may use it
   * (give the delivery back before pickup; deliver it after pickup). Taking, picking up and everything else keep `shipperWriter`, which refuses SUSPENDED. The status is never
   * written here, so a suspension survives the completion untouched.
   */
  async shipperHolderWriter(context: TransactionContext, principal: AuthPrincipal): Promise<ShipperCaller> {
    const actor = await this.authority.lock(context, principal, 'update');
    await this.#assertShipDriver(context, actor);
    const driver = await this.drivers.lockByUserId(context, actor.userId);
    return { actor, driver: driver?.status === 'SUSPENDED' ? driver : this.#usable(driver, false) };
  }

  /** The 11Ship app, the DRIVER hat on the locked session AND the DRIVER role still held now (read under the user lock already taken). */
  async #assertShipDriver(context: TransactionContext, actor: ClientActor): Promise<void> {
    if (actor.app !== 'SHIP' || actor.storedActiveRole !== 'DRIVER' || !(await this.users.hasRole(context, actor.userId, 'DRIVER'))) {
      throw new AppError('ROLE_NOT_AVAILABLE');
    }
  }

  #usable(driver: DriverRow | undefined, acceptNew: boolean): DriverRow {
    if (driver === undefined) {
      throw new AppError('DRIVER_NOT_FOUND');
    }
    if (driver.status === 'ACTIVE' || (!acceptNew && driver.status === 'CLOSING')) {
      return driver;
    }
    if (driver.status === 'PENDING') {
      throw new AppError('DRIVER_PENDING_APPROVAL');
    }
    throw new AppError('ROLE_NOT_AVAILABLE');
  }

  /**
   * M11 (issue #261): a Shipper acting on their OWN feedback file (reviews of them, complaints they sent, requests for a second look). A SUSPENDED or
   * CLOSING Shipper keeps this; it gives no right to take, hold or change a delivery, to go online or to touch a wallet. The session, the 11Ship DRIVER
   * context and the DRIVER role are checked exactly as for every Shipper command. A PENDING or CLOSED profile is still refused.
   */
  async shipperOwnFeedback(context: TransactionContext, principal: AuthPrincipal, mode: 'update' | 'share'): Promise<ShipperCaller> {
    const actor = await this.authority.lock(context, principal, mode);
    await this.#assertShipDriver(context, actor);
    const driver = mode === 'update' ? await this.drivers.lockByUserId(context, actor.userId) : await this.drivers.findByUserId(context, actor.userId);
    if (driver?.status === 'SUSPENDED') {
      return { actor, driver };
    }
    return { actor, driver: this.#usable(driver, false) };
  }
}
