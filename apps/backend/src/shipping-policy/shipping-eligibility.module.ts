import { Module } from '@nestjs/common';
import { DeliveryOfferReader, ShipperWorkReader } from '../delivery/delivery-ports';
import { DeliveryReadModule } from '../delivery/delivery-read.module';
import { M14RouteClient } from '../delivery/m14-route-client';
import { M14RoutingModule } from '../delivery/m14-routing.module';
import { ShipperLocationReader } from '../delivery/shipper-location';
import { ShipperLocationModule } from '../delivery/shipper-location.module';
import { DriverModule } from '../driver/driver.module';
import { TransactionModule } from '../transaction/transaction.module';
import { WalletModule } from '../wallet/wallet.module';
import { EligibilityParametersRepository } from './eligibility-parameters-repository';
import { ShippingFeeAgreementRepository } from './shipping-fee-agreement-repository';
import { ShippingFeeAgreementService } from './shipping-fee-agreement-service';
import { ShippingFeePolicyReader, ShippingFeePolicyRepository } from './shipping-fee-policy-repository';
import { ShippingEligibilityService } from './shipping-eligibility-service';
import {
  AVAILABLE_BALANCE_PORT,
  DELIVERY_OFFER_PORT,
  ROUTE_MATRIX_PORT,
  SHIPPER_LOCATION_PORT,
  SHIPPER_WORK_PORT,
  WalletAvailableBalancePort,
} from './shipping-ports';

/**
 * M06: the eligibility and batching decision and the fee agreement (proposal / counter-offer) for M07, the fee-policy reader, and the repository of the
 * Admin-managed parameters. It exposes NO route of its own
 * (the Admin parameter routes live with the other Admin routes). The M07 delivery/work ports and the M14 location/route ports are bound to
 * "not connected" until those modules provide theirs: every acceptance check then refuses honestly. The balance is the real M04 read model.
 */
@Module({
  imports: [TransactionModule, DriverModule, WalletModule, DeliveryReadModule, ShipperLocationModule, M14RoutingModule],
  providers: [
    EligibilityParametersRepository,
    ShippingEligibilityService,
    ShippingFeePolicyRepository,
    ShippingFeePolicyReader,
    ShippingFeeAgreementRepository,
    ShippingFeeAgreementService,
    // M07 and M14 are connected: the ports answer from M07's tables and M14's latest position / routing service. A fact the owner cannot give is
    // still `undefined` / unavailable, and the check then refuses (fail closed).
    { provide: DELIVERY_OFFER_PORT, useExisting: DeliveryOfferReader },
    { provide: SHIPPER_WORK_PORT, useExisting: ShipperWorkReader },
    { provide: SHIPPER_LOCATION_PORT, useExisting: ShipperLocationReader },
    { provide: ROUTE_MATRIX_PORT, useExisting: M14RouteClient },
    { provide: AVAILABLE_BALANCE_PORT, useClass: WalletAvailableBalancePort },
  ],
  exports: [EligibilityParametersRepository, ShippingEligibilityService, ShippingFeePolicyRepository, ShippingFeePolicyReader, ShippingFeeAgreementService, DELIVERY_OFFER_PORT, SHIPPER_WORK_PORT, SHIPPER_LOCATION_PORT, ROUTE_MATRIX_PORT, AVAILABLE_BALANCE_PORT],
})
export class ShippingEligibilityModule {}
