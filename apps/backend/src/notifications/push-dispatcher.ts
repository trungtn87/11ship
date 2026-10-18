import { Inject, Injectable } from '@nestjs/common';
import { TransactionManager } from '../transaction/transaction-manager';
import { RETRY_BACKOFF_CAP_MS } from './notification-constants';
import { NotificationConfig, NotificationRepository, PushJob } from './notification-repository';
import { NotificationRecipients } from './notification-recipients';
import { settingFor } from './notification-push-queue';
import { PUSH_PROVIDER, PushProvider, PushResult } from './push-provider';

const BATCH = 20;
const LEASE_MS = 60_000;
const SEND_TIMEOUT_MS = 10_000;

export interface PushRunResult {
  readonly claimed: number;
  readonly sent: number;
  readonly retried: number;
  readonly failed: number;
  readonly skipped: number;
  readonly expired: number;
}

type Decision = { readonly kind: 'SEND'; readonly sound: boolean; readonly vibrate: boolean } | { readonly kind: 'SKIP'; readonly reason: string } | { readonly kind: 'EXPIRE' };

/**
 * Sends the pending pushes (M08.02). Every attempt decides AGAIN, from the database clock and the rows as they are now: the push's own deadline, whether the
 * token and its session are still alive (a logout, a replacement or a revocation ends the link), the Administration's channel switch, the account's own
 * setting, whether the fact is still current (an offer that was taken or expired is not announced; an older fact never follows a newer one) and whether the
 * provider is configured. Attempts are bounded; a retry waits base * 2^(n-1) seconds and never beyond the push's deadline. SENT only means the provider
 * accepted the message.
 */
@Injectable()
export class PushDispatcher {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly repo: NotificationRepository,
    private readonly recipients: NotificationRecipients,
    @Inject(PUSH_PROVIDER) private readonly provider: PushProvider,
  ) {}

  async runOnce(): Promise<PushRunResult> {
    const counts = { claimed: 0, sent: 0, retried: 0, failed: 0, skipped: 0, expired: 0 };
    const { config, jobs } = await this.transactions.withTransaction(async (context) => {
      counts.expired += await this.repo.expireDuePushes(context);
      return { config: await this.repo.readConfig(context), jobs: await this.repo.claimDuePushes(context, BATCH, LEASE_MS) };
    });
    counts.claimed = jobs.length;
    for (const job of jobs) {
      const decision = await this.transactions.withTransaction((context) => this.#decide(context, config, job));
      if (decision.kind === 'EXPIRE') {
        await this.#finish(job, { kind: 'EXPIRED' });
        counts.expired += 1;
        continue;
      }
      if (decision.kind === 'SKIP') {
        await this.#finish(job, { kind: 'SKIPPED', reason: decision.reason });
        counts.skipped += 1;
        continue;
      }
      const result = await this.#send(job, decision, config);
      if (result.kind === 'SENT') {
        await this.#finish(job, { kind: 'SENT' });
        counts.sent += 1;
      } else if (result.kind === 'INVALID_TOKEN') {
        await this.transactions.withTransaction(async (context) => {
          if (job.tokenId !== null) {
            await this.repo.invalidateToken(context, job.tokenId, 'PROVIDER_REJECTED');
          }
          await this.repo.finishPush(context, job.pushId, { kind: 'SKIPPED', reason: 'TOKEN_REJECTED' });
        });
        counts.skipped += 1;
      } else if (result.kind === 'RETRYABLE') {
        const delayMs = Math.min(RETRY_BACKOFF_CAP_MS, config.retryBaseSeconds * 1000 * 2 ** (job.attemptCount - 1));
        if (job.attemptCount >= config.retryMaxAttempts) {
          await this.#finish(job, { kind: 'FAILED', code: result.code, evidence: result.evidence });
          counts.failed += 1;
        } else if (Date.now() + delayMs >= job.expiresAtMs) {
          // The retry could only happen after the push is no longer worth sending: it ends here, with the evidence of the last attempt.
          await this.#finish(job, { kind: 'FAILED', code: result.code, evidence: result.evidence });
          counts.failed += 1;
        } else {
          await this.#finish(job, { kind: 'RETRY', delayMs, code: result.code, evidence: result.evidence });
          counts.retried += 1;
        }
      } else {
        await this.#finish(job, { kind: 'FAILED', code: result.code, evidence: result.evidence });
        counts.failed += 1;
      }
    }
    return counts;
  }

  #finish(job: PushJob, outcome: Parameters<NotificationRepository['finishPush']>[2]): Promise<void> {
    return this.transactions.withTransaction((context) => this.repo.finishPush(context, job.pushId, outcome));
  }

  async #decide(context: Parameters<Parameters<TransactionManager['withTransaction']>[0]>[0], config: NotificationConfig, job: PushJob): Promise<Decision> {
    if (Date.now() >= job.expiresAtMs) {
      return { kind: 'EXPIRE' };
    }
    if (!config.pushEnabled) {
      return { kind: 'SKIP', reason: 'CHANNEL_OFF' };
    }
    if (!this.provider.configured) {
      return { kind: 'SKIP', reason: 'PROVIDER_NOT_CONFIGURED' };
    }
    if (job.tokenId === null || job.token === null || !(await this.repo.tokenUsable(context, job.tokenId))) {
      return { kind: 'SKIP', reason: 'TOKEN_ENDED' };
    }
    const n = job.notification;
    const clock = await context.query<{ now_ms: string }>(`SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint::text AS now_ms`);
    const nowMs = Number(clock.rows[0]?.now_ms ?? '0');
    if (n.validUntilMs !== null && nowMs >= n.validUntilMs) {
      return { kind: 'EXPIRE' };
    }
    if (n.kind === 'NEW_OFFERS') {
      const offer = await this.#offerStillOpen(context, job);
      if (!offer) {
        return { kind: 'SKIP', reason: 'NO_LONGER_AVAILABLE' };
      }
    }
    if (await this.repo.hasNewerFact(context, n)) {
      return { kind: 'SKIP', reason: 'STALE' };
    }
    const settings = await this.repo.readSettings(context, job.recipientUserId, job.app, config.defaultSound);
    if (!settingFor(settings, n.category)) {
      return { kind: 'SKIP', reason: 'SETTING_OFF' };
    }
    return { kind: 'SEND', sound: settings.sound, vibrate: settings.vibrate };
  }

  /** The push key of a new-offer push is `offer:<delivery>:<round>`: the delivery must still be in THAT round and open. */
  async #offerStillOpen(context: Parameters<Parameters<TransactionManager['withTransaction']>[0]>[0], job: PushJob): Promise<boolean> {
    const key = await context.query<{ push_key: string }>(`SELECT push_key FROM app.notification_pushes WHERE push_id = $1::uuid`, [job.pushId]);
    const match = /^offer:([0-9a-f-]{36}):(\d+)$/.exec(key.rows[0]?.push_key ?? '');
    if (match === null) {
      return false;
    }
    const facts = await this.recipients.deliveryOfferFacts(context, match[1] as string);
    return facts !== undefined && facts.state === 'waiting_driver' && facts.version === Number(match[2]) && facts.remainingMs > 0;
  }

  async #send(job: PushJob, decision: { sound: boolean; vibrate: boolean }, config: NotificationConfig): Promise<PushResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
    try {
      const n = job.notification;
      void config;
      return await this.provider.send(
        {
          token: job.token as string,
          title: n.title,
          body: n.body,
          notificationId: n.notificationId,
          kind: n.kind,
          targetType: n.targetType,
          targetId: n.targetId,
          sound: decision.sound,
          vibrate: decision.vibrate,
          ttlSeconds: Math.max(1, Math.floor((job.expiresAtMs - Date.now()) / 1000)),
          collapseKey: n.kind === 'NEW_OFFERS' ? 'new_offers' : n.kind === 'PICKUP_REMINDER' ? 'pickup_reminder' : null,
          highPriority: n.category !== 'WALLET_PROFILE',
        },
        controller.signal,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
