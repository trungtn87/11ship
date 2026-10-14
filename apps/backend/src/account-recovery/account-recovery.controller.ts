import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { parseVerificationId } from '../auth/auth-validation';
import { AuthenticatedRequest } from '../auth/auth-principal';
import { AccountRecoveryService } from './account-recovery-service';
import {
  assertNoInput,
  parseResetOtpBody,
  parseResetOtpRequestBody,
  parseResetOtpVerifyBody,
  parseResetTestBody,
} from './account-recovery-validation';

/**
 * HTTP adapter of the no-OTP test password reset (M01-RESET). Public: it reads no cookie, Bearer token or CSRF value, whatever
 * the request carries. Transport headers (no-store ...) come from clientAuthTransportMiddleware (app.setup.ts).
 */
@Controller('account-recovery')
export class AccountRecoveryController {
  constructor(private readonly recovery: AccountRecoveryService) {}

  @Get('config')
  config(@Query() query: unknown, @Body() body: unknown) {
    assertNoInput(query, body);
    return { data: { mode: this.recovery.mode } };
  }

  @Post('reset-test')
  @HttpCode(200)
  async resetTest(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    // Closed mode answers 503 before the body is even validated.
    this.recovery.assertOpen();
    const outcome = await this.recovery.resetTest(parseResetTestBody(body), idempotencyKey, request.requestId ?? randomUUID());
    return { data: outcome.payload };
  }

  /** SMS_OTP step 1 (issue #102): the same generic answer for every number. Closed modes answer 503 before the body is read. */
  @Post('otp')
  @HttpCode(200)
  async requestOtp(@Body() body: unknown) {
    this.recovery.assertSmsOtpOpen();
    return { data: await this.recovery.requestOtp(parseResetOtpRequestBody(body).phoneNormalized) };
  }

  @Post('otp/:verificationId/verify')
  @HttpCode(200)
  async verifyOtp(@Param('verificationId') verificationId: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    this.recovery.assertSmsOtpOpen();
    const id = parseVerificationId(verificationId);
    const input = parseResetOtpVerifyBody(body);
    return { data: await this.recovery.verifyOtp(id, input.otp, request.requestId ?? randomUUID()) };
  }

  @Post('reset')
  @HttpCode(200)
  async reset(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    this.recovery.assertSmsOtpOpen();
    const outcome = await this.recovery.resetWithProof(parseResetOtpBody(body), idempotencyKey, request.requestId ?? randomUUID());
    return { data: outcome.payload };
  }
}
