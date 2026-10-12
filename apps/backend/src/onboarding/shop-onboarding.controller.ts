import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Headers, HttpCode, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import { actorOf, AuthenticatedRequest } from '../auth/auth-principal';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { AppError } from '../common/app-errors';
import { ShopOnboardingService } from './shop-onboarding-service';
import { ShopServiceAreaQueryService } from './shop-service-area-query-service';
import { parseShopCompleteBody, parseShopProfileBody, rejectQueryAndBody } from './shop-onboarding-validation';
import { ShopProfileQueryService } from './shop-profile-query-service';

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
  constructor(
    private readonly onboarding: ShopOnboardingService,
    private readonly profiles: ShopProfileQueryService,
    private readonly serviceAreas: ShopServiceAreaQueryService,
  ) {}

  /**
   * Resume: the caller's own Shop profile with its current version, or null when there is none yet. Read-only,
   * so there is no Idempotency-Key, no audit row and no outbox event.
   */
  @Get('profile')
  async readProfile(@Req() request: AuthenticatedRequest) {
    const principal = this.#principal(request);
    return { data: await this.profiles.ownedProfile(principal.userId) };
  }

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
      actorOf(principal),
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
    const outcome = await this.onboarding.complete(actorOf(principal), input, idempotencyKey, requestIdOf(request));
    return { data: outcome.payload };
  }

  /**
   * The ACTIVE service areas a draft can name, so a client picks a real identifier. Read-only (no Idempotency-Key, no audit,
   * no outbox), no query and no body. The transport headers (Cache-Control: no-store ...) come from
   * clientAuthTransportMiddleware, installed in front of the body parser by configureApp.
   */
  @Get('service-areas')
  async readServiceAreas(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    rejectQueryAndBody(request, query);
    return { data: await this.serviceAreas.activeChoices(this.#principal(request)) };
  }

  #principal(request: AuthenticatedRequest) {
    if (request.auth === undefined) {
      throw new AppError('SESSION_INVALID');
    }
    return request.auth;
  }
}
