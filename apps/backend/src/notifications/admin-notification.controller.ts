import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { ADMIN_AUTH_CONFIG } from '../admin-auth/admin-auth-config.provider';
import { AdminLimiter } from '../admin-auth/admin-limiter';
import { AdminRequest, AdminTransport, Csrf, StatusResponse } from '../admin-shippers/admin-shipper.controller';
import { AdminAuthConfig } from '../config/admin-auth-config';
import { AdminNotificationService } from './admin-notification-service';
import { parseAdminNotificationId, parseAdminSearchQuery, parseConfigBody, parseNoQuery } from './admin-notification-validation';

/**
 * /v1/admin/notifications (M08.06, Administration web): GET the work queue, GET the search, GET one notification with its push attempts, GET and POST the
 * settings (SYSTEM writes). The SESSION cookie is the only credential; the actor comes from the session. There is NO route that sends, resends or
 * broadcasts, and none that edits a notification. No-store comes from the module.
 */
@Controller('admin/notifications')
export class AdminNotificationController {
  readonly #transport: AdminTransport;

  constructor(
    private readonly notifications: AdminNotificationService,
    limiter: AdminLimiter,
    @Inject(ADMIN_AUTH_CONFIG) config: AdminAuthConfig,
  ) {
    this.#transport = new AdminTransport(limiter, config);
  }

  @Get('work-queue')
  async workQueue(@Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    parseNoQuery(query);
    return { data: await this.notifications.workQueue(token) };
  }

  @Get('config')
  async config(@Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    parseNoQuery(query);
    return { data: await this.notifications.config(token) };
  }

  @Post('config')
  @HttpCode(200)
  async updateConfig(@Body() body: unknown, @Req() request: AdminRequest, @Res({ passthrough: true }) response: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    const token = await this.#transport.write(request);
    const input = parseConfigBody(body);
    const outcome = await this.notifications.updateConfig(token, csrf, input, key, { requestId: request.requestId ?? randomUUID() });
    response.status(outcome.status);
    return { data: outcome.payload };
  }

  @Get()
  async search(@Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    return { data: await this.notifications.search(token, parseAdminSearchQuery(query)) };
  }

  @Get(':notification_id')
  async detail(@Param('notification_id') id: string, @Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    parseNoQuery(query);
    return { data: await this.notifications.detail(token, parseAdminNotificationId(id)) };
  }
}
