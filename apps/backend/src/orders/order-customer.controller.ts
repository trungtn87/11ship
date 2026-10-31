import { randomUUID } from 'node:crypto';
import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, AuthPrincipal } from '../auth/auth-principal';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { AppError } from '../common/app-errors';
import { rejectBodyAndQuery } from '../customer-profile/customer-profile-validation';
import { OrderCustomerDeliveryService } from './order-customer-delivery-service';
import { OrderCustomerService } from './order-customer-service';
import { parseCartBody, parseClientRefQuery, parseCustomerCancelBody, parseCustomerListQuery, parseFeeDecisionBody, parseOrderId, parsePlaceBody, parsePreviewBody, parseReasonBody, parseReorderBody } from './order-validation';
import { AddressChangeService } from '../address-change/address-change-service';
import { parseCancelAddressChangeBody, parseCreateAddressChangeBody } from '../address-change/address-change-validation';

type Key = string | string[] | undefined;

function requestIdOf(request: { requestId?: string }): string {
  return request.requestId ?? randomUUID();
}

/**
 * The customer's Orders (M10), behind the client session guard. Identity is the principal only: no user id, customer id, status, price total of someone else
 * or version of another record arrives from a client, and the only identifier in a path is the Order, resolved against the caller's OWN orders (another
 * customer's Order reads as not found). Every write that creates or ends an Order takes an Idempotency-Key. The server decides prices, availability and hours.
 */
@UseGuards(SessionAuthGuard)
@Controller('customers/me')
export class OrderCustomerController {
  constructor(
    private readonly customer: OrderCustomerService,
    private readonly delivery: OrderCustomerDeliveryService,
    private readonly addressChange: AddressChangeService,
  ) {}

  @Get('cart')
  async cart(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    rejectBodyAndQuery(request, query);
    return { data: await this.customer.readCart(this.#principal(request)) };
  }

  @Put('cart')
  async replaceCart(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return { data: await this.customer.replaceCart(this.#principal(request), parseCartBody(body)) };
  }

  @Delete('cart')
  async clearCart(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    rejectBodyAndQuery(request, query);
    return { data: await this.customer.clearCart(this.#principal(request)) };
  }

  @Post('orders/preview')
  @HttpCode(200)
  async preview(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return { data: await this.customer.preview(this.#principal(request), parsePreviewBody(body)) };
  }

  @Post('orders')
  @HttpCode(201)
  async place(@Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    const outcome = await this.customer.place(this.#principal(request), parsePlaceBody(body), key, requestIdOf(request));
    return { data: outcome.payload };
  }

  @Get('orders/lookup')
  async lookup(@Query() query: unknown, @Req() request: AuthenticatedRequest) {
    return { data: await this.customer.lookup(this.#principal(request), parseClientRefQuery(query)) };
  }

  @Get('orders')
  async list(@Query() query: unknown, @Req() request: AuthenticatedRequest) {
    return { data: await this.customer.list(this.#principal(request), parseCustomerListQuery(query)) };
  }

  @Get('orders/:order_id')
  async read(@Param('order_id') id: string, @Req() request: AuthenticatedRequest, @Query() query: unknown) {
    rejectBodyAndQuery(request, query);
    return { data: await this.customer.read(this.#principal(request), parseOrderId(id)) };
  }

  @Post('orders/:order_id/cancel')
  @HttpCode(200)
  async cancel(@Param('order_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    const outcome = await this.customer.cancel(this.#principal(request), parseOrderId(id), parseCustomerCancelBody(body), key, requestIdOf(request));
    return { data: outcome.payload };
  }

  /** After the Shipper picked up the goods the customer who placed the order is the only one who can cancel it (reason required). */
  @Post('orders/:order_id/cancel-after-pickup')
  @HttpCode(200)
  async cancelAfterPickup(@Param('order_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    const outcome = await this.delivery.cancelAfterPickup(this.#principal(request), parseOrderId(id), parseReasonBody(body), key, requestIdOf(request));
    return { data: outcome.payload };
  }

  /** The customer, as the payer, answers the delivery fee a Shipper proposed (ACCEPT or REJECT). */
  @Post('orders/:order_id/delivery/fee')
  @HttpCode(200)
  async decideFee(@Param('order_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    const outcome = await this.delivery.decideFee(this.#principal(request), parseOrderId(id), parseFeeDecisionBody(body), key, requestIdOf(request));
    return { data: outcome.payload };
  }

  @Post('orders/:order_id/reorder')
  @HttpCode(200)
  async reorder(@Param('order_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    const outcome = await this.customer.reorder(this.#principal(request), parseOrderId(id), parseReorderBody(body), key);
    return { data: outcome.payload };
  }

  @Post('orders/:order_id/address-change-request')
  @HttpCode(200)
  async requestAddressChange(
    @Param('order_id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: Key,
    @Req() request: AuthenticatedRequest,
  ) {
    const outcome = await this.addressChange.requestOrderChange(
      this.#principal(request),
      parseOrderId(id),
      parseCreateAddressChangeBody(body),
      key,
      requestIdOf(request),
    );
    return { data: outcome.payload };
  }

  @Post('orders/:order_id/address-change-request/cancel')
  @HttpCode(200)
  async cancelAddressChange(
    @Param('order_id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: Key,
    @Req() request: AuthenticatedRequest,
  ) {
    const outcome = await this.addressChange.cancelOrderChange(
      this.#principal(request),
      parseOrderId(id),
      parseCancelAddressChangeBody(body),
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
