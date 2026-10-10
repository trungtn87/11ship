import { randomUUID } from 'node:crypto';
import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ADMIN_SESSION_COOKIE } from '../admin-auth/admin-auth-constants';
import { ADMIN_AUTH_CONFIG } from '../admin-auth/admin-auth-config.provider';
import { isJsonContentType } from '../admin-auth/admin-auth-validation';
import { readCookieToken } from '../admin-auth/admin-cookies';
import { AdminLimiter } from '../admin-auth/admin-limiter';
import { resolveClientIp } from '../admin-auth/client-ip';
import { AppError } from '../common/app-errors';
import { AdminAuthConfig } from '../config/admin-auth-config';
import { AdminInvitationService } from './admin-invitation-service';
import { AdminOperationService } from './admin-operation-service';
import {
  parseCreateInvitationBody,
  parseListQuery,
  parseOperationBody,
  parseReissueBody,
  parseRevokeBody,
  parseUuid,
  parseVerifyBody,
} from './admin-provisioning-validation';

interface AdminRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly socket: { readonly remoteAddress?: string };
  readonly requestId?: string;
}

interface StatusResponse {
  status(code: number): unknown;
}

function requestIdOf(request: { requestId?: string }): string {
  return request.requestId ?? randomUUID();
}

/**
 * HTTP adapter of M01-D-ADMIN-1B under /v1/admin (SYSTEM only; the web is for ADMIN/SYSTEM, Customer/Shop/Driver use
 * their apps and their tokens are no administration cookie). Order of every POST (Owner decision Q6):
 *   transport (exact Origin, JSON) -> ingress quota -> strict parser -> unlocked cookie/CSRF precheck -> coordinator.
 * Every GET: Origin optional (checked only when present), no CSRF, no new quota; the session and the SYSTEM role are
 * still checked under shared locks by the service. Nothing here logs a body, a header, a cookie or a link.
 */
@Controller('admin')
export class AdminProvisioningController {
  readonly #origins: ReadonlySet<string>;
  readonly #trustedProxies: ReadonlySet<string>;

  constructor(
    private readonly operations: AdminOperationService,
    private readonly invitations: AdminInvitationService,
    private readonly limiter: AdminLimiter,
    @Inject(ADMIN_AUTH_CONFIG) config: AdminAuthConfig,
  ) {
    this.#origins = new Set(config.allowedOrigins);
    this.#trustedProxies = new Set(config.trustedProxyIps);
  }

  @Post('operations')
  @HttpCode(201)
  async createOperation(
    @Body() body: unknown,
    @Req() request: AdminRequest,
    @Headers('x-csrf-token') csrf: string | string[] | undefined,
  ) {
    await this.#postIngress(request);
    const input = parseOperationBody(body);
    const data = await this.operations.createOperation(this.#session(request), csrf, input, { requestId: requestIdOf(request) });
    return { data };
  }

  @Post('operations/:operation_id/verify')
  @HttpCode(200)
  async verify(
    @Param('operation_id') operationId: string,
    @Body() body: unknown,
    @Req() request: AdminRequest,
    @Headers('x-csrf-token') csrf: string | string[] | undefined,
  ) {
    await this.#postIngress(request);
    const id = parseUuid(operationId);
    const code = parseVerifyBody(body);
    const data = await this.operations.verify(this.#session(request), csrf, id, code, { requestId: requestIdOf(request) });
    return { data };
  }

  @Get('operations/:operation_id')
  async readOperation(@Param('operation_id') operationId: string, @Req() request: AdminRequest) {
    this.#assertGetOrigin(request);
    const id = parseUuid(operationId);
    return { data: await this.operations.read(this.#session(request), id) };
  }

  @Post('invitations')
  async createInvitation(
    @Body() body: unknown,
    @Req() request: AdminRequest,
    @Res({ passthrough: true }) response: StatusResponse,
    @Headers('x-csrf-token') csrf: string | string[] | undefined,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
  ) {
    await this.#postIngress(request);
    const input = parseCreateInvitationBody(body);
    const outcome = await this.invitations.create(this.#session(request), csrf, input, idempotencyKey, {
      requestId: requestIdOf(request),
    });
    response.status(outcome.status);
    return { data: outcome.payload };
  }

  @Get('invitations')
  async listInvitations(@Query() query: unknown, @Req() request: AdminRequest) {
    this.#assertGetOrigin(request);
    const parsed = parseListQuery(query);
    return { data: await this.invitations.list(this.#session(request), parsed) };
  }

  @Get('invitations/:invitation_id')
  async readInvitation(@Param('invitation_id') invitationId: string, @Req() request: AdminRequest) {
    this.#assertGetOrigin(request);
    const id = parseUuid(invitationId);
    return { data: await this.invitations.get(this.#session(request), id) };
  }

  @Post('invitations/:invitation_id/reissue')
  async reissueInvitation(
    @Param('invitation_id') invitationId: string,
    @Body() body: unknown,
    @Req() request: AdminRequest,
    @Res({ passthrough: true }) response: StatusResponse,
    @Headers('x-csrf-token') csrf: string | string[] | undefined,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
  ) {
    await this.#postIngress(request);
    const input = parseReissueBody(invitationId, body);
    const outcome = await this.invitations.reissue(this.#session(request), csrf, input, idempotencyKey, {
      requestId: requestIdOf(request),
    });
    response.status(outcome.status);
    return { data: outcome.payload };
  }

  @Post('invitations/:invitation_id/revoke')
  async revokeInvitation(
    @Param('invitation_id') invitationId: string,
    @Body() body: unknown,
    @Req() request: AdminRequest,
    @Res({ passthrough: true }) response: StatusResponse,
    @Headers('x-csrf-token') csrf: string | string[] | undefined,
    @Headers('idempotency-key') idempotencyKey: string | string[] | undefined,
  ) {
    await this.#postIngress(request);
    const input = parseRevokeBody(invitationId, body);
    const outcome = await this.invitations.revoke(this.#session(request), csrf, input, idempotencyKey, {
      requestId: requestIdOf(request),
    });
    response.status(outcome.status);
    return { data: outcome.payload };
  }

  /** Transport, then the ingress quota (its own short transaction, committed, never given back). */
  async #postIngress(request: AdminRequest): Promise<void> {
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

  /** A same-origin GET may carry no Origin header; one that is present must be an allowed origin (F5). */
  #assertGetOrigin(request: AdminRequest): void {
    const origin = request.headers.origin;
    if (origin !== undefined && (typeof origin !== 'string' || !this.#origins.has(origin))) {
      throw new AppError('ADMIN_CSRF_INVALID');
    }
  }

  #session(request: AdminRequest): string | undefined {
    return readCookieToken(request.headers.cookie, ADMIN_SESSION_COOKIE);
  }
}
