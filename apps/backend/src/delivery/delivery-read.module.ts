import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { DeliveryOfferReader, ShipperWorkReader } from './delivery-ports';
import { DeliveryReportReader } from './delivery-report-reader';
import { DeliveryRepository } from './delivery-repository';

/**
 * M07's own SQL (deliveries, assignments, events, incidents) and the two read ports it gives M06 (the delivery on offer, the open work of a Shipper).
 * It imports only the Wallet module (the commission policy it reads for the offer); its providers are participants that receive a TransactionContext, so M06 can bind them without a module cycle.
 */
@Module({
  imports: [WalletModule],
  providers: [DeliveryRepository, DeliveryOfferReader, ShipperWorkReader, DeliveryReportReader],
  exports: [DeliveryRepository, DeliveryOfferReader, ShipperWorkReader, DeliveryReportReader],
})
export class DeliveryReadModule {}
