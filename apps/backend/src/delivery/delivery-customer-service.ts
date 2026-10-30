import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AuthPrincipal } from '../auth/auth-principal';
import { AppError, TechnicalError } from '../common/app-errors';
import { IdempotencyExecutor, IdempotentOutcome, JsonObject } from '../idempotency/idempotency-executor';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { DriverRepository } from '../driver/driver-repository';
import { answerIsWaiting } from '../shipping-policy/shipping-fee-agreement';
import { ShippingFeeAgreementService } from '../shipping-policy/shipping-fee-agreement-service';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { CommissionHoldService } from '../wallet/commission-hold-service';
import { DELIVERY_SCOPE_TYPE, OPERATIONS } from './delivery-constants';
import { DeliveryCancel } from './delivery-cancel';
import { FeeAnswerExpiry } from './fee-answer-expiry';
import { DeliveryHandback } from './delivery-handback';
import { DeliveryRecorder } from './delivery-recorder';
import { DeliveryRepository, NewDelivery } from './delivery-repository';
import { dropoffAreaOf, locationValid, newDeliveryCode } from './delivery-rules';
import { CreateCustomerDeliveryInput, ReasonInput, VersionInput } from './delivery-validation';
import { DeliveryViews } from './delivery-views';
import { M14RouteClient } from './m14-route-client';
import { ShipperLocationRepository } from './shipper-location';

export interface PublicTrackResult {
  readonly status: 'ACTIVE' | 'EXPIRED';
  readonly message?: string;
  readonly code?: string;
  readonly state?: string;
  readonly ended?: boolean;
  readonly goods_description?: string;
  readonly cod_vnd?: number;
  readonly recipient_pays_vnd?: number | null;
  readonly fee_payer?: string;
  readonly updated_at?: string;
  readonly location?: {
    readonly lat: number;
    readonly lng: number;
    readonly recorded_at: string;
    readonly is_stale: boolean;
  } | null;
}

@Injectable()
export class DeliveryCustomerService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly executor: IdempotencyExecutor,
    private readonly deliveries: DeliveryRepository,
    private readonly drivers: DriverRepository,
    private readonly views: DeliveryViews,
    private readonly recorder: DeliveryRecorder,
    private readonly agreements: ShippingFeeAgreementService,
    private readonly commission: CommissionHoldService,
    private readonly cancelling: DeliveryCancel,
    private readonly handback: DeliveryHandback,
    private readonly feeAnswers: FeeAnswerExpiry,
    private readonly routes: M14RouteClient,
    private readonly locations: ShipperLocationRepository,
  ) {}

  #replay(principal: AuthPrincipal) {
    return {
      kind: 'sensitive' as const,
      authorize: async (_context: TransactionContext, guard: JsonObject): Promise<true> => {
        if (guard.user_id !== principal.userId) {
          throw new TechnicalError('internal', 'Invalid replay guard');
        }
        return true;
      },
    };
  }

  // ---- reads -----------------------------------------------------------------------------------------------------------------

  async list(principal: AuthPrincipal, query: { scope?: 'active' | 'history' | 'all'; limit?: number }): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const nowMs = await freshClockMs(context);
      const limit = query.limit ?? 50;
      const activeRows = query.scope === 'history' ? [] : await this.deliveries.listActiveOfCustomer(context, principal.userId);
      const endedRows = query.scope === 'active' ? [] : await this.deliveries.listEndedOfCustomer(context, principal.userId, limit);
      const rows = query.scope === 'history' ? endedRows : query.scope === 'active' ? activeRows : [...activeRows, ...endedRows];
      return { deliveries: await Promise.all(rows.map((row) => this.views.forCustomer(context, row, nowMs))) };
    });
  }

  async read(principal: AuthPrincipal, deliveryId: string): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const delivery = await this.deliveries.findOfCustomer(context, deliveryId, principal.userId);
      if (delivery === undefined) {
        throw new AppError('DELIVERY_NOT_FOUND');
      }
      return this.views.forCustomer(context, delivery, await freshClockMs(context));
    });
  }

  // ---- create ----------------------------------------------------------------------------------------------------------------

  async create(principal: AuthPrincipal, input: CreateCustomerDeliveryInput, key: string | readonly string[] | undefined, requestId: string): Promise<IdempotentOutcome> {
    const hasBothPins = input.pickupLat !== null && input.pickupLng !== null && input.dropoffLat !== null && input.dropoffLng !== null;
    const route = hasBothPins ? await this.routes.route({ lat: input.pickupLat!, lng: input.pickupLng! }, { lat: input.dropoffLat!, lng: input.dropoffLng! }) : undefined;

    return this.executor.execute(
      {
        scopeType: DELIVERY_SCOPE_TYPE,
        scopeId: principal.userId,
        operationId: OPERATIONS.customerCreate ?? 'delivery.customer_create',
        idempotencyKey: key,
        logicalRequest: {
          sender_name: input.senderName,
          sender_phone: input.senderPhone,
          pickup_address_text: input.pickupAddressText,
          pickup_lat: input.pickupLat,
          pickup_lng: input.pickupLng,
          recipient_name: input.recipientName,
          recipient_phone: input.recipientPhone,
          dropoff_address_text: input.dropoffAddressText,
          dropoff_lat: input.dropoffLat,
          dropoff_lng: input.dropoffLng,
          goods_description: input.goodsDescription,
          goods_value_vnd: input.goodsValueVnd,
          cod_vnd: input.codVnd,
          fee_payer: input.feePayer,
          note: input.note,
          agreed_fee: input.agreedFee?.amountVnd ?? null,
        },
        replay: this.#replay(principal),
      },
      async (context) => {
        const distanceM = route?.distanceM ?? null;
        let standardFeeVnd: number | null = null;
        let feeMode: 'STANDARD' | 'AGREED' = input.agreedFee !== null ? 'AGREED' : 'STANDARD';

        if (input.agreedFee === null) {
          if (!hasBothPins || distanceM === null) {
            throw new AppError('FEE_REQUIRED');
          }
          const quote = await this.agreements.estimate(context, distanceM);
          if (quote.status === 'PRICED') {
            standardFeeVnd = quote.feeVnd;
          } else {
            throw new AppError(quote.reason === 'POLICY_NOT_CONFIGURED' ? 'POLICY_NOT_CONFIGURED' : quote.reason === 'OUT_OF_PRICE_RANGE' ? 'OUT_OF_PRICE_RANGE' : 'ROUTE_UNAVAILABLE');
          }
        } else {
          if (input.agreedFee.amountVnd <= 0) {
            throw new AppError('DELIVERY_INPUT_INVALID');
          }
          feeMode = 'AGREED';
        }

        const deliveryId = randomUUID();
        const base: NewDelivery = {
          deliveryId,
          code: newDeliveryCode(),
          source: 'CUSTOMER',
          orderId: null,
          previousDeliveryId: null,
          shopId: null,
          requestedBy: principal.userId,
          shopName: input.senderName,
          shopPhone: input.senderPhone,
          pickupAddressText: input.pickupAddressText,
          pickupLat: input.pickupLat,
          pickupLng: input.pickupLng,
          recipientName: input.recipientName,
          recipientPhone: input.recipientPhone,
          dropoffAddressText: input.dropoffAddressText,
          dropoffAreaText: dropoffAreaOf(input.dropoffAddressText),
          dropoffLat: input.dropoffLat,
          dropoffLng: input.dropoffLng,
          goodsDescription: input.goodsDescription,
          goodsValueVnd: input.goodsValueVnd,
          paidVnd: 0,
          codVnd: input.codVnd,
          note: input.note,
          dropoffNote: null,
          feeMode,
          feePayer: input.feePayer,
          feeVnd: standardFeeVnd ?? input.agreedFee?.amountVnd ?? null,
          routeDistanceM: distanceM,
        };

        let inserted = false;
        for (let attempt = 0; attempt < 6 && !inserted; attempt += 1) {
          inserted = await this.deliveries.insert(context, attempt === 0 ? base : { ...base, code: newDeliveryCode() });
        }
        if (!inserted) {
          throw new TechnicalError('internal', 'Could not allocate a delivery code');
        }

        const created = (await this.deliveries.findById(context, deliveryId))!;
        const agreementInput = {
          deliveryId,
          payer: input.feePayer,
          distanceM,
          createdBy: principal.userId,
          expiresAtMs: created.searchExpiresAtMs,
          requestId,
          nowMs: await freshClockMs(context),
        };

        if (feeMode === 'STANDARD' && standardFeeVnd !== null) {
          await this.agreements.createStandard(context, agreementInput);
        } else {
          if (!input.agreedFee || input.agreedFee.amountVnd <= 0) {
            throw new AppError('FEE_REQUIRED');
          }
          await this.agreements.createAgreed(context, {
            ...agreementInput,
            reasonCode: input.agreedFee.reasonCode,
            reasonNote: input.agreedFee.reasonNote ?? 'Khách gọi shipper',
            proposedFeeVnd: input.agreedFee.amountVnd,
          });
        }

        await this.recorder.record(context, {
          delivery: created,
          type: 'created',
          actorType: 'CUSTOMER',
          actorId: principal.userId,
          operation: OPERATIONS.customerCreate ?? 'delivery.customer_create',
          requestId,
          note: input.note,
        });

        return {
          status: 201,
          replayGuard: { user_id: principal.userId },
          payload: await this.views.forCustomer(context, created, await freshClockMs(context)),
        };
      },
    );
  }

  // ---- cancel ----------------------------------------------------------------------------------------------------------------

  async cancel(principal: AuthPrincipal, deliveryId: string, input: ReasonInput, key: string | readonly string[] | undefined, requestId: string): Promise<IdempotentOutcome> {
    return this.executor.execute(
      {
        scopeType: DELIVERY_SCOPE_TYPE,
        scopeId: principal.userId,
        operationId: OPERATIONS.cancel,
        idempotencyKey: key,
        logicalRequest: { delivery_id: deliveryId, reason: input.reason, expected_version: input.expectedVersion },
        replay: this.#replay(principal),
      },
      async (context) => {
        const delivery = await this.deliveries.findOfCustomer(context, deliveryId, principal.userId);
        if (delivery === undefined) throw new AppError('DELIVERY_NOT_FOUND');
        if (delivery.version !== input.expectedVersion) throw new AppError('VERSION_CONFLICT');

        const cancelled = await this.cancelling.cancel(
          context,
          { type: 'CUSTOMER', userId: principal.userId },
          delivery,
          input.reason,
          requestId,
          false,
        );

        return {
          status: 200,
          replayGuard: { user_id: principal.userId },
          payload: await this.views.forCustomer(context, cancelled, await freshClockMs(context)),
        };
      },
    );
  }

  async cancelAfterPickup(principal: AuthPrincipal, deliveryId: string, input: ReasonInput, key: string | readonly string[] | undefined, requestId: string): Promise<IdempotentOutcome> {
    return this.executor.execute(
      {
        scopeType: DELIVERY_SCOPE_TYPE,
        scopeId: principal.userId,
        operationId: OPERATIONS.cancelAfterPickup,
        idempotencyKey: key,
        logicalRequest: { delivery_id: deliveryId, reason: input.reason, expected_version: input.expectedVersion },
        replay: this.#replay(principal),
      },
      async (context) => {
        const delivery = await this.deliveries.findOfCustomer(context, deliveryId, principal.userId);
        if (delivery === undefined) throw new AppError('DELIVERY_NOT_FOUND');
        if (delivery.version !== input.expectedVersion) throw new AppError('VERSION_CONFLICT');

        const cancelled = await this.cancelling.cancelAfterPickup(
          context,
          { type: 'CUSTOMER', userId: principal.userId },
          delivery,
          input.reason,
          requestId,
        );

        return {
          status: 200,
          replayGuard: { user_id: principal.userId },
          payload: await this.views.forCustomer(context, cancelled, await freshClockMs(context)),
        };
      },
    );
  }

  // ---- fee decisions ---------------------------------------------------------------------------------------------------------

  async counterAccept(principal: AuthPrincipal, deliveryId: string, input: VersionInput, key: string | readonly string[] | undefined, requestId: string): Promise<IdempotentOutcome> {
    return this.executor.execute(
      {
        scopeType: DELIVERY_SCOPE_TYPE,
        scopeId: principal.userId,
        operationId: OPERATIONS.counterAccept,
        idempotencyKey: key,
        logicalRequest: { delivery_id: deliveryId, expected_version: input.expectedVersion },
        replay: this.#replay(principal),
      },
      async (context) => {
        const delivery = await this.deliveries.findOfCustomer(context, deliveryId, principal.userId);
        if (delivery === undefined) throw new AppError('DELIVERY_NOT_FOUND');

        const agreement = await this.agreements.readByDelivery(context, delivery.deliveryId);
        if (agreement === undefined) throw new AppError('DELIVERY_STATE_CONFLICT');

        if (!answerIsWaiting(agreement) && (await this.agreements.answerWasDropped(context, agreement.agreementId))) {
          throw new AppError('FEE_ANSWER_EXPIRED');
        }
        if (delivery.version !== input.expectedVersion) {
          throw new AppError('VERSION_CONFLICT');
        }

        const nowMs = await freshClockMs(context);
        let outcome = await this.agreements.act(context, {
          agreementId: agreement.agreementId,
          expectedVersion: agreement.version,
          requestId: `${requestId}:shop_accept`,
          nowMs,
          action: { type: 'SHOP_ACCEPT_COUNTER' },
          actorUserId: principal.userId,
          answeredBy: 'CUSTOMER',
        });

        if (outcome.kind === 'ok' && outcome.agreement.status === 'AWAITING_CUSTOMER') {
          outcome = await this.agreements.act(context, {
            agreementId: agreement.agreementId,
            expectedVersion: outcome.agreement.version,
            requestId: `${requestId}:confirm`,
            nowMs: await freshClockMs(context),
            action: { type: 'CUSTOMER_CONFIRM', approve: true },
            actorUserId: principal.userId,
            answeredBy: 'CUSTOMER',
          });
        }

        if (outcome.kind !== 'ok' && outcome.kind !== 'replayed') {
          throw new AppError(outcome.kind === 'answer_expired' ? 'FEE_ANSWER_EXPIRED' : 'VERSION_CONFLICT');
        }

        let updated = delivery;
        if (outcome.agreement.finalFeeVnd !== null && outcome.agreement.finalFeeVnd !== delivery.feeVnd) {
          const patched = await this.deliveries.update(context, delivery.deliveryId, delivery.version, { feeVnd: outcome.agreement.finalFeeVnd });
          if (patched !== undefined) updated = patched;
        }

        return {
          status: 200,
          replayGuard: { user_id: principal.userId },
          payload: await this.views.forCustomer(context, updated, await freshClockMs(context)),
        };
      },
    );
  }

  async counterReject(principal: AuthPrincipal, deliveryId: string, input: VersionInput, key: string | readonly string[] | undefined, requestId: string): Promise<IdempotentOutcome> {
    return this.executor.execute(
      {
        scopeType: DELIVERY_SCOPE_TYPE,
        scopeId: principal.userId,
        operationId: OPERATIONS.counterReject,
        idempotencyKey: key,
        logicalRequest: { delivery_id: deliveryId, expected_version: input.expectedVersion },
        replay: this.#replay(principal),
      },
      async (context) => {
        const delivery = await this.deliveries.findOfCustomer(context, deliveryId, principal.userId);
        if (delivery === undefined) throw new AppError('DELIVERY_NOT_FOUND');

        const agreement = await this.agreements.readByDelivery(context, delivery.deliveryId);
        if (agreement === undefined) throw new AppError('DELIVERY_STATE_CONFLICT');

        if (!answerIsWaiting(agreement) && (await this.agreements.answerWasDropped(context, agreement.agreementId))) {
          throw new AppError('FEE_ANSWER_EXPIRED');
        }
        if (delivery.version !== input.expectedVersion) {
          throw new AppError('VERSION_CONFLICT');
        }

        const nowMs = await freshClockMs(context);
        const outcome = await this.agreements.act(context, {
          agreementId: agreement.agreementId,
          expectedVersion: agreement.version,
          requestId: `${requestId}:shop_reject`,
          nowMs,
          action: { type: 'SHOP_REJECT_COUNTER' },
          actorUserId: principal.userId,
          answeredBy: 'CUSTOMER',
        });

        if (outcome.kind !== 'ok' && outcome.kind !== 'replayed') {
          throw new AppError(outcome.kind === 'answer_expired' ? 'FEE_ANSWER_EXPIRED' : 'VERSION_CONFLICT');
        }

        return {
          status: 200,
          replayGuard: { user_id: principal.userId },
          payload: await this.views.forCustomer(context, delivery, await freshClockMs(context)),
        };
      },
    );
  }

  // ---- tracking link management ----------------------------------------------------------------------------------------------

  async createTrackingLink(principal: AuthPrincipal, deliveryId: string, baseUrl?: string): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const delivery = await this.deliveries.findOfCustomer(context, deliveryId, principal.userId);
      if (delivery === undefined) {
        throw new AppError('DELIVERY_NOT_FOUND');
      }

      const existing = await this.deliveries.findTrackingLinkByDeliveryId(context, deliveryId);
      if (existing !== undefined) {
        await this.deliveries.updateTrackingLink(context, existing.trackingId, { revoked: true });
      }

      const token = randomBytes(24).toString('base64url');
      const tokenHash = createHash('sha256').update(token).digest('hex');
      const trackingId = randomUUID();

      await this.deliveries.insertTrackingLink(context, {
        trackingId,
        deliveryId,
        tokenHash,
        shareLocation: false,
      });

      const trackingUrl = baseUrl ? `${baseUrl.replace(/\/+$/, '')}/track/${token}` : `/track/${token}`;

      return {
        tracking_id: trackingId,
        token,
        tracking_url: trackingUrl,
        share_location: false,
      };
    });
  }

  async getTrackingLinkStatus(principal: AuthPrincipal, deliveryId: string): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const delivery = await this.deliveries.findOfCustomer(context, deliveryId, principal.userId);
      if (delivery === undefined) {
        throw new AppError('DELIVERY_NOT_FOUND');
      }

      const link = await this.deliveries.findTrackingLinkByDeliveryId(context, deliveryId);
      return {
        has_active_link: link !== undefined && !link.revoked,
        share_location: link?.shareLocation ?? false,
      };
    });
  }

  async toggleTrackingLocation(principal: AuthPrincipal, deliveryId: string, shareLocation: boolean): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const delivery = await this.deliveries.findOfCustomer(context, deliveryId, principal.userId);
      if (delivery === undefined) {
        throw new AppError('DELIVERY_NOT_FOUND');
      }

      const link = await this.deliveries.findTrackingLinkByDeliveryId(context, deliveryId);
      if (link === undefined) {
        throw new AppError('DELIVERY_STATE_CONFLICT');
      }

      await this.deliveries.updateTrackingLink(context, link.trackingId, { shareLocation });
      return {
        tracking_id: link.trackingId,
        share_location: shareLocation,
      };
    });
  }

  async revokeTrackingLink(principal: AuthPrincipal, deliveryId: string): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const delivery = await this.deliveries.findOfCustomer(context, deliveryId, principal.userId);
      if (delivery === undefined) {
        throw new AppError('DELIVERY_NOT_FOUND');
      }

      const link = await this.deliveries.findTrackingLinkByDeliveryId(context, deliveryId);
      if (link !== undefined) {
        await this.deliveries.updateTrackingLink(context, link.trackingId, { revoked: true });
      }

      return { revoked: true };
    });
  }

  // ---- public tracking read --------------------------------------------------------------------------------------------------

  async publicTrack(token: string): Promise<PublicTrackResult> {
    return this.transactions.withTransaction(async (context) => {
      const tokenHash = createHash('sha256').update(token).digest('hex');
      const link = await this.deliveries.findTrackingLinkByTokenHash(context, tokenHash);
      if (link === undefined || link.revoked) {
        return { status: 'EXPIRED', message: 'Liên kết theo dõi không tồn tại hoặc đã hết hiệu lực' };
      }

      const delivery = await this.deliveries.findById(context, link.deliveryId);
      if (delivery === undefined) {
        return { status: 'EXPIRED', message: 'Chuyến giao không tồn tại' };
      }

      const ended = ['completed', 'failed', 'cancelled_by_merchant', 'cancelled_by_system', 'search_stopped'].includes(delivery.state);
      if (ended) {
        return {
          status: 'EXPIRED',
          code: delivery.displayCode ?? delivery.code,
          state: delivery.state,
          ended: true,
          message: 'Chuyến giao đã kết thúc',
        };
      }

      let location: PublicTrackResult['location'] = null;
      if (link.shareLocation && delivery.pickupLat !== null && delivery.dropoffLat !== null) {
        const assignment = await this.deliveries.findActiveAssignment(context, delivery.deliveryId);
        if (assignment !== undefined && (delivery.state === 'picked_up' || delivery.state === 'delivering')) {
          const loc = await this.locations.find(context, assignment.driverId);
          if (loc !== undefined && locationValid(loc.lat, loc.lng, loc.accuracyM)) {
            location = {
              lat: loc.lat,
              lng: loc.lng,
              recorded_at: new Date(loc.recordedAtMs).toISOString(),
              is_stale: loc.ageSeconds > 120,
            };
          }
        }
      }

      const recipientPaysVnd = delivery.source === 'CUSTOMER'
        ? (delivery.feePayer === 'RECIPIENT' ? (delivery.feeVnd !== null ? delivery.codVnd + delivery.feeVnd : null) : delivery.codVnd)
        : (delivery.goodsValueVnd - delivery.paidVnd + (delivery.feePayer === 'CUSTOMER' && delivery.feeVnd !== null ? delivery.feeVnd : 0));

      return {
        status: 'ACTIVE',
        code: delivery.displayCode ?? delivery.code,
        state: delivery.state,
        goods_description: delivery.goodsDescription,
        cod_vnd: delivery.codVnd,
        recipient_pays_vnd: recipientPaysVnd,
        fee_payer: delivery.feePayer,
        updated_at: new Date(delivery.updatedAtMs).toISOString(),
        location,
      };
    });
  }
}
