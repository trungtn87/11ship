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
import { AdminServiceAreaService } from './admin-service-area-service';
import { parseAreaId, parseCreateAreaBody, parseImpactQuery, parseStatusAreaBody, parseUpdateAreaBody } from './admin-service-area-validation';

interface AdminRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly socket: { readonly remoteAddress?: string };
  readonly requestId?: string;
}

interface StatusResponse {
  status(code: number): unknown;
}

type Header = string | string[] | undefined;

/**
 * /v1/admin/service-areas (issue #253, "Hệ thống -> Vùng hoạt động"): GET list / detail / impact preview (any live ADMIN), POST create / update /
 * status (SYSTEM only, decided by the service under locks). The SESSION cookie is the only credential. Same order as every administration write:
 * exact Origin, JSON, ingress quota, strict parser, cookie/CSRF precheck, then the service authorizes again under locks. No-store comes from the module.
 */
@Controller('admin/service-areas')
export class AdminServiceAreaController {
  readonly #origins: ReadonlySet<string>;
  readonly #trustedProxies: ReadonlySet<string>;

  constructor(
    private readonly areas: AdminServiceAreaService,
    private readonly limiter: AdminLimiter,
    @Inject(ADMIN_AUTH_CONFIG) config: AdminAuthConfig,
  ) {
    this.#origins = new Set(config.allowedOrigins);
    this.#trustedProxies = new Set(config.trustedProxyIps);
  }

  @Get()
  async list(@Query() query: unknown, @Req() request: AdminRequest) {
    this.#readGuard(request);
    if (typeof query !== 'object' || query === null || Object.keys(query).length > 0) throw new AppError('ADMIN_INPUT_INVALID');
    return { data: await this.areas.list(readCookieToken(request.headers.cookie, ADMIN_SESSION_COOKIE)) };
  }

  @Get(':id')
  async detail(@Param('id') id: string, @Query() query: unknown, @Req() request: AdminRequest) {
    this.#readGuard(request);
    if (typeof query !== 'object' || query === null || Object.keys(query).length > 0) throw new AppError('ADMIN_INPUT_INVALID');
    return { data: await this.areas.detail(readCookieToken(request.headers.cookie, ADMIN_SESSION_COOKIE), parseAreaId(id)) };
  }

  @Get(':id/impact')
  async impact(@Param('id') id: string, @Query() query: unknown, @Req() request: AdminRequest) {
    this.#readGuard(request);
    const input = parseImpactQuery(query);
    return { data: await this.areas.impact(readCookieToken(request.headers.cookie, ADMIN_SESSION_COOKIE), parseAreaId(id), input) };
  }

  @Post()
  @HttpCode(201)
  async create(@Body() body: unknown, @Req() request: AdminRequest, @Res({ passthrough: true }) response: StatusResponse, @Headers('x-csrf-token') csrf: Header, @Headers('idempotency-key') key: Header) {
    const token = await this.#ingress(request);
    const outcome = await this.areas.create(token, csrf, parseCreateAreaBody(body), key, { requestId: request.requestId ?? randomUUID() });
    response.status(outcome.status);
    return { data: outcome.payload };
  }

  @Post(':id')
  @HttpCode(200)
  async update(@Param('id') id: string, @Body() body: unknown, @Req() request: AdminRequest, @Res({ passthrough: true }) response: StatusResponse, @Headers('x-csrf-token') csrf: Header, @Headers('idempotency-key') key: Header) {
    const token = await this.#ingress(request);
    const outcome = await this.areas.update(token, csrf, parseAreaId(id), parseUpdateAreaBody(body), key, { requestId: request.requestId ?? randomUUID() });
    response.status(outcome.status);
    return { data: outcome.payload };
  }

  @Post(':id/status')
  @HttpCode(200)
  async status(@Param('id') id: string, @Body() body: unknown, @Req() request: AdminRequest, @Res({ passthrough: true }) response: StatusResponse, @Headers('x-csrf-token') csrf: Header, @Headers('idempotency-key') key: Header) {
    const token = await this.#ingress(request);
    const outcome = await this.areas.setStatus(token, csrf, parseAreaId(id), parseStatusAreaBody(body), key, { requestId: request.requestId ?? randomUUID() });
    response.status(outcome.status);
    return { data: outcome.payload };
  }

  #readGuard(request: AdminRequest): void {
    const origin = request.headers.origin;
    if (origin !== undefined && (typeof origin !== 'string' || !this.#origins.has(origin))) throw new AppError('ADMIN_CSRF_INVALID');
  }

  /** Transport, then the ingress quota (its own short transaction, committed, never given back). Returns the SESSION cookie token. */
  async #ingress(request: AdminRequest): Promise<string | undefined> {
    const origin = request.headers.origin;
    if (typeof origin !== 'string' || !this.#origins.has(origin)) throw new AppError('ADMIN_CSRF_INVALID');
    if (!isJsonContentType(request.headers['content-type'])) throw new BadRequestException();
    await this.limiter.reserveTotpRequest(resolveClientIp(request.socket.remoteAddress, request.headers['x-forwarded-for'], this.#trustedProxies));
    return readCookieToken(request.headers.cookie, ADMIN_SESSION_COOKIE);
  }
}
