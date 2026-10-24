import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ADMIN_AUTH_CONFIG } from '../admin-auth/admin-auth-config.provider';
import { AdminLimiter } from '../admin-auth/admin-limiter';
import { AdminRequest, AdminTransport, Csrf, StatusResponse } from '../admin-shippers/admin-shipper.controller';
import { AdminAuthConfig } from '../config/admin-auth-config';
import { AdminShopService } from './admin-shop-service';
import { parseNoQuery, parseShopHistoryQuery, parseShopId, parseShopListQuery, parseShopMenuQuery, parseStatusChangeBody } from './admin-shop-validation';

/**
 * /v1/admin/shops (M02 "Quản lý quán", Administration web): GET list, GET detail, GET menu / history / preview of one shop, and POST disable / enable.
 * The SESSION cookie is the only credential; the actor comes from the session and the target from the path, never from a body. Same order as every
 * administration write: transport, quota, strict parser, cookie/CSRF precheck, then the service authorizes again under locks. There is no route that
 * edits a profile, a schedule, a price or a dish, and none that creates or deletes a shop: the owner does that in 11Food. No-store comes from the module.
 */
@Controller('admin/shops')
export class AdminShopController {
  readonly #transport: AdminTransport;

  constructor(
    private readonly shops: AdminShopService,
    limiter: AdminLimiter,
    @Inject(ADMIN_AUTH_CONFIG) config: AdminAuthConfig,
  ) {
    this.#transport = new AdminTransport(limiter, config);
  }

  @Get()
  async list(@Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    return { data: await this.shops.list(token, parseShopListQuery(query)) };
  }

  @Get(':shop_id')
  async detail(@Param('shop_id') id: string, @Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    parseNoQuery(query);
    return { data: await this.shops.detail(token, parseShopId(id)) };
  }

  @Get(':shop_id/menu')
  async menu(@Param('shop_id') id: string, @Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    return { data: await this.shops.menu(token, parseShopId(id), parseShopMenuQuery(query)) };
  }

  @Get(':shop_id/history')
  async history(@Param('shop_id') id: string, @Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    return { data: await this.shops.history(token, parseShopId(id), parseShopHistoryQuery(query)) };
  }

  @Get(':shop_id/preview')
  async preview(@Param('shop_id') id: string, @Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    parseNoQuery(query);
    return { data: await this.shops.preview(token, parseShopId(id)) };
  }

  @Post(':shop_id/disable')
  @HttpCode(200)
  disable(@Param('shop_id') id: string, @Body() body: unknown, @Req() req: AdminRequest, @Res({ passthrough: true }) res: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    return this.#command('disable', id, body, req, res, csrf, key);
  }

  @Post(':shop_id/enable')
  @HttpCode(200)
  enable(@Param('shop_id') id: string, @Body() body: unknown, @Req() req: AdminRequest, @Res({ passthrough: true }) res: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    return this.#command('enable', id, body, req, res, csrf, key);
  }

  async #command(name: 'disable' | 'enable', id: string, body: unknown, request: AdminRequest, response: StatusResponse, csrf: Csrf, key: Csrf) {
    const token = await this.#transport.write(request);
    const shopId = parseShopId(id);
    const input = parseStatusChangeBody(body);
    const outcome = await this.shops.command(name, token, csrf, shopId, input, key, { requestId: request.requestId ?? randomUUID() });
    response.status(outcome.status);
    return { data: outcome.payload };
  }
}
