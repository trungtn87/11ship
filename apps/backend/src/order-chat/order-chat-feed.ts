import { CHAT_PAGE_DEFAULT, CHAT_PAGE_MAX } from './order-chat-constants';
import { compareCursor, FeedCursor, formatCursor } from './order-chat-text';

// The room's feed is two sources with one total order: the milestones of the order (read from its event log, a few dozen at most) and the messages people
// wrote (stored). A page is cut from the merge, so a milestone appears exactly once in the feed whoever reads it, and a message never moves.

export interface FeedMilestone {
  readonly key: string;
  readonly atMs: number;
  readonly text: string;
}

export interface FeedMessage {
  readonly messageId: string;
  readonly seq: number;
  readonly atMs: number;
  readonly senderUserId: string;
  readonly senderRole: 'CUSTOMER' | 'SHOP' | 'SHIPPER';
  readonly senderName: string;
  readonly body: string;
}

export type FeedItem =
  | { readonly kind: 'SYSTEM'; readonly cursor: FeedCursor; readonly milestone: FeedMilestone }
  | { readonly kind: 'USER'; readonly cursor: FeedCursor; readonly message: FeedMessage };

export interface FeedQuery {
  readonly limit: number;
  readonly before: FeedCursor | undefined;
  readonly after: FeedCursor | undefined;
}

export function clampLimit(value: number | undefined): number {
  return value === undefined ? CHAT_PAGE_DEFAULT : Math.min(CHAT_PAGE_MAX, Math.max(1, value));
}

/** The milestones as feed items: ordered by time, and by their order in the log within a millisecond. `milestones` must be oldest first. */
export function milestoneItems(milestones: readonly FeedMilestone[]): FeedItem[] {
  return milestones.map((milestone, index) => ({ kind: 'SYSTEM' as const, cursor: { atMs: milestone.atMs, rank: 0 as const, seq: index }, milestone }));
}

export function messageItem(message: FeedMessage): FeedItem {
  return { kind: 'USER', cursor: { atMs: message.atMs, rank: 1, seq: message.seq }, message };
}

export interface FeedPage {
  /** Oldest first. */
  readonly items: readonly FeedItem[];
  /** There is something older than the first item. */
  readonly hasOlder: boolean;
  /** There is something newer than the last item (only meaningful for `after` reads). */
  readonly hasNewer: boolean;
}

/**
 * Cuts a page out of the merge. `userAfterOrBefore` are the message rows the repository returned for the same window (at least limit + 1 when that many
 * exist): newest-first for the latest/older read, oldest-first for the newer read.
 */
export function cutPage(query: FeedQuery, milestones: readonly FeedItem[], messageItems: readonly FeedItem[]): FeedPage {
  const { limit, before, after } = query;
  if (after !== undefined) {
    const merged = [...milestones.filter((i) => compareCursor(i.cursor, after) > 0), ...messageItems.filter((i) => compareCursor(i.cursor, after) > 0)].sort((a, b) => compareCursor(a.cursor, b.cursor));
    return { items: merged.slice(0, limit), hasOlder: false, hasNewer: merged.length > limit };
  }
  const older = [...milestones.filter((i) => before === undefined || compareCursor(i.cursor, before) < 0), ...messageItems.filter((i) => before === undefined || compareCursor(i.cursor, before) < 0)].sort((a, b) => compareCursor(b.cursor, a.cursor));
  return { items: older.slice(0, limit).reverse(), hasOlder: older.length > limit, hasNewer: false };
}

export function cursorOf(item: FeedItem | undefined): string | null {
  return item === undefined ? null : formatCursor(item.cursor);
}
