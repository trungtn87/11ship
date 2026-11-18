import { DynamicModule, Module } from '@nestjs/common';
import { DriverModule } from '../driver/driver.module';
import { DriverWalletAccess } from '../driver-wallet/driver-wallet-access';
import { TransactionModule } from '../transaction/transaction.module';
import { WalletModule } from '../wallet/wallet.module';
import { DriverIncomeController } from './driver-income.controller';
import { DriverIncomeService } from './driver-income.service';

/**
 * The Shipper's income endpoint under /v1/driver/income (issue #395): one read-only summary for a Vietnam calendar period. It sits above Auth (session
 * guard), Driver and Transaction, and reuses the wallet's access rule. `auth` must be the very same object AppModule passes to its imports.
 */
@Module({})
export class DriverIncomeModule {
  static register(auth: DynamicModule): DynamicModule {
    return {
      module: DriverIncomeModule,
      imports: [auth, DriverModule, TransactionModule, WalletModule],
      controllers: [DriverIncomeController],
      providers: [DriverWalletAccess, DriverIncomeService],
    };
  }
}
