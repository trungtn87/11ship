import { BadRequestException } from '@nestjs/common';
import { text, shaped } from '../delivery/delivery-validation';
import { isCanonicalUuid } from '../shared/identifiers';
import { CHAT_MAX_BODY, CHAT_PAGE_DEFAULT, CHAT_PAGE_MAX } from './order-chat-constants';

// Strict parsers of the order chat requests. A body is exactly `{ body }`: no sender, role, room, time or state arrives from a client. Failures are a plain 400
// that echoes nothing. Pure: no I/O.

function reject(): never {
  throw new BadRequestException();
}

export interface SendInput {
  readonly body: string;
}

export function parseSendBody(value: unknown): SendInput {
  const input = shaped(value, ['body']);
  // `text` normalises (NFC, whitespace folded to single spaces, trimmed), refuses control characters and ill-formed UTF-16, and counts code points.
  return { body: text(input.body, 1, CHAT_MAX_BODY) };
}

export interface PageQuery {
  readonly limit: number;
  /** Position to read OLDER than (opaque to the client); null = the newest page. */
  readonly before: FeedCursor | null;
}

/** The place of an entry in the feed: its time, then milestones before messages, then the id. The feed is read newest first. */
export interface FeedCursor {
  readonly atMs: number;
  readonly rank: 0 | 1;
  readonly id: string;
}

export function encodeCursor(c: FeedCursor): string {
  return Buffer.from(`${String(c.atMs)}|${String(c.rank)}|${c.id}`, 'utf8').toString('base64url');
}

function decodeCursor(raw: string): FeedCursor {
  if (!/^[A-Za-z0-9_-]{1,200}$/u.test(raw)) {
    return reject();
  }
  const parts = Buffer.from(raw, 'base64url').toString('utf8').split('|');
  const [atRaw, rankRaw, ...rest] = parts;
  const id = rest.join('|');
  const atMs = Number(atRaw);
  if (!Number.isSafeInteger(atMs) || atMs < 0 || (rankRaw !== '0' && rankRaw !== '1') || id === '' || id.length > 120) {
    return reject();
  }
  return { atMs, rank: rankRaw === '0' ? 0 : 1, id };
}

export function parsePageQuery(query: unknown): PageQuery {
  if (query === undefined || query === null) {
    return { limit: CHAT_PAGE_DEFAULT, before: null };
  }
  const input = shaped(query, [], ['limit', 'before']);
  let limit = CHAT_PAGE_DEFAULT;
  if (input.limit !== undefined) {
    const n = typeof input.limit === 'string' && /^[0-9]{1,3}$/u.test(input.limit) ? Number(input.limit) : NaN;
    if (!Number.isInteger(n) || n < 1 || n > CHAT_PAGE_MAX) {
      return reject();
    }
    limit = n;
  }
  let before: FeedCursor | null = null;
  if (input.before !== undefined) {
    if (typeof input.before !== 'string') {
      return reject();
    }
    before = decodeCursor(input.before);
  }
  return { limit, before };
}

export function parseRoomId(value: unknown): string {
  return isCanonicalUuid(value) ? value : reject();
}

export interface HoldInput {
  readonly reason: string;
}

/** An evidence hold is placed or released with a reason (3..300 characters), nothing else. */
export function parseHoldBody(value: unknown): HoldInput {
  const input = shaped(value, ['reason']);
  return { reason: text(input.reason, 3, 300) };
}
