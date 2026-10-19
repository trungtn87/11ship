import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../transaction/transaction-context';

// M10 (food orders) is not built. This is the adapter M11 talks to: whether an ORDER belongs to the customer ACCOUNT that placed it (never to someone who
// merely shares a phone number: a person who receives on behalf has no right of their own) and whether it is completed. Until M10 lands the default
// binding answers honestly that it is not connected, so the customer's rating and complaint refuse with ORDER_MODULE_NOT_READY and nothing is
// invented. The shop's and the Shipper's flows go through deliveries (M07) and never need this port.

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
  /** True only when M10 is connected. */
  readonly integrated: boolean;
  /** The order this customer account placed, or undefined (not found / somebody else's / not connected). */
  orderOfCustomer(context: TransactionContext, orderId: string, customerUserId: string): Promise<OrderFact | undefined>;
}

export const FEEDBACK_ORDER_PORT = Symbol('FEEDBACK_ORDER_PORT');

@Injectable()
export class NotIntegratedFeedbackOrderPort implements FeedbackOrderPort {
  readonly integrated = false;

  orderOfCustomer(): Promise<undefined> {
    return Promise.resolve(undefined);
  }
}
