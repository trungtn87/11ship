import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { ShippingFeeAgreementService } from '../shipping-policy/shipping-fee-agreement-service';
import { TransactionContext } from '../transaction/transaction-context';
import { CommissionHoldService } from '../wallet/commission-hold-service';
import { ActorType } from './delivery-constants';
import { AssignmentRow, DeliveryPatch, DeliveryRepository, DeliveryRow } from './delivery-repository';
import { stateAfterRelease } from './delivery-rules';

/** What the assignment says when a fee proposal of the Shipper who held the delivery was refused or ran out (the apps read these to say so in the Shipper's history). */
export const FEE_NOT_AGREED_REASON = 'Mức phí đề xuất không được đồng ý';
export const FEE_EXPIRED_REASON = 'Hết thời gian trả lời đề xuất phí';

export interface HandbackInput {
  readonly status: 'CANCELLED_BY_SHIPPER' | 'CANCELLED_BY_SYSTEM' | 'RELEASED_BY_ADMIN';
  readonly actor: ActorType;
  /** The reason kept on the assignment. */
  readonly reason: string | null;
  /** What the delivery's own history says when the search is over and it stops. */
  readonly stoppedReason: string;
  readonly nowMs: number;
}

/**
 * Ends ONE Shipper's turn on a delivery that has not been picked up and gives the delivery back to the search, in the caller's transaction. It is the single place
 * that does it, for the Shipper who gives the delivery up and for a fee proposal of the Shipper that the payer refused or let run out: the assignment ends, the commission
 * set aside is released (once: the hold is released by the assignment's own row), the fee that only this Shipper had agreed goes back to the original one and the delivery
 * returns to `waiting_driver` while the ORIGINAL search window is open, or the search stops when it is over. The window never restarts or grows.
 *
 * The caller holds, in the system's order, the Shipper (driver) row, the delivery row and this assignment, and has checked that the goods were not picked up.
 */
@Injectable()
export class DeliveryHandback {
  constructor(
    private readonly deliveries: DeliveryRepository,
    private readonly commission: CommissionHoldService,
    private readonly agreements: ShippingFeeAgreementService,
  ) {}

  async endTurn(context: TransactionContext, delivery: DeliveryRow, assignment: AssignmentRow, input: HandbackInput): Promise<{ readonly delivery: DeliveryRow; readonly next: 'waiting_driver' | 'search_stopped' }> {
    if (!(await this.deliveries.endAssignment(context, assignment.assignmentId, assignment.version, input.status, input.actor, input.reason))) {
      throw new TechnicalError('internal', 'Assignment changed under its lock');
    }
    const released = await this.commission.releaseCommission(context, assignment.assignmentId);
    if (released.kind === 'conflict') {
      throw new TechnicalError('internal', 'Commission hold was not releasable');
    }
    // The fee follows the agreement once the Shipper's part is taken out of it: an amount only this Shipper had agreed is the original again, and an agreed fee that is
    // asked again has no amount until the next Shipper and the payer settle it.
    const agreement = await this.agreements.holderLeft(context, delivery.deliveryId, assignment.driverId, input.nowMs);
    const fee: DeliveryPatch = agreement === undefined ? {} : this.#feeOf(delivery, agreement.finalFeeVnd);
    const next = stateAfterRelease(input.nowMs, delivery.searchExpiresAtMs);
    const after = await this.deliveries.update(
      context,
      delivery.deliveryId,
      delivery.version,
      next === 'waiting_driver' ? { ...fee, state: 'waiting_driver' } : { ...fee, state: 'search_stopped', searchStoppedNow: true, endedNow: true, endReason: input.stoppedReason },
    );
    if (after === undefined) {
      throw new TechnicalError('internal', 'Delivery changed under its lock');
    }
    return { delivery: after, next };
  }

  /**
   * A fee proposal of the Shipper who HOLDS the delivery was refused or ran out: their turn ends with it (no delivery without a fee the payer agreed to, and no Shipper
   * stuck on one). Nothing happens when the proposal was made before anybody held the delivery, or the holder is somebody else.
   */
  async endProposerTurn(context: TransactionContext, delivery: DeliveryRow, proposerDriverId: string, input: HandbackInput): Promise<{ readonly delivery: DeliveryRow; readonly next: 'waiting_driver' | 'search_stopped' } | undefined> {
    if (delivery.state !== 'accepted' && delivery.state !== 'location_confirmed') {
      return undefined;
    }
    const assignment = await this.deliveries.lockActiveAssignment(context, delivery.deliveryId);
    if (assignment === undefined || assignment.driverId !== proposerDriverId) {
      return undefined;
    }
    return this.endTurn(context, delivery, assignment, input);
  }

  #feeOf(delivery: DeliveryRow, finalFeeVnd: number | null): DeliveryPatch {
    return finalFeeVnd === delivery.feeVnd ? {} : { feeVnd: finalFeeVnd };
  }
}
