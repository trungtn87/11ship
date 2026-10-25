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
import { OtpPolicyService } from './otp-policy-service';
import { parseOtpPolicyBody } from './otp-policy-validation';

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
 * GET / POST /v1/admin/system-settings/otp-policy (issue #117): the six SMS OTP limits. SYSTEM changes, any ADMIN reads. The SESSION
 * cookie is the only credential. Same transport order as every administration write: exact Origin, JSON, ingress quota, strict parser,
 * cookie/CSRF precheck, then the service authorizes again under locks. No-store comes from the module.
 */
@Controller('admin/system-settings/otp-policy')
export class OtpPolicyController {
  readonly #origins: ReadonlySet<string>;
  readonly #trustedProxies: ReadonlySet<string>;

  constructor(
    private readonly policy: OtpPolicyService,
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
  async update(
    @Body() body: unknown,
    @Req() request: AdminRequest,
    @Res({ passthrough: true }) response: StatusResponse,
    @Headers('x-csrf-token') csrf: Header,
    @Headers('idempotency-key') key: Header,
  ) {
    const origin = request.headers.origin;
    if (typeof origin !== 'string' || !this.#origins.has(origin)) {
      throw new AppError('ADMIN_CSRF_INVALID');
    }
    if (!isJsonContentType(request.headers['content-type'])) {
      throw new BadRequestException();
    }
    await this.limiter.reserveTotpRequest(resolveClientIp(request.socket.remoteAddress, request.headers['x-forwarded-for'], this.#trustedProxies));
    const input = parseOtpPolicyBody(body);
    const outcome = await this.policy.update(readCookieToken(request.headers.cookie, ADMIN_SESSION_COOKIE), csrf, input, key, { requestId: request.requestId ?? randomUUID() });
    response.status(outcome.status);
    return { data: outcome.payload };
  }
}
