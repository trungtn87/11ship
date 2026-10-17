import { Module } from '@nestjs/common';
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
  NotIntegratedDeliveryOfferPort,
  NotIntegratedRouteMatrixPort,
  NotIntegratedShipperLocationPort,
  NotIntegratedShipperWorkPort,
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
  imports: [TransactionModule, DriverModule, WalletModule],
  providers: [
    EligibilityParametersRepository,
    ShippingEligibilityService,
    ShippingFeePolicyRepository,
    ShippingFeePolicyReader,
    ShippingFeeAgreementRepository,
    ShippingFeeAgreementService,
    { provide: DELIVERY_OFFER_PORT, useClass: NotIntegratedDeliveryOfferPort },
    { provide: SHIPPER_WORK_PORT, useClass: NotIntegratedShipperWorkPort },
    { provide: SHIPPER_LOCATION_PORT, useClass: NotIntegratedShipperLocationPort },
    { provide: ROUTE_MATRIX_PORT, useClass: NotIntegratedRouteMatrixPort },
    { provide: AVAILABLE_BALANCE_PORT, useClass: WalletAvailableBalancePort },
  ],
  exports: [EligibilityParametersRepository, ShippingEligibilityService, ShippingFeePolicyRepository, ShippingFeePolicyReader, ShippingFeeAgreementService, DELIVERY_OFFER_PORT, SHIPPER_WORK_PORT, SHIPPER_LOCATION_PORT, ROUTE_MATRIX_PORT, AVAILABLE_BALANCE_PORT],
})
export class ShippingEligibilityModule {}
