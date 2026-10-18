import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ADMIN_AUTH_CONFIG } from '../admin-auth/admin-auth-config.provider';
import { AdminLimiter } from '../admin-auth/admin-limiter';
import { AdminRequest, AdminTransport, Csrf, StatusResponse } from '../admin-shippers/admin-shipper.controller';
import { AdminAuthConfig } from '../config/admin-auth-config';
import { AdminDeliveryService } from './admin-delivery-service';
import { parseAdminAction, parseAdminActionBody, parseAdminDeliveryId, parseAdminListQuery, parseNoQuery } from '../delivery/admin-delivery-validation';

/**
 * /v1/admin/deliveries (M07.07, Administration web): GET list with counters, GET detail and one POST per exception action. The SESSION cookie is the
 * only credential; the actor comes from the session and the target from the path, never from a body. Same order as every administration write:
 * transport, quota, strict parser, cookie/CSRF precheck, then the service authorizes again under locks. There is no route that sets a status, no
 * delete and no "create delivery": a delivery is created by a shop and moved by the shop and the Shipper. No-store comes from the module.
 */
@Controller('admin/deliveries')
export class AdminDeliveryController {
  readonly #transport: AdminTransport;

  constructor(
    private readonly deliveries: AdminDeliveryService,
    limiter: AdminLimiter,
    @Inject(ADMIN_AUTH_CONFIG) config: AdminAuthConfig,
  ) {
    this.#transport = new AdminTransport(limiter, config);
  }

  @Get()
  async list(@Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    return { data: await this.deliveries.list(token, parseAdminListQuery(query)) };
  }

  @Get(':delivery_id')
  async detail(@Param('delivery_id') id: string, @Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    parseNoQuery(query);
    return { data: await this.deliveries.detail(token, parseAdminDeliveryId(id)) };
  }

  @Post(':delivery_id/actions/:action')
  @HttpCode(200)
  async act(
    @Param('delivery_id') id: string,
    @Param('action') action: string,
    @Body() body: unknown,
    @Req() request: AdminRequest,
    @Res({ passthrough: true }) response: StatusResponse,
    @Headers('x-csrf-token') csrf: Csrf,
    @Headers('idempotency-key') key: Csrf,
  ) {
    const token = await this.#transport.write(request);
    const name = parseAdminAction(action);
    const deliveryId = parseAdminDeliveryId(id);
    const input = parseAdminActionBody(name, body);
    const outcome = await this.deliveries.action(name, token, csrf, deliveryId, input, key, { requestId: request.requestId ?? randomUUID() });
    response.status(outcome.status);
    return { data: outcome.payload };
  }
}
