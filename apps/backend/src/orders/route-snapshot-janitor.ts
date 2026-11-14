import { Inject, Injectable, OnApplicationBootstrap, OnApplicationShutdown, Optional } from '@nestjs/common';
import { safeErrorCode } from '../common/safe-error';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { JsonLogger } from '../logging/json-logger';
import { APP_LOGGER } from '../logging/logging.module';
import { TransactionManager } from '../transaction/transaction-manager';
import { RouteSnapshotRepository } from './route-snapshot-repository';

// P6-2 review round 2 (D6-3, Codex MEDIUM-1): a quote's snapshot that nothing references is kept for this long, then removed. Lead to confirm the value.
export const ROUTE_SNAPSHOT_RETENTION = '7 days';
const BATCH = 200;
const MAX_BATCHES_PER_RUN = 25;
const EVERY_MS = 60 * 60_000;

/** Removes unreferenced route snapshots in batches (each batch its own transaction). The database refuses to delete a referenced one. */
@Injectable()
export class RouteSnapshotJanitor {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly snapshots: RouteSnapshotRepository,
  ) {}

  async runOnce(olderThan: string = ROUTE_SNAPSHOT_RETENTION): Promise<number> {
    let total = 0;
    for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch += 1) {
      const removed = await this.transactions.withTransaction((context) => this.snapshots.purgeUnreferenced(context, olderThan));
      total += removed;
      if (removed < BATCH) {
        break;
      }
    }
    return total;
  }
}

/** Runs the janitor on a slow tick in the API process; never in tests (they call `runOnce`). Same shape as OrderSweeperRunner. */
@Injectable()
export class RouteSnapshotJanitorRuntime implements OnApplicationBootstrap, OnApplicationShutdown {
  #timer: ReturnType<typeof setInterval> | undefined;
  #running = false;

  constructor(
    private readonly janitor: RouteSnapshotJanitor,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() @Inject(APP_LOGGER) private readonly logger?: JsonLogger,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.appEnv === 'test') {
      return;
    }
    this.#timer = setInterval(() => void this.#tick(), EVERY_MS);
    this.#timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.#timer !== undefined) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
  }

  async #tick(): Promise<void> {
    if (this.#running) {
      return;
    }
    this.#running = true;
    try {
      await this.janitor.runOnce();
    } catch (error) {
      this.logger?.log('error', 'route_snapshot_janitor_failed', { code: safeErrorCode(error) });
    } finally {
      this.#running = false;
    }
  }
}
