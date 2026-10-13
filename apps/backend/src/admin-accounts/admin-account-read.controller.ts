import { Controller, Get, Inject, Param, Query, Req } from '@nestjs/common';
import { ADMIN_AUTH_CONFIG } from '../admin-auth/admin-auth-config.provider';
import { ADMIN_SESSION_COOKIE } from '../admin-auth/admin-auth-constants';
import { readCookieToken } from '../admin-auth/admin-cookies';
import { AppError } from '../common/app-errors';
import { AdminAuthConfig } from '../config/admin-auth-config';
import { AdminAccountReadService } from './admin-account-read-service';
import { parseAdministratorListQuery, parseNoQuery, parseUserId, parseUserListQuery } from './admin-account-read-validation';

interface AdminRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

/** Same-origin GETs may carry no Origin header; one that is present must be an allowed origin. No CSRF on a read. */
class ReadTransport {
  readonly #origins: ReadonlySet<string>;

  constructor(config: AdminAuthConfig) {
    this.#origins = new Set(config.allowedOrigins);
  }

  /** Returns the SESSION cookie token (the PREAUTH cookie and Bearer tokens are never read here). */
  session(request: AdminRequest): string | undefined {
    const origin = request.headers.origin;
    if (origin !== undefined && (typeof origin !== 'string' || !this.#origins.has(origin))) {
      throw new AppError('ADMIN_CSRF_INVALID');
    }
    return readCookieToken(request.headers.cookie, ADMIN_SESSION_COOKIE);
  }
}

/**
 * Read-only account endpoints for the administration web under /v1/admin (M01-ADMIN account read). GET only: there is
 * no mutation here and none may be added without the lock policy (D15). No-store headers come from the module.
 */
@Controller('admin')
export class AdminAccountReadController {
  readonly #transport: ReadTransport;

  constructor(
    private readonly accounts: AdminAccountReadService,
    @Inject(ADMIN_AUTH_CONFIG) config: AdminAuthConfig,
  ) {
    this.#transport = new ReadTransport(config);
  }

  @Get('users')
  async listUsers(@Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.session(request);
    return { data: await this.accounts.listUsers(token, parseUserListQuery(query)) };
  }

  @Get('users/:user_id')
  async userDetail(@Param('user_id') userId: string, @Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.session(request);
    parseNoQuery(query);
    return { data: await this.accounts.userDetail(token, parseUserId(userId)) };
  }

  @Get('administrators')
  async listAdministrators(@Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.session(request);
    return { data: await this.accounts.listAdministrators(token, parseAdministratorListQuery(query)) };
  }
}

/** GET /v1/admin-auth/permissions: what the signed-in administrator may see, to build the menu. Guidance for the UI only. */
@Controller('admin-auth')
export class AdminPermissionsController {
  readonly #transport: ReadTransport;

  constructor(
    private readonly accounts: AdminAccountReadService,
    @Inject(ADMIN_AUTH_CONFIG) config: AdminAuthConfig,
  ) {
    this.#transport = new ReadTransport(config);
  }

  @Get('permissions')
  async permissions(@Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.session(request);
    parseNoQuery(query);
    return { data: await this.accounts.permissions(token) };
  }
}
