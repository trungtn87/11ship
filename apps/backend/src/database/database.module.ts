import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { APP_LOGGER } from '../logging/logging.module';
import { JsonLogger } from '../logging/json-logger';
import { createPool } from './create-pool';
import { DATABASE_POOL } from './database.constants';
import { DatabaseService } from './database.service';

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_POOL,
      inject: [APP_CONFIG, APP_LOGGER],
      useFactory: (config: AppConfig, logger: JsonLogger) => createPool(config.database, logger),
    },
    DatabaseService,
  ],
  exports: [DATABASE_POOL, DatabaseService],
})
export class DatabaseModule {}
