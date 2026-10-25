import { Module } from '@nestjs/common';
import { ShopPaymentRepository } from './shop-payment-repository';

/** The SQL of the shop payment requests and the manual entitlements. It imports nothing, so Menu (the dish limit) and the payment modules can all depend on it. */
@Module({
  providers: [ShopPaymentRepository],
  exports: [ShopPaymentRepository],
})
export class ShopPaymentCoreModule {}
