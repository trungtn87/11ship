import { describe, expect, it } from '@jest/globals';
import { buildOrderStory } from '../orders/order-story';
import { cursorOf, pageOf, systemEntries } from './order-chat-feed';
import { ChatMessageRow } from './order-chat-repository';
import { encodeCursor, parsePageQuery, parseSendBody } from './order-chat-validation';

const T0 = Date.parse('2026-10-25T08:00:00Z');
const at = (sec: number): number => T0 + sec * 1000;
const message = (id: string, sec: number, body = id): ChatMessageRow => ({ messageId: id, roomType: 'ORDER', roomId: 'r', senderUserId: 'u', senderRole: 'CUSTOMER', senderName: 'Khách', body, clientKey: id, atMs: at(sec) });
const story = buildOrderStory(
  [
    { eventId: 'e1', atMs: at(0), type: 'order.placed', actorType: 'CUSTOMER', note: null, details: null },
    { eventId: 'e2', atMs: at(10), type: 'order.confirmed', actorType: 'SHOP', note: null, details: null },
    { eventId: 'e3', atMs: at(20), type: 'order.confirmation_reminder', actorType: 'SYSTEM', note: null, details: null },
  ],
  [{ deliveryId: 'd1', source: 'ORDER', previousDeliveryId: null, failText: null, events: [{ seq: 1, atMs: at(11), type: 'delivery.created', actorType: 'SHOP', note: null }, { seq: 2, atMs: at(30), type: 'delivery.fee_countered', actorType: 'SHIPPER', note: null }, { seq: 3, atMs: at(40), type: 'delivery.fee_counter_accepted', actorType: 'SHOP', note: null }] }],
  'room',
);

describe('order chat feed', () => {
  it('the room story keeps the milestones (fee steps included, no amount) with a stable source id each, and drops reminders', () => {
    expect(story.map((s) => s.text)).toEqual(['Đã đặt đơn', 'Quán đã xác nhận', 'Đang tìm shipper', 'Shipper đề xuất phí giao khác, đang chờ quyết định', 'Phí giao đã được chấp nhận']);
    expect(story.map((s) => s.sourceId)).toEqual(['o:e1', 'o:e2', 'd:d1:1', 'd:d1:2', 'd:d1:3']);
    // The other readers' stories do not gain the fee lines.
    expect(buildOrderStory([], [{ deliveryId: 'd1', source: 'ORDER', previousDeliveryId: null, failText: null, events: [{ seq: 2, atMs: at(30), type: 'delivery.fee_countered', actorType: 'SHIPPER', note: null }] }], 'customer')).toEqual([]);
  });

  it('interleaves messages and milestones by time; a milestone comes before a message of the same millisecond', () => {
    const page = pageOf([message('m2', 12), message('m1', 10)], systemEntries(story), null, 50);
    expect(page.hasMore).toBe(false);
    expect(page.entries.map((e) => (e.kind === 'system' ? e.id : `m:${e.id}`))).toEqual(['o:e1', 'o:e2', 'm:m1', 'd:d1:1', 'm:m2', 'd:d1:2', 'd:d1:3']);
  });

  it('pages backwards with the cursor of the oldest entry: no entry repeats or is skipped, and the milestone of the same source shows once', () => {
    const milestones = [...systemEntries(story), ...systemEntries(story)];
    const messages = [message('m4', 35), message('m3', 15), message('m2', 12), message('m1', 10)];
    const seen: string[] = [];
    let before = null as ReturnType<typeof cursorOf> | null;
    for (let guard = 0; guard < 10; guard += 1) {
      const newer = messages.filter((m) => before === null || m.atMs < before.atMs || (m.atMs === before.atMs && before.rank === 1 && m.messageId < before.id));
      const page = pageOf(newer, milestones, before, 3);
      seen.unshift(...page.entries.map((e) => e.id));
      const oldest = page.entries[0];
      if (!page.hasMore || oldest === undefined) {
        break;
      }
      before = cursorOf(oldest);
    }
    expect(seen).toEqual(['o:e1', 'o:e2', 'm1', 'd:d1:1', 'm2', 'm3', 'd:d1:2', 'm4', 'd:d1:3']);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('keeps the closing milestone even when the page is full of messages', () => {
    const closing = buildOrderStory([{ eventId: 'e9', atMs: at(100), type: 'order.cancelled_by_shop', actorType: 'SHOP', note: 'Hết hàng', details: null }], [], 'room');
    const page = pageOf([message('m2', 90), message('m1', 80)], systemEntries(closing), null, 2);
    expect(page.entries.map((e) => e.id)).toEqual(['m2', 'o:e9']);
    expect(page.hasMore).toBe(true);
  });
});

describe('order chat requests', () => {
  it('a body is exactly { body }, normalised, 1..500 characters without control characters', () => {
    expect(parseSendBody({ body: '  xin   chào  ' })).toEqual({ body: 'xin chào' });
    for (const bad of [{}, { body: '' }, { body: '   ' }, { body: 'x', extra: 1 }, { body: 5 }, { body: 'a'.repeat(501) }, { body: 'a\u0000b' }, 'x', null]) {
      expect(() => parseSendBody(bad)).toThrow();
    }
    expect(parseSendBody({ body: 'a'.repeat(500) }).body).toHaveLength(500);
    expect(parseSendBody({ body: '<script>alert(1)</script>' }).body).toBe('<script>alert(1)</script>');
  });

  it('the page query takes a bounded limit and an opaque cursor, nothing else', () => {
    expect(parsePageQuery({})).toEqual({ limit: 30, before: null });
    const cursor = encodeCursor({ atMs: at(5), rank: 1, id: 'abc' });
    expect(parsePageQuery({ limit: '5', before: cursor })).toEqual({ limit: 5, before: { atMs: at(5), rank: 1, id: 'abc' } });
    for (const bad of [{ limit: '0' }, { limit: '101' }, { limit: 'x' }, { before: '!!' }, { before: Buffer.from('x|2|y').toString('base64url') }, { other: '1' }]) {
      expect(() => parsePageQuery(bad)).toThrow();
    }
  });
});
