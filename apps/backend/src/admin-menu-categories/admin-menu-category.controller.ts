import { randomUUID } from 'node:crypto';
import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ADMIN_AUTH_CONFIG } from '../admin-auth/admin-auth-config.provider';
import { ADMIN_SESSION_COOKIE } from '../admin-auth/admin-auth-constants';
import { isJsonContentType } from '../admin-auth/admin-auth-validation';
import { readCookieToken } from '../admin-auth/admin-cookies';
import { AdminLimiter } from '../admin-auth/admin-limiter';
import { resolveClientIp } from '../admin-auth/client-ip';
import { AppError } from '../common/app-errors';
import { AdminAuthConfig } from '../config/admin-auth-config';
import { AdminMenuCategoryService } from './admin-menu-category-service';
import { parseCategoryId, parseCategoryListQuery, parseCreateBody, parseUpdateBody } from './admin-menu-category-validation';

interface AdminRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly socket: { readonly remoteAddress?: string };
  readonly requestId?: string;
}

interface StatusResponse {
  status(code: number): unknown;
}

/**
 * /v1/admin/menu-categories (M02 dish groups, Administration web). GET lists; POST creates; POST /:category_id changes name, order
 * and status together (the administration transport carries GET and POST only). There is no delete. The SESSION cookie is the only
 * credential; the actor comes from the session. Same order as every administration write: exact Origin, JSON, ingress quota, strict
 * parser, cookie/CSRF precheck, then the service that authorizes again under locks. No-store comes from the module.
 */
@Controller('admin/menu-categories')
export class AdminMenuCategoryController {
  readonly #origins: ReadonlySet<string>;
  readonly #trustedProxies: ReadonlySet<string>;

  constructor(
    private readonly categories: AdminMenuCategoryService,
    private readonly limiter: AdminLimiter,
    @Inject(ADMIN_AUTH_CONFIG) config: AdminAuthConfig,
  ) {
    this.#origins = new Set(config.allowedOrigins);
    this.#trustedProxies = new Set(config.trustedProxyIps);
  }

  @Get()
  async list(@Query() query: unknown, @Req() request: AdminRequest) {
    const origin = request.headers.origin;
    if (origin !== undefined && (typeof origin !== 'string' || !this.#origins.has(origin))) {
      throw new AppError('ADMIN_CSRF_INVALID');
    }
    const parsed = parseCategoryListQuery(query);
    const token = readCookieToken(request.headers.cookie, ADMIN_SESSION_COOKIE);
    return { data: await this.categories.list(token, parsed) };
  }

  @Post()
  @HttpCode(201)
  async create(
    @Body() body: unknown,
    @Req() request: AdminRequest,
    @Res({ passthrough: true }) response: StatusResponse,
    @Headers('x-csrf-token') csrf: string | string[] | undefined,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
  ) {
    await this.#ingress(request);
    const input = parseCreateBody(body);
    const token = readCookieToken(request.headers.cookie, ADMIN_SESSION_COOKIE);
    const outcome = await this.categories.create(token, csrf, input, idempotencyKey, { requestId: request.requestId ?? randomUUID() });
    response.status(outcome.status);
    return { data: outcome.payload };
  }

  @Post(':category_id')
  @HttpCode(200)
  async update(
    @Param('category_id') categoryId: string,
    @Body() body: unknown,
    @Req() request: AdminRequest,
    @Res({ passthrough: true }) response: StatusResponse,
    @Headers('x-csrf-token') csrf: string | string[] | undefined,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
  ) {
    await this.#ingress(request);
    const id = parseCategoryId(categoryId);
    const input = parseUpdateBody(body);
    const token = readCookieToken(request.headers.cookie, ADMIN_SESSION_COOKIE);
    const outcome = await this.categories.update(token, csrf, id, input, idempotencyKey, { requestId: request.requestId ?? randomUUID() });
    response.status(outcome.status);
    return { data: outcome.payload };
  }

  /** Transport, then the ingress quota (its own short transaction, committed, never given back). */
  async #ingress(request: AdminRequest): Promise<void> {
    const origin = request.headers.origin;
    if (typeof origin !== 'string' || !this.#origins.has(origin)) {
      throw new AppError('ADMIN_CSRF_INVALID');
    }
    if (!isJsonContentType(request.headers['content-type'])) {
      throw new BadRequestException();
    }
    await this.limiter.reserveTotpRequest(
      resolveClientIp(request.socket.remoteAddress, request.headers['x-forwarded-for'], this.#trustedProxies),
    );
  }
}
