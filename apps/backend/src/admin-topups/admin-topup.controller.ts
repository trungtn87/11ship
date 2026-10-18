import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ADMIN_AUTH_CONFIG } from '../admin-auth/admin-auth-config.provider';
import { AdminLimiter } from '../admin-auth/admin-limiter';
import { AdminRequest, AdminTransport, Csrf, StatusResponse } from '../admin-shippers/admin-shipper.controller';
import { AdminAuthConfig } from '../config/admin-auth-config';
import { parseFinanceId, parseNoFinanceQuery } from '../finance-access/finance-access-validation';
import { AdminTopupService } from './admin-topup-service';
import { parseAdminTopupListQuery, parseConfirmBody, parseRejectBody } from './admin-topup-validation';

/**
 * /v1/admin/finance/topup-requests (M04-B2.2b, Administration web). The SESSION cookie is the only credential (Origin, quota, CSRF as every
 * administration write); the actor comes from the session and the request from the path, never from a body. Reading needs `wallet.read`, confirming or
 * rejecting `wallet.topup.record` (SYSTEM implicit); both are asked again under the locks in the service. No-store comes from the module.
 */
@Controller('admin/finance/topup-requests')
export class AdminTopupController {
  readonly #transport: AdminTransport;

  constructor(
    private readonly topups: AdminTopupService,
    limiter: AdminLimiter,
    @Inject(ADMIN_AUTH_CONFIG) config: AdminAuthConfig,
  ) {
    this.#transport = new AdminTransport(limiter, config);
  }

  @Get()
  async list(@Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    return { data: await this.topups.list(token, parseAdminTopupListQuery(query)) };
  }

  @Get(':request_id')
  async detail(@Param('request_id') requestId: string, @Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    parseNoFinanceQuery(query);
    return { data: await this.topups.detail(token, parseFinanceId(requestId)) };
  }

  @Post(':request_id/confirm')
  @HttpCode(200)
  async confirm(@Param('request_id') requestId: string, @Body() body: unknown, @Req() req: AdminRequest, @Res({ passthrough: true }) res: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    const token = await this.#transport.write(req);
    const target = parseFinanceId(requestId);
    const input = parseConfirmBody(body);
    const outcome = await this.topups.confirm(token, csrf, target, input, key, { requestId: req.requestId ?? randomUUID() });
    res.status(outcome.status);
    return { data: outcome.payload };
  }

  @Post(':request_id/reject')
  @HttpCode(200)
  async reject(@Param('request_id') requestId: string, @Body() body: unknown, @Req() req: AdminRequest, @Res({ passthrough: true }) res: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    const token = await this.#transport.write(req);
    const target = parseFinanceId(requestId);
    const input = parseRejectBody(body);
    const outcome = await this.topups.reject(token, csrf, target, input, key, { requestId: req.requestId ?? randomUUID() });
    res.status(outcome.status);
    return { data: outcome.payload };
  }
}
