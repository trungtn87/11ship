import { randomUUID } from 'node:crypto';
import { Inject, Injectable, OnApplicationBootstrap, OnApplicationShutdown, Optional } from '@nestjs/common';
import { safeErrorCode } from '../common/safe-error';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DEFAULT_OPS_CONFIG } from '../config/ops-config';
import { JsonLogger } from '../logging/json-logger';
import { APP_LOGGER } from '../logging/logging.module';
import { TransactionManager } from '../transaction/transaction-manager';
import { OpsCollector } from './ops-collector';
import { OpsDiscordDispatcher } from './ops-discord';
import { OpsEngine } from './ops-engine';
import { OpsRepository, RetentionResult } from './ops-repository';
import { OpsSettingsService } from './ops-settings-service';

const TICK_MS = 15_000;
const COLLECT_EVERY_MS = 60_000;
const RETENTION_EVERY_MS = 30 * 60_000;
const PURGE_BATCH = 1000;

/** Retention (design section 11): operational rows only. Business tables are never named; the audit log is never purged here (administration entries are kept at least 365 days). */
@Injectable()
export class OpsRetention {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly repo: OpsRepository,
    private readonly settings: OpsSettingsService,
  ) {}

  async runOnce(): Promise<RetentionResult> {
    return this.transactions.withTransaction(async (context) => {
      const s = (await this.settings.load(context)).settings;
      return this.repo.purge(
        context,
        {
          techDays: s['retention.tech_days'] as number,
          errorDays: s['retention.error_days'] as number,
          metricsDetailDays: s['retention.metrics_detail_days'] as number,
          metricsHourlyDays: s['retention.metrics_hourly_days'] as number,
          incidentDays: s['retention.incident_days'] as number,
          adminDays: s['retention.admin_days'] as number,
        },
        PURGE_BATCH,
      );
    });
  }
}

/**
 * The M13 worker. It runs in the API process on a short fixed tick and keeps NO deadline of its own: reminders, maintenance end, retries and snoozes are all
 * decided from database rows and the database clock (the dispatcher claims with SKIP LOCKED and a lease), so a restart or a second instance neither resets nor
 * doubles anything. Collection is about once a minute (design: heartbeat 60 s). Not started in tests, which call the same methods directly.
 */
@Injectable()
export class OpsRuntime implements OnApplicationBootstrap, OnApplicationShutdown {
  #timer: ReturnType<typeof setInterval> | undefined;
  #running = false;
  #lastCollectMs = 0;
  #lastRetentionMs = 0;
  #failures = 0;

  constructor(
    private readonly transactions: TransactionManager,
    private readonly collector: OpsCollector,
    private readonly engine: OpsEngine,
    private readonly dispatcher: OpsDiscordDispatcher,
    private readonly retention: OpsRetention,
    private readonly repo: OpsRepository,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() @Inject(APP_LOGGER) private readonly logger?: JsonLogger,
  ) {}

  onApplicationBootstrap(): void {
    if (!(this.config.ops ?? DEFAULT_OPS_CONFIG).collectorEnabled) {
      return;
    }
    this.#timer = setInterval(() => void this.tick(), TICK_MS);
    this.#timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.#timer !== undefined) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
  }

  /** Consecutive ticks that failed as a whole (0 = the last one worked). */
  get consecutiveFailures(): number {
    return this.#failures;
  }

  /** One pass of everything M13 does in the background; never overlaps itself. */
  async tick(force = false): Promise<void> {
    if (this.#running) {
      return;
    }
    this.#running = true;
    try {
      const now = Date.now();
      if (force || now - this.#lastCollectMs >= COLLECT_EVERY_MS) {
        this.#lastCollectMs = now;
        await this.collector.collectOnce();
      }
      // The collector may have found the database down; the rest needs it, and each step reports its own failure.
      await this.transactions.withTransaction((context) => this.engine.sweep(context));
      await this.#maintenanceEnded();
      await this.dispatcher.runOnce();
      if (force || now - this.#lastRetentionMs >= RETENTION_EVERY_MS) {
        this.#lastRetentionMs = now;
        await this.retention.runOnce();
      }
      this.#failures = 0;
    } catch (error) {
      this.#failures += 1;
      if (this.#failures === 1 || this.#failures % 20 === 0) {
        this.logger?.log('error', 'ops_tick_failed', { code: safeErrorCode(error), status: this.#failures });
      }
    } finally {
      this.#running = false;
    }
  }

  /** A window that ended in the last hour gets one log line ("alerts are on again"); the alerts themselves came back by the clock alone. */
  async #maintenanceEnded(): Promise<void> {
    await this.transactions.withTransaction(async (context) => {
      const windows = await context.query<{ maintenance_id: string; scopes: string[] }>(
        `SELECT maintenance_id, scopes FROM app.ops_maintenance
          WHERE cancelled_at IS NULL AND ends_at <= date_trunc('milliseconds', clock_timestamp()) AND ends_at > date_trunc('milliseconds', clock_timestamp()) - interval '1 hour'
            AND NOT EXISTS (SELECT 1 FROM app.ops_events e WHERE e.code = 'MAINTENANCE_ENDED' AND e.request_ref = maintenance_id::text)`,
      );
      for (const w of windows.rows) {
        await this.repo.insertEvent(
          context,
          { category: 'TECHNICAL', level: 'INFO', source: 'OPS', environment: this.config.appEnv, code: 'MAINTENANCE_ENDED', kind: 'MAINTENANCE', message: 'Bảo trì kết thúc: cảnh báo của phạm vi này đã bật lại', requestRef: w.maintenance_id, detail: { scopes: w.scopes } },
          randomUUID(),
        );
      }
    });
  }
}
