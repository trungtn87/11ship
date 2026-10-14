import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { safeErrorCode } from '../common/safe-error';
import { JsonLogger } from '../logging/json-logger';
import { APP_LOGGER } from '../logging/logging.module';
import { SmsQueueService } from './sms-queue-service';

/** How often expired work is closed when no gateway is polling. Bounded work per run: one conditional UPDATE per state. */
export const SMS_SWEEP_INTERVAL_MS = 30_000;

/** A run that keeps failing is logged on the first failure and then once per this many consecutive failures (about 10 minutes). */
export const SMS_SWEEP_LOG_EVERY = 20;

/**
 * Independent cleanup of the SMS queue (review finding B2). A gateway that went offline, was paused or revoked no longer calls
 * claim, so without this the sealed OTP of a QUEUED/CLAIMED job would stay in the database past its life and the challenge would
 * never leave PENDING_DELIVERY. A timer closes such jobs: ciphertext erased, nothing resent, challenge closed (EXPIRED) or left
 * usable (UNKNOWN). One run at a time per process; a failed run is tried again at the next tick. A cleanup that keeps failing is
 * visible to the operator: a counter ([consecutiveFailures]) and sanitized log lines (fixed event names, an error class/code and
 * the failure count only: never an OTP, a phone number, SQL or an error message).
 */
@Injectable()
export class SmsQueueSweeper implements OnModuleInit, OnModuleDestroy {
  #timer: ReturnType<typeof setInterval> | undefined;
  #running = false;
  #failures = 0;

  constructor(
    private readonly queue: SmsQueueService,
    @Inject(APP_LOGGER) private readonly logger: JsonLogger,
  ) {}

  /** Consecutive failed runs; 0 when the last run succeeded. */
  get consecutiveFailures(): number {
    return this.#failures;
  }

  onModuleInit(): void {
    this.start(SMS_SWEEP_INTERVAL_MS);
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
      await this.queue.sweep();
      if (this.#failures > 0) {
        this.logger.log('info', 'sms_sweep_recovered', { status: this.#failures });
      }
      this.#failures = 0;
    } catch (error) {
      this.#failures += 1;
      if (this.#failures === 1 || this.#failures % SMS_SWEEP_LOG_EVERY === 0) {
        this.logger.log('warn', 'sms_sweep_failed', { code: safeErrorCode(error), status: this.#failures });
      }
    } finally {
      this.#running = false;
    }
  }
}
