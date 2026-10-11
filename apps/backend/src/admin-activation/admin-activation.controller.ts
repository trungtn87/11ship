import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Headers, Inject, Post, Req, Res } from '@nestjs/common';
import { ADMIN_AUTH_CONFIG } from '../admin-auth/admin-auth-config.provider';
import { readCookieToken } from '../admin-auth/admin-cookies';
import { resolveClientIp } from '../admin-auth/client-ip';
import { AppError } from '../common/app-errors';
import { AdminAuthConfig } from '../config/admin-auth-config';
import { ACTIVATION_COOKIE, ACTIVATION_ROUTE_PREFIX, CSRF_HEADER } from './admin-activation-constants';
import { activationCookie, clearedActivationCookie } from './admin-activation-cookies';
import { AdminActivationLimiter } from './admin-activation-limiter';
import { Answer, AdminActivationService, RequestMeta } from './admin-activation-service';
import {
  declaredBodyTooLarge,
  serializedBodyTooLarge,
  isJsonContentType,
  parseEmptyBody,
  parseOtpCodeBody,
  parsePasswordBody,
  parseStartBody,
  parseTotpCodeBody,
} from './admin-activation-validation';

interface ActivationRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly socket: { readonly remoteAddress?: string };
  readonly requestId?: string;
}

interface ActivationResponse {
  status(code: number): ActivationResponse;
  setHeader(name: string, value: string | string[]): unknown;
  json(body: unknown): unknown;
}

interface MiddlewareRequest {
  headers: Record<string, string | string[] | undefined>;
}

interface MiddlewareResponse {
  setHeader(name: string, value: string): unknown;
  removeHeader(name: string): unknown;
  writeHead: (...args: unknown[]) => unknown;
}

/**
 * Transport rules for EVERY response of /v1/admin-activation/*, errors included (contract section 6.1): never cached, no
 * referrer, no sniffing, no ETag / Last-Modified and never a 304 (the conditional request headers are dropped before the
 * framework can compare them, and a validator is stripped if one is generated anyway). CORS is not enabled anywhere.
 */
export function activationTransportMiddleware(request: MiddlewareRequest, response: MiddlewareResponse, next: () => void): void {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  delete request.headers['if-none-match'];
  delete request.headers['if-modified-since'];
  const writeHead = response.writeHead.bind(response);
  response.writeHead = (...args: unknown[]): unknown => {
    response.removeHeader('ETag');
    response.removeHeader('Last-Modified');
    return writeHead(...args);
  };
  next();
}

/**
 * HTTP adapter of the account activation, under /v1/admin-activation. It enforces the transport rules (exact Origin,
 * JSON content type, 4 KiB), reserves the ingress quota of every POST BEFORE anything is parsed or looked up, parses
 * strictly, calls ONE service method and sets / clears the activation cookie. The invitation token appears only in the
 * body of POST /start; nothing here logs a body, a header or a cookie.
 */
@Controller(ACTIVATION_ROUTE_PREFIX)
export class AdminActivationController {
  readonly #origin: string;
  readonly #trustedProxies: ReadonlySet<string>;

  constructor(
    private readonly activation: AdminActivationService,
    private readonly limiter: AdminActivationLimiter,
    @Inject(ADMIN_AUTH_CONFIG) config: AdminAuthConfig,
  ) {
    this.#origin = config.activationOrigin;
    this.#trustedProxies = new Set(config.trustedProxyIps);
  }

  @Post('start')
  async start(@Body() body: unknown, @Req() request: ActivationRequest, @Res() response: ActivationResponse): Promise<void> {
    await this.#post(request, response, body, async (meta) => {
      const token = parseStartBody(body);
      // The cookie is optional here and an invalid one is ignored, never a 401.
      return this.activation.start(readCookieToken(request.headers.cookie, ACTIVATION_COOKIE), token, meta);
    });
  }

  @Post('restart')
  async restart(
    @Body() body: unknown,
    @Req() request: ActivationRequest,
    @Res() response: ActivationResponse,
    @Headers(CSRF_HEADER) csrf: string | string[] | undefined,
  ): Promise<void> {
    await this.#post(request, response, body, async (meta) => {
      parseEmptyBody(body);
      return this.activation.restart(this.#cookie(request), csrf, meta);
    });
  }

  @Get('state')
  async state(@Req() request: ActivationRequest, @Res() response: ActivationResponse): Promise<void> {
    try {
      response.status(200).json(await this.activation.state(this.#cookie(request)));
    } catch (error) {
      this.#clearOnSessionInvalid(response, error);
      throw error;
    }
  }

  @Post('otp/request')
  async requestOtp(
    @Body() body: unknown,
    @Req() request: ActivationRequest,
    @Res() response: ActivationResponse,
    @Headers(CSRF_HEADER) csrf: string | string[] | undefined,
  ): Promise<void> {
    await this.#post(request, response, body, async (meta) => {
      parseEmptyBody(body);
      return this.activation.requestOtp(this.#cookie(request), csrf, meta);
    });
  }

  @Post('otp/verify')
  async verifyOtp(
    @Body() body: unknown,
    @Req() request: ActivationRequest,
    @Res() response: ActivationResponse,
    @Headers(CSRF_HEADER) csrf: string | string[] | undefined,
  ): Promise<void> {
    await this.#post(request, response, body, async (meta) => {
      const code = parseOtpCodeBody(body);
      return this.activation.verifyOtp(this.#cookie(request), csrf, code, meta);
    });
  }

  @Post('password')
  async password(
    @Body() body: unknown,
    @Req() request: ActivationRequest,
    @Res() response: ActivationResponse,
    @Headers(CSRF_HEADER) csrf: string | string[] | undefined,
  ): Promise<void> {
    await this.#post(request, response, body, async (meta) => {
      const password = parsePasswordBody(body);
      return this.activation.setPassword(this.#cookie(request), csrf, password, meta);
    });
  }

  @Post('totp/enrollment')
  async enrollment(
    @Body() body: unknown,
    @Req() request: ActivationRequest,
    @Res() response: ActivationResponse,
    @Headers(CSRF_HEADER) csrf: string | string[] | undefined,
  ): Promise<void> {
    await this.#post(request, response, body, async (meta) => {
      parseEmptyBody(body);
      return this.activation.issueTotp(this.#cookie(request), csrf, meta);
    });
  }

  @Post('complete')
  async complete(
    @Body() body: unknown,
    @Req() request: ActivationRequest,
    @Res() response: ActivationResponse,
    @Headers(CSRF_HEADER) csrf: string | string[] | undefined,
  ): Promise<void> {
    await this.#post(request, response, body, async (meta) => {
      const code = parseTotpCodeBody(body);
      return this.activation.complete(this.#cookie(request), csrf, code, meta);
    });
  }

  // ----- shared ---------------------------------------------------------------------------------------------------

  /**
   * Every activation POST, in the order of contract 6.1 / 8: Origin and content type (before any database work), the
   * ingress quota in its own committed transaction, then the strict parse and the service call. A 401 for the activation
   * session also clears the cookie.
   */
  async #post(
    request: ActivationRequest,
    response: ActivationResponse,
    body: unknown,
    work: (meta: RequestMeta) => Promise<Answer>,
  ): Promise<void> {
    try {
      if (request.headers.origin !== this.#origin) {
        throw new AppError('ADMIN_CSRF_INVALID');
      }
      if (!isJsonContentType(request.headers['content-type']) || declaredBodyTooLarge(request.headers['content-length']) || serializedBodyTooLarge(body)) {
        throw new AppError('ADMIN_INPUT_INVALID');
      }
      const ip = resolveClientIp(request.socket.remoteAddress, request.headers['x-forwarded-for'], this.#trustedProxies);
      await this.limiter.reserveRequest(ip);
      const answer = await work({ requestId: request.requestId ?? randomUUID(), ip });
      if (answer.cookie !== undefined) {
        response.setHeader('Set-Cookie', activationCookie(answer.cookie.token, answer.cookie.maxAgeSeconds));
      }
      response.status(answer.status).json(answer.body);
    } catch (error) {
      this.#clearOnSessionInvalid(response, error);
      throw error;
    }
  }

  #clearOnSessionInvalid(response: ActivationResponse, error: unknown): void {
    if (error instanceof AppError && error.code === 'ADMIN_ACTIVATION_SESSION_INVALID') {
      response.setHeader('Set-Cookie', clearedActivationCookie());
    }
  }

  #cookie(request: ActivationRequest): string | undefined {
    return readCookieToken(request.headers.cookie, ACTIVATION_COOKIE);
  }
}
