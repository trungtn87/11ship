import { Injectable } from '@nestjs/common';
import { DeliveryRepository } from '../delivery/delivery-repository';
import { ComplaintRepository } from '../feedback/complaint-repository';
import { TransactionContext } from '../transaction/transaction-context';

/** Closure callers hold the driver root lock. Read actual work and financial obligations through their owners. */
@Injectable()
export class ShipperSettlementReader {
  constructor(private readonly deliveries: DeliveryRepository, private readonly complaints: ComplaintRepository) {}

  /**
   * Work the Shipper must still finish: a running assignment, or goods still in the Shipper's custody after a cancellation or a failed delivery (an OPEN
   * incident). The same definition of "work in progress" closes an account (obligations) and keeps the position shared after the Shipper switched off (M03/M14).
   */
  async hasActiveWork(context: TransactionContext, driverId: string): Promise<boolean> {
    return (await this.deliveries.countActiveOfDriver(context, driverId)) > 0 || (await this.deliveries.countOpenIncidentsOfDriver(context, driverId)) > 0;
  }

  async obligations(context: TransactionContext, driverId: string): Promise<{ activeWork: boolean; pendingFinance: boolean }> {
    return {
      activeWork: await this.hasActiveWork(context, driverId),
      pendingFinance: (await this.complaints.pendingFinanceOfDriver(context, driverId)) > 0,
    };
  }
}
