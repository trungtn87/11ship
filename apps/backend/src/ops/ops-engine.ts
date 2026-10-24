import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../common/app-errors';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DEFAULT_OPS_CONFIG } from '../config/ops-config';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { TransactionContext } from '../transaction/transaction-context';
import {
  CheckState,
  DetectedBy,
  DiscordSeverity,
  EventLevel,
  IncidentSeverity,
  LIVE_INCIDENT_STATUSES,
  NotificationKind,
  OpsSource,
  SEVERITY_RANK,
  SOURCE_LABEL,
} from './ops-constants';
import { OpsIncidentRepository, IncidentRow, NotificationRow } from './ops-incident-repository';
import { OpsRepository } from './ops-repository';
import { OpsEffective, OpsSettingsService } from './ops-settings-service';

/** What a collector or ingest hands the engine: one evaluated fact about one check. */
export interface CheckReport {
  readonly checkKey: string;
  readonly source: OpsSource;
  readonly state: CheckState;
  readonly value?: Record<string, unknown>;
  readonly evidenceCode?: string;
  readonly staleAfterSeconds: number;
  readonly observedAtMs?: number;
  /** Incident text when the check fails. */
  readonly title: string;
  readonly impact: string;
  /** Consecutive failures that open an incident (default 1: the collector applies its own streak rule where the design has one). */
  readonly openAfterFailures?: number;
  /** Consecutive OK observations that mark the incident recovered (default 1). */
  readonly recoverAfterSuccesses?: number;
  readonly detectedBy?: DetectedBy;
  readonly fingerprint?: string;
}

export type ObserveAction = 'NONE' | 'OPENED' | 'UPDATED' | 'ESCALATED' | 'REOPENED' | 'RECOVERED';

export interface ObserveOutcome {
  readonly action: ObserveAction;
  readonly incident?: IncidentRow;
}

export interface Actor {
  readonly userId: string;
  readonly role: 'SYSTEM' | 'ADMIN';
}

export const INCIDENT_LINK_PATH = '/system-ops/incidents/';
/** A manual close that did not hold (the check kept failing) links the next incident of the same fingerprint for this long. */
const REOPEN_LINK_WINDOW_MS = 7 * 86_400_000;

const severityOf = (state: CheckState): IncidentSeverity => (state === 'CRITICAL' ? 'CRITICAL' : 'WARNING');
const iso = (ms: number): string => new Date(ms).toISOString();

/**
 * The incident engine of M13 (design sections 8, 9, 10). Collectors report facts; the engine decides, inside the caller's transaction:
 *  - UNKNOWN ("no data") never opens, never recovers and never counts as healthy;
 *  - one open incident per fingerprint: a repeat updates the count and the latest evidence, a worse severity escalates (and always notifies, even when acknowledged);
 *  - a recovered incident that fails again is reopened, not duplicated; an incident closed by hand while the check still failed is followed by a NEW linked incident;
 *  - a maintenance window silences Discord for its scope only (the log, the check and the incident stay), and the first message is sent after the window if the failure remains;
 *  - "read" is not "acknowledged": viewing records who looked, acknowledging is an explicit action, and neither hides the check state.
 * Everything uses the database clock; no timer decides anything, so a restart or a second instance changes nothing.
 */
@Injectable()
export class OpsEngine {
  readonly #environment: string;
  readonly #version: string;
  readonly #adminBase: string | undefined;

  constructor(
    private readonly repo: OpsRepository,
    private readonly incidents: OpsIncidentRepository,
    private readonly settings: OpsSettingsService,
    @Inject(APP_CONFIG) appConfig: AppConfig,
  ) {
    const ops = appConfig.ops ?? DEFAULT_OPS_CONFIG;
    this.#environment = appConfig.appEnv;
    this.#version = ops.backendVersion;
    this.#adminBase = ops.adminBaseUrl ?? appConfig.adminAuth?.allowedOrigins[0];
  }

  get environment(): string {
    return this.#environment;
  }

  link(code: string): string | undefined {
    return this.#adminBase === undefined ? undefined : `${this.#adminBase.replace(/\/+$/, '')}${INCIDENT_LINK_PATH}${code}`;
  }

  // ---- observation ----

  async observe(context: TransactionContext, r: CheckReport): Promise<ObserveOutcome> {
    const { current } = await this.repo.observe(context, {
      checkKey: r.checkKey,
      source: r.source,
      state: r.state,
      ...(r.observedAtMs === undefined ? {} : { observedAtMs: r.observedAtMs }),
      value: r.value ?? {},
      evidenceCode: r.evidenceCode ?? null,
      staleAfterSeconds: r.staleAfterSeconds,
    });
    if (r.state === 'UNKNOWN') {
      return { action: 'NONE' };
    }
    const fingerprint = r.fingerprint ?? r.checkKey;
    const eff = await this.settings.load(context);
    const evidence = (existing?: IncidentRow): Record<string, unknown> => ({
      evidence_code: r.evidenceCode ?? null,
      latest: { ...(r.value ?? {}), state: r.state },
      first: (existing?.evidence.first as Record<string, unknown> | undefined) ?? { ...(r.value ?? {}), state: r.state },
    });

    if (r.state === 'OK') {
      const open = await this.incidents.findOpenByFingerprint(context, fingerprint);
      if (open === undefined || open.status === 'RECOVERED') {
        return { action: 'NONE' };
      }
      const needed = r.recoverAfterSuccesses ?? 1;
      if (current.consecutiveSuccesses < needed) {
        await this.incidents.update(context, open.incidentId, { successStreak: current.consecutiveSuccesses, lastSeenAtMs: 'NOW' });
        return { action: 'NONE', incident: open };
      }
      const recovered = (await this.incidents.update(context, open.incidentId, { status: 'RECOVERED', recoveredAt: r.observedAtMs ?? 'NOW', successStreak: current.consecutiveSuccesses })) as IncidentRow;
      await this.#log(context, recovered, 'INFO', 'RECOVERED', 'Kiểm tra đã trở lại bình thường', undefined, { evidence_code: r.evidenceCode ?? null });
      if (await this.#wasAnnounced(context, recovered)) {
        await this.#notify(context, eff, recovered, 'RECOVERY', 'INFO', `rec:${recovered.incidentId}:${recovered.version}`, { title: recovered.title, at: iso(recovered.recoveredAtMs ?? Date.now()) });
        await this.incidents.supersedePending(context, recovered.incidentId, ['REMINDER', 'SNOOZE_END'], '00000000-0000-0000-0000-000000000000');
      }
      return { action: 'RECOVERED', incident: recovered };
    }

    // WARNING / CRITICAL
    if (current.consecutiveFailures < (r.openAfterFailures ?? 1)) {
      return { action: 'NONE' };
    }
    const severity = severityOf(r.state);
    const maintenance = await this.#inMaintenance(context, r.source);
    const existing = await this.incidents.findOpenByFingerprint(context, fingerprint);
    if (existing === undefined) {
      const closed = await this.incidents.lastClosedByFingerprint(context, fingerprint);
      const reopens = closed !== undefined && closed.closedWhileFailing && closed.closedAtMs !== null && Date.now() - closed.closedAtMs < REOPEN_LINK_WINDOW_MS ? closed : undefined;
      const created = await this.incidents.insertIncident(context, {
        incidentId: randomUUID(),
        fingerprint,
        source: r.source,
        checkKey: r.checkKey,
        severity,
        title: r.title,
        impact: r.impact,
        detectedBy: r.detectedBy ?? 'INTERNAL',
        ...(r.observedAtMs === undefined ? {} : { firstSeenAtMs: r.observedAtMs }),
        evidence: evidence(),
        reopensIncidentId: reopens?.incidentId ?? null,
        inMaintenance: maintenance,
      });
      await this.#log(context, created, severity === 'CRITICAL' ? 'ERROR' : 'WARN', 'DETECTED', created.title, undefined, { evidence_code: r.evidenceCode ?? null, reopens: reopens?.code ?? null });
      await this.#announce(context, eff, created, maintenance, 'OPEN', `open:${created.incidentId}`);
      return { action: 'OPENED', incident: created };
    }

    const patch = {
      lastSeenAtMs: 'NOW' as const,
      occurrencesDelta: 1,
      evidence: evidence(existing),
      successStreak: 0,
      inMaintenance: maintenance,
      ...(SEVERITY_RANK[severity] > SEVERITY_RANK[existing.severity] ? { severity } : {}),
      // The title says what the LATEST evidence says (a backup that failed for one reason and later fails for another, or is late): a reopened incident is announced with its current
      // cause, never with the old one. Checks whose title never changes are unaffected.
      ...(r.title !== existing.title ? { title: r.title } : {}),
    };
    if (existing.status === 'RECOVERED') {
      // It failed again after recovering: the same incident is reopened (not a duplicate) and announced again.
      const reopened = (await this.incidents.update(context, existing.incidentId, { ...patch, status: 'NEW', recoveredAt: null, acknowledgedAt: null, snoozedUntilMs: null, snoozeNoticePending: false })) as IncidentRow;
      await this.#log(context, reopened, 'WARN', 'REOPENED', 'Kiểm tra lỗi lại sau khi phục hồi: mở lại sự cố', undefined, { evidence_code: r.evidenceCode ?? null });
      await this.#announce(context, eff, reopened, maintenance, 'OPEN', `reopen:${reopened.incidentId}:${reopened.version}`);
      return { action: 'REOPENED', incident: reopened };
    }
    const updated = (await this.incidents.update(context, existing.incidentId, patch)) as IncidentRow;
    if (SEVERITY_RANK[severity] > SEVERITY_RANK[existing.severity]) {
      await this.#log(context, updated, 'ERROR', 'ESCALATED', `Nâng mức từ ${existing.severity} lên ${severity}`, undefined, { evidence_code: r.evidenceCode ?? null });
      // An escalation is announced even when the incident was acknowledged or snoozed (design 8); only a maintenance window silences it.
      await this.#announce(context, eff, updated, maintenance, 'ESCALATION', `esc:${updated.incidentId}:${updated.version}`);
      return { action: 'ESCALATED', incident: updated };
    }
    return { action: 'UPDATED', incident: updated };
  }

  /**
   * An outage that is already over (or still going) when the engine hears of it, with its REAL start time: the external probe syncing after this server came back
   * (design section 6) and the database outage the collector kept in memory. One incident per episode id (a repeated report adds the recovery, never a duplicate).
   * `notifiedBy` says who already told the channel: the PROBE (it also sends the recovery; nothing is repeated from here) or DIRECT (this process sent the open
   * notice without a database; the recovery is queued from here).
   */
  async recordOutage(
    context: TransactionContext,
    r: {
      episodeId: string;
      checkKey: string;
      source: OpsSource;
      detectedBy: DetectedBy;
      title: string;
      impact: string;
      firstFailedAtMs: number;
      recoveredAtMs: number | null;
      failures: number;
      evidenceCode: string;
      notifiedBy: 'PROBE' | 'DIRECT' | null;
    },
  ): Promise<{ created: boolean; incident: IncidentRow }> {
    const known = await context.query<{ incident_id: string }>(`SELECT incident_id FROM app.ops_incidents WHERE evidence->>'episode_id' = $1 LIMIT 1`, [r.episodeId]);
    const detectedText = r.detectedBy === 'EXTERNAL_PROBE' ? 'giám sát ngoài VPS' : 'kiểm tra nội bộ';
    if (known.rows[0] !== undefined) {
      const same = (await this.incidents.findById(context, known.rows[0].incident_id, true)) as IncidentRow;
      // A later report of the same episode may add the recovery.
      if (r.recoveredAtMs !== null && same.status !== 'RECOVERED' && same.status !== 'CLOSED') {
        const recovered = (await this.incidents.update(context, same.incidentId, { status: 'RECOVERED', recoveredAt: r.recoveredAtMs, successStreak: 2 })) as IncidentRow;
        await this.#log(context, recovered, 'INFO', 'RECOVERED', `Đã phục hồi (${detectedText})`, undefined, { episode_id: r.episodeId });
        return { created: false, incident: recovered };
      }
      return { created: false, incident: same };
    }
    const eff = await this.settings.load(context);
    const open = await this.incidents.findOpenByFingerprint(context, r.checkKey);
    if (open !== undefined && r.recoveredAtMs === null) {
      const merged = (await this.incidents.update(context, open.incidentId, {
        lastSeenAtMs: 'NOW',
        occurrencesDelta: Math.max(1, r.failures),
        externalNotified: r.notifiedBy === 'PROBE' || open.externalNotified,
        evidence: { ...open.evidence, episode_id: r.episodeId, evidence_code: r.evidenceCode },
      })) as IncidentRow;
      return { created: false, incident: merged };
    }
    const created = await this.incidents.insertIncident(context, {
      incidentId: randomUUID(),
      // A finished episode is history: it never takes the live fingerprint, so the next outage of the same check opens its own incident. A live incident of the check keeps its fingerprint too.
      fingerprint: r.recoveredAtMs === null && open === undefined ? r.checkKey : `${r.checkKey}:${r.episodeId}`.slice(0, 96),
      source: r.source,
      checkKey: r.checkKey,
      severity: 'CRITICAL',
      title: r.title,
      impact: r.impact,
      detectedBy: r.detectedBy,
      firstSeenAtMs: r.firstFailedAtMs,
      lastSeenAtMs: r.recoveredAtMs ?? Date.now(),
      occurrences: Math.max(1, r.failures),
      evidence: { episode_id: r.episodeId, evidence_code: r.evidenceCode, latest: { failures: r.failures }, first: { failures: r.failures } },
      inMaintenance: false,
      externalNotified: r.notifiedBy === 'PROBE',
      recoveredAtMs: r.recoveredAtMs,
    });
    await this.#log(context, created, 'ERROR', 'DETECTED', `${created.title} (phát hiện bởi ${detectedText})`, undefined, { episode_id: r.episodeId, first_failed_at: iso(r.firstFailedAtMs) });
    if (r.recoveredAtMs !== null) {
      await this.#log(context, created, 'INFO', 'RECOVERED', `Đã phục hồi (${detectedText})`, undefined, { recovered_at: iso(r.recoveredAtMs) });
    }
    if (r.notifiedBy === 'DIRECT') {
      // The open notice already went out without a database: recorded as such, never as "queued" or "not sent".
      await this.incidents.enqueue(context, { notificationId: randomUUID(), incidentId: created.incidentId, kind: 'OPEN', severity: created.severity, content: this.#content(created, created.firstSeenAtMs), dedupeKey: `open:${created.incidentId}`, skipReason: 'SENT_DIRECT' });
      if (r.recoveredAtMs !== null) {
        await this.#notify(context, eff, created, 'RECOVERY', 'INFO', `rec:${created.incidentId}:${created.version}`, { title: created.title, at: iso(r.recoveredAtMs) });
      }
    } else {
      await this.#announce(context, eff, created, false, 'OPEN', `open:${created.incidentId}`);
    }
    return { created: true, incident: created };
  }

  // ---- people acting on an incident ----

  async acknowledge(context: TransactionContext, incidentId: string, actor: Actor, expectedVersion: number): Promise<IncidentRow> {
    const incident = await this.#liveLocked(context, incidentId, expectedVersion);
    if (incident.status !== 'NEW') {
      throw new AppError('OPS_INCIDENT_STATE_CONFLICT');
    }
    const next = (await this.incidents.update(context, incidentId, { status: 'ACKNOWLEDGED', acknowledgedAt: 'NOW', assigneeUserId: incident.assigneeUserId ?? actor.userId }, expectedVersion)) as IncidentRow;
    await this.#log(context, next, 'INFO', 'ACKNOWLEDGED', 'Đã nhận xử lý', actor.userId);
    return next;
  }

  async startWork(context: TransactionContext, incidentId: string, actor: Actor, expectedVersion: number): Promise<IncidentRow> {
    const incident = await this.#liveLocked(context, incidentId, expectedVersion);
    if (incident.status !== 'NEW' && incident.status !== 'ACKNOWLEDGED') {
      throw new AppError('OPS_INCIDENT_STATE_CONFLICT');
    }
    const next = (await this.incidents.update(context, incidentId, { status: 'IN_PROGRESS', ...(incident.acknowledgedAtMs === null ? { acknowledgedAt: 'NOW' as const } : {}), assigneeUserId: incident.assigneeUserId ?? actor.userId }, expectedVersion)) as IncidentRow;
    await this.#log(context, next, 'INFO', 'IN_PROGRESS', 'Đang xử lý', actor.userId);
    return next;
  }

  async assign(context: TransactionContext, incidentId: string, assigneeUserId: string | null, actor: Actor, expectedVersion: number): Promise<IncidentRow> {
    const incident = await this.#liveLocked(context, incidentId, expectedVersion);
    const next = (await this.incidents.update(context, incidentId, { assigneeUserId }, expectedVersion)) as IncidentRow;
    await this.#log(context, next, 'INFO', 'ASSIGNED', assigneeUserId === null ? 'Bỏ người phụ trách' : 'Đã giao người phụ trách', actor.userId, { assignee: assigneeUserId, previous: incident.assigneeUserId });
    return next;
  }

  async addNote(context: TransactionContext, incidentId: string, text: string, actor: Actor): Promise<void> {
    const incident = await this.incidents.findById(context, incidentId);
    if (incident === undefined) {
      throw new AppError('OPS_INCIDENT_NOT_FOUND');
    }
    await this.#log(context, incident, 'INFO', 'NOTE', text, actor.userId);
  }

  async snooze(context: TransactionContext, incidentId: string, minutes: number, actor: Actor, expectedVersion: number): Promise<IncidentRow> {
    const incident = await this.#liveLocked(context, incidentId, expectedVersion);
    if (incident.status === 'RECOVERED') {
      throw new AppError('OPS_INCIDENT_STATE_CONFLICT');
    }
    const eff = await this.settings.load(context);
    if (minutes < 10 || minutes > (eff.settings['alert.snooze_max_minutes'] as number)) {
      throw new AppError('OPS_SETTINGS_INVALID');
    }
    const until = (await freshClockMs(context)) + minutes * 60_000;
    const next = (await this.incidents.update(context, incidentId, { snoozedUntilMs: until, snoozeNoticePending: true }, expectedVersion)) as IncidentRow;
    await this.#log(context, next, 'INFO', 'SNOOZED', `Tạm hoãn ${minutes} phút`, actor.userId, { until: iso(until) });
    return next;
  }

  /**
   * Close. A RECOVERED incident closes plainly. Anything else is closed only when the check is back to OK, or when the person confirms the check is STILL failing
   * (or has no data): the incident is then marked closed-while-failing, the real check state stays visible, and the next failing observation opens a NEW linked
   * incident. Closing never hides a failing check.
   */
  async close(context: TransactionContext, incidentId: string, actor: Actor, expectedVersion: number, confirmStillFailing: boolean, note: string | null): Promise<IncidentRow> {
    const incident = await this.#liveLocked(context, incidentId, expectedVersion);
    const check = await this.repo.findCheck(context, incident.checkKey);
    const failing = check === undefined || check.state !== 'OK';
    if (incident.status !== 'RECOVERED' && failing && !confirmStillFailing) {
      throw new AppError('OPS_INCIDENT_STATE_CONFLICT');
    }
    const whileFailing = incident.status !== 'RECOVERED' && failing;
    const next = (await this.incidents.update(
      context,
      incidentId,
      { status: 'CLOSED', closedAt: 'NOW', closedBy: actor.userId, closedWhileFailing: whileFailing, ...(incident.recoveredAtMs === null && !whileFailing ? { recoveredAt: 'NOW' as const } : {}) },
      expectedVersion,
    )) as IncidentRow;
    await this.#log(
      context,
      next,
      whileFailing ? 'WARN' : 'INFO',
      'CLOSED',
      whileFailing ? `Đóng thủ công khi kiểm tra vẫn ${check === undefined ? 'chưa có dữ liệu' : check.state === 'UNKNOWN' ? 'chưa có dữ liệu' : 'lỗi'}${note === null ? '' : `: ${note}`}` : 'Đã đóng sự cố',
      actor.userId,
      { closed_while_failing: whileFailing },
    );
    return next;
  }

  /** First time somebody with access opens the incident: recorded once, changes no status. */
  async markViewed(context: TransactionContext, incidentId: string, userId: string): Promise<void> {
    if (await this.incidents.markViewed(context, incidentId, userId)) {
      const incident = await this.incidents.findById(context, incidentId);
      if (incident !== undefined) {
        await this.#log(context, incident, 'INFO', 'VIEWED', 'Đã được mở xem lần đầu (chưa nhận xử lý)', userId);
      }
    }
  }

  // ---- the periodic sweep ----

  /**
   * Reminders, the first message of an incident that was silenced by maintenance, the end of a snooze, the maintenance flag, and the automatic close of an
   * incident that has been recovered for a while. Called by the runtime on every tick; idempotent (dedupe keys), so a missed or doubled tick changes nothing.
   */
  async sweep(context: TransactionContext): Promise<{ reminders: number; closed: number }> {
    const eff = await this.settings.load(context);
    const now = await freshClockMs(context);
    let reminders = 0;
    let closed = 0;
    for (const incident of await this.incidents.listLive(context, true)) {
      const maintenance = await this.#inMaintenance(context, incident.source);
      if (maintenance !== incident.inMaintenance) {
        await this.incidents.update(context, incident.incidentId, { inMaintenance: maintenance });
      }
      if (incident.status === 'RECOVERED') {
        const hours = eff.settings['alert.auto_close_hours'] as number;
        if (incident.recoveredAtMs !== null && now - incident.recoveredAtMs >= hours * 3_600_000) {
          const next = (await this.incidents.update(context, incident.incidentId, { status: 'CLOSED', closedAt: 'NOW', closedBy: null, closedWhileFailing: false })) as IncidentRow;
          await this.#log(context, next, 'INFO', 'CLOSED', `Tự đóng sau ${hours} giờ đã phục hồi`, undefined);
          closed += 1;
        }
        continue;
      }
      if (maintenance) {
        continue;
      }
      const snoozed = incident.snoozedUntilMs !== null && incident.snoozedUntilMs > now;
      // The first message was withheld (maintenance, or the channel was off when it opened): send it now that nothing silences it.
      if (!incident.externalNotified && !(await this.#wasAnnounced(context, incident)) && !snoozed) {
        if (await this.#announce(context, eff, incident, false, 'OPEN', `open:${incident.incidentId}:late`)) {
          await this.incidents.update(context, incident.incidentId, { lastNotifiedAt: 'NOW' });
        }
        continue;
      }
      if (incident.snoozeNoticePending && incident.snoozedUntilMs !== null && incident.snoozedUntilMs <= now && incident.status !== 'NEW') {
        // An acknowledged incident whose snooze ran out and which is still open: one notice (design 8: "quá hạn tạm hoãn").
        await this.#notify(context, eff, incident, 'SNOOZE_END', incident.severity, `snz:${incident.incidentId}:${incident.snoozedUntilMs}`, { title: incident.title, at: iso(now) });
        await this.incidents.update(context, incident.incidentId, { snoozeNoticePending: false });
        continue;
      }
      if (incident.snoozeNoticePending && incident.status === 'NEW' && incident.snoozedUntilMs !== null && incident.snoozedUntilMs <= now) {
        // An unacknowledged incident simply resumes its reminders when the snooze ends: no separate notice.
        await this.incidents.update(context, incident.incidentId, { snoozeNoticePending: false });
      }
      if (incident.status !== 'NEW' || snoozed) {
        continue;
      }
      const every = (incident.severity === 'CRITICAL' ? (eff.settings['alert.reminder_critical_minutes'] as number) : (eff.settings['alert.reminder_warning_minutes'] as number)) * 60_000;
      const since = Math.max(incident.lastReminderAtMs ?? 0, incident.lastNotifiedAtMs ?? 0, incident.firstSeenAtMs);
      if (now - since >= every) {
        const key = `rem:${incident.incidentId}:${Math.floor(now / every)}`;
        const row = await this.#notify(context, eff, incident, 'REMINDER', incident.severity, key, { title: incident.title, at: iso(now) });
        if (row !== undefined) {
          await this.incidents.supersedePending(context, incident.incidentId, ['REMINDER'], row.notificationId);
        }
        await this.incidents.update(context, incident.incidentId, { lastReminderAt: 'NOW' });
        reminders += 1;
      }
    }
    return { reminders, closed };
  }

  // ---- maintenance ----

  async #inMaintenance(context: TransactionContext, source: OpsSource): Promise<boolean> {
    const active = await this.incidents.activeMaintenance(context);
    return active.some((m) => m.scopes.includes(source));
  }

  // ---- notifications ----

  async #wasAnnounced(context: TransactionContext, incident: IncidentRow): Promise<boolean> {
    if (incident.externalNotified) {
      return true;
    }
    const rows = await this.incidents.listForIncident(context, incident.incidentId);
    // Decided at creation: a message skipped for MAINTENANCE is still owed once the window ends; one skipped because the channel was off or below the minimum is not re-queued.
    return rows.some((n) => (n.kind === 'OPEN' || n.kind === 'ESCALATION') && (n.status !== 'SKIPPED' || n.skipReason !== 'MAINTENANCE'));
  }

  /** The decision "will this message be sent?" at the moment it is created: a closed channel, a severity below the threshold or a maintenance window make it SKIPPED with the reason. */
  #skipReason(eff: OpsEffective, severity: DiscordSeverity, maintenance: boolean): string | undefined {
    if (maintenance) return 'MAINTENANCE';
    if (!eff.webhookConfigured) return 'NOT_CONFIGURED';
    if (!eff.discordEnabled) return 'DISABLED';
    if (severity === 'WARNING' && eff.discordMinSeverity === 'CRITICAL') return 'BELOW_MIN';
    return undefined;
  }

  async #announce(context: TransactionContext, eff: OpsEffective, incident: IncidentRow, maintenance: boolean, kind: 'OPEN' | 'ESCALATION', key: string): Promise<boolean> {
    // The probe already told the channel about the outage it measured: an OPEN of such an incident is not repeated from here.
    if (incident.externalNotified && kind === 'OPEN') {
      await this.incidents.enqueue(context, { notificationId: randomUUID(), incidentId: incident.incidentId, kind, severity: incident.severity, content: this.#content(incident, incident.firstSeenAtMs), dedupeKey: key, skipReason: 'EXTERNAL_SENT' });
      return false;
    }
    const row = await this.#notify(context, eff, incident, kind, incident.severity, key, { title: incident.title, at: iso(incident.firstSeenAtMs) }, maintenance);
    if (row !== undefined && row.status !== 'SKIPPED') {
      await this.incidents.update(context, incident.incidentId, { lastNotifiedAt: 'NOW' });
      return true;
    }
    return false;
  }

  async #notify(
    context: TransactionContext,
    eff: OpsEffective,
    incident: IncidentRow,
    kind: NotificationKind,
    severity: DiscordSeverity,
    dedupeKey: string,
    extra: { title: string; at: string },
    maintenance?: boolean,
  ): Promise<NotificationRow | undefined> {
    const inMaintenance = maintenance ?? (await this.#inMaintenance(context, incident.source));
    // A recovery or reminder of an incident that was announced follows the same channel rules; severity INFO (a recovery) is never filtered by the minimum.
    const skipReason = this.#skipReason(eff, severity === 'INFO' ? 'CRITICAL' : severity, inMaintenance);
    return this.incidents.enqueue(context, {
      notificationId: randomUUID(),
      incidentId: incident.incidentId,
      kind,
      severity,
      content: { ...this.#content(incident, Date.parse(extra.at)), title: extra.title },
      dedupeKey,
      ...(skipReason === undefined ? {} : { skipReason }),
    });
  }

  #content(incident: IncidentRow, atMs: number): Record<string, unknown> {
    const link = this.link(incident.code);
    return {
      title: incident.title,
      source: SOURCE_LABEL[incident.source],
      impact: incident.impact,
      at: iso(Number.isFinite(atMs) ? atMs : Date.now()),
      code: incident.code,
      occurrences: incident.occurrences,
      ...(link === undefined ? {} : { link }),
    };
  }

  /** A notice that has no incident (a test message, a deploy result): same channel rules, same row. */
  async enqueueFreeNotice(context: TransactionContext, kind: Extract<NotificationKind, 'TEST' | 'DEPLOY' | 'MAINTENANCE'>, severity: DiscordSeverity, content: Record<string, unknown>, dedupeKey: string): Promise<NotificationRow | undefined> {
    const eff = await this.settings.load(context);
    const skipReason = this.#skipReason(eff, severity === 'INFO' ? 'CRITICAL' : severity, false);
    return this.incidents.enqueue(context, {
      notificationId: randomUUID(),
      incidentId: null,
      kind,
      severity,
      content: { at: iso(await freshClockMs(context)), ...content },
      dedupeKey,
      ...(skipReason === undefined ? {} : { skipReason }),
    });
  }

  // ---- log of an incident ----

  async #log(context: TransactionContext, incident: IncidentRow, level: EventLevel, code: string, message: string, actorUserId?: string, detail?: Record<string, unknown>): Promise<void> {
    await this.repo.insertEvent(
      context,
      {
        category: 'INCIDENT',
        level,
        source: incident.source,
        environment: this.#environment,
        appVersion: this.#version,
        code,
        kind: code,
        message,
        incidentId: incident.incidentId,
        actorUserId: actorUserId ?? null,
        detail: { incident_code: incident.code, ...(detail ?? {}) },
      },
      randomUUID(),
    );
  }

  /** Log line for something that happened to an incident outside the engine (the Discord send result). */
  async logIncident(context: TransactionContext, incidentId: string, level: EventLevel, code: string, message: string, detail?: Record<string, unknown>): Promise<void> {
    const incident = await this.incidents.findById(context, incidentId);
    if (incident !== undefined) {
      await this.#log(context, incident, level, code, message, undefined, detail);
    }
  }

  async #liveLocked(context: TransactionContext, incidentId: string, expectedVersion: number): Promise<IncidentRow> {
    const incident = await this.incidents.findById(context, incidentId, true);
    if (incident === undefined) {
      throw new AppError('OPS_INCIDENT_NOT_FOUND');
    }
    if (incident.version !== expectedVersion) {
      throw new AppError('VERSION_CONFLICT');
    }
    if (!LIVE_INCIDENT_STATUSES.includes(incident.status)) {
      throw new AppError('OPS_INCIDENT_STATE_CONFLICT');
    }
    return incident;
  }
}
