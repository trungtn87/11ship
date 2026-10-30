import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, AuthPrincipal } from '../auth/auth-principal';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { AppError } from '../common/app-errors';
import { rejectBodyAndQuery } from '../customer-profile/customer-profile-validation';
import { OrderShopService } from './order-shop-service';
import { parseCallBody, parseConfirmBody, parseEditBody, parseOrderId, parsePaymentBody, parseReasonBody, parseShopListQuery, parseVersionBody } from './order-validation';
import { AddressChangeService } from '../address-change/address-change-service';
import { parseDecideAddressChangeBody } from '../address-change/address-change-validation';

type Key = string | string[] | undefined;

function requestIdOf(request: { requestId?: string }): string {
  return request.requestId ?? randomUUID();
}

/**
 * The shop's Orders (M10), behind the client session guard. Identity is the principal only: the only identifier in a path is the Order, resolved against the
 * caller's OWN shop, so another shop's Order reads as not found. There is no route to create an Order for a shop, set a status or a total: the shop edits lines
 * before confirming, confirms or refuses, calls a Shipper, cancels or closes. Every write takes an Idempotency-Key and the Order version.
 */
@UseGuards(SessionAuthGuard)
@Controller('shop/me/orders')
export class OrderShopController {
  constructor(
    private readonly shop: OrderShopService,
    private readonly addressChange: AddressChangeService,
  ) {}

  @Get()
  async list(@Query() query: unknown, @Req() request: AuthenticatedRequest) {
    return { data: await this.shop.list(this.#principal(request), parseShopListQuery(query)) };
  }

  @Get(':order_id')
  async read(@Param('order_id') id: string, @Req() request: AuthenticatedRequest, @Query() query: unknown) {
    rejectBodyAndQuery(request, query);
    return { data: await this.shop.read(this.#principal(request), parseOrderId(id)) };
  }

  @Post(':order_id/edit')
  @HttpCode(200)
  async edit(@Param('order_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    const outcome = await this.shop.edit(this.#principal(request), parseOrderId(id), parseEditBody(body), key, requestIdOf(request));
    return { data: outcome.payload };
  }

  @Post(':order_id/confirm')
  @HttpCode(200)
  async confirm(@Param('order_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    const outcome = await this.shop.confirm(this.#principal(request), parseOrderId(id), parseConfirmBody(body), key, requestIdOf(request));
    return { data: outcome.payload };
  }

  /** Kept for the APK from before the "ready" step was removed; it only checks and answers the Order (see OrderShopService.readyCompat). */
  @Post(':order_id/ready')
  @HttpCode(200)
  async ready(@Param('order_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    const outcome = await this.shop.readyCompat(this.#principal(request), parseOrderId(id), parseVersionBody(body), key);
    return { data: outcome.payload };
  }

  @Post(':order_id/reject')
  @HttpCode(200)
  async reject(@Param('order_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    const outcome = await this.shop.reject(this.#principal(request), parseOrderId(id), parseReasonBody(body), key, requestIdOf(request));
    return { data: outcome.payload };
  }

  @Post(':order_id/payment')
  @HttpCode(200)
  async payment(@Param('order_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    const outcome = await this.shop.payment(this.#principal(request), parseOrderId(id), parsePaymentBody(body), key, requestIdOf(request));
    return { data: outcome.payload };
  }

  @Post(':order_id/call-shipper')
  @HttpCode(201)
  async callShipper(@Param('order_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    const outcome = await this.shop.callShipper(this.#principal(request), parseOrderId(id), parseCallBody(body), key, requestIdOf(request));
    return { data: outcome.payload };
  }

  @Post(':order_id/cancel')
  @HttpCode(200)
  async cancel(@Param('order_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    const outcome = await this.shop.cancel(this.#principal(request), parseOrderId(id), parseReasonBody(body), key, requestIdOf(request));
    return { data: outcome.payload };
  }

  @Post(':order_id/close-not-completed')
  @HttpCode(200)
  async closeNotCompleted(@Param('order_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    const outcome = await this.shop.closeNotCompleted(this.#principal(request), parseOrderId(id), parseReasonBody(body), key, requestIdOf(request));
    return { data: outcome.payload };
  }

  @Post(':order_id/address-change-request/decide')
  @HttpCode(200)
  async decideAddressChange(
    @Param('order_id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: Key,
    @Req() request: AuthenticatedRequest,
  ) {
    const outcome = await this.addressChange.decideOrderChange(
      this.#principal(request),
      parseOrderId(id),
      parseDecideAddressChangeBody(body),
      key,
      requestIdOf(request),
    );
    return { data: outcome.payload };
  }

  #principal(request: AuthenticatedRequest): AuthPrincipal {
    if (request.auth === undefined) {
      // Unreachable behind the guard; fail closed rather than act without an identity.
      throw new AppError('SESSION_INVALID');
    }
    return request.auth;
  }
}
