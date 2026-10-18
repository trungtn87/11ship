import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../transaction/transaction-context';

// M10 (food orders) is not built. This is the adapter M07 talks to, so that the day it lands only this binding changes: a delivery can start from a
// CONFIRMED order (a snapshot of the dishes, the recipient, the price and the note), and a completed delivery is reported to the CURRENT order. Until
// then the default binding answers honestly that it is not connected: M07 refuses an order-based call (ORDER_MODULE_NOT_READY) and has nothing to
// report; a direct call (an outside order, no Order record at all) works fully and never needs this port. Nothing here fakes an order.

export interface OrderSnapshot {
  readonly orderId: string;
  readonly shopId: string;
  readonly recipientName: string;
  readonly recipientPhone: string;
  readonly addressText: string;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly goodsDescription: string;
  readonly goodsValueVnd: number;
  readonly paidVnd: number;
  readonly note: string | null;
}

export interface OrderDeliveryPort {
  /** True only when M10 is connected. */
  readonly integrated: boolean;
  /** The confirmed order of this shop, or undefined (not found / not confirmed / not connected). */
  snapshot(context: TransactionContext, orderId: string, shopId: string): Promise<OrderSnapshot | undefined>;
  /** A delivery of the order completed: the current order becomes completed. Runs in the delivery's transaction. */
  deliveryCompleted(context: TransactionContext, orderId: string, deliveryId: string): Promise<void>;
}

export const ORDER_DELIVERY_PORT = Symbol('ORDER_DELIVERY_PORT');

@Injectable()
export class NotIntegratedOrderDeliveryPort implements OrderDeliveryPort {
  readonly integrated = false;

  snapshot(): Promise<undefined> {
    return Promise.resolve(undefined);
  }

  deliveryCompleted(): Promise<void> {
    return Promise.resolve();
  }
}
