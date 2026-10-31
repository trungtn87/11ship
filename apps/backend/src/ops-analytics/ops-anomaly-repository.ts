import { Injectable } from '@nestjs/common';
import { JsonObject } from '../idempotency/idempotency-executor';
import { TransactionContext } from '../transaction/transaction-context';

// SQL of the anomaly SIGNALS (issue #242). A case is evidence for a person to review; nothing here touches an account, a wallet, an order or the right to take work.
// The rules count only what the stored rows prove: a cancellation by the system, a search that found nobody, a shop's refusal or an Admin action is never the
// subject's doing, and a missing reason is kept as UNKNOWN (never turned into blame).

export const RULE_KINDS = ['CUSTOMER_ORDER_CANCELS', 'DIRECT_CALL_CANCELS', 'SHIPPER_ABANDONS', 'REPEAT_PAIR_CANCELS'] as const;
export type RuleKind = (typeof RULE_KINDS)[number];
export const CASE_STATUSES = ['NEW', 'REVIEWING', 'CHECKED', 'DISMISSED'] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export interface AnomalySettings {
  readonly windowDays: number;
  readonly minSamples: number;
  readonly ratePct: number;
  readonly repeatPerDay: number;
  readonly version: number;
  readonly updatedAtMs: number;
}

export interface Finding {
  readonly rule: RuleKind;
  readonly subjectKind: 'USER' | 'DRIVER';
  readonly subjectId: string;
  readonly occurrences: number;
  readonly sample: number;
  readonly ratePct: number | null;
  readonly lastEvidenceMs: number;
  readonly evidence: JsonObject[];
}

export interface CaseRow {
  readonly caseId: string;
  readonly rule: RuleKind;
  readonly subjectKind: 'USER' | 'DRIVER';
  readonly subjectId: string;
  readonly status: CaseStatus;
  readonly occurrences: number;
  readonly sample: number;
  readonly ratePct: number | null;
  readonly windowFromMs: number;
  readonly windowToMs: number;
  readonly evidence: JsonObject[];
  readonly lastEvidenceMs: number;
  readonly note: string | null;
  readonly version: number;
  readonly firstFlaggedMs: number;
  readonly closedMs: number | null;
  readonly updatedMs: number;
}

interface RawCase {
  case_id: string; rule_kind: RuleKind; subject_kind: 'USER' | 'DRIVER'; subject_id: string; status: CaseStatus; occurrences: number; sample: number; rate_pct: string | null;
  window_from_ms: string; window_to_ms: string; evidence: JsonObject[]; last_evidence_ms: string; note: string | null; version: string; first_ms: string; closed_ms: string | null; updated_ms: string;
}

const ms = (column: string, alias: string): string => `(extract(epoch FROM ${column}) * 1000)::bigint::text AS ${alias}`;
const CASE_COLUMNS = `case_id::text AS case_id, rule_kind, subject_kind, subject_id::text AS subject_id, status, occurrences, sample, rate_pct::text AS rate_pct,
  ${ms('window_from', 'window_from_ms')}, ${ms('window_to', 'window_to_ms')}, evidence, ${ms('last_evidence_at', 'last_evidence_ms')}, note, version::text AS version,
  ${ms('first_flagged_at', 'first_ms')}, ${ms('closed_at', 'closed_ms')}, ${ms('updated_at', 'updated_ms')}`;

function toCase(r: RawCase): CaseRow {
  return {
    caseId: r.case_id, rule: r.rule_kind, subjectKind: r.subject_kind, subjectId: r.subject_id, status: r.status, occurrences: r.occurrences, sample: r.sample,
    ratePct: r.rate_pct === null ? null : Number(r.rate_pct), windowFromMs: Number(r.window_from_ms), windowToMs: Number(r.window_to_ms), evidence: r.evidence,
    lastEvidenceMs: Number(r.last_evidence_ms), note: r.note, version: Number(r.version), firstFlaggedMs: Number(r.first_ms), closedMs: r.closed_ms === null ? null : Number(r.closed_ms), updatedMs: Number(r.updated_ms),
  };
}

const EVIDENCE_LIMIT = 30;

@Injectable()
export class OpsAnomalySettingsRepository {
  async read(context: TransactionContext): Promise<AnomalySettings> {
    const result = await context.query<{ window_days: number; min_samples: number; rate_pct: number; repeat_per_day: number; version: string; updated_ms: string }>(
      `SELECT window_days, min_samples, rate_pct, repeat_per_day, version::text AS version, ${ms('updated_at', 'updated_ms')} FROM app.ops_anomaly_settings WHERE singleton`,
    );
    const r = result.rows[0];
    if (r === undefined) throw new Error('anomaly settings row is missing');
    return { windowDays: r.window_days, minSamples: r.min_samples, ratePct: r.rate_pct, repeatPerDay: r.repeat_per_day, version: Number(r.version), updatedAtMs: Number(r.updated_ms) };
  }

  async lock(context: TransactionContext): Promise<AnomalySettings> {
    await context.query('SELECT 1 FROM app.ops_anomaly_settings WHERE singleton FOR UPDATE');
    return this.read(context);
  }

  async update(context: TransactionContext, s: { windowDays: number; minSamples: number; ratePct: number; repeatPerDay: number }, actorUserId: string): Promise<void> {
    await context.query(
      `UPDATE app.ops_anomaly_settings SET window_days = $1::int, min_samples = $2::int, rate_pct = $3::int, repeat_per_day = $4::int, version = version + 1, updated_by = $5::uuid, updated_at = clock_timestamp() WHERE singleton`,
      [s.windowDays, s.minSamples, s.ratePct, s.repeatPerDay, actorUserId],
    );
  }
}

@Injectable()
export class OpsAnomalyRepository {
  // ---- the rules ------------------------------------------------------------------------------------------------------------

  /** A customer who cancels many of the Orders they placed (cancelled by them / Orders that ended by their own or the normal way). */
  async customerOrderCancels(context: TransactionContext, s: AnomalySettings, nowMs: number): Promise<Finding[]> {
    const rows = await context.query<{ subject: string; occurrences: number; sample: number; last_ms: string; evidence: JsonObject[] }>(
      `WITH w AS (
         SELECT o.order_id, o.customer_user_id, o.status, o.created_at, o.ended_at, o.confirmed_at, o.end_reason, COALESCE(app.shop_display_order(o.order_id), o.code) AS code
           FROM app.orders o
          WHERE o.created_at >= to_timestamp($1::bigint / 1000.0) - ($2::int * interval '1 day') AND o.created_at < to_timestamp($1::bigint / 1000.0)
            AND o.status NOT IN ('PENDING_CONFIRMATION', 'PREPARING', 'CANCELLED_BY_SYSTEM', 'REJECTED_BY_SHOP', 'CANCELLED_BY_SHOP')
       )
       SELECT customer_user_id::text AS subject, count(*) FILTER (WHERE status = 'CANCELLED_BY_CUSTOMER')::int AS occurrences, count(*)::int AS sample,
              (extract(epoch FROM max(ended_at) FILTER (WHERE status = 'CANCELLED_BY_CUSTOMER')) * 1000)::bigint::text AS last_ms,
              COALESCE((SELECT jsonb_agg(e ORDER BY e->>'at' DESC) FROM (SELECT jsonb_build_object('code', x.code, 'at', to_char(x.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                  'stage', CASE WHEN x.confirmed_at IS NULL THEN 'BEFORE_SHOP_CONFIRM' ELSE 'AFTER_SHOP_CONFIRM' END, 'reason', COALESCE(x.end_reason, 'UNKNOWN')) AS e
                  FROM w x WHERE x.customer_user_id = w.customer_user_id AND x.status = 'CANCELLED_BY_CUSTOMER' ORDER BY x.created_at DESC LIMIT ${String(EVIDENCE_LIMIT)}) q), '[]'::jsonb) AS evidence
         FROM w GROUP BY customer_user_id
       HAVING count(*) >= $3::int AND count(*) FILTER (WHERE status = 'CANCELLED_BY_CUSTOMER') * 100 >= $4::int * count(*) AND count(*) FILTER (WHERE status = 'CANCELLED_BY_CUSTOMER') >= 2`,
      [nowMs, s.windowDays, s.minSamples, s.ratePct],
    );
    return rows.rows.map((r) => ({ rule: 'CUSTOMER_ORDER_CANCELS', subjectKind: 'USER', subjectId: r.subject, occurrences: r.occurrences, sample: r.sample, ratePct: Math.round((r.occurrences / r.sample) * 10000) / 100, lastEvidenceMs: Number(r.last_ms), evidence: r.evidence }));
  }

  /** The account that asked for many direct calls and cancelled them itself (not: no Shipper found, cancelled by the system). */
  async directCallCancels(context: TransactionContext, s: AnomalySettings, nowMs: number): Promise<Finding[]> {
    const rows = await context.query<{ subject: string; occurrences: number; sample: number; last_ms: string; evidence: JsonObject[] }>(
      `WITH w AS (
         SELECT d.delivery_id, d.requested_by, d.state, d.code, d.created_at, d.ended_at, d.end_reason,
                EXISTS (SELECT 1 FROM app.delivery_assignments a WHERE a.delivery_id = d.delivery_id) AS had_assignment
           FROM app.deliveries d
          WHERE d.source <> 'ORDER' AND d.created_at >= to_timestamp($1::bigint / 1000.0) - ($2::int * interval '1 day') AND d.created_at < to_timestamp($1::bigint / 1000.0)
            AND d.state IN ('completed', 'failed', 'cancelled_by_merchant')
       )
       SELECT requested_by::text AS subject, count(*) FILTER (WHERE state = 'cancelled_by_merchant')::int AS occurrences, count(*)::int AS sample,
              (extract(epoch FROM max(ended_at) FILTER (WHERE state = 'cancelled_by_merchant')) * 1000)::bigint::text AS last_ms,
              COALESCE((SELECT jsonb_agg(e ORDER BY e->>'at' DESC) FROM (SELECT jsonb_build_object('code', x.code, 'at', to_char(x.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                  'stage', CASE WHEN x.had_assignment THEN 'AFTER_SHIPPER_ACCEPTED' ELSE 'BEFORE_SHIPPER_ACCEPTED' END, 'reason', COALESCE(x.end_reason, 'UNKNOWN')) AS e
                  FROM w x WHERE x.requested_by = w.requested_by AND x.state = 'cancelled_by_merchant' ORDER BY x.created_at DESC LIMIT ${String(EVIDENCE_LIMIT)}) q), '[]'::jsonb) AS evidence
         FROM w GROUP BY requested_by
       HAVING count(*) >= $3::int AND count(*) FILTER (WHERE state = 'cancelled_by_merchant') * 100 >= $4::int * count(*) AND count(*) FILTER (WHERE state = 'cancelled_by_merchant') >= 2`,
      [nowMs, s.windowDays, s.minSamples, s.ratePct],
    );
    return rows.rows.map((r) => ({ rule: 'DIRECT_CALL_CANCELS', subjectKind: 'USER', subjectId: r.subject, occurrences: r.occurrences, sample: r.sample, ratePct: Math.round((r.occurrences / r.sample) * 10000) / 100, lastEvidenceMs: Number(r.last_ms), evidence: r.evidence }));
  }

  /** A Shipper who took work and gave it back before pickup, many times (only the Shipper's own release counts; an Admin release or the shop's cancel does not). */
  async shipperAbandons(context: TransactionContext, s: AnomalySettings, nowMs: number): Promise<Finding[]> {
    const rows = await context.query<{ subject: string; occurrences: number; sample: number; last_ms: string; evidence: JsonObject[] }>(
      `WITH w AS (
         SELECT a.assignment_id, a.driver_id, a.status, a.accepted_at, a.ended_at, a.end_reason, d.code
           FROM app.delivery_assignments a JOIN app.deliveries d ON d.delivery_id = a.delivery_id
          WHERE a.accepted_at >= to_timestamp($1::bigint / 1000.0) - ($2::int * interval '1 day') AND a.accepted_at < to_timestamp($1::bigint / 1000.0)
            AND a.status IN ('COMPLETED', 'FAILED', 'CANCELLED_BY_SHIPPER')
       )
       SELECT driver_id::text AS subject, count(*) FILTER (WHERE status = 'CANCELLED_BY_SHIPPER')::int AS occurrences, count(*)::int AS sample,
              (extract(epoch FROM max(ended_at) FILTER (WHERE status = 'CANCELLED_BY_SHIPPER')) * 1000)::bigint::text AS last_ms,
              COALESCE((SELECT jsonb_agg(e ORDER BY e->>'at' DESC) FROM (SELECT jsonb_build_object('code', x.code, 'at', to_char(x.accepted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                  'stage', 'BEFORE_PICKUP', 'reason', COALESCE(x.end_reason, 'UNKNOWN')) AS e
                  FROM w x WHERE x.driver_id = w.driver_id AND x.status = 'CANCELLED_BY_SHIPPER' ORDER BY x.accepted_at DESC LIMIT ${String(EVIDENCE_LIMIT)}) q), '[]'::jsonb) AS evidence
         FROM w GROUP BY driver_id
       HAVING count(*) >= $3::int AND count(*) FILTER (WHERE status = 'CANCELLED_BY_SHIPPER') * 100 >= $4::int * count(*) AND count(*) FILTER (WHERE status = 'CANCELLED_BY_SHIPPER') >= 2`,
      [nowMs, s.windowDays, s.minSamples, s.ratePct],
    );
    return rows.rows.map((r) => ({ rule: 'SHIPPER_ABANDONS', subjectKind: 'DRIVER', subjectId: r.subject, occurrences: r.occurrences, sample: r.sample, ratePct: Math.round((r.occurrences / r.sample) * 10000) / 100, lastEvidenceMs: Number(r.last_ms), evidence: r.evidence }));
  }

  /** The same customer, the same shop and the same Shipper, cancelled `repeat_per_day` times or more on one Vietnam day AFTER the Shipper had taken the order. */
  async repeatPairCancels(context: TransactionContext, s: AnomalySettings, nowMs: number): Promise<Finding[]> {
    const rows = await context.query<{ subject: string; occurrences: number; last_ms: string; evidence: JsonObject[] }>(
      `WITH w AS (
         SELECT o.customer_user_id, o.shop_id, a.driver_id, (o.ended_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS day, o.ended_at, COALESCE(app.shop_display_order(o.order_id), o.code) AS code,
                o.shop_name, o.end_reason
           FROM app.orders o JOIN app.deliveries d ON d.order_id = o.order_id JOIN app.delivery_assignments a ON a.delivery_id = d.delivery_id
          WHERE o.status IN ('CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_SHOP') AND o.ended_at >= to_timestamp($1::bigint / 1000.0) - ($2::int * interval '1 day') AND o.ended_at < to_timestamp($1::bigint / 1000.0)
       ), g AS (
         SELECT customer_user_id, shop_id, driver_id, day, count(DISTINCT code)::int AS n, max(ended_at) AS last_at, jsonb_agg(DISTINCT jsonb_build_object('code', code, 'day', day::text, 'shop', shop_name, 'reason', COALESCE(end_reason, 'UNKNOWN'))) AS items
           FROM w GROUP BY customer_user_id, shop_id, driver_id, day HAVING count(DISTINCT code) >= $3::int
       )
       SELECT customer_user_id::text AS subject, max(n)::int AS occurrences, (extract(epoch FROM max(last_at)) * 1000)::bigint::text AS last_ms,
              jsonb_agg(jsonb_build_object('day', day::text, 'orders', n, 'items', items) ORDER BY day DESC) AS evidence
         FROM g GROUP BY customer_user_id`,
      [nowMs, s.windowDays, s.repeatPerDay],
    );
    return rows.rows.map((r) => ({ rule: 'REPEAT_PAIR_CANCELS', subjectKind: 'USER', subjectId: r.subject, occurrences: r.occurrences, sample: r.occurrences, ratePct: null, lastEvidenceMs: Number(r.last_ms), evidence: r.evidence.slice(0, EVIDENCE_LIMIT) }));
  }

  // ---- the cases ------------------------------------------------------------------------------------------------------------

  async findOpen(context: TransactionContext, rule: RuleKind, subjectId: string, lock: boolean): Promise<CaseRow | undefined> {
    const result = await context.query<RawCase>(`SELECT ${CASE_COLUMNS} FROM app.ops_anomaly_cases WHERE rule_kind = $1 AND subject_id = $2::uuid AND status IN ('NEW', 'REVIEWING')${lock ? ' FOR UPDATE' : ''}`, [rule, subjectId]);
    return result.rows[0] === undefined ? undefined : toCase(result.rows[0]);
  }

  async lastClosed(context: TransactionContext, rule: RuleKind, subjectId: string): Promise<CaseRow | undefined> {
    const result = await context.query<RawCase>(`SELECT ${CASE_COLUMNS} FROM app.ops_anomaly_cases WHERE rule_kind = $1 AND subject_id = $2::uuid AND status IN ('CHECKED', 'DISMISSED') ORDER BY closed_at DESC LIMIT 1`, [rule, subjectId]);
    return result.rows[0] === undefined ? undefined : toCase(result.rows[0]);
  }

  async insert(context: TransactionContext, caseId: string, f: Finding, windowFromMs: number, windowToMs: number): Promise<void> {
    await context.query(
      `INSERT INTO app.ops_anomaly_cases (case_id, rule_kind, subject_kind, subject_id, status, occurrences, sample, rate_pct, window_from, window_to, evidence, last_evidence_at)
       VALUES ($1::uuid, $2, $3, $4::uuid, 'NEW', $5::int, $6::int, $7::numeric, to_timestamp($8::bigint / 1000.0), to_timestamp($9::bigint / 1000.0), $10::jsonb, to_timestamp($11::bigint / 1000.0))`,
      [caseId, f.rule, f.subjectKind, f.subjectId, f.occurrences, f.sample, f.ratePct, windowFromMs, windowToMs, JSON.stringify(f.evidence), f.lastEvidenceMs],
    );
  }

  /** Refreshes the figures of an OPEN case; nothing changes (and no version moves) when the facts are the same. */
  async refresh(context: TransactionContext, c: CaseRow, f: Finding, windowFromMs: number, windowToMs: number): Promise<boolean> {
    if (c.occurrences === f.occurrences && c.sample === f.sample && c.lastEvidenceMs === f.lastEvidenceMs) return false;
    await context.query(
      `UPDATE app.ops_anomaly_cases SET occurrences = $2::int, sample = $3::int, rate_pct = $4::numeric, window_from = to_timestamp($5::bigint / 1000.0), window_to = to_timestamp($6::bigint / 1000.0),
              evidence = $7::jsonb, last_evidence_at = to_timestamp($8::bigint / 1000.0), version = version + 1, updated_at = clock_timestamp() WHERE case_id = $1::uuid`,
      [c.caseId, f.occurrences, f.sample, f.ratePct, windowFromMs, windowToMs, JSON.stringify(f.evidence), f.lastEvidenceMs],
    );
    return true;
  }

  async list(context: TransactionContext, f: { status: CaseStatus | 'OPEN' | null; rule: RuleKind | null; rules: readonly RuleKind[]; q: string }, limit: number, offset: number): Promise<{ rows: CaseRow[]; total: number }> {
    const where = `rule_kind = ANY($1::text[]) AND ($2::text IS NULL OR rule_kind = $2) AND ($3::text IS NULL OR ($3 = 'OPEN' AND status IN ('NEW', 'REVIEWING')) OR status = $3) AND ($4::text = '' OR subject_id::text ILIKE $4)`;
    const params = [[...f.rules], f.rule, f.status, f.q === '' ? '' : `${f.q}%`];
    const total = await context.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.ops_anomaly_cases WHERE ${where}`, params);
    const result = await context.query<RawCase>(`SELECT ${CASE_COLUMNS} FROM app.ops_anomaly_cases WHERE ${where} ORDER BY updated_at DESC, case_id LIMIT $5 OFFSET $6`, [...params, limit, offset]);
    return { rows: result.rows.map(toCase), total: Number(total.rows[0]?.n ?? '0') };
  }

  async counts(context: TransactionContext, rules: readonly RuleKind[]): Promise<Record<string, number>> {
    const result = await context.query<{ status: string; n: string }>('SELECT status, count(*)::text AS n FROM app.ops_anomaly_cases WHERE rule_kind = ANY($1::text[]) GROUP BY status', [[...rules]]);
    return Object.fromEntries(result.rows.map((r) => [r.status, Number(r.n)]));
  }

  async find(context: TransactionContext, caseId: string, lock: boolean): Promise<CaseRow | undefined> {
    const result = await context.query<RawCase>(`SELECT ${CASE_COLUMNS} FROM app.ops_anomaly_cases WHERE case_id = $1::uuid${lock ? ' FOR UPDATE' : ''}`, [caseId]);
    return result.rows[0] === undefined ? undefined : toCase(result.rows[0]);
  }

  async transition(context: TransactionContext, c: CaseRow, to: CaseStatus, note: string | null, eventId: string, action: string, actorUserId: string): Promise<void> {
    const closing = to === 'CHECKED' || to === 'DISMISSED';
    await context.query(
      `UPDATE app.ops_anomaly_cases SET status = $2, note = COALESCE($3, note), closed_at = ${closing ? 'clock_timestamp()' : 'NULL'}, version = version + 1, updated_at = clock_timestamp() WHERE case_id = $1::uuid`,
      [c.caseId, to, note],
    );
    await context.query(
      `INSERT INTO app.ops_anomaly_case_events (event_id, case_id, action, from_status, to_status, note, actor_user_id) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::uuid)`,
      [eventId, c.caseId, action, c.status, to, note, actorUserId],
    );
  }

  async events(context: TransactionContext, caseId: string): Promise<{ action: string; fromStatus: string | null; toStatus: string; note: string | null; actor: string | null; atMs: number }[]> {
    const result = await context.query<{ action: string; from_status: string | null; to_status: string; note: string | null; actor: string | null; at_ms: string }>(
      `SELECT action, from_status, to_status, note, actor_user_id::text AS actor, ${ms('at', 'at_ms')} FROM app.ops_anomaly_case_events WHERE case_id = $1::uuid ORDER BY at, event_id`,
      [caseId],
    );
    return result.rows.map((r) => ({ action: r.action, fromStatus: r.from_status, toStatus: r.to_status, note: r.note, actor: r.actor, atMs: Number(r.at_ms) }));
  }
}
