import { TransactionContext } from '../transaction/transaction-context';

// The adapter M07 talks to now that M10 (food orders) exists. M07 never reads an Order table: a delivery that carries an Order asks this port (implemented by
// the Orders module, bound in DeliveryModule) whether a new call is allowed, and reports a completed delivery to the CURRENT Order. A direct call (an outside
// order, no Order record at all) never touches it.
//
// Lock order of the whole system, which this port must respect: ... shop -> Shipper (driver) -> DELIVERY -> ORDER. Both methods run in a transaction that
// already holds the delivery (or no delivery row at all) and may lock the Order row; they never lock a driver or a delivery.

export interface OrderDeliveryPort {
  /**
   * A new call (recall) for a delivery of this Order: the Order must belong to the shop and still be running (confirmed, not ended). Locks the Order row.
   * Throws ORDER_NOT_FOUND / ORDER_STATE_CONFLICT.
   */
  assertMayCall(context: TransactionContext, orderId: string, shopId: string): Promise<void>;
  /** A delivery of the order completed: the current order becomes completed, exactly once (a repeat finds it completed and does nothing). */
  deliveryCompleted(context: TransactionContext, orderId: string, deliveryId: string): Promise<void>;
}

export const ORDER_DELIVERY_PORT = Symbol('ORDER_DELIVERY_PORT');
