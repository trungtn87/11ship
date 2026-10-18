import { Controller, Get, Inject, Query, Req } from '@nestjs/common';
import { ADMIN_AUTH_CONFIG } from '../admin-auth/admin-auth-config.provider';
import { AdminLimiter } from '../admin-auth/admin-limiter';
import { AdminRequest, AdminTransport } from '../admin-shippers/admin-shipper.controller';
import { AdminAuthConfig } from '../config/admin-auth-config';
import { AdminOverviewService } from './admin-overview-service';
import { parseOverviewQuery } from './admin-overview-validation';

/**
 * GET /v1/admin/overview (M12-A). Read-only; the SESSION cookie is the only credential and what each figure shows is decided by the actor's CURRENT rights
 * under the module's locks (see AdminOverviewService). There is no write route here: the overview never changes anything.
 */
@Controller('admin/overview')
export class AdminOverviewController {
  readonly #transport: AdminTransport;

  constructor(
    private readonly overview: AdminOverviewService,
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
}
