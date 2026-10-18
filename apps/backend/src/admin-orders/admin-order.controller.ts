import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ADMIN_AUTH_CONFIG } from '../admin-auth/admin-auth-config.provider';
import { AdminLimiter } from '../admin-auth/admin-limiter';
import { AdminRequest, AdminTransport, Csrf, StatusResponse } from '../admin-shippers/admin-shipper.controller';
import { AdminAuthConfig } from '../config/admin-auth-config';
import { parseAdminAction, parseAdminListQuery, parseNoQuery, parseOrderId, parseReasonBody } from '../orders/order-validation';
import { AdminOrderService } from './admin-order-service';

/**
 * /v1/admin/orders (M10.05, Administration web): GET list, GET detail and one POST per exception action. The SESSION cookie is the only credential; the actor
 * comes from the session and the target from the path, never from a body. Same order as every administration write: transport, quota, strict parser,
 * cookie/CSRF precheck, then the service authorizes again under locks. There is no route that sets a status, no delete and no "create order": an Order is
 * created by a customer and moved by the customer, the shop and the Shipper.
 */
@Controller('admin/orders')
export class AdminOrderController {
  readonly #transport: AdminTransport;

  constructor(
    private readonly orders: AdminOrderService,
    limiter: AdminLimiter,
    @Inject(ADMIN_AUTH_CONFIG) config: AdminAuthConfig,
  ) {
    this.#transport = new AdminTransport(limiter, config);
  }

  @Get()
  async list(@Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    return { data: await this.orders.list(token, parseAdminListQuery(query)) };
  }

  @Get(':order_id')
  async detail(@Param('order_id') id: string, @Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    parseNoQuery(query);
    return { data: await this.orders.detail(token, parseOrderId(id)) };
  }

  @Post(':order_id/actions/:action')
  @HttpCode(200)
  async act(
    @Param('order_id') id: string,
    @Param('action') action: string,
    @Body() body: unknown,
    @Req() request: AdminRequest,
    @Res({ passthrough: true }) response: StatusResponse,
    @Headers('x-csrf-token') csrf: Csrf,
    @Headers('idempotency-key') key: Csrf,
  ) {
    const token = await this.#transport.write(request);
    const name = parseAdminAction(action);
    const orderId = parseOrderId(id);
    const input = parseReasonBody(body);
    const outcome = await this.orders.action(name, token, csrf, orderId, { expectedVersion: input.expectedVersion, reason: input.reason }, key, { requestId: request.requestId ?? randomUUID() });
    response.status(outcome.status);
    return { data: outcome.payload };
  }
}
