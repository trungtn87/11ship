import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-errors';
import { SmsGatewayOpsReader } from '../sms-gateway/sms-gateway-ops-reader';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { JsonObject } from '../idempotency/idempotency-executor';
import { ArtifactStream, OpsIngestService } from './ops-ingest-service';
import { OpsTelemetryRepository } from './ops-telemetry-repository';

/** A phone's own report older than this is not evidence that it is idle now. */
const REPORT_FRESH_MS = 3 * 60_000;

/**
 * The SMS gateway update rule (design section 12): the gateway updates ONLY when it has stopped taking new work and has finished its current task and reported every
 * result it holds. The server checks this itself before it offers or serves the file: the phone said idle with nothing left to report, the report is fresh, and the
 * server holds no job claimed by it that is still unreported. A phone that does not report these facts is not "ready" (absence is never read as idle).
 */
@Injectable()
export class OpsGatewayUpdate {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly telemetry: OpsTelemetryRepository,
    private readonly gateways: SmsGatewayOpsReader,
    private readonly ingest: OpsIngestService,
  ) {}

  async ready(context: TransactionContext, deviceId: string, paused: boolean | null): Promise<boolean> {
    const t = (await this.telemetry.listTelemetry(context)).find((x) => x.deviceId === deviceId);
    if (t === undefined || Date.now() - t.reportedAtMs > REPORT_FRESH_MS || t.pendingReports !== 0 || t.currentTask !== 'IDLE' || paused !== true) {
      return false;
    }
    return !(await this.gateways.hasClaimedJob(context, deviceId));
  }

  /** What the heartbeat answer carries: the newer GATEWAY release (if any) and whether this phone may take it now. */
  async offer(context: TransactionContext, deviceId: string, versionCode: number | null, paused: boolean | null): Promise<JsonObject | null> {
    return this.ingest.gatewayOffer(context, versionCode, await this.ready(context, deviceId, paused));
  }

  async open(deviceId: string, releaseId: string, paused: boolean | null): Promise<ArtifactStream> {
    const ok = await this.transactions.withTransaction((context) => this.ready(context, deviceId, paused));
    if (!ok) {
      throw new AppError('OPS_UPDATE_NOT_READY');
    }
    return this.ingest.openArtifact(releaseId, ['GATEWAY']);
  }
}
