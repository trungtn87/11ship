import { Module } from '@nestjs/common';
import { DriverModule } from '../driver/driver.module';
import { ShopModule } from '../shop/shop.module';
import { WalletModule } from '../wallet/wallet.module';
import { PaymentChatRepository } from './payment-chat-repository';

/** The SQL of the payment conversation. It imports only the owners of the tables it reads (wallet, driver, shop), so M08 (recipients) and the services can depend on it without a cycle. */
@Module({
  imports: [WalletModule, DriverModule, ShopModule],
  providers: [PaymentChatRepository],
  exports: [PaymentChatRepository],
})
export class PaymentChatCoreModule {}
