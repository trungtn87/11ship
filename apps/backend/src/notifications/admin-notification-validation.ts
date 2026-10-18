import { BadRequestException } from '@nestjs/common';
import { shaped } from '../delivery/delivery-validation';
import { isCanonicalUuid } from '../shared/identifiers';
import { INBOX_PAGE_MAX, KINDS } from './notification-constants';
import { AdminNotificationQuery } from './notification-repository';

function reject(): never {
  throw new BadRequestException();
}

const SEND_STATUSES = ['PENDING', 'SENT', 'FAILED', 'EXPIRED', 'SKIPPED'] as const;

export interface AdminSearchQuery extends AdminNotificationQuery {
  readonly limit: number;
  readonly offset: number;
}

function instant(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }
  const ms = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?$/.test(value) ? Date.parse(value) : Number.NaN;
  return Number.isFinite(ms) ? ms : reject();
}

export function parseAdminSearchQuery(query: unknown): AdminSearchQuery {
  if (typeof query !== 'object' || query === null || Array.isArray(query)) {
    return reject();
  }
  const q: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (!['from', 'to', 'kind', 'q', 'send_status', 'app', 'limit', 'offset'].includes(key) || typeof value !== 'string') {
      return reject();
    }
    q[key] = value;
  }
  const kind = q.kind === undefined || q.kind === '' ? null : (KINDS as readonly string[]).includes(q.kind) ? q.kind : reject();
  const sendStatus = q.send_status === undefined || q.send_status === '' ? null : (SEND_STATUSES as readonly string[]).includes(q.send_status) ? q.send_status : reject();
  const app = q.app === undefined || q.app === '' ? null : q.app === 'FOOD' || q.app === 'SHIP' ? q.app : reject();
  const search = (q.q ?? '').trim();
  if (search.length > 64) {
    return reject();
  }
  const limit = q.limit === undefined ? 25 : /^\d{1,3}$/.test(q.limit) && Number(q.limit) >= 1 && Number(q.limit) <= INBOX_PAGE_MAX ? Number(q.limit) : reject();
  const offset = q.offset === undefined ? 0 : /^\d{1,7}$/.test(q.offset) ? Number(q.offset) : reject();
  const toMs = instant(q.to);
  return {
    fromMs: instant(q.from),
    // A bare date as the end bound means "through that day".
    toMs: toMs !== null && q.to !== undefined && !q.to.includes('T') ? toMs + 86_400_000 : toMs,
    kind,
    sendStatus,
    app,
    // An account id, or else (part of) a delivery code. A phone number is never searched here.
    userId: isCanonicalUuid(search) ? search : null,
    code: search === '' || isCanonicalUuid(search) ? null : search,
    limit,
    offset,
  };
}

export interface ConfigBody {
  readonly expectedVersion: number;
  readonly pushEnabled: boolean;
  readonly defaultSound: boolean;
  readonly visibleDays: number;
  readonly purgeDays: number;
  readonly retryMaxAttempts: number;
  readonly retryBaseSeconds: number;
}

export function parseConfigBody(body: unknown): ConfigBody {
  const o = shaped(body, ['expected_version', 'push_enabled', 'default_sound', 'visible_days', 'purge_days', 'retry_max_attempts', 'retry_base_seconds']);
  const whole = (value: unknown, min: number, max: number): number => (typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max ? value : reject());
  const bool = (value: unknown): boolean => (typeof value === 'boolean' ? value : reject());
  const visibleDays = whole(o.visible_days, 7, 365);
  return {
    expectedVersion: whole(o.expected_version, 0, Number.MAX_SAFE_INTEGER),
    pushEnabled: bool(o.push_enabled),
    defaultSound: bool(o.default_sound),
    visibleDays,
    purgeDays: whole(o.purge_days, visibleDays, 1095),
    retryMaxAttempts: whole(o.retry_max_attempts, 1, 10),
    retryBaseSeconds: whole(o.retry_base_seconds, 5, 3600),
  };
}

export function parseAdminNotificationId(value: unknown): string {
  return isCanonicalUuid(value) ? value : reject();
}

export function parseNoQuery(query: unknown): void {
  if (typeof query !== 'object' || query === null || Object.keys(query).length > 0) {
    reject();
  }
}
