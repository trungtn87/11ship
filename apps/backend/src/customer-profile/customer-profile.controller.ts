import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Headers, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, AuthPrincipal } from '../auth/auth-principal';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { AppError } from '../common/app-errors';
import { CustomerProfileService } from './customer-profile-service';
import { parseCustomerProfileUpdateBody, rejectBodyAndQuery, rejectQuery } from './customer-profile-validation';

/**
 * HTTP adapter of the own customer profile (M01.05): GET and PUT /v1/customer/me/profile. It parses strictly, calls one
 * service and wraps the result in { data }. The caller is the authenticated principal only: no path parameter, no query and
 * no body field names a user. Transport headers (Cache-Control: no-store ...) come from clientAuthTransportMiddleware,
 * installed in front of the body parser by configureApp. No business rule lives here and nothing here logs a body.
 */
@Controller('customer/me/profile')
@UseGuards(SessionAuthGuard)
export class CustomerProfileController {
  constructor(private readonly profiles: CustomerProfileService) {}

  /** The caller's own profile, or { data: null } for a customer that has no profile row. No body, no query. */
  @Get()
  async read(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    rejectBodyAndQuery(request, query);
    return { data: await this.profiles.read(this.#principal(request)) };
  }

  @Put()
  async update(
    @Body() body: unknown,
    @Query() query: unknown,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    rejectQuery(query);
    const input = parseCustomerProfileUpdateBody(body);
    const data = await this.profiles.update(this.#principal(request), input, idempotencyKey, request.requestId ?? randomUUID());
    return { data };
  }

  #principal(request: AuthenticatedRequest): AuthPrincipal {
    if (request.auth === undefined) {
      // Unreachable behind the guard; fail closed rather than act without an identity.
      throw new AppError('SESSION_INVALID');
    }
    return request.auth;
  }
}
