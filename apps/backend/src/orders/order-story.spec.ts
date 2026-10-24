import { describe, expect, it } from '@jest/globals';
import { humanDeliveryReason } from '../delivery/delivery-reason-text';
import { buildDeliveryStory, buildOrderStory, StoryDelivery, StoryDeliveryEvent, StoryOrderEvent } from './order-story';

const T0 = Date.parse('2026-10-20T11:00:00Z');
const at = (min: number): number => T0 + min * 60_000;
const oe = (min: number, type: string, note: string | null = null, details: Record<string, unknown> | null = null, actorType = 'SHOP'): StoryOrderEvent => ({ atMs: at(min), type: `order.${type}`, actorType, note, details });
const de = (min: number, type: string, note: string | null = null, actorType = 'SYSTEM'): StoryDeliveryEvent => ({ atMs: at(min), type: `delivery.${type}`, actorType, note });
const call = (events: StoryDeliveryEvent[], over: Partial<StoryDelivery> = {}): StoryDelivery => ({ deliveryId: 'd1', source: 'ORDER', previousDeliveryId: null, events, failText: null, ...over });
const texts = (entries: { text: string }[]): string[] => entries.map((e) => e.text);
const TECHNICAL = /delivery\.|order\.|_reminder|pickup_|search_|[A-Z]+_[A-Z_]+|[0-9a-f]{8}-[0-9a-f]{4}/;

describe('order story: milestones only, in plain words', () => {
  it('the order of the screenshot: searching, accepted, then the request is cancelled for being late — the order itself is NOT called cancelled', () => {
    const story = buildOrderStory(
      [oe(0, 'placed', null, null, 'CUSTOMER'), oe(1, 'confirmed'), oe(2, 'shipper_called')],
      [call([de(2, 'created', null, 'SHOP'), de(3, 'accepted', null, 'SHIPPER'), de(10, 'pickup_reminder', 'Nhắc shipper lấy hàng'), de(15, 'pickup_reminder', 'Nhắc shipper lấy hàng'), de(20, 'pickup_timeout_warning', 'Shipper chưa lấy hàng'), de(62, 'cancelled_by_system', 'QUÁ HẠN SHIPPER LẤY HÀNG')])],
      'shop',
    );
    expect(texts(story)).toEqual(['Đã đặt đơn', 'Quán đã xác nhận', 'Đang tìm shipper', 'Shipper đã nhận đơn', 'Đã hủy yêu cầu giao — Shipper chưa lấy hàng quá thời gian quy định']);
    expect(story.map((e) => e.at)).toEqual([at(0), at(1), at(2), at(3), at(62)].map((ms) => new Date(ms).toISOString()));
    expect(texts(story).join('|')).not.toMatch(/Đã hủy đơn/);
  });

  it('says "Đã hủy đơn" only when the order itself ended, once, naming who cancelled and why — the call cancelled in the same moment is not repeated', () => {
    const shop = buildOrderStory(
      [oe(0, 'placed', null, null, 'CUSTOMER'), oe(1, 'confirmed'), oe(5, 'cancelled_by_shop', 'Hết nguyên liệu')],
      [call([de(2, 'created', null, 'SHOP'), de(5, 'cancelled_by_shop', 'Hủy đơn món: Hết nguyên liệu', 'SHOP')])],
      'shop',
    );
    expect(texts(shop)).toEqual(['Đã đặt đơn', 'Quán đã xác nhận', 'Đang tìm shipper', 'Quán đã hủy đơn — Hết nguyên liệu']);
    const timeout = buildOrderStory(
      [oe(0, 'placed'), oe(1, 'confirmed'), oe(40, 'delivery_timeout', 'QUÁ HẠN SHIPPER LẤY HÀNG', { assignment_id: 'a1' }, 'SYSTEM')],
      [call([de(2, 'created'), de(3, 'accepted'), de(40, 'cancelled_by_system', 'QUÁ HẠN SHIPPER LẤY HÀNG')])],
      'customer',
    );
    expect(texts(timeout).slice(-1)).toEqual(['Đã hủy đơn — shipper chưa lấy hàng quá thời gian quy định']);
    expect(texts(timeout).filter((t) => t.startsWith('Đã hủy'))).toHaveLength(1);
  });

  it('a second call, a shipper change and a failure are told with their milestones; reminders and repeated notices are not', () => {
    const story = buildOrderStory(
      [oe(0, 'placed'), oe(1, 'confirmed'), oe(2, 'shipper_called'), oe(60, 'shipper_called_again'), oe(50, 'confirmation_reminder'), oe(70, 'schedule_reminder')],
      [
        call([de(2, 'created'), de(3, 'accepted', null, 'SHIPPER'), de(5, 'released_by_shipper', 'Xe hỏng', 'SHIPPER'), de(7, 'search_reminder_5'), de(32, 'search_stopped', 'Hết thời gian tìm shipper')], { deliveryId: 'd1' }),
        call([de(60, 'recalled'), de(61, 'accepted', null, 'SHIPPER'), de(66, 'picked_up', null, 'SHIPPER'), de(80, 'failed', 'RECIPIENT_UNREACHABLE: gọi 3 lần không được', 'SHIPPER')], { deliveryId: 'd2', previousDeliveryId: 'd1', failText: 'Không liên lạc được người nhận: gọi 3 lần không được' }),
      ],
      'shop',
    );
    expect(texts(story)).toEqual([
      'Đã đặt đơn',
      'Quán đã xác nhận',
      'Đang tìm shipper',
      'Shipper đã nhận đơn',
      'Shipper đã hủy nhận đơn — Xe hỏng',
      'Chưa có shipper nhận, đã dừng tìm',
      'Quán gọi lại shipper, đang tìm shipper',
      'Shipper đã nhận đơn',
      'Shipper đã lấy hàng',
      'Giao không thành công — Không liên lạc được người nhận: gọi 3 lần không được',
    ]);
  });

  it('never shows an event key, an internal reason code, an id or a reminder, whatever the log holds; an unknown event says nothing', () => {
    const story = buildOrderStory(
      [oe(0, 'placed'), oe(1, 'something_new'), oe(2, 'cancelled_by_admin', 'ORDER_ABUSE_X')],
      [call([de(1, 'brand_new_event', 'delivery.created'), de(2, 'failed', 'GOODS_PROBLEM'), de(3, 'adjusted_by_admin', 'Admin điều chỉnh phí: x'), de(4, 'referred_to_m11'), de(5, 'fee_countered'), de(6, 'destination_confirmed')], { failText: null })],
      'shop',
    );
    for (const line of texts(story)) {
      expect(line).not.toMatch(TECHNICAL);
    }
    expect(texts(story)).toEqual(['Đã đặt đơn', 'Quản trị đã hủy đơn', 'Giao không thành công — Hàng có vấn đề']);
  });

  it('the customer does not read the shop\'s goods handling; the shop does, once, after the failure', () => {
    const events = [de(1, 'failed', 'OTHER'), de(5, 'goods_returned', null, 'SHOP')];
    expect(texts(buildOrderStory([], [call(events)], 'customer'))).toEqual(['Giao không thành công — Lý do khác']);
    expect(texts(buildOrderStory([], [call(events)], 'shop'))).toEqual(['Giao không thành công — Lý do khác', 'Quán xác nhận hàng đã về']);
  });

  it('a direct delivery has its own wording, keeps the order of time across days, and the result is told once', () => {
    const next = Date.parse('2026-10-21T01:00:00Z');
    const story = buildDeliveryStory(
      call([{ atMs: next, type: 'delivery.completed', actorType: 'SHIPPER', note: null }, de(0, 'created', null, 'SHOP'), de(1, 'accepted', null, 'SHIPPER'), de(2, 'picked_up', null, 'SHIPPER')], { source: 'DIRECT' }),
      'shop',
    );
    expect(texts(story)).toEqual(['Đã tạo yêu cầu giao, đang tìm shipper', 'Shipper đã nhận đơn', 'Shipper đã lấy hàng', 'Giao thành công']);
    expect(story[3]?.at).toBe(new Date(next).toISOString());
    expect(texts(story).filter((t) => t.startsWith('Giao thành công'))).toHaveLength(1);
  });

  it('a cancel after pickup (creator only) is told once by who did it; a direct call says so on its own', () => {
    const order = buildOrderStory(
      [oe(0, 'placed', null, null, 'CUSTOMER'), oe(1, 'confirmed'), oe(30, 'cancelled_by_customer_after_pickup', 'Khách đổi ý', null, 'CUSTOMER')],
      [call([de(2, 'created'), de(3, 'accepted'), de(10, 'picked_up'), { atMs: at(30), type: 'delivery.cancelled_after_pickup', actorType: 'CUSTOMER', note: 'Khách đổi ý' }])],
      'shop',
    );
    expect(texts(order)).toEqual(['Đã đặt đơn', 'Quán đã xác nhận', 'Đang tìm shipper', 'Shipper đã nhận đơn', 'Shipper đã lấy hàng', 'Khách đã hủy đơn — Khách đổi ý']);
    const direct = buildDeliveryStory(call([de(0, 'created'), de(5, 'picked_up'), { atMs: at(9), type: 'delivery.cancelled_after_pickup', actorType: 'SHOP', note: 'Khách không nhận' }], { source: 'DIRECT' }), 'shop');
    expect(texts(direct).slice(-1)).toEqual(['Quán đã hủy yêu cầu giao — Khách không nhận']);
  });

  it('a confirmation that carries the reason of an edit says so', () => {
    expect(texts(buildOrderStory([oe(1, 'confirmed', 'Hết bún, khách đồng ý bớt')], [], 'customer'))).toEqual(['Quán đã xác nhận đơn đã chỉnh — Hết bún, khách đồng ý bớt']);
  });

  it('the order\'s own completion is not repeated next to the delivery\'s', () => {
    const story = buildOrderStory([oe(0, 'placed'), oe(9, 'completed', 'Giao hàng thành công', null, 'SYSTEM')], [call([de(1, 'created'), de(9, 'completed', null, 'SHIPPER')])], 'customer');
    expect(texts(story).filter((t) => t === 'Giao thành công')).toHaveLength(1);
  });
});

describe('plain reasons', () => {
  it('translates codes and system phrases, keeps what a person typed, and hides unknown codes', () => {
    expect(humanDeliveryReason('RECIPIENT_REFUSED')).toBe('Người nhận từ chối nhận hàng');
    expect(humanDeliveryReason('ADDRESS_NOT_FOUND: ngõ cụt')).toBe('Không tìm thấy địa chỉ giao hàng: ngõ cụt');
    expect(humanDeliveryReason('QUÁ HẠN CHỜ SHIPPER NHẬN')).toBe('Chưa có shipper nhận trong thời gian quy định');
    expect(humanDeliveryReason('Hết thời gian tìm shipper sau khi shipper hủy nhận')).toBe('Hết thời gian tìm shipper');
    expect(humanDeliveryReason('Hủy đơn món: Hết hàng')).toBe('Hết hàng');
    expect(humanDeliveryReason('Khách đổi ý')).toBe('Khách đổi ý');
    expect(humanDeliveryReason('SOME_INTERNAL_CODE')).toBeNull();
    expect(humanDeliveryReason('  ')).toBeNull();
    expect(humanDeliveryReason(null)).toBeNull();
  });
});
