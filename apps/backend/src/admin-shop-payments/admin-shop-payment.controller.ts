import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ADMIN_AUTH_CONFIG } from '../admin-auth/admin-auth-config.provider';
import { AdminLimiter } from '../admin-auth/admin-limiter';
import { AdminRequest, AdminTransport, Csrf, StatusResponse } from '../admin-shippers/admin-shipper.controller';
import { AppError } from '../common/app-errors';
import { AdminAuthConfig } from '../config/admin-auth-config';
import { AdminShopPaymentService } from './admin-shop-payment-service';
import { parseAdminId, parseAdminPaymentListQuery, parseConfirmInput, parseEntitlementInput, parseRejectInput } from './admin-shop-payment-validation';
import { parseNoFinanceQuery } from '../finance-access/finance-access-validation';

/**
 * /v1/admin/shop-payments (#198, Administration web): the reconciliation queue of the payments shops report, the detail, the two money commands (confirm = money
 * RECEIVED, reject) and, as SEPARATE commands under their own right, granting / revoking the manual dish right of a shop. The SESSION cookie is the only credential
 * (Origin, quota, CSRF as every administration write); the actor comes from the session and the target from the path, never from a body. Every right is asked
 * again under the locks in the service. No-store comes from the module.
 */
@Controller('admin/shop-payments')
export class AdminShopPaymentController {
  readonly #transport: AdminTransport;

  constructor(
    private readonly payments: AdminShopPaymentService,
    limiter: AdminLimiter,
    @Inject(ADMIN_AUTH_CONFIG) config: AdminAuthConfig,
  ) {
    this.#transport = new AdminTransport(limiter, config);
  }

  @Get()
  async list(@Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    return { data: await this.payments.list(token, parseAdminPaymentListQuery(query)) };
  }

  // Declared before ':request_id' so that the literal path is never read as an id.
  @Get('receiving-accounts')
  async receivingAccounts(@Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    parseNoFinanceQuery(query);
    return { data: await this.payments.receivingAccounts(token) };
  }

  @Get('shops/:shop_id/entitlements')
  async entitlements(@Param('shop_id') shopId: string, @Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    parseNoFinanceQuery(query);
    return { data: await this.payments.entitlements(token, parseAdminId(shopId)) };
  }

  @Post('shops/:shop_id/menu-expanded/:change')
  @HttpCode(200)
  async entitlementChange(
    @Param('shop_id') shopId: string,
    @Param('change') change: string,
    @Body() body: unknown,
    @Req() req: AdminRequest,
    @Res({ passthrough: true }) res: StatusResponse,
    @Headers('x-csrf-token') csrf: Csrf,
    @Headers('idempotency-key') key: Csrf,
  ) {
    const token = await this.#transport.write(req);
    const target = parseAdminId(shopId);
    const meta = { requestId: req.requestId ?? randomUUID() };
    const outcome =
      change === 'grant'
        ? await this.payments.grant(token, csrf, target, parseEntitlementInput(body, true), key, meta)
        : change === 'revoke'
          ? await this.payments.revoke(token, csrf, target, parseEntitlementInput(body, false), key, meta)
          : undefined;
    if (outcome === undefined) {
      throw new AppError('ADMIN_INPUT_INVALID');
    }
    res.status(outcome.status);
    return { data: outcome.payload };
  }

  @Get(':request_id')
  async detail(@Param('request_id') requestId: string, @Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    parseNoFinanceQuery(query);
    return { data: await this.payments.detail(token, parseAdminId(requestId)) };
  }

  @Post(':request_id/confirm')
  @HttpCode(200)
  async confirm(@Param('request_id') requestId: string, @Body() body: unknown, @Req() req: AdminRequest, @Res({ passthrough: true }) res: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    const token = await this.#transport.write(req);
    const target = parseAdminId(requestId);
    const outcome = await this.payments.confirm(token, csrf, target, parseConfirmInput(body), key, { requestId: req.requestId ?? randomUUID() });
    res.status(outcome.status);
    return { data: outcome.payload };
  }

  @Post(':request_id/reject')
  @HttpCode(200)
  async reject(@Param('request_id') requestId: string, @Body() body: unknown, @Req() req: AdminRequest, @Res({ passthrough: true }) res: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    const token = await this.#transport.write(req);
    const target = parseAdminId(requestId);
    const outcome = await this.payments.reject(token, csrf, target, parseRejectInput(body), key, { requestId: req.requestId ?? randomUUID() });
    res.status(outcome.status);
    return { data: outcome.payload };
  }
}
