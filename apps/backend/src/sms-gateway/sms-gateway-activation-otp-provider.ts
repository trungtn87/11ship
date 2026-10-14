import { Injectable } from '@nestjs/common';
import { ActivationOtpContext, ActivationOtpDelivery, ActivationOtpProvider } from '../admin-activation/activation-otp-provider';
import { SmsQueueService } from './sms-queue-service';

/**
 * The real activation OTP adapter (Owner decision 2026-10-14). Like the account adapter it only QUEUES the message, so it
 * answers QUEUED and never "delivered": the challenge stays PENDING_DELIVERY (not verifiable) until the gateway reports the
 * outcome. Any refusal (kill switch, no online gateway, cap, recipient policy, superseded challenge) happens BEFORE a row is
 * written, so it is a clear REJECTED, never a guess. Nothing is retried here.
 */
@Injectable()
export class SmsGatewayActivationOtpProvider implements ActivationOtpProvider {
  readonly mode = 'SMS' as const;

  constructor(private readonly queue: SmsQueueService) {}

  async send(phoneNormalized: string, otp: string, context?: ActivationOtpContext): Promise<ActivationOtpDelivery> {
    if (context === undefined) {
      return { outcome: 'REJECTED' };
    }
    try {
      await this.queue.enqueueActivation(phoneNormalized, otp, { challengeId: context.challengeId, ttlSeconds: context.ttlSeconds });
      return { outcome: 'QUEUED' };
    } catch {
      return { outcome: 'REJECTED' };
    }
  }
}
