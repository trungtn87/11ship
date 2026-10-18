import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppError, TechnicalError } from '../common/app-errors';
import { OrderDeliveryPort } from '../delivery/delivery-order-port';
import { TransactionContext } from '../transaction/transaction-context';
import { ORDER_OPERATIONS } from './order-constants';
import { OrderRecorder } from './order-recorder';
import { OrderRepository } from './order-repository';

/**
 * What M07 may ask of the Orders module (the port it owns): a new call is allowed only for a confirmed, running Order of that shop, and a COMPLETED delivery
 * completes the Order exactly once. It sits in the Orders core module (repository + recorder only) so M07 depends on it and not the other way round.
 *
 * Lock order: both methods run while the caller holds the delivery row (or no delivery row) and lock only the ORDER row, the last lock of every path
 * (user, session, shop, Shipper, delivery, order).
 */
@Injectable()
export class OrderDeliveryAdapter implements OrderDeliveryPort {
  constructor(
    private readonly orders: OrderRepository,
    private readonly recorder: OrderRecorder,
  ) {}

  async assertMayCall(context: TransactionContext, orderId: string, shopId: string): Promise<void> {
    const order = await this.orders.lockById(context, orderId);
    if (order === undefined || order.shopId !== shopId) {
      throw new AppError('ORDER_NOT_FOUND');
    }
    if (order.status !== 'PREPARING') {
      throw new AppError('ORDER_STATE_CONFLICT');
    }
  }

  async deliveryCompleted(context: TransactionContext, orderId: string, deliveryId: string): Promise<void> {
    const order = await this.orders.lockById(context, orderId);
    if (order === undefined) {
      throw new TechnicalError('internal', 'The order of a completed delivery vanished');
    }
    if (order.status === 'COMPLETED') {
      // A repeated or late report: the Order was completed by the delivery that finished first. Nothing is done twice.
      return;
    }
    if (order.status !== 'PREPARING') {
      throw new TechnicalError('internal', 'A delivery completed for an order that is not running');
    }
    const after = await this.orders.update(context, orderId, order.version, { status: 'COMPLETED', endedNow: 'SYSTEM', endReason: null });
    if (after === undefined) {
      throw new TechnicalError('internal', 'Order changed under its lock');
    }
    await this.recorder.record(context, {
      order: after,
      type: 'completed',
      actorType: 'SYSTEM',
      actorId: null,
      note: 'Giao hàng thành công',
      operation: ORDER_OPERATIONS.completed,
      requestId: randomUUID(),
      metadata: { delivery_id: deliveryId },
    });
  }
}
