import { randomUUID } from 'node:crypto';
import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, AuthPrincipal } from '../auth/auth-principal';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { AppError } from '../common/app-errors';
import { CustomersService } from './customers-service';
import { parseAddressCreateBody, parseAddressId, parseAddressUpdateBody, rejectBodyAndQuery, rejectQuery } from './customers-validation';

type Key = string | string[] | undefined;
type StatusSetter = { status(code: number): unknown };

/**
 * HTTP adapter of M05: GET /v1/customers/me and the address book under /v1/customers/me/addresses. It parses strictly, calls one
 * service and wraps the result in { data }. The caller is the authenticated principal only: no path parameter, query or body
 * field names a user or a customer (the only path parameter is an address id, which the service scopes to the caller's own
 * customer). Transport headers (Cache-Control: no-store ...) come from clientAuthTransportMiddleware, installed in front of the body
 * parser by configureApp. No business rule lives here and nothing here logs a body.
 */
@Controller('customers/me')
@UseGuards(SessionAuthGuard)
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  async me(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    rejectBodyAndQuery(request, query);
    return { data: await this.customers.readCustomer(this.#principal(request), requestIdOf(request)) };
  }

  @Get('addresses')
  async list(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    rejectBodyAndQuery(request, query);
    return { data: await this.customers.listAddresses(this.#principal(request)) };
  }

  @Post('addresses')
  async create(
    @Body() body: unknown,
    @Query() query: unknown,
    @Headers('idempotency-key') key: Key,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: StatusSetter,
  ) {
    rejectQuery(query);
    const input = parseAddressCreateBody(body);
    const outcome = await this.customers.createAddress(this.#principal(request), input, key, requestIdOf(request));
    response.status(outcome.status);
    return { data: outcome.payload };
  }

  @Patch('addresses/:addressId')
  async update(
    @Param('addressId') addressId: string,
    @Body() body: unknown,
    @Query() query: unknown,
    @Headers('idempotency-key') key: Key,
    @Req() request: AuthenticatedRequest,
  ) {
    rejectQuery(query);
    const id = parseAddressId(addressId);
    const input = parseAddressUpdateBody(body);
    const outcome = await this.customers.updateAddress(this.#principal(request), id, input, key, requestIdOf(request));
    return { data: outcome.payload };
  }

  @Delete('addresses/:addressId')
  @HttpCode(200)
  async remove(
    @Param('addressId') addressId: string,
    @Query() query: unknown,
    @Headers('idempotency-key') key: Key,
    @Req() request: AuthenticatedRequest,
  ) {
    rejectBodyAndQuery(request, query);
    const id = parseAddressId(addressId);
    const outcome = await this.customers.deleteAddress(this.#principal(request), id, key, requestIdOf(request));
    return { data: outcome.payload };
  }

  @Put('addresses/:addressId/default')
  async setDefault(
    @Param('addressId') addressId: string,
    @Query() query: unknown,
    @Headers('idempotency-key') key: Key,
    @Req() request: AuthenticatedRequest,
  ) {
    rejectBodyAndQuery(request, query);
    const id = parseAddressId(addressId);
    const outcome = await this.customers.setDefaultAddress(this.#principal(request), id, key, requestIdOf(request));
    return { data: outcome.payload };
  }

  #principal(request: AuthenticatedRequest): AuthPrincipal {
    if (request.auth === undefined) {
      // Unreachable behind the guard; fail closed rather than act without an identity.
      throw new AppError('SESSION_INVALID');
    }
    return request.auth;
  }
}

function requestIdOf(request: { requestId?: string }): string {
  return request.requestId ?? randomUUID();
}
