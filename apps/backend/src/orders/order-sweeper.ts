import { randomUUID } from 'node:crypto';
import { Inject, Injectable, OnApplicationBootstrap, OnApplicationShutdown, Optional } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { JsonLogger } from '../logging/json-logger';
import { APP_LOGGER } from '../logging/logging.module';
import { TransactionManager } from '../transaction/transaction-manager';
import { ORDER_OPERATIONS, SCHEDULE_REMINDER_GRACE_MS, SCHEDULE_REMINDER_LEAD_MS } from './order-constants';
import { OrderRecorder } from './order-recorder';
import { OrderRepository } from './order-repository';

const BATCH = 50;
export const ORDER_SWEEP_INTERVAL_MS = 30_000;

/**
 * The reminder of M10 for scheduled Orders, driven ONLY by the stored server times (a restart or a second instance never resets or doubles it): once, shortly
 * before the wanted time, the shop is reminded to prepare and call a Shipper. It does NOT call a Shipper itself and never cancels or changes the Order. A
 * reminder that finds the wanted time long past is recorded as skipped instead of being sent late. The reminder reaches the shop through the outbox (M08).
 */
@Injectable()
export class OrderSweeper {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly orders: OrderRepository,
    private readonly recorder: OrderRecorder,
  ) {}

  async sweep(): Promise<{ reminded: number; skipped: number }> {
    return this.transactions.withTransaction(async (context) => {
      let reminded = 0;
      let skipped = 0;
      for (const candidate of await this.orders.claimScheduleReminders(context, SCHEDULE_REMINDER_LEAD_MS, BATCH)) {
        const nowMs = await freshClockMs(context);
        const late = candidate.scheduledForMs !== null && nowMs > candidate.scheduledForMs + SCHEDULE_REMINDER_GRACE_MS;
        const after = await this.orders.update(context, candidate.orderId, candidate.version, { scheduleRemindedNow: true });
        if (after === undefined) {
          continue;
        }
        await this.recorder.record(context, {
          order: after,
          type: late ? 'schedule_reminder_skipped' : 'schedule_reminder',
          actorType: 'SYSTEM',
          actorId: null,
          operation: ORDER_OPERATIONS.scheduleReminder,
          requestId: randomUUID(),
          note: late ? 'Quá giờ hẹn, bỏ nhắc' : 'Sắp đến giờ hẹn',
          notify: !late,
        });
        if (late) {
          skipped += 1;
        } else {
          reminded += 1;
        }
      }
      return { reminded, skipped };
    });
  }
}

/** Runs the sweep on a fixed interval in a real environment. Not started in tests (they call `sweep()` themselves) and never overlapping itself. */
@Injectable()
export class OrderSweeperRunner implements OnApplicationBootstrap, OnApplicationShutdown {
  #timer: ReturnType<typeof setInterval> | undefined;
  #running = false;

  constructor(
    private readonly sweeper: OrderSweeper,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() @Inject(APP_LOGGER) private readonly logger?: JsonLogger,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.appEnv === 'test') {
      return;
    }
    this.#timer = setInterval(() => void this.#tick(), ORDER_SWEEP_INTERVAL_MS);
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
      await this.sweeper.sweep();
    } catch (error) {
      this.logger?.log('error', 'order_sweep_failed', { error_class: error instanceof Error ? error.name : 'unknown' });
    } finally {
      this.#running = false;
    }
  }
}
