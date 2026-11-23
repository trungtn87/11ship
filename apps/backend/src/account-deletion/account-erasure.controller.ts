import { randomUUID } from 'node:crypto';
import { AppError } from '../common/app-errors';
import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, AuthPrincipal } from '../auth/auth-principal';
import { OtpClientIp, OtpIpRequest } from '../auth/otp-client-ip';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { AccountErasureService, ErasurePrecheck } from './account-erasure-service';
import { parseErasureCodeBody, parseErasureConfirmBody } from './account-erasure-validation';

/**
 * The signed-in owner's erasure (Owner order 2026-11-23): GET precheck (no change, no code), POST code (a one-time code by SMS, only when the
 * pre-check is clear and the forfeit is agreed), POST confirm (the code, then the lock and the one-time request). The caller is the session's
 * account only: no account id in the path, the query or the body.
 */
@Controller('account/deletion')
@UseGuards(SessionAuthGuard)
export class ClientAccountErasureController {
  constructor(
    private readonly erasure: AccountErasureService,
    private readonly clientIp: OtpClientIp,
  ) {}

  @Get('precheck')
  async precheck(@Req() request: AuthenticatedRequest) {
    return { data: serializePrecheck(await this.erasure.precheck(this.#principal(request))) };
  }

  @Post('code')
  @HttpCode(200)
  async code(@Body() body: unknown, @Req() request: AuthenticatedRequest & OtpIpRequest) {
    const input = parseErasureCodeBody(body);
    const sent = await this.erasure.requestCode(this.#principal(request), input, this.clientIp.identity(request));
    return { data: { verification_id: sent.verification_id, expires_in_seconds: sent.expires_in_seconds, resend_after_seconds: sent.resend_after_seconds } };
  }

  @Post('confirm')
  @HttpCode(200)
  async confirm(@Body() body: unknown, @Req() request: AuthenticatedRequest & OtpIpRequest) {
    const input = parseErasureConfirmBody(body);
    const outcome = await this.erasure.confirm(this.#principal(request), input, requestIdOf(request));
    return { data: outcome };
  }

  #principal(request: AuthenticatedRequest): AuthPrincipal {
    if (request.auth === undefined) {
      // Unreachable behind the guard; fail closed rather than act without an identity.
      throw new AppError('SESSION_INVALID');
    }
    return request.auth;
  }
}

function serializePrecheck(decision: ErasurePrecheck): Record<string, unknown> {
  if (decision.kind === 'BLOCKED') {
    return {
      status: 'BLOCKED',
      blockers: decision.blockers.map((blocker) => (blocker.code === 'ACTIVE_WORK' ? { code: blocker.code, items: [...blocker.items] } : { code: blocker.code })),
    };
  }
  return {
    status: 'READY',
    balance_vnd: decision.balanceVnd.toString(),
    forfeit_vnd: decision.forfeitVnd.toString(),
    withdraw_min_vnd: decision.withdrawMinVnd.toString(),
  };
}

function requestIdOf(request: { requestId?: string }): string {
  return request.requestId ?? randomUUID();
}
