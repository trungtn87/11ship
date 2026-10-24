import { Controller, Get, Inject, Query, Req } from '@nestjs/common';
import { ADMIN_AUTH_CONFIG } from '../admin-auth/admin-auth-config.provider';
import { AdminLimiter } from '../admin-auth/admin-limiter';
import { AdminRequest, AdminTransport } from '../admin-shippers/admin-shipper.controller';
import { AppError } from '../common/app-errors';
import { AdminAuthConfig } from '../config/admin-auth-config';
import { AdminConfigService } from './admin-config-service';
import { CONFIG_GROUP_KEYS, ConfigGroupKey } from './admin-config-repository';

/**
 * GET /v1/admin/config/groups and /v1/admin/config/history (M12-D). Read-only: the values are edited only through the owners' own commands. Any live administration
 * session may read (Owner decision 2026-10-17); the SESSION cookie is the only credential.
 */
@Controller('admin/config')
export class AdminConfigController {
  readonly #transport: AdminTransport;

  constructor(
    private readonly config: AdminConfigService,
    limiter: AdminLimiter,
    @Inject(ADMIN_AUTH_CONFIG) adminConfig: AdminAuthConfig,
  ) {
    this.#transport = new AdminTransport(limiter, adminConfig);
  }

  @Get('groups')
  async groups(@Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    if (typeof query !== 'object' || query === null || Object.keys(query).length > 0) {
      throw new AppError('ADMIN_INPUT_INVALID');
    }
    return { data: await this.config.groups(token) };
  }

  @Get('history')
  async history(@Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    const source = typeof query === 'object' && query !== null && !Array.isArray(query) ? (query as Record<string, unknown>) : undefined;
    if (source === undefined || Object.keys(source).some((key) => key !== 'group' && key !== 'limit')) {
      throw new AppError('ADMIN_INPUT_INVALID');
    }
    const group = source.group;
    if (group !== undefined && (typeof group !== 'string' || !(CONFIG_GROUP_KEYS as readonly string[]).includes(group))) {
      throw new AppError('ADMIN_INPUT_INVALID');
    }
    const rawLimit = source.limit;
    if (rawLimit !== undefined && (typeof rawLimit !== 'string' || !/^[1-9][0-9]{0,2}$/.test(rawLimit) || Number(rawLimit) > 100)) {
      throw new AppError('ADMIN_INPUT_INVALID');
    }
    return { data: await this.config.changeHistory(token, group === undefined ? null : (group as ConfigGroupKey), rawLimit === undefined ? 30 : Number(rawLimit)) };
  }
}
