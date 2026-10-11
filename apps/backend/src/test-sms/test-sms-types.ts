// M01.22 - test SMS inbox: shared constants and types. The inbox is a LOCAL development/test device only: it holds the
// OTP that Auth Core (REGISTER) and the administration activation (ADMIN_ACTIVATION) generated, in backend memory, so
// the Owner can read it on the PC. It never delivers anything to a phone and proves nothing about phone ownership.

/** RESET_PASSWORD exists in the contract of the message; no adapter feeds it in M01.22 (reserved for M01.16). */
export const TEST_SMS_PURPOSES = ['REGISTER', 'RESET_PASSWORD', 'ADMIN_ACTIVATION'] as const;
export type TestSmsPurpose = (typeof TEST_SMS_PURPOSES)[number];

/** The only purposes a listener query may filter by is the full enum (the tool offers the two wired ones). */
export function isTestSmsPurpose(value: unknown): value is TestSmsPurpose {
  return typeof value === 'string' && (TEST_SMS_PURPOSES as readonly string[]).includes(value);
}

export const TEST_SMS_CHANNEL = 'SIMULATED_SMS' as const;

/** Retention and capacity of the test inbox. They do NOT replace the OTP expiry, which the core decides in the DB. */
export const TEST_SMS_RETENTION_MS = 10 * 60 * 1000;
export const TEST_SMS_CAPACITY = 100;

export const TEST_SMS_LIST_LIMIT_DEFAULT = 20;
export const TEST_SMS_LIST_LIMIT_MAX = 20;

/** Version of the discovery state file and of the private listener protocol. */
export const TEST_SMS_PROTOCOL_VERSION = 1;

/** The listener always binds exactly this address. It is never configurable. */
export const TEST_SMS_LOOPBACK_HOST = '127.0.0.1';

/** What the inbox stores for one message. Never serialized to any log, audit row, outbox row or file. */
export interface TestSmsMessage {
  readonly messageId: string;
  readonly purpose: TestSmsPurpose;
  readonly phoneNormalized: string;
  readonly otp: string;
  /** ISO 8601 UTC, set by the server when the message entered the inbox. */
  readonly receivedAt: string;
  readonly channel: typeof TEST_SMS_CHANNEL;
}

/** Listener quota: a token bucket per read token. 60 requests per minute with a burst of 10. */
export const TEST_SMS_BUCKET_CAPACITY = 10;
export const TEST_SMS_BUCKET_REFILL_PER_SECOND = 1;

/**
 * Fixed startup failure codes of the test inbox. A code names a class of failure only: it never carries a path, a user,
 * a token or a phone number, so it is always safe to print.
 */
export const TEST_SMS_STARTUP_CODES = [
  'TEST_INBOX_NOT_LOCAL',
  'TEST_INBOX_REPO_UNRESOLVED',
  'TEST_INBOX_STATE_NOT_PRIVATE',
  'TEST_INBOX_STATE_IN_USE',
  'TEST_INBOX_STATE_WRITE_FAILED',
  'TEST_INBOX_LISTENER_FAILED',
  'TEST_INBOX_PLATFORM_UNSUPPORTED',
] as const;
export type TestSmsStartupCode = (typeof TEST_SMS_STARTUP_CODES)[number];

export class TestSmsStartupError extends Error {
  readonly code: TestSmsStartupCode;

  constructor(code: TestSmsStartupCode) {
    super(`The test SMS inbox could not start (${code})`);
    this.name = 'TestSmsStartupError';
    this.code = code;
  }
}
