import { Inject, Injectable, OnApplicationBootstrap, OnApplicationShutdown, Optional } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { JsonLogger } from '../logging/json-logger';
import { APP_LOGGER } from '../logging/logging.module';
import { OutboxDispatcher } from '../outbox/outbox-dispatcher';
import { OutboxDispatchStore } from '../outbox/outbox-dispatch-store';
import { OutboxPublisher, OutboxPublishEvent } from '../outbox/outbox-publisher';
import { TransactionManager } from '../transaction/transaction-manager';
import { NotificationEventService } from './notification-event-service';
import { NotificationRepository } from './notification-repository';
import { NotificationSignal } from './notification-signal';
import { PushDispatcher } from './push-dispatcher';
import { ReminderBatcher } from './reminder-batcher';

const TICK_MS = 2_000;
const RETENTION_EVERY_MS = 10 * 60_000;
const PURGE_BATCH = 500;
/** Bookkeeping (consumed event ids, finished reminders, offer rounds) is kept this long: far beyond any outbox redelivery. */
const BOOKKEEPING_DAYS = 35;

/** The outbox's outbound edge for M08: every event goes to the consumer; a rejection makes the outbox retry it (bounded, with backoff, then DEAD). */
class ConsumerPublisher implements OutboxPublisher {
  constructor(
    private readonly events: NotificationEventService,
    private readonly signal: NotificationSignal,
  ) {}

  async publish(event: OutboxPublishEvent): Promise<void> {
    await this.events.consume(event);
    this.signal.changed();
  }
}

/** Archive after the visible window, delete after the total window (both set by the Administration within bounds). Business rows are never touched. */
@Injectable()
export class NotificationRetention {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly repo: NotificationRepository,
  ) {}

  async runOnce(): Promise<{ archived: number; purged: number; bookkeeping: number }> {
    return this.transactions.withTransaction(async (context) => {
      const config = await this.repo.readConfig(context);
      const archived = await this.repo.archiveOlderThan(context, config.visibleDays);
      const purged = await this.repo.purgeDue(context, PURGE_BATCH);
      const bookkeeping = await this.repo.purgeBookkeeping(context, BOOKKEEPING_DAYS);
      return { archived, purged, bookkeeping };
    });
  }
}

/**
 * The M08 worker. It runs in the API process on fixed short ticks and holds NO timer state of its own: the outbox, the reminder table and the push rows
 * carry every deadline, so a restart or a second instance neither resets nor doubles anything (the claims are SKIP LOCKED / lease based). It is not started
 * in tests, which call the same methods directly. The outbox has one outbound consumer in this build: M08.
 */
@Injectable()
export class NotificationRuntime implements OnApplicationBootstrap, OnApplicationShutdown {
  readonly dispatcher: OutboxDispatcher;
  #timer: ReturnType<typeof setInterval> | undefined;
  #running = false;
  #lastRetentionMs = 0;

  constructor(
    transactions: TransactionManager,
    events: NotificationEventService,
    private readonly signal: NotificationSignal,
    private readonly pushes: PushDispatcher,
    private readonly reminders: ReminderBatcher,
    private readonly retention: NotificationRetention,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() @Inject(APP_LOGGER) private readonly logger?: JsonLogger,
  ) {
    this.dispatcher = new OutboxDispatcher(new OutboxDispatchStore(transactions, config.outbox), new ConsumerPublisher(events, signal), config.outbox, logger === undefined ? {} : { logger });
  }

  onApplicationBootstrap(): void {
    if (this.config.appEnv === 'test') {
      return;
    }
    this.#timer = setInterval(() => void this.tick(), TICK_MS);
    this.#timer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.#timer !== undefined) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
    await this.dispatcher.drain(5_000);
  }

  /** One pass of everything M08 does in the background, never overlapping itself. */
  async tick(): Promise<void> {
    if (this.#running) {
      return;
    }
    this.#running = true;
    try {
      await this.dispatcher.dispatchOnce();
      await this.reminders.runOnce();
      await this.pushes.runOnce();
      this.signal.changed();
      if (Date.now() - this.#lastRetentionMs >= RETENTION_EVERY_MS) {
        this.#lastRetentionMs = Date.now();
        await this.retention.runOnce();
      }
    } catch (error) {
      this.logger?.log('error', 'notification_tick_failed', { error_class: error instanceof Error ? error.name : 'unknown' });
    } finally {
      this.#running = false;
    }
  }
}

