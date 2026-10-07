import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../database/database.constants';
import { JsonLogger } from '../logging/json-logger';
import { APP_LOGGER } from '../logging/logging.module';
import { poolClientSource } from '../transaction/pg-client-source';
import { AuditWriter } from './audit-writer';
import { StandaloneAuditRecorder } from './standalone-audit-recorder';

// Not imported by AppModule in M00-C1B: there is no production consumer yet (M01 imports it). It depends
// on the global DatabaseModule and LoggingModule only, never on TransactionModule, so there is no module
// cycle. AuditWriter is a participant and gets no pool and no manager; only the standalone recorder
// needs a connection source, because it acquires its own connection under its own 500 ms budget.
@Module({
  providers: [
    {
      provide: AuditWriter,
      useFactory: () => new AuditWriter(),
    },
    {
      provide: StandaloneAuditRecorder,
      inject: [DATABASE_POOL, AuditWriter, APP_LOGGER],
      useFactory: (pool: Pool, writer: AuditWriter, logger: JsonLogger) =>
        new StandaloneAuditRecorder(poolClientSource(pool), writer, logger),
    },
  ],
  exports: [AuditWriter, StandaloneAuditRecorder],
})
export class AuditModule {}
