import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, AuthPrincipal } from '../auth/auth-principal';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { AppError } from '../common/app-errors';
import { rejectBodyAndQuery } from '../customer-profile/customer-profile-validation';
import { NotificationInboxService } from './notification-inbox-service';
import { parseChangesQuery, parseEmptyBody, parseInboxQuery, parseNotificationId, parseReadBody, parseSettingsBody, parseTokenBody } from './notification-validation';

/**
 * The account's notifications (M08), behind the client session guard, for both apps (the session says which one). Identity is the principal only; the one
 * identifier in a path is the notification, and one of another account or app reads as not found. None of these writes is a business command: they only
 * change the account's own read marks, settings and push link, so they need no Idempotency-Key (repeating any of them is harmless).
 */
@UseGuards(SessionAuthGuard)
@Controller('notifications')
export class NotificationController {
  constructor(private readonly inbox: NotificationInboxService) {}

  @Get()
  async list(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    return { data: await this.inbox.list(this.#principal(request), parseInboxQuery(query)) };
  }

  @Get('changes')
  async changes(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    const q = parseChangesQuery(query);
    // The wait is bounded (25 s), so a client that went away only costs one more short round.
    return { data: await this.inbox.changes(this.#principal(request), q.afterSeq, q.waitSeconds, new AbortController().signal) };
  }

  @Get('unread-count')
  async unread(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    rejectBodyAndQuery(request, query);
    return { data: await this.inbox.unread(this.#principal(request)) };
  }

  @Get('settings')
  async settings(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    rejectBodyAndQuery(request, query);
    return { data: await this.inbox.settings(this.#principal(request)) };
  }

  @Put('settings')
  @HttpCode(200)
  async updateSettings(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return { data: await this.inbox.updateSettings(this.#principal(request), (current) => parseSettingsBody(body, current)) };
  }

  @Post('read')
  @HttpCode(200)
  async read(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return { data: await this.inbox.markRead(this.#principal(request), parseReadBody(body)) };
  }

  @Post('read-all')
  @HttpCode(200)
  async readAll(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    parseEmptyBody(body);
    return { data: await this.inbox.markRead(this.#principal(request), 'ALL') };
  }

  @Put('push-token')
  @HttpCode(200)
  async registerToken(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return { data: await this.inbox.token(this.#principal(request), parseTokenBody(body)) };
  }

  @Delete('push-token')
  @HttpCode(200)
  async unregisterToken(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    rejectBodyAndQuery(request, query);
    return { data: await this.inbox.unregister(this.#principal(request)) };
  }

  @Post(':notification_id/open')
  @HttpCode(200)
  async open(@Param('notification_id') id: string, @Req() request: AuthenticatedRequest, @Body() body: unknown) {
    parseEmptyBody(body);
    return { data: await this.inbox.open(this.#principal(request), parseNotificationId(id)) };
  }

  #principal(request: AuthenticatedRequest): AuthPrincipal {
    if (request.auth === undefined) {
      // Unreachable behind the guard; fail closed rather than act without an identity.
      throw new AppError('SESSION_INVALID');
    }
    return request.auth;
  }
}
