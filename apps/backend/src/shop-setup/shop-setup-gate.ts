import { Injectable } from '@nestjs/common';
import { MenuReadinessReader } from '../menu/menu-readiness-reader';
import { ShopSnapshot } from '../shop/shop-availability-reader';
import { ShopAvailability } from '../shop/shop-types';
import { TransactionContext } from '../transaction/transaction-context';
import { effectiveAvailability, evaluateSetup, factsOf, isPublicReason, SetupEvaluation } from './shop-setup-rules';

export interface ShopGateResult {
  readonly setup: SetupEvaluation;
  /** The snapshot's availability with NO_SELLABLE_ITEM applied. */
  readonly availability: ShopAvailability;
  /** Customers may see the shop, its contact and its menu (set up, ACTIVE, owner not locked). Whether it is open now is `availability.online`. */
  readonly publicVisible: boolean;
  /** A NEW order may be placed right now (public and open). */
  readonly acceptsOrders: boolean;
}

/**
 * The ONE gate every customer-facing read and the order path ask (issue #190): setup readiness from the real rows, in the caller's transaction. It reads
 * the dish fact through the Menu port and the rest from the snapshot the caller already holds; it writes nothing and locks nothing.
 */
@Injectable()
export class ShopSetupGate {
  constructor(private readonly menu: MenuReadinessReader) {}

  async evaluate(context: TransactionContext, snapshot: ShopSnapshot): Promise<ShopGateResult> {
    const hasSellableItem = await this.menu.hasSellableItem(context, snapshot.shopId);
    return gateOf(snapshot, hasSellableItem);
  }
}

export function gateOf(snapshot: ShopSnapshot, hasSellableItem: boolean): ShopGateResult {
  const setup = evaluateSetup(factsOf(snapshot, hasSellableItem));
  const availability = effectiveAvailability(snapshot.availability, hasSellableItem);
  const publicVisible = setup.publicVisible && isPublicReason(availability.reason);
  return { setup, availability, publicVisible, acceptsOrders: publicVisible && availability.online };
}
