import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Headers, Put, Req, UseGuards } from '@nestjs/common';
import { actorOf, AuthenticatedRequest } from '../auth/auth-principal';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { AppError } from '../common/app-errors';
import { ShopManagementService } from './shop-management-service';
import { parseBusinessHoursBody, parseShopProfileUpdateBody } from './shop-management-validation';

function requestIdOf(request: { requestId?: string }): string {
  return request.requestId ?? randomUUID();
}

/**
 * HTTP adapter of Shop management (M02-A). It parses strictly, calls one service and wraps the result in { data }.
 * The user and the session come only from the authenticated principal; no business rule lives here.
 *
 * There is deliberately NO route that switches a shop open or closed: a shop is ONLINE or OFFLINE by its weekly
 * schedule alone, so no accepting-orders path exists and the two PUT bodies refuse an accepting_orders field.
 */
@Controller('shop/me')
@UseGuards(SessionAuthGuard)
export class ShopManagementController {
  constructor(private readonly management: ShopManagementService) {}

  /** The caller's own shop with its schedule and availability. Read-only: no Idempotency-Key, no audit, no outbox. */
  @Get()
  async read(@Req() request: AuthenticatedRequest) {
    const principal = this.#principal(request);
    return { data: await this.management.read(actorOf(principal)) };
  }

  @Put('profile')
  async updateProfile(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const principal = this.#principal(request);
    const input = parseShopProfileUpdateBody(body);
    const outcome = await this.management.updateProfile(actorOf(principal), input, idempotencyKey, requestIdOf(request));
    return { data: outcome.payload };
  }

  @Put('business-hours')
  async replaceBusinessHours(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const principal = this.#principal(request);
    const input = parseBusinessHoursBody(body);
    const outcome = await this.management.replaceBusinessHours(
      actorOf(principal),
      input,
      idempotencyKey,
      requestIdOf(request),
    );
    return { data: outcome.payload };
  }

  #principal(request: AuthenticatedRequest) {
    if (request.auth === undefined) {
      throw new AppError('SESSION_INVALID');
    }
    return request.auth;
  }
}
