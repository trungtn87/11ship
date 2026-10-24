import { Module } from '@nestjs/common';
import { OtpPolicyRepository } from '../auth/otp-policy-repository';
import { VerificationRepository } from '../auth/verification-repository';
import { OpsCoreModule } from '../ops/ops-core.module';
import { TransactionModule } from '../transaction/transaction.module';
import { SmsGatewayAuthGuard } from './sms-gateway-auth.guard';
import { SmsGatewayActivationOtpProvider } from './sms-gateway-activation-otp-provider';
import { SmsGatewayOtpProvider } from './sms-gateway-otp-provider';
import { SmsGatewayRepository } from './sms-gateway-repository';
import { SmsGatewayController } from './sms-gateway.controller';
import { SmsKeyringHolder, SmsQueueService } from './sms-queue-service';
import { SmsQueueSweeper } from './sms-queue-sweeper';

/**
 * The SMS gateway (issue #102): the PostgreSQL queue, the gateway API and the real OTP adapter. It is imported by AuthModule
 * ONLY when SMS_GATEWAY_ENABLED=true selected it; with the flag off nothing here is created and no route exists.
 * VerificationRepository is a stateless SQL class, provided here so the queue can move the challenge with the job without
 * importing the Auth module (which imports this one).
 */
@Module({
  imports: [TransactionModule, OpsCoreModule],
  controllers: [SmsGatewayController],
  providers: [SmsGatewayRepository, VerificationRepository, OtpPolicyRepository, SmsKeyringHolder, SmsQueueService, SmsGatewayOtpProvider, SmsGatewayActivationOtpProvider, SmsGatewayAuthGuard, SmsQueueSweeper],
  exports: [SmsGatewayOtpProvider, SmsGatewayActivationOtpProvider, SmsQueueService],
})
export class SmsGatewayModule {}
