import { Inject, Injectable, OnApplicationBootstrap, OnApplicationShutdown, Optional } from '@nestjs/common';
import { safeErrorCode } from '../common/safe-error';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DEFAULT_OPS_CONFIG } from '../config/ops-config';
import { JsonLogger } from '../logging/json-logger';
import { APP_LOGGER } from '../logging/logging.module';
import { TransactionManager } from '../transaction/transaction-manager';
import { MenuRepository } from './menu-repository';

const BATCH = 200;
const MAX_BATCHES_PER_RUN = 25;
const EVERY_MS = 60 * 60_000;

/**
 * OD-2 item 4: removes dish pictures that were uploaded and never attached to a dish, 24 hours after the upload (the same rule as the
 * complaint pictures). Without it an upload whose dish save never happened would hold one of the 400 places of the shop for ever. Each
 * batch is its own transaction; only rows no menu_items row points at can go.
 */
@Injectable()
export class MenuImageJanitor {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly menu: MenuRepository,
  ) {}

  async runOnce(): Promise<{ count: number; bytes: number }> {
    const total = { count: 0, bytes: 0 };
    for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch += 1) {
      const removed = await this.transactions.withTransaction((context) => this.menu.purgeOrphanImages(context, BATCH));
      total.count += removed.count;
      total.bytes += removed.bytes;
      if (removed.count < BATCH) {
        break;
      }
    }
    return total;
  }
}

/** Runs the janitor on a slow tick in the API process (only where the M13 worker is; tests call `runOnce`). */
@Injectable()
export class MenuImageJanitorRuntime implements OnApplicationBootstrap, OnApplicationShutdown {
  #timer: ReturnType<typeof setInterval> | undefined;
  #running = false;

  constructor(
    private readonly janitor: MenuImageJanitor,
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
      const removed = await this.janitor.runOnce();
      if (removed.count > 0) {
        this.logger?.log('info', 'menu_image_janitor_purged', { count: removed.count, bytes: removed.bytes });
      }
    } catch (error) {
      this.logger?.log('error', 'menu_image_janitor_failed', { code: safeErrorCode(error) });
    } finally {
      this.#running = false;
    }
  }
}
