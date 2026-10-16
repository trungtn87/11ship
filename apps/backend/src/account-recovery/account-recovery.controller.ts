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
 * HTTP adapter of the APPLICATION password reset and account recovery (11Food / 11Ship). Public: it reads no cookie, Bearer token or
 * CSRF value, whatever the request carries. It serves APP_USER accounts ONLY: the scope is fixed here, by the route, and no
 * request value can change it (the administration web has its own routes, below). Transport headers (no-store ...) come from
 * clientAuthTransportMiddleware (app.setup.ts).
 */
@Controller('account-recovery')
export class AccountRecoveryController {
  constructor(private readonly recovery: AccountRecoveryService) {}

  @Get('config')
  async config(@Query() query: unknown, @Body() body: unknown) {
    assertNoInput(query, body);
    // SMS_OTP only while the server mode allows it AND the SYSTEM switch otp_password_reset_enabled is on (read on every call).
    return { data: { mode: await this.recovery.effectiveAppMode() } };
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
    await this.recovery.assertAppResetEnabled();
    return { data: await this.recovery.requestOtp('APP_USER', parseResetOtpRequestBody(body).phoneNormalized) };
  }

  @Post('otp/:verificationId/verify')
  @HttpCode(200)
  async verifyOtp(@Param('verificationId') verificationId: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    this.recovery.assertSmsOtpOpen();
    await this.recovery.assertAppResetEnabled();
    const id = parseVerificationId(verificationId);
    const input = parseResetOtpVerifyBody(body);
    return { data: await this.recovery.verifyOtp('APP_USER', id, input.otp, request.requestId ?? randomUUID()) };
  }

  @Post('reset')
  @HttpCode(200)
  async reset(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    this.recovery.assertSmsOtpOpen();
    await this.recovery.assertAppResetEnabled();
    const outcome = await this.recovery.resetWithProof('APP_USER', parseResetOtpBody(body), idempotencyKey, request.requestId ?? randomUUID());
    return { data: outcome.payload };
  }

  /**
   * Recovery of an account locked at its owner's request (Owner decision 2026-10-14): OTP of the phone, then a new password. Always needs
   * the OTP, whatever the SYSTEM switches say; with the SMS gateway unavailable the request answers 503 and nothing is skipped.
   */
  @Get('locked/config')
  lockedConfig(@Query() query: unknown, @Body() body: unknown) {
    assertNoInput(query, body);
    // The server mode only: the SYSTEM switches never close the recovery of a locked account (it always needs the OTP).
    return { data: { mode: this.recovery.mode === 'SMS_OTP' ? 'SMS_OTP' : 'UNAVAILABLE' } };
  }

  @Post('locked/otp')
  @HttpCode(200)
  async requestRecoveryOtp(@Body() body: unknown) {
    this.recovery.assertSmsOtpOpen();
    return { data: await this.recovery.requestRecoveryOtp(parseResetOtpRequestBody(body).phoneNormalized) };
  }

  @Post('locked/otp/:verificationId/verify')
  @HttpCode(200)
  async verifyRecoveryOtp(@Param('verificationId') verificationId: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    this.recovery.assertSmsOtpOpen();
    const id = parseVerificationId(verificationId);
    const input = parseResetOtpVerifyBody(body);
    return { data: await this.recovery.verifyRecoveryOtp(id, input.otp, request.requestId ?? randomUUID()) };
  }

  @Post('locked/recover')
  @HttpCode(200)
  async recover(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    this.recovery.assertSmsOtpOpen();
    const outcome = await this.recovery.recover(parseResetOtpBody(body), idempotencyKey, request.requestId ?? randomUUID());
    return { data: outcome.payload };
  }
}

/**
 * HTTP adapter of the ADMINISTRATION password reset (the administration web only): ADMIN_WEB accounts, an ADMIN and never SYSTEM. The
 * scope is fixed here by the route; an application account (even one with the same phone) is never found by it, and the application
 * routes above never find an administration account. Public like the routes above; its OTP and proof carry their own purpose.
 */
@Controller('admin-recovery')
export class AdminAccountRecoveryController {
  constructor(private readonly recovery: AccountRecoveryService) {}

  @Get('config')
  config(@Query() query: unknown, @Body() body: unknown) {
    assertNoInput(query, body);
    return { data: { mode: this.recovery.mode === 'SMS_OTP' ? 'SMS_OTP' : 'UNAVAILABLE' } };
  }

  @Post('otp')
  @HttpCode(200)
  async requestOtp(@Body() body: unknown) {
    this.recovery.assertSmsOtpOpen();
    return { data: await this.recovery.requestOtp('ADMIN_WEB', parseResetOtpRequestBody(body).phoneNormalized) };
  }

  @Post('otp/:verificationId/verify')
  @HttpCode(200)
  async verifyOtp(@Param('verificationId') verificationId: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    this.recovery.assertSmsOtpOpen();
    const id = parseVerificationId(verificationId);
    const input = parseResetOtpVerifyBody(body);
    return { data: await this.recovery.verifyOtp('ADMIN_WEB', id, input.otp, request.requestId ?? randomUUID()) };
  }

  @Post('reset')
  @HttpCode(200)
  async reset(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    this.recovery.assertSmsOtpOpen();
    const outcome = await this.recovery.resetWithProof('ADMIN_WEB', parseResetOtpBody(body), idempotencyKey, request.requestId ?? randomUUID());
    return { data: outcome.payload };
  }
}
