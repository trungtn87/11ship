import { Module } from '@nestjs/common';
import { VerificationRepository } from '../auth/verification-repository';
import { TransactionModule } from '../transaction/transaction.module';
import { SmsGatewayAuthGuard } from './sms-gateway-auth.guard';
import { SmsGatewayOtpProvider } from './sms-gateway-otp-provider';
import { SmsGatewayRepository } from './sms-gateway-repository';
import { SmsGatewayController } from './sms-gateway.controller';
import { SmsKeyringHolder, SmsQueueService } from './sms-queue-service';

/**
 * The SMS gateway (issue #102): the PostgreSQL queue, the gateway API and the real OTP adapter. It is imported by AuthModule
 * ONLY when SMS_GATEWAY_ENABLED=true selected it; with the flag off nothing here is created and no route exists.
 * VerificationRepository is a stateless SQL class, provided here so the queue can move the challenge with the job without
 * importing the Auth module (which imports this one).
 */
@Module({
  imports: [TransactionModule],
  controllers: [SmsGatewayController],
  providers: [SmsGatewayRepository, VerificationRepository, SmsKeyringHolder, SmsQueueService, SmsGatewayOtpProvider, SmsGatewayAuthGuard],
  exports: [SmsGatewayOtpProvider, SmsQueueService],
})
export class SmsGatewayModule {}
