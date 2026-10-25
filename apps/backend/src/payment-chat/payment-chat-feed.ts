import { FeedCursor } from '../order-chat/order-chat-validation';
import { PaymentMessageRow } from './payment-chat-repository';

// The feed of a payment room: the typed messages and the milestones of the request in ONE time line. Pure (no I/O, no clock). Same order as the order chat:
// time, then milestones before messages of the same millisecond, then the id.

export type PaymentFeedEntry =
  | { readonly kind: 'system'; readonly id: string; readonly atMs: number; readonly text: string }
  | { readonly kind: 'message'; readonly id: string; readonly atMs: number; readonly message: PaymentMessageRow };

const rankOf = (e: PaymentFeedEntry): 0 | 1 => (e.kind === 'system' ? 0 : 1);

function compare(a: FeedCursor, b: FeedCursor): number {
  return a.atMs - b.atMs || a.rank - b.rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export const cursorOf = (e: PaymentFeedEntry): FeedCursor => ({ atMs: e.atMs, rank: rankOf(e), id: e.id });

export interface PaymentFeedPage {
  readonly entries: readonly PaymentFeedEntry[];
  readonly hasMore: boolean;
}

export function pageOf(messages: readonly PaymentMessageRow[], milestones: readonly PaymentFeedEntry[], before: FeedCursor | null, limit: number): PaymentFeedPage {
  const system = milestones.filter((e) => before === null || compare(cursorOf(e), before) < 0);
  const typed: PaymentFeedEntry[] = messages.map((message) => ({ kind: 'message', id: message.messageId, atMs: message.atMs, message }));
  const newestFirst = [...system, ...typed].sort((a, b) => compare(cursorOf(b), cursorOf(a)));
  return { entries: newestFirst.slice(0, limit).reverse(), hasMore: newestFirst.length > limit };
}

/** The milestones of a request as feed entries, from the real facts. A fact that did not happen yields no entry; nothing is invented. */
export interface CaseFacts {
  readonly kind: 'DRIVER_TOPUP' | 'SHOP_PAYMENT';
  readonly id: string;
  readonly state: 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'CANCELLED';
  readonly createdAtMs: number;
  readonly reportedAtMs: number | null;
  readonly resolvedAtMs: number | null;
  /** SHOP_PAYMENT only: when the manual right that followed this payment was granted. */
  readonly grantedAtMs: number | null;
}

export function milestones(f: CaseFacts): PaymentFeedEntry[] {
  const out: PaymentFeedEntry[] = [{ kind: 'system', id: `c:${f.id}:created`, atMs: f.createdAtMs, text: f.kind === 'DRIVER_TOPUP' ? 'Yêu cầu nạp tiền được tạo' : 'Yêu cầu thanh toán được tạo' }];
  if (f.reportedAtMs !== null) {
    out.push({ kind: 'system', id: `c:${f.id}:reported`, atMs: f.reportedAtMs, text: 'Đã báo chuyển khoản' });
  }
  if (f.resolvedAtMs !== null && f.state !== 'PENDING') {
    const text = f.state === 'CONFIRMED' ? 'Quản trị viên đã xác nhận tiền' : f.state === 'REJECTED' ? 'Yêu cầu bị từ chối' : 'Yêu cầu đã hủy';
    out.push({ kind: 'system', id: `c:${f.id}:${f.state.toLowerCase()}`, atMs: f.resolvedAtMs, text });
  }
  if (f.grantedAtMs !== null) {
    out.push({ kind: 'system', id: `c:${f.id}:granted`, atMs: f.grantedAtMs, text: 'Tài khoản/quyền đã được mở' });
  }
  return out;
}
