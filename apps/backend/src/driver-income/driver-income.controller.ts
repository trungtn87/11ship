import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AllowLockedDriver } from '../auth/allow-locked-driver';
import { AuthenticatedRequest, AuthPrincipal } from '../auth/auth-principal';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { AppError } from '../common/app-errors';
import { rejectBodyAndQuery } from '../customer-profile/customer-profile-validation';
import { DriverIncomeService } from './driver-income.service';
import { parseIncomePeriod } from './driver-income-validation';

/** GET /v1/driver/income/summary?from&to: the Shipper's own income for a period (issue #395). Read only, behind the client session guard. */
@AllowLockedDriver()
@UseGuards(SessionAuthGuard)
@Controller('driver/income')
export class DriverIncomeController {
  constructor(private readonly income: DriverIncomeService) {}

  @Get('summary')
  async summary(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    const period = parseIncomePeriod(query);
    rejectBodyAndQuery(request, {});
    return { data: await this.income.summary(this.#principal(request), period) };
  }

  #principal(request: AuthenticatedRequest): AuthPrincipal {
    if (request.auth === undefined) {
      // Unreachable behind the guard; fail closed rather than act without an identity.
      throw new AppError('SESSION_INVALID');
    }
    return request.auth;
  }
}
