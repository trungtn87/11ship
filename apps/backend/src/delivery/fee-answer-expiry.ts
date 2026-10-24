import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DriverRepository } from '../driver/driver-repository';
import { AppError } from '../common/app-errors';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { ShippingFeeAgreementService } from '../shipping-policy/shipping-fee-agreement-service';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { OPERATIONS } from './delivery-constants';
import { DeliveryRecorder } from './delivery-recorder';
import { DeliveryRepository, DeliveryRow } from './delivery-repository';

const BATCH = 50;

/**
 * The payer's time to answer a fee a Shipper proposed (Owner decision 2026-10-24). When it runs out the offer is DROPPED: the agreement goes back to the shop's
 * proposal (event COUNTER_EXPIRED), the earlier fee stays, the delivery stays where it is and the search goes on while its own window lasts; nothing here
 * extends that window. Two callers, one rule:
 *  - the sweeper, for every offer whose time ran out;
 *  - the commands that answer an offer (shop, customer), BEFORE they look at it: a late answer is refused, and the expiry is written and COMMITTED here, in a
 *    transaction of its own, so refusing the answer (which rolls the command back) can never roll the expiry back with it.
 * Lock order is the system's: Shipper (driver) -> delivery -> agreement. Every pass re-reads the row under its locks and decides again, so an answer that wins
 * the race is not overtaken and a second pass finds nothing to do.
 */
@Injectable()
export class FeeAnswerExpiry {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly deliveries: DeliveryRepository,
    private readonly drivers: DriverRepository,
    private readonly agreements: ShippingFeeAgreementService,
    private readonly recorder: DeliveryRecorder,
  ) {}

  /** Drops every offer whose answer time ran out; returns how many were dropped. */
  async sweep(): Promise<number> {
    const due = await this.transactions.withTransaction(async (context) => this.agreements.answerDue(context, await freshClockMs(context), BATCH));
    let count = 0;
    for (const item of due) {
      count += await this.#expire(item.deliveryId);
    }
    return count;
  }

  /** Before an answer is attempted: drops the offer of this delivery if its time ran out. True when it was dropped now. */
  async expireIfDue(deliveryId: string): Promise<boolean> {
    return (await this.#expire(deliveryId)) > 0;
  }

  /**
   * Runs an answering command. If it is refused as FEE_ANSWER_EXPIRED (its transaction rolled back, and with it any expiry it wrote itself in the narrow case where
   * the time ran out between the check before it and the answer), the expiry is written again in a transaction of its own before the refusal goes out: the offer
   * is saved as expired whatever way the late answer was turned away.
   */
  async saveExpiryIfRefused<T>(run: () => Promise<T>, drop: () => Promise<boolean>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof AppError && error.code === 'FEE_ANSWER_EXPIRED') {
        await drop();
      }
      throw error;
    }
  }

  /** The same, for the caller who knows only the order: every delivery of the order whose offer ran out is dropped. */
  async expireIfDueForOrder(orderId: string): Promise<boolean> {
    const ids = await this.transactions.withTransaction(async (context) => (await this.deliveries.listOfOrder(context, orderId)).map((d) => d.deliveryId));
    let dropped = false;
    for (const id of ids) {
      dropped = (await this.#expire(id)) > 0 || dropped;
    }
    return dropped;
  }

  async #expire(deliveryId: string): Promise<number> {
    return this.transactions.withTransaction(async (context): Promise<number> => {
      // The Shipper first (when one holds the delivery), then the delivery, then the agreement.
      const assignment = await this.deliveries.findActiveAssignment(context, deliveryId);
      if (assignment !== undefined) {
        await this.drivers.lockById(context, assignment.driverId);
      }
      const delivery = await this.deliveries.lockById(context, deliveryId);
      const agreement = await this.agreements.readByDelivery(context, deliveryId);
      if (delivery === undefined || agreement === undefined) {
        return 0;
      }
      const nowMs = await freshClockMs(context);
      const outcome = await this.agreements.act(context, {
        agreementId: agreement.agreementId,
        expectedVersion: agreement.version,
        requestId: randomUUID(),
        nowMs,
        action: { type: 'EXPIRE_ANSWER' },
      });
      // Not due (an answer won the race, or it was dropped by another pass): nothing was written.
      if (outcome.kind !== 'ok' && outcome.kind !== 'expired') {
        return 0;
      }
      if (delivery.state === 'waiting_driver' || delivery.state === 'accepted' || delivery.state === 'location_confirmed') {
        const after = await this.deliveries.update(context, delivery.deliveryId, delivery.version, {});
        if (after !== undefined) {
          await this.#record(context, after, outcome.agreement.status, agreement.counterBy ?? agreement.boundDriverId);
        }
      }
      return 1;
    });
  }

  async #record(context: TransactionContext, delivery: DeliveryRow, agreementStatus: string, driverId: string | null): Promise<void> {
    await this.recorder.record(context, {
      delivery,
      type: 'fee_answer_expired',
      actorType: 'SYSTEM',
      actorId: null,
      driverId,
      operation: OPERATIONS.feeAnswerExpired,
      requestId: randomUUID(),
      note: 'Hết thời gian trả lời đề xuất phí',
      metadata: { agreement_status: agreementStatus, fee_payer: delivery.feePayer },
    });
  }
}
