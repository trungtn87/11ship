import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ADMIN_AUTH_CONFIG } from '../admin-auth/admin-auth-config.provider';
import { AdminLimiter } from '../admin-auth/admin-limiter';
import { AdminRequest, AdminTransport, Csrf, StatusResponse } from '../admin-shippers/admin-shipper.controller';
import { AdminAuthConfig } from '../config/admin-auth-config';
import { IdempotentOutcome } from '../idempotency/idempotency-executor';
import { OpsAdminService } from './ops-admin-service';
import {
  parseAccessBody,
  parseAssignBody,
  parseCloseBody,
  parseConfigBody,
  parseExpectedVersion,
  parseIncidentList,
  parseIncidentRef,
  parseLogQuery,
  parseMaintenanceBody,
  parseNoQuery,
  parseNoteBody,
  parseReleaseBody,
  parseReleaseListQuery,
  parseSnoozeBody,
  parseTopupNoteBody,
  parseUuidParam,
  parseVpsQuery,
} from './ops-validation';

/**
 * /v1/admin/ops (M13, Administration web). The SESSION cookie is the only credential; the actor comes from the session and the target from the path, never from a
 * body. Same order as every administration write: transport (exact Origin, JSON, quota), strict parser, cookie/CSRF precheck, then the service authorizes again under
 * locks. There is NO route that runs a command, takes a path or URL, sends an arbitrary message or edits a log line, and none that deploys a server.
 */
@Controller('admin/ops')
export class OpsAdminController {
  readonly #transport: AdminTransport;

  constructor(
    private readonly ops: OpsAdminService,
    limiter: AdminLimiter,
    @Inject(ADMIN_AUTH_CONFIG) config: AdminAuthConfig,
  ) {
    this.#transport = new AdminTransport(limiter, config);
  }

  // ---- reads ----

  @Get('me')
  async me(@Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    parseNoQuery(query);
    return { data: await this.ops.me(token) };
  }

  @Get('overview')
  async overview(@Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    parseNoQuery(query);
    return { data: await this.ops.overview(token) };
  }

  @Get('vps')
  async vps(@Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    return { data: await this.ops.vps(token, parseVpsQuery(query)) };
  }

  @Get('incidents')
  async incidents(@Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    return { data: await this.ops.incidentList(token, parseIncidentList(query)) };
  }

  @Get('incidents/:ref')
  async incident(@Param('ref') ref: string, @Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    parseNoQuery(query);
    return { data: await this.ops.incidentDetail(token, parseIncidentRef(ref)) };
  }

  @Get('gateway')
  async gateway(@Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    parseNoQuery(query);
    return { data: await this.ops.gateway(token) };
  }

  @Get('logs')
  async logs(@Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    return { data: await this.ops.logs(token, parseLogQuery(query)) };
  }

  @Get('releases')
  async releases(@Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    return { data: await this.ops.releasesView(token, parseReleaseListQuery(query)) };
  }

  @Get('config')
  async config(@Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    parseNoQuery(query);
    return { data: await this.ops.config(token) };
  }

  // ---- incident actions (HANDLE), assignment (SYSTEM) ----

  @Post('incidents/:id/acknowledge')
  @HttpCode(200)
  async acknowledge(@Param('id') id: string, @Body() body: unknown, @Req() request: AdminRequest, @Res({ passthrough: true }) response: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    const token = await this.#transport.write(request);
    const incidentId = parseUuidParam(id);
    const b = parseExpectedVersion(body);
    return this.#done(response, await this.ops.acknowledge(token, csrf, key, this.#meta(request), incidentId, b.expectedVersion));
  }

  @Post('incidents/:id/start')
  @HttpCode(200)
  async start(@Param('id') id: string, @Body() body: unknown, @Req() request: AdminRequest, @Res({ passthrough: true }) response: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    const token = await this.#transport.write(request);
    const incidentId = parseUuidParam(id);
    const b = parseExpectedVersion(body);
    return this.#done(response, await this.ops.start(token, csrf, key, this.#meta(request), incidentId, b.expectedVersion));
  }

  @Post('incidents/:id/note')
  @HttpCode(200)
  async note(@Param('id') id: string, @Body() body: unknown, @Req() request: AdminRequest, @Res({ passthrough: true }) response: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    const token = await this.#transport.write(request);
    const incidentId = parseUuidParam(id);
    const b = parseNoteBody(body);
    return this.#done(response, await this.ops.note(token, csrf, key, this.#meta(request), incidentId, b.text));
  }

  @Post('incidents/:id/snooze')
  @HttpCode(200)
  async snooze(@Param('id') id: string, @Body() body: unknown, @Req() request: AdminRequest, @Res({ passthrough: true }) response: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    const token = await this.#transport.write(request);
    const incidentId = parseUuidParam(id);
    const b = parseSnoozeBody(body);
    return this.#done(response, await this.ops.snooze(token, csrf, key, this.#meta(request), incidentId, b.expectedVersion, b.minutes));
  }

  @Post('incidents/:id/close')
  @HttpCode(200)
  async close(@Param('id') id: string, @Body() body: unknown, @Req() request: AdminRequest, @Res({ passthrough: true }) response: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    const token = await this.#transport.write(request);
    const incidentId = parseUuidParam(id);
    const b = parseCloseBody(body);
    return this.#done(response, await this.ops.close(token, csrf, key, this.#meta(request), incidentId, b));
  }

  @Post('incidents/:id/assign')
  @HttpCode(200)
  async assign(@Param('id') id: string, @Body() body: unknown, @Req() request: AdminRequest, @Res({ passthrough: true }) response: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    const token = await this.#transport.write(request);
    const incidentId = parseUuidParam(id);
    const b = parseAssignBody(body);
    return this.#done(response, await this.ops.assign(token, csrf, key, this.#meta(request), incidentId, b));
  }

  // ---- SYSTEM only ----

  @Post('config')
  @HttpCode(200)
  async updateConfig(@Body() body: unknown, @Req() request: AdminRequest, @Res({ passthrough: true }) response: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    const token = await this.#transport.write(request);
    return this.#done(response, await this.ops.updateConfig(token, csrf, key, this.#meta(request), parseConfigBody(body)));
  }

  @Post('config/discord-test')
  @HttpCode(200)
  async discordTest(@Body() body: unknown, @Req() request: AdminRequest, @Res({ passthrough: true }) response: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    const token = await this.#transport.write(request);
    parseNoQuery(body);
    return this.#done(response, await this.ops.discordTest(token, csrf, key, this.#meta(request)));
  }

  @Post('maintenance')
  @HttpCode(200)
  async createMaintenance(@Body() body: unknown, @Req() request: AdminRequest, @Res({ passthrough: true }) response: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    const token = await this.#transport.write(request);
    return this.#done(response, await this.ops.createMaintenance(token, csrf, key, this.#meta(request), parseMaintenanceBody(body)));
  }

  @Post('maintenance/:id/cancel')
  @HttpCode(200)
  async cancelMaintenance(@Param('id') id: string, @Body() body: unknown, @Req() request: AdminRequest, @Res({ passthrough: true }) response: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    const token = await this.#transport.write(request);
    const maintenanceId = parseUuidParam(id);
    parseNoQuery(body);
    return this.#done(response, await this.ops.cancelMaintenance(token, csrf, key, this.#meta(request), maintenanceId));
  }

  @Post('access')
  @HttpCode(200)
  async access(@Body() body: unknown, @Req() request: AdminRequest, @Res({ passthrough: true }) response: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    const token = await this.#transport.write(request);
    return this.#done(response, await this.ops.setAccess(token, csrf, key, this.#meta(request), parseAccessBody(body)));
  }

  @Post('gateway/:device_id/topup-note')
  @HttpCode(200)
  async topupNote(@Param('device_id') id: string, @Body() body: unknown, @Req() request: AdminRequest, @Res({ passthrough: true }) response: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    const token = await this.#transport.write(request);
    const deviceId = parseUuidParam(id);
    return this.#done(response, await this.ops.topupNote(token, csrf, key, this.#meta(request), deviceId, parseTopupNoteBody(body).date));
  }

  @Post('releases')
  @HttpCode(200)
  async createRelease(@Body() body: unknown, @Req() request: AdminRequest, @Res({ passthrough: true }) response: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    const token = await this.#transport.write(request);
    return this.#done(response, await this.ops.createRelease(token, csrf, key, this.#meta(request), parseReleaseBody(body)));
  }

  @Post('releases/:id/publish')
  @HttpCode(200)
  async publish(@Param('id') id: string, @Body() body: unknown, @Req() request: AdminRequest, @Res({ passthrough: true }) response: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    const token = await this.#transport.write(request);
    const releaseId = parseUuidParam(id);
    return this.#done(response, await this.ops.publishRelease(token, csrf, key, this.#meta(request), releaseId, parseExpectedVersion(body).expectedVersion));
  }

  @Post('releases/:id/withdraw')
  @HttpCode(200)
  async withdraw(@Param('id') id: string, @Body() body: unknown, @Req() request: AdminRequest, @Res({ passthrough: true }) response: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    const token = await this.#transport.write(request);
    const releaseId = parseUuidParam(id);
    return this.#done(response, await this.ops.withdrawRelease(token, csrf, key, this.#meta(request), releaseId, parseExpectedVersion(body).expectedVersion));
  }

  #meta(request: AdminRequest): { requestId: string } {
    return { requestId: request.requestId ?? randomUUID() };
  }

  #done(response: StatusResponse, outcome: IdempotentOutcome): { data: unknown } {
    response.status(outcome.status);
    return { data: outcome.payload };
  }
}
