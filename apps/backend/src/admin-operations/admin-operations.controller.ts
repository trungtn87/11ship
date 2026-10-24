import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ADMIN_AUTH_CONFIG } from '../admin-auth/admin-auth-config.provider';
import { AdminLimiter } from '../admin-auth/admin-limiter';
import { AdminRequest, AdminTransport, Csrf, StatusResponse } from '../admin-shippers/admin-shipper.controller';
import { AdminAuthConfig } from '../config/admin-auth-config';
import { AdminOperationsService } from './admin-operations-service';
import { parseAuditQuery, parseCancelBody, parseEmptyBody, parseNoOperationsQuery, parseOperationsId, parseRestoreBody } from './admin-operations-validation';

/**
 * M12-F. GET /v1/admin/audit (audit.read; read only), GET /v1/admin/backups (SYSTEM), POST /v1/admin/restore-requests and .../:id/cancel (SYSTEM, idempotent, audited).
 * No route edits or deletes an audit row, deletes a backup record, or performs a restore.
 */
@Controller('admin')
export class AdminOperationsController {
  readonly #transport: AdminTransport;

  constructor(
    private readonly operations: AdminOperationsService,
    limiter: AdminLimiter,
    @Inject(ADMIN_AUTH_CONFIG) config: AdminAuthConfig,
  ) {
    this.#transport = new AdminTransport(limiter, config);
  }

  @Get('audit')
  async audit(@Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    return { data: await this.operations.auditLog(token, parseAuditQuery(query)) };
  }

  @Get('backups')
  async backups(@Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    parseNoOperationsQuery(query);
    return { data: await this.operations.backups(token) };
  }

  @Post('backups/run')
  @HttpCode(200)
  async run(@Body() body: unknown, @Req() request: AdminRequest, @Res({ passthrough: true }) response: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    const token = await this.#transport.write(request);
    parseEmptyBody(body);
    const outcome = await this.operations.runBackup(token, csrf, key, { requestId: request.requestId ?? randomUUID() });
    response.status(outcome.status);
    return { data: outcome.payload };
  }

  @Post('restore-requests')
  @HttpCode(200)
  async request(@Body() body: unknown, @Req() request: AdminRequest, @Res({ passthrough: true }) response: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    const token = await this.#transport.write(request);
    const outcome = await this.operations.requestRestore(token, csrf, parseRestoreBody(body), key, { requestId: request.requestId ?? randomUUID() });
    response.status(outcome.status);
    return { data: outcome.payload };
  }

  @Post('restore-requests/:request_id/cancel')
  @HttpCode(200)
  async cancel(@Param('request_id') id: string, @Body() body: unknown, @Req() request: AdminRequest, @Res({ passthrough: true }) response: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    const token = await this.#transport.write(request);
    const outcome = await this.operations.cancelRestore(token, csrf, parseOperationsId(id), parseCancelBody(body).expectedVersion, key, { requestId: request.requestId ?? randomUUID() });
    response.status(outcome.status);
    return { data: outcome.payload };
  }
}
