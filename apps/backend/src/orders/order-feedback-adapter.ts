import { Injectable } from '@nestjs/common';
import { FeedbackOrderPort, OrderFact } from '../feedback/feedback-order-port';
import { TransactionContext } from '../transaction/transaction-context';
import { OrderRepository } from './order-repository';

/**
 * What M11 (ratings and complaints) may ask of the Orders module (the port it owns): an ORDER belongs to the customer ACCOUNT that placed it (never to someone
 * who merely shares a phone number) and it is either completed or not. Read only; it takes no lock and changes nothing.
 */
@Injectable()
export class OrderFeedbackAdapter implements FeedbackOrderPort {
  constructor(private readonly orders: OrderRepository) {}

  async orderOfCustomer(context: TransactionContext, orderId: string, customerUserId: string): Promise<OrderFact | undefined> {
    const order = await this.orders.findOfCustomer(context, orderId, customerUserId);
    return order === undefined ? undefined : { orderId: order.orderId, code: order.code, shopId: order.shopId, shopName: order.shopName, completed: order.status === 'COMPLETED' };
  }
}
