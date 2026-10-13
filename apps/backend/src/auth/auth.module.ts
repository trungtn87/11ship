import { DynamicModule, Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { ClientAuthController } from '../client-auth/client-auth.controller';
import { CLIENT_AUTH_SETTINGS, clientAuthSettingsFrom } from '../client-auth/client-auth-policy';
import { ClientIdentityReader } from '../client-auth/client-identity-reader';
import { ClientLoginService } from '../client-auth/client-login-service';
import { ClientRegistrationService } from '../client-auth/client-registration-service';
import { ClientSessionAuthority } from '../client-auth/client-session-authority';
import { ClientSessionService } from '../client-auth/client-session-service';
import { DriverModule } from '../driver/driver.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { OutboxModule } from '../outbox/outbox.module';
import { ShopModule } from '../shop/shop.module';
import { TransactionModule } from '../transaction/transaction.module';
import { ACCOUNT_ORIGIN_POLICY, AccountOriginPolicy, createAccountOriginPolicy } from './account-origin';
import { authConfigProvider } from './auth-config.provider';
import { AuthController } from './auth.controller';
import { CustomerProfileRepository } from './customer-profile-repository';
import { CustomerProvisioningParticipant } from './customer-provisioning-participant';
import { AdminIdentityParticipant } from './admin-identity-participant';
import { AdminUserAccountParticipant } from './admin-user-account-participant';
import { AdminPasswordVerifier } from './admin-password-verifier';
import { LoginService } from './login-service';
import { OTP_PROVIDER, OtpProvider } from './otp-provider';
import { Argon2idPasswordHasher, PASSWORD_HASHER } from './password-hasher';
import { ProofRepository } from './proof-repository';
import { RegistrationService } from './registration-service';
import { RoleContextService } from './role-context-service';
import { RoleGrantParticipant } from './role-grant-participant';
import { SessionAuthGuard } from './session-auth.guard';
import { SessionAuthorizationParticipant } from './session-authorization-participant';
import { SessionRepository } from './session-repository';
import { SessionService } from './session-service';
import { UserRepository } from './user-repository';
import { VerificationRepository } from './verification-repository';
import { VerificationService } from './verification-service';

export interface AuthModuleOptions {
  /** Explicit OTP provider binding. There is deliberately no default and no fake fallback. */
  readonly otpProvider: OtpProvider;
  /**
   * Test harness only (M00-D2): an account origin policy to use instead of the one derived from the validated
   * configuration. The factory createAccountOriginPolicy still refuses fixtures outside APP_ENV=staging, so this
   * cannot open production. main.ts never sets it.
   */
  readonly accountOriginPolicy?: AccountOriginPolicy;
}

/**
 * Auth Core (M01-A1). It reuses the M00 modules (transaction, idempotency, audit, outbox) and adds only
 * Auth's own repositories and services. Import it through register(): the OTP provider must be bound
 * explicitly by whoever builds the application.
 *
 * M01-A2S/A2D: it imports ShopModule and DriverModule ONLY for their read-only eligibility ports (Auth never issues
 * SQL against M02 or M03 tables), and it exports what an onboarding coordinator needs: the session guard (with
 * the SessionService the guard is built from), the narrow role-grant participant and the session-authorization
 * participant that re-checks the caller INSIDE the business transaction. Nothing else leaves Auth. ShopModule
 * and DriverModule import nothing, so Auth -> Shop and Auth -> Driver are one-way and need no forwardRef.
 */
@Module({})
export class AuthModule {
  static register(options: AuthModuleOptions): DynamicModule {
    return {
      module: AuthModule,
      imports: [TransactionModule, IdempotencyModule, AuditModule, OutboxModule, ShopModule, DriverModule],
      controllers: [AuthController, ClientAuthController],
      providers: [
        authConfigProvider,
        { provide: OTP_PROVIDER, useValue: options.otpProvider },
        // The account origin policy comes from the validated configuration (APP_ENV, fixture mode, allowlist).
        options.accountOriginPolicy === undefined
          ? {
              provide: ACCOUNT_ORIGIN_POLICY,
              inject: [APP_CONFIG],
              useFactory: (config: AppConfig): AccountOriginPolicy =>
                createAccountOriginPolicy({
                  appEnv: config.appEnv,
                  fixtureModeEnabled: config.stagingFixtures !== undefined,
                  allowedPhones: config.stagingFixtures?.allowedPhones,
                  unverifiedTestModeEnabled: config.clientPhoneVerificationMode === 'DISABLED_TEST',
                }),
            }
          : { provide: ACCOUNT_ORIGIN_POLICY, useValue: options.accountOriginPolicy },
        { provide: PASSWORD_HASHER, useFactory: () => new Argon2idPasswordHasher() },
        { provide: CLIENT_AUTH_SETTINGS, inject: [APP_CONFIG], useFactory: clientAuthSettingsFrom },
        ClientIdentityReader,
        ClientRegistrationService,
        ClientLoginService,
        ClientSessionAuthority,
        ClientSessionService,
        VerificationRepository,
        ProofRepository,
        UserRepository,
        CustomerProfileRepository,
        SessionRepository,
        VerificationService,
        RegistrationService,
        LoginService,
        SessionService,
        RoleContextService,
        RoleGrantParticipant,
        CustomerProvisioningParticipant,
        SessionAuthorizationParticipant,
        SessionAuthGuard,
        AdminIdentityParticipant,
        AdminPasswordVerifier,
        AdminUserAccountParticipant,
      ],
      // A guard named in @UseGuards() of another module is built in THAT module, from its imports, so the
      // SessionService it depends on has to be exported together with the guard.
      // M01.05: the own-profile coordinator (customer-profile/) re-authorizes through the client session authority and reads
      // the CUSTOMER role and the customer profile through their Auth-owned repositories; nothing else is added.
      exports: [
        SessionAuthGuard,
        SessionService,
        RoleGrantParticipant,
        CustomerProvisioningParticipant,
        SessionAuthorizationParticipant,
        AdminIdentityParticipant,
        AdminPasswordVerifier,
        // M01-ADMIN lock / unlock (D15): the ordinary-account participant and the policy it decides with (also used by the detail hint).
        AdminUserAccountParticipant,
        ACCOUNT_ORIGIN_POLICY,
        ClientSessionAuthority,
        CustomerProfileRepository,
        UserRepository,
        // M01-RESET: the no-OTP test password reset revokes sessions with the same repository and hashes with the same hasher.
        SessionRepository,
        PASSWORD_HASHER,
      ],
    };
  }
}
