import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from '@jest/globals';
import { codeOf, sourcePath } from '../shared/source-scan.fixture';

// Structural facts of M00-C1C (ADR-003 §13.6, task C1 §3/§9), proven on the code with comments removed:
// module boundaries, "nothing starts by itself", and "no real broker". They complement the behavioural specs.

function productionFiles(folder: string): string[] {
  return readdirSync(sourcePath(folder))
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.fixture.ts'))
    .map((name) => `${folder}/${name}`);
}

describe('module boundaries', () => {
  it('TransactionModule and the whole transaction folder know nothing about the outbox', () => {
    for (const file of productionFiles('transaction')) {
      expect(codeOf(file)).not.toMatch(/outbox|dispatch|publisher/i);
    }
  });

  it('nothing that loads AppConfig depends on the outbox code folder: the config lives in config/', () => {
    expect(codeOf('config/app-config.ts')).toContain("from './outbox-config'");
    expect(codeOf('config/app-config.ts')).not.toMatch(/\.\.\/outbox\//);
    expect(codeOf('config/outbox-config.ts')).not.toMatch(/import /);
  });

  it('the dispatch store uses the transaction coordinator only through a structural runner interface', () => {
    const code = codeOf('outbox/outbox-dispatch-store.ts');
    expect(code).toContain('OutboxTransactionRunner');
    expect(code).not.toMatch(/TransactionManager|TransactionModule|DATABASE_POOL|from 'pg'/);
  });

  it('the dispatcher receives store, publisher and config: it injects nothing and imports no database code', () => {
    const code = codeOf('outbox/outbox-dispatcher.ts');
    expect(code).toMatch(/constructor\(\s*store: OutboxDispatchStorePort,\s*publisher: OutboxPublisher,\s*config: OutboxConfig/);
    expect(code).not.toMatch(/@Injectable|@Module|@Inject\b|from '@nestjs/);
    expect(code).not.toMatch(/transaction\/|from 'pg'/);
  });

  it('OutboxModule is unchanged by C1C: it provides the writer only, with no imports', () => {
    const code = codeOf('outbox/outbox.module.ts');
    expect(code).toContain('OutboxWriter');
    expect(code).not.toMatch(/Dispatch|Publisher|TransactionModule|imports\s*:/);
  });
});

describe('nothing starts by itself', () => {
  it('AppModule and main.ts do not wire, create or start a dispatcher', () => {
    for (const file of ['app.module.ts', 'main.ts', 'app.setup.ts']) {
      expect(codeOf(file)).not.toMatch(/Outbox|Dispatch|Publisher/);
    }
  });

  it('no outbox production file schedules work: no interval, no cron, no recursive timer, no lifecycle hook', () => {
    for (const file of productionFiles('outbox')) {
      const code = codeOf(file);
      expect(code).not.toMatch(/setInterval|@nestjs\/schedule|cron|OnModuleInit|OnApplicationBootstrap|OnModuleDestroy|beforeExit|process\.on\(/i);
    }
  });
});

describe('no real outbound system and no redrive in C1C', () => {
  it('no production outbox file references a broker, Redis, push or WebSocket client', () => {
    for (const file of productionFiles('outbox')) {
      expect(codeOf(file)).not.toMatch(/redis|kafka|rabbit|amqp|nats|mqtt|websocket|socket\.io|firebase|apns|fcm|from 'https?'|fetch\(|axios/i);
    }
  });

  it('there is no redrive command: nothing resets a DEAD event', () => {
    for (const file of productionFiles('outbox')) {
      expect(codeOf(file)).not.toMatch(/redrive|requeue|resurrect/i);
    }
    // The store never moves a row OUT of DEAD: no WHERE/AND/OR clause selects rows by status DEAD.
    expect(codeOf('outbox/outbox-dispatch-store.ts')).not.toMatch(/\b(WHERE|AND|OR)\s+(e\.)?status\s*(=|IN|<>|!=)\s*\(?\s*'DEAD'/);
  });

  it('no production code claims exactly-once delivery: the contract is at-least-once with a stable event_id', () => {
    for (const file of productionFiles('outbox')) {
      expect(codeOf(file)).not.toMatch(/exactly[\s_-]*once|exactlyOnce/i);
    }
  });

  it('the only publisher implementation in the repository is a test fixture', () => {
    const implementers = productionFiles('outbox').filter((file) => /implements\s+OutboxPublisher/.test(codeOf(file)));
    expect(implementers).toEqual([]);
    expect(codeOf('outbox/fake-outbox-publisher.fixture.ts')).toContain('implements OutboxPublisher');
  });

  it('no new migration: the only migration that touches the outbox is the C1B one', () => {
    const folder = sourcePath('../../../database/migrations');
    const touching = readdirSync(folder)
      .filter((name) => name.endsWith('.sql'))
      // Only SQL statements count: a comment such as "no outbox_events" does not make a migration touch it.
      .filter((name) =>
        /outbox/i.test(
          readFileSync(`${folder}/${name}`, 'utf8')
            .split('\n')
            .filter((line) => !line.trim().startsWith('--'))
            .join('\n'),
        ),
      )
      .sort();
    expect(touching).toEqual(['1791417600000_create-audit-outbox.sql']);
  });
});
