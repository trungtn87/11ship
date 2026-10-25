import { CHAT_MAX_CHARS } from './order-chat-constants';

// What a person may send: plain text. Normalized to NFC, line breaks kept (at most two in a row), every other control or format character removed, trimmed.
// Nothing is HTML-escaped here: the text is stored as written and every screen shows it as TEXT (the apps never interpret it as markup); removing the
// invisible characters is what keeps a message from hiding its own content or spoofing a system line.

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F​-‏‪-‮⁠-⁤⁦-⁩﻿]/gu;

/** Returns the clean text, or null when it is empty or too long. `value` must already be a string. */
export function cleanChatText(value: string): string | null {
  const text = value
    .normalize('NFC')
    .replace(/\r\n?/gu, '\n')
    .replace(CONTROL, '')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
  if (text === '' || [...text].length > CHAT_MAX_CHARS) {
    return null;
  }
  return text;
}

/** A position in the merged feed: when (ms), which source (0 = a milestone from the order/delivery log, 1 = a message) and its order inside the source. */
export interface FeedCursor {
  readonly atMs: number;
  readonly rank: 0 | 1;
  readonly seq: number;
}

const CURSOR = /^(\d{1,15})\.([01])\.(\d{1,15})$/u;

export function formatCursor(c: FeedCursor): string {
  return `${String(c.atMs)}.${String(c.rank)}.${String(c.seq)}`;
}

export function parseCursor(value: unknown): FeedCursor | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const m = CURSOR.exec(value);
  if (m === null) {
    return undefined;
  }
  return { atMs: Number(m[1]), rank: m[2] === '1' ? 1 : 0, seq: Number(m[3]) };
}

/** Total order of the feed: time, then milestones before messages of the same millisecond, then the position inside the source. */
export function compareCursor(a: FeedCursor, b: FeedCursor): number {
  return a.atMs - b.atMs || a.rank - b.rank || a.seq - b.seq;
}
