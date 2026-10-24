import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { CUSTOMER_ROLE } from '../auth/auth-constants';
import { AuthPrincipal } from '../auth/auth-principal';
import { UserRepository } from '../auth/user-repository';
import { ClientActor, ClientSessionAuthority } from '../client-auth/client-session-authority';
import { AppError, TechnicalError } from '../common/app-errors';
import { ACTIVE_STATES, OPERATIONS } from '../delivery/delivery-constants';
import { DeliveryCancel } from '../delivery/delivery-cancel';
import { DeliveryRecorder } from '../delivery/delivery-recorder';
import { FeeAnswerExpiry } from '../delivery/fee-answer-expiry';
import { DeliveryRepository, DeliveryRow } from '../delivery/delivery-repository';
import { creatorMayCancelAfterPickup } from '../delivery/delivery-rules';
import { feeDeciderOf } from '../delivery/delivery-views';
import { DriverRepository } from '../driver/driver-repository';
import { IdempotencyExecutor, IdempotentOutcome, JsonObject } from '../idempotency/idempotency-executor';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { AgreementAction, answerIsWaiting } from '../shipping-policy/shipping-fee-agreement';
import { ShippingFeeAgreementService } from '../shipping-policy/shipping-fee-agreement-service';
import { isCanonicalUuid } from '../shared/identifiers';
import { TransactionContext } from '../transaction/transaction-context';
import { ORDER_OPERATIONS, ORDER_SCOPE_TYPE } from './order-constants';
import { OrderRecorder } from './order-recorder';
import { OrderRepository, OrderRow } from './order-repository';
import { FeeDecisionInput, ReasonInput } from './order-validation';
import { OrderViews } from './order-views';

/**
 * What the CUSTOMER of an ORDER may do to the delivery of their own order after the shop confirmed it (Owner decision 2026-10-23, 11Food):
 *  - answer the delivery fee a Shipper proposed, when the customer is the one who pays it (a refusal sends the delivery back to the search at its earlier
 *    fee; the Order is untouched);
 *  - cancel the Order after the Shipper has picked up the goods: the creator of the request owns that cancellation. The Shipper's commission is given back,
 *    the goods stay the Shipper's responsibility until the shop settles them (an OPEN goods incident), and nothing completes the delivery.
 * Lock order is the whole system's: user -> session -> Shipper (driver) -> delivery -> Order (this path takes no shop lock, so it cannot wait on the shop's).
 */
@Injectable()
export class OrderCustomerDeliveryService {
  constructor(
    private readonly executor: IdempotencyExecutor,
    private readonly authority: ClientSessionAuthority,
    private readonly users: UserRepository,
    private readonly orders: OrderRepository,
    private readonly orderRecorder: OrderRecorder,
    private readonly views: OrderViews,
    private readonly deliveries: DeliveryRepository,
    private readonly drivers: DriverRepository,
    private readonly agreements: ShippingFeeAgreementService,
    private readonly cancelling: DeliveryCancel,
    private readonly deliveryRecorder: DeliveryRecorder,
    private readonly feeAnswers: FeeAnswerExpiry,
  ) {}

  async #customer(context: TransactionContext, principal: AuthPrincipal): Promise<ClientActor> {
    const actor = await this.authority.lock(context, principal, 'update');
    if (actor.app !== 'FOOD' || !(await this.users.hasRole(context, actor.userId, CUSTOMER_ROLE))) {
      throw new AppError('ROLE_NOT_AVAILABLE');
    }
    return actor;
  }

  #replay(principal: AuthPrincipal) {
    return {
      kind: 'sensitive' as const,
      authorize: async (context: TransactionContext, guard: JsonObject): Promise<true> => {
        if (!isCanonicalUuid(guard.user_id) || guard.user_id !== principal.userId) {
          throw new TechnicalError('internal', 'Invalid replay guard');
        }
        await this.#customer(context, principal);
        return true;
      },
    };
  }

  /** The running delivery of the customer's own Order, with its Shipper (if any) locked FIRST and then the delivery itself. */
  async #lockRunning(context: TransactionContext, actor: ClientActor, orderId: string): Promise<DeliveryRow> {
    const peek = await this.orders.findOfCustomer(context, orderId, actor.userId);
    if (peek === undefined) {
      throw new AppError('ORDER_NOT_FOUND');
    }
    const running = (await this.deliveries.listOfOrder(context, orderId)).find((d) => ACTIVE_STATES.includes(d.state));
    if (running === undefined) {
      throw new AppError('ORDER_STATE_CONFLICT');
    }
    const peeked = await this.deliveries.findActiveAssignment(context, running.deliveryId);
    if (peeked !== undefined) {
      await this.drivers.lockById(context, peeked.driverId);
    }
    const delivery = await this.deliveries.lockById(context, running.deliveryId);
    if (delivery === undefined || delivery.orderId !== orderId) {
      throw new AppError('ORDER_NOT_FOUND');
    }
    if ((await this.deliveries.findActiveAssignment(context, delivery.deliveryId))?.driverId !== peeked?.driverId) {
      throw new AppError('DELIVERY_STATE_CONFLICT');
    }
    return delivery;
  }

  // ---- the fee the Shipper proposed ------------------------------------------------------------------------------------------

  async decideFee(principal: AuthPrincipal, orderId: string, input: FeeDecisionInput, key: string | readonly string[] | undefined, requestId: string): Promise<IdempotentOutcome> {
    // An offer whose answer time ran out is dropped and COMMITTED first, in its own transaction: refusing the late answer below rolls this command back and the
    // expiry must survive that.
    await this.feeAnswers.expireIfDueForOrder(orderId);
    return this.feeAnswers.saveExpiryIfRefused(() => this.#decideFeeRun(principal, orderId, input, key, requestId), () => this.feeAnswers.expireIfDueForOrder(orderId));
  }

  async #decideFeeRun(principal: AuthPrincipal, orderId: string, input: FeeDecisionInput, key: string | readonly string[] | undefined, requestId: string): Promise<IdempotentOutcome> {
    return this.executor.execute(
      {
        scopeType: ORDER_SCOPE_TYPE,
        scopeId: principal.userId,
        operationId: OPERATIONS.customerFee,
        idempotencyKey: key,
        logicalRequest: { order_id: orderId, accept: input.accept, expected_version: input.expectedVersion },
        replay: this.#replay(principal),
      },
      async (context) => {
        const actor = await this.#customer(context, principal);
        const delivery = await this.#lockRunning(context, actor, orderId);
        if (delivery.version !== input.expectedVersion) {
          throw new AppError('VERSION_CONFLICT');
        }
        if (delivery.state !== 'waiting_driver' && delivery.state !== 'accepted' && delivery.state !== 'location_confirmed') {
          throw new AppError('DELIVERY_STATE_CONFLICT');
        }
        if (feeDeciderOf(delivery) !== 'CUSTOMER') {
          throw new AppError('DELIVERY_STATE_CONFLICT');
        }
        const agreement = await this.agreements.readByDelivery(context, delivery.deliveryId);
        if (agreement !== undefined && !answerIsWaiting(agreement) && (await this.agreements.answerWasDropped(context, agreement.agreementId))) {
          throw new AppError('FEE_ANSWER_EXPIRED');
        }
        if (agreement === undefined || (agreement.status !== 'COUNTERED' && agreement.status !== 'AWAITING_CUSTOMER')) {
          throw new AppError('DELIVERY_STATE_CONFLICT');
        }
        // Refusing the SHOP's own proposal would leave the request without any fee: only a Shipper's counter-offer can be refused (the shop cancels otherwise).
        const refusable = agreement.status === 'COUNTERED' || agreement.pendingSource === 'COUNTER';
        if (!input.accept && !refusable) {
          throw new AppError('DELIVERY_STATE_CONFLICT');
        }
        const steps: AgreementAction[] =
          agreement.status === 'COUNTERED'
            ? input.accept
              ? [{ type: 'SHOP_ACCEPT_COUNTER' }, { type: 'CUSTOMER_CONFIRM', approve: true }]
              : [{ type: 'SHOP_REJECT_COUNTER' }]
            : [{ type: 'CUSTOMER_CONFIRM', approve: input.accept }];
        let current = agreement;
        let last: Awaited<ReturnType<ShippingFeeAgreementService['act']>> | undefined;
        for (const action of steps) {
          if (action.type === 'CUSTOMER_CONFIRM' && current.status !== 'AWAITING_CUSTOMER') {
            break; // settled without needing the customer's confirmation (the amount was the base fee)
          }
          last = await this.agreements.act(context, {
            agreementId: current.agreementId,
            expectedVersion: current.version,
            requestId: randomUUID(),
            nowMs: await freshClockMs(context),
            action,
            actorUserId: actor.userId,
            ...(action.type === 'CUSTOMER_CONFIRM' ? {} : { answeredBy: 'CUSTOMER' as const }),
          });
          if (last.kind === 'conflict') {
            throw new AppError('VERSION_CONFLICT');
          }
          if (last.kind === 'answer_expired') {
            throw new AppError('FEE_ANSWER_EXPIRED');
          }
          if (last.kind !== 'ok' && last.kind !== 'replayed') {
            throw new AppError(last.kind === 'expired' ? 'DELIVERY_SEARCH_EXPIRED' : 'DELIVERY_STATE_CONFLICT');
          }
          current = last.agreement;
        }
        if (last === undefined) {
          throw new AppError('DELIVERY_STATE_CONFLICT');
        }
        const after = await this.#touch(context, delivery, current.finalFeeVnd !== null && delivery.feeVnd === null ? { feeVnd: current.finalFeeVnd } : {});
        await this.deliveryRecorder.record(context, {
          delivery: after,
          type: input.accept ? 'fee_counter_accepted' : 'fee_counter_rejected',
          actorType: 'CUSTOMER',
          actorId: actor.userId,
          operation: OPERATIONS.customerFee,
          requestId,
          metadata: { agreement_status: current.status, decided_by: 'CUSTOMER' },
        });
        const order = await this.orders.findOfCustomer(context, orderId, actor.userId);
        return { status: 200, replayGuard: { user_id: actor.userId }, payload: await this.views.forCustomer(context, order as OrderRow, true) };
      },
    );
  }

  async #touch(context: TransactionContext, delivery: DeliveryRow, patch: Parameters<DeliveryRepository['update']>[3]): Promise<DeliveryRow> {
    const updated = await this.deliveries.update(context, delivery.deliveryId, delivery.version, patch);
    if (updated === undefined) {
      throw new AppError('VERSION_CONFLICT');
    }
    return updated;
  }

  // ---- cancelling after pickup -----------------------------------------------------------------------------------------------

  /**
   * "Hủy đơn" by the customer AFTER the Shipper picked up the goods. The Shipper cannot cancel or fail the delivery any more, and the shop is not the creator
   * of the request, so this is the ONE way an ORDER ends once it is on the road. The delivery ends cancelled, the Order ends cancelled by the customer, the
   * commission is given back, and the goods incident stays open for the shop. A refusal never changes anything.
   */
  async cancelAfterPickup(principal: AuthPrincipal, orderId: string, input: ReasonInput, key: string | readonly string[] | undefined, requestId: string): Promise<IdempotentOutcome> {
    return this.executor.execute(
      {
        scopeType: ORDER_SCOPE_TYPE,
        scopeId: principal.userId,
        operationId: ORDER_OPERATIONS.customerCancelAfterPickup,
        idempotencyKey: key,
        logicalRequest: { order_id: orderId, expected_version: input.expectedVersion, reason: input.reason },
        replay: this.#replay(principal),
      },
      async (context) => {
        const actor = await this.#customer(context, principal);
        const delivery = await this.#lockRunning(context, actor, orderId);
        const order = await this.orders.lockById(context, orderId);
        if (order === undefined || order.customerUserId !== actor.userId) {
          throw new AppError('ORDER_NOT_FOUND');
        }
        if (order.version !== input.expectedVersion) {
          throw new AppError('VERSION_CONFLICT');
        }
        if (order.status !== 'PREPARING') {
          throw new AppError('ORDER_STATE_CONFLICT');
        }
        if (!creatorMayCancelAfterPickup(delivery.state, delivery.source, 'CUSTOMER')) {
          // Before pickup the customer asks the shop; the order of another source never reaches this path.
          throw new AppError('ORDER_STATE_CONFLICT');
        }
        const reason = input.reason.slice(0, 200);
        await this.cancelling.cancelAfterPickup(context, { type: 'CUSTOMER', userId: actor.userId }, delivery, reason, requestId);
        const after = await this.orders.update(context, order.orderId, order.version, { status: 'CANCELLED_BY_CUSTOMER', endedNow: 'CUSTOMER', endReason: reason });
        if (after === undefined) {
          throw new AppError('VERSION_CONFLICT');
        }
        await this.orderRecorder.record(context, {
          order: after,
          type: 'cancelled_by_customer_after_pickup',
          actorType: 'CUSTOMER',
          actorId: actor.userId,
          note: reason,
          operation: ORDER_OPERATIONS.customerCancelAfterPickup,
          requestId,
          metadata: { delivery_id: delivery.deliveryId, before_state: delivery.state },
        });
        return { status: 200, replayGuard: { user_id: actor.userId }, payload: await this.views.forCustomer(context, after, true) };
      },
    );
  }
}
