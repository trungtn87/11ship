import { AppError } from '../common/app-errors';
import { isCanonicalUuid } from '../shared/identifiers';
import { SourceFilter } from './ops-analytics-repository';
import { AnalyticsQuery, AnalyticsRange } from './ops-analytics-service';
import { AnomalyAction, ANOMALY_ACTIONS } from './ops-anomaly-service';
import { CASE_STATUSES, CaseStatus, RULE_KINDS, RuleKind } from './ops-anomaly-repository';

// Strict parsers: an unknown key, a wrong type or an out-of-range number is ADMIN_INPUT_INVALID (a query or a body is never "best effort").

const invalid = (): never => {
  throw new AppError('ADMIN_INPUT_INVALID');
};

function plain(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid();
  const proto = Object.getPrototypeOf(value) as unknown;
  if (proto !== Object.prototype && proto !== null) return invalid();
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some((key) => !allowed.includes(key))) return invalid();
  return source;
}

const whole = (value: unknown, min: number, max: number): number => {
  const n = typeof value === 'string' && /^[0-9]{1,9}$/u.test(value) ? Number(value) : value;
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= min && n <= max ? n : invalid();
};

const RANGES: readonly AnalyticsRange[] = ['today', '7d', '30d', 'custom'];
const SOURCES: readonly SourceFilter[] = ['ALL', 'ORDER', 'DIRECT'];
const DAY = /^\d{4}-\d{2}-\d{2}$/u;

function analytics(source: Record<string, unknown>): AnalyticsQuery {
  const range = source.range === undefined ? 'today' : source.range;
  if (typeof range !== 'string' || !(RANGES as readonly string[]).includes(range)) return invalid();
  const kind = source.source === undefined ? 'ALL' : source.source;
  if (typeof kind !== 'string' || !(SOURCES as readonly string[]).includes(kind)) return invalid();
  if (range === 'custom') {
    if (typeof source.from !== 'string' || typeof source.to !== 'string' || !DAY.test(source.from) || !DAY.test(source.to)) return invalid();
    return { range: 'custom', from: source.from, to: source.to, source: kind as SourceFilter };
  }
  if (source.from !== undefined || source.to !== undefined) return invalid();
  return { range: range as AnalyticsRange, source: kind as SourceFilter };
}

export function parseAnalyticsQuery(query: unknown): AnalyticsQuery {
  return analytics(plain(query, ['range', 'from', 'to', 'source']));
}

export const DRILL_KINDS = ['search_failed', 'slow_confirm', 'expired_confirm', 'cancelled_at_step'] as const;
export type DrillKind = (typeof DRILL_KINDS)[number];

export function parseDrilldownQuery(query: unknown): { query: AnalyticsQuery; kind: DrillKind; step: string | null; limit: number; offset: number } {
  const source = plain(query, ['range', 'from', 'to', 'source', 'kind', 'step', 'limit', 'offset']);
  const kind = source.kind;
  if (typeof kind !== 'string' || !(DRILL_KINDS as readonly string[]).includes(kind)) return invalid();
  const step = source.step === undefined ? null : source.step;
  if (kind === 'cancelled_at_step' ? typeof step !== 'string' || !/^[A-Z_]{3,16}$/u.test(step) : step !== null) return invalid();
  return {
    query: analytics(source), kind: kind as DrillKind, step: step as string | null,
    limit: source.limit === undefined ? 20 : whole(source.limit, 1, 50), offset: source.offset === undefined ? 0 : whole(source.offset, 0, 100_000),
  };
}

export function parseAnomalyListQuery(query: unknown): { status: CaseStatus | 'OPEN' | null; rule: RuleKind | null; q: string; limit: number; offset: number } {
  const source = plain(query, ['status', 'rule', 'q', 'limit', 'offset']);
  const status = source.status === undefined ? 'OPEN' : source.status;
  if (status !== 'ALL' && status !== 'OPEN' && !(typeof status === 'string' && (CASE_STATUSES as readonly string[]).includes(status))) return invalid();
  const rule = source.rule === undefined ? null : source.rule;
  if (rule !== null && !(typeof rule === 'string' && (RULE_KINDS as readonly string[]).includes(rule))) return invalid();
  const q = source.q === undefined ? '' : source.q;
  if (typeof q !== 'string' || !/^[0-9a-fA-F-]{0,36}$/u.test(q)) return invalid();
  return { status: status === 'ALL' ? null : (status as CaseStatus | 'OPEN'), rule: rule as RuleKind | null, q, limit: source.limit === undefined ? 20 : whole(source.limit, 1, 50), offset: source.offset === undefined ? 0 : whole(source.offset, 0, 100_000) };
}

export function parseCaseId(value: unknown): string {
  return isCanonicalUuid(value) ? value : invalid();
}

export function parseActionBody(body: unknown): { action: AnomalyAction; expectedVersion: number; note: string | null } {
  const source = plain(body, ['action', 'expected_version', 'note']);
  if (typeof source.action !== 'string' || !(ANOMALY_ACTIONS as readonly string[]).includes(source.action)) return invalid();
  let note: string | null = null;
  if (source.note !== undefined && source.note !== null) {
    if (typeof source.note !== 'string') return invalid();
    note = source.note.normalize('NFC').replace(/\s+/gu, ' ').trim();
    if (note === '') note = null;
    if (note !== null && [...note].length > 500) return invalid();
  }
  return { action: source.action as AnomalyAction, expectedVersion: whole(source.expected_version, 1, Number.MAX_SAFE_INTEGER), note };
}

export function parseSettingsBody(body: unknown): { windowDays: number; minSamples: number; ratePct: number; repeatPerDay: number; expectedVersion: number; reason: string } {
  const source = plain(body, ['window_days', 'min_samples', 'rate_pct', 'repeat_per_day', 'expected_version', 'reason']);
  if (typeof source.reason !== 'string') return invalid();
  const reason = source.reason.normalize('NFC').replace(/\s+/gu, ' ').trim();
  if (reason === '' || [...reason].length > 300) return invalid();
  return {
    windowDays: whole(source.window_days, 1, 30), minSamples: whole(source.min_samples, 2, 100), ratePct: whole(source.rate_pct, 1, 100), repeatPerDay: whole(source.repeat_per_day, 2, 50),
    expectedVersion: whole(source.expected_version, 1, Number.MAX_SAFE_INTEGER), reason,
  };
}
