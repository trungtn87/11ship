import { StoryEntry } from '../orders/order-story';
import { ChatMessageRow } from './order-chat-repository';
import { FeedCursor } from './order-chat-validation';

// The feed of a room: the typed messages and the business milestones in ONE time line. Pure (no I/O, no clock). Order: time, then milestones before messages
// of the same millisecond (a "đã nhận đơn" line precedes the first message written after it), then the id, so the order is total and the same on every read.

export type FeedEntry =
  | { readonly kind: 'system'; readonly id: string; readonly atMs: number; readonly text: string }
  | { readonly kind: 'message'; readonly id: string; readonly atMs: number; readonly message: ChatMessageRow };

const rankOf = (e: FeedEntry): 0 | 1 => (e.kind === 'system' ? 0 : 1);

function compare(a: FeedCursor, b: FeedCursor): number {
  return a.atMs - b.atMs || a.rank - b.rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export const cursorOf = (e: FeedEntry): FeedCursor => ({ atMs: e.atMs, rank: rankOf(e), id: e.id });

/** The milestones of a room as feed entries. Without a source id (never expected from the order readers) an entry gets a position-based one. */
export function systemEntries(story: readonly StoryEntry[]): FeedEntry[] {
  return story.map((s, index) => ({ kind: 'system', id: s.sourceId ?? `s:${String(index)}`, atMs: Date.parse(s.at), text: s.text }));
}

export interface FeedPage {
  /** Oldest first, ready to show. */
  readonly entries: readonly FeedEntry[];
  readonly hasMore: boolean;
}

/**
 * One page of the feed older than `before` (or the newest page). `messages` are the room's messages already older than the cursor (newest first, at least
 * `limit + 1` of them when that many exist); `milestones` are all of the room's milestones. A milestone with the same source id twice is shown once.
 */
export function pageOf(messages: readonly ChatMessageRow[], milestones: readonly FeedEntry[], before: FeedCursor | null, limit: number): FeedPage {
  const seen = new Set<string>();
  const system = milestones.filter((e) => {
    if (seen.has(e.id) || (before !== null && compare(cursorOf(e), before) >= 0)) {
      return false;
    }
    seen.add(e.id);
    return true;
  });
  const typed: FeedEntry[] = messages.map((message) => ({ kind: 'message', id: message.messageId, atMs: message.atMs, message }));
  const newestFirst = [...system, ...typed].sort((a, b) => compare(cursorOf(b), cursorOf(a)));
  const hasMore = newestFirst.length > limit;
  return { entries: newestFirst.slice(0, limit).reverse(), hasMore };
}
