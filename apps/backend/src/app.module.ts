import { DynamicModule, Module } from '@nestjs/common';
import { AppConfig } from './config/app-config';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { JsonLogger } from './logging/json-logger';
import { LoggingModule } from './logging/logging.module';
import { TransactionModule } from './transaction/transaction.module';

export interface AppModuleOptions {
  config: AppConfig;
  logger: JsonLogger;
}

@Module({})
export class AppModule {
  // Configuration and logger are validated/created by the caller and injected. This keeps
  // tests free to build an app without mutating process.env.
  static register(options: AppModuleOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(options.config),
        LoggingModule.forRoot(options.logger),
        DatabaseModule,
        TransactionModule,
        HealthModule,
      ],
    };
  }
}
