// The OTP delivery port (M01-A1 task section 7). Auth Core defines only the boundary: there is no production
// SMS adapter in A1, and the module never invents one. Whoever builds the application binds a provider
// explicitly (AuthModule.register); a missing binding stops startup instead of falling back to a fake.
//
// The provider is ALWAYS called outside a database transaction. It receives the plaintext OTP because it must
// deliver it; nothing else in Auth ever holds the plaintext after the request that generated it.

export interface OtpProvider {
  /**
   * Delivers a REGISTER OTP to the normalized phone number. Resolves when the provider accepted the message,
   * rejects (with anything) when it did not. The rejection is never shown to the client: it becomes a
   * sanitized 503.
   */
  sendRegisterOtp(phoneNormalized: string, otp: string): Promise<void>;
}

/** Injection token of the explicit provider binding. */
export const OTP_PROVIDER = Symbol('OTP_PROVIDER');
