import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ADMIN_AUTH_CONFIG } from '../admin-auth/admin-auth-config.provider';
import { AdminLimiter } from '../admin-auth/admin-limiter';
import { AdminRequest, AdminTransport, Csrf, StatusResponse } from '../admin-shippers/admin-shipper.controller';
import { AdminAuthConfig } from '../config/admin-auth-config';
import { AdminReportService } from './admin-report-service';
import { parseExportBody, parseExportId, parseNoQuery, parseReportKind, parseReportQuery } from './admin-report-validation';

interface FileResponse extends StatusResponse {
  setHeader(name: string, value: string): void;
  end(body: Buffer): void;
}

/**
 * /v1/admin/reports (M12-E). Reading a report needs the report right; an export is created by POST (never a GET that streams everything), runs in the background and is downloaded
 * by its creator only, each step checking the CURRENT rights. The file answer is no-store and an attachment; its name is built by the server, never taken from the request.
 */
@Controller('admin/reports')
export class AdminReportController {
  readonly #transport: AdminTransport;

  constructor(
    private readonly reports: AdminReportService,
    limiter: AdminLimiter,
    @Inject(ADMIN_AUTH_CONFIG) config: AdminAuthConfig,
  ) {
    this.#transport = new AdminTransport(limiter, config);
  }

  // The fixed paths come before ':kind' so "exports" is never read as a report kind.
  @Get('exports')
  async list(@Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    parseNoQuery(query);
    return { data: await this.reports.listExports(token) };
  }

  @Post('exports')
  @HttpCode(200)
  async create(@Body() body: unknown, @Req() request: AdminRequest, @Res({ passthrough: true }) response: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    const token = await this.#transport.write(request);
    const outcome = await this.reports.createExport(token, csrf, parseExportBody(body), key, { requestId: request.requestId ?? randomUUID() });
    response.status(outcome.status);
    return { data: outcome.payload };
  }

  @Get('exports/:job_id/download')
  async download(@Param('job_id') id: string, @Query() query: unknown, @Req() request: AdminRequest, @Res() response: FileResponse) {
    const token = this.#transport.read(request);
    parseNoQuery(query);
    const file = await this.reports.download(token, parseExportId(id), { requestId: request.requestId ?? randomUUID() });
    response.setHeader('content-type', file.contentType);
    // The name is server-made from [a-z0-9_.-] only.
    response.setHeader('content-disposition', `attachment; filename="${file.fileName.replace(/[^A-Za-z0-9_.-]/g, '_')}"`);
    response.setHeader('cache-control', 'no-store');
    response.setHeader('x-content-type-options', 'nosniff');
    response.end(file.content);
  }

  @Get(':kind')
  async report(@Param('kind') kind: string, @Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    return { data: await this.reports.report(token, parseReportKind(kind), parseReportQuery(query)) };
  }
}
