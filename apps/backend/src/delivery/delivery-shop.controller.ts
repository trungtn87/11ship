import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, AuthPrincipal } from '../auth/auth-principal';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { AppError } from '../common/app-errors';
import { rejectBodyAndQuery } from '../customer-profile/customer-profile-validation';
import { DeliveryShopService } from './delivery-shop-service';
import { parseCreateBody, parseCustodyBody, parseDeliveryId, parseEmptyBody, parseReasonBody, parseShopListQuery, parseVersionBody } from './delivery-validation';

type Key = string | string[] | undefined;

function requestIdOf(request: { requestId?: string }): string {
  return request.requestId ?? randomUUID();
}

/**
 * The shop's delivery requests (M07), behind the client session guard. Identity is the principal only: the only identifier in a path is the delivery
 * (or the order), resolved against the caller's OWN shop, so another shop's delivery reads as not found. Every write takes an Idempotency-Key.
 * There is no route to create a delivery for a shop, a state or a Shipper: the pickup is the shop's own position and the Shipper takes it themself.
 */
@UseGuards(SessionAuthGuard)
@Controller('shop/me')
export class DeliveryShopController {
  constructor(private readonly shop: DeliveryShopService) {}

  @Get('deliveries')
  async list(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    const parsed = parseShopListQuery(query);
    rejectBodyAndQuery(request, {});
    return { data: await this.shop.list(this.#principal(request), parsed) };
  }

  @Post('deliveries')
  @HttpCode(201)
  async create(@Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    const outcome = await this.shop.create(this.#principal(request), parseCreateBody(body), key, requestIdOf(request));
    return { data: outcome.payload };
  }

  @Get('deliveries/:delivery_id')
  async read(@Param('delivery_id') id: string, @Req() request: AuthenticatedRequest, @Query() query: unknown) {
    rejectBodyAndQuery(request, query);
    return { data: await this.shop.read(this.#principal(request), parseDeliveryId(id)) };
  }

  @Post('deliveries/:delivery_id/cancel')
  @HttpCode(200)
  async cancel(@Param('delivery_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    const outcome = await this.shop.cancel(this.#principal(request), parseDeliveryId(id), parseReasonBody(body), key, requestIdOf(request));
    return { data: outcome.payload };
  }

  @Post('deliveries/:delivery_id/recall')
  @HttpCode(201)
  async recall(@Param('delivery_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    parseEmptyBody(body);
    const outcome = await this.shop.recall(this.#principal(request), parseDeliveryId(id), key, requestIdOf(request));
    return { data: outcome.payload };
  }

  @Post('deliveries/:delivery_id/fee/counter-accept')
  @HttpCode(200)
  async counterAccept(@Param('delivery_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    const outcome = await this.shop.counterAccept(this.#principal(request), parseDeliveryId(id), parseVersionBody(body), key, requestIdOf(request));
    return { data: outcome.payload };
  }

  @Post('deliveries/:delivery_id/fee/counter-reject')
  @HttpCode(200)
  async counterReject(@Param('delivery_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    const outcome = await this.shop.counterReject(this.#principal(request), parseDeliveryId(id), parseVersionBody(body), key, requestIdOf(request));
    return { data: outcome.payload };
  }

  @Post('deliveries/:delivery_id/fee/customer-confirm')
  @HttpCode(200)
  async customerConfirm(@Param('delivery_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    const outcome = await this.shop.customerConfirm(this.#principal(request), parseDeliveryId(id), parseVersionBody(body), key, requestIdOf(request));
    return { data: outcome.payload };
  }

  @Post('deliveries/:delivery_id/custody')
  @HttpCode(200)
  async custody(@Param('delivery_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    const outcome = await this.shop.resolveCustody(this.#principal(request), parseDeliveryId(id), parseCustodyBody(body), key, requestIdOf(request));
    return { data: outcome.payload };
  }

  /** A call from a confirmed food order (M10). Refused until M10 is connected; direct calls do not use this route. */
  @Post('orders/:order_id/delivery')
  @HttpCode(201)
  async fromOrder(@Param('order_id') id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    parseEmptyBody(body);
    return { data: await this.shop.createFromOrder(this.#principal(request), parseDeliveryId(id)) };
  }

  #principal(request: AuthenticatedRequest): AuthPrincipal {
    if (request.auth === undefined) {
      // Unreachable behind the guard; fail closed rather than act without an identity.
      throw new AppError('SESSION_INVALID');
    }
    return request.auth;
  }
}
