import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppError, TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { CommissionHoldService } from '../wallet/commission-hold-service';
import { AddressChangeRepository } from '../address-change/address-change-repository';
import { OPERATIONS } from './delivery-constants';
import { DeliveryRecorder } from './delivery-recorder';
import { DeliveryRepository, DeliveryRow } from './delivery-repository';
import { creatorMayCancelAfterPickup, shopMayCancel } from './delivery-rules';

/**
 * Ends a delivery that has not been picked up. It is the ONE place that does it, for the shop's "hủy yêu cầu giao" (the Order stays), for "hủy đơn món" of M10
 * (the Order ends too) and for an Administration cancellation: the Shipper's assignment ends, the commission set aside is given back and the delivery
 * becomes `cancelled_by_merchant`, all in the caller's transaction.
 *
 * The caller holds, in this order, the user, session, (shop,) the Shipper holding the delivery and the delivery row, and has checked the version. After the
 * pickup it is refused (AFTER_PICKUP_NO_CANCEL) whatever the app shows. `viaOrder` only marks the history; the rules are the same.
 */
@Injectable()
export class DeliveryCancel {
  constructor(
    private readonly deliveries: DeliveryRepository,
    private readonly recorder: DeliveryRecorder,
    private readonly commission: CommissionHoldService,
    private readonly addressChanges?: AddressChangeRepository,
  ) {}

  async cancel(
    context: TransactionContext,
    actor: { readonly type: 'SHOP' | 'ADMIN' | 'CUSTOMER'; readonly userId: string } | { readonly type: 'SYSTEM'; readonly userId: null },
    delivery: DeliveryRow,
    reason: string,
    requestId: string,
    viaOrder: boolean,
  ): Promise<DeliveryRow> {
    if (delivery.state === 'delivering' || delivery.state === 'picked_up') {
      throw new AppError('AFTER_PICKUP_NO_CANCEL');
    }
    if (!shopMayCancel(delivery.state)) {
      throw new AppError('DELIVERY_STATE_CONFLICT');
    }
    const assignment = await this.deliveries.lockActiveAssignment(context, delivery.deliveryId);
    if (assignment !== undefined) {
      if (!(await this.deliveries.endAssignment(context, assignment.assignmentId, assignment.version, actor.type === 'SYSTEM' ? 'CANCELLED_BY_SYSTEM' : actor.type === 'CUSTOMER' ? 'CANCELLED_BY_CUSTOMER' : 'CANCELLED_BY_SHOP', actor.type, reason))) {
        throw new TechnicalError('internal', 'Assignment changed under its lock');
      }
      const released = await this.commission.releaseCommission(context, assignment.assignmentId);
      if (released.kind === 'conflict') {
        throw new TechnicalError('internal', 'Commission hold was not releasable');
      }
    }
    const after = await this.deliveries.update(context, delivery.deliveryId, delivery.version, {
      state: actor.type === 'SYSTEM' ? 'cancelled_by_system' : 'cancelled_by_merchant',
      ...(delivery.endedAtMs === null ? { endedNow: true as const } : {}),
      endReason: reason,
    });
    if (after === undefined) {
      throw new AppError('VERSION_CONFLICT');
    }
    if (this.addressChanges) {
      await this.addressChanges.expirePendingForDelivery(context, delivery.deliveryId, delivery.orderId, 'Chuyến giao hàng đã bị hủy');
    }
    await this.recorder.record(context, {
      delivery: after,
      type: actor.type === 'SYSTEM' ? 'cancelled_by_system' : actor.type === 'CUSTOMER' ? 'cancelled_by_customer' : 'cancelled_by_shop',
      actorType: actor.type,
      actorId: actor.userId,
      assignmentId: assignment?.assignmentId ?? null,
      driverId: assignment?.driverId ?? null,
      note: reason,
      operation: OPERATIONS.cancel,
      requestId,
      metadata: { had_shipper: assignment !== undefined, via_order: viaOrder, before_state: delivery.state, reason, assignment_id: assignment?.assignmentId ?? null, commission_status: assignment === undefined ? null : 'RELEASED' },
    });
    return after;
  }

  /**
   * The CREATOR's cancellation after pickup (Owner decision 2026-10-23): the customer of an ORDER or the shop of a DIRECT call. The Shipper's assignment ends
   * and the commission is given back (the delivery was not completed, nothing is charged), the delivery ends as cancelled, and an OPEN goods incident
   * records that the goods stay with the Shipper until the shop settles them: nothing says they are back at the shop and nothing completes the delivery.
   * Whether the Order ends too is the caller's business. The caller holds the Shipper, the delivery (and, for an ORDER, the Order) in the usual order.
   */
  async cancelAfterPickup(
    context: TransactionContext,
    actor: { readonly type: 'SHOP' | 'CUSTOMER'; readonly userId: string },
    delivery: DeliveryRow,
    reason: string,
    requestId: string,
  ): Promise<DeliveryRow> {
    if (!creatorMayCancelAfterPickup(delivery.state, delivery.source, actor.type)) {
      throw new AppError(delivery.state === 'delivering' || delivery.state === 'picked_up' ? 'CANCEL_NOT_ALLOWED' : 'DELIVERY_STATE_CONFLICT');
    }
    const assignment = await this.deliveries.lockActiveAssignment(context, delivery.deliveryId);
    if (assignment === undefined) {
      throw new TechnicalError('internal', 'A delivery in progress has no active assignment');
    }
    if (!(await this.deliveries.endAssignment(context, assignment.assignmentId, assignment.version, actor.type === 'SHOP' ? 'CANCELLED_BY_SHOP' : 'CANCELLED_BY_CUSTOMER', actor.type, reason))) {
      throw new TechnicalError('internal', 'Assignment changed under its lock');
    }
    const released = await this.commission.releaseCommission(context, assignment.assignmentId);
    if (released.kind === 'conflict') {
      throw new TechnicalError('internal', 'Commission hold was not releasable');
    }
    const after = await this.deliveries.update(context, delivery.deliveryId, delivery.version, { state: 'cancelled_by_merchant', endedNow: true, endReason: reason });
    if (after === undefined) {
      throw new AppError('VERSION_CONFLICT');
    }
    if (this.addressChanges) {
      await this.addressChanges.expirePendingForDelivery(context, delivery.deliveryId, delivery.orderId, 'Chuyến giao hàng đã bị hủy');
    }
    await this.deliveries.insertIncident(context, {
      incidentId: randomUUID(),
      deliveryId: delivery.deliveryId,
      assignmentId: assignment.assignmentId,
      driverId: assignment.driverId,
      reasonCode: 'OTHER',
      reasonNote: reason,
      goodsCondition: 'WITH_SHIPPER',
    });
    await this.recorder.record(context, {
      delivery: after,
      type: 'cancelled_after_pickup',
      actorType: actor.type,
      actorId: actor.userId,
      assignmentId: assignment.assignmentId,
      driverId: assignment.driverId,
      note: reason,
      operation: OPERATIONS.cancelAfterPickup,
      requestId,
      metadata: { before_state: delivery.state, source: delivery.source, reason, assignment_id: assignment.assignmentId, commission_status: 'RELEASED', goods_custody: 'SHIPPER' },
    });
    return after;
  }
}
