import { Failure } from './accounts.js';

// Types and wording of "Vận hành hệ thống" (M13): overview, incidents, SMS Gateway, log, versions & updates, configuration & maintenance. Pure data: no DOM
// and no network. The page draws what the server said. A missing or stale measurement is "Chưa có dữ liệu" / "Dữ liệu cũ", never green; a cause is shown only
// when the server's evidence names it; the Discord webhook never reaches this code (the server only says "configured").

export const OPS_PAGE_SIZE = 20;

export type OpsLevel = 'SYSTEM' | 'HANDLE' | 'VIEW' | 'NONE';
export type DisplayState = 'OK' | 'WARNING' | 'CRITICAL' | 'NO_DATA' | 'STALE';
export type Severity = 'WARNING' | 'CRITICAL';
export const INCIDENT_STATUSES = ['NEW', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RECOVERED', 'CLOSED'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const STATE_LABEL: Record<DisplayState, string> = { OK: 'Hoạt động', WARNING: 'Cảnh báo', CRITICAL: 'Nghiêm trọng', NO_DATA: 'Chưa có dữ liệu', STALE: 'Dữ liệu cũ' };
export const STATUS_LABEL: Record<IncidentStatus, string> = { NEW: 'Mới phát hiện', ACKNOWLEDGED: 'Đã nhận xử lý', IN_PROGRESS: 'Đang xử lý', RECOVERED: 'Đã phục hồi', CLOSED: 'Đóng' };
export const SEVERITY_LABEL: Record<Severity, string> = { WARNING: 'Cảnh báo', CRITICAL: 'Nghiêm trọng' };
export const LEVEL_LABEL: Record<OpsLevel, string> = { SYSTEM: 'SYSTEM', HANDLE: 'Xem và xử lý', VIEW: 'Chỉ xem', NONE: 'Không có quyền' };

export const SOURCE_FILTERS: ReadonlyArray<readonly [string, string]> = [
  ['', 'Tất cả nguồn'],
  ['API', 'API'],
  ['DATABASE', 'Database'],
  ['SERVER', 'Máy chủ'],
  ['WORKER', 'Worker / hàng đợi'],
  ['BACKUP', 'Sao lưu'],
  ['HTTPS', 'HTTPS'],
  ['SMS_GATEWAY', 'SMS Gateway'],
  ['EXTERNAL_PROBE', 'Giám sát ngoài VPS'],
  ['APP_FOOD', 'App 11Food'],
  ['APP_SHIP', 'App 11Ship (shipper)'],
  ['NOTIFICATIONS', 'Thông báo (M08)'],
  ['M14', 'GPS / bản đồ (M14)'],
  ['DEPLOY', 'Triển khai'],
  ['OPS', 'Vận hành'],
];

export const MAINTENANCE_SCOPE_OPTIONS = SOURCE_FILTERS.filter(([value]) => value !== '');

export interface OpsComponent {
  readonly key: string;
  readonly label: string;
  readonly state: DisplayState;
  readonly detail: string | null;
  readonly note: string | null;
  readonly observedAt: string | null;
}

export interface OpsIncident {
  readonly id: string;
  readonly code: string;
  readonly source: string;
  readonly sourceLabel: string;
  readonly severity: Severity;
  readonly status: IncidentStatus;
  readonly title: string;
  readonly impact: string;
  readonly detectedBy: string;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly occurrences: number;
  readonly assigneeLabel: string | null;
  readonly acknowledgedAt: string | null;
  readonly firstViewedAt: string | null;
  readonly recoveredAt: string | null;
  readonly closedAt: string | null;
  readonly closedWhileFailing: boolean;
  readonly snoozedUntil: string | null;
  readonly inMaintenance: boolean;
  readonly checkState: DisplayState | null;
  readonly version: number;
}

export interface OpsDeploy {
  readonly id: string;
  readonly componentLabel: string;
  readonly fromVersion: string | null;
  readonly toVersion: string;
  readonly status: string;
  readonly hasDbMigration: boolean;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly healthResult: string | null;
  readonly healthDetail: string | null;
}

export interface OpsMaintenance {
  readonly id: string;
  readonly scopeLabels: readonly string[];
  readonly reason: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly state: 'ACTIVE' | 'SCHEDULED' | 'ENDED' | 'CANCELLED';
}

export interface OpsOverview {
  readonly updatedAt: string;
  readonly dataNote: string | null;
  readonly components: readonly OpsComponent[];
  readonly open: number;
  readonly critical: number;
  readonly unacknowledged: number;
  readonly incidents: readonly OpsIncident[];
  readonly probe: { readonly activated: boolean; readonly label: string; readonly lastReportAt: string | null; readonly note: string };
  readonly discord: { readonly enabled: boolean; readonly configured: boolean; readonly pending: number; readonly failed7d: number; readonly lastSentAt: string | null };
  readonly maintenance: readonly OpsMaintenance[];
  readonly lastUpdate: OpsDeploy | null;
  readonly level: OpsLevel;
}

export interface IncidentQuery {
  readonly status: 'OPEN' | 'ALL' | IncidentStatus;
  readonly severity: '' | Severity;
  readonly source: string;
  readonly assignee: '' | 'NONE';
  readonly from: string;
  readonly to: string;
  readonly search: string;
  readonly page: number;
}

export interface TimelineEntry {
  readonly at: string;
  readonly kind: string;
  readonly level: string;
  readonly message: string;
  readonly actor: string | null;
}

export interface NoticeRecord {
  readonly kindLabel: string;
  readonly outcome: string;
  readonly attempts: number;
  readonly createdAt: string;
  readonly sentAt: string | null;
  readonly errorCode: string | null;
}

export interface IncidentDetail {
  readonly incident: OpsIncident;
  readonly evidenceText: string | null;
  readonly evidence: Record<string, unknown>;
  readonly currentCheck: { readonly state: DisplayState; readonly evidence: string | null; readonly observedAt: string | null; readonly value: Record<string, unknown> };
  readonly timeline: readonly TimelineEntry[];
  readonly notices: readonly NoticeRecord[];
  readonly recentErrors: readonly TimelineEntry[];
  readonly link: string | null;
  readonly actions: { readonly acknowledge: boolean; readonly start: boolean; readonly note: boolean; readonly snooze: boolean; readonly close: boolean; readonly assign: boolean };
  readonly readNote: string;
}

export type IncidentAction =
  | { readonly kind: 'acknowledge'; readonly version: number }
  | { readonly kind: 'start'; readonly version: number }
  | { readonly kind: 'note'; readonly text: string }
  | { readonly kind: 'snooze'; readonly version: number; readonly minutes: number }
  | { readonly kind: 'close'; readonly version: number; readonly confirmStillFailing: boolean; readonly note: string };

export interface GatewayCheck {
  readonly state: DisplayState;
  readonly evidence: string | null;
  readonly value: Record<string, unknown>;
}

export interface GatewayDevice {
  readonly id: string;
  readonly label: string;
  readonly state: DisplayState;
  readonly lastContactAt: string | null;
  readonly appVersion: string | null;
  readonly smsPermission: boolean | null;
  readonly paused: boolean | null;
  readonly batteryPercent: number | null;
  readonly charging: boolean | null;
  readonly simStateLabel: string;
  readonly simBalanceLabel: string;
  readonly topupNotedOn: string | null;
  readonly pendingReports: number | null;
  readonly currentTask: string | null;
  readonly lastErrorCode: string | null;
  readonly telemetryAt: string | null;
  readonly checks: Readonly<Record<'contact' | 'battery' | 'power' | 'sms_failures', GatewayCheck>>;
}

export interface QueueJob {
  readonly at: string;
  readonly purposeLabel: string;
  readonly statusLabel: string;
  readonly status: string;
  readonly resultCode: string | null;
  readonly recipientTail: string;
}

export interface GatewayPage {
  readonly updatedAt: string;
  readonly devices: readonly GatewayDevice[];
  readonly queue: { readonly queued: number; readonly claimed: number; readonly failedLastHour: number; readonly otpState: DisplayState; readonly otpEvidence: string | null; readonly purposesLabel: string; readonly jobs: readonly QueueJob[] };
  readonly discord: { readonly enabled: boolean; readonly configured: boolean; readonly webhookMasked: string | null; readonly updatedAt: string | null; readonly minSeverity: string } | null;
  readonly maintenance: readonly OpsMaintenance[];
  readonly level: OpsLevel;
}

export type LogGroup = '' | 'TECHNICAL' | 'INCIDENT' | 'ADMIN';

export interface LogQuery {
  readonly group: LogGroup;
  readonly source: string;
  readonly level: '' | 'INFO' | 'WARN' | 'ERROR';
  readonly code: string;
  readonly deliveryCode: string;
  readonly userId: string;
  readonly appVersion: string;
  readonly from: string;
  readonly to: string;
  readonly page: number;
}

export interface LogRow {
  readonly id: string;
  readonly at: string;
  readonly category: string;
  readonly level: string;
  readonly sourceLabel: string;
  readonly environment: string;
  readonly appVersion: string | null;
  readonly code: string | null;
  readonly message: string;
  readonly requestRef: string | null;
  readonly deliveryCode: string | null;
  readonly userId: string | null;
  readonly actor: string | null;
}

export interface ReleaseRow {
  readonly id: string;
  readonly component: string;
  readonly componentLabel: string;
  readonly versionName: string;
  readonly versionCode: number | null;
  readonly releaseNotes: string;
  readonly artifact: { readonly name: string; readonly sha256: string | null; readonly sizeBytes: number | null } | null;
  readonly priority: string;
  readonly requiredReason: string | null;
  readonly status: 'DRAFT' | 'PUBLISHED' | 'WITHDRAWN';
  readonly releasedAt: string | null;
  readonly hasDbMigration: boolean;
  readonly rollbackWarning: string | null;
  readonly reportersRunning: number | null;
  readonly version: number;
}

export interface ComponentVersion {
  readonly component: string;
  readonly label: string;
  readonly running: { readonly versionName: string; readonly versionCode: number | null; readonly reporters: number; readonly lastReportedAt: string } | null;
  readonly published: ReleaseRow | null;
  readonly status: string;
  readonly statusLabel: string;
  /** #193: the backend's minimum client build and whether a downloadable APK meets it (null for components without one). */
  readonly compatibility: { readonly ok: boolean; readonly minClientVersionCode: number; readonly summary: string } | null;
}

export interface ReleasesPage {
  readonly updatedAt: string;
  readonly components: readonly ComponentVersion[];
  readonly releases: readonly ReleaseRow[];
  readonly total: number;
  readonly deploys: readonly OpsDeploy[];
  readonly deployControl: { readonly available: boolean; readonly missing: readonly string[] };
  readonly gatewayRule: string;
  readonly androidNote: string;
  readonly artifactsAvailable: boolean;
  readonly level: OpsLevel;
}

export interface ReleaseDraft {
  readonly component: string;
  readonly versionName: string;
  readonly versionCode: string;
  readonly releaseNotes: string;
  readonly artifactName: string;
  readonly priority: 'NORMAL' | 'RECOMMENDED' | 'REQUIRED';
  readonly requiredReason: string;
  readonly minSupportedVersionCode: string;
  readonly hasDbMigration: boolean;
  readonly rollbackNote: string;
}

export interface SettingRow {
  readonly key: string;
  readonly group: 'gateway' | 'server' | 'alert' | 'app' | 'retention';
  readonly label: string;
  readonly unit: string;
  readonly value: number;
  readonly default: number;
  readonly min: number;
  readonly max: number;
  readonly implDefault: boolean;
}

export interface OpsConfigPage {
  readonly updatedAt: string;
  readonly version: number;
  readonly editable: boolean;
  readonly settings: readonly SettingRow[];
  readonly discord: { readonly enabled: boolean; readonly minSeverity: 'WARNING' | 'CRITICAL'; readonly webhookConfigured: boolean; readonly webhookMasked: string | null; readonly webhookUpdatedAt: string | null } | null;
  readonly maintenance: readonly OpsMaintenance[];
  readonly access: ReadonlyArray<{ readonly userId: string; readonly label: string | null; readonly level: OpsLevel; readonly version: number }> | null;
  readonly level: OpsLevel;
}

export interface ConfigSave {
  readonly key: string;
  readonly version: number;
  readonly settings: Readonly<Record<string, number>>;
  readonly discordEnabled: boolean;
  readonly minSeverity: 'WARNING' | 'CRITICAL';
  /** undefined = keep, null = remove, a string = replace (typed once into a password field; never read back). */
  readonly webhook: string | null | undefined;
}

export interface MaintenanceDraft {
  readonly key: string;
  readonly scopes: readonly string[];
  readonly reason: string;
  readonly endsAt: string;
}

export type OpsRead<T> = { readonly kind: 'ready'; readonly data: T } | { readonly kind: 'not-found' } | { readonly kind: 'failed'; readonly failure: Failure; readonly retryAfterSec?: number };

export type OpsWrite<T = undefined> =
  | { readonly kind: 'ok'; readonly data: T }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'state-conflict' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'session-expired' }
  | { readonly kind: 'rate-limited'; readonly retryAfterSec?: number }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'not-wired' };

export interface TestResult {
  readonly outcomeText: string;
  readonly status: string;
}

export interface OpsSource {
  me(): Promise<OpsRead<OpsLevel>>;
  overview(): Promise<OpsRead<OpsOverview>>;
  incidents(query: IncidentQuery): Promise<OpsRead<{ rows: readonly OpsIncident[]; total: number }>>;
  incident(ref: string): Promise<OpsRead<IncidentDetail>>;
  incidentAction(id: string, key: string, action: IncidentAction): Promise<OpsWrite>;
  gateway(): Promise<OpsRead<GatewayPage>>;
  topupNote(deviceId: string, key: string, date: string | null): Promise<OpsWrite>;
  logs(query: LogQuery): Promise<OpsRead<{ rows: readonly LogRow[]; total: number }>>;
  releases(page: number): Promise<OpsRead<ReleasesPage>>;
  createRelease(key: string, draft: ReleaseDraft): Promise<OpsWrite>;
  releaseStatus(id: string, key: string, version: number, to: 'publish' | 'withdraw'): Promise<OpsWrite>;
  config(): Promise<OpsRead<OpsConfigPage>>;
  saveConfig(request: ConfigSave): Promise<OpsWrite<OpsConfigPage>>;
  discordTest(key: string): Promise<OpsWrite<TestResult>>;
  createMaintenance(draft: MaintenanceDraft): Promise<OpsWrite>;
  cancelMaintenance(id: string, key: string): Promise<OpsWrite>;
  setAccess(userId: string, level: OpsLevel, version: number, key: string): Promise<OpsWrite>;
}

const NOT_WIRED_READ = { kind: 'failed', failure: 'unknown' } as const;
const NOT_WIRED_WRITE = { kind: 'not-wired' } as const;

/** Nothing wired: every page says it cannot read, every control reports "not wired". No sample data exists in the real build. */
export const NOT_WIRED_OPS: OpsSource = {
  me: async () => NOT_WIRED_READ,
  overview: async () => NOT_WIRED_READ,
  incidents: async () => NOT_WIRED_READ,
  incident: async () => NOT_WIRED_READ,
  incidentAction: async () => NOT_WIRED_WRITE,
  gateway: async () => NOT_WIRED_READ,
  topupNote: async () => NOT_WIRED_WRITE,
  logs: async () => NOT_WIRED_READ,
  releases: async () => NOT_WIRED_READ,
  createRelease: async () => NOT_WIRED_WRITE,
  releaseStatus: async () => NOT_WIRED_WRITE,
  config: async () => NOT_WIRED_READ,
  saveConfig: async () => NOT_WIRED_WRITE,
  discordTest: async () => NOT_WIRED_WRITE,
  createMaintenance: async () => NOT_WIRED_WRITE,
  cancelMaintenance: async () => NOT_WIRED_WRITE,
  setAccess: async () => NOT_WIRED_WRITE,
};

export const DEFAULT_INCIDENT_QUERY: IncidentQuery = { status: 'OPEN', severity: '', source: '', assignee: '', from: '', to: '', search: '', page: 1 };
export const DEFAULT_LOG_QUERY: LogQuery = { group: '', source: '', level: '', code: '', deliveryCode: '', userId: '', appVersion: '', from: '', to: '', page: 1 };

export const canHandle = (level: OpsLevel): boolean => level === 'SYSTEM' || level === 'HANDLE';

/** Reasons a write can fail, in words. */
export const WRITE_MESSAGE: Record<Exclude<OpsWrite['kind'], 'ok'>, string> = {
  conflict: 'Dữ liệu vừa được người khác thay đổi. Hãy tải lại rồi thử lại.',
  'state-conflict': 'Trạng thái hiện tại không cho phép thao tác này. Với việc đóng khi kiểm tra vẫn lỗi, hãy tick xác nhận và ghi lý do.',
  invalid: 'Thông tin chưa hợp lệ. Hãy kiểm tra các ô và thử lại.',
  forbidden: 'Bạn không có quyền thực hiện thao tác này.',
  'session-expired': 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.',
  'rate-limited': 'Bạn thao tác quá nhanh. Hãy thử lại sau ít phút.',
  unknown: 'Chưa biết kết quả thao tác. Hãy tải lại để xem trạng thái trước khi thử lại.',
  'not-wired': 'Chưa kết nối máy chủ.',
};
