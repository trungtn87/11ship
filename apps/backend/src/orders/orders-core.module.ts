import { BusinessTradeReader } from './business-trade-reader';
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OutboxModule } from '../outbox/outbox.module';
import { OrderDeliveryAdapter } from './order-delivery-adapter';
import { OrderFeedbackAdapter } from './order-feedback-adapter';
import { OrderRecorder } from './order-recorder';
import { OrderReportReader } from './order-report-reader';
import { OrderRepository } from './order-repository';
import { OrderSalesReader } from './order-sales-reader';

/**
 * The part of M10 that M07 and M08 may depend on: the Order tables' SQL, the three records every Order change leaves and the adapter behind M07's order
 * port. It imports only Audit and Outbox, never Delivery, so the graph is acyclic (Delivery -> OrdersCore; Orders -> Delivery, OrdersCore).
 */
@Module({
  imports: [AuditModule, OutboxModule],
  providers: [BusinessTradeReader, OrderReportReader, OrderRepository, OrderSalesReader, OrderRecorder, OrderDeliveryAdapter, OrderFeedbackAdapter],
  exports: [BusinessTradeReader, OrderReportReader, OrderRepository, OrderSalesReader, OrderRecorder, OrderDeliveryAdapter, OrderFeedbackAdapter],
})
export class OrdersCoreModule {}
