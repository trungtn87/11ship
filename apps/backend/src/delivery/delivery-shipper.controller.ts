import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Headers, HttpCode, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, AuthPrincipal } from '../auth/auth-principal';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { AppError } from '../common/app-errors';
import { rejectBodyAndQuery } from '../customer-profile/customer-profile-validation';
import { DeliveryShipperService } from './delivery-shipper-service';
import { parseCounterBody, parseDeliveryId, parseDestinationBody, parseEmptyBody, parseLocationBody, parseReasonBody, parseScopeQuery, parseVersionBody } from './delivery-validation';
import { AddressChangeService } from '../address-change/address-change-service';
import { parseDecideAddressChangeBody } from '../address-change/address-change-validation';

type Key = string | string[] | undefined;

function requestIdOf(request: { requestId?: string }): string {
  return request.requestId ?? randomUUID();
}

/**
 * The Shipper's deliveries (M07), behind the client session guard. Identity is the principal only: the only identifier in a path is the delivery, and
 * a delivery this Shipper never held reads as not found. Before accepting, a Shipper reads only the offer (no phone, no street address, no map point);
 * the contacts and the map points belong to the Shipper who holds it, and go away when the assignment ends. Every write takes an Idempotency-Key and,
 * where the record can have moved, the expected version.
 */
@UseGuards(SessionAuthGuard)
@Controller('driver')
export class DeliveryShipperController {
  constructor(
    private readonly shipper: DeliveryShipperService,
    private readonly addressChange: AddressChangeService,
  ) {}

  @Get('deliveries/offers')
  async offers(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    rejectBodyAndQuery(request, query);
    return { data: await this.shipper.offers(this.#principal(request)) };
  }

  @Get('deliveries/mine')
  async mine(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    const scope = parseScopeQuery(query);
    rejectBodyAndQuery(request, {});
    return { data: await this.shipper.mine(this.#principal(request), scope) };
  }

  @Get('deliveries/:delivery_id')
  async read(@Param('delivery_id') id: string, @Req() request: AuthenticatedRequest, @Query() query: unknown) {
    rejectBodyAndQuery(request, query);
    return { data: await this.shipper.read(this.#principal(request), parseDeliveryId(id)) };
  }

  @Post('deliveries/:delivery_id/accept')
  @HttpCode(200)
  async accept(@Param('delivery_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    parseEmptyBody(body);
    const outcome = await this.shipper.accept(this.#principal(request), parseDeliveryId(id), key, requestIdOf(request));
    return { data: outcome.payload };
  }

  @Post('deliveries/:delivery_id/release')
  @HttpCode(200)
  async release(@Param('delivery_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    const outcome = await this.shipper.release(this.#principal(request), parseDeliveryId(id), parseReasonBody(body), key, requestIdOf(request));
    return { data: outcome.payload };
  }

  @Post('deliveries/:delivery_id/fee/agree')
  @HttpCode(200)
  async feeAgree(@Param('delivery_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    parseEmptyBody(body);
    const outcome = await this.shipper.feeAgree(this.#principal(request), parseDeliveryId(id), key, requestIdOf(request));
    return { data: outcome.payload };
  }

  @Post('deliveries/:delivery_id/fee/skip')
  @HttpCode(200)
  async feeSkip(@Param('delivery_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    parseEmptyBody(body);
    const outcome = await this.shipper.feeSkip(this.#principal(request), parseDeliveryId(id), key, requestIdOf(request));
    return { data: outcome.payload };
  }

  @Post('deliveries/:delivery_id/fee/counter')
  @HttpCode(200)
  async feeCounter(@Param('delivery_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    const outcome = await this.shipper.feeCounter(this.#principal(request), parseDeliveryId(id), parseCounterBody(body).amountVnd, key, requestIdOf(request));
    return { data: outcome.payload };
  }

  @Post('deliveries/:delivery_id/destination')
  @HttpCode(200)
  async destination(@Param('delivery_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    const outcome = await this.shipper.confirmDestination(this.#principal(request), parseDeliveryId(id), parseDestinationBody(body), key, requestIdOf(request));
    return { data: outcome.payload };
  }

  @Post('deliveries/:delivery_id/pickup')
  @HttpCode(200)
  async pickup(@Param('delivery_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    const outcome = await this.shipper.pickup(this.#principal(request), parseDeliveryId(id), parseVersionBody(body), key, requestIdOf(request));
    return { data: outcome.payload };
  }

  @Post('deliveries/:delivery_id/complete')
  @HttpCode(200)
  async complete(@Param('delivery_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    const outcome = await this.shipper.complete(this.#principal(request), parseDeliveryId(id), parseVersionBody(body), key, requestIdOf(request));
    return { data: outcome.payload };
  }

  @Post('deliveries/:delivery_id/fail')
  @HttpCode(200)
  fail(): never {
    // The route stays only so an old app gets a clear, fixed refusal; the Shipper has no "failed" any more (Owner decision 2026-10-23).
    return this.shipper.fail();
  }

  /** The Shipper's LATEST position (M14): overwrites the previous one, keeps no trail. */
  @Put('location')
  @HttpCode(200)
  async location(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return { data: await this.shipper.reportLocation(this.#principal(request), parseLocationBody(body)) };
  }

  @Post('deliveries/:delivery_id/address-change-request/decide')
  @HttpCode(200)
  async decideAddressChange(
    @Param('delivery_id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: Key,
    @Req() request: AuthenticatedRequest,
  ) {
    const outcome = await this.addressChange.decideDeliveryChange(
      this.#principal(request),
      parseDeliveryId(id),
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
