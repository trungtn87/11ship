import { DynamicModule, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ActivationOtpProvider, ACTIVATION_OTP_PROVIDER } from '../admin-activation/activation-otp-provider';
import { adminActivationConfigProvider } from '../admin-activation/admin-activation-config.provider';
import { AdminActivationInvalidator } from '../admin-activation/admin-activation-invalidator';
import { AdminActivationLimiter } from '../admin-activation/admin-activation-limiter';
import { AdminActivationRepository } from '../admin-activation/admin-activation-repository';
import { AdminActivationService } from '../admin-activation/admin-activation-service';
import { AdminActivationController } from '../admin-activation/admin-activation.controller';
import { AdminInvitationParticipant } from '../admin-invitations/admin-invitation-participant';
import { AdminInvitationRepository } from '../admin-invitations/admin-invitation-repository';
import { AdminInvitationReader } from '../admin-provisioning/admin-invitation-reader';
import { AdminInvitationService } from '../admin-provisioning/admin-invitation-service';
import { AdminOperationRepository } from '../admin-provisioning/admin-operation-repository';
import { AdminOperationService } from '../admin-provisioning/admin-operation-service';
import { AdminProvisioningController } from '../admin-provisioning/admin-provisioning.controller';
import { AdminSystemActor } from '../admin-provisioning/admin-system-actor';
import { AuditModule } from '../audit/audit.module';
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
/** Present only when ADMIN_ACTIVATION_ENABLED=true and the OTP provider was bound explicitly (M01-D-ADMIN-1C). */
export interface AdminActivationWiring {
  readonly otpProvider: ActivationOtpProvider;
}

@Module({})
export class AdminAuthModule implements NestModule {
  static register(auth: DynamicModule, activation?: AdminActivationWiring): DynamicModule {
    return {
      module: AdminAuthModule,
      imports: [auth, TransactionModule, AuditModule, IdempotencyModule],
      // M01-D-ADMIN-1B: the SYSTEM invitation routes under /v1/admin ride on the same, conditionally wired module.
      // M01-D-ADMIN-1C: the activation routes under /v1/admin-activation exist only when explicitly enabled.
      controllers: [AdminAuthController, AdminProvisioningController, ...(activation === undefined ? [] : [AdminActivationController])],
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
        // The 1B section 8.8 hook is always present (1B calls it); it is a no-op when no activation attempt exists.
        AdminActivationRepository,
        AdminActivationInvalidator,
        ...(activation === undefined
          ? []
          : [
              { provide: ACTIVATION_OTP_PROVIDER, useValue: activation.otpProvider },
              adminActivationConfigProvider,
              AdminActivationLimiter,
              AdminActivationService,
            ]),
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(noStoreMiddleware).forRoutes(AdminAuthController, AdminProvisioningController);
    // The activation transport headers are an application-level middleware in configureApp (app.setup.ts): it must precede
    // the body parser, which module middleware does not.
  }
}
