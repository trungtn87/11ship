import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, AuthPrincipal } from '../auth/auth-principal';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { AppError } from '../common/app-errors';
import { rejectBodyAndQuery } from './customer-profile-validation';
import { DriverMeService } from './driver-me-service';

/**
 * HTTP adapter of the own driver profile read (M01.05): GET /v1/driver/me. The only route of this controller. The caller is
 * the authenticated principal; there is no driver id, user id, query or body to select anything else.
 */
@Controller('driver/me')
@UseGuards(SessionAuthGuard)
export class DriverMeController {
  constructor(private readonly driver: DriverMeService) {}

  /** The caller's own driver profile, or { data: null } when there is none. */
  @Get()
  async read(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    rejectBodyAndQuery(request, query);
    return { data: await this.driver.read(this.#principal(request)) };
  }

  #principal(request: AuthenticatedRequest): AuthPrincipal {
    if (request.auth === undefined) {
      // Unreachable behind the guard; fail closed rather than act without an identity.
      throw new AppError('SESSION_INVALID');
    }
    return request.auth;
  }
}
