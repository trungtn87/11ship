import { DynamicModule, Module } from '@nestjs/common';
import { DeliveryCoreModule } from '../delivery/delivery-core.module';
import { DriverModule } from '../driver/driver.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { ShopModule } from '../shop/shop.module';
import { TransactionModule } from '../transaction/transaction.module';
import { ComplaintController } from './complaint.controller';
import { ComplaintService } from './complaint-service';
import { FeedbackActors } from './feedback-actors';
import { FEEDBACK_ORDER_PORT, NotIntegratedFeedbackOrderPort } from './feedback-order-port';
import { FeedbackReadModule } from './feedback-read.module';
import { PublicReviewController, ReviewController } from './review.controller';
import { ReviewService } from './review-service';

/**
 * M11, the apps' side: ratings (customer -> shop, customer -> Shipper, shop -> Shipper), the shop's reply, the public shop ratings, and complaints with their
 * pictures, follow-up and reconsideration. The Administration routes are wired with the other Admin routes. `auth` must be the very same object AppModule
 * passes to its imports. The M10 order adapter is bound to "not connected": the customer's rating and complaint refuse honestly until M10 is built, while
 * the shop's and the Shipper's flows (which start from a delivery of M07) work fully without it.
 */
@Module({})
export class FeedbackModule {
  static register(auth: DynamicModule): DynamicModule {
    return {
      module: FeedbackModule,
      imports: [auth, TransactionModule, IdempotencyModule, FeedbackReadModule, DeliveryCoreModule.register(auth), DriverModule, ShopModule],
      controllers: [ReviewController, PublicReviewController, ComplaintController],
      providers: [FeedbackActors, ReviewService, ComplaintService, { provide: FEEDBACK_ORDER_PORT, useClass: NotIntegratedFeedbackOrderPort }],
      exports: [FeedbackReadModule],
    };
  }
}
