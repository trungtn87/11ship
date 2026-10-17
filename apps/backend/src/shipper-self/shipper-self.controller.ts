import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Headers, HttpCode, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, AuthPrincipal } from '../auth/auth-principal';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { AppError } from '../common/app-errors';
import { rejectBodyAndQuery } from '../customer-profile/customer-profile-validation';
import { ShipperSelfService } from './shipper-self-service';
import { parseAccepting, parseBankUpdate, parseClosureRequest, parseProfileUpdate, parseVersionOnly } from './shipper-self-validation';

type Key = string | string[] | undefined;

function requestIdOf(request: { requestId?: string }): string {
  return request.requestId ?? randomUUID();
}

/**
 * The Shipper's own M03 endpoints (Bearer session of a client app). Identity is the principal only: there is no driver id, user id,
 * status, type or review state in any path, query or body. Every write takes an Idempotency-Key and the expected_version of the
 * profile and answers the owner's view of the profile (which never carries the internal classification).
 */
@UseGuards(SessionAuthGuard)
@Controller('driver')
export class ShipperSelfController {
  constructor(private readonly shipper: ShipperSelfService) {}

  /** The caller's own Shipper profile, or { data: null } when there is none. */
  @Get('me')
  async read(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    rejectBodyAndQuery(request, query);
    return { data: await this.shipper.read(this.#principal(request)) };
  }

  @Get('banks')
  banks(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    rejectBodyAndQuery(request, query);
    this.#principal(request);
    return { data: this.shipper.banksList() };
  }

  @Get('wallet-limits')
  async walletLimits(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    rejectBodyAndQuery(request, query);
    return { data: await this.shipper.walletLimits(this.#principal(request)) };
  }

  @Put('me/profile')
  async updateProfile(@Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    return { data: await this.shipper.updateProfile(this.#principal(request), parseProfileUpdate(body), key, requestIdOf(request)) };
  }

  @Put('me/bank')
  async saveBank(@Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    return { data: await this.shipper.saveBank(this.#principal(request), parseBankUpdate(body), key, requestIdOf(request)) };
  }

  @Post('me/submit')
  @HttpCode(200)
  async submit(@Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    return { data: await this.shipper.submit(this.#principal(request), parseVersionOnly(body), key, requestIdOf(request)) };
  }

  @Post('me/accepting')
  @HttpCode(200)
  async accepting(@Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    return { data: await this.shipper.setAccepting(this.#principal(request), parseAccepting(body), key, requestIdOf(request)) };
  }

  @Post('me/closure-request')
  @HttpCode(200)
  async requestClosure(@Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    return { data: await this.shipper.requestClosure(this.#principal(request), parseClosureRequest(body), key, requestIdOf(request)) };
  }

  @Post('me/closure-cancel')
  @HttpCode(200)
  async cancelClosure(@Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    return { data: await this.shipper.cancelClosure(this.#principal(request), parseVersionOnly(body), key, requestIdOf(request)) };
  }

  #principal(request: AuthenticatedRequest): AuthPrincipal {
    if (request.auth === undefined) {
      // Unreachable behind the guard; fail closed rather than act without an identity.
      throw new AppError('SESSION_INVALID');
    }
    return request.auth;
  }
}
