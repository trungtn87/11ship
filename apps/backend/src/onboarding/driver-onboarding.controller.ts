import { randomUUID } from 'node:crypto';
import { Body, Controller, Headers, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { actorOf, AuthenticatedRequest } from '../auth/auth-principal';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { AppError } from '../common/app-errors';
import { DriverOnboardingService } from './driver-onboarding-service';
import { parseDriverOnboardingBody } from './driver-onboarding-validation';

function requestIdOf(request: { requestId?: string }): string {
  return request.requestId ?? randomUUID();
}

/**
 * HTTP adapter of Driver onboarding. It parses strictly, calls one service and wraps the result in { data }.
 * The user comes only from the authenticated session; no business rule lives here. It selects no role and mints
 * no token: the client keeps its session and calls role/select if it wants the DRIVER context.
 */
@Controller('onboarding/driver')
@UseGuards(SessionAuthGuard)
export class DriverOnboardingController {
  constructor(private readonly onboarding: DriverOnboardingService) {}

  @Post()
  @HttpCode(201)
  async create(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    if (request.auth === undefined) {
      throw new AppError('SESSION_INVALID');
    }
    const input = parseDriverOnboardingBody(body);
    const outcome = await this.onboarding.create(actorOf(request.auth), input, idempotencyKey, requestIdOf(request));
    return { data: outcome.payload };
  }
}
