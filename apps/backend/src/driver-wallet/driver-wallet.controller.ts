import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AllowLockedDriver } from '../auth/allow-locked-driver';
import { AuthenticatedRequest, AuthPrincipal } from '../auth/auth-principal';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { AppError } from '../common/app-errors';
import { rejectBodyAndQuery } from '../customer-profile/customer-profile-validation';
import { DriverWalletService } from './driver-wallet-service';
import { parseCancelWithdrawal, parseCreateWithdrawal, parseFeedQuery, parseHoldsQuery, parseWithdrawalIdParam, parseWithdrawalListQuery } from './driver-wallet-validation';
import { DriverWithdrawalService } from './driver-withdrawal-service';

type Key = string | string[] | undefined;

function requestIdOf(request: { requestId?: string }): string {
  return request.requestId ?? randomUUID();
}

/**
 * The Shipper's own wallet under /v1/driver/wallet (M04-C), behind the client session guard. Identity is the principal only: there is no driver, wallet or user
 * id in any path, query or body, and the only path parameter is a withdrawal id that is resolved against the caller's own Shipper (another Shipper's withdrawal
 * reads as not found). Every GET is side-effect free. The wallet of a LOCKED driver stays reachable (Owner decision 2026-10-14: balance, history, withdrawal).
 * No route here changes a balance: a withdrawal request only sets money aside, and only an administration command records the transfer.
 */
@AllowLockedDriver()
@UseGuards(SessionAuthGuard)
@Controller('driver/wallet')
export class DriverWalletController {
  constructor(
    private readonly wallet: DriverWalletService,
    private readonly withdrawals: DriverWithdrawalService,
  ) {}

  @Get()
  async summary(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    rejectBodyAndQuery(request, query);
    return { data: await this.wallet.summary(this.#principal(request)) };
  }

  @Get('holds')
  async holds(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    const parsed = parseHoldsQuery(query);
    rejectBodyAndQuery(request, {});
    return { data: await this.wallet.holds(this.#principal(request), parsed.status) };
  }

  @Get('transactions')
  async history(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    const parsed = parseFeedQuery(query);
    rejectBodyAndQuery(request, {});
    return { data: await this.wallet.history(this.#principal(request), parsed) };
  }

  @Get('withdrawal-account')
  async account(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    rejectBodyAndQuery(request, query);
    return { data: await this.wallet.withdrawalAccount(this.#principal(request)) };
  }

  @Get('withdrawals')
  async list(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    const parsed = parseWithdrawalListQuery(query);
    rejectBodyAndQuery(request, {});
    return { data: await this.withdrawals.list(this.#principal(request), parsed) };
  }

  @Post('withdrawals')
  @HttpCode(201)
  async create(@Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    return { data: await this.withdrawals.create(this.#principal(request), parseCreateWithdrawal(body).amountVnd, key, requestIdOf(request)) };
  }

  @Get('withdrawals/:withdrawal_id')
  async read(@Param('withdrawal_id') id: string, @Req() request: AuthenticatedRequest, @Query() query: unknown) {
    rejectBodyAndQuery(request, query);
    return { data: await this.withdrawals.read(this.#principal(request), parseWithdrawalIdParam(id)) };
  }

  @Post('withdrawals/:withdrawal_id/cancel')
  @HttpCode(200)
  async cancel(@Param('withdrawal_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    return { data: await this.withdrawals.cancel(this.#principal(request), parseWithdrawalIdParam(id), parseCancelWithdrawal(body).expectedVersion, key, requestIdOf(request)) };
  }

  #principal(request: AuthenticatedRequest): AuthPrincipal {
    if (request.auth === undefined) {
      // Unreachable behind the guard; fail closed rather than act without an identity.
      throw new AppError('SESSION_INVALID');
    }
    return request.auth;
  }
}
