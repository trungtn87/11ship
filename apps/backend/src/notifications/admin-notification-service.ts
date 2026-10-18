import { Inject, Injectable } from '@nestjs/common';
import { AdminAccountReadRepository } from '../admin-accounts/admin-account-read-repository';
import { SessionLookup } from '../admin-auth/admin-session-repository';
import { PROVISIONING_SCOPE_TYPE } from '../admin-provisioning/admin-provisioning-constants';
import { setBusinessLockTimeout } from '../admin-provisioning/admin-provisioning-locks';
import { AdminSystemActor, LockedActor } from '../admin-provisioning/admin-system-actor';
import { AuditWriter } from '../audit/audit-writer';
import { AppError } from '../common/app-errors';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { IdempotencyExecutor, IdempotentOutcome, JsonObject } from '../idempotency/idempotency-executor';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { assertParameterAccess } from '../system-settings/system-parameter-access';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { ConfigBody } from './admin-notification-validation';
import { DISPLAYED_TIMERS, NotificationApp } from './notification-constants';
import { NotificationConfig, NotificationRepository, PushDetailRow } from './notification-repository';
import { PUSH_PROVIDER, PushProvider } from './push-provider';

const OPERATION = 'admin.notification_config.update.v1';
const RESOURCE = 'notification_config';
const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

/** Why a push was not sent, in words an operator can act on. Only what the row itself proves; nothing is inferred about the phone or its network. */
const SKIP_TEXT: Readonly<Record<string, string>> = {
  NO_TOKEN: 'Tài khoản chưa có thiết bị nhận thông báo đẩy',
  TOKEN_ENDED: 'Phiên đăng nhập của thiết bị đã kết thúc',
  TOKEN_REJECTED: 'Dịch vụ đẩy báo mã thiết bị không còn hợp lệ',
  SETTING_OFF: 'Người dùng đã tắt nhóm thông báo này',
  CHANNEL_OFF: 'Kênh đẩy đang tắt trong cấu hình',
  PROVIDER_NOT_CONFIGURED: 'Máy chủ chưa cấu hình dịch vụ đẩy thông báo',
  NO_LONGER_AVAILABLE: 'Đơn không còn có thể nhận',
  STALE: 'Đã có thông tin mới hơn về cùng đối tượng',
  STALE_EVENT: 'Sự kiện đã quá cũ khi được xử lý nên không gửi đẩy nữa',
};

interface Rights {
  readonly role: 'SYSTEM' | 'ADMIN';
  readonly apps: readonly NotificationApp[];
  readonly write: boolean;
}

function pushView(p: PushDetailRow): JsonObject {
  return {
    push_id: p.pushId,
    channel: 'PUSH',
    status: p.status,
    skip_reason: p.skipReason,
    reason_text: p.skipReason === null ? null : (SKIP_TEXT[p.skipReason] ?? null),
    attempt_count: p.attemptCount,
    last_attempt_at: iso(p.lastAttemptAtMs),
    sent_at: iso(p.sentAtMs),
    last_error_code: p.lastErrorCode,
    last_error_evidence: p.lastErrorEvidence,
    created_at: iso(p.createdAtMs),
    next_attempt_at: p.status === 'PENDING' ? iso(p.nextAttemptAtMs) : null,
    expires_at: iso(p.expiresAtMs),
    device_link_ended: p.tokenEnded,
  };
}

function configView(c: NotificationConfig, providerConfigured: boolean): JsonObject {
  return {
    version: c.version,
    push_enabled: c.pushEnabled,
    default_sound: c.defaultSound,
    visible_days: c.visibleDays,
    purge_days: c.purgeDays,
    retry_max_attempts: c.retryMaxAttempts,
    retry_base_seconds: c.retryBaseSeconds,
    updated_at: iso(c.updatedAtMs),
    provider_configured: providerConfigured,
    // The business timers belong to M07 and are only displayed (read-only).
    timers: { shop_reminder_minutes: [...DISPLAYED_TIMERS.shop_reminder_minutes], search_stop_minutes: DISPLAYED_TIMERS.search_stop_minutes, pickup_reminder_minutes: DISPLAYED_TIMERS.pickup_reminder_minutes },
  };
}

/**
 * Notification administration (M08.06): the work queue, the search, the detail of one notification with every push attempt, and the settings. SYSTEM sees
 * everything; an ADMIN sees what its CURRENT permission rows give VIEW on (DRIVER -> the Shipper app, SHOP -> the Food app) and never changes settings. There
 * is no route that sends, resends or broadcasts: nothing here can create a notification. A failure is shown only with the evidence the row holds.
 */
@Injectable()
export class AdminNotificationService {
  readonly #lockTimeoutMs: number;

  constructor(
    private readonly transactions: TransactionManager,
    private readonly executor: IdempotencyExecutor,
    private readonly actor: AdminSystemActor,
    private readonly permissions: AdminAccountReadRepository,
    private readonly repo: NotificationRepository,
    private readonly audit: AuditWriter,
    @Inject(PUSH_PROVIDER) private readonly provider: PushProvider,
    @Inject(APP_CONFIG) appConfig: AppConfig,
  ) {
    this.#lockTimeoutMs = appConfig.idempotency.businessLockTimeoutMs;
  }

  async workQueue(token: string | undefined): Promise<JsonObject> {
    const known = await this.actor.precheck(token, { required: false });
    return this.transactions.withTransaction(async (context) => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      const rights = await this.#rights(context, known);
      const counts = await this.repo.workQueue(context);
      const failures = await this.repo.recentFailures(context, 30);
      const cases = await this.repo.openGoodsCases(context, 30);
      return {
        counters: { failed_pushes: counts.failed, late_pushes: counts.stuck, no_device: counts.skippedNoToken, dead_events: counts.deadOutbox, late_reminders: counts.pendingReminders, goods_cases: cases.length },
        push_provider_configured: this.provider.configured,
        failures: failures.filter((f) => rights.apps.includes(f.app)).map((f) => ({ notification_id: f.notificationId, kind: f.kind, app: f.app, status: f.status, error_code: f.code, evidence: f.evidence, at: iso(f.atMs) })),
        // Business cases an Administration with the right must handle (goods of a failed delivery). Opening one goes to the delivery screen, which decides again.
        goods_cases: rights.apps.includes('FOOD') || rights.apps.includes('SHIP') ? cases.map((c) => ({ delivery_id: c.deliveryId, code: c.code, shop_name: c.shopName, opened_at: iso(c.openedAtMs) })) : [],
      };
    });
  }

  async search(token: string | undefined, query: Parameters<NotificationRepository['searchForAdmin']>[1] & { limit: number; offset: number }): Promise<JsonObject> {
    const known = await this.actor.precheck(token, { required: false });
    return this.transactions.withTransaction(async (context) => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      const rights = await this.#rights(context, known);
      if (query.app !== null && !rights.apps.includes(query.app)) {
        throw new AppError('ADMIN_FORBIDDEN');
      }
      const page = await this.repo.searchForAdmin(context, { ...query, app: query.app ?? (rights.apps.length === 2 ? null : (rights.apps[0] ?? null)) }, { limit: query.limit, offset: query.offset });
      return {
        items: page.rows.map((n) => ({
          notification_id: n.notificationId,
          created_at: iso(n.createdAtMs),
          kind: n.kind,
          title: n.title,
          body: n.body,
          app: n.app,
          recipient_user_id: n.recipientUserId,
          delivery_code: n.deliveryCode,
          channels: ['PUSH', 'APP'],
          push_status: n.pushStatus,
          attempts: n.pushAttempts,
          expired: n.validUntilMs !== null && Date.now() >= n.validUntilMs,
        })),
        total: page.total,
        limit: query.limit,
        offset: query.offset,
      };
    });
  }

  async detail(token: string | undefined, notificationId: string): Promise<JsonObject> {
    const known = await this.actor.precheck(token, { required: false });
    return this.transactions.withTransaction(async (context) => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      const rights = await this.#rights(context, known);
      const n = await this.repo.findNotificationById(context, notificationId);
      if (n === undefined || !rights.apps.includes(n.app)) {
        throw new AppError('NOTIFICATION_NOT_FOUND');
      }
      const pushes = await this.repo.pushesOf(context, notificationId);
      const code = n.targetType === 'DELIVERY' && n.targetId !== null ? (await context.query<{ code: string }>(`SELECT code FROM app.deliveries WHERE delivery_id = $1::uuid`, [n.targetId])).rows[0]?.code : undefined;
      return {
        notification_id: n.notificationId,
        kind: n.kind,
        title: n.title,
        app: n.app,
        recipient_user_id: n.recipientUserId,
        created_at: iso(n.createdAtMs),
        read_at: iso(n.readAtMs),
        valid_until: iso(n.validUntilMs),
        archived_at: iso(n.archivedAtMs),
        delete_after: iso(n.purgeAfterMs),
        target: { type: n.targetType, id: n.targetId, code: code ?? null },
        channels: [{ channel: 'APP', status: 'STORED', at: iso(n.createdAtMs) }, ...pushes.map(pushView)],
        // "Sent" means the provider accepted it: nothing here says the phone showed it or that the user read it.
        note: 'Đã gửi nghĩa là dịch vụ đẩy đã nhận; không có nghĩa thiết bị đã hiển thị hoặc người dùng đã đọc.',
      };
    });
  }

  async config(token: string | undefined): Promise<JsonObject> {
    const known = await this.actor.precheck(token, { required: false });
    return this.transactions.withTransaction(async (context) => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      await this.#lock(context, known, 'read');
      return configView(await this.repo.readConfig(context), this.provider.configured);
    });
  }

  async updateConfig(token: string | undefined, csrfHeader: unknown, body: ConfigBody, idempotencyKey: string | readonly string[] | undefined, meta: { requestId: string }): Promise<IdempotentOutcome> {
    const known = await this.actor.precheck(token, { required: true, header: csrfHeader });
    return this.executor.execute(
      {
        scopeType: PROVISIONING_SCOPE_TYPE,
        scopeId: known.userId,
        operationId: OPERATION,
        idempotencyKey,
        logicalRequest: {
          expected_version: body.expectedVersion,
          push_enabled: body.pushEnabled,
          default_sound: body.defaultSound,
          visible_days: body.visibleDays,
          purge_days: body.purgeDays,
          retry_max_attempts: body.retryMaxAttempts,
          retry_base_seconds: body.retryBaseSeconds,
        },
        replay: {
          kind: 'sensitive',
          authorize: async (context, guard) => {
            if (guard.actor_user_id !== known.userId) {
              throw new AppError('ADMIN_SESSION_INVALID');
            }
            await this.#lock(context, known, 'write');
            return true;
          },
        },
      },
      async (context) => {
        const locked = await this.#lock(context, known, 'write');
        const current = await this.repo.readConfig(context, true);
        if (current.version !== body.expectedVersion) {
          throw new AppError('VERSION_CONFLICT');
        }
        const next = { pushEnabled: body.pushEnabled, defaultSound: body.defaultSound, visibleDays: body.visibleDays, purgeDays: body.purgeDays, retryMaxAttempts: body.retryMaxAttempts, retryBaseSeconds: body.retryBaseSeconds };
        if (!(await this.repo.writeConfig(context, current.version, next, known.userId))) {
          throw new AppError('VERSION_CONFLICT');
        }
        await this.audit.append(context, {
          requestId: meta.requestId,
          actorType: locked.checked.membership.adminRole,
          actorId: known.userId,
          action: OPERATION,
          resourceType: RESOURCE,
          resourceId: 'config',
          resourceVersion: current.version + 1,
          outcome: 'SUCCESS',
          metadata: {
            push_enabled: next.pushEnabled,
            default_sound: next.defaultSound,
            from_visible_days: current.visibleDays,
            to_visible_days: next.visibleDays,
            from_purge_days: current.purgeDays,
            to_purge_days: next.purgeDays,
            from_retry_max: current.retryMaxAttempts,
            to_retry_max: next.retryMaxAttempts,
            from_retry_base_seconds: current.retryBaseSeconds,
            to_retry_base_seconds: next.retryBaseSeconds,
          },
        });
        return { status: 200, replayGuard: { actor_user_id: known.userId }, payload: configView(await this.repo.readConfig(context), this.provider.configured) };
      },
    );
  }

  async #lock(context: TransactionContext, known: SessionLookup, access: 'read' | 'write'): Promise<LockedActor> {
    const locked = await this.actor.lock(context, known, { user: 'read', factor: 'read' });
    assertParameterAccess(this.actor, locked, await freshClockMs(context), access);
    return locked;
  }

  /** SYSTEM: both apps. ADMIN: the apps its CURRENT permission rows allow it to view; none = forbidden. */
  async #rights(context: TransactionContext, known: SessionLookup): Promise<Rights> {
    const locked = await this.actor.lock(context, known, { user: 'read', factor: 'read' });
    const role = locked.checked.membership.adminRole;
    const rows = role === 'ADMIN' ? await this.permissions.permissions(context, known.userId) : [];
    this.actor.assertSessionLive(locked, await freshClockMs(context));
    if (role === 'SYSTEM') {
      return { role, apps: ['FOOD', 'SHIP'], write: true };
    }
    const apps: NotificationApp[] = [];
    if (rows.find((r) => r.app === 'SHOP')?.canView === true) {
      apps.push('FOOD');
    }
    if (rows.find((r) => r.app === 'DRIVER')?.canView === true) {
      apps.push('SHIP');
    }
    if (apps.length === 0) {
      throw new AppError('ADMIN_FORBIDDEN');
    }
    return { role, apps, write: false };
  }
}

