import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, AuthPrincipal } from '../auth/auth-principal';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { AppError } from '../common/app-errors';
import { rejectBodyAndQuery } from '../customer-profile/customer-profile-validation';
import { ShopRevenueService } from './shop-revenue-service';
import { parseRevenueOrdersQuery, parseRevenueSummaryQuery } from './shop-revenue-validation';

/** Read-only revenue of the signed-in owner's shop (issue #391). Behind the client session guard; no shop id in any path, query or body. */
@UseGuards(SessionAuthGuard)
@Controller('shop/revenue')
export class ShopRevenueController {
  constructor(private readonly revenue: ShopRevenueService) {}

  @Get('summary')
  async summary(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    const parsed = parseRevenueSummaryQuery(query);
    rejectBodyAndQuery(request, {});
    return { data: await this.revenue.summary(this.#principal(request), parsed.period) };
  }

  @Get('orders')
  async orders(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    const parsed = parseRevenueOrdersQuery(query);
    rejectBodyAndQuery(request, {});
    return { data: await this.revenue.orders(this.#principal(request), parsed.period, parsed.limit, parsed.cursor) };
  }

  #principal(request: AuthenticatedRequest): AuthPrincipal {
    if (request.auth === undefined) {
      // Unreachable behind the guard; fail closed rather than act without an identity.
      throw new AppError('SESSION_INVALID');
    }
    return request.auth;
  }
}
