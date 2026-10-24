import { AppError } from '../common/app-errors';
import { isCanonicalUuid } from '../shared/identifiers';
import { OVERVIEW_RANGES, OverviewRange } from '../admin-m12/vietnam-time';
import { ReportBasis } from '../delivery/delivery-report-reader';
import { REPORT_KINDS, ReportKind } from './report-builder';

// Strict parsers of the report routes (M12-E). The filter is closed: a range, the two days of a custom range, and the moment deliveries are counted at. Nothing else is accepted,
// and an export is created by POST only (never a GET that streams "everything").

const invalid = (): never => {
  throw new AppError('ADMIN_INPUT_INVALID');
};

export interface ReportFilter {
  readonly range: OverviewRange;
  readonly from?: string;
  readonly to?: string;
  readonly basis: ReportBasis;
}

export const parseReportKind = (value: unknown): ReportKind => (typeof value === 'string' && (REPORT_KINDS as readonly string[]).includes(value) ? (value as ReportKind) : invalid());
export const parseExportId = (value: unknown): string => (isCanonicalUuid(value) ? value : invalid());

function fromSource(source: Record<string, unknown>): ReportFilter {
  const range = source.range === undefined ? 'today' : source.range;
  if (typeof range !== 'string' || !(OVERVIEW_RANGES as readonly string[]).includes(range)) {
    return invalid();
  }
  const basis = source.basis === undefined ? 'created' : source.basis;
  if (basis !== 'created' && basis !== 'ended') {
    return invalid();
  }
  if (range !== 'custom') {
    return source.from !== undefined || source.to !== undefined ? invalid() : { range: range as OverviewRange, basis };
  }
  return typeof source.from === 'string' && typeof source.to === 'string' ? { range: 'custom', from: source.from, to: source.to, basis } : invalid();
}

function plain(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid();
  }
  const proto = Object.getPrototypeOf(value) as unknown;
  if ((proto !== Object.prototype && proto !== null) || Object.keys(value).some((key) => !allowed.includes(key))) {
    return invalid();
  }
  return value as Record<string, unknown>;
}

/** GET /reports/:kind?range=&from=&to=&basis= */
export const parseReportQuery = (query: unknown): ReportFilter => fromSource(plain(query, ['range', 'from', 'to', 'basis']));

export interface ExportBody {
  readonly kind: ReportKind;
  readonly format: 'csv' | 'xlsx';
  readonly filter: ReportFilter;
}

/** POST /reports/exports {kind, format, range, from?, to?, basis?} */
export function parseExportBody(body: unknown): ExportBody {
  const source = plain(body, ['kind', 'format', 'range', 'from', 'to', 'basis']);
  const format = source.format;
  if (format !== 'csv' && format !== 'xlsx') {
    return invalid();
  }
  return { kind: parseReportKind(source.kind), format, filter: fromSource(source) };
}

export function parseNoQuery(query: unknown): void {
  if (typeof query !== 'object' || query === null || Array.isArray(query) || Object.keys(query).length > 0) {
    invalid();
  }
}
