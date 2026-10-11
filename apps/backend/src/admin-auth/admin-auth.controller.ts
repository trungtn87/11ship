import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { parseAdminLoginBody, parseEmptyBody, isJsonContentType, parseTotpBody } from './admin-auth-validation';
import { AppError } from '../common/app-errors';
import { AdminAuthConfig } from '../config/admin-auth-config';
import {
  ADMIN_PREAUTH_COOKIE,
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TTL_SECONDS,
} from './admin-auth-constants';
import { ADMIN_AUTH_CONFIG } from './admin-auth-config.provider';
import { clearedCookie, preauthCookie, readCookieToken, sessionCookie } from './admin-cookies';
import { resolveClientIp } from './client-ip';
import { AdminLimiter } from './admin-limiter';
import { AdminLoginService } from './admin-login-service';
import { AdminSessionService } from './admin-session-service';
import { AdminTotpService, SessionIssued } from './admin-totp-service';

interface AdminRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly socket: { readonly remoteAddress?: string };
  readonly requestId?: string;
}

interface CookieResponse {
  setHeader(name: string, value: string | string[]): unknown;
}

const iso = (ms: number): string => new Date(ms).toISOString();

/** The no-store headers for everything this controller answers, errors included (see AdminAuthModule.configure). */
export function noStoreMiddleware(_request: unknown, response: CookieResponse, next: () => void): void {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Pragma', 'no-cache');
  next();
}

/**
 * HTTP adapter of the administration authentication, under /v1/admin-auth. It checks the transport rules (exact
 * Origin, JSON content type, CSRF header is passed to the services), parses strictly, calls ONE service and sets or
 * clears the cookies. No token or secret is ever put into a JSON body except the TOTP enrollment secret, and nothing
 * here logs a body, a header or a cookie.
 */
@Controller('admin-auth')
export class AdminAuthController {
  readonly #origins: ReadonlySet<string>;
  readonly #trustedProxies: ReadonlySet<string>;

  constructor(
    private readonly login: AdminLoginService,
    private readonly totp: AdminTotpService,
    private readonly sessions: AdminSessionService,
    private readonly limiter: AdminLimiter,
    @Inject(ADMIN_AUTH_CONFIG) config: AdminAuthConfig,
  ) {
    this.#origins = new Set(config.allowedOrigins);
    this.#trustedProxies = new Set(config.trustedProxyIps);
  }

  @Post('login')
  @HttpCode(200)
  async loginStep(@Body() body: unknown, @Req() request: AdminRequest, @Res({ passthrough: true }) response: CookieResponse) {
    this.#assertPostTransport(request);
    const ip = this.#clientIp(request);
    const input = parseAdminLoginBody(body);
    const issued = await this.login.login(input, { ip, requestId: requestIdOf(request) });
    response.setHeader('Set-Cookie', preauthCookie(issued.preauthToken));
    return { data: { next_step: issued.nextStep, expires_at: iso(issued.expiresAtMs), csrf_token: issued.csrfToken } };
  }

  @Get('state')
  async state(@Req() request: AdminRequest) {
    const state = await this.sessions.state(
      readCookieToken(request.headers.cookie, ADMIN_SESSION_COOKIE),
      readCookieToken(request.headers.cookie, ADMIN_PREAUTH_COOKIE),
    );
    return {
      data: {
        state: state.state,
        next_step: state.nextStep,
        expires_at: iso(state.expiresAtMs),
        csrf_token: state.csrfToken,
      },
    };
  }

  @Post('totp/enrollment')
  @HttpCode(200)
  async startEnrollment(
    @Body() body: unknown,
    @Req() request: AdminRequest,
    @Headers('x-csrf-token') csrf: string | string[] | undefined,
  ) {
    this.#assertPostTransport(request);
    await this.limiter.reserveTotpRequest(this.#clientIp(request));
    parseEmptyBody(body);
    const started = await this.totp.startEnrollment(
      readCookieToken(request.headers.cookie, ADMIN_PREAUTH_COOKIE),
      csrf,
    );
    return { data: { secret: started.secret, otpauth_uri: started.otpauthUri, expires_at: iso(started.expiresAtMs) } };
  }

  @Post('totp/enrollment/verify')
  @HttpCode(200)
  async completeEnrollment(
    @Body() body: unknown,
    @Req() request: AdminRequest,
    @Res({ passthrough: true }) response: CookieResponse,
    @Headers('x-csrf-token') csrf: string | string[] | undefined,
  ) {
    this.#assertPostTransport(request);
    await this.limiter.reserveTotpRequest(this.#clientIp(request));
    const code = parseTotpBody(body);
    const issued = await this.totp.completeEnrollment(
      readCookieToken(request.headers.cookie, ADMIN_PREAUTH_COOKIE),
      csrf,
      code,
      { requestId: requestIdOf(request) },
    );
    return this.#sessionResponse(response, issued);
  }

  @Post('totp/verify')
  @HttpCode(200)
  async verify(
    @Body() body: unknown,
    @Req() request: AdminRequest,
    @Res({ passthrough: true }) response: CookieResponse,
    @Headers('x-csrf-token') csrf: string | string[] | undefined,
  ) {
    this.#assertPostTransport(request);
    await this.limiter.reserveTotpRequest(this.#clientIp(request));
    const code = parseTotpBody(body);
    const issued = await this.totp.verifyLogin(
      readCookieToken(request.headers.cookie, ADMIN_PREAUTH_COOKIE),
      csrf,
      code,
      { requestId: requestIdOf(request) },
    );
    return this.#sessionResponse(response, issued);
  }

  @Get('me')
  async me(@Req() request: AdminRequest) {
    const me = await this.sessions.me(readCookieToken(request.headers.cookie, ADMIN_SESSION_COOKIE));
    return {
      data: { user_id: me.userId, admin_role: me.adminRole, expires_at: iso(me.expiresAtMs), csrf_token: me.csrfToken },
    };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Body() body: unknown,
    @Req() request: AdminRequest,
    @Res({ passthrough: true }) response: CookieResponse,
    @Headers('x-csrf-token') csrf: string | string[] | undefined,
  ): Promise<void> {
    this.#assertPostTransport(request);
    parseEmptyBody(body);
    await this.sessions.logout(readCookieToken(request.headers.cookie, ADMIN_SESSION_COOKIE), csrf, {
      requestId: requestIdOf(request),
    });
    response.setHeader('Set-Cookie', [clearedCookie(ADMIN_SESSION_COOKIE), clearedCookie(ADMIN_PREAUTH_COOKIE)]);
  }

  #sessionResponse(response: CookieResponse, issued: SessionIssued) {
    response.setHeader('Set-Cookie', [
      sessionCookie(issued.sessionToken, ADMIN_SESSION_TTL_SECONDS),
      clearedCookie(ADMIN_PREAUTH_COOKIE),
    ]);
    return {
      data: {
        user_id: issued.userId,
        admin_role: issued.adminRole,
        expires_at: iso(issued.expiresAtMs),
        csrf_token: issued.csrfToken,
      },
    };
  }

  /** Every administration POST: the Origin must be exactly one of the configured origins, and the body must be JSON. */
  #assertPostTransport(request: AdminRequest): void {
    const origin = request.headers.origin;
    if (typeof origin !== 'string' || !this.#origins.has(origin)) {
      throw new AppError('ADMIN_CSRF_INVALID');
    }
    if (!isJsonContentType(request.headers['content-type'])) {
      throw new BadRequestException();
    }
  }

  #clientIp(request: AdminRequest): string {
    return resolveClientIp(request.socket.remoteAddress, request.headers['x-forwarded-for'], this.#trustedProxies);
  }
}

function requestIdOf(request: { requestId?: string }): string {
  return request.requestId ?? randomUUID();
}
