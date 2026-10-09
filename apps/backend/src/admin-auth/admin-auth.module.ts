import { DynamicModule, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { AdminAuthConfig } from '../config/admin-auth-config';
import { requireKeyring } from '../idempotency/idempotency.module';
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
@Module({})
export class AdminAuthModule implements NestModule {
  static register(auth: DynamicModule): DynamicModule {
    return {
      module: AdminAuthModule,
      imports: [auth, TransactionModule, AuditModule],
      controllers: [AdminAuthController],
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
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(noStoreMiddleware).forRoutes(AdminAuthController);
  }
}
