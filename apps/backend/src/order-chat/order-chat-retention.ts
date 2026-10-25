import { Inject, Injectable, OnApplicationBootstrap, OnApplicationShutdown, Optional } from '@nestjs/common';
import { safeErrorCode } from '../common/safe-error';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DEFAULT_OPS_CONFIG } from '../config/ops-config';
import { JsonLogger } from '../logging/json-logger';
import { APP_LOGGER } from '../logging/logging.module';
import { OpsSettingsService } from '../ops/ops-settings-service';
import { TransactionManager } from '../transaction/transaction-manager';
import { OrderChatRepository } from './order-chat-repository';

const PURGE_BATCH = 500;
const MAX_BATCHES_PER_RUN = 20;
const EVERY_MS = 30 * 60_000;

/**
 * Deletes the typed messages of rooms whose retention ran out (`chat.retention_days`, set by SYSTEM, default 7), counted from the closing of the WHOLE file
 * and held while a complaint about it is open. Batches, each its own transaction, so a restart loses nothing and a long backlog does not lock the table. The read
 * path never returns an expired room's content either, so a restored backup cannot serve what this job removed before the next run. Order / delivery events and
 * the audit are not touched.
 */
@Injectable()
export class OrderChatRetention {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly repo: OrderChatRepository,
    private readonly settings: OpsSettingsService,
  ) {}

  async runOnce(): Promise<number> {
    let total = 0;
    for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch += 1) {
      const removed = await this.transactions.withTransaction(async (context) => {
        const days = (await this.settings.load(context)).settings['chat.retention_days'] as number;
        return this.repo.purgeExpired(context, days, PURGE_BATCH);
      });
      total += removed;
      if (removed < PURGE_BATCH) {
        break;
      }
    }
    return total;
  }
}

/** Runs the purge on a slow tick in the API process (started only where the M13 worker is, never in tests, which call `runOnce`). */
@Injectable()
export class OrderChatRuntime implements OnApplicationBootstrap, OnApplicationShutdown {
  #timer: ReturnType<typeof setInterval> | undefined;
  #running = false;

  constructor(
    private readonly retention: OrderChatRetention,
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
      await this.retention.runOnce();
    } catch (error) {
      this.logger?.log('error', 'order_chat_retention_failed', { code: safeErrorCode(error) });
    } finally {
      this.#running = false;
    }
  }
}
