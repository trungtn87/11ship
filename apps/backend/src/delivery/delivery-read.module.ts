import { Module } from '@nestjs/common';
import { DeliveryOfferReader, ShipperWorkReader } from './delivery-ports';
import { DeliveryReportReader } from './delivery-report-reader';
import { DeliveryRepository } from './delivery-repository';

/**
 * M07's own SQL (deliveries, assignments, events, incidents) and the two read ports it gives M06 (the delivery on offer, the open work of a Shipper).
 * It imports NOTHING: its providers are participants that receive a TransactionContext, so M06 can bind them without a module cycle.
 */
@Module({
  providers: [DeliveryRepository, DeliveryOfferReader, ShipperWorkReader, DeliveryReportReader],
  exports: [DeliveryRepository, DeliveryOfferReader, ShipperWorkReader, DeliveryReportReader],
})
export class DeliveryReadModule {}
