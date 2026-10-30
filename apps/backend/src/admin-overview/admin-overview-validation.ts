import { AppError } from '../common/app-errors';
import { DAY_MS, OVERVIEW_RANGES, OverviewRange, parseVietnamDay } from '../admin-m12/vietnam-time';

export interface OverviewQuery {
  readonly range: OverviewRange;
  readonly custom?: { readonly from: string; readonly to: string };
}

const invalid = (): never => {
  throw new AppError('ADMIN_INPUT_INVALID');
};

function plainObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid();
  }
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null ? (value as Record<string, unknown>) : invalid();
}

/** GET /v1/admin/overview?range=today|yesterday|7d|month|custom[&from=YYYY-MM-DD&to=YYYY-MM-DD]. Anything else is refused; no default period is guessed for `custom`. */
export function parseOverviewQuery(query: unknown): OverviewQuery {
  const source = plainObject(query);
  for (const key of Object.keys(source)) {
    if (key !== 'range' && key !== 'from' && key !== 'to') {
      invalid();
    }
  }
  const range = source.range === undefined ? 'today' : source.range;
  if (typeof range !== 'string' || !(OVERVIEW_RANGES as readonly string[]).includes(range)) {
    return invalid();
  }
  if (range !== 'custom') {
    if (source.from !== undefined || source.to !== undefined) {
      invalid();
    }
    return { range: range as OverviewRange };
  }
  if (typeof source.from !== 'string' || typeof source.to !== 'string') {
    return invalid();
  }
  return { range: 'custom', custom: { from: source.from, to: source.to } };
}

export const QUEUE_KINDS = [
  'DELIVERY_STOPPED',
  'ORDER_AWAITING_CONFIRMATION',
  'GOODS_OPEN',
  'SHIPPER_REVIEW',
  'COMPLAINT',
  'ADJUSTMENT_PENDING_FINANCE',
  'TOPUP_PENDING',
  'WITHDRAWAL_OPEN',
  'SHOP_PAYMENT_PENDING',
  'SHOP_PAYMENT_AWAITING_GRANT',
] as const;
export type QueueKind = (typeof QUEUE_KINDS)[number];

export interface ActionQueueQuery {
  readonly kind: QueueKind | null;
  readonly status: string | null;
  /** Vietnam-day bounds `[fromMs, toMs)` on the moment the file began waiting. */
  readonly fromMs: number | null;
  readonly toMs: number | null;
  readonly sort: 'oldest' | 'newest';
}

/** GET /v1/admin/overview/action-queue?kind=&status=&from=YYYY-MM-DD&to=YYYY-MM-DD&sort=oldest|newest. Anything else is refused. */
export function parseActionQueueQuery(query: unknown): ActionQueueQuery {
  const source = plainObject(query);
  for (const key of Object.keys(source)) {
    if (!['kind', 'status', 'from', 'to', 'sort'].includes(key)) {
      invalid();
    }
  }
  const text = (key: string): string | null => {
    const value = source[key];
    if (value === undefined || value === '') {
      return null;
    }
    return typeof value === 'string' ? value : invalid();
  };
  const kind = text('kind');
  if (kind !== null && !(QUEUE_KINDS as readonly string[]).includes(kind)) {
    invalid();
  }
  const status = text('status');
  if (status !== null && !/^[A-Z_]{1,32}$/.test(status)) {
    invalid();
  }
  const day = (key: string): number | null => {
    const value = text(key);
    if (value === null) {
      return null;
    }
    return parseVietnamDay(value) ?? invalid();
  };
  const from = day('from');
  const lastDay = day('to');
  if (from !== null && lastDay !== null && from > lastDay) {
    invalid();
  }
  const sort = text('sort') ?? 'oldest';
  if (sort !== 'oldest' && sort !== 'newest') {
    invalid();
  }
  return { kind: kind as QueueKind | null, status, fromMs: from, toMs: lastDay === null ? null : lastDay + DAY_MS, sort: sort as 'oldest' | 'newest' };
}
