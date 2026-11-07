import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { AuthenticatedRequest } from './auth-principal';
import { parseOtpRequestBody, parseOtpVerifyBody, parseVerificationId } from './auth-validation';
import { OtpClientIp, OtpIpRequest } from './otp-client-ip';
import { VerificationService } from './verification-service';
import { randomUUID } from 'node:crypto';

function requestIdOf(request: { requestId?: string }): string {
  // The request-context middleware always sets it; a fresh UUID only covers a pipeline that skipped it.
  return request.requestId ?? randomUUID();
}

/**
 * HTTP adapter of the phone-verification part of Auth Core. It parses (strictly), calls one service and wraps the result in
 * the { data } envelope. No business rule lives here, and nothing here logs a body or a header. Account routes (register,
 * login, me, role) live under /v1/client-auth; the legacy /v1/auth/{register,login,role/select,me} were removed (OD-1).
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly verification: VerificationService,
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
}
