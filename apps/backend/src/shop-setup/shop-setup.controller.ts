import { randomUUID } from 'node:crypto';
import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { actorOf, AuthenticatedRequest } from '../auth/auth-principal';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { AppError } from '../common/app-errors';
import { ShopSetupQueryService } from './shop-setup-query-service';

/** HTTP adapter of the setup checklist. The user comes only from the authenticated session; the answer is the owner's own shop or null. */
@Controller('onboarding/shop')
@UseGuards(SessionAuthGuard)
export class ShopSetupController {
  constructor(private readonly setup: ShopSetupQueryService) {}

  @Get('setup')
  async read(@Req() request: AuthenticatedRequest) {
    if (request.auth === undefined) {
      throw new AppError('SESSION_INVALID');
    }
    return { data: await this.setup.read(actorOf(request.auth), (request as { requestId?: string }).requestId ?? randomUUID()) };
  }
}
