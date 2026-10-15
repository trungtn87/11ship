import { ClientPasswordService } from '../client-auth/client-password-service';
import { DynamicModule, Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { ClientAuthController } from '../client-auth/client-auth.controller';
import { CLIENT_AUTH_SETTINGS, clientAuthSettingsFrom } from '../client-auth/client-auth-policy';
import { ClientDeviceBindingParticipant } from '../client-device/client-device-binding-participant';
import { ClientDeviceProofService } from '../client-device/client-device-proof-service';
import { ClientDeviceRepository } from '../client-device/client-device-repository';
import { ClientDeviceService } from '../client-device/client-device-service';
import { ClientDeviceController } from '../client-device/client-device.controller';
import { CLIENT_DEVICE_TRUST, ClientDeviceTrust, trustFromConfig } from '../client-device/client-device-trust';
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
import { isSmsGatewayBinding, SmsGatewayBinding } from './otp-provider-binding';
import { SmsGatewayModule } from '../sms-gateway/sms-gateway.module';
import { SmsGatewayOtpProvider } from '../sms-gateway/sms-gateway-otp-provider';
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
  readonly otpProvider: OtpProvider | SmsGatewayBinding;
  /**
   * Test harness only (M00-D2): an account origin policy to use instead of the one derived from the validated
   * configuration. The factory createAccountOriginPolicy still refuses fixtures outside APP_ENV=staging, so this
   * cannot open production. main.ts never sets it.
   */
  readonly accountOriginPolicy?: AccountOriginPolicy;
  /**
   * Test harness only (M01-ANDROID): the pinned device trust (attestation roots, signers, revocation snapshot, clock) to use
   * instead of the one built from the validated configuration. It is how the integration suite injects FIXTURE roots; nothing in
   * a request, an environment variable or a build flavour can reach it. main.ts never sets it.
   */
  readonly deviceTrust?: ClientDeviceTrust;
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
      imports: [
        TransactionModule,
        IdempotencyModule,
        AuditModule,
        OutboxModule,
        ShopModule,
        DriverModule,
        // Issue #102: the SMS gateway (queue + gateway API) exists only when bindOtpProvider selected it.
        ...(isSmsGatewayBinding(options.otpProvider) ? [SmsGatewayModule] : []),
      ],
      controllers: [AuthController, ClientAuthController, ClientDeviceController],
      providers: [
        authConfigProvider,
        isSmsGatewayBinding(options.otpProvider)
          ? { provide: OTP_PROVIDER, useExisting: SmsGatewayOtpProvider }
          : { provide: OTP_PROVIDER, useValue: options.otpProvider },
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
        // The pinned device trust: from the validated configuration (CLIENT_AUTH_ANDROID_ENABLED + the four CLIENT_DEVICE_* inputs), or
        // the test injection. Undefined = native gate off: every ANDROID request is a fail-closed 503.
        options.deviceTrust === undefined
          ? {
              provide: CLIENT_DEVICE_TRUST,
              inject: [APP_CONFIG],
              useFactory: (config: AppConfig): ClientDeviceTrust | undefined =>
                config.clientAndroid === undefined ? undefined : trustFromConfig(config.clientAndroid),
            }
          : { provide: CLIENT_DEVICE_TRUST, useValue: options.deviceTrust },
        {
          provide: CLIENT_AUTH_SETTINGS,
          inject: [APP_CONFIG, CLIENT_DEVICE_TRUST],
          useFactory: (config: AppConfig, trust: ClientDeviceTrust | undefined) => clientAuthSettingsFrom(config, trust),
        },
        ClientDeviceRepository,
        ClientDeviceService,
        ClientDeviceProofService,
        ClientDeviceBindingParticipant,
        ClientIdentityReader,
        ClientRegistrationService,
        ClientLoginService,
        ClientSessionAuthority,
        ClientSessionService,
        ClientPasswordService,
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
        // The guard of another module is built there: it needs the native proof service too, AND the native gate settings it
        // decides with (an Optional injection that is not exported resolves to undefined there and silently turns the policy off).
        ClientDeviceProofService,
        CLIENT_AUTH_SETTINGS,
        ClientDeviceRepository,
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
        // Issue #102: the SMS OTP reset reuses the OTP request/verify engine and the proof store.
        VerificationService,
        ProofRepository,
      ],
    };
  }
}
