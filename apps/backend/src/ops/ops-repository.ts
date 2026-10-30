import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../transaction/transaction-context';
import { AccessLevel, CheckState, EventCategory, EventLevel, OpsSource } from './ops-constants';
import { redactDetail, redactText } from './ops-redact';
import { CLOCK, fromMs, jsonOf, likePattern, ms, num, numOrNull } from './ops-sql';

// SQL of the M13 settings, scopes, checks, metrics, log and retention. Every method takes the caller's TransactionContext: none of them begins, commits or
// rolls back, and none decides policy.

// ---- settings --------------------------------------------------------------------------------------------------------------------

export interface SealedWebhook {
  readonly iv: Buffer;
  readonly tag: Buffer;
  readonly ciphertext: Buffer;
  readonly keyId: string;
}

export interface OpsConfigRow {
  readonly version: number;
  /** Only the keys SYSTEM changed (see ops-settings.ts). */
  readonly overrides: Readonly<Record<string, number>>;
  readonly discordEnabled: boolean;
  readonly discordMinSeverity: 'WARNING' | 'CRITICAL';
  readonly webhook: SealedWebhook | null;
  readonly webhookUpdatedAtMs: number | null;
  readonly updatedAtMs: number | null;
}

export const DEFAULT_CONFIG_ROW: OpsConfigRow = {
  version: 0,
  overrides: {},
  discordEnabled: false,
  discordMinSeverity: 'WARNING',
  webhook: null,
  webhookUpdatedAtMs: null,
  updatedAtMs: null,
};

export interface ConfigWrite {
  readonly overrides: Readonly<Record<string, number>>;
  readonly discordEnabled: boolean;
  readonly discordMinSeverity: 'WARNING' | 'CRITICAL';
  /** keep = leave the sealed webhook as it is; clear = remove it; a value = replace it. */
  readonly webhook: 'keep' | 'clear' | SealedWebhook;
}

// ---- checks ----------------------------------------------------------------------------------------------------------------------

export interface CheckRow {
  readonly checkKey: string;
  readonly source: OpsSource;
  readonly state: CheckState;
  readonly observedAtMs: number;
  readonly sinceAtMs: number;
  readonly consecutiveFailures: number;
  readonly consecutiveSuccesses: number;
  readonly value: Record<string, unknown>;
  readonly evidenceCode: string | null;
  readonly staleAfterSeconds: number;
}

export interface Observation {
  readonly checkKey: string;
  readonly source: OpsSource;
  readonly state: CheckState;
  /** Measured by the observer; absent = the database clock now. */
  readonly observedAtMs?: number;
  readonly value?: Record<string, unknown>;
  readonly evidenceCode?: string | null;
  readonly staleAfterSeconds: number;
}

// ---- log -------------------------------------------------------------------------------------------------------------------------

export interface EventInput {
  readonly category: EventCategory;
  readonly level: EventLevel;
  readonly source: OpsSource;
  readonly environment: string;
  readonly appVersion?: string | null;
  readonly code?: string | null;
  readonly kind?: string | null;
  readonly message: string;
  readonly requestRef?: string | null;
  readonly deliveryCode?: string | null;
  readonly transactionRef?: string | null;
  readonly userId?: string | null;
  readonly incidentId?: string | null;
  readonly actorUserId?: string | null;
  readonly detail?: unknown;
  /** The time the event happened when the reporter measured it (an app that was offline); absent = now. */
  readonly occurredAtMs?: number;
}

export interface EventRow {
  readonly eventId: string;
  readonly seq: number;
  readonly occurredAtMs: number;
  readonly category: EventCategory;
  readonly level: EventLevel;
  readonly source: OpsSource;
  readonly environment: string;
  readonly appVersion: string | null;
  readonly code: string | null;
  readonly kind: string | null;
  readonly message: string;
  readonly requestRef: string | null;
  readonly deliveryCode: string | null;
  readonly transactionRef: string | null;
  readonly userId: string | null;
  readonly incidentId: string | null;
  readonly actorUserId: string | null;
  readonly detail: Record<string, unknown>;
}

export interface EventQuery {
  readonly group: 'TECHNICAL' | 'INCIDENT' | 'ADMIN' | null;
  readonly source: string | null;
  readonly level: EventLevel | null;
  readonly code: string | null;
  readonly deliveryCode: string | null;
  readonly userId: string | null;
  readonly appVersion: string | null;
  readonly incidentId: string | null;
  readonly fromMs: number | null;
  readonly toMs: number | null;
}

export interface MetricPoint {
  readonly atMs: number;
  readonly value: number;
}

export interface RetentionDays {
  readonly techDays: number;
  readonly errorDays: number;
  readonly metricsDetailDays: number;
  readonly metricsHourlyDays: number;
  readonly incidentDays: number;
  readonly adminDays: number;
}

export interface RetentionResult {
  readonly events: number;
  readonly metricsFolded: number;
  readonly metricsRaw: number;
  readonly metricsHourly: number;
  readonly incidents: number;
  readonly adminEvents: number;
  readonly notifications: number;
  readonly backupReports: number;
}

const EVENT_COLUMNS = `event_id, seq::text AS seq, ${ms('occurred_at', 'occurred_ms')}, category, level, source, environment, app_version, code, kind, message, request_ref, delivery_code,
  transaction_ref, user_id, incident_id, actor_user_id, detail`;

interface EventDbRow {
  event_id: string;
  seq: string;
  occurred_ms: string;
  category: EventCategory;
  level: EventLevel;
  source: OpsSource;
  environment: string;
  app_version: string | null;
  code: string | null;
  kind: string | null;
  message: string;
  request_ref: string | null;
  delivery_code: string | null;
  transaction_ref: string | null;
  user_id: string | null;
  incident_id: string | null;
  actor_user_id: string | null;
  detail: Record<string, unknown>;
}

const eventOf = (r: EventDbRow): EventRow => ({
  eventId: r.event_id,
  seq: num(r.seq),
  occurredAtMs: num(r.occurred_ms),
  category: r.category,
  level: r.level,
  source: r.source,
  environment: r.environment,
  appVersion: r.app_version,
  code: r.code,
  kind: r.kind,
  message: r.message,
  requestRef: r.request_ref,
  deliveryCode: r.delivery_code,
  transactionRef: r.transaction_ref,
  userId: r.user_id,
  incidentId: r.incident_id,
  actorUserId: r.actor_user_id,
  detail: r.detail,
});

const CHECK_COLUMNS = `check_key, source, state, ${ms('observed_at', 'observed_ms')}, ${ms('since_at', 'since_ms')}, consecutive_failures, consecutive_successes, value, evidence_code, stale_after_seconds`;

interface CheckDbRow {
  check_key: string;
  source: OpsSource;
  state: CheckState;
  observed_ms: string;
  since_ms: string;
  consecutive_failures: number;
  consecutive_successes: number;
  value: Record<string, unknown>;
  evidence_code: string | null;
  stale_after_seconds: number;
}

const checkOf = (r: CheckDbRow): CheckRow => ({
  checkKey: r.check_key,
  source: r.source,
  state: r.state,
  observedAtMs: num(r.observed_ms),
  sinceAtMs: num(r.since_ms),
  consecutiveFailures: r.consecutive_failures,
  consecutiveSuccesses: r.consecutive_successes,
  value: r.value,
  evidenceCode: r.evidence_code,
  staleAfterSeconds: r.stale_after_seconds,
});

@Injectable()
export class OpsRepository {
  // ---- settings ----

  async readConfig(context: TransactionContext, lock = false): Promise<OpsConfigRow> {
    const result = await context.query<{
      version: string;
      settings: Record<string, number>;
      discord_enabled: boolean;
      discord_min_severity: 'WARNING' | 'CRITICAL';
      webhook_iv: Buffer | null;
      webhook_tag: Buffer | null;
      webhook_ciphertext: Buffer | null;
      webhook_key_id: string | null;
      webhook_ms: string | null;
      updated_ms: string;
    }>(
      `SELECT version::text AS version, settings, discord_enabled, discord_min_severity, webhook_iv, webhook_tag, webhook_ciphertext, webhook_key_id,
              CASE WHEN webhook_updated_at IS NULL THEN NULL ELSE (extract(epoch FROM webhook_updated_at) * 1000)::bigint::text END AS webhook_ms,
              (extract(epoch FROM updated_at) * 1000)::bigint::text AS updated_ms
         FROM app.ops_config WHERE config_id = 1${lock ? ' FOR UPDATE' : ''}`,
    );
    const r = result.rows[0];
    if (r === undefined) {
      return DEFAULT_CONFIG_ROW;
    }
    return {
      version: num(r.version),
      overrides: r.settings,
      discordEnabled: r.discord_enabled,
      discordMinSeverity: r.discord_min_severity,
      webhook: r.webhook_ciphertext === null || r.webhook_iv === null || r.webhook_tag === null || r.webhook_key_id === null ? null : { iv: r.webhook_iv, tag: r.webhook_tag, ciphertext: r.webhook_ciphertext, keyId: r.webhook_key_id },
      webhookUpdatedAtMs: numOrNull(r.webhook_ms),
      updatedAtMs: num(r.updated_ms),
    };
  }

  /** Version-checked write; the first write (version 0) creates the row. Returns false when the version moved. */
  async writeConfig(context: TransactionContext, expectedVersion: number, next: ConfigWrite, updatedBy: string): Promise<boolean> {
    const current = expectedVersion === 0 ? undefined : await this.readConfig(context, true);
    const webhook = next.webhook === 'keep' ? (current?.webhook ?? null) : next.webhook === 'clear' ? null : next.webhook;
    const webhookAt = next.webhook === 'keep' ? current?.webhookUpdatedAtMs : next.webhook === 'clear' ? null : Date.now();
    const values = [
      jsonOf(next.overrides),
      next.discordEnabled,
      next.discordMinSeverity,
      webhook?.iv ?? null,
      webhook?.tag ?? null,
      webhook?.ciphertext ?? null,
      webhook?.keyId ?? null,
      webhook === null ? null : (webhookAt ?? Date.now()),
      updatedBy,
    ];
    if (expectedVersion === 0) {
      const inserted = await context.query(
        `INSERT INTO app.ops_config (config_id, version, settings, discord_enabled, discord_min_severity, webhook_iv, webhook_tag, webhook_ciphertext, webhook_key_id, webhook_updated_at, updated_by, updated_at)
         VALUES (1, 1, $1::jsonb, $2, $3, $4, $5, $6, $7, CASE WHEN $8::bigint IS NULL THEN NULL ELSE ${fromMs('$8')} END, $9::uuid, ${CLOCK})
         ON CONFLICT (config_id) DO NOTHING`,
        values,
      );
      return inserted.rowCount === 1;
    }
    const updated = await context.query(
      `UPDATE app.ops_config
          SET version = version + 1, settings = $1::jsonb, discord_enabled = $2, discord_min_severity = $3, webhook_iv = $4, webhook_tag = $5, webhook_ciphertext = $6,
              webhook_key_id = $7, webhook_updated_at = CASE WHEN $8::bigint IS NULL THEN NULL ELSE ${fromMs('$8')} END, updated_by = $9::uuid, updated_at = ${CLOCK}
        WHERE config_id = 1 AND version = $10`,
      [...values, expectedVersion],
    );
    return updated.rowCount === 1;
  }

  // ---- who may see M13 ----

  async scopeOf(context: TransactionContext, userId: string, lock = false): Promise<{ level: AccessLevel; version: number } | undefined> {
    const result = await context.query<{ level: AccessLevel; version: string }>(
      `SELECT level, version::text AS version FROM app.ops_admin_scopes WHERE user_id = $1::uuid${lock ? ' FOR UPDATE' : ' FOR SHARE'}`,
      [userId],
    );
    const r = result.rows[0];
    return r === undefined ? undefined : { level: r.level, version: num(r.version) };
  }

  async listScopes(context: TransactionContext): Promise<{ userId: string; level: AccessLevel; version: number; updatedAtMs: number }[]> {
    const result = await context.query<{ user_id: string; level: AccessLevel; version: string; updated_ms: string }>(
      `SELECT user_id, level, version::text AS version, ${ms('updated_at', 'updated_ms')} FROM app.ops_admin_scopes ORDER BY updated_at DESC LIMIT 200`,
    );
    return result.rows.map((r) => ({ userId: r.user_id, level: r.level, version: num(r.version), updatedAtMs: num(r.updated_ms) }));
  }

  async writeScope(context: TransactionContext, userId: string, level: AccessLevel, expectedVersion: number, updatedBy: string): Promise<boolean> {
    if (expectedVersion === 0) {
      const inserted = await context.query(
        `INSERT INTO app.ops_admin_scopes (user_id, level, version, updated_by, updated_at) VALUES ($1::uuid, $2, 1, $3::uuid, ${CLOCK}) ON CONFLICT (user_id) DO NOTHING`,
        [userId, level, updatedBy],
      );
      return inserted.rowCount === 1;
    }
    const updated = await context.query(
      `UPDATE app.ops_admin_scopes SET level = $2, version = version + 1, updated_by = $3::uuid, updated_at = ${CLOCK} WHERE user_id = $1::uuid AND version = $4`,
      [userId, level, updatedBy, expectedVersion],
    );
    return updated.rowCount === 1;
  }

  // ---- checks ----

  /**
   * Records one observation of one check and returns the row before and after. The counters move only with the evidence: a failure adds to the failure streak,
   * an OK adds to the success streak, UNKNOWN ("no data") changes the state but not the streaks. The state since-time moves only when the state changes.
   */
  async observe(context: TransactionContext, o: Observation): Promise<{ previous: CheckRow | undefined; current: CheckRow }> {
    const locked = await context.query<CheckDbRow>(`SELECT ${CHECK_COLUMNS} FROM app.ops_checks WHERE check_key = $1 FOR UPDATE`, [o.checkKey]);
    const previous = locked.rows[0] === undefined ? undefined : checkOf(locked.rows[0]);
    const at = o.observedAtMs === undefined ? null : o.observedAtMs;
    const failing = o.state === 'WARNING' || o.state === 'CRITICAL';
    const failures = o.state === 'UNKNOWN' ? (previous?.consecutiveFailures ?? 0) : failing ? (previous?.consecutiveFailures ?? 0) + 1 : 0;
    const successes = o.state === 'UNKNOWN' ? (previous?.consecutiveSuccesses ?? 0) : o.state === 'OK' ? (previous?.consecutiveSuccesses ?? 0) + 1 : 0;
    const timeExpr = `COALESCE(CASE WHEN $4::bigint IS NULL THEN NULL ELSE ${fromMs('$4')} END, ${CLOCK})`;
    const values = [o.checkKey, o.source, o.state, at, failures, successes, jsonOf(o.value ?? {}), o.evidenceCode ?? null, o.staleAfterSeconds];
    if (previous === undefined) {
      await context.query(
        `INSERT INTO app.ops_checks (check_key, source, state, observed_at, since_at, consecutive_failures, consecutive_successes, value, evidence_code, stale_after_seconds)
         VALUES ($1, $2, $3, ${timeExpr}, ${timeExpr}, $5, $6, $7::jsonb, $8, $9)`,
        values,
      );
    } else {
      await context.query(
        `UPDATE app.ops_checks
            SET source = $2::varchar, state = $3::varchar, observed_at = ${timeExpr},
                since_at = CASE WHEN state = $3::varchar THEN since_at ELSE ${timeExpr} END,
                consecutive_failures = $5, consecutive_successes = $6, value = $7::jsonb, evidence_code = $8, stale_after_seconds = $9
          WHERE check_key = $1`,
        values,
      );
    }
    const after = await context.query<CheckDbRow>(`SELECT ${CHECK_COLUMNS} FROM app.ops_checks WHERE check_key = $1`, [o.checkKey]);
    return { previous, current: checkOf(after.rows[0] as CheckDbRow) };
  }

  async listChecks(context: TransactionContext): Promise<CheckRow[]> {
    const result = await context.query<CheckDbRow>(`SELECT ${CHECK_COLUMNS} FROM app.ops_checks ORDER BY check_key`);
    return result.rows.map(checkOf);
  }

  async findCheck(context: TransactionContext, checkKey: string): Promise<CheckRow | undefined> {
    const result = await context.query<CheckDbRow>(`SELECT ${CHECK_COLUMNS} FROM app.ops_checks WHERE check_key = $1`, [checkKey]);
    return result.rows[0] === undefined ? undefined : checkOf(result.rows[0]);
  }

  // ---- metrics ----

  async insertMetric(context: TransactionContext, key: string, value: number): Promise<void> {
    if (!Number.isFinite(value)) {
      return;
    }
    await context.query(`INSERT INTO app.ops_metrics (metric_key, observed_at, value) VALUES ($1, ${CLOCK}, $2)`, [key, value]);
  }

  /** The newest `limit` raw points of a metric at or after `sinceMs`, oldest first. */
  async recentMetrics(context: TransactionContext, key: string, sinceMs: number, limit = 400): Promise<MetricPoint[]> {
    const result = await context.query<{ at_ms: string; value: number }>(
      `SELECT at_ms, value FROM (
         SELECT (extract(epoch FROM observed_at) * 1000)::bigint::text AS at_ms, value, observed_at FROM app.ops_metrics
          WHERE metric_key = $1 AND observed_at >= ${fromMs('$2')} ORDER BY observed_at DESC LIMIT $3) t ORDER BY observed_at ASC`,
      [key, sinceMs, limit],
    );
    return result.rows.map((r) => ({ atMs: num(r.at_ms), value: Number(r.value) }));
  }

  async hourlyMetrics(context: TransactionContext, key: string, sinceMs: number, limit = 400): Promise<{ hourMs: number; avg: number; max: number; samples: number }[]> {
    const result = await context.query<{ hour_ms: string; avg_value: number; max_value: number; samples: number }>(
      `SELECT (extract(epoch FROM hour_at) * 1000)::bigint::text AS hour_ms, avg_value, max_value, samples
         FROM app.ops_metrics_hourly WHERE metric_key = $1 AND hour_at >= ${fromMs('$2')} ORDER BY hour_at ASC LIMIT $3`,
      [key, sinceMs, limit],
    );
    return result.rows.map((r) => ({ hourMs: num(r.hour_ms), avg: Number(r.avg_value), max: Number(r.max_value), samples: r.samples }));
  }

  /** Connections of THIS database and its size: the only PostgreSQL facts the VPS page shows (never a connection string). */
  async databaseStats(context: TransactionContext): Promise<{ activeConnections: number; sizeBytes: number }> {
    const result = await context.query<{ connections: number; size_bytes: string }>(
      `SELECT (SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database()) AS connections, pg_database_size(current_database())::bigint::text AS size_bytes`,
    );
    const row = result.rows[0];
    return { activeConnections: row === undefined ? 0 : Number(row.connections), sizeBytes: row === undefined ? 0 : num(row.size_bytes) };
  }

  /**
   * Averages per time bucket for several metrics at once (bucket starts are aligned to the epoch, so the same instant always falls in the same bucket).
   * `hourly` reads the rolled-up table; otherwise the raw detail rows.
   */
  async bucketedMetrics(context: TransactionContext, keys: readonly string[], sinceMs: number, bucketSeconds: number, source: 'raw' | 'hourly'): Promise<{ key: string; bucketMs: number; avg: number; max: number }[]> {
    const table = source === 'raw' ? 'app.ops_metrics' : 'app.ops_metrics_hourly';
    const at = source === 'raw' ? 'observed_at' : 'hour_at';
    const avg = source === 'raw' ? 'avg(value)' : 'sum(avg_value * samples) / NULLIF(sum(samples), 0)';
    const max = source === 'raw' ? 'max(value)' : 'max(max_value)';
    const result = await context.query<{ metric_key: string; bucket_ms: string; avg_value: number; max_value: number }>(
      `SELECT metric_key, (floor(extract(epoch FROM ${at}) / $3::double precision) * $3::double precision * 1000)::bigint::text AS bucket_ms, ${avg} AS avg_value, ${max} AS max_value
         FROM ${table} WHERE metric_key = ANY($1::text[]) AND ${at} >= ${fromMs('$2')}
        GROUP BY metric_key, 2 ORDER BY 2 ASC`,
      [[...keys], sinceMs, bucketSeconds],
    );
    return result.rows.map((r) => ({ key: r.metric_key, bucketMs: num(r.bucket_ms), avg: Number(r.avg_value), max: Number(r.max_value) }));
  }

  /** When the independent probe last opened an outage of the public API (null = never). */
  async lastProbeOutageMs(context: TransactionContext): Promise<number | null> {
    const result = await context.query<{ at_ms: string | null }>(
      `SELECT (extract(epoch FROM max(first_seen_at)) * 1000)::bigint::text AS at_ms FROM app.ops_incidents WHERE source = 'EXTERNAL_PROBE' AND check_key = 'public_api'`,
    );
    return numOrNull(result.rows[0]?.at_ms);
  }

  // ---- log ----

  /** Appends one log line. Everything free-form is redacted HERE, so a producer that forgets cannot leak. */
  async insertEvent(context: TransactionContext, e: EventInput, eventId: string): Promise<void> {
    await context.query(
      `INSERT INTO app.ops_events (event_id, occurred_at, category, level, source, environment, app_version, code, kind, message, request_ref, delivery_code, transaction_ref, user_id, incident_id, actor_user_id, detail)
       VALUES ($1::uuid, COALESCE(CASE WHEN $2::bigint IS NULL THEN NULL ELSE ${fromMs('$2')} END, ${CLOCK}), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::uuid, $15::uuid, $16::uuid, $17::jsonb)`,
      [
        eventId,
        e.occurredAtMs ?? null,
        e.category,
        e.level,
        e.source,
        e.environment,
        e.appVersion ?? null,
        e.code === undefined || e.code === null ? null : e.code.toUpperCase().replace(/[^A-Z0-9_.:-]/g, '_').slice(0, 48) || null,
        e.kind ?? null,
        redactText(e.message) || '-',
        e.requestRef === undefined || e.requestRef === null ? null : /^[A-Za-z0-9._:-]{1,64}$/.test(e.requestRef) ? e.requestRef : redactText(e.requestRef, 64),
        e.deliveryCode === undefined || e.deliveryCode === null ? null : redactText(e.deliveryCode, 32),
        e.transactionRef === undefined || e.transactionRef === null ? null : redactText(e.transactionRef, 64),
        e.userId ?? null,
        e.incidentId ?? null,
        e.actorUserId ?? null,
        jsonOf(redactDetail(e.detail)),
      ],
    );
  }

  /** Whether this account already reported this exact line (an app retries a batch after a lost response; the second copy is dropped). */
  async clientEntryKnown(context: TransactionContext, userId: string, ref: string): Promise<boolean> {
    const result = await context.query(`SELECT 1 FROM app.ops_events WHERE user_id = $1::uuid AND request_ref = $2 AND category = 'TECHNICAL' LIMIT 1`, [userId, ref]);
    return (result.rowCount ?? 0) > 0;
  }

  async recentEventsOfUser(context: TransactionContext, userId: string, sinceMs: number): Promise<number> {
    const result = await context.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.ops_events WHERE user_id = $1::uuid AND category = 'TECHNICAL' AND occurred_at >= ${fromMs('$2')}`, [userId, sinceMs]);
    return num(result.rows[0]?.n ?? '0');
  }

  async searchEvents(context: TransactionContext, q: EventQuery, page: { limit: number; offset: number }): Promise<{ rows: EventRow[]; total: number }> {
    const where: string[] = [];
    const args: unknown[] = [];
    const add = (sql: string, value: unknown): void => {
      args.push(value);
      where.push(sql.replace('?', `$${args.length}`));
    };
    if (q.group !== null) add('category = ?', q.group);
    if (q.source !== null) add('source = ?', q.source);
    if (q.level !== null) add('level = ?', q.level);
    if (q.code !== null) add(`code ILIKE ? ESCAPE '\\'`, likePattern(q.code));
    if (q.deliveryCode !== null) add(`delivery_code ILIKE ? ESCAPE '\\'`, likePattern(q.deliveryCode));
    if (q.userId !== null) add('user_id = ?::uuid', q.userId);
    if (q.appVersion !== null) add('app_version = ?', q.appVersion);
    if (q.incidentId !== null) add('incident_id = ?::uuid', q.incidentId);
    if (q.fromMs !== null) add(`occurred_at >= ${fromMs('?')}`, q.fromMs);
    if (q.toMs !== null) add(`occurred_at < ${fromMs('?')}`, q.toMs);
    const clause = where.length === 0 ? '' : `WHERE ${where.join(' AND ')}`;
    const total = await context.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.ops_events ${clause}`, args);
    const rows = await context.query<EventDbRow>(`SELECT ${EVENT_COLUMNS} FROM app.ops_events ${clause} ORDER BY occurred_at DESC, seq DESC LIMIT ${Number(page.limit)} OFFSET ${Number(page.offset)}`, args);
    return { rows: rows.rows.map(eventOf), total: num(total.rows[0]?.n ?? '0') };
  }

  async timeline(context: TransactionContext, incidentId: string): Promise<EventRow[]> {
    const result = await context.query<EventDbRow>(`SELECT ${EVENT_COLUMNS} FROM app.ops_events WHERE incident_id = $1::uuid ORDER BY occurred_at ASC, seq ASC LIMIT 500`, [incidentId]);
    return result.rows.map(eventOf);
  }

  /** The recent technical errors of a source (evidence for an incident detail). */
  async recentErrors(context: TransactionContext, source: string, limit: number): Promise<EventRow[]> {
    const result = await context.query<EventDbRow>(
      `SELECT ${EVENT_COLUMNS} FROM app.ops_events WHERE category = 'TECHNICAL' AND source = $1 AND level <> 'INFO' ORDER BY occurred_at DESC, seq DESC LIMIT $2`,
      [source, limit],
    );
    return result.rows.map(eventOf);
  }

  /** Error lines of a source (optionally one app version) of the given kinds at or after `sinceMs`, with the number of distinct reporters (a burst needs several). */
  async clientErrorBurst(context: TransactionContext, source: string, appVersion: string | null, kinds: readonly string[], sinceMs: number): Promise<{ errors: number; reporters: number }> {
    const result = await context.query<{ errors: string; reporters: string }>(
      `SELECT count(*)::text AS errors, count(DISTINCT COALESCE(user_id::text, request_ref))::text AS reporters
         FROM app.ops_events WHERE category = 'TECHNICAL' AND source = $1 AND ($2::text IS NULL OR app_version = $2) AND level = 'ERROR' AND kind = ANY($3::text[]) AND occurred_at >= ${fromMs('$4')}`,
      [source, appVersion, [...kinds], sinceMs],
    );
    return { errors: num(result.rows[0]?.errors ?? '0'), reporters: num(result.rows[0]?.reporters ?? '0') };
  }

  /** Versions of a source that reported errors of these kinds since `sinceMs` (null = a line that carried no version). */
  async clientErrorVersions(context: TransactionContext, source: string, kinds: readonly string[], sinceMs: number): Promise<(string | null)[]> {
    const result = await context.query<{ app_version: string | null }>(
      `SELECT DISTINCT app_version FROM app.ops_events WHERE category = 'TECHNICAL' AND source = $1 AND level = 'ERROR' AND kind = ANY($2::text[]) AND occurred_at >= ${fromMs('$3')} LIMIT 20`,
      [source, [...kinds], sinceMs],
    );
    return result.rows.map((r) => r.app_version);
  }

  /** The event queue (outbox) as monitoring sees it: how many wait, how old the oldest due one is, how many are dead. Read-only. */
  async outboxStats(context: TransactionContext): Promise<{ pending: number; dead: number; oldestDueAgeMs: number | null }> {
    const result = await context.query<{ pending: string; dead: string; age_ms: string | null }>(
      `SELECT count(*) FILTER (WHERE status = 'PENDING')::text AS pending, count(*) FILTER (WHERE status = 'DEAD')::text AS dead,
              (extract(epoch FROM (clock_timestamp() - min(available_at) FILTER (WHERE status = 'PENDING' AND available_at <= clock_timestamp()))) * 1000)::bigint::text AS age_ms
         FROM app.outbox_events WHERE status IN ('PENDING', 'DEAD')`,
    );
    const r = result.rows[0];
    return { pending: num(r?.pending ?? '0'), dead: num(r?.dead ?? '0'), oldestDueAgeMs: numOrNull(r?.age_ms ?? null) };
  }

  /** Whether a technical line with this kind/source/code was recorded at or after `sinceMs` (the M08 / M14 / app evidence checks). */
  async countEvents(context: TransactionContext, filter: { source: string; kinds?: readonly string[]; level?: EventLevel; sinceMs: number }): Promise<number> {
    const result = await context.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM app.ops_events WHERE category = 'TECHNICAL' AND source = $1 AND occurred_at >= ${fromMs('$2')}
          AND ($3::text[] IS NULL OR kind = ANY($3::text[])) AND ($4::text IS NULL OR level = $4)`,
      [filter.source, filter.sinceMs, filter.kinds === undefined ? null : [...filter.kinds], filter.level ?? null],
    );
    return num(result.rows[0]?.n ?? '0');
  }

  // ---- people and the administration audit (read-only) ----

  /** A masked label for each user id (the last three digits of the phone): enough to tell administrators apart, never a full number. */
  async userLabels(context: TransactionContext, ids: readonly string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)].slice(0, 200);
    if (unique.length === 0) {
      return new Map();
    }
    const result = await context.query<{ user_id: string; tail: string }>(`SELECT user_id, right(phone_normalized, 3) AS tail FROM app.users WHERE user_id = ANY($1::uuid[])`, [unique]);
    return new Map(result.rows.map((r) => [r.user_id, `Quản trị ••••${r.tail}`]));
  }

  // ---- retention ----

  /**
   * The retention pass (design section 11): log lines by their class (incident timeline, errors, everything else), raw metrics folded into hours and
   * dropped, hourly rows, closed incidents with their Discord rows, old backup reports. Business tables are never named here. The log trigger allows the
   * DELETE only because this transaction says so (a LOCAL setting).
   */
  async purge(context: TransactionContext, days: RetentionDays, batch: number): Promise<RetentionResult> {
    await context.query(`SELECT set_config('app.ops_purge', 'on', true)`);
    const incidentCut = `${CLOCK} - make_interval(days => $1::int)`;
    // 1. Log lines of expired incidents go first (the incident rows are deleted below).
    const doomed = await context.query<{ incident_id: string }>(
      `SELECT incident_id FROM app.ops_incidents WHERE status = 'CLOSED' AND closed_at < ${incidentCut} ORDER BY closed_at LIMIT $2`,
      [days.incidentDays, batch],
    );
    const ids = doomed.rows.map((r) => r.incident_id);
    let notifications = 0;
    let incidents = 0;
    let events = 0;
    if (ids.length > 0) {
      events += (await context.query(`DELETE FROM app.ops_events WHERE incident_id = ANY($1::uuid[])`, [ids])).rowCount ?? 0;
      notifications += (await context.query(`DELETE FROM app.ops_notifications WHERE incident_id = ANY($1::uuid[])`, [ids])).rowCount ?? 0;
      await context.query(`UPDATE app.ops_incidents SET reopens_incident_id = NULL WHERE reopens_incident_id = ANY($1::uuid[])`, [ids]);
      incidents = (await context.query(`DELETE FROM app.ops_incidents WHERE incident_id = ANY($1::uuid[])`, [ids])).rowCount ?? 0;
    }
    // 2. Notifications with no incident (test, deploy, maintenance notices) follow the incident window.
    notifications += (await context.query(`DELETE FROM app.ops_notifications WHERE incident_id IS NULL AND created_at < ${incidentCut}`, [days.incidentDays])).rowCount ?? 0;
    // 3. Technical lines: errors after errorDays, everything else after techDays (the incident category is kept with its incident).
    events += (
      await context.query(
        `DELETE FROM app.ops_events WHERE event_id IN (
           SELECT event_id FROM app.ops_events WHERE category = 'TECHNICAL' AND (
             (level = 'ERROR' AND occurred_at < ${CLOCK} - make_interval(days => $1::int)) OR (level <> 'ERROR' AND occurred_at < ${CLOCK} - make_interval(days => $2::int))
           ) LIMIT $3)`,
        [days.errorDays, days.techDays, batch],
      )
    ).rowCount ?? 0;
    // 3b. The administration log keeps its own (longer) window.
    const adminEvents = (await context.query(`DELETE FROM app.ops_events WHERE event_id IN (SELECT event_id FROM app.ops_events WHERE category = 'ADMIN' AND occurred_at < ${CLOCK} - make_interval(days => $1::int) LIMIT $2)`, [days.adminDays, batch])).rowCount ?? 0;
    // 4. Raw metrics: fold the complete hours that are about to expire into the hourly table, then drop them.
    const rawCut = `date_trunc('hour', ${CLOCK} - make_interval(days => $1::int))`;
    const folded = await context.query(
      `INSERT INTO app.ops_metrics_hourly (metric_key, hour_at, samples, avg_value, max_value)
       SELECT metric_key, date_trunc('hour', observed_at), count(*)::int, avg(value), max(value) FROM app.ops_metrics WHERE observed_at < ${rawCut} GROUP BY 1, 2
       ON CONFLICT (metric_key, hour_at) DO NOTHING`,
      [days.metricsDetailDays],
    );
    const raw = await context.query(`DELETE FROM app.ops_metrics WHERE observed_at < ${rawCut}`, [days.metricsDetailDays]);
    const hourly = await context.query(`DELETE FROM app.ops_metrics_hourly WHERE hour_at < ${CLOCK} - make_interval(days => $1::int)`, [days.metricsHourlyDays]);
    const backups = await context.query(`DELETE FROM app.ops_backup_reports WHERE reported_at < ${CLOCK} - make_interval(days => $1::int)`, [days.incidentDays]);
    return {
      events,
      metricsFolded: folded.rowCount ?? 0,
      metricsRaw: raw.rowCount ?? 0,
      metricsHourly: hourly.rowCount ?? 0,
      incidents,
      adminEvents,
      notifications,
      backupReports: backups.rowCount ?? 0,
    };
  }
}
