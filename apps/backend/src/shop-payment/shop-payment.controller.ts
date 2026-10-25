import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, AuthPrincipal } from '../auth/auth-principal';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { AppError } from '../common/app-errors';
import { rejectBodyAndQuery } from '../customer-profile/customer-profile-validation';
import { ShopPaymentService } from './shop-payment-service';
import { parseCancelPayment, parseCreatePayment, parseEmptyBody, parsePaymentId, parsePaymentListQuery } from './shop-payment-validation';

type Key = string | string[] | undefined;

function requestIdOf(request: { requestId?: string }): string {
  return request.requestId ?? randomUUID();
}

/**
 * The shop owner's payment requests (#198), behind the client session guard. Identity is the principal only; the only path parameter is the request id and it
 * is resolved against the caller's own shop, so a request of another shop reads as not found. No route here confirms money or opens a right: that is the
 * administration's (separate buttons, separate rights).
 */
@UseGuards(SessionAuthGuard)
@Controller('shop/me')
export class ShopPaymentController {
  constructor(private readonly payments: ShopPaymentService) {}

  @Get('payment-receiving-accounts')
  async receivingAccounts(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    rejectBodyAndQuery(request, query);
    return { data: await this.payments.receivingAccounts(this.#principal(request)) };
  }

  @Get('payment-requests')
  async list(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    const parsed = parsePaymentListQuery(query).list;
    rejectBodyAndQuery(request, {});
    return { data: await this.payments.list(this.#principal(request), parsed) };
  }

  @Post('payment-requests')
  @HttpCode(201)
  async create(@Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    return { data: await this.payments.create(this.#principal(request), parseCreatePayment(body), key, requestIdOf(request)) };
  }

  @Get('payment-requests/:request_id')
  async read(@Param('request_id') id: string, @Req() request: AuthenticatedRequest, @Query() query: unknown) {
    rejectBodyAndQuery(request, query);
    return { data: await this.payments.read(this.#principal(request), parsePaymentId(id)) };
  }

  @Post('payment-requests/:request_id/report-transfer')
  @HttpCode(200)
  async report(@Param('request_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    parseEmptyBody(body);
    return { data: await this.payments.report(this.#principal(request), parsePaymentId(id), key, requestIdOf(request)) };
  }

  @Post('payment-requests/:request_id/cancel')
  @HttpCode(200)
  async cancel(@Param('request_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    return { data: await this.payments.cancel(this.#principal(request), parsePaymentId(id), parseCancelPayment(body).expectedVersion, key, requestIdOf(request)) };
  }

  #principal(request: AuthenticatedRequest): AuthPrincipal {
    if (request.auth === undefined) {
      // Unreachable behind the guard; fail closed rather than act without an identity.
      throw new AppError('SESSION_INVALID');
    }
    return request.auth;
  }
}
