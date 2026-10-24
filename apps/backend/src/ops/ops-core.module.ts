import { Module } from '@nestjs/common';
import { SmsGatewayOpsReader } from '../sms-gateway/sms-gateway-ops-reader';
import { TransactionModule } from '../transaction/transaction.module';
import { FetchDiscordClient, OPS_DISCORD_CLIENT, OpsDiscordDispatcher } from './ops-discord';
import { OpsEngine } from './ops-engine';
import { OpsGatewayUpdate } from './ops-gateway-update';
import { OpsIncidentRepository } from './ops-incident-repository';
import { OpsIngestService } from './ops-ingest-service';
import { OpsReleaseRepository } from './ops-release-repository';
import { OpsRepository } from './ops-repository';
import { OpsSettingsService } from './ops-settings-service';
import { OpsTelemetryRepository } from './ops-telemetry-repository';

/**
 * M13's own SQL, engine, Discord sender and ingest. It imports only the transaction layer, so the Administration, the worker and the SMS gateway use the SAME
 * instances (one engine, one sender) without a cycle. The Discord client is the real HTTPS one; tests bind a mock to OPS_DISCORD_CLIENT.
 */
@Module({
  imports: [TransactionModule],
  providers: [
    OpsRepository,
    OpsIncidentRepository,
    OpsReleaseRepository,
    OpsTelemetryRepository,
    SmsGatewayOpsReader,
    OpsSettingsService,
    OpsEngine,
    { provide: OPS_DISCORD_CLIENT, useFactory: () => new FetchDiscordClient() },
    OpsDiscordDispatcher,
    OpsIngestService,
    OpsGatewayUpdate,
  ],
  exports: [OpsRepository, OpsIncidentRepository, OpsReleaseRepository, OpsTelemetryRepository, SmsGatewayOpsReader, OpsSettingsService, OpsEngine, OPS_DISCORD_CLIENT, OpsDiscordDispatcher, OpsIngestService, OpsGatewayUpdate],
})
export class OpsCoreModule {}
