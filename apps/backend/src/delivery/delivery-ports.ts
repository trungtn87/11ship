import { Injectable } from '@nestjs/common';
import { BatchOrder } from '../shipping-policy/shipping-batching';
import { DeliveryOffer, DeliveryOfferPort, ShipperOpenWork, ShipperWorkPort } from '../shipping-policy/shipping-ports';
import { TransactionContext } from '../transaction/transaction-context';
import { COMMISSION_VND } from './delivery-constants';
import { DeliveryRepository } from './delivery-repository';

// What M06 may know about M07, answered from M07's own tables. M06 never sees a phone number or an address text: only what its rules need.

/** The delivery on offer, as the eligibility rules need it. */
@Injectable()
export class DeliveryOfferReader implements DeliveryOfferPort {
  constructor(private readonly deliveries: DeliveryRepository) {}

  async offer(context: TransactionContext, deliveryId: string): Promise<DeliveryOffer | undefined> {
    const delivery = await this.deliveries.findById(context, deliveryId);
    if (delivery === undefined) {
      return undefined;
    }
    const taken = (await this.deliveries.findActiveAssignment(context, deliveryId)) !== undefined;
    return {
      deliveryId: delivery.deliveryId,
      searching: delivery.state === 'waiting_driver',
      hasShipper: taken,
      searchExpiresAtMs: delivery.searchExpiresAtMs,
      shop: { lat: delivery.pickupLat, lng: delivery.pickupLng },
      dropoff: delivery.dropoffLat === null || delivery.dropoffLng === null ? null : { lat: delivery.dropoffLat, lng: delivery.dropoffLng },
      // The commission M04 would set aside: a fixed amount per delivery today (ADR-004), snapshotted on the assignment when it is accepted.
      requiredHoldVnd: COMMISSION_VND,
    };
  }
}

/** The open work of a Shipper: how many deliveries and, for each, what the batching rule needs (the ORIGINAL ETA is stored once on the assignment). */
@Injectable()
export class ShipperWorkReader implements ShipperWorkPort {
  constructor(private readonly deliveries: DeliveryRepository) {}

  async openWork(context: TransactionContext, driverId: string): Promise<ShipperOpenWork> {
    const assignments = await this.deliveries.listActiveOfDriver(context, driverId);
    const orders: BatchOrder[] = [];
    for (const assignment of assignments) {
      const delivery = await this.deliveries.findById(context, assignment.deliveryId);
      if (delivery === undefined) {
        continue;
      }
      orders.push({
        orderId: delivery.deliveryId,
        originalEtaMs: assignment.originalEtaAtMs,
        pickedUp: assignment.pickedUpAtMs !== null,
        pickup: { lat: delivery.pickupLat, lng: delivery.pickupLng },
        dropoff: delivery.dropoffLat === null || delivery.dropoffLng === null ? null : { lat: delivery.dropoffLat, lng: delivery.dropoffLng },
      });
    }
    return { activeCount: assignments.length, orders };
  }
}
