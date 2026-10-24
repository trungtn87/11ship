import { describe, expect, it } from '@jest/globals';
import { composeDeliveryChange, DeliveryChangePayload, Draft, reminderCopy } from './notification-composer';

const base: DeliveryChangePayload = { deliveryId: '11111111-1111-4111-8111-111111111111', code: 'DG-1024', shopId: '22222222-2222-4222-8222-222222222222', change: 'accepted', state: 'accepted', version: 3, assignmentId: null, driverId: '33333333-3333-4333-8333-333333333333' };
const notifies = (drafts: Draft[]) => drafts.flatMap((d) => (d.type === 'NOTIFY' ? [d.draft] : []));

describe('M08 composer', () => {
  it('maps each business change to the right audience and target, and nothing for internal steps', () => {
    expect(notifies(composeDeliveryChange(base))).toMatchObject([{ audience: 'SHOP', app: 'FOOD', kind: 'DELIVERY_ACCEPTED', targetType: 'DELIVERY', targetId: base.deliveryId }]);
    expect(notifies(composeDeliveryChange({ ...base, change: 'cancelled_by_shop', state: 'cancelled_by_merchant' }))).toMatchObject([{ audience: 'DRIVER', app: 'SHIP', kind: 'DELIVERY_CANCELLED' }]);
    expect(composeDeliveryChange({ ...base, change: 'cancelled_by_shop', driverId: null })).toEqual([]);
    expect(composeDeliveryChange({ ...base, change: 'destination_confirmed' })).toEqual([]);
    expect(composeDeliveryChange({ ...base, change: 'fee_agreed' })).toEqual([]);
  });

  it('the shop\'s notices of a delivery that belongs to an Order open the Order by its id; a direct delivery and the Shipper keep the delivery', () => {
    const orderId = '55555555-5555-4555-8555-555555555555';
    for (const change of ['accepted', 'picked_up', 'completed', 'failed', 'search_stopped', 'released_by_shipper', 'pickup_timeout_warning', 'fee_countered']) {
      const shop = notifies(composeDeliveryChange({ ...base, change, state: 'waiting_driver', orderId })).filter((d) => d.audience === 'SHOP');
      expect(shop.length).toBeGreaterThan(0);
      for (const d of shop) {
        expect(d).toMatchObject({ targetType: 'ORDER', targetId: orderId });
      }
    }
    expect(notifies(composeDeliveryChange({ ...base, change: 'accepted', orderId: null }))[0]).toMatchObject({ targetType: 'DELIVERY', targetId: base.deliveryId });
    const driver = notifies(composeDeliveryChange({ ...base, change: 'cancelled_by_system', state: 'cancelled_by_system', orderId }));
    expect(driver).toMatchObject([{ audience: 'DRIVER', targetType: 'DELIVERY', targetId: base.deliveryId }]);
  });

  it('a new search round opens on creation, recall and a give-back that returns to waiting_driver; never when the delivery is not searching', () => {
    expect(composeDeliveryChange({ ...base, change: 'created', state: 'waiting_driver', driverId: null })).toEqual([{ type: 'OFFER_ROUND', deliveryId: base.deliveryId, roundVersion: 3 }]);
    expect(composeDeliveryChange({ ...base, change: 'released_by_shipper', state: 'waiting_driver' }).filter((d) => d.type === 'OFFER_ROUND')).toHaveLength(1);
    expect(composeDeliveryChange({ ...base, change: 'released_by_shipper', state: 'search_stopped' }).filter((d) => d.type === 'OFFER_ROUND')).toHaveLength(0);
  });

  it('reminders are only queued (their timers are M07\'s): a search reminder for the shop, a pickup reminder for the holder', () => {
    expect(composeDeliveryChange({ ...base, change: 'search_reminder_5', state: 'waiting_driver', driverId: null })).toEqual([{ type: 'REMINDER', reminder: 'SEARCH_5', deliveryId: base.deliveryId, assignmentId: null }]);
    expect(composeDeliveryChange({ ...base, change: 'pickup_reminder', assignmentId: '44444444-4444-4444-8444-444444444444' })).toEqual([{ type: 'REMINDER', reminder: 'PICKUP', deliveryId: base.deliveryId, assignmentId: '44444444-4444-4444-8444-444444444444' }]);
  });

  it('lock-screen wording never carries a phone, an address, an OTP or bank data', () => {
    const all: string[] = [];
    for (const change of ['accepted', 'released_by_shipper', 'released_by_admin', 'picked_up', 'completed', 'failed', 'cancelled_by_shop', 'search_stopped', 'fee_countered', 'fee_counter_accepted', 'goods_returned']) {
      for (const d of notifies(composeDeliveryChange({ ...base, change, state: 'waiting_driver' }))) {
        all.push(d.title, d.body);
      }
    }
    for (const copy of [reminderCopy('PICKUP', 1, ['DG-1']), reminderCopy('PICKUP', 2, []), reminderCopy('SEARCH_5', 1, ['DG-1']), reminderCopy('SEARCH_15', 3, [])]) {
      all.push(copy.title, copy.body);
    }
    expect(all.length).toBeGreaterThan(10);
    for (const text of all) {
      expect(text).not.toMatch(/\d{9,}|OTP|mật khẩu|ngân hàng|địa chỉ|\+84|PLATFORM|EXTERNAL/i);
    }
  });

  it('groups: "Bạn còn 2 đơn chưa lấy hàng"', () => {
    expect(reminderCopy('PICKUP', 2, ['A', 'B']).title).toBe('Bạn còn 2 đơn chưa lấy hàng');
    expect(reminderCopy('PICKUP', 1, ['A']).title).toBe('Bạn còn đơn chưa lấy hàng');
  });
});
