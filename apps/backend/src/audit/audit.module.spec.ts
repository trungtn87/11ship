import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from '@jest/globals';
import { DATABASE_POOL } from '../database/database.constants';
import { APP_LOGGER } from '../logging/logging.module';
import { codeOf } from '../shared/source-scan.fixture';
import { OutboxModule } from '../outbox/outbox.module';
import { OutboxWriter } from '../outbox/outbox-writer';
import { AuditModule } from './audit.module';
import { AuditWriter } from './audit-writer';
import { StandaloneAuditRecorder } from './standalone-audit-recorder';

// A stand-in for the global Database/Logging modules: no real pool is ever created or touched here.
@Global()
@Module({
  providers: [
    { provide: DATABASE_POOL, useValue: { connect: () => Promise.reject(new Error('unused')) } },
    { provide: APP_LOGGER, useValue: { log: () => undefined } },
  ],
  exports: [DATABASE_POOL, APP_LOGGER],
})
class FakeInfrastructureModule {}

describe('AuditModule', () => {
  it('provides and exports the writer and the standalone recorder', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [FakeInfrastructureModule, AuditModule] }).compile();
    expect(moduleRef.get(AuditWriter)).toBeInstanceOf(AuditWriter);
    expect(moduleRef.get(StandaloneAuditRecorder)).toBeInstanceOf(StandaloneAuditRecorder);
    await moduleRef.close();
  });

  it('does not import TransactionModule (no cycle) and is not wired into AppModule yet', () => {
    expect(codeOf('audit/audit.module.ts')).not.toMatch(/TransactionModule|imports\s*:/);
    expect(codeOf('app.module.ts')).not.toMatch(/AuditModule|OutboxModule/);
  });
});

describe('OutboxModule', () => {
  it('provides and exports the writer with no infrastructure at all', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [OutboxModule] }).compile();
    expect(moduleRef.get(OutboxWriter)).toBeInstanceOf(OutboxWriter);
    await moduleRef.close();
  });

  it('has no imports and does not reference TransactionModule', () => {
    expect(codeOf('outbox/outbox.module.ts')).not.toMatch(/TransactionModule|imports\s*:/);
  });
});
