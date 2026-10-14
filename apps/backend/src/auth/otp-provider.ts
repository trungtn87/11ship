// The OTP delivery port (M01-A1 task section 7). Auth Core defines only the boundary: the module never invents a provider.
// Whoever builds the application binds a provider explicitly (AuthModule.register); a missing binding stops startup instead of
// falling back to a fake.
//
// The provider is ALWAYS called outside a database transaction. It receives the plaintext OTP because it must
// deliver it; nothing else in Auth ever holds the plaintext after the request that generated it.

/** The challenge a delivery belongs to. Synchronous providers ignore it; the SMS gateway queue needs it (issue #102). */
export interface OtpDelivery {
  readonly verificationId: string;
  readonly purpose: 'REGISTER' | 'RESET_PASSWORD';
  readonly ttlSeconds: number;
}

/**
 * Returned by a provider that only ACCEPTED the message into an asynchronous queue. It is NOT a delivery: the challenge stays
 * PENDING_DELIVERY (never verifiable) until the queue reports the outcome. A provider resolving with nothing means the message
 * was handed over for good.
 */
export interface OtpQueuedReceipt {
  readonly queued: true;
}

export interface OtpReadiness {
  /** False when the provider's recipient policy excludes the number (nothing may be sent, nothing is revealed). */
  readonly deliverable: boolean;
}

export interface OtpProvider {
  /**
   * Delivers a REGISTER OTP to the normalized phone number. Resolves when the provider accepted the message,
   * rejects (with anything) when it did not. The rejection is never shown to the client: it becomes a
   * sanitized 503.
   */
  sendRegisterOtp(phoneNormalized: string, otp: string, delivery?: OtpDelivery): Promise<void | OtpQueuedReceipt>;

  /** RESET_PASSWORD OTP (issue #102). Absent = the provider cannot reset passwords (the recovery endpoint stays closed). */
  sendResetOtp?(phoneNormalized: string, otp: string, delivery: OtpDelivery): Promise<void | OtpQueuedReceipt>;

  /**
   * Optional pre-flight, run BEFORE a challenge is created and independent of any account: throws a typed 503/429 when the
   * provider cannot take a message now (kill switch, gateway offline, caps).
   */
  assertReady?(phoneNormalized: string, purpose: OtpDelivery['purpose']): Promise<OtpReadiness>;
}

/** Injection token of the explicit provider binding. */
export const OTP_PROVIDER = Symbol('OTP_PROVIDER');

export function isQueuedReceipt(value: unknown): value is OtpQueuedReceipt {
  return typeof value === 'object' && value !== null && (value as { queued?: unknown }).queued === true;
}
