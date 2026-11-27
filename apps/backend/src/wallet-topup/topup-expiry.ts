import { randomUUID } from 'node:crypto';
import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AuditWriter } from '../audit/audit-writer';
import { safeErrorCode } from '../common/safe-error';
import { JsonLogger } from '../logging/json-logger';
import { APP_LOGGER } from '../logging/logging.module';
import { OutboxWriter } from '../outbox/outbox-writer';
import { TransactionManager } from '../transaction/transaction-manager';
import { TopupRequestRepository } from '../wallet/topup-request-repository';

/** Owner 2026-11-27: a request the Shipper never reported ends after 24 hours (Owner 2026-11-27, first 1h then 24h). Reported requests never expire. */
export const TOPUP_EXPIRY_AFTER_MINUTES = 24 * 60;
export const TOPUP_EXPIRY_INTERVAL_MS = 5 * 60_000;
const BATCH = 200;
const RESOURCE = 'wallet_topup_request';
const EVENT_CHANGED = 'wallet.topup_request.changed.v1';
const ACTION_EXPIRED = 'wallet.topup_request.expired.v1';
const ACTOR_ID = 'topup_expiry';

/** One run of the expiry job: ends the due requests in one transaction, one audit line and one event for each. Returns how many it ended. */
@Injectable()
export class TopupExpiryJob {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly requests: TopupRequestRepository,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
  ) {}

  async runOnce(): Promise<number> {
    return this.transactions.withTransaction(async (context) => {
      const ended = await this.requests.expireUnreported(context, TOPUP_EXPIRY_AFTER_MINUTES, BATCH);
      for (const row of ended) {
        await this.audit.append(context, {
          requestId: randomUUID(),
          actorType: 'SYSTEM',
          actorId: ACTOR_ID,
          action: ACTION_EXPIRED,
          resourceType: RESOURCE,
          resourceId: row.requestId,
          resourceVersion: row.version,
          outcome: 'SUCCESS',
          metadata: { change: 'expired', state: 'CANCELLED' },
        });
        await this.outbox.append(context, {
          eventType: EVENT_CHANGED,
          eventSchemaVersion: 1,
          resourceType: RESOURCE,
          resourceId: row.requestId,
          resourceVersion: row.version,
          payload: { request_id: row.requestId, state: 'CANCELLED', version: row.version },
        });
      }
      return ended.length;
    });
  }
}

/** Timer for the expiry job. One run at a time per process; a failed run is logged with a fixed code and retried by the next tick. */
@Injectable()
export class TopupExpirySweeper implements OnModuleInit, OnModuleDestroy {
  #timer: ReturnType<typeof setInterval> | undefined;
  #running = false;

  constructor(
    private readonly job: TopupExpiryJob,
    @Inject(APP_LOGGER) private readonly logger: JsonLogger,
  ) {}

  onModuleInit(): void {
    this.start(TOPUP_EXPIRY_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    this.stop();
  }

  start(intervalMs: number): void {
    this.stop();
    this.#timer = setInterval(() => void this.runOnce(), intervalMs);
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
      await this.job.runOnce();
    } catch (error) {
      this.logger.log('warn', 'topup_expiry_failed', { code: safeErrorCode(error) });
    } finally {
      this.#running = false;
    }
  }
}
