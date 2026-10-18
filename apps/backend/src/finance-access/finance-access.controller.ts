import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ADMIN_AUTH_CONFIG } from '../admin-auth/admin-auth-config.provider';
import { AdminLimiter } from '../admin-auth/admin-limiter';
import { AdminAuthConfig } from '../config/admin-auth-config';
import { AdminRequest, AdminTransport, Csrf, StatusResponse } from '../admin-shippers/admin-shipper.controller';
import { FinanceAccessService, GrantCommand } from './finance-access-service';
import { parseBankAccountBody, parseFinanceId, parseGrantBody, parseNoFinanceQuery } from './finance-access-validation';
import { SystemBankAccountService } from './system-bank-account-service';

/**
 * /v1/admin/finance (M04-B2.2a, Administration web). The SESSION cookie is the only credential (Origin, quota, CSRF as every administration
 * write); the actor comes from the session and the target from the path, never from a body. Reading the caller's own rights is open to any live
 * administration session; everything else is SYSTEM only and is checked again under the actor's locks in the service. There is no route that
 * switches a receiving account on, changes it or deletes it, and none that moves money. No-store comes from the module.
 */
@Controller('admin/finance')
export class FinanceAccessController {
  readonly #transport: AdminTransport;

  constructor(
    private readonly access: FinanceAccessService,
    private readonly bankAccounts: SystemBankAccountService,
    limiter: AdminLimiter,
    @Inject(ADMIN_AUTH_CONFIG) config: AdminAuthConfig,
  ) {
    this.#transport = new AdminTransport(limiter, config);
  }

  @Get('access/me')
  async mine(@Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    parseNoFinanceQuery(query);
    return { data: await this.access.mine(token) };
  }

  @Get('access/admins/:user_id')
  async ofAdmin(@Param('user_id') userId: string, @Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    parseNoFinanceQuery(query);
    return { data: await this.access.ofAdmin(token, parseFinanceId(userId)) };
  }

  @Post('access/admins/:user_id/grant')
  @HttpCode(200)
  grant(@Param('user_id') userId: string, @Body() body: unknown, @Req() req: AdminRequest, @Res({ passthrough: true }) res: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    return this.#change('grant', userId, body, req, res, csrf, key);
  }

  @Post('access/admins/:user_id/revoke')
  @HttpCode(200)
  revoke(@Param('user_id') userId: string, @Body() body: unknown, @Req() req: AdminRequest, @Res({ passthrough: true }) res: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    return this.#change('revoke', userId, body, req, res, csrf, key);
  }

  @Get('bank-accounts')
  async listAccounts(@Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    parseNoFinanceQuery(query);
    return { data: await this.bankAccounts.list(token) };
  }

  @Get('bank-accounts/:account_id')
  async account(@Param('account_id') accountId: string, @Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    parseNoFinanceQuery(query);
    return { data: await this.bankAccounts.detail(token, parseFinanceId(accountId)) };
  }

  @Post('bank-accounts')
  @HttpCode(200)
  async createAccount(@Body() body: unknown, @Req() request: AdminRequest, @Res({ passthrough: true }) response: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    const token = await this.#transport.write(request);
    const input = parseBankAccountBody(body);
    const outcome = await this.bankAccounts.create(token, csrf, input, key, { requestId: request.requestId ?? randomUUID() });
    response.status(outcome.status);
    return { data: outcome.payload };
  }

  async #change(command: GrantCommand, userId: string, body: unknown, request: AdminRequest, response: StatusResponse, csrf: Csrf, key: Csrf) {
    const token = await this.#transport.write(request);
    const target = parseFinanceId(userId);
    const input = parseGrantBody(body);
    const outcome = await this.access.change(command, token, csrf, target, input, key, { requestId: request.requestId ?? randomUUID() });
    response.status(outcome.status);
    return { data: outcome.payload };
  }
}
