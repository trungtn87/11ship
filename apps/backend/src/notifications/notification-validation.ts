import { BadRequestException } from '@nestjs/common';
import { isCanonicalUuid } from '../shared/identifiers';
import { INBOX_PAGE_DEFAULT, INBOX_PAGE_MAX, SYNC_WAIT_MAX_SECONDS } from './notification-constants';
import { shaped } from '../delivery/delivery-validation';
import { SettingsRow } from './notification-repository';

// Strict parsers of the M08 requests (no key may be added; failures are a plain 400 that echoes nothing). Pure: no I/O.

function reject(): never {
  throw new BadRequestException();
}

function exactQuery(query: unknown, allowed: readonly string[]): Record<string, string> {
  if (typeof query !== 'object' || query === null || Array.isArray(query)) {
    return reject();
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (!allowed.includes(key) || typeof value !== 'string') {
      return reject();
    }
    out[key] = value;
  }
  return out;
}

const digits = (value: string, max: number): number => (/^\d{1,15}$/.test(value) && Number(value) <= max ? Number(value) : reject());

export interface InboxQuery {
  readonly filter: 'all' | 'unread';
  readonly beforeSeq: number | null;
  readonly limit: number;
}

export function parseInboxQuery(query: unknown): InboxQuery {
  const q = exactQuery(query, ['filter', 'before', 'limit']);
  const filter = q.filter ?? 'all';
  if (filter !== 'all' && filter !== 'unread') {
    return reject();
  }
  const limit = q.limit === undefined ? INBOX_PAGE_DEFAULT : digits(q.limit, INBOX_PAGE_MAX);
  if (limit < 1) {
    return reject();
  }
  return { filter, beforeSeq: q.before === undefined ? null : digits(q.before, Number.MAX_SAFE_INTEGER), limit };
}

export interface ChangesQuery {
  readonly afterSeq: number;
  readonly waitSeconds: number;
}

export function parseChangesQuery(query: unknown): ChangesQuery {
  const q = exactQuery(query, ['after', 'wait']);
  return { afterSeq: q.after === undefined ? 0 : digits(q.after, Number.MAX_SAFE_INTEGER), waitSeconds: q.wait === undefined ? 0 : digits(q.wait, SYNC_WAIT_MAX_SECONDS) };
}

export function parseNotificationId(value: unknown): string {
  return isCanonicalUuid(value) ? value : reject();
}

export function parseReadBody(body: unknown): readonly string[] {
  const o = shaped(body, ['ids']);
  const ids = o.ids;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100) {
    return reject();
  }
  return [...new Set(ids.map((id) => parseNotificationId(id)))];
}

export function parseEmptyBody(body: unknown): void {
  if (body !== undefined && body !== null && !(typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 0)) {
    reject();
  }
}

export type TokenBody = { readonly kind: 'REGISTER'; readonly token: string } | { readonly kind: 'DENIED' };

export function parseTokenBody(body: unknown): TokenBody {
  const o = shaped(body, ['provider'], ['token', 'permission']);
  if (o.provider !== 'FCM') {
    return reject();
  }
  if (o.permission !== undefined) {
    return o.permission === 'DENIED' && o.token === undefined ? { kind: 'DENIED' } : reject();
  }
  const token = o.token;
  // FCM registration tokens are url-safe text of a few hundred characters: refuse anything else rather than store it.
  return typeof token === 'string' && /^[A-Za-z0-9_:.\-]{20,4000}$/.test(token) ? { kind: 'REGISTER', token } : reject();
}

export function parseSettingsBody(body: unknown, current: SettingsRow): SettingsRow {
  const o = shaped(body, [], ['orders', 'reminders', 'wallet_profile', 'available', 'sound', 'vibrate']);
  const pick = (key: string, fallback: boolean): boolean => {
    const value = o[key];
    return value === undefined ? fallback : typeof value === 'boolean' ? value : reject();
  };
  return {
    orders: pick('orders', current.orders),
    reminders: pick('reminders', current.reminders),
    walletProfile: pick('wallet_profile', current.walletProfile),
    available: pick('available', current.available),
    sound: pick('sound', current.sound),
    vibrate: pick('vibrate', current.vibrate),
  };
}
