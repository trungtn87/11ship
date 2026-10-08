import { DynamicModule, Module } from '@nestjs/common';
import { AuthModule, AuthModuleOptions } from './auth/auth.module';
import { AppConfig } from './config/app-config';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { JsonLogger } from './logging/json-logger';
import { LoggingModule } from './logging/logging.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { ShopManagementModule } from './shop-management/shop-management.module';
import { TransactionModule } from './transaction/transaction.module';

export interface AppModuleOptions {
  config: AppConfig;
  logger: JsonLogger;
  /**
   * Auth Core. Optional so that tests of unrelated parts can build an app without Auth's database and
   * secrets; main.ts always passes it. When present, an explicit OTP provider binding is required.
   */
  auth?: AuthModuleOptions;
}

@Module({})
export class AppModule {
  // Configuration and logger are validated/created by the caller and injected. This keeps
  // tests free to build an app without mutating process.env.
  static register(options: AppModuleOptions): DynamicModule {
    // Built once: Onboarding must import the same Auth module object the application imports.
    const auth = options.auth === undefined ? undefined : AuthModule.register(options.auth);
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(options.config),
        LoggingModule.forRoot(options.logger),
        DatabaseModule,
        TransactionModule,
        HealthModule,
        ...(auth === undefined ? [] : [auth, OnboardingModule.register(auth), ShopManagementModule.register(auth)]),
      ],
    };
  }
}
