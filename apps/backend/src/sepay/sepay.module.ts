import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DriverModule } from '../driver/driver.module';
import { OutboxModule } from '../outbox/outbox.module';
import { TransactionModule } from '../transaction/transaction.module';
import { WalletModule } from '../wallet/wallet.module';
import { SepayReconciliationCursorRepository } from './sepay-reconciliation-cursor-repository';
import { SepayReconciliationService } from './sepay-reconciliation.service';
import { SepayReconciliationSweeper } from './sepay-reconciliation-sweeper';
import { SepaySettlementRepository } from './sepay-settlement-repository';
import { SepaySettlementService } from './sepay-settlement-service';
import { SepayWebhookController } from './sepay-webhook.controller';
import { SepayWebhookService } from './sepay-webhook.service';
import { HttpSepayTransactionsClient, SEPAY_TRANSACTIONS_CLIENT } from './sepay-transactions-client';

/**
 * SePay automatic top-up (M04 steps 1 and 2, Issue #403). The webhook has no session guard: the signed webhook is its authentication. The
 * reconciliation job has no session either: it calls SePay with the server key and settles through the same settlement service. Both only
 * import the existing participants (driver lock, wallet posting, request repository, audit, outbox) and own none of the money rules.
 */
@Module({
  imports: [DriverModule, WalletModule, TransactionModule, AuditModule, OutboxModule],
  controllers: [SepayWebhookController],
  providers: [
    SepaySettlementRepository,
    SepaySettlementService,
    SepayWebhookService,
    SepayReconciliationCursorRepository,
    SepayReconciliationService,
    SepayReconciliationSweeper,
    { provide: SEPAY_TRANSACTIONS_CLIENT, useClass: HttpSepayTransactionsClient },
  ],
  exports: [SepaySettlementRepository],
})
export class SepayModule {}
