import { randomUUID } from 'node:crypto';
import { Body, Controller, ForbiddenException, Get, Headers, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { AuthenticatedRequest } from '../auth/auth-principal';
import { OtpClientIp, OtpIpRequest } from '../auth/otp-client-ip';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { AccountDeletionService } from './account-deletion-service';
import { parseAccountDeletionBody } from './account-deletion-validation';
import {
  DELETE_ACCOUNT_CSS,
  DELETE_ACCOUNT_HEADERS,
  DELETE_ACCOUNT_HTML,
  DELETE_ACCOUNT_JS,
  DELETE_ACCOUNT_PAGE_PATH,
} from './account-deletion-page';

interface HeaderResponse {
  setHeader(name: string, value: string): unknown;
}

/**
 * When PUBLIC_WEB_ORIGIN is configured, a browser request must come from exactly that origin (the Origin header of a cross-site page or of a
 * sandboxed one never matches). A request with no Origin header (the mobile app, a command line) is not a browser cross-site request and passes:
 * the password in the body is the only authority, never an ambient cookie. Without the setting the Origin header is NOT compared at all (the page posts to a
 * relative path, so it works on whatever origin serves it): the setting is optional and only a browser-side defence in depth; production should declare it.
 */
export function originAllowed(origin: string | string[] | undefined, configured: string | undefined): boolean {
  if (configured === undefined || origin === undefined) {
    return true;
  }
  return typeof origin === 'string' && origin === configured;
}

/**
 * HTTP adapter of the owner's account deletion (P5-6a, OD-26). Public like /v1/account-recovery: it reads no cookie, Bearer token or CSRF value,
 * and APP_USER accounts are the only ones it can ever find. No-store headers come from clientAuthTransportMiddleware (app.setup.ts).
 */
@Controller('account-deletion')
export class AccountDeletionController {
  constructor(
    private readonly deletion: AccountDeletionService,
    private readonly clientIp: OtpClientIp,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('confirm')
  @HttpCode(200)
  async confirm(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
    @Headers('origin') origin: string | string[] | undefined,
    @Req() request: AuthenticatedRequest & OtpIpRequest,
  ) {
    if (!originAllowed(origin, this.config.accountDeletion?.publicOrigin)) {
      throw new ForbiddenException();
    }
    const input = parseAccountDeletionBody(body);
    const outcome = await this.deletion.confirm(input, idempotencyKey, request.requestId ?? randomUUID(), this.clientIp.identity(request));
    return { data: outcome.payload };
  }
}

/**
 * The public page /delete-account and its two assets, served from the backend's own origin (app.setup.ts maps the unprefixed path to this
 * controller). Static strings: nothing here reads the request, the database or a file.
 */
@Controller(DELETE_ACCOUNT_PAGE_PATH)
export class DeleteAccountPageController {
  @Get()
  page(@Res({ passthrough: true }) response: HeaderResponse): string {
    return send(response, 'text/html; charset=utf-8', DELETE_ACCOUNT_HTML);
  }

  @Get('app.js')
  script(@Res({ passthrough: true }) response: HeaderResponse): string {
    return send(response, 'text/javascript; charset=utf-8', DELETE_ACCOUNT_JS);
  }

  @Get('app.css')
  style(@Res({ passthrough: true }) response: HeaderResponse): string {
    return send(response, 'text/css; charset=utf-8', DELETE_ACCOUNT_CSS);
  }
}

function send(response: HeaderResponse, contentType: string, content: string): string {
  for (const [name, value] of Object.entries(DELETE_ACCOUNT_HEADERS)) {
    response.setHeader(name, value);
  }
  response.setHeader('content-type', contentType);
  return content;
}
