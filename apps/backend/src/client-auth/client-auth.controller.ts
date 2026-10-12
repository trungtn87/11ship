import { Body, Controller, Get, Headers, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuthenticatedRequest, AuthPrincipal } from '../auth/auth-principal';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { AppError } from '../common/app-errors';
import {
  parseClientContextBody,
  parseClientLoginBody,
  parseClientLogoutBody,
  parseClientRegisterBody,
} from './client-auth-validation';
import { ClientLoginService } from './client-login-service';
import { ClientRegistrationService } from './client-registration-service';
import { ClientSessionService } from './client-session-service';

interface StatusSettableResponse {
  status(code: number): unknown;
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
  ) {}

  @Post('register')
  async register(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: StatusSettableResponse,
  ) {
    const input = parseClientRegisterBody(body);
    const outcome = await this.registration.register(input, idempotencyKey, request.requestId ?? randomUUID());
    response.status(outcome.status);
    return { data: outcome.payload };
  }

  @Post('login')
  @HttpCode(200)
  async loginUser(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const input = parseClientLoginBody(body);
    const outcome = await this.login.login(input, idempotencyKey, request.requestId ?? randomUUID());
    return { data: outcome.payload };
  }

  @Get('me')
  @UseGuards(SessionAuthGuard)
  async me(@Req() request: AuthenticatedRequest) {
    const outcome = await this.sessions.me(this.#principal(request));
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
    await this.sessions.logout(authorization, request.requestId ?? randomUUID());
  }

  #principal(request: AuthenticatedRequest): AuthPrincipal {
    if (request.auth === undefined) {
      // Unreachable behind the guard; fail closed rather than act without an identity.
      throw new AppError('SESSION_INVALID');
    }
    return request.auth;
  }
}
