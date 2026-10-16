import { randomUUID } from 'node:crypto';
import { BadRequestException, Body, Controller, Headers, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { ADMIN_AUTH_CONFIG } from '../admin-auth/admin-auth-config.provider';
import { ADMIN_SESSION_COOKIE } from '../admin-auth/admin-auth-constants';
import { isJsonContentType } from '../admin-auth/admin-auth-validation';
import { readCookieToken } from '../admin-auth/admin-cookies';
import { AdminLimiter } from '../admin-auth/admin-limiter';
import { resolveClientIp } from '../admin-auth/client-ip';
import { AppError } from '../common/app-errors';
import { AdminAuthConfig } from '../config/admin-auth-config';
import { AdminAccountLockService, LockKind } from './admin-account-lock-service';
import { parseLockBody, parseTargetUserId } from './admin-account-lock-validation';

interface AdminRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly socket: { readonly remoteAddress?: string };
  readonly requestId?: string;
}

interface StatusResponse {
  status(code: number): unknown;
}

/**
 * POST /v1/admin/users/:user_id/lock and /unlock (M01-ADMIN, D15). Same order as every administration POST: transport (exact
 * Origin, JSON) -> ingress quota -> strict parser -> unlocked cookie/CSRF precheck -> the coordinator. The SESSION cookie is
 * the only credential; the target comes from the path and the actor from the session, never from the body. No-store comes
 * from the module. Nothing here logs a body, a header or a cookie.
 */
@Controller('admin')
export class AdminAccountLockController {
  readonly #origins: ReadonlySet<string>;
  readonly #trustedProxies: ReadonlySet<string>;

  constructor(
    private readonly locks: AdminAccountLockService,
    private readonly limiter: AdminLimiter,
    @Inject(ADMIN_AUTH_CONFIG) config: AdminAuthConfig,
  ) {
    this.#origins = new Set(config.allowedOrigins);
    this.#trustedProxies = new Set(config.trustedProxyIps);
  }

  @Post('users/:user_id/lock')
  @HttpCode(200)
  lock(
    @Param('user_id') userId: string,
    @Body() body: unknown,
    @Req() request: AdminRequest,
    @Res({ passthrough: true }) response: StatusResponse,
    @Headers('x-csrf-token') csrf: string | string[] | undefined,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
  ) {
    return this.#change('lock', userId, body, request, response, csrf, idempotencyKey);
  }

  @Post('users/:user_id/unlock')
  @HttpCode(200)
  unlock(
    @Param('user_id') userId: string,
    @Body() body: unknown,
    @Req() request: AdminRequest,
    @Res({ passthrough: true }) response: StatusResponse,
    @Headers('x-csrf-token') csrf: string | string[] | undefined,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
  ) {
    return this.#change('unlock', userId, body, request, response, csrf, idempotencyKey);
  }

  /** Delete (Owner decision 2026-10-14): permanent when the account has no business data, otherwise a lock at the owner's request. */
  @Post('users/:user_id/delete')
  @HttpCode(200)
  delete(
    @Param('user_id') userId: string,
    @Body() body: unknown,
    @Req() request: AdminRequest,
    @Res({ passthrough: true }) response: StatusResponse,
    @Headers('x-csrf-token') csrf: string | string[] | undefined,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
  ) {
    return this.#change('delete', userId, body, request, response, csrf, idempotencyKey);
  }

  async #change(
    kind: LockKind,
    userId: string,
    body: unknown,
    request: AdminRequest,
    response: StatusResponse,
    csrf: string | string[] | undefined,
    idempotencyKey: string | string[] | undefined,
  ) {
    await this.#ingress(request);
    const target = parseTargetUserId(userId);
    const input = parseLockBody(body, kind === 'lock');
    const token = readCookieToken(request.headers.cookie, ADMIN_SESSION_COOKIE);
    const outcome = await this.locks.change(kind, token, csrf, target, input, idempotencyKey, { requestId: request.requestId ?? randomUUID() });
    response.status(outcome.status);
    return { data: outcome.payload };
  }

  /** Transport, then the ingress quota (its own short transaction, committed, never given back). */
  async #ingress(request: AdminRequest): Promise<void> {
    const origin = request.headers.origin;
    if (typeof origin !== 'string' || !this.#origins.has(origin)) {
      throw new AppError('ADMIN_CSRF_INVALID');
    }
    if (!isJsonContentType(request.headers['content-type'])) {
      throw new BadRequestException();
    }
    await this.limiter.reserveTotpRequest(
      resolveClientIp(request.socket.remoteAddress, request.headers['x-forwarded-for'], this.#trustedProxies),
    );
  }
}
