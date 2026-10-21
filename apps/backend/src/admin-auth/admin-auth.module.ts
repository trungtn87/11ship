import { ShipperSettlementModule } from '../shipper-settlement/shipper-settlement.module';
import { DynamicModule, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ActivationOtpProvider, ACTIVATION_OTP_PROVIDER } from '../admin-activation/activation-otp-provider';
import { ActivationSmsGatewayBinding, isActivationSmsGatewayBinding } from '../admin-activation/activation-otp-providers';
import { SmsGatewayActivationOtpProvider } from '../sms-gateway/sms-gateway-activation-otp-provider';
import { SmsGatewayModule } from '../sms-gateway/sms-gateway.module';
import { adminActivationConfigProvider } from '../admin-activation/admin-activation-config.provider';
import { AdminActivationInvalidator } from '../admin-activation/admin-activation-invalidator';
import { AdminActivationLimiter } from '../admin-activation/admin-activation-limiter';
import { AdminActivationRepository } from '../admin-activation/admin-activation-repository';
import { AdminActivationService } from '../admin-activation/admin-activation-service';
import { AdminActivationController } from '../admin-activation/admin-activation.controller';
import { AdminAccountLockService } from '../admin-account-lock/admin-account-lock-service';
import { AdminAccountLockController } from '../admin-account-lock/admin-account-lock.controller';
import { AdminAccountReadRepository } from '../admin-accounts/admin-account-read-repository';
import { AdminAccountReadService } from '../admin-accounts/admin-account-read-service';
import { AdminAccountReadController, AdminPermissionsController } from '../admin-accounts/admin-account-read.controller';
import { AdminErrorLogsController } from '../admin-monitoring/admin-error-logs.controller';
import { ShippingEligibilityModule } from '../shipping-policy/shipping-eligibility.module';
import { ShippingEligibilityPolicyService } from '../shipping-policy/shipping-eligibility-policy-service';
import { ShippingEligibilityPolicyController, ShippingFeePolicyController } from '../shipping-policy/shipping-fee-policy.controller';
import { ShippingFeePolicyService } from '../shipping-policy/shipping-fee-policy-service';
import { AdminDeliveryService } from '../admin-deliveries/admin-delivery-service';
import { AdminOrderController } from '../admin-orders/admin-order.controller';
import { AdminOrderService } from '../admin-orders/admin-order-service';
import { OrdersCoreModule } from '../orders/orders-core.module';
import { OrderViews } from '../orders/order-views';
import { ShopModule } from '../shop/shop.module';
import { AdminDeliveryController } from '../admin-deliveries/admin-delivery.controller';
import { AdminFeedbackController } from '../admin-feedback/admin-feedback.controller';
import { AdminFeedbackService } from '../admin-feedback/admin-feedback-service';
import { COMMISSION_ADJUSTMENT_PORT } from '../feedback/feedback-finance-port';
import { FeedbackReadModule } from '../feedback/feedback-read.module';
import { AdminNotificationController } from '../notifications/admin-notification.controller';
import { AdminNotificationService } from '../notifications/admin-notification-service';
import { NotificationsReadModule } from '../notifications/notifications-read.module';
import { DeliveryCoreModule } from '../delivery/delivery-core.module';
import { AdminShipperController, ShipperWalletParametersController } from '../admin-shippers/admin-shipper.controller';
import { AdminShipperService } from '../admin-shippers/admin-shipper-service';
import { ShipperWalletParametersService } from '../admin-shippers/shipper-wallet-parameters-service';
import { DriverModule } from '../driver/driver.module';
import { AdminTopupController } from '../admin-topups/admin-topup.controller';
import { AdminFinanceController } from '../admin-finance/admin-finance.controller';
import { AdminFinanceReadService } from '../admin-finance/admin-finance-read-service';
import { AdminWithdrawalService } from '../admin-finance/admin-withdrawal-service';
import { AdminTopupService } from '../admin-topups/admin-topup-service';
import { FinanceAccessController } from '../finance-access/finance-access.controller';
import { FinanceAccessParticipant } from '../finance-access/finance-access-participant';
import { FinanceAccessRepository } from '../finance-access/finance-access-repository';
import { FinanceAccessService } from '../finance-access/finance-access-service';
import { SystemBankAccountService } from '../finance-access/system-bank-account-service';
import { WalletCommissionAdjustmentAdapter } from '../wallet/wallet-commission-adjustment.adapter';
import { WalletModule } from '../wallet/wallet.module';
import { AdminMenuCategoryService } from '../admin-menu-categories/admin-menu-category-service';
import { AdminMenuCategoryController } from '../admin-menu-categories/admin-menu-category.controller';
import { MenuCategoryAdminRepository } from '../menu/menu-category-admin-repository';
import { AdminInvitationParticipant } from '../admin-invitations/admin-invitation-participant';
import { AdminInvitationRepository } from '../admin-invitations/admin-invitation-repository';
import { AdminInvitationReader } from '../admin-provisioning/admin-invitation-reader';
import { AdminInvitationService } from '../admin-provisioning/admin-invitation-service';
import { AdminOperationRepository } from '../admin-provisioning/admin-operation-repository';
import { AdminOperationService } from '../admin-provisioning/admin-operation-service';
import { AdminProvisioningController } from '../admin-provisioning/admin-provisioning.controller';
import { AdminSystemActor } from '../admin-provisioning/admin-system-actor';
import { AuditModule } from '../audit/audit.module';
import { TimeoutPolicyService } from '../order-timeouts/timeout-policy-service';
import { SystemSettingsController } from '../system-settings/system-settings.controller';
import { SystemSettingsService } from '../system-settings/system-settings-service';
import { OutboxModule } from '../outbox/outbox.module';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { AdminAuthConfig } from '../config/admin-auth-config';
import { IdempotencyModule, requireKeyring } from '../idempotency/idempotency.module';
import { TransactionModule } from '../transaction/transaction.module';
import { adminAuthConfigProvider, ADMIN_AUTH_CONFIG } from './admin-auth-config.provider';
import { AdminAuthController, noStoreMiddleware } from './admin-auth.controller';
import { AdminBootstrapService } from './admin-bootstrap-service';
import { AdminChallengeRepository } from './admin-challenge-repository';
import { AdminCredentialChecks } from './admin-credential-checks';
import { AdminCrypto } from './admin-crypto';
import { AdminFactorRepository } from './admin-factor-repository';
import { ADMIN_LIMITER_KEY, AdminLimiter } from './admin-limiter';
import { AdminLimitConfigRepository } from './admin-limit-config-repository';
import { AdminLimitConfigService } from './admin-limit-config-service';
import { AdminLimitConfigVerifier } from './admin-limit-config-verifier';
import { AdminLimitsRepository } from './admin-limits-repository';
import { AdminLoginService } from './admin-login-service';
import { AdminMembershipRepository } from './admin-membership-repository';
import { AdminSessionRepository } from './admin-session-repository';
import { AdminSessionService } from './admin-session-service';
import { AdminTotpService } from './admin-totp-service';

/**
 * Administration web authentication (M01-D-LOGIN). Wired by AppModule only when ADMIN_AUTH_ENABLED=true. It sits ABOVE
 * Auth: it receives the already built Auth dynamic module (the very same object AppModule imports, so Nest sees one
 * AuthModule) and uses only the two narrow ports Auth exports for it - AdminIdentityParticipant and
 * AdminPasswordVerifier. Nothing imports it, so the graph is acyclic and needs no forwardRef. The keyring is required
 * (startup stops naming only the two variables), and the limiter configuration row is verified before listening.
 */
/**
 * Present only when ADMIN_ACTIVATION_ENABLED=true (M01-D-ADMIN-1C). The OTP provider is bound explicitly and exists exactly
 * when the phone verification is REQUIRED; with the local DISABLED_TEST mode there is no OTP step and no provider.
 */
export interface AdminActivationWiring {
  readonly otpProvider?: ActivationOtpProvider | ActivationSmsGatewayBinding;
}

@Module({})
export class AdminAuthModule implements NestModule {
  static register(auth: DynamicModule, activation?: AdminActivationWiring): DynamicModule {
    return {
      module: AdminAuthModule,
      imports: [
        ShipperSettlementModule,
        auth,
        TransactionModule,
        AuditModule,
        OutboxModule,
        IdempotencyModule,
        // M03 Shipper tables and ports (repositories, the wallet port, the owner's view).
        DriverModule,
        // M04-B2.2a: the SYSTEM receiving accounts (SQL stays in the Wallet package).
        WalletModule,
        // M06-B/C eligibility and batching (its parameter repository backs the Admin routes below).
        ShippingEligibilityModule,
        // M07.07 deliveries for the Admin routes below (views, the three records, the M06 agreements and the commission hold through their owners).
        DeliveryCoreModule.register(auth),
        // M10.05 order management for the Admin routes below (the Order tables' SQL and the three records through their owner, the shop read port).
        OrdersCoreModule,
        ShopModule,
        // M08.06 notification administration (read-only SQL; the worker itself lives in NotificationsModule, never twice).
        NotificationsReadModule,
        // M11.03 reviews and complaints for the Admin routes below (the SQL of the M11 tables lives in one place).
        FeedbackReadModule,
        // The activation OTP goes through the SAME SMS gateway queue as the account OTPs (one module instance, no second gateway).
        ...(activation !== undefined && isActivationSmsGatewayBinding(activation.otpProvider) ? [SmsGatewayModule] : []),
      ],
      // M01-D-ADMIN-1B: the SYSTEM invitation routes under /v1/admin ride on the same, conditionally wired module.
      // M01-D-ADMIN-1C: the activation routes under /v1/admin-activation exist only when explicitly enabled.
      controllers: [AdminAuthController, AdminProvisioningController, AdminAccountReadController, AdminPermissionsController, AdminErrorLogsController, AdminAccountLockController, SystemSettingsController, AdminMenuCategoryController, AdminShipperController, ShipperWalletParametersController, ShippingFeePolicyController, ShippingEligibilityPolicyController, FinanceAccessController, AdminTopupController, AdminFinanceController, AdminDeliveryController, AdminFeedbackController, AdminOrderController, AdminNotificationController, ...(activation === undefined ? [] : [AdminActivationController])],
      providers: [
        adminAuthConfigProvider,
        {
          provide: ADMIN_LIMITER_KEY,
          inject: [ADMIN_AUTH_CONFIG],
          useFactory: (config: AdminAuthConfig) => config.limiter.key,
        },
        {
          provide: AdminCrypto,
          inject: [APP_CONFIG],
          useFactory: (config: AppConfig) => new AdminCrypto(requireKeyring(config)),
        },
        AdminLimitsRepository,
        AdminLimiter,
        AdminMembershipRepository,
        AdminFactorRepository,
        AdminChallengeRepository,
        AdminSessionRepository,
        AdminCredentialChecks,
        AdminLoginService,
        AdminTotpService,
        AdminSessionService,
        AdminLimitConfigRepository,
        AdminLimitConfigService,
        AdminLimitConfigVerifier,
        AdminBootstrapService,
        AdminInvitationRepository,
        AdminInvitationParticipant,
        AdminInvitationReader,
        AdminOperationRepository,
        AdminSystemActor,
        AdminOperationService,
        AdminInvitationService,
        // Read-only account projections (M01-ADMIN account read).
        AdminAccountReadRepository,
        AdminAccountReadService,
        // M01-ADMIN lock / unlock of ordinary USER accounts (D15).
        AdminAccountLockService,
        // SYSTEM-only system settings (OTP switches).
        SystemSettingsService, TimeoutPolicyService,
        // M02 dish-group management (SYSTEM, or an ADMIN with the catalog right). The SQL stays in the Menu module's repository.
        MenuCategoryAdminRepository,
        AdminMenuCategoryService,
        // M03 Shipper management (SYSTEM, or an ADMIN with the DRIVER permissions) and the SYSTEM-only Shipper wallet parameters.
        AdminShipperService,
        ShipperWalletParametersService,
        // M04 finance access (SYSTEM gives each right to an ADMIN, default deny) and the SYSTEM-only receiving accounts (always created not receiving).
        FinanceAccessRepository,
        FinanceAccessParticipant,
        FinanceAccessService,
        SystemBankAccountService,
        // M04-B2.2b Admin reconciliation of the Shipper top-up requests (the ledger posting itself stays in WalletModule).
        AdminTopupService,
        // M04-C: withdrawals (process, confirm, reconcile), the finance reads and the commission policy.
        AdminWithdrawalService,
        AdminFinanceReadService,
        // M06-A flexible shipping-fee table (SYSTEM changes, any ADMIN reads).
        ShippingFeePolicyService,
        ShippingEligibilityPolicyService,
        // M07.07 delivery management (SYSTEM, or an ADMIN with the SHOP / DRIVER permissions).
        AdminDeliveryService,
        AdminFeedbackService,
        // The money part of a commission adjustment goes to the wallet package (M04), never to the ledger directly.
        { provide: COMMISSION_ADJUSTMENT_PORT, useExisting: WalletCommissionAdjustmentAdapter },
        // M10.05 order management (SYSTEM, or an ADMIN with the SHOP / DRIVER permissions).
        OrderViews,
        AdminOrderService,
        AdminNotificationService,
        // The 1B section 8.8 hook is always present (1B calls it); it is a no-op when no activation attempt exists.
        AdminActivationRepository,
        AdminActivationInvalidator,
        ...(activation === undefined
          ? []
          : [
              ...(activation.otpProvider === undefined
                ? []
                : [
                    isActivationSmsGatewayBinding(activation.otpProvider)
                      ? { provide: ACTIVATION_OTP_PROVIDER, useExisting: SmsGatewayActivationOtpProvider }
                      : { provide: ACTIVATION_OTP_PROVIDER, useValue: activation.otpProvider },
                  ]),
              adminActivationConfigProvider,
              AdminActivationLimiter,
              AdminActivationService,
            ]),
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(noStoreMiddleware).forRoutes(AdminAuthController, AdminProvisioningController, AdminAccountReadController, AdminPermissionsController, AdminErrorLogsController, AdminAccountLockController, SystemSettingsController, AdminMenuCategoryController, AdminShipperController, ShipperWalletParametersController, ShippingFeePolicyController, ShippingEligibilityPolicyController, FinanceAccessController, AdminTopupController, AdminFinanceController, AdminDeliveryController, AdminNotificationController);
    // The activation transport headers are an application-level middleware in configureApp (app.setup.ts): it must precede
    // the body parser, which module middleware does not.
  }
}
