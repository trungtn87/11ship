import { describe, expect, it, jest } from '@jest/globals';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonLogger } from './json-logger';

const id = (n: number): string => `11111111-2222-4333-8444-${String(n).padStart(12, '0')}`;
const query = { page: 1, limit: 30 };
function emit(logger: JsonLogger, n: number, extra: Record<string, unknown> = {}): void {
  logger.log('error', 'request_failed', { request_id: id(n), status: 500, code: 'INTERNAL_ERROR',
    app: 'SHIP', module: 'M04', method: 'POST', route: '/v1/driver/wallet/topup-requests', ...extra });
}

describe('M13 bounded error journal and correlation', () => {
  it('groups after filtering; a request ID always finds exactly its own occurrence', () => {
    const logger = new JsonLogger(() => undefined);
    emit(logger, 1); emit(logger, 2);
    emit(logger, 3, { route: '/v1/driver/wallet/withdrawals' });
    emit(logger, 4, { module: 'M03' });
    const page = logger.errorEvents({ ...query, module: 'M04', level: 'error' });
    expect(page.total).toBe(2);
    const topup = page.items.find((r) => r.route?.endsWith('topup-requests'))!;
    expect(topup.count).toBe(2);
    expect(topup.occurrences.map((r) => r.request_id)).toEqual([id(2), id(1)]);
    expect(logger.errorEvents({ ...query, requestId: id(1) }).items[0]).toMatchObject({ count: 1, request_id: id(1) });
    expect(logger.errorEvents({ ...query, level: 'warn' }).total).toBe(0);
    expect(logger.errorEvents({ ...query, page: 2, limit: 1 }).items).toHaveLength(1);
    expect(logger.errorEvents({ ...query, from: Date.now() + 1000 }).total).toBe(0);
  });

  it('recovers valid lines after damage, drops sensitive fields, and persists across restart', () => {
    const dir = mkdtempSync(join(tmpdir(), 'm13-journal-'));
    try {
      const path = join(dir, 'errors.jsonl');
      writeFileSync(path, 'broken json\n' + JSON.stringify({ time: new Date().toISOString(), level: 'error', event: 'request_failed',
        request_id: id(1), status: 500, code: 'INTERNAL_ERROR', password: 'SECRET', route: '/v1/orders/:id' }) + '\n');
      const logger = new JsonLogger(() => undefined, path);
      emit(logger, 2, { sql: 'SECRET SQL', token: 'SECRET' });
      const restarted = new JsonLogger(() => undefined, path);
      expect(restarted.errorEvents(query).items.flatMap((r) => r.occurrences)).toHaveLength(2);
      expect(restarted.errorEvents(query).storage).toBe('configured-file');
      expect(readFileSync(path, 'utf8')).not.toContain('SECRET');
      expect(statSync(path).mode & 0o777).toBe(0o600);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('bounds disk, memory, rotation recovery and retention; reports storage failure honestly', () => {
    const dir = mkdtempSync(join(tmpdir(), 'm13-limits-'));
    jest.useFakeTimers({ now: new Date('2026-10-21T00:00:00Z') });
    try {
      const path = join(dir, 'errors.jsonl');
      const logger = new JsonLogger(() => undefined, path, { maxEntries: 3, maxBytes: 1024, retentionDays: 1 });
      for (let n = 1; n <= 15; n++) emit(logger, n);
      expect(statSync(path).size).toBeLessThanOrEqual(1024);
      expect(logger.errorEvents(query).items[0]?.count).toBe(3);
      expect(logger.errorEvents({ ...query, requestId: id(1) }).total).toBe(0);
      jest.setSystemTime(new Date('2026-10-23T00:00:00Z'));
      expect(logger.errorEvents(query).total).toBe(0);
      const restarted = new JsonLogger(() => undefined, path, { retentionDays: 1 });
      expect(restarted.errorEvents(query).total).toBe(0);
      expect(readFileSync(path, 'utf8')).toBe('');
      const unavailable = new JsonLogger(() => undefined, join(dir, 'missing', 'errors'));
      emit(unavailable, 50);
      expect(unavailable.errorEvents(query)).toMatchObject({ storage: 'memory-only', total: 1 });
    } finally { jest.useRealTimers(); rmSync(dir, { recursive: true, force: true }); }
  });
});
