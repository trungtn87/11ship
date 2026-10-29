import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AuthPrincipal } from '../auth/auth-principal';
import { AppError, TechnicalError } from '../common/app-errors';
import { DeliveryRepository, DeliveryRow } from '../delivery/delivery-repository';
import { DriverRepository } from '../driver/driver-repository';
import { IdempotencyExecutor, IdempotentOutcome, JsonObject } from '../idempotency/idempotency-executor';
import { isCanonicalUuid } from '../shared/identifiers';
import { ShopSetupGate } from '../shop-setup/shop-setup-gate';
import { ShopAvailabilityReader } from '../shop/shop-availability-reader';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { Caller, FeedbackActors } from './feedback-actors';
import { FEEDBACK_SCOPE_TYPE, OPERATIONS, PartyRole } from './feedback-constants';
import { FEEDBACK_ORDER_PORT, FeedbackOrderPort, OrderFact } from './feedback-order-port';
import { FeedbackRecorder } from './feedback-recorder';
import { customerMayRateShipper, shopMayRateShipper } from './feedback-rules';
import { ReplyInput, ReviewInput, ReviewListQuery, ShipperReviewListQuery } from './feedback-validation';
import { ComplaintRepository } from './complaint-repository';
import { NewReview, ReviewRepository } from './review-repository';
import { ownReviewView, publicReviewView, shipperReviewView, shopReviewView, summaryView, replyView } from './review-views';

type Key = string | readonly string[] | undefined;

/**
 * Ratings (M11.01). The caller is the authenticated principal and nothing else: no reviewer, shop, shipper or stars-owner id ever comes from a request;
 * the subject (order or delivery) is resolved against what the caller really is. Each write is ONE transaction opened by the idempotency executor:
 * user row -> CURRENT session row -> shop or driver row -> the checks on committed, terminal rows -> the single insert -> audit -> outbox. The UNIQUE
 * indexes of app.reviews are the last line of defence, so two requests (or a retry with a new key) never create two ratings. A rating is never edited
 * or deleted; the shop's reply is the only thing that changes after it, and every saved text is kept.
 */
@Injectable()
export class ReviewService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly executor: IdempotencyExecutor,
    private readonly actors: FeedbackActors,
    private readonly reviews: ReviewRepository,
    private readonly complaints: ComplaintRepository,
    private readonly deliveries: DeliveryRepository,
    private readonly drivers: DriverRepository,
    private readonly shopReader: ShopAvailabilityReader,
    private readonly setupGate: ShopSetupGate,
    private readonly recorder: FeedbackRecorder,
    @Inject(FEEDBACK_ORDER_PORT) private readonly orders: FeedbackOrderPort,
  ) {}

  // ---- customer ------------------------------------------------------------------------------------------------------------------

  /** What a customer can rate on their order, and what they already rated. */
  async customerOrderState(principal: AuthPrincipal, orderId: string): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const caller = await this.actors.customer(context, principal, 'share');
      const order = await this.#orderOf(context, caller.userId, orderId);
      const shopReview = await this.reviews.findShopReviewOfOrder(context, order.orderId);
      const run = await this.#successfulRun(context, order.orderId);
      const shipperReview = run === undefined ? undefined : await this.reviews.findOfDelivery(context, run.delivery.deliveryId, 'SHIPPER_BY_CUSTOMER');
      const driver = run === undefined ? undefined : await this.drivers.findById(context, run.driverId);
      const rating = driver === undefined ? undefined : (await this.reviews.shipperSummary(context, driver.driverId)).all;
      return {
        order: { order_id: order.orderId, code: order.code, completed: order.completed },
        shop: { shop_id: order.shopId, name: order.shopName, can_review: order.completed && shopReview === undefined, review: shopReview === undefined ? null : ownReviewView(shopReview) },
        shipper:
          run === undefined || driver === undefined
            ? null
            : {
                name: driver.fullName,
                shipper_code: driver.shipperCode,
                rating: rating === undefined ? null : summaryView(rating),
                can_review: shipperReview === undefined,
                review: shipperReview === undefined ? null : ownReviewView(shipperReview),
              },
      };
    });
  }

  async customerReviewShop(principal: AuthPrincipal, orderId: string, input: ReviewInput, key: Key, requestId: string): Promise<IdempotentOutcome> {
    return this.#write(principal, 'CUSTOMER', OPERATIONS.reviewShop, { order_id: orderId, stars: input.stars, comment: input.comment }, key, async (context, caller) => {
      if (caller.role !== 'CUSTOMER') {
        throw new TechnicalError('internal', 'Unexpected caller');
      }
      const order = await this.#orderOf(context, caller.userId, orderId);
      if (!order.completed) {
        throw new AppError('REVIEW_NOT_ELIGIBLE');
      }
      return this.#insert(context, requestId, caller.userId, {
        reviewId: randomUUID(),
        kind: 'SHOP_BY_CUSTOMER',
        reviewerUserId: caller.userId,
        shopId: order.shopId,
        driverId: null,
        orderId: order.orderId,
        deliveryId: null,
        assignmentId: null,
        stars: input.stars,
        comment: input.comment,
        reviewerName: caller.displayName,
        shopName: order.shopName,
        driverName: null,
        relatedCode: order.code.slice(0, 16),
      });
    });
  }

  async customerReviewShipper(principal: AuthPrincipal, orderId: string, input: ReviewInput, key: Key, requestId: string): Promise<IdempotentOutcome> {
    return this.#write(principal, 'CUSTOMER', OPERATIONS.reviewShipperByCustomer, { order_id: orderId, stars: input.stars, comment: input.comment }, key, async (context, caller) => {
      if (caller.role !== 'CUSTOMER') {
        throw new TechnicalError('internal', 'Unexpected caller');
      }
      const order = await this.#orderOf(context, caller.userId, orderId);
      const run = await this.#successfulRun(context, order.orderId);
      if (run === undefined) {
        throw new AppError('REVIEW_NOT_ELIGIBLE');
      }
      const driver = await this.drivers.findById(context, run.driverId);
      return this.#insert(context, requestId, caller.userId, {
        reviewId: randomUUID(),
        kind: 'SHIPPER_BY_CUSTOMER',
        reviewerUserId: caller.userId,
        shopId: run.delivery.shopId ?? order.shopId,
        driverId: run.driverId,
        orderId: order.orderId,
        deliveryId: run.delivery.deliveryId,
        assignmentId: run.assignmentId,
        stars: input.stars,
        comment: input.comment,
        reviewerName: caller.displayName,
        shopName: run.delivery.shopName,
        driverName: driver?.fullName ?? null,
        relatedCode: run.delivery.code,
      });
    });
  }

  // ---- shop ----------------------------------------------------------------------------------------------------------------------

  /** The shop's side of one delivery: whether it may rate the Shipper, its rating if any, and the Shipper's combined score (no writer, no source split). */
  async shopDeliveryState(principal: AuthPrincipal, deliveryId: string): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const caller = await this.actors.resolve(context, principal, 'SHOP', 'share');
      if (caller.role !== 'SHOP') {
        throw new TechnicalError('internal', 'Unexpected caller');
      }
      const delivery = await this.deliveries.findOfShop(context, deliveryId, caller.shop.shopId);
      if (delivery === undefined) {
        throw new AppError('DELIVERY_NOT_FOUND');
      }
      const assignments = await this.deliveries.listAssignments(context, deliveryId);
      const executing = shopMayRateShipper(delivery, assignments);
      const existing = await this.reviews.findOfDelivery(context, deliveryId, 'SHIPPER_BY_SHOP');
      const driver = executing === undefined ? undefined : await this.drivers.findById(context, executing.driverId);
      const rating = driver === undefined ? undefined : (await this.reviews.shipperSummary(context, driver.driverId)).all;
      return {
        delivery: { delivery_id: delivery.deliveryId, code: delivery.code, state: delivery.state, result: delivery.state === 'completed' ? 'SUCCESS' : delivery.state === 'failed' ? 'FAILED' : null },
        shipper:
          driver === undefined || rating === undefined ? null : { name: driver.fullName, shipper_code: driver.shipperCode, rating: summaryView(rating) },
        can_review: executing !== undefined && existing === undefined,
        review: existing === undefined ? null : ownReviewView(existing),
      };
    });
  }

  async shopReviewShipper(principal: AuthPrincipal, deliveryId: string, input: ReviewInput, key: Key, requestId: string): Promise<IdempotentOutcome> {
    return this.#write(principal, 'SHOP', OPERATIONS.reviewShipperByShop, { delivery_id: deliveryId, stars: input.stars, comment: input.comment }, key, async (context, caller) => {
      if (caller.role !== 'SHOP') {
        throw new TechnicalError('internal', 'Unexpected caller');
      }
      const delivery = await this.deliveries.findOfShop(context, deliveryId, caller.shop.shopId);
      if (delivery === undefined) {
        throw new AppError('DELIVERY_NOT_FOUND');
      }
      const executing = shopMayRateShipper(delivery, await this.deliveries.listAssignments(context, deliveryId));
      if (executing === undefined) {
        throw new AppError('REVIEW_NOT_ELIGIBLE');
      }
      const driver = await this.drivers.findById(context, executing.driverId);
      return this.#insert(context, requestId, caller.userId, {
        reviewId: randomUUID(),
        kind: 'SHIPPER_BY_SHOP',
        reviewerUserId: caller.userId,
        shopId: delivery.shopId ?? caller.shop.shopId,
        driverId: executing.driverId,
        orderId: delivery.orderId,
        deliveryId: delivery.deliveryId,
        assignmentId: executing.assignmentId,
        stars: input.stars,
        comment: input.comment,
        reviewerName: caller.shop.name.slice(0, 80),
        shopName: delivery.shopName,
        driverName: driver?.fullName ?? null,
        relatedCode: delivery.code,
      });
    });
  }

  /** The shop's own page of the customer ratings: total, per-star counts, the list (newest first, optional star filter) with replies. */
  async shopOwnReviews(principal: AuthPrincipal, query: ReviewListQuery): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const caller = await this.actors.resolve(context, principal, 'SHOP', 'share');
      if (caller.role !== 'SHOP') {
        throw new TechnicalError('internal', 'Unexpected caller');
      }
      const [summary, rows] = await Promise.all([
        this.reviews.shopSummary(context, caller.shop.shopId),
        this.reviews.listShopReviews(context, caller.shop.shopId, query.stars, query.limit, query.offset),
      ]);
      return { summary: summaryView(summary), items: rows.map(shopReviewView), limit: query.limit, offset: query.offset };
    });
  }

  /**
   * The shop's reply to ONE customer rating: the first reply carries no version, a later one names the version it replaces. Every saved text is kept in the
   * history. The rating itself is not touched: there is no route that edits, deletes or reports it from the shop.
   */
  async saveReply(principal: AuthPrincipal, reviewId: string, input: ReplyInput, key: Key, requestId: string): Promise<IdempotentOutcome> {
    return this.#write(principal, 'SHOP', OPERATIONS.reply, { review_id: reviewId, body: input.body, expected_version: input.expectedVersion }, key, async (context, caller) => {
      if (caller.role !== 'SHOP') {
        throw new TechnicalError('internal', 'Unexpected caller');
      }
      const review = await this.reviews.lockById(context, reviewId);
      if (review === undefined || review.kind !== 'SHOP_BY_CUSTOMER' || review.shopId !== caller.shop.shopId || review.visibility === 'HIDDEN') {
        throw new AppError('REVIEW_NOT_FOUND');
      }
      const existing = await this.reviews.lockReply(context, reviewId);
      let version: number;
      if (existing === undefined) {
        if (input.expectedVersion !== null) {
          throw new AppError('VERSION_CONFLICT');
        }
        await this.reviews.insertReply(context, reviewId, caller.shop.shopId, input.body);
        version = 1;
      } else {
        if (input.expectedVersion !== existing.version) {
          throw new AppError('VERSION_CONFLICT');
        }
        if (!(await this.reviews.updateReply(context, reviewId, existing.version, input.body))) {
          throw new AppError('VERSION_CONFLICT');
        }
        version = existing.version + 1;
      }
      await this.reviews.appendReplyHistory(context, reviewId, version, input.body, caller.userId);
      await this.recorder.review(context, { requestId, actorType: 'USER', actorId: caller.userId, action: OPERATIONS.reply, metadata: { reply_version: version } }, review);
      const saved = await this.reviews.findShopReviewWithReply(context, reviewId);
      return { status: 200, replayGuard: { user_id: caller.userId }, payload: { review: saved === undefined ? null : shopReviewView(saved), reply: replyView(saved?.reply ?? null) } };
    });
  }

  async replyHistory(principal: AuthPrincipal, reviewId: string): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const caller = await this.actors.resolve(context, principal, 'SHOP', 'share');
      if (caller.role !== 'SHOP') {
        throw new TechnicalError('internal', 'Unexpected caller');
      }
      const review = await this.reviews.findById(context, reviewId);
      if (review === undefined || review.kind !== 'SHOP_BY_CUSTOMER' || review.shopId !== caller.shop.shopId) {
        throw new AppError('REVIEW_NOT_FOUND');
      }
      const history = await this.reviews.replyHistory(context, reviewId);
      return { history: history.map((h) => ({ version: h.version, body: h.body, written_at: new Date(h.writtenAtMs).toISOString() })) };
    });
  }

  // ---- public shop page ------------------------------------------------------------------------------------------------------------

  /** The public page: no session. Only a shop customers may see; hidden ratings are in neither the list nor the total. No rating => count 0 and no average. */
  async publicShopReviews(shopId: string, query: ReviewListQuery): Promise<JsonObject> {
    if (!isCanonicalUuid(shopId)) {
      throw new AppError('SHOP_NOT_FOUND');
    }
    return this.transactions.withTransaction(async (context) => {
      const snapshot = await this.shopReader.snapshotOfShop(context, shopId);
      if (snapshot === undefined) {
        throw new AppError('SHOP_NOT_FOUND');
      }
      // Issue #190: the public page of a shop that is not set up (or is locked) is as unavailable as its menu.
      if (!(await this.setupGate.evaluate(context, snapshot)).publicVisible) {
        throw new AppError('SHOP_UNAVAILABLE');
      }
      const [summary, rows] = await Promise.all([this.reviews.shopSummary(context, shopId), this.reviews.listShopReviews(context, shopId, query.stars, query.limit, query.offset)]);
      return { shop: { shop_id: shopId, name: snapshot.name }, summary: summaryView(summary), items: rows.map(publicReviewView), limit: query.limit, offset: query.offset };
    });
  }

  // ---- Shipper -------------------------------------------------------------------------------------------------------------------

  /** The Shipper's own score by source (customer / shop) and the ratings about them, without who wrote them. */
  async shipperOwnReviews(principal: AuthPrincipal, query: ShipperReviewListQuery): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const caller = await this.actors.resolve(context, principal, 'SHIPPER', 'share');
      if (caller.role !== 'SHIPPER') {
        throw new TechnicalError('internal', 'Unexpected caller');
      }
      const driverId = caller.driver.driverId;
      const [summary, rows] = await Promise.all([this.reviews.shipperSummary(context, driverId), this.reviews.listShipperReviews(context, driverId, query.source, query.stars, query.limit, query.offset)]);
      const items: JsonObject[] = [];
      for (const row of rows) {
        items.push(shipperReviewView(row, await this.complaints.latestOfReviewBy(context, row.reviewId, caller.userId)));
      }
      return { summary: { all: summaryView(summary.all), customer: summaryView(summary.customer), shop: summaryView(summary.shop) }, items, limit: query.limit, offset: query.offset };
    });
  }

  // ---- shared --------------------------------------------------------------------------------------------------------------------

  /** One write: the idempotency executor, then the actor re-checked under the locks (also for a replay), then the body. */
  async #write(
    principal: AuthPrincipal,
    role: PartyRole,
    operationId: string,
    logicalRequest: JsonObject,
    key: Key,
    body: (context: TransactionContext, caller: Caller) => Promise<{ status: number; payload: JsonObject; reviewId?: string }>,
  ): Promise<IdempotentOutcome> {
    return this.executor.execute(
      {
        scopeType: FEEDBACK_SCOPE_TYPE,
        scopeId: principal.userId,
        operationId,
        idempotencyKey: key,
        logicalRequest,
        replay: {
          kind: 'sensitive',
          authorize: async (context, guard): Promise<true> => {
            if (!isCanonicalUuid(guard.user_id) || guard.user_id !== principal.userId) {
              throw new TechnicalError('internal', 'Invalid replay guard');
            }
            await this.actors.resolve(context, principal, role, 'update');
            return true;
          },
        },
      },
      async (context) => {
        const caller = await this.actors.resolve(context, principal, role, 'update');
        const result = await body(context, caller);
        return { status: result.status, replayGuard: { user_id: caller.userId }, payload: result.payload };
      },
    );
  }

  async #insert(context: TransactionContext, requestId: string, actorId: string, review: NewReview): Promise<{ status: number; payload: JsonObject }> {
    if (!(await this.reviews.insert(context, review))) {
      throw new AppError('REVIEW_ALREADY_EXISTS');
    }
    await this.recorder.review(context, { requestId, actorType: 'USER', actorId, action: reviewOperationOf(review.kind) }, { reviewId: review.reviewId, kind: review.kind, version: 1, shopId: review.shopId, driverId: review.driverId, stars: review.stars, visibility: 'VISIBLE' });
    return { status: 201, payload: { review: { review_id: review.reviewId, stars: review.stars, comment: review.comment } } };
  }

  /** The order of THIS account. Another account's order, a phone-sharing recipient's and a missing one read the same. */
  async #orderOf(context: TransactionContext, userId: string, orderId: string): Promise<OrderFact> {
    const order = await this.orders.orderOfCustomer(context, orderId, userId);
    if (order === undefined) {
      throw new AppError('REVIEW_TARGET_NOT_FOUND');
    }
    return order;
  }

  /** The delivery of the order that succeeded and the assignment that carried it: the only run a customer may rate. */
  async #successfulRun(context: TransactionContext, orderId: string): Promise<{ delivery: DeliveryRow; assignmentId: string; driverId: string } | undefined> {
    for (const delivery of await this.deliveries.listByOrder(context, orderId)) {
      const executing = customerMayRateShipper(delivery, await this.deliveries.listAssignments(context, delivery.deliveryId));
      if (executing !== undefined) {
        return { delivery, assignmentId: executing.assignmentId, driverId: executing.driverId };
      }
    }
    return undefined;
  }
}

const reviewOperationOf = (kind: string): string => (kind === 'SHOP_BY_CUSTOMER' ? OPERATIONS.reviewShop : kind === 'SHIPPER_BY_CUSTOMER' ? OPERATIONS.reviewShipperByCustomer : OPERATIONS.reviewShipperByShop);
