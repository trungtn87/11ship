import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req, Res, StreamableFile, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, AuthPrincipal } from '../auth/auth-principal';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { AppError } from '../common/app-errors';
import { OpsIngestService } from './ops-ingest-service';
import { parseAppUpdateCheck, parseBackupBody, parseClientLogs, parseDeployBody, parseProbeBody, parseReleaseId, parseVersionReport } from './ops-validation';

interface DownloadResponse {
  setHeader(name: string, value: string | number): unknown;
}

/**
 * What reports to M13 from outside the Administration (design sections 6, 7, 12). Three doors, three kinds of caller, none of them a person's browser:
 *  - /v1/ops/ingest/*: a machine credential (the independent probe, the backup job, the deploy pipeline), one scope per credential;
 *  - /v1/ops/client/*: the signed-in 11Food / 11Ship app (the normal client session, with the native device proof where it applies);
 *  - /v1/app-updates/*: the update check (public, read-only) and the download of a PUBLISHED release file by its id.
 * None of them changes an order, wallet, fee or delivery.
 */
@Controller()
export class OpsClientController {
  constructor(private readonly ingest: OpsIngestService) {}

  // ---- machine credentials ----

  @Post('ops/ingest/probe')
  @HttpCode(200)
  async probe(@Headers('authorization') authorization: string | undefined, @Body() body: unknown) {
    await this.ingest.authenticate(authorization, 'PROBE');
    return { data: await this.ingest.probe(parseProbeBody(body)) };
  }

  @Post('ops/ingest/backup')
  @HttpCode(200)
  async backup(@Headers('authorization') authorization: string | undefined, @Body() body: unknown) {
    await this.ingest.authenticate(authorization, 'BACKUP');
    return { data: await this.ingest.backup(parseBackupBody(body)) };
  }

  @Post('ops/ingest/deploy')
  @HttpCode(200)
  async deploy(@Headers('authorization') authorization: string | undefined, @Body() body: unknown) {
    await this.ingest.authenticate(authorization, 'DEPLOY');
    return { data: await this.ingest.deploy(parseDeployBody(body)) };
  }

  // ---- the apps ----

  @UseGuards(SessionAuthGuard)
  @Post('ops/client/logs')
  @HttpCode(200)
  async logs(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return { data: await this.ingest.clientLogs(this.#principal(request), parseClientLogs(body).entries) };
  }

  @UseGuards(SessionAuthGuard)
  @Post('ops/client/version')
  @HttpCode(200)
  async version(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return { data: await this.ingest.versionReport(this.#principal(request), parseVersionReport(body)) };
  }

  @Get('app-updates/check')
  async check(@Query() query: unknown) {
    const q = parseAppUpdateCheck(query);
    return { data: await this.ingest.updateCheck(q.component, q.versionCode) };
  }

  /** The deployed APK contract and what can be downloaded, per app. Read-only and public like /check; the deploy preflight reads it before promoting a breaking change. */
  @Get('app-updates/compatibility')
  async compatibility() {
    return { data: await this.ingest.compatibilityView() };
  }

  @Get('app-updates/download/:release_id')
  async download(@Param('release_id') id: string, @Res({ passthrough: true }) response: DownloadResponse): Promise<StreamableFile> {
    const file = await this.ingest.openArtifact(parseReleaseId(id), ['FOOD', 'SHIP']);
    response.setHeader('Content-Type', 'application/vnd.android.package-archive');
    response.setHeader('Content-Length', file.sizeBytes);
    response.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    response.setHeader('X-Checksum-SHA256', file.sha256);
    response.setHeader('Cache-Control', 'no-store');
    return new StreamableFile(file.stream);
  }

  #principal(request: AuthenticatedRequest): AuthPrincipal {
    if (request.auth === undefined) {
      throw new AppError('SESSION_INVALID');
    }
    return request.auth;
  }
}
