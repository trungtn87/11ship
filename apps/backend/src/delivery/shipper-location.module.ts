import { Module } from '@nestjs/common';
import { ShipperLocationReader, ShipperLocationRepository } from './shipper-location';

/** M14, the Shipper's latest position: one row per Shipper, no history. The reader is M06's location port. */
@Module({
  providers: [ShipperLocationRepository, ShipperLocationReader],
  exports: [ShipperLocationRepository, ShipperLocationReader],
})
export class ShipperLocationModule {}
