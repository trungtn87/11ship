import { randomUUID } from 'node:crypto';
import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Inject, Post, Query, Req, Res } from '@nestjs/common';
import { ADMIN_AUTH_CONFIG } from '../admin-auth/admin-auth-config.provider';
import { ADMIN_SESSION_COOKIE } from '../admin-auth/admin-auth-constants';
import { isJsonContentType } from '../admin-auth/admin-auth-validation';
import { readCookieToken } from '../admin-auth/admin-cookies';
import { AdminLimiter } from '../admin-auth/admin-limiter';
import { resolveClientIp } from '../admin-auth/client-ip';
import { AppError } from '../common/app-errors';
import { AdminAuthConfig } from '../config/admin-auth-config';
import { ShippingFeePolicyService } from './shipping-fee-policy-service';
import { ShippingEligibilityPolicyService } from './shipping-eligibility-policy-service';
import { OrderParametersService } from './order-parameters-service';
import { parseOrderParametersBody } from './order-parameters-validation';
import { parseSaveEligibilityBody } from './shipping-eligibility-policy-validation';
import { parseApplyBody, parsePreviewBody, parseSaveDraftBody } from './shipping-fee-policy-validation';

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
 * /v1/admin/shipping-fee-policy (M06-A, Administration web): GET the state (table in force, draft, version history), POST draft, POST apply,
 * POST preview. SYSTEM changes, any ADMIN reads and previews. The SESSION cookie is the only credential. Same order as every administration
 * write: exact Origin, JSON, ingress quota, strict parser, cookie/CSRF precheck, then the service authorizes again under locks. No-store
 * comes from the module.
 */
@Controller('admin/shipping-fee-policy')
export class ShippingFeePolicyController {
  readonly #origins: ReadonlySet<string>;
  readonly #trustedProxies: ReadonlySet<string>;

  constructor(
    private readonly policy: ShippingFeePolicyService,
    private readonly limiter: AdminLimiter,
    @Inject(ADMIN_AUTH_CONFIG) config: AdminAuthConfig,
  ) {
    this.#origins = new Set(config.allowedOrigins);
    this.#trustedProxies = new Set(config.trustedProxyIps);
  }

  @Get()
  async read(@Query() query: unknown, @Req() request: AdminRequest) {
    const origin = request.headers.origin;
    if (origin !== undefined && (typeof origin !== 'string' || !this.#origins.has(origin))) {
      throw new AppError('ADMIN_CSRF_INVALID');
    }
    if (typeof query !== 'object' || query === null || Object.keys(query).length > 0) {
      throw new AppError('ADMIN_INPUT_INVALID');
    }
    return { data: await this.policy.read(readCookieToken(request.headers.cookie, ADMIN_SESSION_COOKIE)) };
  }

  @Post('draft')
  @HttpCode(200)
  async saveDraft(@Body() body: unknown, @Req() request: AdminRequest, @Res({ passthrough: true }) response: StatusResponse, @Headers('x-csrf-token') csrf: Header, @Headers('idempotency-key') key: Header) {
    const token = await this.#ingress(request);
    const input = parseSaveDraftBody(body);
    const outcome = await this.policy.saveDraft(token, csrf, input, key, { requestId: request.requestId ?? randomUUID() });
    response.status(outcome.status);
    return { data: outcome.payload };
  }

  @Post('apply')
  @HttpCode(200)
  async apply(@Body() body: unknown, @Req() request: AdminRequest, @Res({ passthrough: true }) response: StatusResponse, @Headers('x-csrf-token') csrf: Header, @Headers('idempotency-key') key: Header) {
    const token = await this.#ingress(request);
    const input = parseApplyBody(body);
    const outcome = await this.policy.apply(token, csrf, input, key, { requestId: request.requestId ?? randomUUID() });
    response.status(outcome.status);
    return { data: outcome.payload };
  }

  @Post('preview')
  @HttpCode(200)
  async preview(@Body() body: unknown, @Req() request: AdminRequest, @Headers('x-csrf-token') csrf: Header) {
    const token = await this.#ingress(request);
    return { data: await this.policy.preview(token, csrf, parsePreviewBody(body)) };
  }

  /** Transport, then the ingress quota (its own short transaction, committed, never given back). Returns the SESSION cookie token. */
  async #ingress(request: AdminRequest): Promise<string | undefined> {
    const origin = request.headers.origin;
    if (typeof origin !== 'string' || !this.#origins.has(origin)) {
      throw new AppError('ADMIN_CSRF_INVALID');
    }
    if (!isJsonContentType(request.headers['content-type'])) {
      throw new BadRequestException();
    }
    await this.limiter.reserveTotpRequest(resolveClientIp(request.socket.remoteAddress, request.headers['x-forwarded-for'], this.#trustedProxies));
    return readCookieToken(request.headers.cookie, ADMIN_SESSION_COOKIE);
  }
}

/**
 * /v1/admin/shipping-eligibility-policy (M06-B/C, Administration web): GET the limits and their change history, POST a change (SYSTEM only; any
 * ADMIN reads). Same transport order as the fee-policy routes. No-store comes from the module.
 */
@Controller('admin/shipping-eligibility-policy')
export class ShippingEligibilityPolicyController {
  readonly #origins: ReadonlySet<string>;
  readonly #trustedProxies: ReadonlySet<string>;

  constructor(
    private readonly policy: ShippingEligibilityPolicyService,
    private readonly limiter: AdminLimiter,
    @Inject(ADMIN_AUTH_CONFIG) config: AdminAuthConfig,
  ) {
    this.#origins = new Set(config.allowedOrigins);
    this.#trustedProxies = new Set(config.trustedProxyIps);
  }

  @Get()
  async read(@Query() query: unknown, @Req() request: AdminRequest) {
    const origin = request.headers.origin;
    if (origin !== undefined && (typeof origin !== 'string' || !this.#origins.has(origin))) {
      throw new AppError('ADMIN_CSRF_INVALID');
    }
    if (typeof query !== 'object' || query === null || Object.keys(query).length > 0) {
      throw new AppError('ADMIN_INPUT_INVALID');
    }
    return { data: await this.policy.read(readCookieToken(request.headers.cookie, ADMIN_SESSION_COOKIE)) };
  }

  @Post()
  @HttpCode(200)
  async update(@Body() body: unknown, @Req() request: AdminRequest, @Res({ passthrough: true }) response: StatusResponse, @Headers('x-csrf-token') csrf: Header, @Headers('idempotency-key') key: Header) {
    const origin = request.headers.origin;
    if (typeof origin !== 'string' || !this.#origins.has(origin)) {
      throw new AppError('ADMIN_CSRF_INVALID');
    }
    if (!isJsonContentType(request.headers['content-type'])) {
      throw new BadRequestException();
    }
    await this.limiter.reserveTotpRequest(resolveClientIp(request.socket.remoteAddress, request.headers['x-forwarded-for'], this.#trustedProxies));
    const input = parseSaveEligibilityBody(body);
    const outcome = await this.policy.update(readCookieToken(request.headers.cookie, ADMIN_SESSION_COOKIE), csrf, input, key, { requestId: request.requestId ?? randomUUID() });
    response.status(outcome.status);
    return { data: outcome.payload };
  }
}

/** /v1/admin/system-settings/order-parameters (SYSTEM changes, any ADMIN reads): "Thời gian trả lời đề xuất phí" in minutes. Same transport order as the eligibility policy. */
@Controller('admin/system-settings/order-parameters')
export class OrderParametersController {
  readonly #origins: ReadonlySet<string>;
  readonly #trustedProxies: ReadonlySet<string>;

  constructor(
    private readonly parameters: OrderParametersService,
    private readonly limiter: AdminLimiter,
    @Inject(ADMIN_AUTH_CONFIG) config: AdminAuthConfig,
  ) {
    this.#origins = new Set(config.allowedOrigins);
    this.#trustedProxies = new Set(config.trustedProxyIps);
  }

  @Get()
  async read(@Query() query: unknown, @Req() request: AdminRequest) {
    const origin = request.headers.origin;
    if (origin !== undefined && (typeof origin !== 'string' || !this.#origins.has(origin))) {
      throw new AppError('ADMIN_CSRF_INVALID');
    }
    if (typeof query !== 'object' || query === null || Object.keys(query).length > 0) {
      throw new AppError('ADMIN_INPUT_INVALID');
    }
    return { data: await this.parameters.read(readCookieToken(request.headers.cookie, ADMIN_SESSION_COOKIE)) };
  }

  @Post()
  @HttpCode(200)
  async update(@Body() body: unknown, @Req() request: AdminRequest, @Res({ passthrough: true }) response: StatusResponse, @Headers('x-csrf-token') csrf: Header, @Headers('idempotency-key') key: Header) {
    const origin = request.headers.origin;
    if (typeof origin !== 'string' || !this.#origins.has(origin)) {
      throw new AppError('ADMIN_CSRF_INVALID');
    }
    if (!isJsonContentType(request.headers['content-type'])) {
      throw new BadRequestException();
    }
    await this.limiter.reserveTotpRequest(resolveClientIp(request.socket.remoteAddress, request.headers['x-forwarded-for'], this.#trustedProxies));
    const input = parseOrderParametersBody(body);
    const outcome = await this.parameters.update(readCookieToken(request.headers.cookie, ADMIN_SESSION_COOKIE), csrf, input, key, { requestId: request.requestId ?? randomUUID() });
    response.status(outcome.status);
    return { data: outcome.payload };
  }
}
