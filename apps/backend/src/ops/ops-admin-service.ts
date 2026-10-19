import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, lstatSync } from 'node:fs';
import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { SessionLookup } from '../admin-auth/admin-session-repository';
import { AdminMembershipRepository } from '../admin-auth/admin-membership-repository';
import { PROVISIONING_SCOPE_TYPE } from '../admin-provisioning/admin-provisioning-constants';
import { setBusinessLockTimeout } from '../admin-provisioning/admin-provisioning-locks';
import { AdminSystemActor, LockedActor } from '../admin-provisioning/admin-system-actor';
import { AuditWriter } from '../audit/audit-writer';
import { AppError } from '../common/app-errors';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DEFAULT_OPS_CONFIG } from '../config/ops-config';
import { IdempotencyExecutor, IdempotentOutcome, JsonObject } from '../idempotency/idempotency-executor';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { SmsGatewayOpsReader } from '../sms-gateway/sms-gateway-ops-reader';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { CHECK_API, CHECK_BACKUP, CHECK_CPU, CHECK_DATABASE, CHECK_EXTERNAL_PROBE, CHECK_HTTPS, CHECK_M14, CHECK_MEMORY, CHECK_NOTIFICATIONS, CHECK_OTP_SEND, CHECK_PUBLIC_API, CHECK_RESTORE_TEST, CHECK_WORKER, COMPONENT_LABEL, GATEWAY_FACETS, gatewayCheckKey, IngestKeyScope, SOURCE_LABEL } from './ops-constants';
import { OpsDiscordDispatcher } from './ops-discord';
import { Actor, OpsEngine } from './ops-engine';
import { IncidentRow, OpsIncidentRepository, incidentCode } from './ops-incident-repository';
import { OpsReleaseRepository } from './ops-release-repository';
import { CheckRow, OpsRepository } from './ops-repository';
import { checkSettingsPatch, overridesOf, resolveSettings, SETTING_DEFS } from './ops-settings';
import { OpsSettingsService } from './ops-settings-service';
import { OpsTelemetryRepository } from './ops-telemetry-repository';
import { ConfigBody, IncidentListQuery, LogQuery, MaintenanceBody, ReleaseBody } from './ops-validation';
import { DisplayState, STATE_LABEL, checkView, deployView, displayState, eventView, evidenceText, incidentView, iso, maintenanceView, notificationView, releaseView, worstState } from './ops-views';
import { redactNote } from './ops-redact';

export type OpsLevel = 'SYSTEM' | 'HANDLE' | 'VIEW';
const RANK: Readonly<Record<OpsLevel, number>> = { VIEW: 1, HANDLE: 2, SYSTEM: 3 };

interface Access {
  readonly level: OpsLevel;
  readonly locked: LockedActor;
  readonly userId: string;
  readonly nowMs: number;
}

const PURPOSE_LABEL: Readonly<Record<string, string>> = { REGISTER: 'Đăng ký', RESET_PASSWORD: 'Quên mật khẩu', ADMIN_ACTIVATION: 'Kích hoạt quản trị' };
const JOB_STATUS_LABEL: Readonly<Record<string, string>> = { QUEUED: 'Đang chờ', CLAIMED: 'Đang xử lý', SENT: 'Đã gửi (máy báo radio nhận)', FAILED: 'Lỗi', UNKNOWN: 'Chưa rõ kết quả', EXPIRED: 'Hết hạn, không gửi' };
const SIM_LABEL: Readonly<Record<string, string>> = { READY: 'Sẵn sàng', ABSENT: 'Không có SIM', LOCKED: 'SIM bị khóa', UNKNOWN: 'Chưa xác định' };

/** The reasons the "deploy server" button is not usable (design section 12: the button exists only when the pipeline and its authorization are ready). */
const DEPLOY_CONTROL_MISSING: readonly string[] = [
  'Quy trình triển khai hiện tại là thủ tục trên VPS (runbook), chưa có pipeline có thể kích hoạt an toàn từ Admin Web.',
  'Chưa có cơ chế cấp quyền riêng và xác nhận bước hai cho việc triển khai server.',
  'M13 không chạy lệnh shell tùy ý và không nhận đường dẫn hay artifact tùy ý. Hiện chỉ theo dõi: lịch sử, health check và kết quả do pipeline báo về.',
];

const hashRef = (userId: string, app: string): string => createHash('sha256').update(`${userId}:${app}`).digest('hex').slice(0, 32);

/**
 * Administration of M13 (design sections 2, 9, 10, 12, 13). SYSTEM sees and changes everything; an ADMIN sees only what SYSTEM granted it (VIEW or HANDLE: acknowledge,
 * note, snooze, close) and never changes a threshold, a channel, a maintenance window, a release or anyone's access. Every call authorizes AGAIN under the actor locks;
 * the scope is read FOR SHARE inside the same transaction, so a revocation and a request being authorized cannot interleave. Writes go through the idempotency
 * executor, are audited (no secret value, only that something changed) and copied into the ADMIN group of the log, which the runtime role may read back.
 */
@Injectable()
export class OpsAdminService {
  readonly #lockTimeoutMs: number;
  readonly #artifactDir: string | undefined;
  readonly #environment: string;

  constructor(
    private readonly transactions: TransactionManager,
    private readonly executor: IdempotencyExecutor,
    private readonly actor: AdminSystemActor,
    private readonly memberships: AdminMembershipRepository,
    private readonly repo: OpsRepository,
    private readonly incidents: OpsIncidentRepository,
    private readonly releases: OpsReleaseRepository,
    private readonly telemetry: OpsTelemetryRepository,
    private readonly gateways: SmsGatewayOpsReader,
    private readonly engine: OpsEngine,
    private readonly settings: OpsSettingsService,
    private readonly dispatcher: OpsDiscordDispatcher,
    private readonly audit: AuditWriter,
    @Inject(APP_CONFIG) appConfig: AppConfig,
  ) {
    this.#lockTimeoutMs = appConfig.idempotency.businessLockTimeoutMs;
    this.#artifactDir = (appConfig.ops ?? DEFAULT_OPS_CONFIG).artifactDir;
    this.#environment = appConfig.appEnv;
  }

  // ---- access ----

  async #access(context: TransactionContext, known: SessionLookup, need: OpsLevel): Promise<Access> {
    const locked = await this.actor.lock(context, known, { user: 'read', factor: 'read' });
    const nowMs = await freshClockMs(context);
    this.actor.assertSessionLive(locked, nowMs);
    const role = locked.checked.membership.adminRole;
    let level: OpsLevel;
    if (role === 'SYSTEM') {
      level = 'SYSTEM';
    } else {
      const scope = await this.repo.scopeOf(context, known.userId);
      if (scope === undefined || scope.level === 'NONE') {
        throw new AppError('ADMIN_FORBIDDEN');
      }
      level = scope.level;
    }
    if (RANK[level] < RANK[need]) {
      throw new AppError('ADMIN_FORBIDDEN');
    }
    return { level, locked, userId: known.userId, nowMs };
  }

  async #read<T>(token: string | undefined, need: OpsLevel, run: (context: TransactionContext, access: Access) => Promise<T>): Promise<T> {
    const known = await this.actor.precheck(token, { required: false });
    return this.transactions.withTransaction(async (context) => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      return run(context, await this.#access(context, known, need));
    });
  }

  /** One audited, idempotent write. `need` is the minimum level; the audit entry and the ADMIN log copy are written in the same transaction as the change. */
  async #mutate(
    token: string | undefined,
    csrf: unknown,
    key: string | readonly string[] | undefined,
    meta: { requestId: string },
    o: { operation: string; need: OpsLevel; logical: JsonObject; resourceType: string; resourceId: string; message: string; metadata?: JsonObject },
    run: (context: TransactionContext, access: Access) => Promise<{ payload: JsonObject; version?: number; audit?: JsonObject }>,
  ): Promise<IdempotentOutcome> {
    const known = await this.actor.precheck(token, { required: true, header: csrf });
    return this.executor.execute(
      {
        scopeType: PROVISIONING_SCOPE_TYPE,
        scopeId: known.userId,
        operationId: o.operation,
        idempotencyKey: key,
        logicalRequest: o.logical,
        replay: {
          kind: 'sensitive',
          authorize: async (context, guard) => {
            if (guard.actor_user_id !== known.userId) {
              throw new AppError('ADMIN_SESSION_INVALID');
            }
            await this.#access(context, known, o.need);
            return true;
          },
        },
      },
      async (context) => {
        const access = await this.#access(context, known, o.need);
        const result = await run(context, access);
        const metadata = { ...(o.metadata ?? {}), ...(result.audit ?? {}) } as JsonObject;
        await this.audit.append(context, {
          requestId: meta.requestId,
          actorType: access.locked.checked.membership.adminRole,
          actorId: known.userId,
          action: o.operation,
          resourceType: o.resourceType,
          resourceId: o.resourceId,
          ...(result.version === undefined ? {} : { resourceVersion: result.version }),
          outcome: 'SUCCESS',
          metadata,
        });
        await this.repo.insertEvent(
          context,
          { category: 'ADMIN', level: 'INFO', source: 'OPS', environment: this.#environment, code: o.operation.replace(/^admin\.ops\./, '').replace(/\.v1$/, '').toUpperCase().replace(/\./g, '_'), kind: 'ADMIN', message: o.message, actorUserId: known.userId, requestRef: meta.requestId, detail: metadata },
          randomUUID(),
        );
        return { status: 200, replayGuard: { actor_user_id: known.userId }, payload: result.payload };
      },
    );
  }

  // ---- overview ----

  async overview(token: string | undefined): Promise<JsonObject> {
    return this.#read(token, 'VIEW', async (context, access) => {
      const now = access.nowMs;
      const rows = await this.repo.listChecks(context);
      const byKey = new Map(rows.map((r) => [r.checkKey, r]));
      const ds = (key: string): DisplayState => displayState(byKey.get(key), now);
      const component = (key: string, label: string, checkKeys: readonly string[], note?: string | null): JsonObject => {
        const states = checkKeys.map(ds);
        const state = worstState(states);
        const observed = checkKeys.map((k) => byKey.get(k)?.observedAtMs ?? 0).filter((v) => v > 0);
        const failing = checkKeys.map((k) => byKey.get(k)).filter((r): r is CheckRow => r !== undefined && (r.state === 'WARNING' || r.state === 'CRITICAL'));
        return { key, label, state, state_label: STATE_LABEL[state], detail: failing[0] === undefined ? (state === 'OK' ? null : (evidenceText(byKey.get(checkKeys[0] as string)?.evidenceCode ?? null) ?? 'Chưa có dữ liệu')) : evidenceText(failing[0].evidenceCode), note: note ?? null, observed_at: iso(observed.length === 0 ? null : Math.max(...observed)) };
      };
      const devices = await this.gateways.devices(context);
      const gatewayKeys = devices.flatMap((d) => GATEWAY_FACETS.filter((f) => f !== 'otp_queue').map((f) => gatewayCheckKey(d.deviceId, f))).concat(CHECK_OTP_SEND);
      const diskKeys = rows.filter((r) => r.checkKey.startsWith('disk.')).map((r) => r.checkKey);
      const push = byKey.get(CHECK_NOTIFICATIONS)?.value.push_provider;
      const components: JsonObject[] = [
        component('api', 'API', [CHECK_API]),
        component('database', 'Database', [CHECK_DATABASE]),
        component('sms_gateway', 'SMS Gateway', devices.length === 0 ? [CHECK_OTP_SEND] : gatewayKeys, devices.length === 0 ? 'Chưa ghép Gateway nào' : null),
        component('m14', 'GPS / bản đồ (M14)', [CHECK_M14], byKey.has(CHECK_M14) ? null : 'Chưa cấu hình kiểm tra M14'),
        component('notifications', 'Thông báo (M08)', [CHECK_NOTIFICATIONS], push === 'NOT_CONFIGURED' ? 'Đẩy thông báo (push) chưa kích hoạt, hộp thư trong app vẫn chạy' : null),
        component('backup', 'Sao lưu', [CHECK_BACKUP]),
        component('restore_test', 'Thử khôi phục', [CHECK_RESTORE_TEST], byKey.has(CHECK_RESTORE_TEST) && byKey.get(CHECK_RESTORE_TEST)?.state !== 'UNKNOWN' ? null : 'Sao lưu thành công khác với đã thử khôi phục thành công'),
        component('resources', 'CPU / RAM / đĩa', [CHECK_CPU, CHECK_MEMORY, ...diskKeys]),
        component('worker', 'Worker / hàng đợi', [CHECK_WORKER, 'outbox']),
        component('https', 'HTTPS', [CHECK_HTTPS]),
      ];
      const probeRow = byKey.get(CHECK_EXTERNAL_PROBE);
      const probeReported = typeof probeRow?.value.reported_at === 'string' ? Date.parse(probeRow.value.reported_at as string) : Number.NaN;
      const publicRow = byKey.get(CHECK_PUBLIC_API);
      const counts = await this.incidents.counts(context);
      const live = await this.incidents.search(context, { severity: null, source: null, statuses: ['NEW', 'ACKNOWLEDGED', 'IN_PROGRESS'], assigneeUserId: null, unassigned: false, fromMs: null, toMs: null, codeSeq: null }, { limit: 10, offset: 0 });
      const labels = await this.repo.userLabels(context, live.rows.flatMap((i) => (i.assigneeUserId === null ? [] : [i.assigneeUserId])));
      const stats = await this.incidents.notificationStats(context);
      const eff = await this.settings.load(context);
      const lastDeploy = (await this.releases.listDeploys(context, { limit: 1, offset: 0 })).rows[0];
      const maintenance = (await this.incidents.activeMaintenance(context)).map((m) => maintenanceView(m, now));
      return {
        updated_at: iso(now),
        data_note: rows.length === 0 ? 'Chưa có dữ liệu: bộ thu thập chưa ghi lần đo nào.' : null,
        components,
        incidents: { open: counts.open, critical: counts.critical, unacknowledged: counts.unacknowledged, items: live.rows.map((i) => incidentView(i, { assigneeLabel: i.assigneeUserId === null ? null : (labels.get(i.assigneeUserId) ?? null), checkState: ds(i.checkKey), nowMs: now })) },
        external_probe: {
          activated: Number.isFinite(probeReported),
          state: Number.isFinite(probeReported) ? ds(CHECK_EXTERNAL_PROBE) : 'NO_DATA',
          label: Number.isFinite(probeReported) ? STATE_LABEL[ds(CHECK_EXTERNAL_PROBE)] : 'Chưa kích hoạt',
          last_report_at: Number.isFinite(probeReported) ? new Date(probeReported).toISOString() : null,
          public_api: publicRow === undefined ? null : checkView(publicRow, now, 'API công khai'),
          note: Number.isFinite(probeReported) ? 'Kiểm tra định kỳ từ hệ thống giám sát bên ngoài' : 'Chưa có báo cáo từ môi trường giám sát độc lập. Xem hướng dẫn cài đặt trong runbook.',
        },
        discord: { enabled: eff.discordEnabled, configured: eff.webhookConfigured, pending: stats.pending, failed_7d: stats.failed, last_sent_at: iso(stats.lastSentAtMs) },
        maintenance_active: maintenance,
        last_update: lastDeploy === undefined ? null : deployView(lastDeploy),
        viewer: { level: access.level },
      };
    });
  }

  // ---- incidents ----

  async incidentList(token: string | undefined, q: IncidentListQuery): Promise<JsonObject> {
    return this.#read(token, 'VIEW', async (context, access) => {
      const page = await this.incidents.search(context, q, { limit: q.limit, offset: q.offset });
      const checks = new Map((await this.repo.listChecks(context)).map((r) => [r.checkKey, r]));
      const labels = await this.repo.userLabels(context, page.rows.flatMap((i) => (i.assigneeUserId === null ? [] : [i.assigneeUserId])));
      return {
        updated_at: iso(access.nowMs),
        items: page.rows.map((i) => incidentView(i, { assigneeLabel: i.assigneeUserId === null ? null : (labels.get(i.assigneeUserId) ?? null), checkState: displayState(checks.get(i.checkKey), access.nowMs), nowMs: access.nowMs })),
        total: page.total,
        limit: q.limit,
        offset: q.offset,
      };
    });
  }

  async incidentDetail(token: string | undefined, ref: { uuid?: string; codeSeq?: number }): Promise<JsonObject> {
    // Opening an incident is recorded once ("read" is not "acknowledged") in its own short transaction after the read succeeds.
    const result = await this.#read(token, 'VIEW', async (context, access) => {
      const incident = ref.uuid !== undefined ? await this.incidents.findById(context, ref.uuid) : await this.incidents.findByCodeSeq(context, ref.codeSeq as number);
      if (incident === undefined) {
        throw new AppError('OPS_INCIDENT_NOT_FOUND');
      }
      const check = await this.repo.findCheck(context, incident.checkKey);
      const timeline = await this.repo.timeline(context, incident.incidentId);
      const notices = await this.incidents.listForIncident(context, incident.incidentId);
      const errors = await this.repo.recentErrors(context, incident.source, 10);
      const ids = [...timeline.flatMap((e) => (e.actorUserId === null ? [] : [e.actorUserId])), ...(incident.assigneeUserId === null ? [] : [incident.assigneeUserId])];
      const labels = await this.repo.userLabels(context, ids);
      const live = incident.status !== 'CLOSED';
      const canHandle = RANK[access.level] >= RANK.HANDLE;
      return {
        incident: incident,
        view: {
          ...incidentView(incident, { assigneeLabel: incident.assigneeUserId === null ? null : (labels.get(incident.assigneeUserId) ?? null), checkState: displayState(check, access.nowMs), nowMs: access.nowMs }),
          evidence: incident.evidence as JsonObject,
          evidence_text: evidenceText((incident.evidence.evidence_code as string | null | undefined) ?? null),
          current_check: checkView(check, access.nowMs, SOURCE_LABEL[incident.source]),
          timeline: timeline.map((e) => eventView(e, e.actorUserId === null ? null : (labels.get(e.actorUserId) ?? null))),
          notifications: notices.map(notificationView),
          recent_errors: errors.map((e) => eventView(e, null)),
          link: this.engine.link(incident.code) ?? null,
          actions: {
            acknowledge: canHandle && incident.status === 'NEW',
            start: canHandle && (incident.status === 'NEW' || incident.status === 'ACKNOWLEDGED'),
            note: canHandle,
            snooze: canHandle && live && incident.status !== 'RECOVERED',
            close: canHandle && live,
            assign: access.level === 'SYSTEM' && live,
          },
          // Opening is not handling: the page says so, and the check state above is shown whatever the incident status is.
          read_note: 'Đã đọc không đồng nghĩa đã xử lý. Hãy nhận xử lý và cập nhật trạng thái sau khi kiểm tra thực tế.',
          viewer: { level: access.level },
        },
        userId: access.userId,
      };
    });
    await this.transactions.withTransaction((context) => this.engine.markViewed(context, result.incident.incidentId, result.userId));
    return result.view as JsonObject;
  }

  async #incidentAction(
    token: string | undefined,
    csrf: unknown,
    key: string | readonly string[] | undefined,
    meta: { requestId: string },
    incidentId: string,
    o: { verb: string; need: OpsLevel; logical: JsonObject; message: string; run: (context: TransactionContext, actor: Actor) => Promise<IncidentRow | undefined> },
  ): Promise<IdempotentOutcome> {
    return this.#mutate(
      token,
      csrf,
      key,
      meta,
      { operation: `admin.ops.incident.${o.verb}.v1`, need: o.need, logical: { incident_id: incidentId, ...o.logical }, resourceType: 'ops_incident', resourceId: incidentId, message: o.message },
      async (context, access) => {
        const next = await o.run(context, { userId: access.userId, role: access.locked.checked.membership.adminRole });
        const incident = next ?? (await this.incidents.findById(context, incidentId));
        if (incident === undefined) {
          throw new AppError('OPS_INCIDENT_NOT_FOUND');
        }
        const check = await this.repo.findCheck(context, incident.checkKey);
        return { payload: incidentView(incident, { assigneeLabel: null, checkState: displayState(check, access.nowMs), nowMs: access.nowMs }), version: incident.version, audit: { incident: incidentCode(incident.codeSeq), status: incident.status } };
      },
    );
  }

  acknowledge(token: string | undefined, csrf: unknown, key: string | readonly string[] | undefined, meta: { requestId: string }, id: string, expectedVersion: number): Promise<IdempotentOutcome> {
    return this.#incidentAction(token, csrf, key, meta, id, { verb: 'acknowledge', need: 'HANDLE', logical: { expected_version: expectedVersion }, message: 'Nhận xử lý sự cố', run: (c, a) => this.engine.acknowledge(c, id, a, expectedVersion) });
  }

  start(token: string | undefined, csrf: unknown, key: string | readonly string[] | undefined, meta: { requestId: string }, id: string, expectedVersion: number): Promise<IdempotentOutcome> {
    return this.#incidentAction(token, csrf, key, meta, id, { verb: 'start', need: 'HANDLE', logical: { expected_version: expectedVersion }, message: 'Bắt đầu xử lý sự cố', run: (c, a) => this.engine.startWork(c, id, a, expectedVersion) });
  }

  note(token: string | undefined, csrf: unknown, key: string | readonly string[] | undefined, meta: { requestId: string }, id: string, text: string): Promise<IdempotentOutcome> {
    return this.#incidentAction(token, csrf, key, meta, id, {
      verb: 'note',
      need: 'HANDLE',
      logical: { text: redactNote(text) },
      message: 'Thêm ghi chú sự cố',
      run: async (c, a) => {
        await this.engine.addNote(c, id, text, a);
        return undefined;
      },
    });
  }

  snooze(token: string | undefined, csrf: unknown, key: string | readonly string[] | undefined, meta: { requestId: string }, id: string, expectedVersion: number, minutes: number): Promise<IdempotentOutcome> {
    return this.#incidentAction(token, csrf, key, meta, id, { verb: 'snooze', need: 'HANDLE', logical: { expected_version: expectedVersion, minutes }, message: `Tạm hoãn nhắc ${minutes} phút`, run: (c, a) => this.engine.snooze(c, id, minutes, a, expectedVersion) });
  }

  close(token: string | undefined, csrf: unknown, key: string | readonly string[] | undefined, meta: { requestId: string }, id: string, b: { expectedVersion: number; confirmStillFailing: boolean; note: string | null }): Promise<IdempotentOutcome> {
    return this.#incidentAction(token, csrf, key, meta, id, {
      verb: 'close',
      need: 'HANDLE',
      logical: { expected_version: b.expectedVersion, confirm: b.confirmStillFailing, note: b.note === null ? null : redactNote(b.note) },
      message: b.confirmStillFailing ? 'Đóng sự cố khi kiểm tra chưa xác nhận bình thường' : 'Đóng sự cố',
      run: (c, a) => this.engine.close(c, id, a, b.expectedVersion, b.confirmStillFailing, b.note === null ? null : redactNote(b.note, 300)),
    });
  }

  assign(token: string | undefined, csrf: unknown, key: string | readonly string[] | undefined, meta: { requestId: string }, id: string, b: { expectedVersion: number; assigneeUserId: string | null }): Promise<IdempotentOutcome> {
    return this.#incidentAction(token, csrf, key, meta, id, {
      verb: 'assign',
      need: 'SYSTEM',
      logical: { expected_version: b.expectedVersion, assignee: b.assigneeUserId },
      message: 'Giao người phụ trách sự cố',
      run: async (c, a) => {
        if (b.assigneeUserId !== null) {
          // Only an active administrator who may HANDLE (or a SYSTEM) can be responsible.
          const m = await this.memberships.find(c, b.assigneeUserId);
          const scope = await this.repo.scopeOf(c, b.assigneeUserId);
          if (m === undefined || m.status !== 'ACTIVE' || (m.adminRole !== 'SYSTEM' && scope?.level !== 'HANDLE')) {
            throw new AppError('OPS_TARGET_NOT_FOUND');
          }
        }
        return this.engine.assign(c, id, b.assigneeUserId, a, b.expectedVersion);
      },
    });
  }

  // ---- gateway ----

  async gateway(token: string | undefined): Promise<JsonObject> {
    return this.#read(token, 'VIEW', async (context, access) => {
      const now = access.nowMs;
      const checks = new Map((await this.repo.listChecks(context)).map((r) => [r.checkKey, r]));
      const tele = new Map((await this.telemetry.listTelemetry(context)).map((t) => [t.deviceId, t]));
      const devices = await this.gateways.devices(context);
      const summary = await this.gateways.summary(context);
      const jobs = await this.gateways.recentJobs(context, 20);
      const eff = await this.settings.load(context);
      const maintenance = (await this.incidents.listMaintenance(context, 20)).map((m) => maintenanceView(m, now));
      const out: JsonObject[] = devices.map((d) => {
        const t = tele.get(d.deviceId);
        const facet = (f: (typeof GATEWAY_FACETS)[number]): JsonObject => checkView(checks.get(gatewayCheckKey(d.deviceId, f)), now, d.label);
        const states = GATEWAY_FACETS.filter((f) => f !== 'otp_queue').map((f) => displayState(checks.get(gatewayCheckKey(d.deviceId, f)), now));
        const state = worstState(states);
        return {
          device_id: d.deviceId,
          label: d.label,
          state,
          state_label: STATE_LABEL[state],
          last_contact_at: iso(d.lastSeenAtMs),
          app_version: d.appVersion,
          sms_permission: d.smsPermission,
          paused: d.paused,
          // Every value below is what the phone itself reported; null is shown as "Chưa xác định", never filled in.
          battery_percent: t?.batteryPercent ?? null,
          charging: t?.charging ?? null,
          sim_state: t?.simState ?? null,
          sim_state_label: t?.simState == null ? 'Chưa xác định' : (SIM_LABEL[t.simState] ?? 'Chưa xác định'),
          sim_balance: null,
          sim_balance_label: 'Chưa xác định',
          topup_noted_on: t?.topupNotedOn ?? null,
          topup_note: 'Ngày nạp gần nhất do chủ thiết bị ghi tay',
          pending_reports: t?.pendingReports ?? null,
          current_task: t?.currentTask ?? null,
          last_error_code: t?.lastErrorCode ?? null,
          last_error_at: iso(t?.lastErrorAtMs ?? null),
          telemetry_at: iso(t?.reportedAtMs ?? null),
          checks: { contact: facet('contact'), battery: facet('battery'), power: facet('power'), sms_failures: facet('sms_failures') },
        };
      });
      return {
        updated_at: iso(now),
        devices: out,
        queue: {
          queued: summary.queued,
          claimed: summary.claimed,
          failed_last_hour: summary.failedLastHour,
          otp_check: checkView(checks.get(CHECK_OTP_SEND), now, 'Hàng đợi OTP'),
          purposes_label: 'Đăng ký / Quên mật khẩu',
          jobs: jobs.map((j) => ({ job_id: j.jobId, at: iso(j.createdAtMs), purpose: j.purpose, purpose_label: PURPOSE_LABEL[j.purpose] ?? j.purpose, status: j.status, status_label: JOB_STATUS_LABEL[j.status] ?? j.status, result_code: j.resultCode, recipient_tail: j.phoneTail, expired: j.expiresAtMs <= now && (j.status === 'QUEUED' || j.status === 'EXPIRED') })),
        },
        discord: access.level === 'SYSTEM' ? { enabled: eff.discordEnabled, configured: eff.webhookConfigured, webhook_masked: eff.webhookConfigured ? '••••••••••••••••' : null, updated_at: iso(eff.row.webhookUpdatedAtMs), min_severity: eff.discordMinSeverity } : null,
        maintenance: access.level === 'SYSTEM' ? maintenance : maintenance.filter((m) => m.state === 'ACTIVE' || m.state === 'SCHEDULED'),
        viewer: { level: access.level },
      };
    });
  }

  topupNote(token: string | undefined, csrf: unknown, key: string | readonly string[] | undefined, meta: { requestId: string }, deviceId: string, date: string | null): Promise<IdempotentOutcome> {
    return this.#mutate(token, csrf, key, meta, { operation: 'admin.ops.gateway_topup.note.v1', need: 'SYSTEM', logical: { device_id: deviceId, date }, resourceType: 'sms_gateway_device', resourceId: deviceId, message: 'Ghi ngày nạp SIM gần nhất (ghi tay)' }, async (context, access) => {
      if (!(await this.telemetry.setTopupNote(context, deviceId, date, access.userId))) {
        throw new AppError('OPS_TARGET_NOT_FOUND');
      }
      return { payload: { device_id: deviceId, topup_noted_on: date }, audit: { topup_noted_on: date } };
    });
  }

  // ---- logs ----

  async logs(token: string | undefined, q: LogQuery): Promise<JsonObject> {
    // The administration group names who changed what: SYSTEM only. The other groups are operational evidence for anyone with access.
    return this.#read(token, q.group === 'ADMIN' ? 'SYSTEM' : 'VIEW', async (context, access) => {
      const page = await this.repo.searchEvents(context, { group: q.group, source: q.source, level: q.level, code: q.code, deliveryCode: q.deliveryCode, userId: q.userId, appVersion: q.appVersion, incidentId: null, fromMs: q.fromMs, toMs: q.toMs }, { limit: q.limit, offset: q.offset });
      const labels = await this.repo.userLabels(context, page.rows.flatMap((e) => (e.actorUserId === null ? [] : [e.actorUserId])));
      return { updated_at: iso(access.nowMs), items: page.rows.map((e) => eventView(e, e.actorUserId === null ? null : (labels.get(e.actorUserId) ?? null))), total: page.total, limit: q.limit, offset: q.offset };
    });
  }

  // ---- configuration ----

  #configView(eff: Awaited<ReturnType<OpsSettingsService['load']>>, access: Access): JsonObject {
    const settings = eff.settings;
    return {
      version: eff.row.version,
      updated_at: iso(eff.row.updatedAtMs),
      editable: access.level === 'SYSTEM',
      settings: SETTING_DEFS.map((d) => ({ key: d.key, group: d.group, label: d.label, unit: d.unit, value: settings[d.key] as number, default: d.default, min: d.min, max: d.max, impl_default: d.impl })),
      // The webhook is never returned, to anybody: only whether one is stored and when it last changed.
      discord: access.level === 'SYSTEM' ? { enabled: eff.discordEnabled, min_severity: eff.discordMinSeverity, webhook_configured: eff.webhookConfigured, webhook_masked: eff.webhookConfigured ? '••••••••••••••••' : null, webhook_updated_at: iso(eff.row.webhookUpdatedAtMs) } : null,
    };
  }

  async config(token: string | undefined): Promise<JsonObject> {
    return this.#read(token, 'VIEW', async (context, access) => {
      const eff = await this.settings.load(context);
      const maintenance = (await this.incidents.listMaintenance(context, 20)).map((m) => maintenanceView(m, access.nowMs));
      const keys = access.level === 'SYSTEM' ? await this.repo.listScopes(context) : [];
      const labels = await this.repo.userLabels(context, keys.map((k) => k.userId));
      const ingest = access.level === 'SYSTEM' ? (await this.releases.listIngestKeys(context)).map((k) => ({ key_id: k.keyId, label: k.label, scope: k.scope, status: k.status, created_at: iso(k.createdAtMs), last_used_at: iso(k.lastUsedAtMs) })) : [];
      return {
        updated_at: iso(access.nowMs),
        config: this.#configView(eff, access),
        maintenance,
        access: access.level === 'SYSTEM' ? keys.map((k) => ({ user_id: k.userId, label: labels.get(k.userId) ?? null, level: k.level, version: k.version, updated_at: iso(k.updatedAtMs) })) : null,
        ingest_keys: ingest,
        viewer: { level: access.level },
      };
    });
  }

  updateConfig(token: string | undefined, csrf: unknown, key: string | readonly string[] | undefined, meta: { requestId: string }, body: ConfigBody): Promise<IdempotentOutcome> {
    return this.#mutate(
      token,
      csrf,
      key,
      meta,
      {
        operation: 'admin.ops.config.update.v1',
        need: 'SYSTEM',
        // The webhook is part of the fingerprint only as "present"; its value is HMAC-fingerprinted by the executor and never stored or logged.
        logical: { expected_version: body.expectedVersion, settings: body.settings, discord_enabled: body.discordEnabled, min: body.discordMinSeverity, webhook: body.webhook === undefined ? 'keep' : body.webhook === null ? 'clear' : body.webhook },
        resourceType: 'ops_config',
        resourceId: 'config',
        message: 'Đổi cấu hình vận hành',
      },
      async (context, access) => {
        const current = await this.settings.load(context, true);
        if (current.row.version !== body.expectedVersion) {
          throw new AppError('VERSION_CONFLICT');
        }
        const verdict = checkSettingsPatch(body.settings, current.settings);
        if (!verdict.ok) {
          throw new AppError('OPS_SETTINGS_INVALID');
        }
        const merged = resolveSettings({ ...current.row.overrides, ...body.settings });
        // A Discord channel cannot be switched on without a webhook (being sent to nowhere would look like being sent).
        const webhookAfter = body.webhook === undefined ? current.webhookConfigured : body.webhook !== null;
        if (body.discordEnabled && !webhookAfter) {
          throw new AppError('OPS_DISCORD_NOT_CONFIGURED');
        }
        const sealed = typeof body.webhook === 'string' ? this.settings.seal(body.webhook) : undefined;
        const ok = await this.repo.writeConfig(
          context,
          current.row.version,
          { overrides: overridesOf(merged), discordEnabled: body.discordEnabled, discordMinSeverity: body.discordMinSeverity, webhook: sealed ?? (body.webhook === null ? 'clear' : 'keep') },
          access.userId,
        );
        if (!ok) {
          throw new AppError('VERSION_CONFLICT');
        }
        const changed: JsonObject = {};
        for (const [k, v] of Object.entries(body.settings)) {
          if (current.settings[k] !== v) changed[k] = { from: current.settings[k] as number, to: v };
        }
        const fresh = await this.settings.load(context);
        return {
          payload: this.#configView(fresh, access),
          version: fresh.row.version,
          // Names and numbers of the thresholds, and only the FACT that the webhook changed: never its value, before or after.
          audit: { changed, discord_enabled: body.discordEnabled, discord_min_severity: body.discordMinSeverity, webhook_changed: body.webhook !== undefined, webhook_action: body.webhook === undefined ? 'keep' : body.webhook === null ? 'clear' : 'replace' },
        };
      },
    );
  }

  /** SYSTEM presses "Gửi thử": a TEST message is queued and one dispatch pass runs now, so the answer is the real outcome (including "not configured"). */
  async discordTest(token: string | undefined, csrf: unknown, key: string | readonly string[] | undefined, meta: { requestId: string }): Promise<IdempotentOutcome> {
    const outcome = await this.#mutate(token, csrf, key, meta, { operation: 'admin.ops.discord_test.send.v1', need: 'SYSTEM', logical: { test: true }, resourceType: 'ops_config', resourceId: 'discord', message: 'Gửi thử tin Discord' }, async (context, access) => {
      const id = randomUUID();
      const row = await this.engine.enqueueFreeNotice(context, 'TEST', 'INFO', { title: 'Tin thử từ Admin Web 11Ship', source: 'Cấu hình vận hành', impact: 'Đây là tin gửi thử, không phải sự cố.', detail: `Yêu cầu bởi quản trị ••••${access.userId.slice(-3)}` }, `test:${id}`);
      return { payload: { notification_id: row?.notificationId ?? null }, audit: { notification_id: row?.notificationId ?? null } };
    });
    if (outcome.persisted && !outcome.replayed) {
      await this.dispatcher.runOnce();
    }
    const id = (outcome.payload as { notification_id?: string | null }).notification_id ?? null;
    const row = id === null ? undefined : await this.transactions.withTransaction((context) => this.incidents.findNotification(context, id));
    return { ...outcome, payload: { result: row === undefined ? null : notificationView(row) } };
  }

  // ---- maintenance ----

  createMaintenance(token: string | undefined, csrf: unknown, key: string | readonly string[] | undefined, meta: { requestId: string }, b: MaintenanceBody): Promise<IdempotentOutcome> {
    return this.#mutate(token, csrf, key, meta, { operation: 'admin.ops.maintenance.create.v1', need: 'SYSTEM', logical: { scopes: [...b.scopes], reason: redactNote(b.reason, 200), starts_at: b.startsAtMs, ends_at: b.endsAtMs }, resourceType: 'ops_maintenance', resourceId: 'new', message: 'Tạo cửa sổ bảo trì' }, async (context, access) => {
      const now = access.nowMs;
      const start = b.startsAtMs ?? now;
      if (b.endsAtMs <= now || b.endsAtMs <= start || b.endsAtMs - start > 72 * 3_600_000 || start < now - 60_000 || start > now + 7 * 86_400_000) {
        throw new AppError('OPS_MAINTENANCE_INVALID');
      }
      const row = await this.incidents.insertMaintenance(context, { maintenanceId: randomUUID(), scopes: b.scopes, reason: b.reason, startsAtMs: start, endsAtMs: b.endsAtMs, createdBy: access.userId });
      return { payload: maintenanceView(row, now), audit: { maintenance_id: row.maintenanceId, scopes: [...b.scopes], starts_at: iso(row.startsAtMs), ends_at: iso(row.endsAtMs), reason: row.reason } };
    });
  }

  cancelMaintenance(token: string | undefined, csrf: unknown, key: string | readonly string[] | undefined, meta: { requestId: string }, id: string): Promise<IdempotentOutcome> {
    return this.#mutate(token, csrf, key, meta, { operation: 'admin.ops.maintenance.cancel.v1', need: 'SYSTEM', logical: { maintenance_id: id }, resourceType: 'ops_maintenance', resourceId: id, message: 'Hủy cửa sổ bảo trì (cảnh báo bật lại)' }, async (context, access) => {
      const row = await this.incidents.cancelMaintenance(context, id, access.userId);
      if (row === undefined) {
        throw new AppError('OPS_MAINTENANCE_NOT_FOUND');
      }
      return { payload: maintenanceView(row, access.nowMs), audit: { maintenance_id: id } };
    });
  }

  // ---- who may use M13 ----

  setAccess(token: string | undefined, csrf: unknown, key: string | readonly string[] | undefined, meta: { requestId: string }, b: { userId: string; level: 'NONE' | 'VIEW' | 'HANDLE'; expectedVersion: number }): Promise<IdempotentOutcome> {
    return this.#mutate(token, csrf, key, meta, { operation: 'admin.ops.access.set.v1', need: 'SYSTEM', logical: { user_id: b.userId, level: b.level, expected_version: b.expectedVersion }, resourceType: 'ops_admin_scope', resourceId: b.userId, message: 'Đổi quyền truy cập vận hành hệ thống' }, async (context, access) => {
      const m = await this.memberships.find(context, b.userId);
      // Rights are given to an active ADMIN only (SYSTEM has them implicitly and never has a row).
      if (m === undefined || m.adminRole !== 'ADMIN' || (b.level !== 'NONE' && m.status !== 'ACTIVE')) {
        throw new AppError('OPS_TARGET_NOT_FOUND');
      }
      const current = await this.repo.scopeOf(context, b.userId, true);
      if ((current?.version ?? 0) !== b.expectedVersion) {
        throw new AppError('VERSION_CONFLICT');
      }
      if (!(await this.repo.writeScope(context, b.userId, b.level, b.expectedVersion, access.userId))) {
        throw new AppError('VERSION_CONFLICT');
      }
      return { payload: { user_id: b.userId, level: b.level, version: b.expectedVersion + 1 }, version: b.expectedVersion + 1, audit: { user_id: b.userId, from: current?.level ?? 'NONE', to: b.level } };
    });
  }

  // ---- releases ----

  async releasesView(token: string | undefined, q: { component: string | null; limit: number; offset: number }): Promise<JsonObject> {
    return this.#read(token, 'VIEW', async (context, access) => {
      const now = access.nowMs;
      const page = await this.releases.listReleases(context, { component: q.component, limit: q.limit, offset: q.offset });
      const counts = await this.releases.versionCounts(context, 60);
      const deploys = await this.releases.listDeploys(context, { limit: 20, offset: 0 });
      const backendSelf = counts.find((c) => c.component === 'BACKEND');
      const components: JsonObject[] = [];
      for (const component of Object.keys(COMPONENT_LABEL) as (keyof typeof COMPONENT_LABEL)[]) {
        const latest = await this.releases.latestPublished(context, component);
        const reported = counts.filter((c) => c.component === component);
        const running = reported[0];
        const newer = latest !== undefined && running !== undefined && (latest.versionCode !== null && running.versionCode !== null ? latest.versionCode > running.versionCode : latest.versionName !== running.versionName);
        components.push({
          component,
          label: COMPONENT_LABEL[component],
          // "Running" is only what devices or services REPORTED; a published release nobody reported is "available", not "installed".
          running: running === undefined ? null : { version_name: running.versionName, version_code: running.versionCode, reporters: running.reporters, last_reported_at: iso(running.lastReportedAtMs) },
          reported_versions: reported.map((r) => ({ version_name: r.versionName, version_code: r.versionCode, reporters: r.reporters })),
          published: latest === undefined ? null : releaseView(latest, {}),
          status: latest === undefined ? 'NO_RELEASE' : running === undefined ? 'NO_REPORT' : newer ? 'UPDATE_AVAILABLE' : 'CURRENT',
          status_label: latest === undefined ? 'Chưa phát hành' : running === undefined ? 'Chưa có báo cáo phiên bản đang chạy' : newer ? 'Có bản mới' : 'Mới nhất',
        });
      }
      void backendSelf;
      const reportersByVersion = new Map(counts.map((c) => [`${c.component}:${c.versionName}`, c.reporters]));
      return {
        updated_at: iso(now),
        components,
        releases: { items: page.rows.map((r) => releaseView(r, { reporters: reportersByVersion.get(`${r.component}:${r.versionName}`) ?? 0 })), total: page.total, limit: q.limit, offset: q.offset },
        deploys: deploys.rows.map(deployView),
        deploy_control: { available: false, missing: [...DEPLOY_CONTROL_MISSING] },
        gateway_update_rule: 'Gateway chỉ cập nhật khi đã dừng nhận việc mới và xử lý xong tác vụ cùng kết quả còn tồn; không bao giờ cập nhật giữa lúc đang gửi SMS.',
        android_note: 'Cập nhật Android giữ nguyên application ID và khóa ký để cài đè và giữ dữ liệu. Android luôn yêu cầu người dùng xác nhận cài đặt.',
        artifacts_available: this.#artifactDir !== undefined,
        viewer: { level: access.level },
      };
    });
  }

  /** SHA-256 and size of a release file, computed by the server from its own artifact directory (never a path from the request; symlinks refused). */
  async #measureArtifact(name: string): Promise<{ name: string; sha256: string; sizeBytes: number }> {
    if (this.#artifactDir === undefined) {
      throw new AppError('OPS_ARTIFACT_UNAVAILABLE');
    }
    const full = path.resolve(this.#artifactDir, name);
    if (path.dirname(full) !== path.resolve(this.#artifactDir)) {
      throw new AppError('OPS_ARTIFACT_INVALID');
    }
    let size: number;
    try {
      const stat = lstatSync(full);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 1_073_741_824) {
        throw new AppError('OPS_ARTIFACT_INVALID');
      }
      size = stat.size;
    } catch (error) {
      throw error instanceof AppError ? error : new AppError('OPS_ARTIFACT_INVALID');
    }
    const hash = createHash('sha256');
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(full);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve());
      stream.on('error', () => reject(new AppError('OPS_ARTIFACT_INVALID')));
    });
    return { name, sha256: hash.digest('hex'), sizeBytes: size };
  }

  async createRelease(token: string | undefined, csrf: unknown, key: string | readonly string[] | undefined, meta: { requestId: string }, b: ReleaseBody): Promise<IdempotentOutcome> {
    // Authorization comes first (a caller without the right learns nothing about the artifact directory); the file is then measured BEFORE the write transaction (it can be large).
    await this.#read(token, 'SYSTEM', async () => undefined);
    const artifact = b.artifactName === null ? null : await this.#measureArtifact(b.artifactName);
    return this.#mutate(
      token,
      csrf,
      key,
      meta,
      { operation: 'admin.ops.release.create.v1', need: 'SYSTEM', logical: { component: b.component, version_name: b.versionName, version_code: b.versionCode, artifact: b.artifactName, sha256: artifact?.sha256 ?? null, priority: b.priority }, resourceType: 'ops_release', resourceId: `${b.component}:${b.versionName}`, message: `Đăng ký bản phát hành ${b.component} ${b.versionName}` },
      async (context, access) => {
        const row = await this.releases.insertRelease(context, { releaseId: randomUUID(), component: b.component, versionName: b.versionName, versionCode: b.versionCode, releaseNotes: b.releaseNotes, artifact, minBackendVersion: b.minBackendVersion, minSupportedVersionCode: b.minSupportedVersionCode, compatibilityNote: b.compatibilityNote, priority: b.priority, requiredReason: b.requiredReason, hasDbMigration: b.hasDbMigration, rollbackNote: b.rollbackNote, createdBy: access.userId });
        if (row === undefined) {
          throw new AppError('OPS_RELEASE_CONFLICT');
        }
        return { payload: releaseView(row, {}), version: 1, audit: { release_id: row.releaseId, component: b.component, version_name: b.versionName, sha256: artifact?.sha256 ?? null, size_bytes: artifact?.sizeBytes ?? null } };
      },
    );
  }

  async #releaseStatus(token: string | undefined, csrf: unknown, key: string | readonly string[] | undefined, meta: { requestId: string }, id: string, expectedVersion: number, to: 'PUBLISHED' | 'WITHDRAWN'): Promise<IdempotentOutcome> {
    await this.#read(token, 'SYSTEM', async () => undefined);
    const pre = to === 'PUBLISHED' ? await this.transactions.withTransaction((context) => this.releases.findRelease(context, id)) : undefined;
    // Publishing re-measures the file: a file that changed or vanished since registration is refused, so devices are never offered an artifact the server cannot vouch for.
    const remeasured = pre?.artifactName == null ? null : await this.#measureArtifact(pre.artifactName);
    return this.#mutate(token, csrf, key, meta, { operation: `admin.ops.release.${to === 'PUBLISHED' ? 'publish' : 'withdraw'}.v1`, need: 'SYSTEM', logical: { release_id: id, expected_version: expectedVersion }, resourceType: 'ops_release', resourceId: id, message: to === 'PUBLISHED' ? 'Phát hành bản cập nhật' : 'Thu hồi bản cập nhật' }, async (context) => {
      const current = await this.releases.findRelease(context, id, true);
      if (current === undefined) {
        throw new AppError('OPS_RELEASE_NOT_FOUND');
      }
      if (current.version !== expectedVersion) {
        throw new AppError('VERSION_CONFLICT');
      }
      if ((to === 'PUBLISHED' && current.status !== 'DRAFT') || (to === 'WITHDRAWN' && current.status !== 'PUBLISHED')) {
        throw new AppError('OPS_RELEASE_CONFLICT');
      }
      if (to === 'PUBLISHED' && current.artifactName !== null && (remeasured === null || remeasured.sha256 !== current.artifactSha256 || remeasured.sizeBytes !== current.artifactSizeBytes)) {
        throw new AppError('OPS_ARTIFACT_INVALID');
      }
      const row = await this.releases.setReleaseStatus(context, id, expectedVersion, to);
      if (row === undefined) {
        throw new AppError('VERSION_CONFLICT');
      }
      return { payload: releaseView(row, {}), version: row.version, audit: { release_id: id, component: row.component, version_name: row.versionName, status: to } };
    });
  }

  publishRelease(token: string | undefined, csrf: unknown, key: string | readonly string[] | undefined, meta: { requestId: string }, id: string, expectedVersion: number): Promise<IdempotentOutcome> {
    return this.#releaseStatus(token, csrf, key, meta, id, expectedVersion, 'PUBLISHED');
  }

  withdrawRelease(token: string | undefined, csrf: unknown, key: string | readonly string[] | undefined, meta: { requestId: string }, id: string, expectedVersion: number): Promise<IdempotentOutcome> {
    return this.#releaseStatus(token, csrf, key, meta, id, expectedVersion, 'WITHDRAWN');
  }

  static readonly ingestScopes: readonly IngestKeyScope[] = ['PROBE', 'BACKUP', 'DEPLOY'];
  static reporterRef = hashRef;
}
