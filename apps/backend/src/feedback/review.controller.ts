import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Headers, HttpCode, Param, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, AuthPrincipal } from '../auth/auth-principal';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { AppError } from '../common/app-errors';
import { rejectBodyAndQuery } from '../customer-profile/customer-profile-validation';
import { parseReplyBody, parseReviewBody, parseReviewListQuery, parseShipperReviewListQuery, parseUuid } from './feedback-validation';
import { ReviewService } from './review-service';

type Key = string | string[] | undefined;

const requestIdOf = (request: { requestId?: string }): string => request.requestId ?? randomUUID();

function principalOf(request: AuthenticatedRequest): AuthPrincipal {
  if (request.auth === undefined) {
    // Unreachable behind the guard; fail closed rather than act without an identity.
    throw new AppError('SESSION_INVALID');
  }
  return request.auth;
}

/**
 * The ratings of M11.01 as the apps use them. Identity is the principal only: the only identifiers in a path are the order, the delivery or the rating,
 * resolved against what the caller really is (their account's order, their shop's delivery or rating), so another account's reads as not found.
 * Every write takes an Idempotency-Key. There is NO route that edits or deletes a rating, and none for the shop to report one.
 */
@UseGuards(SessionAuthGuard)
@Controller()
export class ReviewController {
  constructor(private readonly reviews: ReviewService) {}

  // ---- customer ------------------------------------------------------------------------------------------------------------------

  @Get('customers/me/orders/:order_id/reviews')
  async customerState(@Param('order_id') id: string, @Req() request: AuthenticatedRequest, @Query() query: unknown) {
    rejectBodyAndQuery(request, query);
    return { data: await this.reviews.customerOrderState(principalOf(request), parseUuid(id)) };
  }

  @Post('customers/me/orders/:order_id/reviews/shop')
  @HttpCode(201)
  async customerShop(@Param('order_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    const outcome = await this.reviews.customerReviewShop(principalOf(request), parseUuid(id), parseReviewBody(body), key, requestIdOf(request));
    return { data: outcome.payload };
  }

  @Post('customers/me/orders/:order_id/reviews/shipper')
  @HttpCode(201)
  async customerShipper(@Param('order_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    const outcome = await this.reviews.customerReviewShipper(principalOf(request), parseUuid(id), parseReviewBody(body), key, requestIdOf(request));
    return { data: outcome.payload };
  }

  

  @Get('customers/me/deliveries/:delivery_id/review')
  async customerDeliveryReviewState(@Param('delivery_id') id: string, @Req() request: AuthenticatedRequest, @Query() query: unknown) {
    rejectBodyAndQuery(request, query);
    return { data: await this.reviews.customerDeliveryState(principalOf(request), parseUuid(id)) };
  }

  @Post('customers/me/deliveries/:delivery_id/review/shipper')
  @HttpCode(201)
  async customerDeliveryShipper(@Param('delivery_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    const outcome = await this.reviews.customerReviewDeliveryShipper(principalOf(request), parseUuid(id), parseReviewBody(body), key, requestIdOf(request));
    return { data: outcome.payload };
  }

  @Post('customers/me/deliveries/:delivery_id/review')
  @HttpCode(201)
  async customerDeliveryShipperAlias(@Param('delivery_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    const outcome = await this.reviews.customerReviewDeliveryShipper(principalOf(request), parseUuid(id), parseReviewBody(body), key, requestIdOf(request));
    return { data: outcome.payload };
  }

  // ---- shop ----------------------------------------------------------------------------------------------------------------------

  @Get('shop/me/deliveries/:delivery_id/review')
  async shopDelivery(@Param('delivery_id') id: string, @Req() request: AuthenticatedRequest, @Query() query: unknown) {
    rejectBodyAndQuery(request, query);
    return { data: await this.reviews.shopDeliveryState(principalOf(request), parseUuid(id)) };
  }

  @Post('shop/me/deliveries/:delivery_id/review')
  @HttpCode(201)
  async shopRatesShipper(@Param('delivery_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    const outcome = await this.reviews.shopReviewShipper(principalOf(request), parseUuid(id), parseReviewBody(body), key, requestIdOf(request));
    return { data: outcome.payload };
  }

  @Get('shop/me/reviews')
  async shopReviews(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    const parsed = parseReviewListQuery(query);
    return { data: await this.reviews.shopOwnReviews(principalOf(request), parsed) };
  }

  @Put('shop/me/reviews/:review_id/reply')
  @HttpCode(200)
  async reply(@Param('review_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    const outcome = await this.reviews.saveReply(principalOf(request), parseUuid(id), parseReplyBody(body), key, requestIdOf(request));
    return { data: outcome.payload };
  }

  @Get('shop/me/reviews/:review_id/reply/history')
  async replyHistory(@Param('review_id') id: string, @Req() request: AuthenticatedRequest, @Query() query: unknown) {
    rejectBodyAndQuery(request, query);
    return { data: await this.reviews.replyHistory(principalOf(request), parseUuid(id)) };
  }

  // ---- Shipper -------------------------------------------------------------------------------------------------------------------

  @Get('driver/reviews')
  async shipperReviews(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    return { data: await this.reviews.shipperOwnReviews(principalOf(request), parseShipperReviewListQuery(query)) };
  }
}

/** What anybody may read: the public ratings of a shop (no session). Read only, never cached, nothing personal in the answer. */
@Controller()
export class PublicReviewController {
  constructor(private readonly reviews: ReviewService) {}

  @Get('shops/:shop_id/reviews')
  async shop(@Param('shop_id') id: string, @Query() query: unknown, @Res({ passthrough: true }) response: { setHeader(name: string, value: string): unknown }) {
    response.setHeader('Cache-Control', 'no-store');
    return { data: await this.reviews.publicShopReviews(id, parseReviewListQuery(query)) };
  }
}
