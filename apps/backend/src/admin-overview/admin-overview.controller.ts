import { Controller, Get, Inject, Query, Req } from '@nestjs/common';
import { ADMIN_AUTH_CONFIG } from '../admin-auth/admin-auth-config.provider';
import { AdminLimiter } from '../admin-auth/admin-limiter';
import { AdminRequest, AdminTransport } from '../admin-shippers/admin-shipper.controller';
import { AppError } from '../common/app-errors';
import { AdminAuthConfig } from '../config/admin-auth-config';
import { AdminActionQueueService } from './admin-action-queue-service';
import { AdminOperationsMapService } from './admin-operations-map-service';
import { AdminOverviewService } from './admin-overview-service';
import { parseActionQueueQuery, parseOverviewQuery } from './admin-overview-validation';

/**
 * GET /v1/admin/overview (M12-A) and GET /v1/admin/overview/action-queue ("Việc cần xử lý": the files behind the to-do figures). Read-only; the SESSION cookie is
 * the only credential and what each figure or row shows is decided by the actor's CURRENT rights under the module's locks. There is no write route here: the overview
 * and its queue never change anything.
 */
@Controller('admin/overview')
export class AdminOverviewController {
  readonly #transport: AdminTransport;

  constructor(
    private readonly overview: AdminOverviewService,
    private readonly queue: AdminActionQueueService,
    private readonly operationsMap: AdminOperationsMapService,
    limiter: AdminLimiter,
    @Inject(ADMIN_AUTH_CONFIG) config: AdminAuthConfig,
  ) {
    this.#transport = new AdminTransport(limiter, config);
  }

  @Get()
  async read(@Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    return { data: await this.overview.overview(token, parseOverviewQuery(query)) };
  }

  /** Issue #262: the operations map data (zones, shop pins, Online Shipper positions) the rights of the actor allow. */
  @Get('map')
  async map(@Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    if (typeof query !== 'object' || query === null || Object.keys(query).length > 0) {
      throw new AppError('ADMIN_INPUT_INVALID');
    }
    return { data: await this.operationsMap.map(token) };
  }

  @Get('action-queue')
  async actionQueue(@Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    return { data: await this.queue.queue(token, parseActionQueueQuery(query)) };
  }
}
