import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ADMIN_AUTH_CONFIG } from '../admin-auth/admin-auth-config.provider';
import { AdminLimiter } from '../admin-auth/admin-limiter';
import { AdminRequest, AdminTransport, Csrf, StatusResponse } from '../admin-shippers/admin-shipper.controller';
import { AdminAuthConfig } from '../config/admin-auth-config';
import { AdminAccessService } from './admin-access-service';
import { parseAccessId, parseNoAccessQuery, parsePermissionsBody, parseRevokeBody, parseStatusBody } from './admin-access-validation';

/**
 * /v1/admin/access (M12-C). SYSTEM only, enforced again by the service under the actor's locks: the matrix of the administrators and the four commands
 * (permissions, lock, unlock, revoke sessions). The target comes from the path, the actor from the session; a body never names either. No-store comes from the module.
 */
@Controller('admin/access')
export class AdminAccessController {
  readonly #transport: AdminTransport;

  constructor(
    private readonly access: AdminAccessService,
    limiter: AdminLimiter,
    @Inject(ADMIN_AUTH_CONFIG) config: AdminAuthConfig,
  ) {
    this.#transport = new AdminTransport(limiter, config);
  }

  @Get('matrix')
  async matrix(@Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    parseNoAccessQuery(query);
    return { data: await this.access.matrix(token) };
  }

  @Post('administrators/:user_id/permissions')
  @HttpCode(200)
  async permissions(@Param('user_id') id: string, @Body() body: unknown, @Req() request: AdminRequest, @Res({ passthrough: true }) response: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    const token = await this.#transport.write(request);
    const outcome = await this.access.updatePermissions(token, csrf, parseAccessId(id), parsePermissionsBody(body), key, { requestId: request.requestId ?? randomUUID() });
    response.status(outcome.status);
    return { data: outcome.payload };
  }

  @Post('administrators/:user_id/lock')
  @HttpCode(200)
  lock(@Param('user_id') id: string, @Body() body: unknown, @Req() request: AdminRequest, @Res({ passthrough: true }) response: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    return this.#status('lock', id, body, request, response, csrf, key);
  }

  @Post('administrators/:user_id/unlock')
  @HttpCode(200)
  unlock(@Param('user_id') id: string, @Body() body: unknown, @Req() request: AdminRequest, @Res({ passthrough: true }) response: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    return this.#status('unlock', id, body, request, response, csrf, key);
  }

  @Post('administrators/:user_id/revoke-sessions')
  @HttpCode(200)
  async revoke(@Param('user_id') id: string, @Body() body: unknown, @Req() request: AdminRequest, @Res({ passthrough: true }) response: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    const token = await this.#transport.write(request);
    const outcome = await this.access.revokeSessions(token, csrf, parseAccessId(id), parseRevokeBody(body), key, { requestId: request.requestId ?? randomUUID() });
    response.status(outcome.status);
    return { data: outcome.payload };
  }

  async #status(command: 'lock' | 'unlock', id: string, body: unknown, request: AdminRequest, response: StatusResponse, csrf: Csrf, key: Csrf) {
    const token = await this.#transport.write(request);
    const outcome = await this.access.setStatus(command, token, csrf, parseAccessId(id), parseStatusBody(body), key, { requestId: request.requestId ?? randomUUID() });
    response.status(outcome.status);
    return { data: outcome.payload };
  }
}
