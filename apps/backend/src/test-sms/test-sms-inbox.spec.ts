import { describe, expect, it } from '@jest/globals';
import { TestSmsInbox } from './test-sms-inbox';
import { TEST_SMS_CAPACITY, TEST_SMS_RETENTION_MS } from './test-sms-types';

const PHONE = '+84901234567';
const OTHER = '+84912345678';

function clock(start = 1_800_000_000_000): { now: () => number; set: (value: number) => void; advance: (ms: number) => void } {
  let current = start;
  return {
    now: () => current,
    set: (value) => {
      current = value;
    },
    advance: (ms) => {
      current += ms;
    },
  };
}

function counterIds(): () => string {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, '0')}`;
}

describe('TestSmsInbox (TS09 TTL / cap / order boundaries)', () => {
  it('stores the exact internal message fields and nothing else', () => {
    const time = clock();
    const inbox = new TestSmsInbox({ now: time.now, randomId: counterIds() });
    const message = inbox.append({ purpose: 'REGISTER', phoneNormalized: PHONE, otp: '123456' });
    expect(message).toEqual({
      messageId: '00000000-0000-4000-8000-000000000001',
      purpose: 'REGISTER',
      phoneNormalized: PHONE,
      otp: '123456',
      receivedAt: new Date(1_800_000_000_000).toISOString(),
      channel: 'SIMULATED_SMS',
    });
    expect(Object.keys(message).sort()).toEqual(['channel', 'messageId', 'otp', 'phoneNormalized', 'purpose', 'receivedAt']);
  });

  it('uses a random UUID by default', () => {
    const inbox = new TestSmsInbox();
    const a = inbox.append({ purpose: 'REGISTER', phoneNormalized: PHONE, otp: '111111' });
    const b = inbox.append({ purpose: 'REGISTER', phoneNormalized: PHONE, otp: '222222' });
    expect(a.messageId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a.messageId).not.toBe(b.messageId);
  });

  it('keeps a message readable up to 599999 ms and purges it at exactly the 10 minute retention', () => {
    const time = clock();
    const inbox = new TestSmsInbox({ now: time.now, randomId: counterIds() });
    const message = inbox.append({ purpose: 'REGISTER', phoneNormalized: PHONE, otp: '123456' });
    time.advance(TEST_SMS_RETENTION_MS - 1);
    expect(inbox.get(message.messageId)).toBeDefined();
    expect(inbox.list({ limit: 20 })).toHaveLength(1);
    time.advance(1);
    expect(inbox.get(message.messageId)).toBeUndefined();
    expect(inbox.list({ limit: 20 })).toHaveLength(0);
    expect(inbox.size()).toBe(0);
  });

  it('purges expired messages before an insert, so an expired one never counts towards the cap', () => {
    const time = clock();
    const inbox = new TestSmsInbox({ now: time.now, randomId: counterIds(), capacity: 2 });
    const old = inbox.append({ purpose: 'REGISTER', phoneNormalized: PHONE, otp: '111111' });
    time.advance(TEST_SMS_RETENTION_MS);
    inbox.append({ purpose: 'REGISTER', phoneNormalized: PHONE, otp: '222222' });
    inbox.append({ purpose: 'REGISTER', phoneNormalized: PHONE, otp: '333333' });
    expect(inbox.get(old.messageId)).toBeUndefined();
    expect(inbox.list({ limit: 20 }).map((m) => m.otp)).toEqual(['333333', '222222']);
  });

  it('drops the OLDEST message by insertion order when the 100 message cap is exceeded', () => {
    const time = clock();
    const inbox = new TestSmsInbox({ now: time.now, randomId: counterIds() });
    for (let index = 0; index < TEST_SMS_CAPACITY + 5; index += 1) {
      inbox.append({ purpose: 'REGISTER', phoneNormalized: PHONE, otp: String(100000 + index) });
    }
    expect(inbox.size()).toBe(TEST_SMS_CAPACITY);
    const all = inbox.list({ limit: 100 });
    expect(all).toHaveLength(100);
    expect(all[0]?.otp).toBe('100104');
    expect(all[99]?.otp).toBe('100005');
  });

  it('orders newest first by insertion even when every message has the same timestamp', () => {
    const time = clock();
    const inbox = new TestSmsInbox({ now: time.now, randomId: counterIds() });
    for (const otp of ['111111', '222222', '333333', '444444']) {
      inbox.append({ purpose: 'REGISTER', phoneNormalized: PHONE, otp });
    }
    expect(inbox.list({ limit: 20 }).map((m) => m.otp)).toEqual(['444444', '333333', '222222', '111111']);
    expect(new Set(inbox.list({ limit: 20 }).map((m) => m.receivedAt)).size).toBe(1);
  });

  it('never moves received_at backwards when the wall clock steps back, and never resurrects a message', () => {
    const time = clock();
    const inbox = new TestSmsInbox({ now: time.now, randomId: counterIds() });
    const first = inbox.append({ purpose: 'REGISTER', phoneNormalized: PHONE, otp: '111111' });
    time.advance(-5000);
    const second = inbox.append({ purpose: 'REGISTER', phoneNormalized: PHONE, otp: '222222' });
    expect(second.receivedAt >= first.receivedAt).toBe(true);
    expect(inbox.list({ limit: 20 }).map((m) => m.otp)).toEqual(['222222', '111111']);
  });

  it('filters by purpose and by normalized phone and honours the limit', () => {
    const time = clock();
    const inbox = new TestSmsInbox({ now: time.now, randomId: counterIds() });
    inbox.append({ purpose: 'REGISTER', phoneNormalized: PHONE, otp: '111111' });
    inbox.append({ purpose: 'ADMIN_ACTIVATION', phoneNormalized: PHONE, otp: '222222' });
    inbox.append({ purpose: 'REGISTER', phoneNormalized: OTHER, otp: '333333' });
    inbox.append({ purpose: 'REGISTER', phoneNormalized: PHONE, otp: '444444' });
    expect(inbox.list({ limit: 20, purpose: 'REGISTER' }).map((m) => m.otp)).toEqual(['444444', '333333', '111111']);
    expect(inbox.list({ limit: 20, phoneNormalized: OTHER }).map((m) => m.otp)).toEqual(['333333']);
    expect(inbox.list({ limit: 20, purpose: 'REGISTER', phoneNormalized: PHONE }).map((m) => m.otp)).toEqual(['444444', '111111']);
    expect(inbox.list({ limit: 2 }).map((m) => m.otp)).toEqual(['444444', '333333']);
  });

  it('refuses (and stores nothing for) a purpose, phone or code the core never produces', () => {
    const inbox = new TestSmsInbox();
    expect(() => inbox.append({ purpose: 'LOGIN' as never, phoneNormalized: PHONE, otp: '123456' })).toThrow();
    expect(() => inbox.append({ purpose: 'REGISTER', phoneNormalized: '0901234567', otp: '123456' })).toThrow();
    expect(() => inbox.append({ purpose: 'REGISTER', phoneNormalized: PHONE, otp: '12345' })).toThrow();
    expect(() => inbox.append({ purpose: 'REGISTER', phoneNormalized: PHONE, otp: '12345a' })).toThrow();
    expect(() => inbox.append({ purpose: 'REGISTER', phoneNormalized: PHONE, otp: '1234567' })).toThrow();
    expect(inbox.size()).toBe(0);
  });

  it('accepts the RESET_PASSWORD purpose in the message contract (no adapter feeds it in M01.22)', () => {
    const inbox = new TestSmsInbox();
    expect(inbox.append({ purpose: 'RESET_PASSWORD', phoneNormalized: PHONE, otp: '654321' }).purpose).toBe('RESET_PASSWORD');
  });

  it('clear() empties the inbox (what a backend stop does)', () => {
    const inbox = new TestSmsInbox();
    inbox.append({ purpose: 'REGISTER', phoneNormalized: PHONE, otp: '123456' });
    inbox.clear();
    expect(inbox.size()).toBe(0);
  });
});
