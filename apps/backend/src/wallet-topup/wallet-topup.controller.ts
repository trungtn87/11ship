import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, AuthPrincipal } from '../auth/auth-principal';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { AppError } from '../common/app-errors';
import { rejectBodyAndQuery } from '../customer-profile/customer-profile-validation';
import { TopupRequestService } from './topup-request-service';
import { parseCancelTopupRequest, parseCreateTopupRequest, parseRequestIdParam, parseTopupListQuery } from './topup-request-validation';

type Key = string | string[] | undefined;

function requestIdOf(request: { requestId?: string }): string {
  return request.requestId ?? randomUUID();
}

/**
 * The Shipper's own top-up requests (M04-B2.1), behind the client session guard. Identity is the principal only: the only path
 * parameter is the request id, and it is resolved against the caller's own Shipper, so another Shipper's request reads as not found.
 * No route here changes a balance; confirming money received is an administration function (B2.2).
 */
@UseGuards(SessionAuthGuard)
@Controller('driver/wallet')
export class WalletTopupController {
  constructor(private readonly topups: TopupRequestService) {}

  @Get('topup-receiving-accounts')
  async receivingAccounts(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    rejectBodyAndQuery(request, query);
    return { data: await this.topups.receivingAccounts(this.#principal(request)) };
  }

  @Get('topup-requests')
  async list(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    const parsed = parseTopupListQuery(query);
    rejectBodyAndQuery(request, {});
    return { data: await this.topups.list(this.#principal(request), parsed) };
  }

  @Post('topup-requests')
  @HttpCode(201)
  async create(@Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    return { data: await this.topups.create(this.#principal(request), parseCreateTopupRequest(body).amountVnd, key, requestIdOf(request)) };
  }

  @Get('topup-requests/:request_id')
  async read(@Param('request_id') id: string, @Req() request: AuthenticatedRequest, @Query() query: unknown) {
    rejectBodyAndQuery(request, query);
    return { data: await this.topups.read(this.#principal(request), parseRequestIdParam(id)) };
  }

  @Post('topup-requests/:request_id/cancel')
  @HttpCode(200)
  async cancel(@Param('request_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    return { data: await this.topups.cancel(this.#principal(request), parseRequestIdParam(id), parseCancelTopupRequest(body).expectedVersion, key, requestIdOf(request)) };
  }

  #principal(request: AuthenticatedRequest): AuthPrincipal {
    if (request.auth === undefined) {
      // Unreachable behind the guard; fail closed rather than act without an identity.
      throw new AppError('SESSION_INVALID');
    }
    return request.auth;
  }
}
