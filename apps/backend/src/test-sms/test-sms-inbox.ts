import { randomUUID } from 'node:crypto';
import { normalizeVietnamPhone } from '../auth/phone';
import {
  TEST_SMS_CAPACITY,
  TEST_SMS_CHANNEL,
  TEST_SMS_RETENTION_MS,
  TestSmsMessage,
  TestSmsPurpose,
  isTestSmsPurpose,
} from './test-sms-types';

// The one in-memory inbox of the backend (M01.22). REGISTER and ADMIN_ACTIVATION adapters append to the SAME instance
// and the private listener reads it. Nothing here touches the database, an audit row, the outbox, a log or a file:
// a restart of the backend empties it by construction.
//
// Rules:
//  - retention 10 minutes: a message is readable while its age is strictly below the retention, so it is gone at
//    exactly 600000 ms. Expired messages are purged before every insert and every read;
//  - capacity 100: when full, the OLDEST message (by insertion order) is dropped;
//  - ordering is the insertion sequence, never the clock: two messages with the same timestamp still have one
//    deterministic order, and a clock that steps backwards cannot reorder or resurrect anything;
//  - the inbox never resets attempts or cooldowns and never consumes a code: reading changes no challenge.

export interface TestSmsInboxOptions {
  readonly now?: () => number;
  readonly randomId?: () => string;
  readonly retentionMs?: number;
  readonly capacity?: number;
}

export interface TestSmsAppendInput {
  readonly purpose: TestSmsPurpose;
  readonly phoneNormalized: string;
  readonly otp: string;
}

export interface TestSmsListFilter {
  readonly purpose?: TestSmsPurpose;
  readonly phoneNormalized?: string;
  readonly limit: number;
}

interface Entry {
  readonly sequence: number;
  readonly receivedMs: number;
  readonly message: TestSmsMessage;
}

const OTP_SHAPE = /^[0-9]{6}$/;

export class TestSmsInbox {
  readonly #now: () => number;
  readonly #randomId: () => string;
  readonly #retentionMs: number;
  readonly #capacity: number;
  #entries: Entry[] = [];
  #sequence = 0;
  #lastMs = 0;

  constructor(options: TestSmsInboxOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#randomId = options.randomId ?? randomUUID;
    this.#retentionMs = options.retentionMs ?? TEST_SMS_RETENTION_MS;
    this.#capacity = options.capacity ?? TEST_SMS_CAPACITY;
  }

  /**
   * Stores one message. Throws (stores nothing) when the purpose, the phone or the code is not what the core produces:
   * the adapters turn that into their own failure outcome.
   */
  append(input: TestSmsAppendInput): TestSmsMessage {
    if (!isTestSmsPurpose(input.purpose)) {
      throw new TypeError('invalid purpose');
    }
    if (normalizeVietnamPhone(input.phoneNormalized) !== input.phoneNormalized) {
      throw new TypeError('invalid phone');
    }
    if (typeof input.otp !== 'string' || !OTP_SHAPE.test(input.otp)) {
      throw new TypeError('invalid code');
    }
    this.#purge();
    // Never step backwards: received_at stays monotonic even if the wall clock does.
    const receivedMs = Math.max(this.#now(), this.#lastMs);
    this.#lastMs = receivedMs;
    this.#sequence += 1;
    const message: TestSmsMessage = {
      messageId: this.#randomId(),
      purpose: input.purpose,
      phoneNormalized: input.phoneNormalized,
      otp: input.otp,
      receivedAt: new Date(receivedMs).toISOString(),
      channel: TEST_SMS_CHANNEL,
    };
    this.#entries.push({ sequence: this.#sequence, receivedMs, message });
    while (this.#entries.length > this.#capacity) {
      this.#entries.shift();
    }
    return message;
  }

  /** Newest first (highest insertion sequence first), at most `limit` entries. */
  list(filter: TestSmsListFilter): TestSmsMessage[] {
    this.#purge();
    const result: TestSmsMessage[] = [];
    for (let index = this.#entries.length - 1; index >= 0 && result.length < filter.limit; index -= 1) {
      const entry = this.#entries[index];
      if (entry === undefined) {
        continue;
      }
      if (filter.purpose !== undefined && entry.message.purpose !== filter.purpose) {
        continue;
      }
      if (filter.phoneNormalized !== undefined && entry.message.phoneNormalized !== filter.phoneNormalized) {
        continue;
      }
      result.push(entry.message);
    }
    return result;
  }

  get(messageId: string): TestSmsMessage | undefined {
    this.#purge();
    return this.#entries.find((entry) => entry.message.messageId === messageId)?.message;
  }

  /** Number of messages still readable. */
  size(): number {
    this.#purge();
    return this.#entries.length;
  }

  clear(): void {
    this.#entries = [];
  }

  #purge(): void {
    const nowMs = this.#now();
    this.#entries = this.#entries.filter((entry) => nowMs - entry.receivedMs < this.#retentionMs);
  }
}
