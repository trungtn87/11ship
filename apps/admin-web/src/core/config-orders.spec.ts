import { describe, expect, it } from '@jest/globals';
import { CONFIG_FIELDS, describeChange, GROUP_ORDER, validateConfig } from './config';

describe('Cài đặt › Đơn hàng: Thời gian trả lời đề xuất phí', () => {
  it('is a group of the central configuration, in minutes', () => {
    expect(GROUP_ORDER).toContain('orders');
    expect(CONFIG_FIELDS.ORDER).toEqual([{ key: 'fee_answer_minutes', label: 'Thời gian trả lời đề xuất phí', type: 'integer', min: 1, max: 1440, unit: 'phút' }]);
  });

  it('accepts a positive whole number of minutes and refuses everything else before anything is sent', () => {
    expect(validateConfig('ORDER', { fee_answer_minutes: 5 })).toBeUndefined();
    expect(validateConfig('ORDER', { fee_answer_minutes: 1440 })).toBeUndefined();
    for (const bad of [0, -1, 1.5, 1441, Number.NaN]) {
      expect(validateConfig('ORDER', { fee_answer_minutes: bad })).toContain('Thời gian trả lời đề xuất phí');
    }
    expect(validateConfig('ORDER', {})).toContain('Thời gian trả lời đề xuất phí');
  });

  it('describes a change in words', () => {
    const text = describeChange({ at: '2026-10-24T01:00:00.000Z', group: 'orders', action: 'admin.order_parameters.update.v1', actorName: 'S', resourceVersion: 2, metadata: { param_key: 'fee_answer_minutes', old_value: 5, new_value: 10 } } as never);
    expect(text).toBe('Thời gian trả lời đề xuất phí: 5 phút → 10 phút');
  });

  it('describes a change of the SMS OTP limits with before and after of every value that changed', () => {
    const text = describeChange({
      at: '2026-10-24T01:00:00.000Z',
      group: 'security',
      action: 'admin.otp_policy.update.v1',
      actorName: 'S',
      resourceVersion: 2,
      metadata: { from_values: { cooldown_seconds: 60, max_wrong_attempts: 3, phone_per_hour: 3, phone_per_day: 5, ip_per_hour: 10, global_per_day: 30 }, to_values: { cooldown_seconds: 90, max_wrong_attempts: 3, phone_per_hour: 3, phone_per_day: 5, ip_per_hour: 20, global_per_day: 30 }, changed_keys: ['cooldown_seconds', 'ip_per_hour'] },
    } as never);
    expect(text).toContain('→ 90 giây');
    expect(text).toContain('10 → 20 lần');
    expect(text).not.toContain('Số lần nhập sai');
  });
});
