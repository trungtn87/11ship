import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ADMIN_AUTH_CONFIG } from '../admin-auth/admin-auth-config.provider';
import { AdminLimiter } from '../admin-auth/admin-limiter';
import { AdminRequest, AdminTransport } from '../admin-shippers/admin-shipper.controller';
import { AdminAuthConfig } from '../config/admin-auth-config';
import { OpsAnalyticsService } from './ops-analytics-service';
import { OpsAnomalyService } from './ops-anomaly-service';
import { parseActionBody, parseAnalyticsQuery, parseAnomalyListQuery, parseCaseId, parseDrilldownQuery, parseSettingsBody } from './ops-analytics-validation';

interface StatusResponse {
  status(code: number): unknown;
}
type Header = string | string[] | undefined;

/**
 * Issues #241 / #242 of the Mini Business: GET /v1/admin/ops-analytics (the four operations questions, with a drill-down), GET /v1/admin/ops-anomalies (the signals to review),
 * POST .../:id/action (review / check / dismiss / reopen / note) and POST .../settings (SYSTEM). The SESSION cookie is the only credential; every right is decided again by the
 * service under its locks. No route here changes an account, a wallet, an order or the right to take work.
 */
@Controller('admin')
export class OpsAnalyticsController {
  readonly #transport: AdminTransport;

  constructor(
    private readonly analytics: OpsAnalyticsService,
    private readonly anomalies: OpsAnomalyService,
    limiter: AdminLimiter,
    @Inject(ADMIN_AUTH_CONFIG) config: AdminAuthConfig,
  ) {
    this.#transport = new AdminTransport(limiter, config);
  }

  @Get('ops-analytics')
  async read(@Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    return { data: await this.analytics.overview(token, parseAnalyticsQuery(query)) };
  }

  @Get('ops-analytics/drilldown')
  async drilldown(@Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    const q = parseDrilldownQuery(query);
    return { data: await this.analytics.drilldown(token, q.query, q.kind, q.step, q.limit, q.offset) };
  }

  @Get('ops-anomalies')
  async list(@Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    return { data: await this.anomalies.list(token, parseAnomalyListQuery(query)) };
  }

  @Get('ops-anomalies/:id')
  async detail(@Param('id') id: string, @Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    parseAnalyticsLess(query);
    return { data: await this.anomalies.detail(token, parseCaseId(id)) };
  }

  @Post('ops-anomalies/settings')
  @HttpCode(200)
  async settings(@Body() body: unknown, @Req() request: AdminRequest, @Res({ passthrough: true }) response: StatusResponse, @Headers('x-csrf-token') csrf: Header, @Headers('idempotency-key') key: Header) {
    const token = await this.#transport.write(request);
    const outcome = await this.anomalies.updateSettings(token, csrf, parseSettingsBody(body), key, { requestId: request.requestId ?? randomUUID() });
    response.status(outcome.status);
    return { data: outcome.payload };
  }

  @Post('ops-anomalies/:id/action')
  @HttpCode(200)
  async act(@Param('id') id: string, @Body() body: unknown, @Req() request: AdminRequest, @Res({ passthrough: true }) response: StatusResponse, @Headers('x-csrf-token') csrf: Header, @Headers('idempotency-key') key: Header) {
    const token = await this.#transport.write(request);
    const outcome = await this.anomalies.act(token, csrf, parseCaseId(id), parseActionBody(body), key, { requestId: request.requestId ?? randomUUID() });
    response.status(outcome.status);
    return { data: outcome.payload };
  }
}

function parseAnalyticsLess(query: unknown): void {
  if (typeof query !== 'object' || query === null || Object.keys(query).length > 0) {
    parseCaseId('invalid');
  }
}
