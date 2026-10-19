import { TransactionContext } from '../transaction/transaction-context';

// What M11 asks of M10 (food orders): whether an ORDER belongs to the customer ACCOUNT that placed it (never to someone who merely shares a phone number:
// a person who receives on behalf has no right of their own) and whether it is completed. The Orders module implements it (orders/order-feedback-adapter.ts).
// The shop's and the Shipper's flows go through deliveries (M07) and never need this port.

export interface OrderFact {
  readonly orderId: string;
  /** The code people see on the order. */
  readonly code: string;
  readonly shopId: string;
  readonly shopName: string;
  /** The order reached its final "completed" state. */
  readonly completed: boolean;
}

export interface FeedbackOrderPort {
  /** The order this customer account placed, or undefined (not found / somebody else's). */
  orderOfCustomer(context: TransactionContext, orderId: string, customerUserId: string): Promise<OrderFact | undefined>;
}

export const FEEDBACK_ORDER_PORT = Symbol('FEEDBACK_ORDER_PORT');
