// HTTP client of the overview (M12-A): GET /v1/admin/overview. Cookie-only, read-only. Every answer is parsed strictly: a body that does not have
// the documented shape is "unknown", never half-shown numbers. Nothing is stored here.

import { failureOf } from './accounts-api.js';
import { ApiClient, ApiResult, record, str } from './api.js';
import { ActionQueue, ActionQueueRead, QUEUE_KINDS, QUEUE_LINK_AREAS, QueueItem, QueueKind, QueueLink, QueueLinkArea, QueueQuery, QueueSource } from './action-queue.js';
import { Metric, MetricGroup, MetricLink, OVERVIEW_RANGES, Overview, OverviewQuery, OverviewRange, OverviewRead, OverviewSource, SuccessRate, TodoItem } from './overview.js';

export const OVERVIEW_BASE = '/v1';

const AREAS: readonly string[] = ['deliveries', 'shippers', 'finance-topups', 'finance-withdrawals', 'orders', 'complaints'];
const STATUSES: readonly string[] = ['OK', 'FORBIDDEN', 'NOT_READY', 'ERROR'];
const safeInt = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);
const iso = (value: unknown): string | undefined => {
  const text = str(value);
  return text !== undefined && !Number.isNaN(Date.parse(text)) ? text : undefined;
};

function parseLink(value: unknown): MetricLink | undefined {
  const raw = record(value);
  const query = record(raw?.query);
  if (raw === undefined || query === undefined || typeof raw.area !== 'string' || !AREAS.includes(raw.area)) {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(query)) {
    if (typeof entry !== 'string') {
      return undefined;
    }
    out[key] = entry;
  }
  return { area: raw.area as MetricLink['area'], query: out };
}

export function parseMetric(value: unknown): Metric | undefined {
  const raw = record(value);
  if (raw === undefined || typeof raw.status !== 'string' || !STATUSES.includes(raw.status)) {
    return undefined;
  }
  switch (raw.status) {
    case 'OK': {
      if (!safeInt(raw.value)) {
        return undefined;
      }
      const link = raw.link === undefined ? undefined : parseLink(raw.link);
      if (raw.link !== undefined && link === undefined) {
        return undefined;
      }
      let detail: Record<string, number> | undefined;
      if (raw.detail !== undefined) {
        const source = record(raw.detail);
        if (source === undefined) {
          return undefined;
        }
        detail = {};
        for (const [key, entry] of Object.entries(source)) {
          if (!safeInt(entry)) {
            return undefined;
          }
          detail[key] = entry;
        }
      }
      return { status: 'OK', value: raw.value, ...(link === undefined ? {} : { link }), ...(detail === undefined ? {} : { detail }) };
    }
    case 'NOT_READY':
      return typeof raw.reason === 'string' ? { status: 'NOT_READY', reason: raw.reason } : undefined;
    case 'FORBIDDEN':
      return { status: 'FORBIDDEN' };
    default:
      return { status: 'ERROR' };
  }
}

function parseGroup(value: unknown): MetricGroup | undefined {
  const raw = record(value);
  const metrics = record(raw?.metrics);
  if (raw === undefined || metrics === undefined || (raw.scope !== 'PERIOD' && raw.scope !== 'CURRENT')) {
    return undefined;
  }
  const out: Record<string, Metric> = {};
  for (const [key, entry] of Object.entries(metrics)) {
    const metric = parseMetric(entry);
    if (metric === undefined) {
      return undefined;
    }
    out[key] = metric;
  }
  return { scope: raw.scope, metrics: out };
}

function parseSuccessRate(value: unknown): SuccessRate | undefined {
  const raw = record(value);
  if (raw === undefined) {
    return undefined;
  }
  if (safeInt(raw.numerator) && safeInt(raw.denominator) && raw.numerator <= raw.denominator) {
    return { numerator: raw.numerator, denominator: raw.denominator };
  }
  return typeof raw.status === 'string' && raw.status !== 'OK' && STATUSES.includes(raw.status) ? { status: raw.status as Exclude<Metric['status'], 'OK'> } : undefined;
}

export function parseOverview(data: Record<string, unknown>): Overview | undefined {
  const generatedAt = iso(data.generated_at);
  const period = record(data.period);
  const groups = record(data.groups);
  const periodRange = typeof period?.range === 'string' && (OVERVIEW_RANGES as readonly string[]).includes(period.range) ? (period.range as OverviewRange) : undefined;
  const from = iso(period?.from);
  const to = iso(period?.to);
  const fromDay = str(period?.from_day);
  const toDay = str(period?.to_day);
  if (generatedAt === undefined || period === undefined || groups === undefined || periodRange === undefined || from === undefined || to === undefined || fromDay === undefined || toDay === undefined || !Array.isArray(data.todo)) {
    return undefined;
  }
  const parsedGroups: Record<string, MetricGroup> = {};
  for (const [key, entry] of Object.entries(groups)) {
    const group = parseGroup(entry);
    if (group === undefined) {
      return undefined;
    }
    parsedGroups[key] = group;
  }
  const rate = parseSuccessRate(record(groups.deliveries_period)?.success_rate);
  if (rate === undefined) {
    return undefined;
  }
  const todo: TodoItem[] = [];
  for (const entry of data.todo) {
    const raw = record(entry);
    const key = str(raw?.key);
    const metric = parseMetric(raw);
    if (key === undefined || metric === undefined) {
      return undefined;
    }
    todo.push({ key, metric });
  }
  return { generatedAt, period: { range: periodRange, from, to, fromDay, toDay }, groups: parsedGroups, successRate: rate, todo };
}

const KINDS: readonly string[] = QUEUE_KINDS;
const scalar = (value: unknown): value is string | number | null => value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));

function parseQueueLink(value: unknown): QueueLink | undefined {
  const raw = record(value);
  const query = record(raw?.query);
  if (raw === undefined || query === undefined || typeof raw.area !== 'string' || !(QUEUE_LINK_AREAS as readonly string[]).includes(raw.area)) {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(query)) {
    if (typeof entry !== 'string') {
      return undefined;
    }
    out[key] = entry;
  }
  return { area: raw.area as QueueLinkArea, query: out };
}

function parseQueueItem(value: unknown): QueueItem | undefined {
  const raw = record(value);
  const detail = record(raw?.detail);
  const link = parseQueueLink(raw?.link);
  if (raw === undefined || detail === undefined || link === undefined) {
    return undefined;
  }
  const waitingSince = iso(raw.waiting_since);
  const ok =
    typeof raw.key === 'string' && typeof raw.kind === 'string' && KINDS.includes(raw.kind) && typeof raw.code === 'string' && typeof raw.status === 'string' && typeof raw.reason === 'string' &&
    waitingSince !== undefined && safeInt(raw.age_seconds) && raw.age_seconds >= 0 && (raw.overdue === null || typeof raw.overdue === 'boolean') && (raw.waiting_on === null || typeof raw.waiting_on === 'string') && (raw.action === 'HANDLE' || raw.action === 'VIEW');
  if (!ok || waitingSince === undefined) {
    return undefined;
  }
  const details: Record<string, string | number | null> = {};
  for (const [key, entry] of Object.entries(detail)) {
    if (!scalar(entry)) {
      return undefined;
    }
    details[key] = entry;
  }
  return {
    key: raw.key as string,
    kind: raw.kind as QueueKind,
    code: raw.code as string,
    status: raw.status as string,
    reason: raw.reason as string,
    waitingSince,
    ageSeconds: raw.age_seconds as number,
    overdue: raw.overdue as boolean | null,
    waitingOn: raw.waiting_on as string | null,
    action: raw.action as 'HANDLE' | 'VIEW',
    link,
    detail: details,
  };
}

function parseQueueSource(value: unknown): QueueSource | undefined {
  const raw = record(value);
  if (raw === undefined || typeof raw.kind !== 'string' || !KINDS.includes(raw.kind)) {
    return undefined;
  }
  const kind = raw.kind as QueueKind;
  if (raw.status === 'FORBIDDEN' || raw.status === 'ERROR') {
    return { kind, status: raw.status };
  }
  return raw.status === 'OK' && safeInt(raw.count) && raw.count >= 0 && typeof raw.truncated === 'boolean' ? { kind, status: 'OK', count: raw.count, truncated: raw.truncated } : undefined;
}

/** A queue answer is all-or-nothing: one malformed source or row makes the whole answer unknown (the page says so), never a half list. Every kind appears exactly once. */
export function parseActionQueue(data: Record<string, unknown>): ActionQueue | undefined {
  const generatedAt = iso(data.generated_at);
  if (generatedAt === undefined || !Array.isArray(data.sources) || !Array.isArray(data.items) || !safeInt(data.total) || data.total !== data.items.length) {
    return undefined;
  }
  const sources: QueueSource[] = [];
  for (const entry of data.sources) {
    const source = parseQueueSource(entry);
    if (source === undefined || sources.some((known) => known.kind === source.kind)) {
      return undefined;
    }
    sources.push(source);
  }
  if (sources.length !== QUEUE_KINDS.length) {
    return undefined;
  }
  const items: QueueItem[] = [];
  const seen = new Set<string>();
  for (const entry of data.items) {
    const item = parseQueueItem(entry);
    if (item === undefined || seen.has(item.key)) {
      return undefined;
    }
    seen.add(item.key);
    items.push(item);
  }
  return { generatedAt, sources, total: items.length, items };
}

export class AdminOverviewApi extends ApiClient {
  actionQueue(query: QueueQuery): Promise<ApiResult<ActionQueue>> {
    const params = new URLSearchParams();
    for (const [key, value] of [['kind', query.kind], ['status', query.status], ['from', query.from], ['to', query.to], ['sort', query.sort]] as const) {
      if (value !== undefined && value !== '') {
        params.set(key, value);
      }
    }
    const suffix = params.toString();
    return this.call({ method: 'GET', path: `/admin/overview/action-queue${suffix === '' ? '' : `?${suffix}`}` }, parseActionQueue);
  }

  read(query: OverviewQuery): Promise<ApiResult<Overview>> {
    const params = new URLSearchParams({ range: query.range });
    if (query.range === 'custom') {
      params.set('from', query.from ?? '');
      params.set('to', query.to ?? '');
    }
    return this.call({ method: 'GET', path: `/admin/overview?${params.toString()}` }, parseOverview);
  }
}

/** The real OverviewSource. It keeps nothing: no figures, no period. */
export function createOverviewSource(api: AdminOverviewApi): OverviewSource {
  return {
    async read(query): Promise<OverviewRead> {
      const result = await api.read(query);
      return result.kind === 'ok' ? { kind: 'ready', overview: result.data } : failureOf(result);
    },
    async actionQueue(query): Promise<ActionQueueRead> {
      const result = await api.actionQueue(query);
      return result.kind === 'ok' ? { kind: 'ready', queue: result.data } : failureOf(result);
    },
  };
}
