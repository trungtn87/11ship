import { DynamicModule, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { NotificationsReadModule } from '../notifications/notifications-read.module';
import { TransactionModule } from '../transaction/transaction.module';
import { OpsClientController } from './ops-client.controller';
import { OpsCollector } from './ops-collector';
import { OpsCoreModule } from './ops-core.module';
import { OpsRetention, OpsRuntime } from './ops-runtime';
import { NodeSystemProbe, OPS_SYSTEM_PROBE } from './ops-system-probe';

/**
 * M13 background worker and the doors that report to it (probe / backup / deploy credentials, the apps' log batches, the update check and download).
 * `auth` must be the very same object AppModule passes to its imports (the app routes use the client session guard). The Administration routes live in
 * AdminAuthModule and use OpsCoreModule's instances, never a second worker.
 */
@Module({})
export class OpsModule {
  static register(auth: DynamicModule): DynamicModule {
    return {
      module: OpsModule,
      imports: [auth, TransactionModule, OpsCoreModule, NotificationsReadModule],
      controllers: [OpsClientController],
      providers: [
        { provide: OPS_SYSTEM_PROBE, inject: [APP_CONFIG], useFactory: (config: AppConfig) => new NodeSystemProbe({ host: config.host, port: config.port }) },
        OpsRetention,
        OpsRuntime,
        OpsCollector,
      ],
      exports: [OpsRuntime, OpsRetention],
    };
  }
}
