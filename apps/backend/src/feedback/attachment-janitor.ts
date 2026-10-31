import { randomUUID } from 'node:crypto';
import { Inject, Injectable, OnApplicationBootstrap, OnApplicationShutdown, Optional } from '@nestjs/common';
import { safeErrorCode } from '../common/safe-error';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DEFAULT_OPS_CONFIG } from '../config/ops-config';
import { JsonLogger } from '../logging/json-logger';
import { APP_LOGGER } from '../logging/logging.module';
import { TransactionManager } from '../transaction/transaction-manager';
import { ComplaintRepository } from './complaint-repository';
import { FeedbackRecorder } from './feedback-recorder';

const BATCH = 200;
const MAX_BATCHES_PER_RUN = 25;
const EVERY_MS = 60 * 60_000;

/**
 * Issue #261: removes complaint pictures that were uploaded and never attached, 24 hours after the upload (Owner 2026-10-31). Only rows with `complaint_id IS NULL`
 * can go; the database guard refuses anything linked or younger, and the SQL skips rows another transaction is attaching. Batches, each its own transaction, with one
 * audit row (counts and bytes only) per batch that removed something.
 */
@Injectable()
export class AttachmentJanitor {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly complaints: ComplaintRepository,
    private readonly recorder: FeedbackRecorder,
  ) {}

  async runOnce(): Promise<{ count: number; bytes: number }> {
    const total = { count: 0, bytes: 0 };
    for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch += 1) {
      const removed = await this.transactions.withTransaction(async (context) => {
        const done = await this.complaints.purgeOrphanAttachments(context, BATCH);
        if (done.count > 0) {
          await this.recorder.orphanPicturesPurged(context, randomUUID(), done);
        }
        return done;
      });
      total.count += removed.count;
      total.bytes += removed.bytes;
      if (removed.count < BATCH) {
        break;
      }
    }
    return total;
  }
}

/** Runs the janitor on a slow tick in the API process (started only where the M13 worker is, never in tests, which call `runOnce`). */
@Injectable()
export class AttachmentJanitorRuntime implements OnApplicationBootstrap, OnApplicationShutdown {
  #timer: ReturnType<typeof setInterval> | undefined;
  #running = false;

  constructor(
    private readonly janitor: AttachmentJanitor,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() @Inject(APP_LOGGER) private readonly logger?: JsonLogger,
  ) {}

  onApplicationBootstrap(): void {
    if (!(this.config.ops ?? DEFAULT_OPS_CONFIG).collectorEnabled) {
      return;
    }
    this.#timer = setInterval(() => void this.tick(), EVERY_MS);
    this.#timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.#timer !== undefined) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
  }

  async tick(): Promise<void> {
    if (this.#running) {
      return;
    }
    this.#running = true;
    try {
      await this.janitor.runOnce();
    } catch (error) {
      this.logger?.log('error', 'complaint_picture_janitor_failed', { code: safeErrorCode(error) });
    } finally {
      this.#running = false;
    }
  }
}
