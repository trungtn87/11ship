import { Inject, Injectable, OnApplicationBootstrap, OnApplicationShutdown, Optional } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { JsonLogger } from '../logging/json-logger';
import { APP_LOGGER } from '../logging/logging.module';
import { AdminReportService } from './admin-report-service';

export const EXPORT_POLL_MS = 5_000;

/** Runs the queued exports one at a time on a fixed interval in a real environment. Not started in tests (they call `processNext()` themselves) and never overlapping itself. */
@Injectable()
export class ReportExportRunner implements OnApplicationBootstrap, OnApplicationShutdown {
  #timer: ReturnType<typeof setInterval> | undefined;
  #running = false;

  constructor(
    private readonly reports: AdminReportService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() @Inject(APP_LOGGER) private readonly logger?: JsonLogger,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.appEnv === 'test') {
      return;
    }
    this.#timer = setInterval(() => void this.#tick(), EXPORT_POLL_MS);
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
      while (await this.reports.processNext()) {
        // keep going while jobs are waiting
      }
    } catch (error) {
      this.logger?.log('error', 'report_export_failed', { error_class: error instanceof Error ? error.name : 'unknown' });
    } finally {
      this.#running = false;
    }
  }
}
