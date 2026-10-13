import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Inject, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuthenticatedRequest, AuthPrincipal } from '../auth/auth-principal';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { AppError } from '../common/app-errors';
import { NativeRequestEvidence } from '../client-device/client-device-proof-service';
import { BindingInfo } from '../client-device/client-device-binding-participant';
import { CLIENT_AUTH_SETTINGS, ClientAuthSettings } from './client-auth-policy';
import {
  parseClientContextBody,
  parseClientLoginBody,
  parseClientLogoutBody,
  parseClientRegisterBody,
  parseClientUnverifiedRegisterBody,
} from './client-auth-validation';
import { ClientLoginService } from './client-login-service';
import { ClientRegistrationService } from './client-registration-service';
import { ClientSessionService } from './client-session-service';

interface StatusSettableResponse {
  status(code: number): unknown;
  setHeader(name: string, value: string): unknown;
}

/** The exact bytes and target of the request, for the native device proof (never re-serialized). */
function evidenceOf(request: AuthenticatedRequest): NativeRequestEvidence {
  return {
    method: request.method ?? 'GET',
    url: request.originalUrl ?? '',
    rawBody: request.rawBody ?? Buffer.alloc(0),
    headers: request.headers,
  };
}

/** Native responses name the binding in headers so the identity body keeps its exact contract shape. */
function bindingHeaders(response: StatusSettableResponse, binding: BindingInfo | undefined): void {
  if (binding !== undefined) {
    response.setHeader('X-Device-Binding-Id', binding.bindingId);
    response.setHeader('X-Device-Binding-Generation', String(binding.generation));
  }
}

/**
 * HTTP adapter of the client authentication API (M01.03 register, M01.04 login, me, context, logout). It parses strictly,
 * calls one service and wraps the result in the { data } envelope. Transport headers (Cache-Control: no-store ...) come from
 * clientAuthTransportMiddleware, installed in front of the body parser. No business rule lives here and nothing here logs a
 * body or a header.
 */
@Controller('client-auth')
export class ClientAuthController {
  constructor(
    private readonly registration: ClientRegistrationService,
    private readonly login: ClientLoginService,
    private readonly sessions: ClientSessionService,
    @Inject(CLIENT_AUTH_SETTINGS) private readonly settings: ClientAuthSettings,
  ) {}

  /**
   * Public client configuration (no session, no query, no body): the registration verification mode the server runs, taken
   * from the validated startup configuration. It carries no secret and grants nothing; a client that cannot read it must not
   * guess. The transport middleware adds Cache-Control: no-store like for every /v1/client-auth route.
   */
  @Get('config')
  config(@Query() query: unknown, @Body() body: unknown) {
    if (!isEmptyObject(query) || !(body === undefined || isEmptyObject(body))) {
      throw new BadRequestException();
    }
    return { data: { registration_verification: this.settings.phoneVerificationMode } };
  }

  @Post('register')
  async register(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: StatusSettableResponse,
  ) {
    const requestId = request.requestId ?? randomUUID();
    // The body shape follows the SERVER mode, never anything the request says about itself: REQUIRED takes the six-field proof
    // body, DISABLED_TEST the five-field body without a token (a token, a role or a bypass flag is a plain 400 there).
    const outcome =
      this.settings.phoneVerificationMode === 'DISABLED_TEST'
        ? await this.registration.registerUnverifiedTest(parseClientUnverifiedRegisterBody(body), idempotencyKey, requestId, evidenceOf(request))
        : await this.registration.register(parseClientRegisterBody(body), idempotencyKey, requestId);
    response.status(outcome.status);
    bindingHeaders(response, 'binding' in outcome ? outcome.binding : undefined);
    return { data: outcome.payload };
  }

  @Post('login')
  @HttpCode(200)
  async loginUser(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: StatusSettableResponse,
  ) {
    const input = parseClientLoginBody(body);
    const outcome = await this.login.login(input, idempotencyKey, request.requestId ?? randomUUID(), evidenceOf(request));
    bindingHeaders(response, outcome.binding);
    return { data: outcome.payload };
  }

  @Get('me')
  @UseGuards(SessionAuthGuard)
  async me(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: StatusSettableResponse) {
    const outcome = await this.sessions.me(this.#principal(request));
    bindingHeaders(response, outcome.binding);
    return { data: outcome.payload };
  }

  @Post('context')
  @HttpCode(200)
  @UseGuards(SessionAuthGuard)
  async selectContext(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const input = parseClientContextBody(body);
    const outcome = await this.sessions.selectContext(
      this.#principal(request),
      input,
      idempotencyKey,
      request.requestId ?? randomUUID(),
    );
    return { data: outcome.payload };
  }

  /**
   * No guard on purpose: the guard refuses a revoked or expired session, and logout must answer 204 for those (a retry of a
   * logout that already happened). The service authenticates the token itself and decides each case.
   */
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Body() body: unknown,
    @Headers('authorization') authorization: string | string[] | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    parseClientLogoutBody(body);
    await this.sessions.logout(authorization, request.requestId ?? randomUUID(), evidenceOf(request));
  }

  #principal(request: AuthenticatedRequest): AuthPrincipal {
    if (request.auth === undefined) {
      // Unreachable behind the guard; fail closed rather than act without an identity.
      throw new AppError('SESSION_INVALID');
    }
    return request.auth;
  }
}

function isEmptyObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 0;
}
