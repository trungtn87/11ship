import { ActivationOtpMode } from '../config/admin-activation-config';

// The activation OTP delivery port (contract section 13). Like Auth's OTP port it is defined here and bound EXPLICITLY by
// whoever builds the application: there is no production SMS adapter yet (a later task), the module never invents one,
// and a missing binding stops startup instead of falling back to a fake that would "deliver" codes nowhere.
//
// The provider is ALWAYS called outside a database transaction, with a hard timeout, at most once per explicit
// otp/request. It receives the plaintext OTP because it must deliver it; nothing else keeps the plaintext after the
// request that generated it.

/**
 * ACCEPTED: the provider took the message. REJECTED: the provider clearly refused it (it was not and will not be sent).
 * QUEUED (SMS gateway only): the message was accepted into the asynchronous queue, NOT delivered; the challenge stays
 * PENDING_DELIVERY until the gateway reports the outcome. UNKNOWN: anything else - a timeout, an exception, an unreadable answer; the SMS MAY have been sent, so it is never
 * resent blindly.
 */
export type OtpDeliveryOutcome = 'ACCEPTED' | 'REJECTED' | 'UNKNOWN' | 'QUEUED';

export interface ActivationOtpDelivery {
  readonly outcome: OtpDeliveryOutcome;
  /** Only the TEST_DISPLAY mode (a non-production test environment) returns the code to the client. Never logged. */
  readonly displayedCode?: string;
}

/** The challenge a delivery belongs to. Synchronous providers ignore it; the SMS gateway queue needs it. */
export interface ActivationOtpContext {
  readonly challengeId: string;
  readonly ttlSeconds: number;
}

export interface ActivationOtpProvider {
  readonly mode: ActivationOtpMode;
  send(phoneNormalized: string, otp: string, context?: ActivationOtpContext): Promise<ActivationOtpDelivery>;
}

/** Injection token of the explicit provider binding. */
export const ACTIVATION_OTP_PROVIDER = Symbol('ACTIVATION_OTP_PROVIDER');
