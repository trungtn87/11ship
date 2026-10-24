import { expect, it } from '@jest/globals';
import { DeliveryRepository } from '../delivery/delivery-repository';
import { ComplaintRepository } from '../feedback/complaint-repository';
import { TransactionContext } from '../transaction/transaction-context';
import { ShipperSettlementReader } from './shipper-settlement-reader';

it.each([[0, 0, false, false], [1, 0, true, false], [0, 1, false, true]])('M03 closure sees actual delivery count %s and unsettled finance count %s', async (work, finance, activeWork, pendingFinance) => {
  const reader = new ShipperSettlementReader(
    { countActiveOfDriver: async () => work, countOpenIncidentsOfDriver: async () => 0 } as unknown as DeliveryRepository,
    { pendingFinanceOfDriver: async () => finance } as unknown as ComplaintRepository,
  );
  expect(await reader.obligations({} as TransactionContext, 'driver')).toEqual({ activeWork, pendingFinance });
});

it('an unresolved goods custody incident also prevents closing/refunding', async () => {
  const reader = new ShipperSettlementReader(
    { countActiveOfDriver: async () => 0, countOpenIncidentsOfDriver: async () => 1 } as unknown as DeliveryRepository,
    { pendingFinanceOfDriver: async () => 0 } as unknown as ComplaintRepository,
  );
  expect((await reader.obligations({} as TransactionContext, 'driver')).activeWork).toBe(true);
});

it.each([[0, 0, false], [1, 0, true], [0, 1, true], [2, 1, true]])('the same definition keeps the position shared: %s running, %s custody incident -> work in progress %s', async (running, incidents, expected) => {
  const reader = new ShipperSettlementReader(
    { countActiveOfDriver: async () => running, countOpenIncidentsOfDriver: async () => incidents } as unknown as DeliveryRepository,
    { pendingFinanceOfDriver: async () => 0 } as unknown as ComplaintRepository,
  );
  expect(await reader.hasActiveWork({} as TransactionContext, 'driver')).toBe(expected);
});
