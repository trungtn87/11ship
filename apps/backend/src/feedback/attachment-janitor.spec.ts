import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, jest } from '@jest/globals';
import { AppConfig } from '../config/app-config';
import { JsonLogger } from '../logging/json-logger';
import { orphanRetentionSeconds } from '../shared/orphan-retention';
import { TransactionManager } from '../transaction/transaction-manager';
import { AttachmentJanitor, AttachmentJanitorRuntime } from './attachment-janitor';
import { ComplaintRepository } from './complaint-repository';
import { FeedbackRecorder } from './feedback-recorder';
import { UNLINKED_ATTACHMENT_TTL_HOURS } from './feedback-constants';

// Compiled location is <root>/.test-dist/apps/backend/src/feedback, so the repository root is 5 levels up (see shared/source-scan.fixture.ts).
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const BATCH = 200;

function janitorWith(purge: jest.Mock<(...args: unknown[]) => Promise<{ count: number; bytes: number }>>, replayTtlSeconds = 900) {
  const recorder = { orphanPicturesPurged: jest.fn(async () => undefined) };
  const transactions = { withTransaction: async (fn: (context: unknown) => Promise<unknown>) => fn({}) };
  const complaints = { purgeOrphanAttachments: purge };
  const config = { idempotency: { replayTtlSeconds } } as unknown as AppConfig;
  const janitor = new AttachmentJanitor(
    transactions as unknown as TransactionManager,
    complaints as unknown as ComplaintRepository,
    recorder as unknown as FeedbackRecorder,
    config,
  );
  return { janitor, recorder, purge };
}

describe('#261 attachment janitor', () => {
  it('the TTL the janitor uses is the 24 hours the database guard enforces (a shorter janitor TTL would be refused by the database)', () => {
    const migration = readFileSync(
      path.join(REPO_ROOT, 'database', 'migrations', '1797379200000_complaint-orphan-attachment-janitor.sql'),
      'utf8',
    );
    expect(UNLINKED_ATTACHMENT_TTL_HOURS).toBe(24);
    expect(migration).toContain("IF OLD.complaint_id IS NOT NULL OR OLD.created_at > clock_timestamp() - interval '24 hours' THEN");
  });

  it('removes batches until a short batch, sums counts and bytes, and audits only the batches that removed something', async () => {
    const purge = jest
      .fn<(...args: unknown[]) => Promise<{ count: number; bytes: number }>>()
      .mockResolvedValueOnce({ count: BATCH, bytes: 1000 })
      .mockResolvedValueOnce({ count: 3, bytes: 30 });
    const { janitor, recorder } = janitorWith(purge);

    expect(await janitor.runOnce()).toEqual({ count: BATCH + 3, bytes: 1030 });
    expect(purge).toHaveBeenCalledTimes(2);
    expect(purge.mock.calls[0]?.[1]).toBe(BATCH);
    expect(recorder.orphanPicturesPurged).toHaveBeenCalledTimes(2);
  });

  it('keeps an unattached picture for the 24 hours of the TTL with the default replay window (900 s)', async () => {
    const purge = jest.fn<(...args: unknown[]) => Promise<{ count: number; bytes: number }>>().mockResolvedValue({ count: 0, bytes: 0 });
    await janitorWith(purge, 900).janitor.runOnce();
    expect(purge.mock.calls[0]?.[2]).toBe(24 * 3600);
  });

  it('keeps an unattached picture at least as long as its replay window (#316): a 7-day replay raises the retention, plus the 1 h margin', async () => {
    const purge = jest.fn<(...args: unknown[]) => Promise<{ count: number; bytes: number }>>().mockResolvedValue({ count: 0, bytes: 0 });
    const { janitor, recorder } = janitorWith(purge, 604_800);
    await janitor.runOnce();
    expect(purge.mock.calls[0]?.[2]).toBe(604_800 + 3600);
    expect(recorder.orphanPicturesPurged).not.toHaveBeenCalled();
  });

  it('the shared retention rule never goes below the minimum and adds the margin above it', () => {
    expect(orphanRetentionSeconds(900)).toBe(24 * 3600);
    expect(orphanRetentionSeconds(23 * 3600)).toBe(24 * 3600);
    expect(orphanRetentionSeconds(25 * 3600)).toBe(26 * 3600);
    expect(orphanRetentionSeconds(900, 1)).toBe(900 + 3600);
  });

  it('a run that finds nothing writes no audit row', async () => {
    const purge = jest.fn<(...args: unknown[]) => Promise<{ count: number; bytes: number }>>().mockResolvedValue({ count: 0, bytes: 0 });
    const { janitor, recorder } = janitorWith(purge);

    expect(await janitor.runOnce()).toEqual({ count: 0, bytes: 0 });
    expect(recorder.orphanPicturesPurged).not.toHaveBeenCalled();
  });

  it('the runtime tick never overlaps a run and logs only a safe error code when the run fails', async () => {
    let release: (() => void) | undefined;
    const runOnce = jest
      .fn<() => Promise<{ count: number; bytes: number }>>()
      .mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve({ count: 0, bytes: 0 }))))
      .mockRejectedValueOnce(Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' }));
    const log = jest.fn();
    const logger = { log } as unknown as JsonLogger;
    const runtime = new AttachmentJanitorRuntime({ runOnce } as unknown as AttachmentJanitor, { ops: { collectorEnabled: true } } as unknown as AppConfig, logger);

    const first = runtime.tick();
    await runtime.tick(); // still running: skipped
    expect(runOnce).toHaveBeenCalledTimes(1);
    release?.();
    await first;

    await runtime.tick(); // a later run fails: logged, not thrown
    expect(runOnce).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]).toEqual(['error', 'complaint_picture_janitor_failed', { code: expect.any(String) }]);
    expect(JSON.stringify(log.mock.calls[0])).not.toContain('connection refused');
  });
});
