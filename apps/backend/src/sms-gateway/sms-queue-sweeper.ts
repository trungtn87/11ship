import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SmsQueueService } from './sms-queue-service';

/** How often expired work is closed when no gateway is polling. Bounded work per run: one conditional UPDATE per state. */
export const SMS_SWEEP_INTERVAL_MS = 30_000;

/**
 * Independent cleanup of the SMS queue (review finding B2). A gateway that went offline, was paused or revoked no longer calls
 * claim, so without this the sealed OTP of a QUEUED/CLAIMED job would stay in the database past its life and the challenge would
 * never leave PENDING_DELIVERY. A timer closes such jobs: ciphertext erased, nothing resent, challenge closed (EXPIRED) or left
 * usable (UNKNOWN). One run at a time per process; a failed run is simply tried again at the next tick and logs nothing sensitive.
 */
@Injectable()
export class SmsQueueSweeper implements OnModuleInit, OnModuleDestroy {
  #timer: ReturnType<typeof setInterval> | undefined;
  #running = false;

  constructor(private readonly queue: SmsQueueService) {}

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
    } catch {
      // Tried again at the next tick.
    } finally {
      this.#running = false;
    }
  }
}
