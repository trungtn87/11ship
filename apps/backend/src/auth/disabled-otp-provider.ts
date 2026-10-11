import { OtpProvider } from './otp-provider';

/**
 * The OTP provider of staging fixture mode (M00-D2): there is no SMS there, and there must not be a "public" fake
 * that would hand out usable codes. Every send fails, always, and the failure carries nothing: no phone number,
 * no code, no reason. It is not reachable in practice (the service boundary refuses OTP request/verify and
 * register before any provider call while fixture mode is on), but a bug that reached it would still fail closed:
 * VerificationService turns the rejection into a sanitized 503 and never leaves a PENDING challenge with a code
 * anyone could use.
 */
export class DisabledOtpProvider implements OtpProvider {
  async sendRegisterOtp(): Promise<void> {
    throw new Error('OTP delivery is disabled');
  }
}
