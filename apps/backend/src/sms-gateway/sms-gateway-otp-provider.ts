import { Injectable } from '@nestjs/common';
import { OtpDelivery, OtpProvider, OtpQueuedReceipt, OtpReadiness } from '../auth/otp-provider';
import { SmsQueueService } from './sms-queue-service';

/**
 * The real OTP adapter (issue #102): it only QUEUES the message, so it answers `queued` and never "delivered". The queue
 * reports the outcome later through the gateway acknowledgement.
 */
@Injectable()
export class SmsGatewayOtpProvider implements OtpProvider {
  constructor(private readonly queue: SmsQueueService) {}

  async assertReady(phoneNormalized: string): Promise<OtpReadiness> {
    return this.queue.assertReady(phoneNormalized);
  }

  async sendRegisterOtp(phoneNormalized: string, otp: string, delivery?: OtpDelivery): Promise<OtpQueuedReceipt> {
    return this.#queue(phoneNormalized, otp, delivery, 'REGISTER');
  }

  async sendResetOtp(phoneNormalized: string, otp: string, delivery: OtpDelivery): Promise<OtpQueuedReceipt> {
    return this.#queue(phoneNormalized, otp, delivery, 'RESET_PASSWORD');
  }

  async #queue(phoneNormalized: string, otp: string, delivery: OtpDelivery | undefined, purpose: OtpDelivery['purpose']): Promise<OtpQueuedReceipt> {
    if (delivery === undefined || delivery.purpose !== purpose) {
      throw new Error('delivery context is required');
    }
    await this.queue.enqueue(phoneNormalized, otp, {
      verificationId: delivery.verificationId,
      purpose,
      ttlSeconds: delivery.ttlSeconds,
    });
    return { queued: true };
  }
}
