import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Headers, HttpCode, Post, Query, Req } from '@nestjs/common';
import { AuthenticatedRequest } from '../auth/auth-principal';
import { AccountRecoveryService } from './account-recovery-service';
import { assertNoInput, parseResetTestBody } from './account-recovery-validation';

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
}
