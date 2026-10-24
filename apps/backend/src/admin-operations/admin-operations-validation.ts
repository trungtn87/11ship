import { AppError } from '../common/app-errors';
import { parseVietnamDay } from '../admin-m12/vietnam-time';
import { isCanonicalUuid } from '../shared/identifiers';

// Strict parsers of the audit, backup and restore-request routes (M12-F). Every filter is closed and bounded; nothing is accepted that the screen does not send.

const invalid = (): never => {
  throw new AppError('ADMIN_INPUT_INVALID');
};

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

export const MAX_AUDIT_DAYS = 92;
export const AUDIT_DEFAULT_LIMIT = 50;
export const AUDIT_MAX_LIMIT = 100;

export interface AuditFilter {
  /** Inclusive first and exclusive last instant (epoch ms), from the Vietnam days typed by the caller; undefined = the default window. */
  readonly fromDay?: string;
  readonly toDay?: string;
  readonly action?: string;
  readonly actorId?: string;
  readonly resourceType?: string;
  readonly resourceId?: string;
  readonly outcome?: 'SUCCESS' | 'DENIED' | 'FAILURE';
  readonly requestId?: string;
  readonly limit: number;
  readonly cursor?: { readonly occurredAt: string; readonly auditId: string };
}

const text = (value: unknown, pattern: RegExp): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  return typeof value === 'string' && pattern.test(value) ? value : invalid();
};

/** GET /audit?from=&to=&action=&actor_id=&resource_type=&resource_id=&outcome=&request_id=&limit=&cursor= */
export function parseAuditQuery(query: unknown): AuditFilter {
  const q = plain(query, ['from', 'to', 'action', 'actor_id', 'resource_type', 'resource_id', 'outcome', 'request_id', 'limit', 'cursor']);
  const from = text(q.from, /^\d{4}-\d{2}-\d{2}$/);
  const to = text(q.to, /^\d{4}-\d{2}-\d{2}$/);
  if ((from === undefined) !== (to === undefined)) {
    return invalid();
  }
  if (from !== undefined && to !== undefined) {
    const start = parseVietnamDay(from);
    const end = parseVietnamDay(to);
    if (start === undefined || end === undefined || start > end || (end - start) / 86_400_000 + 1 > MAX_AUDIT_DAYS) {
      return invalid();
    }
  }
  let limit = AUDIT_DEFAULT_LIMIT;
  if (q.limit !== undefined) {
    const parsed = typeof q.limit === 'string' && /^\d{1,3}$/.test(q.limit) ? Number(q.limit) : NaN;
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > AUDIT_MAX_LIMIT) {
      return invalid();
    }
    limit = parsed;
  }
  const outcome = q.outcome;
  if (outcome !== undefined && outcome !== 'SUCCESS' && outcome !== 'DENIED' && outcome !== 'FAILURE') {
    return invalid();
  }
  const requestId = q.request_id === undefined ? undefined : isCanonicalUuid(q.request_id) ? q.request_id : invalid();
  let cursor: AuditFilter['cursor'];
  if (q.cursor !== undefined) {
    const match = typeof q.cursor === 'string' ? /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)_([0-9a-f-]{36})$/.exec(q.cursor) : null;
    if (match === null || !isCanonicalUuid(match[2])) {
      return invalid();
    }
    cursor = { occurredAt: match[1] as string, auditId: match[2] };
  }
  return {
    ...(from === undefined ? {} : { fromDay: from }),
    ...(to === undefined ? {} : { toDay: to }),
    ...(q.action === undefined ? {} : { action: text(q.action, /^[a-z][a-z0-9_.]{0,127}$/) as string }),
    ...(q.actor_id === undefined ? {} : { actorId: text(q.actor_id, /^[A-Za-z0-9._:-]{1,128}$/) as string }),
    ...(q.resource_type === undefined ? {} : { resourceType: text(q.resource_type, /^[a-z][a-z0-9_]{0,63}$/) as string }),
    ...(q.resource_id === undefined ? {} : { resourceId: text(q.resource_id, /^[A-Za-z0-9._:-]{1,128}$/) as string }),
    ...(outcome === undefined ? {} : { outcome }),
    ...(requestId === undefined ? {} : { requestId }),
    limit,
    ...(cursor === undefined ? {} : { cursor }),
  };
}

export const parseOperationsId = (value: unknown): string => (isCanonicalUuid(value) ? value : invalid());

export function parseNoOperationsQuery(query: unknown): void {
  if (typeof query !== 'object' || query === null || Array.isArray(query) || Object.keys(query).length > 0) {
    invalid();
  }
}

export const RESTORE_REASON_MIN = 10;
export const RESTORE_REASON_MAX = 500;

export interface RestoreRequestBody {
  readonly backupId: string;
  readonly reason: string;
}

/** POST /restore-requests {backup_id, reason} */
export function parseRestoreBody(body: unknown): RestoreRequestBody {
  const b = plain(body, ['backup_id', 'reason']);
  const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
  if (!isCanonicalUuid(b.backup_id) || reason.length < RESTORE_REASON_MIN || reason.length > RESTORE_REASON_MAX || /[\u0000-\u001f\u007f]/.test(reason)) {
    return invalid();
  }
  return { backupId: b.backup_id, reason };
}

/** POST /restore-requests/:id/cancel {expected_version} */
export function parseCancelBody(body: unknown): { expectedVersion: number } {
  const b = plain(body, ['expected_version']);
  return typeof b.expected_version === 'number' && Number.isSafeInteger(b.expected_version) && b.expected_version >= 1 ? { expectedVersion: b.expected_version } : invalid();
}
