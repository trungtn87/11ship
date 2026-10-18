import { Inject, Injectable, OnApplicationBootstrap, OnApplicationShutdown, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { JsonLogger } from '../logging/json-logger';
import { APP_LOGGER } from '../logging/logging.module';
import { TransactionManager } from '../transaction/transaction-manager';
import { OPERATIONS } from './delivery-constants';
import { DeliveryRecorder } from './delivery-recorder';
import { DeliveryRepository } from './delivery-repository';
import { dueSearchReminders, pickupReminderDue, searchExpired } from './delivery-rules';

const BATCH = 50;
export const SWEEP_INTERVAL_MS = 30_000;

export interface SweepResult {
  readonly stopped: number;
  readonly searchReminders: number;
  readonly pickupReminders: number;
}

/**
 * The timers of M07, driven ONLY by the stored server times, so a restart or a second instance never resets or doubles anything:
 *  - a search that reached 30 minutes STOPS (the food order is not cancelled);
 *  - the shop is reminded once at minute 5 and once at minute 15 of a search (each mark is stored when it is sent);
 *  - a Shipper who accepted and has not picked up is reminded every 5 minutes (the last reminder is stored on the assignment).
 * Every pass re-reads the row under its lock and decides again, so a Shipper accepting at the very moment the search ends is not overtaken: whoever
 * holds the delivery row first wins, and the other finds the new state. The reminders are outbox events; notifying people is M08's job.
 */
@Injectable()
export class DeliverySweeper {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly deliveries: DeliveryRepository,
    private readonly recorder: DeliveryRecorder,
  ) {}

  async sweep(): Promise<SweepResult> {
    const stopped = await this.#stopExpired();
    const searchReminders = await this.#searchReminders();
    const pickupReminders = await this.#pickupReminders();
    return { stopped, searchReminders, pickupReminders };
  }

  async #stopExpired(): Promise<number> {
    return this.transactions.withTransaction(async (context) => {
      let count = 0;
      for (const claimed of await this.deliveries.claimExpired(context, BATCH)) {
        const after = await this.deliveries.update(context, claimed.deliveryId, claimed.version, {
          state: 'search_stopped',
          searchStoppedNow: true,
          endedNow: true,
          endReason: 'Hết thời gian tìm shipper (30 phút)',
        });
        if (after === undefined) {
          continue;
        }
        await this.recorder.record(context, { delivery: after, type: 'search_stopped', actorType: 'SYSTEM', actorId: null, operation: OPERATIONS.sweep, requestId: randomUUID(), note: 'Hết thời gian tìm shipper' });
        count += 1;
      }
      return count;
    });
  }

  async #searchReminders(): Promise<number> {
    return this.transactions.withTransaction(async (context) => {
      let count = 0;
      for (const candidate of await this.deliveries.listReminderCandidates(context, BATCH)) {
        const locked = await this.deliveries.lockById(context, candidate.deliveryId);
        if (locked === undefined || locked.state !== 'waiting_driver') {
          continue;
        }
        const nowMs = await freshClockMs(context);
        if (searchExpired(nowMs, locked.searchExpiresAtMs)) {
          continue;
        }
        let current = locked;
        for (const minute of dueSearchReminders(nowMs, locked.searchStartedAtMs, { m5: locked.reminded5AtMs !== null, m15: locked.reminded15AtMs !== null })) {
          const after = await this.deliveries.update(context, current.deliveryId, current.version, { remindedNow: minute === 5 ? 5 : 15 });
          if (after === undefined) {
            break;
          }
          current = after;
          await this.recorder.record(context, { delivery: current, type: `search_reminder_${String(minute)}`, actorType: 'SYSTEM', actorId: null, operation: OPERATIONS.sweep, requestId: randomUUID(), note: `Đã tìm ${String(minute)} phút` });
          count += 1;
        }
      }
      return count;
    });
  }

  async #pickupReminders(): Promise<number> {
    return this.transactions.withTransaction(async (context) => {
      let count = 0;
      for (const candidate of await this.deliveries.listPickupReminderCandidates(context, BATCH)) {
        // The delivery first, then its assignment: the same order every Shipper / shop / Admin path uses after the Shipper row.
        const delivery = await this.deliveries.lockById(context, candidate.deliveryId);
        const assignment = delivery === undefined ? undefined : await this.deliveries.lockActiveAssignment(context, candidate.deliveryId);
        if (delivery === undefined || assignment === undefined || assignment.pickedUpAtMs !== null || (delivery.state !== 'accepted' && delivery.state !== 'location_confirmed')) {
          continue;
        }
        if (!pickupReminderDue(await freshClockMs(context), assignment.acceptedAtMs, assignment.lastPickupReminderAtMs)) {
          continue;
        }
        if (!(await this.deliveries.touchAssignment(context, assignment.assignmentId, assignment.version, 'reminder'))) {
          continue;
        }
        await this.recorder.record(context, {
          delivery,
          type: 'pickup_reminder',
          actorType: 'SYSTEM',
          actorId: null,
          assignmentId: assignment.assignmentId,
          driverId: assignment.driverId,
          operation: OPERATIONS.sweep,
          requestId: randomUUID(),
          note: 'Nhắc shipper lấy hàng',
        });
        count += 1;
      }
      return count;
    });
  }
}

/** Runs the sweep on a fixed interval in a real environment. Not started in tests (they call `sweep()` themselves) and never overlapping itself. */
@Injectable()
export class DeliverySweeperRunner implements OnApplicationBootstrap, OnApplicationShutdown {
  #timer: ReturnType<typeof setInterval> | undefined;
  #running = false;

  constructor(
    private readonly sweeper: DeliverySweeper,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Optional() @Inject(APP_LOGGER) private readonly logger?: JsonLogger,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.appEnv === 'test') {
      return;
    }
    this.#timer = setInterval(() => void this.#tick(), SWEEP_INTERVAL_MS);
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
      this.logger?.log('error', 'delivery_sweep_failed', { error_class: error instanceof Error ? error.name : 'unknown' });
    } finally {
      this.#running = false;
    }
  }
}
