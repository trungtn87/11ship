import { Inject, Injectable, OnApplicationBootstrap, OnApplicationShutdown, Optional } from '@nestjs/common';
import { safeErrorCode } from '../common/safe-error';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DEFAULT_OPS_CONFIG } from '../config/ops-config';
import { JsonLogger } from '../logging/json-logger';
import { APP_LOGGER } from '../logging/logging.module';
import { OpsAnalyticsService } from './ops-analytics-service';
import { OpsAnomalyService } from './ops-anomaly-service';

const SNAPSHOT_EVERY_MS = 15 * 60_000;
const DETECT_EVERY_MS = 60 * 60_000;

/**
 * Two slow ticks in the API process (started only where the M13 worker is, never in tests, which call the services): the 15-minute count of Shippers who are Online
 * (counts only) and the hourly anomaly detector (idempotent; it only opens or refreshes cases for people to review).
 */
@Injectable()
export class OpsAnalyticsRuntime implements OnApplicationBootstrap, OnApplicationShutdown {
  #timers: ReturnType<typeof setInterval>[] = [];

  constructor(
    private readonly analytics: OpsAnalyticsService,
    private readonly anomalies: OpsAnomalyService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() @Inject(APP_LOGGER) private readonly logger?: JsonLogger,
  ) {}

  onApplicationBootstrap(): void {
    if (!(this.config.ops ?? DEFAULT_OPS_CONFIG).collectorEnabled) return;
    this.#timers = [setInterval(() => void this.snapshotTick(), SNAPSHOT_EVERY_MS), setInterval(() => void this.detectTick(), DETECT_EVERY_MS)];
    for (const timer of this.#timers) timer.unref();
  }

  onApplicationShutdown(): void {
    for (const timer of this.#timers) clearInterval(timer);
    this.#timers = [];
  }

  async snapshotTick(): Promise<void> {
    try {
      await this.analytics.recordOnlineSnapshot(Date.now());
    } catch (error) {
      this.logger?.log('error', 'ops_online_snapshot_failed', { code: safeErrorCode(error) });
    }
  }

  async detectTick(): Promise<void> {
    try {
      await this.anomalies.detect(Date.now());
    } catch (error) {
      this.logger?.log('error', 'ops_anomaly_detect_failed', { code: safeErrorCode(error) });
    }
  }
}
