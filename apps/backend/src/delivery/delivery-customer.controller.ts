import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, AuthPrincipal } from '../auth/auth-principal';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { AppError } from '../common/app-errors';
import { rejectBodyAndQuery } from '../customer-profile/customer-profile-validation';
import { DeliveryCustomerService } from './delivery-customer-service';
import { parseCustomerCreateBody, parseDeliveryId, parseReasonBody, parseScopeQuery, parseToggleLocationBody, parseVersionBody } from './delivery-validation';

type Key = string | string[] | undefined;

function requestIdOf(request: { requestId?: string }): string {
  return request.requestId ?? randomUUID();
}

@UseGuards(SessionAuthGuard)
@Controller('customers/me')
export class DeliveryCustomerController {
  constructor(private readonly customer: DeliveryCustomerService) {}

  @Get('deliveries')
  async list(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    const scope = parseScopeQuery(query);
    rejectBodyAndQuery(request, {});
    return { data: await this.customer.list(this.#principal(request), { scope }) };
  }

  @Post('deliveries')
  @HttpCode(201)
  async create(@Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    const outcome = await this.customer.create(this.#principal(request), parseCustomerCreateBody(body), key, requestIdOf(request));
    return { data: outcome.payload };
  }

  @Get('deliveries/:delivery_id')
  async read(@Param('delivery_id') id: string, @Req() request: AuthenticatedRequest, @Query() query: unknown) {
    rejectBodyAndQuery(request, query);
    return { data: await this.customer.read(this.#principal(request), parseDeliveryId(id)) };
  }

  @Post('deliveries/:delivery_id/cancel')
  @HttpCode(200)
  async cancel(@Param('delivery_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    const outcome = await this.customer.cancel(this.#principal(request), parseDeliveryId(id), parseReasonBody(body), key, requestIdOf(request));
    return { data: outcome.payload };
  }

  @Post('deliveries/:delivery_id/cancel-after-pickup')
  @HttpCode(200)
  async cancelAfterPickup(@Param('delivery_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    const outcome = await this.customer.cancelAfterPickup(this.#principal(request), parseDeliveryId(id), parseReasonBody(body), key, requestIdOf(request));
    return { data: outcome.payload };
  }

  @Post('deliveries/:delivery_id/fee/counter-accept')
  @HttpCode(200)
  async counterAccept(@Param('delivery_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    const outcome = await this.customer.counterAccept(this.#principal(request), parseDeliveryId(id), parseVersionBody(body), key, requestIdOf(request));
    return { data: outcome.payload };
  }

  @Post('deliveries/:delivery_id/fee/counter-reject')
  @HttpCode(200)
  async counterReject(@Param('delivery_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    const outcome = await this.customer.counterReject(this.#principal(request), parseDeliveryId(id), parseVersionBody(body), key, requestIdOf(request));
    return { data: outcome.payload };
  }

  @Post('deliveries/:delivery_id/tracking-link')
  @HttpCode(201)
  async createTrackingLink(@Param('delivery_id') id: string, @Req() request: AuthenticatedRequest) {
    return { data: await this.customer.createTrackingLink(this.#principal(request), parseDeliveryId(id)) };
  }

  @Get('deliveries/:delivery_id/tracking-link')
  async getTrackingLink(@Param('delivery_id') id: string, @Req() request: AuthenticatedRequest, @Query() query: unknown) {
    rejectBodyAndQuery(request, query);
    return { data: await this.customer.getTrackingLinkStatus(this.#principal(request), parseDeliveryId(id)) };
  }

  @Post('deliveries/:delivery_id/tracking-link/toggle-location')
  @HttpCode(200)
  async toggleLocation(@Param('delivery_id') id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const parsed = parseToggleLocationBody(body);
    return { data: await this.customer.toggleTrackingLocation(this.#principal(request), parseDeliveryId(id), parsed.shareLocation) };
  }

  @Post('deliveries/:delivery_id/tracking-link/revoke')
  @HttpCode(200)
  async revokeTrackingLink(@Param('delivery_id') id: string, @Req() request: AuthenticatedRequest) {
    return { data: await this.customer.revokeTrackingLink(this.#principal(request), parseDeliveryId(id)) };
  }

  #principal(request: AuthenticatedRequest): AuthPrincipal {
    if (request.auth === undefined) {
      throw new AppError('SESSION_INVALID');
    }
    return request.auth;
  }
}
