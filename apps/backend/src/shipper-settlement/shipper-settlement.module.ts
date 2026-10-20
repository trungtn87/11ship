import { Module } from '@nestjs/common';
import { DeliveryReadModule } from '../delivery/delivery-read.module';
import { FeedbackReadModule } from '../feedback/feedback-read.module';
import { ShipperSettlementReader } from './shipper-settlement-reader';

@Module({ imports: [DeliveryReadModule, FeedbackReadModule], providers: [ShipperSettlementReader], exports: [ShipperSettlementReader] })
export class ShipperSettlementModule {}
