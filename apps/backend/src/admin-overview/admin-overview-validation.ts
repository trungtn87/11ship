import { AppError } from '../common/app-errors';
import { OVERVIEW_RANGES, OverviewRange } from '../admin-m12/vietnam-time';

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
