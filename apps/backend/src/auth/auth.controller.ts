import { Body, Controller, Get, Headers, HttpCode, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest } from './auth-principal';
import {
  parseLoginBody,
  parseOtpRequestBody,
  parseOtpVerifyBody,
  parseRegisterBody,
  parseRoleSelectBody,
  parseVerificationId,
} from './auth-validation';
import { LoginService } from './login-service';
import { OtpClientIp, OtpIpRequest } from './otp-client-ip';
import { RegistrationService } from './registration-service';
import { RoleContextService } from './role-context-service';
import { SessionAuthGuard } from './session-auth.guard';
import { VerificationService } from './verification-service';
import { AppError } from '../common/app-errors';
import { randomUUID } from 'node:crypto';

interface StatusSettableResponse {
  status(code: number): unknown;
}

function requestIdOf(request: { requestId?: string }): string {
  // The request-context middleware always sets it; a fresh UUID only covers a pipeline that skipped it.
  return request.requestId ?? randomUUID();
}

/**
 * HTTP adapter of Auth Core. It parses (strictly), calls one service and wraps the result in the
 * { data } envelope. No business rule lives here, and nothing here logs a body or a header.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly verification: VerificationService,
    private readonly registration: RegistrationService,
    private readonly login: LoginService,
    private readonly roles: RoleContextService,
    private readonly clientIp: OtpClientIp,
  ) {}

  @Post('phone-verifications')
  @HttpCode(201)
  async requestOtp(@Body() body: unknown, @Req() request: OtpIpRequest) {
    const input = parseOtpRequestBody(body);
    return { data: await this.verification.requestOtp(input.phoneNormalized, input.purpose, this.clientIp.identity(request)) };
  }

  /** Delivery state of a REGISTER code the caller requested (issue #102): the SMS is queued, then sent by the paired phone. */
  @Get('phone-verifications/:verificationId')
  async deliveryStatus(@Param('verificationId') verificationId: string) {
    return { data: await this.verification.getDelivery(parseVerificationId(verificationId)) };
  }

  @Post('phone-verifications/:verificationId/verify')
  @HttpCode(200)
  async verifyOtp(
    @Param('verificationId') verificationId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const id = parseVerificationId(verificationId);
    const input = parseOtpVerifyBody(body);
    return { data: await this.verification.verifyOtp(id, input.otp, requestIdOf(request)) };
  }

  @Post('register')
  async register(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: StatusSettableResponse,
  ) {
    const input = parseRegisterBody(body);
    const outcome = await this.registration.register(input, idempotencyKey, requestIdOf(request));
    // 201 for a first execution and for an exact replay of it (the stored status).
    response.status(outcome.status);
    return { data: outcome.payload };
  }

  @Post('login')
  @HttpCode(200)
  async loginUser(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const input = parseLoginBody(body);
    return { data: await this.login.login(input, requestIdOf(request)) };
  }

  @Post('role/select')
  @HttpCode(200)
  @UseGuards(SessionAuthGuard)
  async selectRole(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const input = parseRoleSelectBody(body);
    return { data: await this.roles.selectRole(this.#principal(request), input.role, requestIdOf(request)) };
  }

  @Get('me')
  @UseGuards(SessionAuthGuard)
  async me(@Req() request: AuthenticatedRequest) {
    return { data: await this.roles.me(this.#principal(request)) };
  }

  #principal(request: AuthenticatedRequest) {
    if (request.auth === undefined) {
      // Unreachable behind the guard; fail closed rather than act without an identity.
      throw new AppError('SESSION_INVALID');
    }
    return request.auth;
  }
}
