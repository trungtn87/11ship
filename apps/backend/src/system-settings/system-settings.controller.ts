import { TimeoutPolicyService } from '../order-timeouts/timeout-policy-service';
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
import { SystemSettingsService } from './system-settings-service';
import { parsePhoneVerificationBody } from './system-settings-validation';

interface AdminRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly socket: { readonly remoteAddress?: string };
  readonly requestId?: string;
}

interface StatusResponse {
  status(code: number): unknown;
}

/**
 * GET / POST /v1/admin/system-settings/phone-verification (SYSTEM only). The SESSION cookie is the only credential, the actor comes from
 * the session, never from the request. Same transport order as every administration write: exact Origin, JSON, ingress quota,
 * strict parser, cookie/CSRF precheck, then the service that re-authorizes under locks. No-store comes from the module.
 */
@Controller('admin/system-settings')
export class SystemSettingsController {
  readonly #origins: ReadonlySet<string>;
  readonly #trustedProxies: ReadonlySet<string>;

  constructor(
    private readonly settings: SystemSettingsService,
    private readonly timeouts: TimeoutPolicyService,
    private readonly limiter: AdminLimiter,
    @Inject(ADMIN_AUTH_CONFIG) config: AdminAuthConfig,
  ) {
    this.#origins = new Set(config.allowedOrigins);
    this.#trustedProxies = new Set(config.trustedProxyIps);
  }

  @Get('phone-verification')
  async read(@Query() query: unknown, @Req() request: AdminRequest) {
    if (typeof query === 'object' && query !== null && Object.keys(query).length > 0) {
      throw new BadRequestException();
    }
    const origin = request.headers.origin;
    if (origin !== undefined && (typeof origin !== 'string' || !this.#origins.has(origin))) {
      throw new AppError('ADMIN_CSRF_INVALID');
    }
    const token = readCookieToken(request.headers.cookie, ADMIN_SESSION_COOKIE);
    return { data: await this.settings.readPhoneVerification(token) };
  }

  // POST (the administration transport carries GET and POST only): an idempotent, version-checked update of the group.
  @Post('phone-verification')
  @HttpCode(200)
  async update(
    @Body() body: unknown,
    @Req() request: AdminRequest,
    @Res({ passthrough: true }) response: StatusResponse,
    @Headers('x-csrf-token') csrf: string | string[] | undefined,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
  ) {
    await this.#ingress(request);
    const input = parsePhoneVerificationBody(body);
    const token = readCookieToken(request.headers.cookie, ADMIN_SESSION_COOKIE);
    const outcome = await this.settings.updatePhoneVerification(token, csrf, input, idempotencyKey, {
      requestId: request.requestId ?? randomUUID(),
    });
    response.status(outcome.status);
    return { data: outcome.payload };
  }

  @Get('order-timeouts')
  async readTimeouts(@Req() request: AdminRequest) {
    const origin=request.headers.origin;
    if(origin!==undefined && (typeof origin!=='string'||!this.#origins.has(origin)))throw new AppError('ADMIN_CSRF_INVALID');
    return {data:await this.timeouts.read(readCookieToken(request.headers.cookie,ADMIN_SESSION_COOKIE))};
  }
  @Post('order-timeouts')
  @HttpCode(200)
  async saveTimeouts(@Body() body:unknown,@Req() request:AdminRequest,@Headers('x-csrf-token') csrf:unknown,@Headers('idempotency-key') key:string|string[]|undefined) {
    await this.#ingress(request);
    const result=await this.timeouts.save(readCookieToken(request.headers.cookie,ADMIN_SESSION_COOKIE),csrf,body,key,request.requestId??randomUUID());
    return {data:result.payload};
  }
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
