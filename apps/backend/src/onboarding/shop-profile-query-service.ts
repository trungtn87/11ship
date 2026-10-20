import { ShopLogo } from '../shop/shop-logo';
import { Injectable } from '@nestjs/common';
import { SessionActor, SessionAuthorizationParticipant } from '../auth/session-authorization-participant';
import { ShopRepository, ShopRow } from '../shop/shop-repository';
import { ShopStatus } from '../shop/shop-types';
import { TransactionManager } from '../transaction/transaction-manager';

/**
 * The owned Shop profile as GET /v1/onboarding/shop/profile returns it. Every field a client needs to rebuild
 * the form and save again: `contact_phone` is the stored normalized number (the save endpoint accepts that
 * form), and `version` is the `expected_version` of the next save or of completion.
 *
 * Deliberately absent: the user id, anything about the membership row, and all audit / idempotency metadata.
 */
export interface ShopProfileView {
  readonly logo?: ShopLogo;
  readonly shop_id: string;
  readonly name: string;
  readonly contact_phone: string;
  readonly zalo: string | null;
  readonly facebook: string | null;
  readonly address_text: string;
  readonly pickup_lat: number | null;
  readonly pickup_lng: number | null;
  readonly service_area_id: string | null;
  readonly status: ShopStatus;
  readonly accepting_orders: boolean;
  readonly version: number;
}

function toView(shop: ShopRow): ShopProfileView {
  return {
    shop_id: shop.shopId,
    ...(shop.logo == null ? {} : { logo: shop.logo }),
    name: shop.name,
    contact_phone: shop.contactPhoneNormalized,
    zalo: shop.zalo,
    facebook: shop.facebook,
    address_text: shop.addressText,
    pickup_lat: shop.pickupLat,
    pickup_lng: shop.pickupLng,
    service_area_id: shop.serviceAreaId,
    status: shop.status,
    accepting_orders: shop.acceptingOrders,
    version: shop.version,
  };
}

/**
 * Read side of Shop onboarding (A2S review addendum): what makes a saved draft resumable from a new session
 * or another device. It is the ONLY place in the Onboarding module that opens a transaction of its own, and
 * that transaction runs the shared session locks and then exactly one SELECT owned by M02. It needs no Idempotency-Key and goes nowhere near the
 * idempotency executor, the audit log or the outbox: reading a profile leaves no row behind.
 *
 * The caller comes only from the authenticated session and is re-authorized inside the transaction (lockAuthorizedActorShared). A user without a shop gets null; an INCOMPLETE, ACTIVE
 * or DISABLED owned shop is returned as it is (the mutation rules of save and complete are unchanged).
 */
@Injectable()
export class ShopProfileQueryService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly shops: ShopRepository,
    private readonly sessionAuth: SessionAuthorizationParticipant,
  ) {}

  async ownedProfile(actor: SessionActor): Promise<ShopProfileView | null> {
    const shop = await this.transactions.withTransaction(async (context) => {
      // The guard's check is only a precheck: the session, the user and the device binding are re-authorized here under the
      // shared locks (user, then session) before the shop row is read. No role is required: a roleless draft owner reads their own.
      await this.sessionAuth.lockAuthorizedActorShared(context, actor);
      return this.shops.findOwnedShop(context, actor.userId);
    });
    return shop === undefined ? null : toView(shop);
  }
}
