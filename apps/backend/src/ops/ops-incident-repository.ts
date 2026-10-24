import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../transaction/transaction-context';
import { DetectedBy, DiscordSeverity, IncidentSeverity, IncidentStatus, NotificationKind, OpsSource } from './ops-constants';
import { redactDetail, redactText } from './ops-redact';
import { CLOCK, fromMs, jsonOf, ms, num, numOrNull } from './ops-sql';

// SQL of incidents, the Discord message rows and the maintenance windows (M13). Same rules as the other repositories: the caller's transaction, no policy.

export interface IncidentRow {
  readonly incidentId: string;
  readonly codeSeq: number;
  /** SC-013 style code shown to people. */
  readonly code: string;
  readonly fingerprint: string;
  readonly source: OpsSource;
  readonly checkKey: string;
  readonly severity: IncidentSeverity;
  readonly status: IncidentStatus;
  readonly title: string;
  readonly impact: string;
  readonly detectedBy: DetectedBy;
  readonly firstSeenAtMs: number;
  readonly lastSeenAtMs: number;
  readonly occurrences: number;
  readonly evidence: Record<string, unknown>;
  readonly assigneeUserId: string | null;
  readonly acknowledgedAtMs: number | null;
  readonly firstViewedAtMs: number | null;
  readonly firstViewedBy: string | null;
  readonly recoveredAtMs: number | null;
  readonly closedAtMs: number | null;
  readonly closedBy: string | null;
  readonly closedWhileFailing: boolean;
  readonly reopensIncidentId: string | null;
  readonly snoozedUntilMs: number | null;
  readonly snoozeNoticePending: boolean;
  readonly lastNotifiedAtMs: number | null;
  readonly lastReminderAtMs: number | null;
  readonly successStreak: number;
  readonly inMaintenance: boolean;
  readonly externalNotified: boolean;
  readonly version: number;
}

export const incidentCode = (seq: number): string => `SC-${String(seq).padStart(3, '0')}`;

/** "SC-013" or "13" -> 13; anything else undefined. */
export function parseIncidentCode(value: string): number | undefined {
  const m = /^(?:SC-)?([0-9]{1,9})$/i.exec(value.trim());
  return m === null ? undefined : Number(m[1]);
}

const COLUMNS = `incident_id, code_seq::text AS code_seq, fingerprint, source, check_key, severity, status, title, impact, detected_by,
  ${ms('first_seen_at', 'first_ms')}, ${ms('last_seen_at', 'last_ms')}, occurrences, evidence, assignee_user_id,
  CASE WHEN acknowledged_at IS NULL THEN NULL ELSE (extract(epoch FROM acknowledged_at) * 1000)::bigint::text END AS ack_ms,
  CASE WHEN first_viewed_at IS NULL THEN NULL ELSE (extract(epoch FROM first_viewed_at) * 1000)::bigint::text END AS viewed_ms, first_viewed_by,
  CASE WHEN recovered_at IS NULL THEN NULL ELSE (extract(epoch FROM recovered_at) * 1000)::bigint::text END AS recovered_ms,
  CASE WHEN closed_at IS NULL THEN NULL ELSE (extract(epoch FROM closed_at) * 1000)::bigint::text END AS closed_ms, closed_by, closed_while_failing, reopens_incident_id,
  CASE WHEN snoozed_until IS NULL THEN NULL ELSE (extract(epoch FROM snoozed_until) * 1000)::bigint::text END AS snooze_ms, snooze_notice_pending,
  CASE WHEN last_notified_at IS NULL THEN NULL ELSE (extract(epoch FROM last_notified_at) * 1000)::bigint::text END AS notified_ms,
  CASE WHEN last_reminder_at IS NULL THEN NULL ELSE (extract(epoch FROM last_reminder_at) * 1000)::bigint::text END AS reminder_ms,
  success_streak, in_maintenance, external_notified, version::text AS version`;

interface IncidentDbRow {
  incident_id: string;
  code_seq: string;
  fingerprint: string;
  source: OpsSource;
  check_key: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  title: string;
  impact: string;
  detected_by: DetectedBy;
  first_ms: string;
  last_ms: string;
  occurrences: number;
  evidence: Record<string, unknown>;
  assignee_user_id: string | null;
  ack_ms: string | null;
  viewed_ms: string | null;
  first_viewed_by: string | null;
  recovered_ms: string | null;
  closed_ms: string | null;
  closed_by: string | null;
  closed_while_failing: boolean;
  reopens_incident_id: string | null;
  snooze_ms: string | null;
  snooze_notice_pending: boolean;
  notified_ms: string | null;
  reminder_ms: string | null;
  success_streak: number;
  in_maintenance: boolean;
  external_notified: boolean;
  version: string;
}

const incidentOf = (r: IncidentDbRow): IncidentRow => ({
  incidentId: r.incident_id,
  codeSeq: num(r.code_seq),
  code: incidentCode(num(r.code_seq)),
  fingerprint: r.fingerprint,
  source: r.source,
  checkKey: r.check_key,
  severity: r.severity,
  status: r.status,
  title: r.title,
  impact: r.impact,
  detectedBy: r.detected_by,
  firstSeenAtMs: num(r.first_ms),
  lastSeenAtMs: num(r.last_ms),
  occurrences: r.occurrences,
  evidence: r.evidence,
  assigneeUserId: r.assignee_user_id,
  acknowledgedAtMs: numOrNull(r.ack_ms),
  firstViewedAtMs: numOrNull(r.viewed_ms),
  firstViewedBy: r.first_viewed_by,
  recoveredAtMs: numOrNull(r.recovered_ms),
  closedAtMs: numOrNull(r.closed_ms),
  closedBy: r.closed_by,
  closedWhileFailing: r.closed_while_failing,
  reopensIncidentId: r.reopens_incident_id,
  snoozedUntilMs: numOrNull(r.snooze_ms),
  snoozeNoticePending: r.snooze_notice_pending,
  lastNotifiedAtMs: numOrNull(r.notified_ms),
  lastReminderAtMs: numOrNull(r.reminder_ms),
  successStreak: r.success_streak,
  inMaintenance: r.in_maintenance,
  externalNotified: r.external_notified,
  version: num(r.version),
});

export interface NewIncident {
  readonly incidentId: string;
  readonly fingerprint: string;
  readonly source: OpsSource;
  readonly checkKey: string;
  readonly severity: IncidentSeverity;
  readonly title: string;
  readonly impact: string;
  readonly detectedBy: DetectedBy;
  /** When the failure started (the probe knows it; internal detection = now). */
  readonly firstSeenAtMs?: number;
  readonly lastSeenAtMs?: number;
  readonly occurrences?: number;
  readonly evidence: Record<string, unknown>;
  readonly reopensIncidentId?: string | null;
  readonly inMaintenance: boolean;
  readonly externalNotified?: boolean;
  /** A recovered-on-arrival incident (the probe synced a finished outage). */
  readonly recoveredAtMs?: number | null;
}

/** The fields a service may change. 'NOW' = the database clock. */
export interface IncidentPatch {
  readonly severity?: IncidentSeverity;
  readonly status?: IncidentStatus;
  readonly title?: string;
  readonly impact?: string;
  readonly lastSeenAtMs?: number | 'NOW';
  readonly occurrencesDelta?: number;
  readonly evidence?: Record<string, unknown>;
  readonly assigneeUserId?: string | null;
  readonly acknowledgedAt?: 'NOW' | null;
  readonly recoveredAt?: 'NOW' | number | null;
  readonly closedAt?: 'NOW' | null;
  readonly closedBy?: string | null;
  readonly closedWhileFailing?: boolean;
  readonly snoozedUntilMs?: number | null;
  readonly snoozeNoticePending?: boolean;
  readonly lastNotifiedAt?: 'NOW' | null;
  readonly lastReminderAt?: 'NOW' | null;
  readonly successStreak?: number;
  readonly inMaintenance?: boolean;
  readonly externalNotified?: boolean;
}

export interface IncidentQuery {
  readonly severity: IncidentSeverity | null;
  readonly source: string | null;
  readonly statuses: readonly IncidentStatus[] | null;
  readonly assigneeUserId: string | null;
  readonly unassigned: boolean;
  readonly fromMs: number | null;
  readonly toMs: number | null;
  readonly codeSeq: number | null;
}

export interface NotificationRow {
  readonly notificationId: string;
  readonly incidentId: string | null;
  readonly kind: NotificationKind;
  readonly severity: DiscordSeverity;
  readonly content: Record<string, unknown>;
  readonly dedupeKey: string;
  readonly status: 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';
  readonly skipReason: string | null;
  readonly attempts: number;
  readonly nextAttemptAtMs: number;
  readonly lastAttemptAtMs: number | null;
  readonly lastErrorCode: string | null;
  readonly lastHttpStatus: number | null;
  readonly sentAtMs: number | null;
  readonly createdAtMs: number;
}

const NOTIFICATION_COLUMNS = `notification_id, incident_id, kind, severity, content, dedupe_key, status, skip_reason, attempts, ${ms('next_attempt_at', 'next_ms')},
  CASE WHEN last_attempt_at IS NULL THEN NULL ELSE (extract(epoch FROM last_attempt_at) * 1000)::bigint::text END AS last_ms, last_error_code, last_http_status,
  CASE WHEN sent_at IS NULL THEN NULL ELSE (extract(epoch FROM sent_at) * 1000)::bigint::text END AS sent_ms, ${ms('created_at', 'created_ms')}`;

interface NotificationDbRow {
  notification_id: string;
  incident_id: string | null;
  kind: NotificationKind;
  severity: DiscordSeverity;
  content: Record<string, unknown>;
  dedupe_key: string;
  status: 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';
  skip_reason: string | null;
  attempts: number;
  next_ms: string;
  last_ms: string | null;
  last_error_code: string | null;
  last_http_status: number | null;
  sent_ms: string | null;
  created_ms: string;
}

const notificationOf = (r: NotificationDbRow): NotificationRow => ({
  notificationId: r.notification_id,
  incidentId: r.incident_id,
  kind: r.kind,
  severity: r.severity,
  content: r.content,
  dedupeKey: r.dedupe_key,
  status: r.status,
  skipReason: r.skip_reason,
  attempts: r.attempts,
  nextAttemptAtMs: num(r.next_ms),
  lastAttemptAtMs: numOrNull(r.last_ms),
  lastErrorCode: r.last_error_code,
  lastHttpStatus: r.last_http_status,
  sentAtMs: numOrNull(r.sent_ms),
  createdAtMs: num(r.created_ms),
});

export interface NewNotification {
  readonly notificationId: string;
  readonly incidentId: string | null;
  readonly kind: NotificationKind;
  readonly severity: DiscordSeverity;
  readonly content: Record<string, unknown>;
  readonly dedupeKey: string;
  /** Written already SKIPPED with this reason (nothing will be sent). */
  readonly skipReason?: string;
}

export interface MaintenanceRow {
  readonly maintenanceId: string;
  readonly scopes: string[];
  readonly reason: string;
  readonly startsAtMs: number;
  readonly endsAtMs: number;
  readonly createdBy: string;
  readonly createdAtMs: number;
  readonly cancelledAtMs: number | null;
  readonly cancelledBy: string | null;
}

const MAINTENANCE_COLUMNS = `maintenance_id, scopes, reason, ${ms('starts_at', 'starts_ms')}, ${ms('ends_at', 'ends_ms')}, created_by, ${ms('created_at', 'created_ms')},
  CASE WHEN cancelled_at IS NULL THEN NULL ELSE (extract(epoch FROM cancelled_at) * 1000)::bigint::text END AS cancelled_ms, cancelled_by`;

interface MaintenanceDbRow {
  maintenance_id: string;
  scopes: string[];
  reason: string;
  starts_ms: string;
  ends_ms: string;
  created_by: string;
  created_ms: string;
  cancelled_ms: string | null;
  cancelled_by: string | null;
}

const maintenanceOf = (r: MaintenanceDbRow): MaintenanceRow => ({
  maintenanceId: r.maintenance_id,
  scopes: r.scopes,
  reason: r.reason,
  startsAtMs: num(r.starts_ms),
  endsAtMs: num(r.ends_ms),
  createdBy: r.created_by,
  createdAtMs: num(r.created_ms),
  cancelledAtMs: numOrNull(r.cancelled_ms),
  cancelledBy: r.cancelled_by,
});

@Injectable()
export class OpsIncidentRepository {
  // ---- incidents ----

  async insertIncident(context: TransactionContext, n: NewIncident): Promise<IncidentRow> {
    const result = await context.query<IncidentDbRow>(
      `INSERT INTO app.ops_incidents (incident_id, fingerprint, source, check_key, severity, status, title, impact, detected_by, first_seen_at, last_seen_at, occurrences, evidence,
         reopens_incident_id, in_maintenance, external_notified, recovered_at, version, created_at, updated_at)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE(CASE WHEN $10::bigint IS NULL THEN NULL ELSE ${fromMs('$10')} END, ${CLOCK}),
               COALESCE(CASE WHEN $11::bigint IS NULL THEN NULL ELSE ${fromMs('$11')} END, CASE WHEN $10::bigint IS NULL THEN ${CLOCK} ELSE ${fromMs('$10')} END),
               $12, $13::jsonb, $14::uuid, $15, $16, CASE WHEN $17::bigint IS NULL THEN NULL ELSE ${fromMs('$17')} END, 1, ${CLOCK}, ${CLOCK})
       RETURNING ${COLUMNS}`,
      [
        n.incidentId,
        n.fingerprint,
        n.source,
        n.checkKey,
        n.severity,
        n.recoveredAtMs === undefined || n.recoveredAtMs === null ? 'NEW' : 'RECOVERED',
        redactText(n.title, 160),
        redactText(n.impact, 240),
        n.detectedBy,
        n.firstSeenAtMs ?? null,
        n.lastSeenAtMs ?? null,
        n.occurrences ?? 1,
        jsonOf(redactDetail(n.evidence)),
        n.reopensIncidentId ?? null,
        n.inMaintenance,
        n.externalNotified ?? false,
        n.recoveredAtMs ?? null,
      ],
    );
    return incidentOf(result.rows[0] as IncidentDbRow);
  }

  async findOpenByFingerprint(context: TransactionContext, fingerprint: string, lock = true): Promise<IncidentRow | undefined> {
    const result = await context.query<IncidentDbRow>(`SELECT ${COLUMNS} FROM app.ops_incidents WHERE fingerprint = $1 AND status <> 'CLOSED'${lock ? ' FOR UPDATE' : ''}`, [fingerprint]);
    return result.rows[0] === undefined ? undefined : incidentOf(result.rows[0]);
  }

  /** The most recent CLOSED incident of the fingerprint (to link a new one to a manual close that did not hold). */
  async lastClosedByFingerprint(context: TransactionContext, fingerprint: string): Promise<IncidentRow | undefined> {
    const result = await context.query<IncidentDbRow>(`SELECT ${COLUMNS} FROM app.ops_incidents WHERE fingerprint = $1 AND status = 'CLOSED' ORDER BY closed_at DESC LIMIT 1`, [fingerprint]);
    return result.rows[0] === undefined ? undefined : incidentOf(result.rows[0]);
  }

  async findById(context: TransactionContext, incidentId: string, lock = false): Promise<IncidentRow | undefined> {
    const result = await context.query<IncidentDbRow>(`SELECT ${COLUMNS} FROM app.ops_incidents WHERE incident_id = $1::uuid${lock ? ' FOR UPDATE' : ''}`, [incidentId]);
    return result.rows[0] === undefined ? undefined : incidentOf(result.rows[0]);
  }

  async findByCodeSeq(context: TransactionContext, seq: number): Promise<IncidentRow | undefined> {
    const result = await context.query<IncidentDbRow>(`SELECT ${COLUMNS} FROM app.ops_incidents WHERE code_seq = $1`, [seq]);
    return result.rows[0] === undefined ? undefined : incidentOf(result.rows[0]);
  }

  /** Every live (not CLOSED) incident, locked: the sweep that sends reminders, lifts maintenance flags and auto-closes. */
  async listLive(context: TransactionContext, lock = false): Promise<IncidentRow[]> {
    const result = await context.query<IncidentDbRow>(`SELECT ${COLUMNS} FROM app.ops_incidents WHERE status <> 'CLOSED' ORDER BY first_seen_at LIMIT 500${lock ? ' FOR UPDATE' : ''}`);
    return result.rows.map(incidentOf);
  }

  /** Applies a patch (and +1 version) to one incident; `expectedVersion` makes it a conditional change. Returns the new row, or undefined when the version moved. */
  async update(context: TransactionContext, incidentId: string, patch: IncidentPatch, expectedVersion?: number): Promise<IncidentRow | undefined> {
    const sets: string[] = [`version = version + 1`, `updated_at = ${CLOCK}`];
    const args: unknown[] = [incidentId];
    const bind = (value: unknown): string => {
      args.push(value);
      return `$${args.length}`;
    };
    const time = (v: 'NOW' | number): string => (v === 'NOW' ? CLOCK : fromMs(bind(v)));
    if (patch.severity !== undefined) sets.push(`severity = ${bind(patch.severity)}`);
    if (patch.status !== undefined) sets.push(`status = ${bind(patch.status)}`);
    if (patch.title !== undefined) sets.push(`title = ${bind(redactText(patch.title, 160))}`);
    if (patch.impact !== undefined) sets.push(`impact = ${bind(redactText(patch.impact, 240))}`);
    if (patch.lastSeenAtMs !== undefined) sets.push(`last_seen_at = GREATEST(last_seen_at, ${time(patch.lastSeenAtMs)})`);
    if (patch.occurrencesDelta !== undefined) sets.push(`occurrences = occurrences + ${bind(patch.occurrencesDelta)}::int`);
    if (patch.evidence !== undefined) sets.push(`evidence = ${bind(jsonOf(redactDetail(patch.evidence)))}::jsonb`);
    if (patch.assigneeUserId !== undefined) sets.push(`assignee_user_id = ${bind(patch.assigneeUserId)}::uuid`);
    if (patch.acknowledgedAt !== undefined) sets.push(`acknowledged_at = ${patch.acknowledgedAt === null ? 'NULL' : CLOCK}`);
    if (patch.recoveredAt !== undefined) sets.push(`recovered_at = ${patch.recoveredAt === null ? 'NULL' : time(patch.recoveredAt)}`);
    if (patch.closedAt !== undefined) sets.push(`closed_at = ${patch.closedAt === null ? 'NULL' : CLOCK}`);
    if (patch.closedBy !== undefined) sets.push(`closed_by = ${bind(patch.closedBy)}::uuid`);
    if (patch.closedWhileFailing !== undefined) sets.push(`closed_while_failing = ${bind(patch.closedWhileFailing)}`);
    if (patch.snoozedUntilMs !== undefined) sets.push(`snoozed_until = ${patch.snoozedUntilMs === null ? 'NULL' : fromMs(bind(patch.snoozedUntilMs))}`);
    if (patch.snoozeNoticePending !== undefined) sets.push(`snooze_notice_pending = ${bind(patch.snoozeNoticePending)}`);
    if (patch.lastNotifiedAt !== undefined) sets.push(`last_notified_at = ${patch.lastNotifiedAt === null ? 'NULL' : CLOCK}`);
    if (patch.lastReminderAt !== undefined) sets.push(`last_reminder_at = ${patch.lastReminderAt === null ? 'NULL' : CLOCK}`);
    if (patch.successStreak !== undefined) sets.push(`success_streak = ${bind(patch.successStreak)}::int`);
    if (patch.inMaintenance !== undefined) sets.push(`in_maintenance = ${bind(patch.inMaintenance)}`);
    if (patch.externalNotified !== undefined) sets.push(`external_notified = ${bind(patch.externalNotified)}`);
    const versionClause = expectedVersion === undefined ? '' : ` AND version = ${bind(expectedVersion)}`;
    const result = await context.query<IncidentDbRow>(`UPDATE app.ops_incidents SET ${sets.join(', ')} WHERE incident_id = $1::uuid${versionClause} RETURNING ${COLUMNS}`, args);
    return result.rows[0] === undefined ? undefined : incidentOf(result.rows[0]);
  }

  /** First time an administrator opens the incident (read ≠ acknowledged). Idempotent: only the first view is recorded. */
  async markViewed(context: TransactionContext, incidentId: string, userId: string): Promise<boolean> {
    const result = await context.query(`UPDATE app.ops_incidents SET first_viewed_at = ${CLOCK}, first_viewed_by = $2::uuid WHERE incident_id = $1::uuid AND first_viewed_at IS NULL`, [incidentId, userId]);
    return result.rowCount === 1;
  }

  async search(context: TransactionContext, q: IncidentQuery, page: { limit: number; offset: number }): Promise<{ rows: IncidentRow[]; total: number }> {
    const where: string[] = [];
    const args: unknown[] = [];
    const add = (sql: string, value: unknown): void => {
      args.push(value);
      where.push(sql.replace('?', `$${args.length}`));
    };
    if (q.severity !== null) add('severity = ?', q.severity);
    if (q.source !== null) add('source = ?', q.source);
    if (q.statuses !== null) add('status = ANY(?::text[])', [...q.statuses]);
    if (q.assigneeUserId !== null) add('assignee_user_id = ?::uuid', q.assigneeUserId);
    if (q.unassigned) where.push('assignee_user_id IS NULL');
    if (q.fromMs !== null) add(`first_seen_at >= ${fromMs('?')}`, q.fromMs);
    if (q.toMs !== null) add(`first_seen_at < ${fromMs('?')}`, q.toMs);
    if (q.codeSeq !== null) add('code_seq = ?', q.codeSeq);
    const clause = where.length === 0 ? '' : `WHERE ${where.join(' AND ')}`;
    const total = await context.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.ops_incidents ${clause}`, args);
    const rows = await context.query<IncidentDbRow>(
      `SELECT ${COLUMNS} FROM app.ops_incidents ${clause} ORDER BY (status <> 'CLOSED') DESC, (severity = 'CRITICAL') DESC, last_seen_at DESC LIMIT ${Number(page.limit)} OFFSET ${Number(page.offset)}`,
      args,
    );
    return { rows: rows.rows.map(incidentOf), total: num(total.rows[0]?.n ?? '0') };
  }

  async counts(context: TransactionContext): Promise<{ open: number; critical: number; unacknowledged: number }> {
    const result = await context.query<{ open: string; critical: string; unack: string }>(
      `SELECT count(*) FILTER (WHERE status <> 'CLOSED' AND status <> 'RECOVERED')::text AS open,
              count(*) FILTER (WHERE status <> 'CLOSED' AND status <> 'RECOVERED' AND severity = 'CRITICAL')::text AS critical,
              count(*) FILTER (WHERE status = 'NEW')::text AS unack FROM app.ops_incidents`,
    );
    const r = result.rows[0];
    return { open: num(r?.open ?? '0'), critical: num(r?.critical ?? '0'), unacknowledged: num(r?.unack ?? '0') };
  }

  // ---- Discord messages ----

  /** Inserts a message once per dedupe key. Returns the row when it was created, undefined when the same fact already has one. */
  async enqueue(context: TransactionContext, n: NewNotification): Promise<NotificationRow | undefined> {
    const result = await context.query<NotificationDbRow>(
      `INSERT INTO app.ops_notifications (notification_id, incident_id, kind, severity, content, dedupe_key, status, skip_reason, attempts, next_attempt_at, created_at)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb, $6, $7, $8, 0, ${CLOCK}, ${CLOCK})
       ON CONFLICT (dedupe_key) DO NOTHING RETURNING ${NOTIFICATION_COLUMNS}`,
      [n.notificationId, n.incidentId, n.kind, n.severity, jsonOf(redactDetail(n.content)), n.dedupeKey, n.skipReason === undefined ? 'PENDING' : 'SKIPPED', n.skipReason ?? null],
    );
    return result.rows[0] === undefined ? undefined : notificationOf(result.rows[0]);
  }

  /** Takes up to `limit` due messages (SKIP LOCKED) and leases them, so two workers never send the same message. */
  async claimDue(context: TransactionContext, limit: number, leaseSeconds: number): Promise<NotificationRow[]> {
    const result = await context.query<NotificationDbRow>(
      `UPDATE app.ops_notifications SET lease_until = ${CLOCK} + make_interval(secs => $2::int)
        WHERE notification_id IN (
          SELECT notification_id FROM app.ops_notifications
           WHERE status = 'PENDING' AND next_attempt_at <= ${CLOCK} AND (lease_until IS NULL OR lease_until < ${CLOCK})
           ORDER BY (severity = 'CRITICAL') DESC, next_attempt_at, created_at LIMIT $1 FOR UPDATE SKIP LOCKED)
       RETURNING ${NOTIFICATION_COLUMNS}`,
      [limit, leaseSeconds],
    );
    return result.rows.map(notificationOf);
  }

  async markSent(context: TransactionContext, id: string, httpStatus: number): Promise<void> {
    await context.query(
      `UPDATE app.ops_notifications SET status = 'SENT', sent_at = ${CLOCK}, last_attempt_at = ${CLOCK}, attempts = attempts + 1, last_http_status = $2, last_error_code = NULL, lease_until = NULL WHERE notification_id = $1::uuid`,
      [id, httpStatus],
    );
  }

  /** A failed attempt: retry later (PENDING with a new time) or give up (FAILED). `delaySeconds` 0 with giveUp = the message ends here. */
  async markAttemptFailed(context: TransactionContext, id: string, o: { errorCode: string; httpStatus: number | null; giveUp: boolean; delaySeconds: number; countAttempt: boolean }): Promise<void> {
    await context.query(
      `UPDATE app.ops_notifications
          SET status = CASE WHEN $2::boolean THEN 'FAILED' ELSE 'PENDING' END, attempts = attempts + (CASE WHEN $5::boolean THEN 1 ELSE 0 END), last_attempt_at = ${CLOCK},
              last_error_code = $3, last_http_status = $4, next_attempt_at = ${CLOCK} + make_interval(secs => $6::int), lease_until = NULL
        WHERE notification_id = $1::uuid`,
      [id, o.giveUp, o.errorCode.slice(0, 32), o.httpStatus, o.countAttempt, Math.max(0, Math.round(o.delaySeconds))],
    );
  }

  async markSkipped(context: TransactionContext, id: string, reason: string): Promise<void> {
    await context.query(`UPDATE app.ops_notifications SET status = 'SKIPPED', skip_reason = $2, lease_until = NULL WHERE notification_id = $1::uuid AND status = 'PENDING'`, [id, reason.slice(0, 24)]);
  }

  /** A newer message of the same incident replaces the older pending reminders: after an outage the channel gets the latest state, not a backlog. */
  async supersedePending(context: TransactionContext, incidentId: string, kinds: readonly NotificationKind[], exceptId: string): Promise<number> {
    const result = await context.query(
      `UPDATE app.ops_notifications SET status = 'SKIPPED', skip_reason = 'SUPERSEDED', lease_until = NULL
        WHERE incident_id = $1::uuid AND status = 'PENDING' AND kind = ANY($2::text[]) AND notification_id <> $3::uuid`,
      [incidentId, [...kinds], exceptId],
    );
    return result.rowCount ?? 0;
  }

  /** Pending message that were created while the channel was not configured: they stay visible as SKIPPED, never as delivered. */
  async skipAllPending(context: TransactionContext, reason: string): Promise<number> {
    const result = await context.query(`UPDATE app.ops_notifications SET status = 'SKIPPED', skip_reason = $1, lease_until = NULL WHERE status = 'PENDING'`, [reason.slice(0, 24)]);
    return result.rowCount ?? 0;
  }

  async listForIncident(context: TransactionContext, incidentId: string): Promise<NotificationRow[]> {
    const result = await context.query<NotificationDbRow>(`SELECT ${NOTIFICATION_COLUMNS} FROM app.ops_notifications WHERE incident_id = $1::uuid ORDER BY created_at, notification_id LIMIT 200`, [incidentId]);
    return result.rows.map(notificationOf);
  }

  async findNotification(context: TransactionContext, id: string): Promise<NotificationRow | undefined> {
    const result = await context.query<NotificationDbRow>(`SELECT ${NOTIFICATION_COLUMNS} FROM app.ops_notifications WHERE notification_id = $1::uuid`, [id]);
    return result.rows[0] === undefined ? undefined : notificationOf(result.rows[0]);
  }

  async notificationStats(context: TransactionContext): Promise<{ pending: number; failed: number; lastSentAtMs: number | null; lastFailedAtMs: number | null }> {
    const result = await context.query<{ pending: string; failed: string; sent_ms: string | null; failed_ms: string | null }>(
      `SELECT count(*) FILTER (WHERE status = 'PENDING')::text AS pending, count(*) FILTER (WHERE status = 'FAILED' AND created_at > ${CLOCK} - interval '7 days')::text AS failed,
              (extract(epoch FROM max(sent_at)) * 1000)::bigint::text AS sent_ms,
              (extract(epoch FROM max(last_attempt_at) FILTER (WHERE status IN ('FAILED', 'PENDING') AND last_error_code IS NOT NULL)) * 1000)::bigint::text AS failed_ms
         FROM app.ops_notifications`,
    );
    const r = result.rows[0];
    return { pending: num(r?.pending ?? '0'), failed: num(r?.failed ?? '0'), lastSentAtMs: numOrNull(r?.sent_ms ?? null), lastFailedAtMs: numOrNull(r?.failed_ms ?? null) };
  }

  // ---- maintenance ----

  async insertMaintenance(context: TransactionContext, m: { maintenanceId: string; scopes: readonly string[]; reason: string; startsAtMs: number; endsAtMs: number; createdBy: string }): Promise<MaintenanceRow> {
    const result = await context.query<MaintenanceDbRow>(
      `INSERT INTO app.ops_maintenance (maintenance_id, scopes, reason, starts_at, ends_at, created_by, created_at)
       VALUES ($1::uuid, $2::jsonb, $3, ${fromMs('$4')}, ${fromMs('$5')}, $6::uuid, ${CLOCK}) RETURNING ${MAINTENANCE_COLUMNS}`,
      [m.maintenanceId, JSON.stringify([...m.scopes]), redactText(m.reason, 200), m.startsAtMs, m.endsAtMs, m.createdBy],
    );
    return maintenanceOf(result.rows[0] as MaintenanceDbRow);
  }

  async cancelMaintenance(context: TransactionContext, id: string, userId: string): Promise<MaintenanceRow | undefined> {
    const result = await context.query<MaintenanceDbRow>(
      `UPDATE app.ops_maintenance SET cancelled_at = ${CLOCK}, cancelled_by = $2::uuid WHERE maintenance_id = $1::uuid AND cancelled_at IS NULL AND ends_at > ${CLOCK} RETURNING ${MAINTENANCE_COLUMNS}`,
      [id, userId],
    );
    return result.rows[0] === undefined ? undefined : maintenanceOf(result.rows[0]);
  }

  /** Windows that are running now (started, not ended, not cancelled). The database clock decides, so "expired" never depends on a timer having run. */
  async activeMaintenance(context: TransactionContext): Promise<MaintenanceRow[]> {
    const result = await context.query<MaintenanceDbRow>(
      `SELECT ${MAINTENANCE_COLUMNS} FROM app.ops_maintenance WHERE cancelled_at IS NULL AND starts_at <= ${CLOCK} AND ends_at > ${CLOCK} ORDER BY ends_at`,
    );
    return result.rows.map(maintenanceOf);
  }

  async listMaintenance(context: TransactionContext, limit: number): Promise<MaintenanceRow[]> {
    const result = await context.query<MaintenanceDbRow>(`SELECT ${MAINTENANCE_COLUMNS} FROM app.ops_maintenance ORDER BY created_at DESC LIMIT $1`, [limit]);
    return result.rows.map(maintenanceOf);
  }

  async findMaintenance(context: TransactionContext, id: string): Promise<MaintenanceRow | undefined> {
    const result = await context.query<MaintenanceDbRow>(`SELECT ${MAINTENANCE_COLUMNS} FROM app.ops_maintenance WHERE maintenance_id = $1::uuid`, [id]);
    return result.rows[0] === undefined ? undefined : maintenanceOf(result.rows[0]);
  }
}
