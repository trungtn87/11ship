import { DynamicModule, Module } from '@nestjs/common';
import { ActivationOtpProvider } from './admin-activation/activation-otp-provider';
import { ActivationSmsGatewayBinding } from './admin-activation/activation-otp-providers';
import { AccountRecoveryModule } from './account-recovery/account-recovery.module';
import { AdminAuthModule } from './admin-auth/admin-auth.module';
import { AuthModule, AuthModuleOptions } from './auth/auth.module';
import { AppConfig } from './config/app-config';
import { CustomerProfileModule } from './customer-profile/customer-profile.module';
import { CustomersModule } from './customers/customers.module';
import { DeliveryModule } from './delivery/delivery.module';
import { FeedbackModule } from './feedback/feedback.module';
import { ConfigModule } from './config/config.module';
import { StartupConfigError } from './config/startup-config-error';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { JsonLogger } from './logging/json-logger';
import { LoggingModule } from './logging/logging.module';
import { MenuModule } from './menu/menu.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OrdersModule } from './orders/orders.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { ShipperSelfModule } from './shipper-self/shipper-self.module';
import { WalletTopupModule } from './wallet-topup/wallet-topup.module';
import { ShopManagementModule } from './shop-management/shop-management.module';
import { StoppableRuntime, TestSmsModule } from './test-sms/test-sms.module';
import { TransactionModule } from './transaction/transaction.module';

export interface AppModuleOptions {
  config: AppConfig;
  logger: JsonLogger;
  /**
   * Auth Core. Optional so that tests of unrelated parts can build an app without Auth's database and
   * secrets; main.ts always passes it. When present, an explicit OTP provider binding is required.
   */
  auth?: AuthModuleOptions;
  /**
   * The activation OTP provider (M01-D-ADMIN-1C). Bound EXPLICITLY by main.ts from ADMIN_ACTIVATION_OTP_MODE; when the
   * activation is enabled with REQUIRED phone verification and no provider is bound, startup stops (no fallback to a
   * fake). With DISABLED_TEST there is no OTP step and binding a provider is refused.
   */
  activationOtpProvider?: ActivationOtpProvider | ActivationSmsGatewayBinding;
  /**
   * The test SMS inbox runtime (M01.22). Passed by main.ts ONLY when TEST_INBOX is active (explicit, development/test,
   * loopback): it ties the private listener and its discovery state to the application's shutdown.
   */
  testSms?: StoppableRuntime;
}

@Module({})
export class AppModule {
  // Configuration and logger are validated/created by the caller and injected. This keeps
  // tests free to build an app without mutating process.env.
  static register(options: AppModuleOptions): DynamicModule {
    // Built once: Onboarding must import the same Auth module object the application imports.
    const auth = options.auth === undefined ? undefined : AuthModule.register(options.auth);
    // Built once: the Orders module imports the very same Delivery module object the application imports.
    const delivery = auth === undefined ? undefined : DeliveryModule.register(auth);
    const activationConfig = options.config.adminActivation;
    // REQUIRED phone verification needs the explicit provider; DISABLED_TEST has no OTP step and must not have one.
    if (activationConfig !== undefined && activationConfig.phoneVerificationMode === 'REQUIRED' && options.activationOtpProvider === undefined) {
      throw new StartupConfigError(['ADMIN_ACTIVATION_OTP_MODE']);
    }
    if (activationConfig !== undefined && activationConfig.phoneVerificationMode === 'DISABLED_TEST' && options.activationOtpProvider !== undefined) {
      throw new StartupConfigError(['ADMIN_ACTIVATION_PHONE_VERIFICATION_MODE']);
    }
    const activation =
      activationConfig === undefined
        ? undefined
        : options.activationOtpProvider === undefined
          ? {}
          : { otpProvider: options.activationOtpProvider };
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(options.config),
        ...(options.testSms === undefined ? [] : [TestSmsModule.register(options.testSms)]),
        LoggingModule.forRoot(options.logger),
        DatabaseModule,
        TransactionModule,
        HealthModule,
        ...(auth === undefined
          ? []
          : [auth, OnboardingModule.register(auth), ShopManagementModule.register(auth), MenuModule.register(auth), CustomerProfileModule.register(auth), CustomersModule.register(auth), ShipperSelfModule.register(auth), WalletTopupModule.register(auth), delivery as DynamicModule, OrdersModule.register(auth, delivery as DynamicModule), FeedbackModule.register(auth), NotificationsModule.register(auth), AccountRecoveryModule.register(auth)]),
        // Administration web authentication: only when ADMIN_AUTH_ENABLED=true (config.adminAuth is then present),
        // on top of the one Auth module object above. Disabled (the default): nothing is wired or exposed.
        ...(auth === undefined || options.config.adminAuth === undefined ? [] : [AdminAuthModule.register(auth, activation)]),
      ],
    };
  }
}
