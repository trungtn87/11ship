import { Inject, Injectable, OnApplicationBootstrap, OnApplicationShutdown, Optional } from '@nestjs/common';
import { safeErrorCode } from '../common/safe-error';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DEFAULT_OPS_CONFIG } from '../config/ops-config';
import { JsonLogger } from '../logging/json-logger';
import { APP_LOGGER } from '../logging/logging.module';
import { DEFAULT_CLEANUP_BATCH_SIZE, IdempotencyCleanup } from './idempotency-cleanup';

/** One pass per day (Owner OD-11, 2026-11-05). */
export const IDEMPOTENCY_CLEANUP_EVERY_MS = 24 * 60 * 60_000;
/** Bounds one tick to this many batches per phase; the rest waits for the next tick. */
export const IDEMPOTENCY_CLEANUP_MAX_BATCHES = 50;

/**
 * Runs `IdempotencyCleanup` once a day in the API process. Started only where the M13 worker/collector is
 * (never in tests, which call `tick`). The cleanup primitive stays safe under concurrent executors
 * (SKIP LOCKED, no advisory lock), and the executor's correctness does not depend on this running.
 */
@Injectable()
export class IdempotencyCleanupRuntime implements OnApplicationBootstrap, OnApplicationShutdown {
  #timer: ReturnType<typeof setInterval> | undefined;
  #running = false;

  constructor(
    private readonly cleanup: IdempotencyCleanup,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() @Inject(APP_LOGGER) private readonly logger?: JsonLogger,
  ) {}

  onApplicationBootstrap(): void {
    if (!(this.config.ops ?? DEFAULT_OPS_CONFIG).collectorEnabled) {
      return;
    }
    this.#timer = setInterval(() => void this.tick(), IDEMPOTENCY_CLEANUP_EVERY_MS);
    this.#timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.#timer !== undefined) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
  }

  async tick(): Promise<{ replayCleared: number; recordsDeleted: number } | undefined> {
    if (this.#running) {
      return undefined;
    }
    this.#running = true;
    try {
      const total = { replayCleared: 0, recordsDeleted: 0 };
      for (let batch = 0; batch < IDEMPOTENCY_CLEANUP_MAX_BATCHES; batch += 1) {
        const done = await this.cleanup.runOnce(DEFAULT_CLEANUP_BATCH_SIZE);
        total.replayCleared += done.replayCleared;
        total.recordsDeleted += done.recordsDeleted;
        if (done.replayCleared < DEFAULT_CLEANUP_BATCH_SIZE && done.recordsDeleted < DEFAULT_CLEANUP_BATCH_SIZE) {
          break;
        }
      }
      if (total.replayCleared > 0 || total.recordsDeleted > 0) {
        this.logger?.log('info', 'idempotency_cleanup_done', total);
      }
      return total;
    } catch (error) {
      this.logger?.log('error', 'idempotency_cleanup_failed', { code: safeErrorCode(error) });
      return undefined;
    } finally {
      this.#running = false;
    }
  }
}
