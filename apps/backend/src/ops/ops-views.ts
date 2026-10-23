import { JsonObject } from '../idempotency/idempotency-executor';
import { CheckRow } from './ops-repository';
import { CheckState, COMPONENT_LABEL, ReleaseComponent, SOURCE_LABEL } from './ops-constants';
import { IncidentRow, MaintenanceRow, NotificationRow } from './ops-incident-repository';
import { DeployRow, ReleaseRow } from './ops-release-repository';
import { EventRow } from './ops-repository';

// Pure mappers from rows to the JSON the Administration receives, and the Vietnamese words for each state. Nothing here reads a clock except where a caller passes
// `nowMs`, and nothing here can show a made-up status: a missing or stale check is NO_DATA / STALE, never OK.

export const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

/** What a check looks like to a person. NO_DATA = "Chưa có dữ liệu"; STALE = measured once but not recently ("Dữ liệu cũ"): neither is green. */
export type DisplayState = 'OK' | 'WARNING' | 'CRITICAL' | 'NO_DATA' | 'STALE';

export function displayState(row: CheckRow | undefined, nowMs: number): DisplayState {
  if (row === undefined || row.state === 'UNKNOWN') return 'NO_DATA';
  if (nowMs - row.observedAtMs > row.staleAfterSeconds * 1000) return 'STALE';
  return row.state;
}

const WORST: Readonly<Record<DisplayState, number>> = { OK: 0, STALE: 1, NO_DATA: 1, WARNING: 2, CRITICAL: 3 };

/** The worst of several states (a failure beats "no data", which beats OK). An empty list is NO_DATA. */
export function worstState(states: readonly DisplayState[]): DisplayState {
  if (states.length === 0) return 'NO_DATA';
  return states.reduce((a, b) => (WORST[b] > WORST[a] ? b : a));
}

export const STATE_LABEL: Readonly<Record<DisplayState, string>> = {
  OK: 'Hoạt động',
  WARNING: 'Cảnh báo',
  CRITICAL: 'Nghiêm trọng',
  NO_DATA: 'Chưa có dữ liệu',
  STALE: 'Dữ liệu cũ',
};

export const INCIDENT_STATUS_LABEL = { NEW: 'Mới phát hiện', ACKNOWLEDGED: 'Đã nhận xử lý', IN_PROGRESS: 'Đang xử lý', RECOVERED: 'Đã phục hồi', CLOSED: 'Đóng' } as const;
export const SEVERITY_LABEL = { WARNING: 'Cảnh báo', CRITICAL: 'Nghiêm trọng' } as const;

export const SKIP_TEXT: Readonly<Record<string, string>> = {
  NOT_CONFIGURED: 'Chưa gửi: kênh Discord chưa được cấu hình',
  DISABLED: 'Chưa gửi: kênh Discord đang tắt',
  BELOW_MIN: 'Không gửi: dưới mức độ gửi tối thiểu',
  MAINTENANCE: 'Tạm ngừng gửi: đang bảo trì',
  EXTERNAL_SENT: 'Giám sát ngoài VPS đã gửi trực tiếp',
  SENT_DIRECT: 'Đã gửi trực tiếp khi database ngừng hoạt động',
  SUPERSEDED: 'Thay bằng tin mới hơn',
  STALE: 'Quá cũ nên không gửi nữa',
};

export const NOTIFICATION_KIND_LABEL: Readonly<Record<string, string>> = {
  OPEN: 'Sự cố mới',
  REMINDER: 'Nhắc chưa nhận xử lý',
  ESCALATION: 'Nâng mức',
  RECOVERY: 'Phục hồi',
  SNOOZE_END: 'Hết tạm hoãn',
  TEST: 'Gửi thử',
  DEPLOY: 'Triển khai',
  MAINTENANCE: 'Bảo trì',
};

export const EVIDENCE_TEXT: Readonly<Record<string, string>> = {
  NO_SIGNAL: 'Không nhận được tín hiệu từ Gateway',
  NEVER_CONTACTED: 'Gateway đã ghép cặp nhưng chưa liên lạc lần nào',
  CONTACT_OK: 'Đang liên lạc',
  BATTERY_LOW: 'Pin thấp và không sạc',
  CHARGING_UNKNOWN: 'Pin thấp nhưng chưa biết máy có đang sạc không',
  BATTERY_OK: 'Pin bình thường',
  UNPLUGGED: 'Máy bị ngắt sạc liên tục',
  CHARGING: 'Đang sạc',
  POWER_OK: 'Nguồn bình thường',
  SEND_FAILED_STREAK: 'Nhiều SMS liên tiếp báo gửi thất bại (không suy ra nguyên nhân)',
  SEND_OK: 'Gửi SMS bình thường',
  NO_SENDS_YET: 'Chưa có SMS nào được gửi',
  NO_RECENT_REPORT: 'Chưa có báo cáo gần đây từ máy',
  OTP_WAITING: 'Có OTP còn hiệu lực chờ quá lâu',
  QUEUE_OK: 'Hàng đợi bình thường',
  QUEUE_EMPTY: 'Không có OTP đang chờ',
  NO_GATEWAY_PAIRED: 'Chưa ghép Gateway nào',
  DISK_HIGH: 'Dung lượng đĩa cao',
  DISK_OK: 'Dung lượng đĩa bình thường',
  SUSTAINED_HIGH: 'Vượt ngưỡng liên tục',
  NOT_SUSTAINED: 'Chưa vượt ngưỡng liên tục',
  BELOW_THRESHOLD: 'Dưới ngưỡng',
  NO_DATA: 'Chưa có dữ liệu',
  CERT_EXPIRING: 'Chứng chỉ sắp hết hạn',
  CERT_OK: 'Chứng chỉ còn hạn',
  BACKUP_FAILED: 'Lần sao lưu gần nhất thất bại',
  BACKUP_OVERDUE: 'Quá hạn sao lưu theo lịch',
  BACKUP_OK: 'Sao lưu thành công, đúng hạn',
  NO_REPORT: 'Chưa có báo cáo sao lưu',
  RESTORE_OK: 'Đã thử khôi phục thành công',
  RESTORE_FAILED: 'Thử khôi phục thất bại',
  NEVER_TESTED: 'Chưa thử khôi phục lần nào',
  QUEUE_OVERDUE: 'Có tác vụ quá hạn trong hàng đợi',
  QUEUE_GROWING: 'Hàng đợi tiếp tục tăng',
  API_OK: 'API phục vụ bình thường',
  DB_OK: 'Database phản hồi bình thường',
  DB_UNREACHABLE: 'Database không phản hồi',
  WORKER_BEAT: 'Worker đang chạy',
  PROBE_SILENT: 'Giám sát ngoài VPS không báo cáo',
  NOTIFY_BACKLOG: 'Có thông báo nội bộ bị tồn',
  NOTIFY_OK: 'Thông báo nội bộ bình thường',
  M14_OK: 'M14 phản hồi',
  ERROR_BURST: 'Nhiều lỗi được báo về trong thời gian ngắn',
  ERRORS_BELOW_THRESHOLD: 'Số lỗi dưới ngưỡng',
  DISCORD_FAILED: 'Gửi Discord thất bại',
  DISCORD_OK: 'Gửi Discord thành công',
  PUBLIC_API_DOWN: 'Không truy cập được hệ thống từ bên ngoài',
  PUBLIC_API_OK: 'Giám sát ngoài VPS truy cập API công khai bình thường',
  PROBE_ALIVE: 'Giám sát ngoài VPS đang báo cáo',
};

export const evidenceText = (code: string | null): string | null => (code === null ? null : (EVIDENCE_TEXT[code] ?? code));

export function checkView(row: CheckRow | undefined, nowMs: number, fallbackLabel: string): JsonObject {
  const state = displayState(row, nowMs);
  return {
    state,
    label: STATE_LABEL[state],
    observed_at: iso(row?.observedAtMs ?? null),
    since: iso(row?.sinceAtMs ?? null),
    evidence_code: row?.evidenceCode ?? null,
    evidence: row === undefined ? `${fallbackLabel}: chưa có dữ liệu` : (evidenceText(row.evidenceCode) ?? null),
    value: (row?.value ?? {}) as JsonObject,
  };
}

export function incidentView(i: IncidentRow, o: { assigneeLabel: string | null; checkState: DisplayState | null; nowMs: number }): JsonObject {
  return {
    incident_id: i.incidentId,
    code: i.code,
    source: i.source,
    source_label: SOURCE_LABEL[i.source],
    check_key: i.checkKey,
    severity: i.severity,
    severity_label: SEVERITY_LABEL[i.severity],
    status: i.status,
    status_label: INCIDENT_STATUS_LABEL[i.status],
    title: i.title,
    impact: i.impact,
    detected_by: i.detectedBy,
    first_seen_at: iso(i.firstSeenAtMs),
    last_seen_at: iso(i.lastSeenAtMs),
    occurrences: i.occurrences,
    assignee_user_id: i.assigneeUserId,
    assignee_label: o.assigneeLabel,
    acknowledged_at: iso(i.acknowledgedAtMs),
    first_viewed_at: iso(i.firstViewedAtMs),
    recovered_at: iso(i.recoveredAtMs),
    closed_at: iso(i.closedAtMs),
    closed_while_failing: i.closedWhileFailing,
    snoozed_until: i.snoozedUntilMs !== null && i.snoozedUntilMs > o.nowMs ? iso(i.snoozedUntilMs) : null,
    in_maintenance: i.inMaintenance,
    // The real state of the check right now: a closed or acknowledged incident never hides a check that still fails.
    check_state: o.checkState,
    check_state_label: o.checkState === null ? null : STATE_LABEL[o.checkState],
    reopens_incident_id: i.reopensIncidentId,
    version: i.version,
  };
}

export function eventView(e: EventRow, actorLabel: string | null): JsonObject {
  return {
    event_id: e.eventId,
    at: iso(e.occurredAtMs),
    category: e.category,
    level: e.level,
    source: e.source,
    source_label: SOURCE_LABEL[e.source],
    environment: e.environment,
    app_version: e.appVersion,
    code: e.code,
    kind: e.kind,
    message: e.message,
    request_ref: e.requestRef,
    delivery_code: e.deliveryCode,
    transaction_ref: e.transactionRef,
    user_id: e.userId,
    incident_id: e.incidentId,
    actor_label: actorLabel,
    detail: e.detail as JsonObject,
  };
}

export function notificationView(n: NotificationRow): JsonObject {
  const outcome = n.status === 'SENT' ? 'Đã gửi' : n.status === 'FAILED' ? 'Gửi thất bại' : n.status === 'PENDING' ? 'Đang chờ gửi' : (SKIP_TEXT[n.skipReason ?? ''] ?? 'Không gửi');
  return {
    notification_id: n.notificationId,
    kind: n.kind,
    kind_label: NOTIFICATION_KIND_LABEL[n.kind] ?? n.kind,
    severity: n.severity,
    status: n.status,
    outcome_text: outcome,
    skip_reason: n.skipReason,
    attempts: n.attempts,
    last_error_code: n.lastErrorCode,
    last_http_status: n.lastHttpStatus,
    created_at: iso(n.createdAtMs),
    sent_at: iso(n.sentAtMs),
    next_attempt_at: n.status === 'PENDING' ? iso(n.nextAttemptAtMs) : null,
  };
}

export function maintenanceView(m: MaintenanceRow, nowMs: number): JsonObject {
  const state = m.cancelledAtMs !== null ? 'CANCELLED' : m.endsAtMs <= nowMs ? 'ENDED' : m.startsAtMs > nowMs ? 'SCHEDULED' : 'ACTIVE';
  return { maintenance_id: m.maintenanceId, scopes: m.scopes, scope_labels: m.scopes.map((s) => (SOURCE_LABEL as Record<string, string>)[s] ?? s), reason: m.reason, starts_at: iso(m.startsAtMs), ends_at: iso(m.endsAtMs), state, created_at: iso(m.createdAtMs), cancelled_at: iso(m.cancelledAtMs) };
}

export function releaseView(r: ReleaseRow, o: { reporters?: number }): JsonObject {
  return {
    release_id: r.releaseId,
    component: r.component,
    component_label: COMPONENT_LABEL[r.component],
    version_name: r.versionName,
    version_code: r.versionCode,
    release_notes: r.releaseNotes,
    // The file name is the SERVER's own file; its checksum and size were computed from that file when the release was registered.
    artifact: r.artifactName === null ? null : { name: r.artifactName, sha256: r.artifactSha256, size_bytes: r.artifactSizeBytes },
    min_backend_version: r.minBackendVersion,
    min_supported_version_code: r.minSupportedVersionCode,
    compatibility_note: r.compatibilityNote,
    priority: r.priority,
    required_reason: r.requiredReason,
    status: r.status,
    released_at: iso(r.releasedAtMs),
    has_db_migration: r.hasDbMigration,
    rollback_note: r.rollbackNote,
    // A database migration cannot be promised to roll back with the application: it is assessed on its own.
    rollback_warning: r.hasDbMigration ? 'Bản này có thay đổi cơ sở dữ liệu: quay lại bản ứng dụng không tự khôi phục cơ sở dữ liệu, cần đánh giá riêng.' : null,
    reporters_running: o.reporters ?? null,
    created_at: iso(r.createdAtMs),
    version: r.version,
  };
}

export function deployView(d: DeployRow): JsonObject {
  return {
    deploy_id: d.deployId,
    component: d.component,
    component_label: (COMPONENT_LABEL as Record<string, string>)[d.component] ?? d.component,
    from_version: d.fromVersion,
    to_version: d.toVersion,
    release_id: d.releaseId,
    status: d.status,
    has_db_migration: d.hasDbMigration,
    started_at: iso(d.startedAtMs),
    finished_at: iso(d.finishedAtMs),
    health_result: d.healthResult,
    health_checked_at: iso(d.healthCheckedAtMs),
    health_detail: d.healthDetail,
    note: d.note,
  };
}

export const RELEASE_COMPONENT_KEYS: readonly ReleaseComponent[] = ['FOOD', 'SHIP', 'GATEWAY', 'WEB_ADMIN', 'BACKEND', 'M14', 'MAP_PACK'];

export type { CheckState };
