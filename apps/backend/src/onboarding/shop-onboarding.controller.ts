import { randomUUID } from 'node:crypto';
import { Body, Controller, Headers, HttpCode, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest } from '../auth/auth-principal';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { AppError } from '../common/app-errors';
import { ShopOnboardingService } from './shop-onboarding-service';
import { parseShopCompleteBody, parseShopProfileBody } from './shop-onboarding-validation';

interface StatusSettableResponse {
  status(code: number): unknown;
}

function requestIdOf(request: { requestId?: string }): string {
  return request.requestId ?? randomUUID();
}

/**
 * HTTP adapter of Shop onboarding. It parses strictly, calls one service and wraps the result in { data }.
 * The user comes only from the authenticated session; no business rule lives here.
 */
@Controller('onboarding/shop')
@UseGuards(SessionAuthGuard)
export class ShopOnboardingController {
  constructor(private readonly onboarding: ShopOnboardingService) {}

  @Put('profile')
  async saveProfile(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: StatusSettableResponse,
  ) {
    const principal = this.#principal(request);
    const input = parseShopProfileBody(body);
    const outcome = await this.onboarding.saveProfile(
      principal.userId,
      input,
      idempotencyKey,
      requestIdOf(request),
    );
    // 201 when the draft was created, 200 when it was updated; a replay keeps the stored status.
    response.status(outcome.status);
    return { data: outcome.payload };
  }

  @Post('complete')
  @HttpCode(200)
  async complete(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const principal = this.#principal(request);
    const input = parseShopCompleteBody(body);
    const outcome = await this.onboarding.complete(principal.userId, input, idempotencyKey, requestIdOf(request));
    return { data: outcome.payload };
  }

  #principal(request: AuthenticatedRequest) {
    if (request.auth === undefined) {
      throw new AppError('SESSION_INVALID');
    }
    return request.auth;
  }
}
