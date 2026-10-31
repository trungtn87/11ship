import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import {
  DEFAULT_PURGE_DAYS,
  DEFAULT_RETRY_BASE_SECONDS,
  DEFAULT_RETRY_MAX_ATTEMPTS,
  DEFAULT_VISIBLE_DAYS,
  NotificationApp,
  NotificationCategory,
  TargetType,
} from './notification-constants';

// SQL of the M08 tables (app.notifications and its siblings). Every method takes the caller's TransactionContext: none of them begins, commits or rolls
// back. Times are read as epoch milliseconds and written with the database clock; nothing here decides policy.

const CLOCK = `date_trunc('milliseconds', clock_timestamp())`;
const ms = (column: string, alias: string): string => `(extract(epoch FROM ${column}) * 1000)::bigint::text AS ${alias}`;

function num(raw: unknown): number {
  const value = typeof raw === 'string' && /^-?[0-9]{1,16}$/.test(raw) ? Number(raw) : typeof raw === 'number' ? raw : Number.NaN;
  if (!Number.isSafeInteger(value)) {
    throw new TechnicalError('internal', 'Database returned an unexpected number');
  }
  return value;
}
const numOrNull = (raw: unknown): number | null => (raw === null || raw === undefined ? null : num(raw));

// ---- row shapes ----------------------------------------------------------------------------------------------------------------

export interface NotificationConfig {
  readonly pushEnabled: boolean;
  /** Sound for an account that has not chosen yet (Administration setting). */
  readonly defaultSound: boolean;
  readonly visibleDays: number;
  readonly purgeDays: number;
  readonly retryMaxAttempts: number;
  readonly retryBaseSeconds: number;
  readonly version: number;
  readonly updatedAtMs: number | null;
}

export const DEFAULT_CONFIG: NotificationConfig = {
  pushEnabled: true,
  defaultSound: true,
  visibleDays: DEFAULT_VISIBLE_DAYS,
  purgeDays: DEFAULT_PURGE_DAYS,
  retryMaxAttempts: DEFAULT_RETRY_MAX_ATTEMPTS,
  retryBaseSeconds: DEFAULT_RETRY_BASE_SECONDS,
  version: 0,
  updatedAtMs: null,
};

export interface NotificationRow {
  readonly notificationId: string;
  readonly seq: number;
  readonly recipientUserId: string;
  readonly app: NotificationApp;
  readonly kind: string;
  readonly category: NotificationCategory;
  readonly title: string;
  readonly body: string;
  readonly targetType: TargetType;
  readonly targetId: string | null;
  readonly targetVersion: number;
  readonly dedupeKey: string;
  readonly itemCount: number;
  readonly validUntilMs: number | null;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly readAtMs: number | null;
  readonly archivedAtMs: number | null;
  readonly purgeAfterMs: number;
}

interface RawNotification {
  notification_id: string;
  seq: string;
  recipient_user_id: string;
  app: NotificationApp;
  kind: string;
  category: NotificationCategory;
  title: string;
  body: string;
  target_type: TargetType;
  target_id: string | null;
  target_version: string;
  dedupe_key: string;
  item_count: number;
  valid_until_ms: string | null;
  created_ms: string;
  updated_ms: string;
  read_ms: string | null;
  archived_ms: string | null;
  purge_ms: string;
}

const N_COLUMNS = `n.notification_id, n.seq::text AS seq, n.recipient_user_id, n.app, n.kind, n.category, n.title, n.body, n.target_type, n.target_id, n.target_version::text AS target_version,
  n.dedupe_key, n.item_count, ${ms('n.valid_until', 'valid_until_ms')}, ${ms('n.created_at', 'created_ms')}, ${ms('n.updated_at', 'updated_ms')},
  ${ms('n.read_at', 'read_ms')}, ${ms('n.archived_at', 'archived_ms')}, ${ms('n.purge_after', 'purge_ms')}`;

const toNotification = (r: RawNotification): NotificationRow => ({
  notificationId: r.notification_id,
  seq: num(r.seq),
  recipientUserId: r.recipient_user_id,
  app: r.app,
  kind: r.kind,
  category: r.category,
  title: r.title,
  body: r.body,
  targetType: r.target_type,
  targetId: r.target_id,
  targetVersion: num(r.target_version),
  dedupeKey: r.dedupe_key,
  itemCount: r.item_count,
  validUntilMs: numOrNull(r.valid_until_ms),
  createdAtMs: num(r.created_ms),
  updatedAtMs: num(r.updated_ms),
  readAtMs: numOrNull(r.read_ms),
  archivedAtMs: numOrNull(r.archived_ms),
  purgeAfterMs: num(r.purge_ms),
});

export interface NewNotification {
  readonly notificationId: string;
  readonly recipientUserId: string;
  readonly app: NotificationApp;
  readonly kind: string;
  readonly category: NotificationCategory;
  readonly title: string;
  readonly body: string;
  readonly targetType: TargetType;
  readonly targetId: string | null;
  readonly targetVersion: number;
  readonly dedupeKey: string;
  readonly sourceEventId: string | null;
  readonly validForMs: number | null;
  readonly purgeDays: number;
  /** How long ago the fact happened (the event's age): the row is dated by the fact, not by the moment it was consumed. 0 = now. */
  readonly ageMs?: number;
}

export type PushStatus = 'PENDING' | 'SENDING' | 'SENT' | 'FAILED' | 'EXPIRED' | 'SKIPPED';

export interface PushJob {
  readonly pushId: string;
  readonly notificationId: string;
  readonly recipientUserId: string;
  readonly app: NotificationApp;
  readonly tokenId: string | null;
  readonly token: string | null;
  readonly sessionId: string | null;
  readonly attemptCount: number;
  readonly expiresAtMs: number;
  readonly notification: NotificationRow;
}

export interface TokenRow {
  readonly tokenId: string;
  readonly sessionId: string;
  readonly userId: string;
  readonly app: NotificationApp;
  readonly token: string;
}

export interface SettingsRow {
  readonly orders: boolean;
  readonly reminders: boolean;
  readonly walletProfile: boolean;
  readonly available: boolean;
  readonly sound: boolean;
  readonly vibrate: boolean;
}

export const DEFAULT_SETTINGS: SettingsRow = { orders: true, reminders: true, walletProfile: true, available: true, sound: true, vibrate: true };

export interface ReminderRow {
  readonly reminderId: string;
  readonly kind: 'SEARCH_5' | 'SEARCH_15' | 'PICKUP';
  readonly recipientUserId: string;
  readonly app: NotificationApp;
  readonly deliveryId: string;
  readonly assignmentId: string | null;
  readonly dueAtMs: number;
  readonly validUntilMs: number;
}

export interface AdminNotificationQuery {
  readonly fromMs: number | null;
  readonly toMs: number | null;
  readonly kind: string | null;
  readonly userId: string | null;
  readonly code: string | null;
  readonly sendStatus: string | null;
  readonly app: NotificationApp | null;
}

export interface AdminNotificationItem extends NotificationRow {
  readonly pushStatus: string | null;
  readonly pushAttempts: number;
  readonly deliveryCode: string | null;
}

export interface PushDetailRow {
  readonly pushId: string;
  readonly status: PushStatus;
  readonly skipReason: string | null;
  readonly attemptCount: number;
  readonly lastAttemptAtMs: number | null;
  readonly sentAtMs: number | null;
  readonly lastErrorCode: string | null;
  readonly lastErrorEvidence: string | null;
  readonly expiresAtMs: number;
  readonly createdAtMs: number;
  readonly nextAttemptAtMs: number;
  readonly tokenEnded: boolean;
}

@Injectable()
export class NotificationRepository {
  // ---- configuration ---------------------------------------------------------------------------------------------------------

  async readConfig(context: TransactionContext, lock = false): Promise<NotificationConfig> {
    const result = await context.query<{
      push_enabled: boolean;
      default_sound: boolean;
      visible_days: number;
      purge_days: number;
      retry_max_attempts: number;
      retry_base_seconds: number;
      version: string;
      updated_ms: string;
    }>(
      `SELECT push_enabled, default_sound, visible_days, purge_days, retry_max_attempts, retry_base_seconds, version::text AS version, ${ms('updated_at', 'updated_ms')}
         FROM app.notification_config WHERE config_id = 1${lock ? ' FOR UPDATE' : ''}`,
    );
    const r = result.rows[0];
    if (r === undefined) {
      return DEFAULT_CONFIG;
    }
    return {
      pushEnabled: r.push_enabled,
      defaultSound: r.default_sound,
      visibleDays: r.visible_days,
      purgeDays: r.purge_days,
      retryMaxAttempts: r.retry_max_attempts,
      retryBaseSeconds: r.retry_base_seconds,
      version: num(r.version),
      updatedAtMs: num(r.updated_ms),
    };
  }

  /** Creates the single row on the first change and checks the expected version afterwards (0 = no row yet). */
  async writeConfig(context: TransactionContext, expectedVersion: number, next: Omit<NotificationConfig, 'version' | 'updatedAtMs'>, actorUserId: string): Promise<boolean> {
    if (expectedVersion === 0) {
      const inserted = await context.query(
        `INSERT INTO app.notification_config (config_id, push_enabled, default_sound, visible_days, purge_days, retry_max_attempts, retry_base_seconds, version, updated_by, updated_at)
         VALUES (1, $1, $7, $2, $3, $4, $5, 1, $6::uuid, ${CLOCK}) ON CONFLICT (config_id) DO NOTHING`,
        [next.pushEnabled, next.visibleDays, next.purgeDays, next.retryMaxAttempts, next.retryBaseSeconds, actorUserId, next.defaultSound],
      );
      return inserted.rowCount === 1;
    }
    const updated = await context.query(
      `UPDATE app.notification_config
          SET push_enabled = $1, default_sound = $8, visible_days = $2, purge_days = $3, retry_max_attempts = $4, retry_base_seconds = $5,
              version = version + 1, updated_by = $6::uuid, updated_at = ${CLOCK}
        WHERE config_id = 1 AND version = $7::bigint`,
      [next.pushEnabled, next.visibleDays, next.purgeDays, next.retryMaxAttempts, next.retryBaseSeconds, actorUserId, expectedVersion, next.defaultSound],
    );
    return updated.rowCount === 1;
  }

  // ---- tokens ----------------------------------------------------------------------------------------------------------------

  /**
   * Binds a token to the CALLING session. The same physical token still alive under another session (another account on this phone, an older login) ends as
   * REPLACED in the same statement sequence, and the session's own previous token ends as REPLACED when the token changed. Returns the token id.
   */
  async registerToken(context: TransactionContext, input: { tokenId: string; sessionId: string; userId: string; app: NotificationApp; provider: 'FCM'; token: string; digest: string }): Promise<string> {
    await context.query(
      `UPDATE app.notification_push_tokens SET invalidated_at = ${CLOCK}, invalid_reason = 'REPLACED'
        WHERE invalidated_at IS NULL AND ((token_digest = $1 AND session_id <> $2::uuid) OR (session_id = $2::uuid AND token_digest <> $1))`,
      [input.digest, input.sessionId],
    );
    const existing = await context.query<{ token_id: string }>(
      `UPDATE app.notification_push_tokens SET last_seen_at = ${CLOCK}
        WHERE session_id = $1::uuid AND token_digest = $2 AND invalidated_at IS NULL RETURNING token_id`,
      [input.sessionId, input.digest],
    );
    const kept = existing.rows[0];
    if (kept !== undefined) {
      return kept.token_id;
    }
    await context.query(
      `INSERT INTO app.notification_push_tokens (token_id, session_id, user_id, app, provider, token, token_digest, registered_at, last_seen_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, ${CLOCK}, ${CLOCK})`,
      [input.tokenId, input.sessionId, input.userId, input.app, input.provider, input.token, input.digest],
    );
    return input.tokenId;
  }

  async invalidateTokensOfSession(context: TransactionContext, sessionId: string, reason: 'UNREGISTERED' | 'PERMISSION_DENIED'): Promise<number> {
    const result = await context.query(
      `UPDATE app.notification_push_tokens SET invalidated_at = ${CLOCK}, invalid_reason = $2 WHERE session_id = $1::uuid AND invalidated_at IS NULL`,
      [sessionId, reason],
    );
    return result.rowCount ?? 0;
  }

  async invalidateToken(context: TransactionContext, tokenId: string, reason: 'PROVIDER_REJECTED' | 'SESSION_ENDED'): Promise<void> {
    await context.query(`UPDATE app.notification_push_tokens SET invalidated_at = ${CLOCK}, invalid_reason = $2 WHERE token_id = $1::uuid AND invalidated_at IS NULL`, [tokenId, reason]);
  }

  /** Live tokens of the account in this app, ONLY while their session is alive (not revoked, not expired). */
  async liveTokens(context: TransactionContext, userId: string, app: NotificationApp): Promise<TokenRow[]> {
    const result = await context.query<{ token_id: string; session_id: string; user_id: string; app: NotificationApp; token: string }>(
      `SELECT t.token_id, t.session_id, t.user_id, t.app, t.token
         FROM app.notification_push_tokens t JOIN app.sessions s ON s.session_id = t.session_id
        WHERE t.user_id = $1::uuid AND t.app = $2 AND t.invalidated_at IS NULL AND s.revoked_at IS NULL AND s.expires_at > ${CLOCK}
        ORDER BY t.registered_at DESC`,
      [userId, app],
    );
    return result.rows.map((r) => ({ tokenId: r.token_id, sessionId: r.session_id, userId: r.user_id, app: r.app, token: r.token }));
  }

  async hasLiveTokenOfSession(context: TransactionContext, sessionId: string): Promise<boolean> {
    const result = await context.query(`SELECT 1 FROM app.notification_push_tokens WHERE session_id = $1::uuid AND invalidated_at IS NULL`, [sessionId]);
    return (result.rowCount ?? 0) > 0;
  }

  // ---- events and notifications -----------------------------------------------------------------------------------------------

  /** True when this call is the first to consume the event. Same transaction as the rows it produces, so a redelivery either finds all of them or none. */
  async claimEvent(context: TransactionContext, eventId: string, eventType: string, outcome: string): Promise<boolean> {
    const result = await context.query(
      `INSERT INTO app.notification_consumed_events (event_id, event_type, consumed_at, outcome) VALUES ($1::uuid, $2, ${CLOCK}, $3) ON CONFLICT (event_id) DO NOTHING`,
      [eventId, eventType, outcome],
    );
    return result.rowCount === 1;
  }

  /** Inserts a notification, or returns the existing one for the same (recipient, app, dedupe key) with `created = false`. */
  async insertNotification(context: TransactionContext, n: NewNotification): Promise<{ notificationId: string; created: boolean }> {
    const inserted = await context.query<{ notification_id: string }>(
      `INSERT INTO app.notifications (notification_id, recipient_user_id, app, kind, category, title, body, target_type, target_id, target_version, dedupe_key, source_event_id,
                                      valid_until, created_at, updated_at, purge_after)
       SELECT $1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9::uuid, $10::bigint, $11, $12::uuid,
              CASE WHEN $13::bigint IS NULL THEN NULL ELSE c.t - ($15::bigint * interval '1 millisecond') + ($13::bigint * interval '1 millisecond') END,
              c.t - ($15::bigint * interval '1 millisecond'), c.t - ($15::bigint * interval '1 millisecond'), c.t + ($14::int * interval '1 day')
         FROM (SELECT ${CLOCK} AS t) AS c
       ON CONFLICT (recipient_user_id, app, dedupe_key) DO NOTHING
       RETURNING notification_id`,
      [n.notificationId, n.recipientUserId, n.app, n.kind, n.category, n.title, n.body, n.targetType, n.targetId, n.targetVersion, n.dedupeKey, n.sourceEventId, n.validForMs, n.purgeDays, Math.max(0, n.ageMs ?? 0)],
    );
    const row = inserted.rows[0];
    if (row !== undefined) {
      return { notificationId: row.notification_id, created: true };
    }
    const found = await context.query<{ notification_id: string }>(`SELECT notification_id FROM app.notifications WHERE recipient_user_id = $1::uuid AND app = $2 AND dedupe_key = $3`, [n.recipientUserId, n.app, n.dedupeKey]);
    const existing = found.rows[0];
    if (existing === undefined) {
      throw new TechnicalError('internal', 'Notification neither inserted nor found');
    }
    return { notificationId: existing.notification_id, created: false };
  }

  /**
   * The ONE "Có đơn giao hàng mới" card of a Shipper: it is created on the first new offer and, while it exists, only refreshed (unread again, a new sequence
   * number so a live app sees it, a later validity). It is never a per-delivery history.
   */
  async upsertCollapsedCard(context: TransactionContext, n: NewNotification): Promise<{ notificationId: string; refreshed: boolean }> {
    const updated = await context.query<{ notification_id: string }>(
      `UPDATE app.notifications
          SET read_at = NULL, archived_at = NULL, updated_at = ${CLOCK}, seq = DEFAULT, title = $4, body = $5, source_event_id = $6::uuid,
              valid_until = ${CLOCK} + ($7::bigint * interval '1 millisecond'), purge_after = ${CLOCK} + ($8::int * interval '1 day')
        WHERE recipient_user_id = $1::uuid AND app = $2 AND dedupe_key = $3
        RETURNING notification_id`,
      [n.recipientUserId, n.app, n.dedupeKey, n.title, n.body, n.sourceEventId, n.validForMs, n.purgeDays],
    );
    const hit = updated.rows[0];
    if (hit !== undefined) {
      return { notificationId: hit.notification_id, refreshed: true };
    }
    const created = await this.insertNotification(context, n);
    return { notificationId: created.notificationId, refreshed: !created.created };
  }

  async findNotification(context: TransactionContext, notificationId: string, userId: string, app: NotificationApp): Promise<NotificationRow | undefined> {
    const result = await context.query<RawNotification>(
      `SELECT ${N_COLUMNS} FROM app.notifications n WHERE n.notification_id = $1::uuid AND n.recipient_user_id = $2::uuid AND n.app = $3 AND n.archived_at IS NULL`,
      [notificationId, userId, app],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toNotification(row);
  }

  async findNotificationById(context: TransactionContext, notificationId: string): Promise<NotificationRow | undefined> {
    const result = await context.query<RawNotification>(`SELECT ${N_COLUMNS} FROM app.notifications n WHERE n.notification_id = $1::uuid`, [notificationId]);
    const row = result.rows[0];
    return row === undefined ? undefined : toNotification(row);
  }

  async list(context: TransactionContext, userId: string, app: NotificationApp, filter: 'all' | 'unread', beforeSeq: number | null, limit: number): Promise<NotificationRow[]> {
    const result = await context.query<RawNotification>(
      `SELECT ${N_COLUMNS} FROM app.notifications n
        WHERE n.recipient_user_id = $1::uuid AND n.app = $2 AND n.archived_at IS NULL
          AND ($3 = 'all' OR n.read_at IS NULL) AND ($4::bigint IS NULL OR n.seq < $4::bigint)
        ORDER BY n.seq DESC LIMIT $5`,
      [userId, app, filter, beforeSeq, limit],
    );
    return result.rows.map(toNotification);
  }

  async changesAfter(context: TransactionContext, userId: string, app: NotificationApp, afterSeq: number, limit: number): Promise<NotificationRow[]> {
    const result = await context.query<RawNotification>(
      `SELECT ${N_COLUMNS} FROM app.notifications n
        WHERE n.recipient_user_id = $1::uuid AND n.app = $2 AND n.archived_at IS NULL AND n.seq > $3::bigint
        ORDER BY n.seq LIMIT $4`,
      [userId, app, afterSeq, limit],
    );
    return result.rows.map(toNotification);
  }

  async unreadCount(context: TransactionContext, userId: string, app: NotificationApp): Promise<number> {
    const result = await context.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM app.notifications WHERE recipient_user_id = $1::uuid AND app = $2 AND read_at IS NULL AND archived_at IS NULL`,
      [userId, app],
    );
    return num(result.rows[0]?.n ?? '0');
  }

  async latestSeq(context: TransactionContext, userId: string, app: NotificationApp): Promise<number> {
    const result = await context.query<{ s: string | null }>(`SELECT max(seq)::text AS s FROM app.notifications WHERE recipient_user_id = $1::uuid AND app = $2`, [userId, app]);
    return numOrNull(result.rows[0]?.s) ?? 0;
  }

  async markRead(context: TransactionContext, userId: string, app: NotificationApp, ids: readonly string[]): Promise<number> {
    const result = await context.query(
      `UPDATE app.notifications SET read_at = ${CLOCK} WHERE recipient_user_id = $1::uuid AND app = $2 AND notification_id = ANY($3::uuid[]) AND read_at IS NULL AND archived_at IS NULL`,
      [userId, app, ids],
    );
    return result.rowCount ?? 0;
  }

  async markAllRead(context: TransactionContext, userId: string, app: NotificationApp): Promise<number> {
    const result = await context.query(`UPDATE app.notifications SET read_at = ${CLOCK} WHERE recipient_user_id = $1::uuid AND app = $2 AND read_at IS NULL AND archived_at IS NULL`, [userId, app]);
    return result.rowCount ?? 0;
  }

  /** A newer fact about the same target already exists for this recipient: an older push must not be sent. */
  async hasNewerFact(context: TransactionContext, n: NotificationRow): Promise<boolean> {
    if (n.targetId === null) {
      return false;
    }
    const result = await context.query(
      `SELECT 1 FROM app.notifications WHERE recipient_user_id = $1::uuid AND app = $2 AND target_type = $3 AND target_id = $4::uuid AND target_version > $5::bigint AND notification_id <> $6::uuid LIMIT 1`,
      [n.recipientUserId, n.app, n.targetType, n.targetId, n.targetVersion, n.notificationId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  // ---- pushes ----------------------------------------------------------------------------------------------------------------

  async insertPush(
    context: TransactionContext,
    p: { pushId: string; notificationId: string; recipientUserId: string; app: NotificationApp; tokenId: string | null; pushKey: string; expiresInMs: number; status: 'PENDING' | 'SKIPPED'; skipReason: string | null },
  ): Promise<boolean> {
    const result = await context.query(
      `INSERT INTO app.notification_pushes (push_id, notification_id, recipient_user_id, app, token_id, push_key, status, skip_reason, next_attempt_at, expires_at, created_at)
       SELECT $1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, $6, $7, $8, c.t, c.t + ($9::bigint * interval '1 millisecond'), c.t FROM (SELECT ${CLOCK} AS t) AS c
       ON CONFLICT (recipient_user_id, app, push_key) DO NOTHING`,
      [p.pushId, p.notificationId, p.recipientUserId, p.app, p.tokenId, p.pushKey, p.status, p.skipReason, p.expiresInMs],
    );
    return result.rowCount === 1;
  }

  /**
   * Claims due pushes under a lease. A row whose lease ran out (a worker died after claiming) is claimable again, so a restart neither loses nor duplicates
   * work beyond the at-least-once the provider call already has. Only rows within their own deadline are claimed; the rest are expired by `expireDue`.
   */
  async claimDuePushes(context: TransactionContext, limit: number, leaseMs: number): Promise<PushJob[]> {
    const claimed = await context.query<{ push_id: string }>(
      `UPDATE app.notification_pushes p SET status = 'SENDING', lease_until = ${CLOCK} + ($2::bigint * interval '1 millisecond'), attempt_count = p.attempt_count + 1, last_attempt_at = ${CLOCK}
        WHERE p.push_id IN (
          SELECT push_id FROM app.notification_pushes
           WHERE ((status = 'PENDING' AND next_attempt_at <= ${CLOCK}) OR (status = 'SENDING' AND lease_until <= ${CLOCK})) AND expires_at > ${CLOCK}
           ORDER BY next_attempt_at, push_id LIMIT $1 FOR UPDATE SKIP LOCKED)
        RETURNING p.push_id`,
      [limit, leaseMs],
    );
    if (claimed.rows.length === 0) {
      return [];
    }
    const result = await context.query<RawNotification & { push_id: string; token_id: string | null; token: string | null; session_id: string | null; attempt_count: number; push_expires_ms: string; push_recipient: string; push_app: NotificationApp }>(
      `SELECT ${N_COLUMNS}, p.push_id, p.token_id, t.token, t.session_id, p.attempt_count, ${ms('p.expires_at', 'push_expires_ms')}, p.recipient_user_id AS push_recipient, p.app AS push_app
         FROM app.notification_pushes p JOIN app.notifications n ON n.notification_id = p.notification_id
         LEFT JOIN app.notification_push_tokens t ON t.token_id = p.token_id
        WHERE p.push_id = ANY($1::uuid[]) ORDER BY p.next_attempt_at, p.push_id`,
      [claimed.rows.map((r) => r.push_id)],
    );
    return result.rows.map((r) => ({
      pushId: r.push_id,
      notificationId: r.notification_id,
      recipientUserId: r.push_recipient,
      app: r.push_app,
      tokenId: r.token_id,
      token: r.token,
      sessionId: r.session_id,
      attemptCount: r.attempt_count,
      expiresAtMs: num(r.push_expires_ms),
      notification: toNotification(r),
    }));
  }

  /** The token is still usable right now: live, its session neither revoked nor expired. Decided at send time, after the claim. */
  async tokenUsable(context: TransactionContext, tokenId: string): Promise<boolean> {
    const result = await context.query(
      `SELECT 1 FROM app.notification_push_tokens t JOIN app.sessions s ON s.session_id = t.session_id
        WHERE t.token_id = $1::uuid AND t.invalidated_at IS NULL AND s.revoked_at IS NULL AND s.expires_at > ${CLOCK}`,
      [tokenId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async finishPush(
    context: TransactionContext,
    pushId: string,
    outcome:
      | { kind: 'SENT' }
      | { kind: 'RETRY'; delayMs: number; code: string; evidence: string | null }
      | { kind: 'FAILED'; code: string; evidence: string | null }
      | { kind: 'EXPIRED' }
      | { kind: 'SKIPPED'; reason: string },
  ): Promise<void> {
    switch (outcome.kind) {
      case 'SENT':
        await context.query(`UPDATE app.notification_pushes SET status = 'SENT', sent_at = ${CLOCK}, lease_until = NULL, last_error_code = NULL, last_error_evidence = NULL WHERE push_id = $1::uuid AND status = 'SENDING'`, [pushId]);
        return;
      case 'RETRY':
        await context.query(
          `UPDATE app.notification_pushes SET status = 'PENDING', lease_until = NULL, next_attempt_at = ${CLOCK} + ($2::bigint * interval '1 millisecond'), last_error_code = $3, last_error_evidence = $4
            WHERE push_id = $1::uuid AND status = 'SENDING'`,
          [pushId, outcome.delayMs, outcome.code, outcome.evidence],
        );
        return;
      case 'FAILED':
        await context.query(`UPDATE app.notification_pushes SET status = 'FAILED', lease_until = NULL, last_error_code = $2, last_error_evidence = $3 WHERE push_id = $1::uuid AND status = 'SENDING'`, [pushId, outcome.code, outcome.evidence]);
        return;
      case 'EXPIRED':
        await context.query(`UPDATE app.notification_pushes SET status = 'EXPIRED', lease_until = NULL WHERE push_id = $1::uuid AND status IN ('SENDING', 'PENDING')`, [pushId]);
        return;
      case 'SKIPPED':
        await context.query(`UPDATE app.notification_pushes SET status = 'SKIPPED', skip_reason = $2, lease_until = NULL WHERE push_id = $1::uuid AND status IN ('SENDING', 'PENDING')`, [pushId, outcome.reason]);
    }
  }

  /** Pushes past their own deadline are closed as EXPIRED (never sent late), independent of how long the inbox keeps the notification. */
  async expireDuePushes(context: TransactionContext): Promise<number> {
    const result = await context.query(`UPDATE app.notification_pushes SET status = 'EXPIRED', lease_until = NULL WHERE status IN ('PENDING', 'SENDING') AND expires_at <= ${CLOCK}`);
    return result.rowCount ?? 0;
  }

  // ---- offer rounds ----------------------------------------------------------------------------------------------------------

  async recordOfferRound(context: TransactionContext, deliveryId: string, roundVersion: number, userId: string): Promise<boolean> {
    const result = await context.query(
      `INSERT INTO app.notification_offer_rounds (delivery_id, round_version, user_id, notified_at) VALUES ($1::uuid, $2::bigint, $3::uuid, ${CLOCK}) ON CONFLICT DO NOTHING`,
      [deliveryId, roundVersion, userId],
    );
    return result.rowCount === 1;
  }

  // ---- reminders -------------------------------------------------------------------------------------------------------------

  async insertReminder(
    context: TransactionContext,
    r: { reminderId: string; eventId: string; kind: 'SEARCH_5' | 'SEARCH_15' | 'PICKUP'; recipientUserId: string; app: NotificationApp; deliveryId: string; assignmentId: string | null; validForMs: number; ageMs: number },
  ): Promise<void> {
    await context.query(
      `INSERT INTO app.notification_reminders (reminder_id, event_id, kind, recipient_user_id, app, delivery_id, assignment_id, due_at, valid_until, status)
       SELECT $1::uuid, $2::uuid, $3, $4::uuid, $5, $6::uuid, $7::uuid, c.t - ($9::bigint * interval '1 millisecond'), c.t - ($9::bigint * interval '1 millisecond') + ($8::bigint * interval '1 millisecond'), 'PENDING'
         FROM (SELECT ${CLOCK} AS t) AS c
       ON CONFLICT (event_id) DO NOTHING`,
      [r.reminderId, r.eventId, r.kind, r.recipientUserId, r.app, r.deliveryId, r.assignmentId, r.validForMs, Math.max(0, r.ageMs)],
    );
  }

  /** Pending reminders whose gather window has passed, oldest first. The caller groups by recipient and kind. */
  async listDueReminders(context: TransactionContext, gatherMs: number, limit: number): Promise<ReminderRow[]> {
    const result = await context.query<{ reminder_id: string; kind: ReminderRow['kind']; recipient_user_id: string; app: NotificationApp; delivery_id: string; assignment_id: string | null; due_ms: string; valid_ms: string }>(
      `SELECT reminder_id, kind, recipient_user_id, app, delivery_id, assignment_id, ${ms('due_at', 'due_ms')}, ${ms('valid_until', 'valid_ms')}
         FROM app.notification_reminders WHERE status = 'PENDING' AND due_at <= ${CLOCK} - ($1::bigint * interval '1 millisecond')
        ORDER BY due_at, reminder_id LIMIT $2 FOR UPDATE SKIP LOCKED`,
      [gatherMs, limit],
    );
    return result.rows.map((r) => ({
      reminderId: r.reminder_id,
      kind: r.kind,
      recipientUserId: r.recipient_user_id,
      app: r.app,
      deliveryId: r.delivery_id,
      assignmentId: r.assignment_id,
      dueAtMs: num(r.due_ms),
      validUntilMs: num(r.valid_ms),
    }));
  }

  async resolveReminders(context: TransactionContext, ids: readonly string[], status: 'SENT' | 'SKIPPED_STALE' | 'SKIPPED_INVALID', notificationId: string | null): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await context.query(`UPDATE app.notification_reminders SET status = $2, resolved_at = ${CLOCK}, notification_id = $3::uuid WHERE reminder_id = ANY($1::uuid[]) AND status = 'PENDING'`, [ids, status, notificationId]);
  }

  // ---- settings --------------------------------------------------------------------------------------------------------------

  async readSettings(context: TransactionContext, userId: string, app: NotificationApp, defaultSound = true): Promise<SettingsRow> {
    const result = await context.query<{ orders: boolean; reminders: boolean; wallet_profile: boolean; available: boolean; sound: boolean; vibrate: boolean }>(
      `SELECT orders, reminders, wallet_profile, available, sound, vibrate FROM app.notification_settings WHERE user_id = $1::uuid AND app = $2`,
      [userId, app],
    );
    const r = result.rows[0];
    return r === undefined ? { ...DEFAULT_SETTINGS, sound: defaultSound } : { orders: r.orders, reminders: r.reminders, walletProfile: r.wallet_profile, available: r.available, sound: r.sound, vibrate: r.vibrate };
  }

  async writeSettings(context: TransactionContext, userId: string, app: NotificationApp, s: SettingsRow): Promise<void> {
    await context.query(
      `INSERT INTO app.notification_settings (user_id, app, orders, reminders, wallet_profile, available, sound, vibrate, updated_at)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, ${CLOCK})
       ON CONFLICT (user_id, app) DO UPDATE SET orders = EXCLUDED.orders, reminders = EXCLUDED.reminders, wallet_profile = EXCLUDED.wallet_profile,
         available = EXCLUDED.available, sound = EXCLUDED.sound, vibrate = EXCLUDED.vibrate, updated_at = EXCLUDED.updated_at`,
      [userId, app, s.orders, s.reminders, s.walletProfile, s.available, s.sound, s.vibrate],
    );
  }

  // ---- retention -------------------------------------------------------------------------------------------------------------

  /** Hides notifications older than `visibleDays`. Order, Delivery, ledger and audit rows are not touched. */
  async archiveOlderThan(context: TransactionContext, visibleDays: number): Promise<number> {
    const result = await context.query(`UPDATE app.notifications SET archived_at = ${CLOCK} WHERE archived_at IS NULL AND created_at <= ${CLOCK} - ($1::int * interval '1 day')`, [visibleDays]);
    return result.rowCount ?? 0;
  }

  /** Deletes notifications past their purge date together with their pushes and the reminder rows that point at them. Bounded per call. */
  async purgeDue(context: TransactionContext, limit: number): Promise<number> {
    const ids = await context.query<{ notification_id: string }>(`SELECT notification_id FROM app.notifications WHERE purge_after <= ${CLOCK} ORDER BY purge_after LIMIT $1 FOR UPDATE SKIP LOCKED`, [limit]);
    if (ids.rows.length === 0) {
      return 0;
    }
    const list = ids.rows.map((r) => r.notification_id);
    await context.query(`DELETE FROM app.notification_pushes WHERE notification_id = ANY($1::uuid[])`, [list]);
    await context.query(`UPDATE app.notification_reminders SET notification_id = NULL WHERE notification_id = ANY($1::uuid[])`, [list]);
    const deleted = await context.query(`DELETE FROM app.notifications WHERE notification_id = ANY($1::uuid[])`, [list]);
    return deleted.rowCount ?? 0;
  }

  async purgeBookkeeping(context: TransactionContext, olderThanDays: number): Promise<number> {
    const events = await context.query(`DELETE FROM app.notification_consumed_events WHERE consumed_at <= ${CLOCK} - ($1::int * interval '1 day')`, [olderThanDays]);
    const reminders = await context.query(`DELETE FROM app.notification_reminders WHERE status <> 'PENDING' AND resolved_at <= ${CLOCK} - ($1::int * interval '1 day')`, [olderThanDays]);
    const rounds = await context.query(`DELETE FROM app.notification_offer_rounds WHERE notified_at <= ${CLOCK} - ($1::int * interval '1 day')`, [olderThanDays]);
    return (events.rowCount ?? 0) + (reminders.rowCount ?? 0) + (rounds.rowCount ?? 0);
  }

  // ---- administration --------------------------------------------------------------------------------------------------------

  async searchForAdmin(context: TransactionContext, q: AdminNotificationQuery, page: { limit: number; offset: number }): Promise<{ rows: AdminNotificationItem[]; total: number }> {
    const where = `($1::timestamptz IS NULL OR n.created_at >= $1::timestamptz) AND ($2::timestamptz IS NULL OR n.created_at < $2::timestamptz)
      AND ($3::text IS NULL OR n.kind = $3) AND ($4::uuid IS NULL OR n.recipient_user_id = $4::uuid)
      AND ($5::text IS NULL OR EXISTS (SELECT 1 FROM app.deliveries d WHERE d.delivery_id = n.target_id AND n.target_type = 'DELIVERY' AND d.code ILIKE $5 ESCAPE '\\'))
      AND ($6::text IS NULL OR EXISTS (SELECT 1 FROM app.notification_pushes p WHERE p.notification_id = n.notification_id AND p.status = $6))
      AND ($7::text IS NULL OR n.app = $7)`;
    const args = [q.fromMs === null ? null : new Date(q.fromMs).toISOString(), q.toMs === null ? null : new Date(q.toMs).toISOString(), q.kind, q.userId, q.code === null ? null : `%${q.code.replace(/[\\%_]/g, '\\$&')}%`, q.sendStatus, q.app];
    const total = await context.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.notifications n WHERE ${where}`, args);
    const result = await context.query<RawNotification & { push_status: string | null; push_attempts: number | null; delivery_code: string | null }>(
      `SELECT ${N_COLUMNS},
              (SELECT p.status FROM app.notification_pushes p WHERE p.notification_id = n.notification_id ORDER BY p.created_at DESC LIMIT 1) AS push_status,
              (SELECT COALESCE(sum(p.attempt_count), 0)::int FROM app.notification_pushes p WHERE p.notification_id = n.notification_id) AS push_attempts,
              (SELECT d.code FROM app.deliveries d WHERE d.delivery_id = n.target_id AND n.target_type = 'DELIVERY') AS delivery_code
         FROM app.notifications n WHERE ${where} ORDER BY n.seq DESC LIMIT $8 OFFSET $9`,
      [...args, page.limit, page.offset],
    );
    return {
      total: num(total.rows[0]?.n ?? '0'),
      rows: result.rows.map((r) => ({ ...toNotification(r), pushStatus: r.push_status, pushAttempts: r.push_attempts ?? 0, deliveryCode: r.delivery_code })),
    };
  }

  async pushesOf(context: TransactionContext, notificationId: string): Promise<PushDetailRow[]> {
    const result = await context.query<{
      push_id: string;
      status: PushStatus;
      skip_reason: string | null;
      attempt_count: number;
      last_attempt_ms: string | null;
      sent_ms: string | null;
      last_error_code: string | null;
      last_error_evidence: string | null;
      expires_ms: string;
      created_ms: string;
      next_ms: string;
      token_ended: boolean;
    }>(
      `SELECT p.push_id, p.status, p.skip_reason, p.attempt_count, ${ms('p.last_attempt_at', 'last_attempt_ms')}, ${ms('p.sent_at', 'sent_ms')}, p.last_error_code, p.last_error_evidence,
              ${ms('p.expires_at', 'expires_ms')}, ${ms('p.created_at', 'created_ms')}, ${ms('p.next_attempt_at', 'next_ms')}, COALESCE(t.invalidated_at IS NOT NULL, true) AS token_ended
         FROM app.notification_pushes p LEFT JOIN app.notification_push_tokens t ON t.token_id = p.token_id
        WHERE p.notification_id = $1::uuid ORDER BY p.created_at`,
      [notificationId],
    );
    return result.rows.map((r) => ({
      pushId: r.push_id,
      status: r.status,
      skipReason: r.skip_reason,
      attemptCount: r.attempt_count,
      lastAttemptAtMs: numOrNull(r.last_attempt_ms),
      sentAtMs: numOrNull(r.sent_ms),
      lastErrorCode: r.last_error_code,
      lastErrorEvidence: r.last_error_evidence,
      expiresAtMs: num(r.expires_ms),
      createdAtMs: num(r.created_ms),
      nextAttemptAtMs: num(r.next_ms),
      tokenEnded: r.token_ended,
    }));
  }

  /** Open goods cases (a failed delivery whose goods are not settled): business events an Administration with the right must handle. Read only. */
  async openGoodsCases(context: TransactionContext, limit: number): Promise<{ deliveryId: string; code: string; shopName: string; openedAtMs: number }[]> {
    const result = await context.query<{ delivery_id: string; code: string; shop_name: string; opened_ms: string }>(
      `SELECT d.delivery_id, d.code, d.shop_name, ${ms('i.opened_at', 'opened_ms')}
         FROM app.delivery_incidents i JOIN app.deliveries d ON d.delivery_id = i.delivery_id
        WHERE i.status = 'OPEN' ORDER BY i.opened_at LIMIT $1`,
      [limit],
    );
    return result.rows.map((r) => ({ deliveryId: r.delivery_id, code: r.code, shopName: r.shop_name, openedAtMs: num(r.opened_ms) }));
  }

  async recentFailures(context: TransactionContext, limit: number): Promise<{ notificationId: string; kind: string; app: NotificationApp; status: string; code: string | null; evidence: string | null; atMs: number }[]> {
    const result = await context.query<{ notification_id: string; kind: string; app: NotificationApp; status: string; last_error_code: string | null; last_error_evidence: string | null; at_ms: string }>(
      `SELECT p.notification_id, n.kind, p.app, p.status, p.last_error_code, p.last_error_evidence, ${ms('p.created_at', 'at_ms')}
         FROM app.notification_pushes p JOIN app.notifications n ON n.notification_id = p.notification_id
        WHERE (p.status = 'FAILED' OR (p.status IN ('PENDING', 'SENDING') AND p.next_attempt_at < ${CLOCK} - interval '5 minutes' AND p.expires_at > ${CLOCK})) AND p.created_at > ${CLOCK} - interval '7 days'
        ORDER BY p.created_at DESC LIMIT $1`,
      [limit],
    );
    return result.rows.map((r) => ({ notificationId: r.notification_id, kind: r.kind, app: r.app, status: r.status, code: r.last_error_code, evidence: r.last_error_evidence, atMs: num(r.at_ms) }));
  }

  /** The work that needs a person: pushes that failed for good, pushes that are late, accounts that cannot receive pushes at all. */
  /**
   * Counters of the work queue, limited to the apps the caller may see (issue #259). Pushes and reminders carry their app; dead outbox events do not, so they
   * are counted only for a caller who sees both apps.
   */
  async workQueue(context: TransactionContext, apps: readonly string[] = ['FOOD', 'SHIP']): Promise<{ failed: number; stuck: number; skippedNoToken: number; deadOutbox: number; pendingReminders: number }> {
    const result = await context.query<{ failed: string; stuck: string; skipped: string; dead: string; reminders: string }>(
      `SELECT (SELECT count(*) FROM app.notification_pushes WHERE app = ANY($1::text[]) AND status = 'FAILED' AND created_at > ${CLOCK} - interval '7 days')::text AS failed,
              (SELECT count(*) FROM app.notification_pushes WHERE app = ANY($1::text[]) AND status IN ('PENDING', 'SENDING') AND next_attempt_at < ${CLOCK} - interval '5 minutes' AND expires_at > ${CLOCK})::text AS stuck,
              (SELECT count(*) FROM app.notification_pushes WHERE app = ANY($1::text[]) AND status = 'SKIPPED' AND skip_reason = 'NO_TOKEN' AND created_at > ${CLOCK} - interval '7 days')::text AS skipped,
              (SELECT count(*) FROM app.outbox_events WHERE cardinality($1::text[]) = 2 AND status = 'DEAD' AND event_type IN ('delivery.changed.v1', 'wallet.topup_request.changed.v1', 'driver.state_changed.v1'))::text AS dead,
              (SELECT count(*) FROM app.notification_reminders WHERE app = ANY($1::text[]) AND status = 'PENDING' AND due_at < ${CLOCK} - interval '2 minutes')::text AS reminders`,
      [apps],
    );
    const r = result.rows[0];
    return { failed: num(r?.failed ?? '0'), stuck: num(r?.stuck ?? '0'), skippedNoToken: num(r?.skipped ?? '0'), deadOutbox: num(r?.dead ?? '0'), pendingReminders: num(r?.reminders ?? '0') };
  }
}
