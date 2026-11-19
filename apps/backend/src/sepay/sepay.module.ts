import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DriverModule } from '../driver/driver.module';
import { OutboxModule } from '../outbox/outbox.module';
import { TransactionModule } from '../transaction/transaction.module';
import { WalletModule } from '../wallet/wallet.module';
import { SepayWebhookController } from './sepay-webhook.controller';
import { SepaySettlementRepository } from './sepay-settlement-repository';
import { SepayWebhookService } from './sepay-webhook.service';

/**
 * SePay automatic top-up (M04 step 1, Issue #403). It has no session guard: the signed webhook is its authentication. It only imports the
 * existing participants (driver lock, wallet posting, request repository, audit, outbox) and owns none of the money rules itself.
 */
@Module({
  imports: [DriverModule, WalletModule, TransactionModule, AuditModule, OutboxModule],
  controllers: [SepayWebhookController],
  providers: [SepaySettlementRepository, SepayWebhookService],
})
export class SepayModule {}
