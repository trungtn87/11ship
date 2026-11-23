import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { safeErrorCode } from '../common/safe-error';
import { JsonLogger } from '../logging/json-logger';
import { APP_LOGGER } from '../logging/logging.module';
import { SepayReconciliationService } from './sepay-reconciliation.service';

/** SePay recommends a reconciliation pull every 15 to 30 minutes; the webhook is the fast path, this is the net. */
export const SEPAY_RECONCILE_INTERVAL_MS = 15 * 60_000;

/**
 * Timer for the reconciliation job (M04 step 2). Each tick asks the job to run once. The job itself checks SEPAY_AUTO_TOPUP_ENABLED on every
 * tick, so the timer is idle while the switch is off and no SePay call is made. One run at a time per process. Only outcomes that need an
 * operator are logged (fixed codes, never a payload, a key, or a provider message).
 */
@Injectable()
export class SepayReconciliationSweeper implements OnModuleInit, OnModuleDestroy {
  #timer: ReturnType<typeof setInterval> | undefined;
  #running = false;

  constructor(
    private readonly job: SepayReconciliationService,
    @Inject(APP_LOGGER) private readonly logger: JsonLogger,
  ) {}

  onModuleInit(): void {
    this.start(SEPAY_RECONCILE_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    this.stop();
  }

  start(intervalMs: number): void {
    this.stop();
    this.#timer = setInterval(() => void this.runOnce(), intervalMs);
    // The timer alone must never keep the process alive.
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer !== undefined) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
  }

  async runOnce(): Promise<void> {
    if (this.#running) {
      return;
    }
    this.#running = true;
    try {
      const result = await this.job.runOnce(process.env);
      if (result.outcome !== 'OK' && result.outcome !== 'DISABLED') {
        this.logger.log('warn', 'sepay_reconcile_stopped', { code: result.outcome });
      }
    } catch (error) {
      this.logger.log('warn', 'sepay_reconcile_failed', { code: safeErrorCode(error) });
    } finally {
      this.#running = false;
    }
  }
}
