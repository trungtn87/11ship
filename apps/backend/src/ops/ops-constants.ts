// Fixed vocabulary of M13 (operations, alerts and updates). Nothing here is configuration (thresholds are in ops-settings.ts).

export const OPS_SOURCES = [
  'API',
  'DATABASE',
  'SERVER',
  'WORKER',
  'BACKUP',
  'HTTPS',
  'SMS_GATEWAY',
  'EXTERNAL_PROBE',
  'APP_FOOD',
  'APP_SHIP',
  'NOTIFICATIONS',
  'M14',
  'DEPLOY',
  'OPS',
] as const;
export type OpsSource = (typeof OPS_SOURCES)[number];

/** Vietnamese label of each source (the Administration prints it; "shipper" is the product word). */
export const SOURCE_LABEL: Readonly<Record<OpsSource, string>> = {
  API: 'API',
  DATABASE: 'Database',
  SERVER: 'Máy chủ',
  WORKER: 'Worker / hàng đợi',
  BACKUP: 'Sao lưu',
  HTTPS: 'HTTPS',
  SMS_GATEWAY: 'SMS Gateway',
  EXTERNAL_PROBE: 'Giám sát ngoài VPS',
  APP_FOOD: 'App 11Food',
  APP_SHIP: 'App 11Ship (shipper)',
  NOTIFICATIONS: 'Thông báo (M08)',
  M14: 'GPS / bản đồ (M14)',
  DEPLOY: 'Triển khai',
  OPS: 'Vận hành',
};

export function isOpsSource(value: unknown): value is OpsSource {
  return typeof value === 'string' && (OPS_SOURCES as readonly string[]).includes(value);
}

export type CheckState = 'OK' | 'WARNING' | 'CRITICAL' | 'UNKNOWN';
export type IncidentSeverity = 'WARNING' | 'CRITICAL';
export type DiscordSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export const INCIDENT_STATUSES = ['NEW', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RECOVERED', 'CLOSED'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];
/** Statuses an incident has while it still needs somebody (or is waiting to be confirmed). CLOSED is the only way out. */
export const LIVE_INCIDENT_STATUSES: readonly IncidentStatus[] = ['NEW', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RECOVERED'];

export type DetectedBy = 'INTERNAL' | 'EXTERNAL_PROBE' | 'APP_REPORT';

export type EventCategory = 'TECHNICAL' | 'INCIDENT' | 'ADMIN';
export type EventLevel = 'INFO' | 'WARN' | 'ERROR';

export type NotificationKind = 'OPEN' | 'REMINDER' | 'ESCALATION' | 'RECOVERY' | 'SNOOZE_END' | 'TEST' | 'DEPLOY' | 'MAINTENANCE';

export const RELEASE_COMPONENTS = ['FOOD', 'SHIP', 'GATEWAY', 'WEB_ADMIN', 'BACKEND', 'M14', 'MAP_PACK'] as const;
export type ReleaseComponent = (typeof RELEASE_COMPONENTS)[number];
/** The components distributed as an Android package (they carry a versionCode and can be downloaded). */
export const ANDROID_COMPONENTS: readonly ReleaseComponent[] = ['FOOD', 'SHIP', 'GATEWAY'];
export const COMPONENT_LABEL: Readonly<Record<ReleaseComponent, string>> = {
  FOOD: '11Food',
  SHIP: '11Ship',
  GATEWAY: 'SMS Gateway',
  WEB_ADMIN: 'Web Admin',
  BACKEND: 'Backend / worker',
  M14: 'Dịch vụ M14',
  MAP_PACK: 'Gói bản đồ',
};

/** The Android applicationIds the update flow serves. They are NOT configurable here: M13 never changes an application id or a signing key. */
export const APPLICATION_IDS: Readonly<Record<'FOOD' | 'SHIP' | 'GATEWAY', string>> = {
  FOOD: 'vn.eleven.food.test',
  SHIP: 'vn.eleven.ship.test',
  GATEWAY: 'vn.eleven.gateway.test',
};

export const RELEASE_PRIORITIES = ['NORMAL', 'RECOMMENDED', 'REQUIRED'] as const;
export type ReleasePriority = (typeof RELEASE_PRIORITIES)[number];
export type ReleaseStatus = 'DRAFT' | 'PUBLISHED' | 'WITHDRAWN';

export const DEPLOY_STATUSES = ['RUNNING', 'SUCCEEDED', 'FAILED', 'ROLLED_BACK'] as const;
export type DeployStatus = (typeof DEPLOY_STATUSES)[number];

/** Gateway check keys: `gateway.<device uuid>.<facet>`. */
export const GATEWAY_FACETS = ['contact', 'battery', 'power', 'sms_failures', 'otp_queue'] as const;
export type GatewayFacet = (typeof GATEWAY_FACETS)[number];
export const gatewayCheckKey = (deviceId: string, facet: GatewayFacet): string => `gateway.${deviceId}.${facet}`;

/** Fixed (non-gateway) check keys. Disk checks are `disk.<label>`. */
export const CHECK_API = 'api';
export const CHECK_DATABASE = 'database';
export const CHECK_CPU = 'cpu';
export const CHECK_MEMORY = 'memory';
export const CHECK_WORKER = 'worker';
export const CHECK_OUTBOX = 'outbox';
export const CHECK_HTTPS = 'https';
export const CHECK_BACKUP = 'backup';
export const CHECK_RESTORE_TEST = 'restore_test';
export const CHECK_PUBLIC_API = 'public_api';
export const CHECK_EXTERNAL_PROBE = 'external_probe';
export const CHECK_NOTIFICATIONS = 'notifications';
export const CHECK_M14 = 'm14';
export const CHECK_OTP_SEND = 'otp_sending';

/** Where a request for the ingest endpoints identifies itself. */
export const INGEST_KEY_SCOPES = ['PROBE', 'BACKUP', 'DEPLOY'] as const;
export type IngestKeyScope = (typeof INGEST_KEY_SCOPES)[number];

/** The client-side log kinds an app may report (no free text decides what an incident is). */
export const CLIENT_LOG_KINDS = ['CRASH', 'ACTION_ERROR', 'PUSH_ERROR', 'MAP_ERROR', 'ROUTE_ERROR', 'GPS_STALE'] as const;
export type ClientLogKind = (typeof CLIENT_LOG_KINDS)[number];

export const SEVERITY_RANK: Readonly<Record<DiscordSeverity, number>> = { INFO: 0, WARNING: 1, CRITICAL: 2 };

export const ACCESS_LEVELS = ['NONE', 'VIEW', 'HANDLE'] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

/** The only Discord hosts a webhook may point at (the URL is validated, never fetched from anywhere else). */
export const DISCORD_WEBHOOK_HOSTS: readonly string[] = ['discord.com', 'discordapp.com', 'canary.discord.com', 'ptb.discord.com'];

/** Artifact files are served only from the server's own directory by a name stored on the release (never a client-supplied path). */
export const ARTIFACT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
export const MAX_ARTIFACT_BYTES = 1_073_741_824;
