import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AuthPrincipal } from '../auth/auth-principal';
import { ClientActor, ClientSessionAuthority } from '../client-auth/client-session-authority';
import { AppError } from '../common/app-errors';
import { JsonObject } from '../idempotency/idempotency-executor';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { NotificationApp } from './notification-constants';
import { NotificationRecipients } from './notification-recipients';
import { NotificationRepository, NotificationRow, SettingsRow } from './notification-repository';
import { NotificationSignal } from './notification-signal';
import { InboxQuery, TokenBody } from './notification-validation';
import { PUSH_PROVIDER, PushProvider } from './push-provider';

const POLL_STEP_MS = 5_000;
const CHANGES_LIMIT = 100;

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

/** Which list a DELIVERY_LIST notification opens: the kind decides (new offers: the offers; a reminder: the account's own active deliveries). */
const listOf = (kind: string): 'OFFERS' | 'ACTIVE' => (kind === 'NEW_OFFERS' ? 'OFFERS' : 'ACTIVE');

function view(n: NotificationRow, nowMs: number): JsonObject {
  return {
    notification_id: n.notificationId,
    seq: n.seq,
    kind: n.kind,
    category: n.category,
    title: n.title,
    body: n.body,
    target: { type: n.targetType, id: n.targetId, ...(n.targetType === 'DELIVERY_LIST' ? { list: listOf(n.kind) } : {}) },
    created_at: iso(n.createdAtMs),
    updated_at: iso(n.updatedAtMs),
    read: n.readAtMs !== null,
    /** True once the fact is no longer actionable (a new-offer card whose search closed, a reminder past its window). The row stays as history. */
    expired: n.validUntilMs !== null && nowMs >= n.validUntilMs,
  };
}

/**
 * What the apps read and do with their own notifications (M08.03 / .05 / .01). Every call re-authorizes the session under the user and session locks first
 * (a revoked, replaced or expired session is refused before anything is read), and every row is scoped to (account, app of THAT session): the account that
 * used the phone before, or the other app of the same phone, never sees these rows. Opening a notification re-checks the CURRENT right to its target and
 * says what is true now; the app then loads the object from its own endpoints, which decide again.
 */
@Injectable()
export class NotificationInboxService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly authority: ClientSessionAuthority,
    private readonly repo: NotificationRepository,
    private readonly recipients: NotificationRecipients,
    private readonly signal: NotificationSignal,
    @Inject(PUSH_PROVIDER) private readonly provider: PushProvider,
  ) {}

  async list(principal: AuthPrincipal, query: InboxQuery): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const actor = await this.authority.lock(context, principal, 'share');
      const nowMs = await freshClockMs(context);
      const rows = await this.repo.list(context, actor.userId, actor.app, query.filter, query.beforeSeq, query.limit + 1);
      const page = rows.slice(0, query.limit);
      return {
        items: page.map((n) => view(n, nowMs)),
        next_before: rows.length > query.limit ? (page[page.length - 1]?.seq ?? null) : null,
        unread_count: await this.repo.unreadCount(context, actor.userId, actor.app),
        latest_seq: await this.repo.latestSeq(context, actor.userId, actor.app),
        server_now: new Date(nowMs).toISOString(),
      };
    });
  }

  /** Live sync (long poll): everything newer than `after`, waiting up to `waitSeconds` for the first one. The session is re-checked on every round. */
  async changes(principal: AuthPrincipal, afterSeq: number, waitSeconds: number, abort: AbortSignal): Promise<JsonObject> {
    const deadline = Date.now() + waitSeconds * 1000;
    for (;;) {
      const result = await this.transactions.withTransaction(async (context) => {
        const actor = await this.authority.lock(context, principal, 'share');
        const nowMs = await freshClockMs(context);
        const rows = await this.repo.changesAfter(context, actor.userId, actor.app, afterSeq, CHANGES_LIMIT);
        return {
          rows,
          body: {
            items: rows.map((n) => view(n, nowMs)),
            unread_count: await this.repo.unreadCount(context, actor.userId, actor.app),
            latest_seq: rows.length === 0 ? await this.repo.latestSeq(context, actor.userId, actor.app) : (rows[rows.length - 1] as NotificationRow).seq,
            server_now: new Date(nowMs).toISOString(),
          } satisfies JsonObject,
        };
      });
      const remaining = deadline - Date.now();
      if (result.rows.length > 0 || remaining <= 0 || abort.aborted) {
        return result.body;
      }
      await this.signal.wait(Math.min(POLL_STEP_MS, remaining), abort);
    }
  }

  async unread(principal: AuthPrincipal): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const actor = await this.authority.lock(context, principal, 'share');
      return { unread_count: await this.repo.unreadCount(context, actor.userId, actor.app) };
    });
  }

  async markRead(principal: AuthPrincipal, ids: readonly string[] | 'ALL'): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const actor = await this.authority.lock(context, principal, 'share');
      const changed = ids === 'ALL' ? await this.repo.markAllRead(context, actor.userId, actor.app) : await this.repo.markRead(context, actor.userId, actor.app, ids);
      return { changed, unread_count: await this.repo.unreadCount(context, actor.userId, actor.app) };
    });
  }

  /**
   * Opening from the inbox marks it read (a push merely shown on the status bar is NOT a read) and answers what the current rights and state allow:
   * OK (open it), ENDED (open it as history), NO_ACCESS (the right is gone: nothing about the object is returned) .
   */
  async open(principal: AuthPrincipal, notificationId: string): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const actor = await this.authority.lock(context, principal, 'share');
      const n = await this.repo.findNotification(context, notificationId, actor.userId, actor.app);
      if (n === undefined) {
        throw new AppError('NOTIFICATION_NOT_FOUND');
      }
      await this.repo.markRead(context, actor.userId, actor.app, [n.notificationId]);
      const outcome = await this.#access(context, actor, n);
      const nowMs = await freshClockMs(context);
      return {
        notification_id: n.notificationId,
        outcome: outcome.kind,
        target: outcome.kind === 'NO_ACCESS' ? null : { type: n.targetType, id: n.targetId, ...(n.targetType === 'DELIVERY_LIST' ? { list: listOf(n.kind) } : {}) },
        delivery_state: outcome.kind === 'NO_ACCESS' ? null : outcome.state,
        expired: n.validUntilMs !== null && nowMs >= n.validUntilMs,
        server_now: new Date(nowMs).toISOString(),
      };
    });
  }

  async #access(context: TransactionContext, actor: ClientActor, n: NotificationRow): Promise<{ kind: 'OK' | 'ENDED' | 'NO_ACCESS'; state: string | null }> {
    const wantedRole = actor.app === 'SHIP' ? 'DRIVER' : 'SHOP';
    const roleOk = n.targetType === 'PROFILE' || actor.storedActiveRole === wantedRole;
    if (!roleOk) {
      return { kind: 'NO_ACCESS', state: null };
    }
    switch (n.targetType) {
      case 'DELIVERY': {
        const facts = n.targetId === null ? undefined : await this.recipients.deliveryAccessFor(context, n.targetId, actor.userId, actor.app);
        if (facts === undefined || !facts.exists || !facts.access) {
          return { kind: 'NO_ACCESS', state: null };
        }
        return { kind: facts.ended ? 'ENDED' : 'OK', state: facts.state };
      }
      case 'WALLET_TXN': {
        const owner = n.targetId === null ? undefined : await this.recipients.topupOwner(context, n.targetId);
        return owner === actor.userId ? { kind: 'ENDED', state: null } : { kind: 'NO_ACCESS', state: null };
      }
      default:
        return { kind: 'OK', state: null };
    }
  }

  // ---- settings ---------------------------------------------------------------------------------------------------------------

  async settings(principal: AuthPrincipal): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const actor = await this.authority.lock(context, principal, 'share');
      return this.#settingsView(context, actor.userId, actor.app);
    });
  }

  async updateSettings(principal: AuthPrincipal, change: (current: SettingsRow) => SettingsRow): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const actor = await this.authority.lock(context, principal, 'update');
      const config = await this.repo.readConfig(context);
      const next = change(await this.repo.readSettings(context, actor.userId, actor.app, config.defaultSound));
      // Only the Shipper app has the "Đơn có thể nhận" group; the Food app keeps it on and unchanged.
      await this.repo.writeSettings(context, actor.userId, actor.app, actor.app === 'SHIP' ? next : { ...next, available: true });
      return this.#settingsView(context, actor.userId, actor.app);
    });
  }

  async #settingsView(context: TransactionContext, userId: string, app: NotificationApp): Promise<JsonObject> {
    const config = await this.repo.readConfig(context);
    const s = await this.repo.readSettings(context, userId, app, config.defaultSound);
    return {
      orders: s.orders,
      reminders: s.reminders,
      wallet_profile: s.walletProfile,
      ...(app === 'SHIP' ? { available: s.available } : {}),
      sound: s.sound,
      vibrate: s.vibrate,
      // Honest availability: false means no push can leave this server right now (provider not configured, or switched off by the Administration).
      push_available: this.provider.configured && config.pushEnabled,
    };
  }

  // ---- push token -------------------------------------------------------------------------------------------------------------

  /** Binds (or ends) the push token of THIS session. A token that was bound to another session/account is taken over here and ends there. */
  async token(principal: AuthPrincipal, body: TokenBody): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const actor = await this.authority.lock(context, principal, 'update');
      if (body.kind === 'DENIED') {
        await this.repo.invalidateTokensOfSession(context, actor.sessionId, 'PERMISSION_DENIED');
        return { registered: false };
      }
      await this.repo.registerToken(context, {
        tokenId: randomUUID(),
        sessionId: actor.sessionId,
        userId: actor.userId,
        app: actor.app,
        provider: 'FCM',
        token: body.token,
        digest: createHash('sha256').update(body.token).digest('hex'),
      });
      return { registered: true };
    });
  }

  async unregister(principal: AuthPrincipal): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const actor = await this.authority.lock(context, principal, 'update');
      await this.repo.invalidateTokensOfSession(context, actor.sessionId, 'UNREGISTERED');
      return { registered: false };
    });
  }
}
