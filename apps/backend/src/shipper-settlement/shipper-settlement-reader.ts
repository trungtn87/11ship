import { Injectable } from '@nestjs/common';
import { DeliveryRepository } from '../delivery/delivery-repository';
import { ComplaintRepository } from '../feedback/complaint-repository';
import { TransactionContext } from '../transaction/transaction-context';

/** Closure callers hold the driver root lock. Read actual work and financial obligations through their owners. */
@Injectable()
export class ShipperSettlementReader {
  constructor(private readonly deliveries: DeliveryRepository, private readonly complaints: ComplaintRepository) {}

  async obligations(context: TransactionContext, driverId: string): Promise<{ activeWork: boolean; pendingFinance: boolean }> {
    return {
      activeWork: (await this.deliveries.countActiveOfDriver(context, driverId)) > 0 || (await this.deliveries.countOpenIncidentsOfDriver(context, driverId)) > 0,
      pendingFinance: (await this.complaints.pendingFinanceOfDriver(context, driverId)) > 0,
    };
  }
}
