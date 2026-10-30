import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AuthPrincipal } from '../auth/auth-principal';
import { AppError, TechnicalError } from '../common/app-errors';
import { ACTIVE_STATES } from '../delivery/delivery-constants';
import { DeliveryActors } from '../delivery/delivery-actors';
import { DeliveryRecorder } from '../delivery/delivery-recorder';
import { DeliveryRepository } from '../delivery/delivery-repository';
import { DeliveryViews } from '../delivery/delivery-views';
import { dropoffAreaOf } from '../delivery/delivery-rules';
import { M14RouteClient } from '../delivery/m14-route-client';
import { DriverRepository } from '../driver/driver-repository';
import { IdempotencyExecutor, IdempotentOutcome, JsonObject } from '../idempotency/idempotency-executor';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { OrderRecorder } from '../orders/order-recorder';
import { OrderRepository } from '../orders/order-repository';
import { OrderViews } from '../orders/order-views';
import { isEnded } from '../orders/order-rules';
import { ShippingFeeAgreementService } from '../shipping-policy/shipping-fee-agreement-service';
import { ShopAvailabilityReader } from '../shop/shop-availability-reader';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { ADDRESS_CHANGE_EXPIRY_MS, ADDRESS_CHANGE_OPERATIONS, AddressChangeTargetActor } from './address-change-constants';
import { AddressChangeRepository, AddressChangeRequestRow, NewAddressChangeRequest } from './address-change-repository';
import { CancelAddressChangeInput, CreateAddressChangeInput, DecideAddressChangeInput } from './address-change-validation';
import { addressChangeView } from './address-change-views';

@Injectable()
export class AddressChangeService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly executor: IdempotencyExecutor,
    private readonly addressChangeRepo: AddressChangeRepository,
    private readonly orders: OrderRepository,
    private readonly orderRecorder: OrderRecorder,
    private readonly deliveries: DeliveryRepository,
    private readonly deliveryRecorder: DeliveryRecorder,
    private readonly actors: DeliveryActors,
    private readonly drivers: DriverRepository,
    private readonly shops: ShopAvailabilityReader,
    private readonly routes: M14RouteClient,
    private readonly agreements: ShippingFeeAgreementService,
    private readonly orderViews: OrderViews,
    private readonly deliveryViews: DeliveryViews,
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

  // ---- ORDER: request --------------------------------------------------------------------------------------------------------

  async requestOrderChange(
    principal: AuthPrincipal,
    orderId: string,
    input: CreateAddressChangeInput,
    key: string | readonly string[] | undefined,
    requestId: string,
  ): Promise<IdempotentOutcome> {
    return this.executor.execute(
      {
        scopeType: 'user',
        scopeId: principal.userId,
        operationId: ADDRESS_CHANGE_OPERATIONS.orderRequest,
        idempotencyKey: key,
        logicalRequest: { orderId, ...input },
        replay: this.#replay(principal),
      },
      async (context) => {
        const order = await this.orders.lockById(context, orderId);
        if (order === undefined || order.customerUserId !== principal.userId) {
          throw new AppError('ORDER_NOT_FOUND');
        }
        if (isEnded(order.status)) {
          throw new AppError('ORDER_STATE_CONFLICT');
        }
        if (order.status !== 'PREPARING') {
          throw new AppError('ORDER_NOT_CONFIRMED');
        }
        if (order.version !== input.expectedVersion) {
          throw new AppError('VERSION_CONFLICT');
        }

        const nowMs = await freshClockMs(context);
        const allDeliveries = await this.deliveries.listOfOrder(context, orderId);
        const running = allDeliveries.find((d) => ACTIVE_STATES.includes(d.state));

        if (running !== undefined && (running.pickedUpAtMs !== null || ['picked_up', 'delivering', 'completed', 'failed'].includes(running.state))) {
          throw new AppError('CANNOT_CHANGE_AFTER_PICKUP');
        }

        const existingPending = await this.addressChangeRepo.lockActiveByOrderId(context, orderId);
        if (existingPending !== undefined) {
          if (nowMs >= existingPending.expiresAtMs) {
            await this.addressChangeRepo.resolve(context, existingPending.changeRequestId, 'EXPIRED', null, 'Hết hạn phản hồi', existingPending.version);
          } else {
            throw new AppError('ADDRESS_CHANGE_ALREADY_PENDING');
          }
        }

        if (input.lat === null || input.lng === null) {
          throw new AppError('DROPOFF_PIN_MISSING');
        }

        const pickupLat = running?.pickupLat ?? (await this.shops.snapshotOfShop(context, order.shopId))?.pickupLat ?? null;
        const pickupLng = running?.pickupLng ?? (await this.shops.snapshotOfShop(context, order.shopId))?.pickupLng ?? null;
        if (pickupLat === null || pickupLng === null) {
          throw new AppError('ROUTE_UNAVAILABLE');
        }

        const route = await this.routes.route({ lat: pickupLat, lng: pickupLng }, { lat: input.lat, lng: input.lng });
        if (!route || route.distanceM === null || route.distanceM === undefined) {
          throw new AppError('ROUTE_UNAVAILABLE');
        }
        const newDistanceM = route.distanceM;
        const quote = await this.agreements.estimate(context, route.distanceM);
        if (quote.status === 'UNPRICED') {
          throw new AppError(
            quote.reason === 'POLICY_NOT_CONFIGURED'
              ? 'POLICY_NOT_CONFIGURED'
              : quote.reason === 'OUT_OF_PRICE_RANGE'
                ? 'OUT_OF_PRICE_RANGE'
                : 'ROUTE_UNAVAILABLE',
          );
        }
        const newFeeVnd = quote.feeVnd;

        let targetActor: AddressChangeTargetActor = 'SHOP';
        let targetDriverId: string | null = null;
        if (running !== undefined && ['accepted', 'location_confirmed'].includes(running.state)) {
          const activeAssignment = await this.deliveries.findActiveAssignment(context, running.deliveryId);
          if (activeAssignment !== undefined) {
            targetActor = 'SHIPPER';
            targetDriverId = activeAssignment.driverId;
          }
        }

        const originalFeeVnd = running?.feeVnd ?? order.feeEstimateVnd;
        const feeDifferenceVnd = newFeeVnd !== null && originalFeeVnd !== null ? newFeeVnd - originalFeeVnd : null;
        const changeRequestId = randomUUID();
        const expiresAtMs = nowMs + ADDRESS_CHANGE_EXPIRY_MS;

        const newReq: NewAddressChangeRequest = {
          changeRequestId,
          orderId,
          deliveryId: running?.deliveryId ?? null,
          source: 'ORDER',
          requestedBy: principal.userId,
          status: 'PENDING',
          targetActor,
          targetDriverId,
          originalRecipientName: order.recipientName,
          originalRecipientPhone: order.recipientPhone,
          originalAddressText: order.addressText,
          originalLat: order.addressLat,
          originalLng: order.addressLng,
          originalFeeVnd,
          originalDistanceM: running?.routeDistanceM ?? order.feeEstimateDistanceM,
          newRecipientName: input.recipientName,
          newRecipientPhone: input.recipientPhone,
          newAddressText: input.addressText,
          newLat: input.lat,
          newLng: input.lng,
          newFeeVnd,
          newDistanceM,
          feeDifferenceVnd,
          note: input.note,
          expiresAtMs,
          orderVersion: order.version,
          deliveryVersion: running?.version ?? null,
        };

        await this.addressChangeRepo.insert(context, newReq);

        await this.orderRecorder.record(context, {
          order,
          type: 'address_change_requested',
          actorType: 'CUSTOMER',
          actorId: principal.userId,
          note: input.note,
          details: {
            change_request_id: changeRequestId,
            new_address: input.addressText,
            target_actor: targetActor,
          },
          operation: ADDRESS_CHANGE_OPERATIONS.orderRequest,
          requestId,
        });

        const created = await this.addressChangeRepo.findById(context, changeRequestId);
        const freshOrder = (await this.orders.findById(context, orderId))!;
        const orderView = await this.orderViews.forCustomer(context, freshOrder, true);
        return {
          status: 200,
          replayGuard: { user_id: principal.userId },
          payload: {
            ...orderView,
            address_change_request: addressChangeView(created, nowMs),
          },
        };
      },
    );
  }

  // ---- ORDER: decide ---------------------------------------------------------------------------------------------------------

  async decideOrderChange(
    principal: AuthPrincipal,
    orderId: string,
    input: DecideAddressChangeInput,
    key: string | readonly string[] | undefined,
    requestId: string,
  ): Promise<IdempotentOutcome> {
    return this.executor.execute(
      {
        scopeType: 'user',
        scopeId: principal.userId,
        operationId: ADDRESS_CHANGE_OPERATIONS.orderDecide,
        idempotencyKey: key,
        logicalRequest: { orderId, ...input },
        replay: this.#replay(principal),
      },
      async (context) => {
        const order = await this.orders.lockById(context, orderId);
        if (order === undefined) {
          throw new AppError('ORDER_NOT_FOUND');
        }
        if (isEnded(order.status)) {
          throw new AppError('ORDER_STATE_CONFLICT');
        }
        if (order.status !== 'PREPARING') {
          throw new AppError('ORDER_NOT_CONFIRMED');
        }

        const allDeliveries = await this.deliveries.listOfOrder(context, orderId);
        const running = allDeliveries.find((d) => ACTIVE_STATES.includes(d.state));
        const activeAssignment = running ? await this.deliveries.findActiveAssignment(context, running.deliveryId) : undefined;
        const currentDriverId = activeAssignment !== undefined && ['accepted', 'location_confirmed'].includes(running!.state)
          ? activeAssignment.driverId
          : null;

        // Check decider permission FIRST before accessing or resolving request data
        if (currentDriverId !== null) {
          const { driver } = await this.actors.shipperWriter(context, principal, { acceptNew: false });
          if (driver.driverId !== currentDriverId) {
            throw new AppError('ADDRESS_CHANGE_NOT_PERMITTED');
          }
        } else {
          const { shop } = await this.actors.shopWriter(context, principal);
          if (order.shopId !== shop.shopId) {
            throw new AppError('ORDER_NOT_FOUND');
          }
        }

        const req = await this.addressChangeRepo.lockActiveByOrderId(context, orderId);
        if (req === undefined) {
          throw new AppError('ADDRESS_CHANGE_NOT_FOUND');
        }
        if (req.version !== input.expectedVersion) {
          throw new AppError('VERSION_CONFLICT');
        }

        const nowMs = await freshClockMs(context);
        if (nowMs >= req.expiresAtMs) {
          const resolved = await this.addressChangeRepo.resolve(context, req.changeRequestId, 'EXPIRED', null, 'Hết hạn phản hồi', req.version);
          if (!resolved) {
            throw new AppError('VERSION_CONFLICT');
          }
          const updated = await this.addressChangeRepo.findById(context, req.changeRequestId);
          const freshOrder = (await this.orders.findById(context, orderId))!;
          const orderView = await this.orderViews.forShop(context, freshOrder, true);
          return {
            status: 200,
            replayGuard: { user_id: principal.userId },
            payload: {
              ...orderView,
              address_change_request: addressChangeView(updated, nowMs),
            },
          };
        }

        if (running !== undefined && (running.pickedUpAtMs !== null || ['picked_up', 'delivering', 'completed', 'failed'].includes(running.state))) {
          const resolved = await this.addressChangeRepo.resolve(context, req.changeRequestId, 'EXPIRED', null, 'Hàng đã được lấy', req.version);
          if (!resolved) {
            throw new AppError('VERSION_CONFLICT');
          }
          const updated = await this.addressChangeRepo.findById(context, req.changeRequestId);
          const freshOrder = (await this.orders.findById(context, orderId))!;
          const orderView = await this.orderViews.forShop(context, freshOrder, true);
          return {
            status: 200,
            replayGuard: { user_id: principal.userId },
            payload: {
              ...orderView,
              address_change_request: addressChangeView(updated, nowMs),
            },
          };
        }

        if (!input.accept) {
          const resolved = await this.addressChangeRepo.resolve(context, req.changeRequestId, 'REJECTED', principal.userId, input.reason, req.version);
          if (!resolved) {
            throw new AppError('VERSION_CONFLICT');
          }

          await this.orderRecorder.record(context, {
            order,
            type: 'address_change_rejected',
            actorType: req.targetActor === 'SHOP' ? 'SHOP' : 'SYSTEM',
            actorId: principal.userId,
            note: input.reason,
            details: {
              change_request_id: req.changeRequestId,
              rejected_by: req.targetActor,
              reason: input.reason,
            },
            operation: ADDRESS_CHANGE_OPERATIONS.orderDecide,
            requestId,
          });

          const updated = await this.addressChangeRepo.findById(context, req.changeRequestId);
          const freshOrder = (await this.orders.findById(context, orderId))!;
          const orderView = await this.orderViews.forShop(context, freshOrder, true);
          return {
            status: 200,
            replayGuard: { user_id: principal.userId },
            payload: {
              ...orderView,
              address_change_request: addressChangeView(updated, nowMs),
            },
          };
        }

        // Accept
        const resolved = await this.addressChangeRepo.resolve(context, req.changeRequestId, 'ACCEPTED', principal.userId, null, req.version);
        if (!resolved) {
          throw new AppError('VERSION_CONFLICT');
        }

        await context.query("SELECT set_config('app.address_change_in_progress', 'on', true)");

        // Update Order: recipient, address, coordinates, new distance, and new fee (M14/M06)
        await context.query(
          `UPDATE app.orders
           SET recipient_name = $1, recipient_phone = $2, address_text = $3, address_lat = $4, address_lng = $5,
               fee_estimate_distance_m = $6,
               fee_estimate_vnd = COALESCE($7, fee_estimate_vnd),
               version = version + 1, updated_at = clock_timestamp()
           WHERE order_id = $8`,
          [
            req.newRecipientName,
            req.newRecipientPhone,
            req.newAddressText,
            req.newLat,
            req.newLng,
            req.newDistanceM,
            req.newFeeVnd,
            orderId,
          ],
        );

        if (running !== undefined) {
          await context.query(
            `UPDATE app.deliveries
             SET recipient_name = $1, recipient_phone = $2, dropoff_address_text = $3,
                 dropoff_area_text = $4, dropoff_lat = $5, dropoff_lng = $6,
                 route_distance_m = $7,
                 fee_vnd = COALESCE($8, fee_vnd),
                 version = version + 1, updated_at = clock_timestamp()
             WHERE delivery_id = $9`,
            [
              req.newRecipientName,
              req.newRecipientPhone,
              req.newAddressText,
              dropoffAreaOf(req.newAddressText),
              req.newLat,
              req.newLng,
              req.newDistanceM,
              req.newFeeVnd,
              running.deliveryId,
            ],
          );
        }

        const freshOrder = (await this.orders.findById(context, orderId))!;
        await this.orderRecorder.record(context, {
          order: freshOrder,
          type: 'address_change_accepted',
          actorType: req.targetActor === 'SHOP' ? 'SHOP' : 'SYSTEM',
          actorId: principal.userId,
          note: 'Địa chỉ giao hàng đã được cập nhật',
          details: {
            change_request_id: req.changeRequestId,
            accepted_by: req.targetActor,
            new_address: req.newAddressText,
          },
          operation: ADDRESS_CHANGE_OPERATIONS.orderDecide,
          requestId,
        });

        const updated = await this.addressChangeRepo.findById(context, req.changeRequestId);
        const orderView = await this.orderViews.forShop(context, freshOrder, true);
        return {
          status: 200,
          replayGuard: { user_id: principal.userId },
          payload: {
            ...orderView,
            address_change_request: addressChangeView(updated, nowMs),
          },
        };
      },
    );
  }

  // ---- ORDER: cancel ---------------------------------------------------------------------------------------------------------

  async cancelOrderChange(
    principal: AuthPrincipal,
    orderId: string,
    input: CancelAddressChangeInput,
    key: string | readonly string[] | undefined,
    requestId: string,
  ): Promise<IdempotentOutcome> {
    return this.executor.execute(
      {
        scopeType: 'user',
        scopeId: principal.userId,
        operationId: ADDRESS_CHANGE_OPERATIONS.orderCancel,
        idempotencyKey: key,
        logicalRequest: { orderId, ...input },
        replay: this.#replay(principal),
      },
      async (context) => {
        const order = await this.orders.lockById(context, orderId);
        if (order === undefined) {
          throw new AppError('ORDER_NOT_FOUND');
        }

        const req = await this.addressChangeRepo.lockActiveByOrderId(context, orderId);
        if (req === undefined) {
          throw new AppError('ADDRESS_CHANGE_NOT_FOUND');
        }
        if (req.requestedBy !== principal.userId) {
          throw new AppError('ADDRESS_CHANGE_NOT_PERMITTED');
        }
        if (req.version !== input.expectedVersion) {
          throw new AppError('VERSION_CONFLICT');
        }

        const nowMs = await freshClockMs(context);
        if (nowMs >= req.expiresAtMs) {
          const resolved = await this.addressChangeRepo.resolve(context, req.changeRequestId, 'EXPIRED', null, 'Hết hạn phản hồi', req.version);
          if (!resolved) {
            throw new AppError('VERSION_CONFLICT');
          }
          const updated = await this.addressChangeRepo.findById(context, req.changeRequestId);
          const freshOrder = (await this.orders.findById(context, orderId))!;
          const orderView = await this.orderViews.forCustomer(context, freshOrder, true);
          return {
            status: 200,
            replayGuard: { user_id: principal.userId },
            payload: {
              ...orderView,
              address_change_request: addressChangeView(updated, nowMs),
            },
          };
        }

        const resolved = await this.addressChangeRepo.resolve(context, req.changeRequestId, 'CANCELLED', principal.userId, 'Khách hủy yêu cầu đổi địa chỉ', req.version);
        if (!resolved) {
          throw new AppError('VERSION_CONFLICT');
        }

        await this.orderRecorder.record(context, {
          order,
          type: 'address_change_cancelled',
          actorType: 'CUSTOMER',
          actorId: principal.userId,
          note: 'Khách đã hủy yêu cầu đổi địa chỉ',
          details: { change_request_id: req.changeRequestId },
          operation: ADDRESS_CHANGE_OPERATIONS.orderCancel,
          requestId,
        });

        const updated = await this.addressChangeRepo.findById(context, req.changeRequestId);
        const freshOrder = (await this.orders.findById(context, orderId))!;
        const orderView = await this.orderViews.forCustomer(context, freshOrder, true);
        return {
          status: 200,
          replayGuard: { user_id: principal.userId },
          payload: {
            ...orderView,
            address_change_request: addressChangeView(updated, nowMs),
          },
        };
      },
    );
  }

  // ---- CUSTOMER DELIVERY: request --------------------------------------------------------------------------------------------

  async requestDeliveryChange(
    principal: AuthPrincipal,
    deliveryId: string,
    input: CreateAddressChangeInput,
    key: string | readonly string[] | undefined,
    requestId: string,
  ): Promise<IdempotentOutcome> {
    return this.executor.execute(
      {
        scopeType: 'user',
        scopeId: principal.userId,
        operationId: ADDRESS_CHANGE_OPERATIONS.deliveryRequest,
        idempotencyKey: key,
        logicalRequest: { deliveryId, ...input },
        replay: this.#replay(principal),
      },
      async (context) => {
        const delivery = await this.deliveries.lockById(context, deliveryId);
        if (delivery === undefined || delivery.requestedBy !== principal.userId) {
          throw new AppError('DELIVERY_NOT_FOUND');
        }
        if (delivery.source !== 'CUSTOMER') {
          throw new AppError('DELIVERY_STATE_CONFLICT');
        }
        if (['completed', 'failed', 'cancelled_by_merchant', 'cancelled_by_system', 'search_stopped'].includes(delivery.state)) {
          throw new AppError('DELIVERY_STATE_CONFLICT');
        }
        if (delivery.pickedUpAtMs !== null || ['picked_up', 'delivering'].includes(delivery.state)) {
          throw new AppError('CANNOT_CHANGE_AFTER_PICKUP');
        }
        if (delivery.version !== input.expectedVersion) {
          throw new AppError('VERSION_CONFLICT');
        }

        const nowMs = await freshClockMs(context);
        const existingPending = await this.addressChangeRepo.lockActiveByDeliveryId(context, deliveryId);
        if (existingPending !== undefined) {
          if (nowMs >= existingPending.expiresAtMs) {
            await this.addressChangeRepo.resolve(context, existingPending.changeRequestId, 'EXPIRED', null, 'Hết hạn phản hồi', existingPending.version);
          } else {
            throw new AppError('ADDRESS_CHANGE_ALREADY_PENDING');
          }
        }

        if (input.lat === null || input.lng === null) {
          throw new AppError('DROPOFF_PIN_MISSING');
        }
        if (delivery.pickupLat === null || delivery.pickupLng === null) {
          throw new AppError('ROUTE_UNAVAILABLE');
        }
        const route = await this.routes.route({ lat: delivery.pickupLat, lng: delivery.pickupLng }, { lat: input.lat, lng: input.lng });
        if (!route || route.distanceM === null || route.distanceM === undefined) {
          throw new AppError('ROUTE_UNAVAILABLE');
        }
        const newDistanceM = route.distanceM;
        const quote = await this.agreements.estimate(context, route.distanceM);
        if (quote.status === 'UNPRICED') {
          throw new AppError(
            quote.reason === 'POLICY_NOT_CONFIGURED'
              ? 'POLICY_NOT_CONFIGURED'
              : quote.reason === 'OUT_OF_PRICE_RANGE'
                ? 'OUT_OF_PRICE_RANGE'
                : 'ROUTE_UNAVAILABLE',
          );
        }
        const newFeeVnd = quote.feeVnd;

        const activeAssignment = await this.deliveries.findActiveAssignment(context, deliveryId);
        const hasShipper = activeAssignment !== undefined && ['accepted', 'location_confirmed'].includes(delivery.state);

        const changeRequestId = randomUUID();
        const expiresAtMs = nowMs + ADDRESS_CHANGE_EXPIRY_MS;

        if (!hasShipper) {
          // If no shipper has accepted yet (waiting_driver), creator applies update directly!
          await context.query("SELECT set_config('app.address_change_in_progress', 'on', true)");
          await context.query(
            `UPDATE app.deliveries
             SET recipient_name = $1, recipient_phone = $2, dropoff_address_text = $3,
                 dropoff_area_text = $4, dropoff_lat = $5, dropoff_lng = $6,
                 route_distance_m = $7,
                 fee_vnd = COALESCE($8, fee_vnd),
                 version = version + 1, updated_at = clock_timestamp()
             WHERE delivery_id = $9`,
            [
              input.recipientName,
              input.recipientPhone,
              input.addressText,
              dropoffAreaOf(input.addressText),
              input.lat,
              input.lng,
              newDistanceM,
              newFeeVnd,
              deliveryId,
            ],
          );

          const updatedDelivery = (await this.deliveries.findById(context, deliveryId))!;
          await this.deliveryRecorder.record(context, {
            delivery: updatedDelivery,
            type: 'address_changed',
            actorType: 'CUSTOMER',
            actorId: principal.userId,
            note: input.note ?? 'Khách cập nhật địa chỉ giao hàng',
            operation: ADDRESS_CHANGE_OPERATIONS.deliveryRequest,
            requestId,
          });

          const newReq: NewAddressChangeRequest = {
            changeRequestId,
            orderId: null,
            deliveryId,
            source: 'CUSTOMER',
            requestedBy: principal.userId,
            status: 'ACCEPTED',
            targetActor: 'SHOP',
            targetDriverId: null,
            originalRecipientName: delivery.recipientName,
            originalRecipientPhone: delivery.recipientPhone,
            originalAddressText: delivery.dropoffAddressText,
            originalLat: delivery.dropoffLat,
            originalLng: delivery.dropoffLng,
            originalFeeVnd: delivery.feeVnd,
            originalDistanceM: delivery.routeDistanceM,
            newRecipientName: input.recipientName,
            newRecipientPhone: input.recipientPhone,
            newAddressText: input.addressText,
            newLat: input.lat,
            newLng: input.lng,
            newFeeVnd,
            newDistanceM,
            feeDifferenceVnd: newFeeVnd !== null && delivery.feeVnd !== null ? newFeeVnd - delivery.feeVnd : null,
            note: input.note,
            expiresAtMs,
            orderVersion: null,
            deliveryVersion: delivery.version,
          };
          await this.addressChangeRepo.insert(context, newReq);
          await this.addressChangeRepo.resolve(context, changeRequestId, 'ACCEPTED', principal.userId, null, 1);

          const finalReq = await this.addressChangeRepo.findById(context, changeRequestId);
          const freshDelivery = (await this.deliveries.findById(context, deliveryId))!;
          const deliveryView = await this.deliveryViews.forCustomer(context, freshDelivery, nowMs);
          return {
            status: 200,
            replayGuard: { user_id: principal.userId },
            payload: {
              ...deliveryView,
              delivery: deliveryView,
              address_change_request: addressChangeView(finalReq, nowMs),
            },
          };
        }

        // Shipper holds the delivery -> target SHIPPER
        const feeDifferenceVnd = newFeeVnd !== null && delivery.feeVnd !== null ? newFeeVnd - delivery.feeVnd : null;
        const newReq: NewAddressChangeRequest = {
          changeRequestId,
          orderId: null,
          deliveryId,
          source: 'CUSTOMER',
          requestedBy: principal.userId,
          status: 'PENDING',
          targetActor: 'SHIPPER',
          targetDriverId: activeAssignment.driverId,
          originalRecipientName: delivery.recipientName,
          originalRecipientPhone: delivery.recipientPhone,
          originalAddressText: delivery.dropoffAddressText,
          originalLat: delivery.dropoffLat,
          originalLng: delivery.dropoffLng,
          originalFeeVnd: delivery.feeVnd,
          originalDistanceM: delivery.routeDistanceM,
          newRecipientName: input.recipientName,
          newRecipientPhone: input.recipientPhone,
          newAddressText: input.addressText,
          newLat: input.lat,
          newLng: input.lng,
          newFeeVnd,
          newDistanceM,
          feeDifferenceVnd,
          note: input.note,
          expiresAtMs,
          orderVersion: null,
          deliveryVersion: delivery.version,
        };
        await this.addressChangeRepo.insert(context, newReq);

        await this.deliveryRecorder.record(context, {
          delivery,
          type: 'address_change_requested',
          actorType: 'CUSTOMER',
          actorId: principal.userId,
          driverId: activeAssignment.driverId,
          assignmentId: activeAssignment.assignmentId,
          note: input.note,
          operation: ADDRESS_CHANGE_OPERATIONS.deliveryRequest,
          requestId,
        });

        const created = await this.addressChangeRepo.findById(context, changeRequestId);
        const freshDelivery = (await this.deliveries.findById(context, deliveryId))!;
        const deliveryView = await this.deliveryViews.forCustomer(context, freshDelivery, nowMs);
        return {
          status: 200,
          replayGuard: { user_id: principal.userId },
          payload: {
            ...deliveryView,
            delivery: deliveryView,
            address_change_request: addressChangeView(created, nowMs),
          },
        };
      },
    );
  }

  // ---- CUSTOMER DELIVERY: decide ---------------------------------------------------------------------------------------------

  async decideDeliveryChange(
    principal: AuthPrincipal,
    deliveryId: string,
    input: DecideAddressChangeInput,
    key: string | readonly string[] | undefined,
    requestId: string,
  ): Promise<IdempotentOutcome> {
    return this.executor.execute(
      {
        scopeType: 'user',
        scopeId: principal.userId,
        operationId: ADDRESS_CHANGE_OPERATIONS.deliveryDecide,
        idempotencyKey: key,
        logicalRequest: { deliveryId, ...input },
        replay: this.#replay(principal),
      },
      async (context) => {
        const peekDelivery = await this.deliveries.findById(context, deliveryId);
        if (peekDelivery === undefined) {
          throw new AppError('DELIVERY_NOT_FOUND');
        }
        if (peekDelivery.orderId !== null) {
          await this.orders.lockById(context, peekDelivery.orderId);
        }
        const delivery = await this.deliveries.lockById(context, deliveryId);
        if (delivery === undefined) {
          throw new AppError('DELIVERY_NOT_FOUND');
        }
        if (['completed', 'failed', 'cancelled_by_merchant', 'cancelled_by_system', 'search_stopped'].includes(delivery.state)) {
          throw new AppError('DELIVERY_STATE_CONFLICT');
        }

        // Check decider permission FIRST before accessing or resolving request data
        const activeAssignment = await this.deliveries.findActiveAssignment(context, deliveryId);
        const currentDriverId = activeAssignment !== undefined && ['accepted', 'location_confirmed'].includes(delivery.state)
          ? activeAssignment.driverId
          : null;

        const { driver } = await this.actors.shipperWriter(context, principal, { acceptNew: false });
        if (activeAssignment === undefined || currentDriverId === null || driver.driverId !== currentDriverId) {
          throw new AppError('ADDRESS_CHANGE_NOT_PERMITTED');
        }

        const req = await this.addressChangeRepo.lockActiveByDeliveryId(context, deliveryId);
        if (req === undefined) {
          throw new AppError('ADDRESS_CHANGE_NOT_FOUND');
        }
        if (req.version !== input.expectedVersion) {
          throw new AppError('VERSION_CONFLICT');
        }

        const nowMs = await freshClockMs(context);
        if (nowMs >= req.expiresAtMs) {
          const resolved = await this.addressChangeRepo.resolve(context, req.changeRequestId, 'EXPIRED', null, 'Hết hạn phản hồi', req.version);
          if (!resolved) {
            throw new AppError('VERSION_CONFLICT');
          }
          const updated = await this.addressChangeRepo.findById(context, req.changeRequestId);
          const deliveryView = await this.deliveryViews.forShipper(context, delivery, activeAssignment, nowMs);
          return {
            status: 200,
            replayGuard: { user_id: principal.userId },
            payload: {
              ...deliveryView,
              delivery: deliveryView,
              address_change_request: addressChangeView(updated, nowMs),
            },
          };
        }

        if (delivery.pickedUpAtMs !== null || ['picked_up', 'delivering'].includes(delivery.state)) {
          const resolved = await this.addressChangeRepo.resolve(context, req.changeRequestId, 'EXPIRED', null, 'Hàng đã được lấy', req.version);
          if (!resolved) {
            throw new AppError('VERSION_CONFLICT');
          }
          const updated = await this.addressChangeRepo.findById(context, req.changeRequestId);
          const deliveryView = await this.deliveryViews.forShipper(context, delivery, activeAssignment, nowMs);
          return {
            status: 200,
            replayGuard: { user_id: principal.userId },
            payload: {
              ...deliveryView,
              delivery: deliveryView,
              address_change_request: addressChangeView(updated, nowMs),
            },
          };
        }

        const linkedOrderId = req.orderId ?? delivery.orderId;

        if (!input.accept) {
          const resolved = await this.addressChangeRepo.resolve(context, req.changeRequestId, 'REJECTED', principal.userId, input.reason, req.version);
          if (!resolved) {
            throw new AppError('VERSION_CONFLICT');
          }

          await this.deliveryRecorder.record(context, {
            delivery,
            type: 'address_change_rejected',
            actorType: 'SHIPPER',
            actorId: principal.userId,
            driverId: driver.driverId,
            note: input.reason,
            operation: ADDRESS_CHANGE_OPERATIONS.deliveryDecide,
            requestId,
          });

          if (linkedOrderId !== null) {
            const currentOrder = await this.orders.findById(context, linkedOrderId);
            if (currentOrder !== undefined) {
              await this.orderRecorder.record(context, {
                order: currentOrder,
                type: 'address_change_rejected',
                actorType: 'SYSTEM',
                actorId: principal.userId,
                note: input.reason,
                details: {
                  change_request_id: req.changeRequestId,
                  rejected_by: 'SHIPPER',
                  driver_id: driver.driverId,
                  reason: input.reason,
                },
                operation: ADDRESS_CHANGE_OPERATIONS.deliveryDecide,
                requestId,
              });
            }
          }

          const updated = await this.addressChangeRepo.findById(context, req.changeRequestId);
          const deliveryView = await this.deliveryViews.forShipper(context, delivery, activeAssignment, nowMs);
          return {
            status: 200,
            replayGuard: { user_id: principal.userId },
            payload: {
              ...deliveryView,
              delivery: deliveryView,
              address_change_request: addressChangeView(updated, nowMs),
            },
          };
        }

        // Accept
        const resolved = await this.addressChangeRepo.resolve(context, req.changeRequestId, 'ACCEPTED', principal.userId, null, req.version);
        if (!resolved) {
          throw new AppError('VERSION_CONFLICT');
        }

        await context.query("SELECT set_config('app.address_change_in_progress', 'on', true)");
        // Cập nhật đồng bộ địa chỉ, khoảng cách VÀ PHÍ sau khi được duyệt (M14/M06)
        await context.query(
          `UPDATE app.deliveries
           SET recipient_name = $1, recipient_phone = $2, dropoff_address_text = $3,
               dropoff_area_text = $4, dropoff_lat = $5, dropoff_lng = $6,
               route_distance_m = $7,
               fee_vnd = COALESCE($8, fee_vnd),
               version = version + 1, updated_at = clock_timestamp()
           WHERE delivery_id = $9`,
          [
            req.newRecipientName,
            req.newRecipientPhone,
            req.newAddressText,
            dropoffAreaOf(req.newAddressText),
            req.newLat,
            req.newLng,
            req.newDistanceM,
            req.newFeeVnd,
            deliveryId,
          ],
        );

        if (linkedOrderId !== null) {
          await context.query(
            `UPDATE app.orders
             SET recipient_name = $1, recipient_phone = $2, address_text = $3, address_lat = $4, address_lng = $5,
                 fee_estimate_distance_m = $6,
                 fee_estimate_vnd = COALESCE($7, fee_estimate_vnd),
                 version = version + 1, updated_at = clock_timestamp()
             WHERE order_id = $8`,
            [
              req.newRecipientName,
              req.newRecipientPhone,
              req.newAddressText,
              req.newLat,
              req.newLng,
              req.newDistanceM,
              req.newFeeVnd,
              linkedOrderId,
            ],
          );

          const freshOrder = (await this.orders.findById(context, linkedOrderId))!;
          await this.orderRecorder.record(context, {
            order: freshOrder,
            type: 'address_change_accepted',
            actorType: 'SYSTEM',
            actorId: principal.userId,
            note: 'Shipper đã đồng ý đổi địa chỉ giao hàng',
            details: {
              change_request_id: req.changeRequestId,
              accepted_by: 'SHIPPER',
              driver_id: driver.driverId,
              new_address: req.newAddressText,
            },
            operation: ADDRESS_CHANGE_OPERATIONS.deliveryDecide,
            requestId,
          });
        }

        const updatedDelivery = (await this.deliveries.findById(context, deliveryId))!;
        await this.deliveryRecorder.record(context, {
          delivery: updatedDelivery,
          type: 'address_change_accepted',
          actorType: 'SHIPPER',
          actorId: principal.userId,
          driverId: driver.driverId,
          note: 'Shipper đã đồng ý đổi địa chỉ giao hàng',
          operation: ADDRESS_CHANGE_OPERATIONS.deliveryDecide,
          requestId,
        });

        const updated = await this.addressChangeRepo.findById(context, req.changeRequestId);
        const deliveryView = await this.deliveryViews.forShipper(context, updatedDelivery, activeAssignment, nowMs);
        return {
          status: 200,
          replayGuard: { user_id: principal.userId },
          payload: {
            ...deliveryView,
            delivery: deliveryView,
            address_change_request: addressChangeView(updated, nowMs),
          },
        };
      },
    );
  }

  // ---- CUSTOMER DELIVERY: cancel ---------------------------------------------------------------------------------------------

  async cancelDeliveryChange(
    principal: AuthPrincipal,
    deliveryId: string,
    input: CancelAddressChangeInput,
    key: string | readonly string[] | undefined,
    requestId: string,
  ): Promise<IdempotentOutcome> {
    return this.executor.execute(
      {
        scopeType: 'user',
        scopeId: principal.userId,
        operationId: ADDRESS_CHANGE_OPERATIONS.deliveryCancel,
        idempotencyKey: key,
        logicalRequest: { deliveryId, ...input },
        replay: this.#replay(principal),
      },
      async (context) => {
        const delivery = await this.deliveries.lockById(context, deliveryId);
        if (delivery === undefined) {
          throw new AppError('DELIVERY_NOT_FOUND');
        }

        const req = await this.addressChangeRepo.lockActiveByDeliveryId(context, deliveryId);
        if (req === undefined) {
          throw new AppError('ADDRESS_CHANGE_NOT_FOUND');
        }
        if (req.requestedBy !== principal.userId) {
          throw new AppError('ADDRESS_CHANGE_NOT_PERMITTED');
        }
        if (req.version !== input.expectedVersion) {
          throw new AppError('VERSION_CONFLICT');
        }

        const nowMs = await freshClockMs(context);
        if (nowMs >= req.expiresAtMs) {
          const resolved = await this.addressChangeRepo.resolve(context, req.changeRequestId, 'EXPIRED', null, 'Hết hạn phản hồi', req.version);
          if (!resolved) {
            throw new AppError('VERSION_CONFLICT');
          }
          const updated = await this.addressChangeRepo.findById(context, req.changeRequestId);
          const freshDelivery = (await this.deliveries.findById(context, deliveryId))!;
          const deliveryView = await this.deliveryViews.forCustomer(context, freshDelivery, nowMs);
          return {
            status: 200,
            replayGuard: { user_id: principal.userId },
            payload: {
              ...deliveryView,
              delivery: deliveryView,
              address_change_request: addressChangeView(updated, nowMs),
            },
          };
        }

        const resolved = await this.addressChangeRepo.resolve(context, req.changeRequestId, 'CANCELLED', principal.userId, 'Khách hủy yêu cầu đổi địa chỉ', req.version);
        if (!resolved) {
          throw new AppError('VERSION_CONFLICT');
        }

        await this.deliveryRecorder.record(context, {
          delivery,
          type: 'address_change_cancelled',
          actorType: 'CUSTOMER',
          actorId: principal.userId,
          note: 'Khách đã hủy yêu cầu đổi địa chỉ',
          operation: ADDRESS_CHANGE_OPERATIONS.deliveryCancel,
          requestId,
        });

        const updated = await this.addressChangeRepo.findById(context, req.changeRequestId);
        const freshDelivery = (await this.deliveries.findById(context, deliveryId))!;
        const deliveryView = await this.deliveryViews.forCustomer(context, freshDelivery, nowMs);
        return {
          status: 200,
          replayGuard: { user_id: principal.userId },
          payload: {
            ...deliveryView,
            delivery: deliveryView,
            address_change_request: addressChangeView(updated, nowMs),
          },
        };
      },
    );
  }

  // ---- read helpers ----------------------------------------------------------------------------------------------------------

  async getLatestForOrder(context: TransactionContext, orderId: string): Promise<AddressChangeRequestRow | undefined> {
    const list = await this.addressChangeRepo.listByOrderId(context, orderId, 1);
    return list[0];
  }

  async getLatestForDelivery(context: TransactionContext, deliveryId: string): Promise<AddressChangeRequestRow | undefined> {
    const list = await this.addressChangeRepo.listByDeliveryId(context, deliveryId, 1);
    return list[0];
  }
}
