import { DynamicModule, Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DriverModule } from '../driver/driver.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { OutboxModule } from '../outbox/outbox.module';
import { ShopModule } from '../shop/shop.module';
import { TransactionModule } from '../transaction/transaction.module';
import { authConfigProvider } from './auth-config.provider';
import { AuthController } from './auth.controller';
import { AdminIdentityParticipant } from './admin-identity-participant';
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
      controllers: [AuthController],
      providers: [
        authConfigProvider,
        { provide: OTP_PROVIDER, useValue: options.otpProvider },
        { provide: PASSWORD_HASHER, useFactory: () => new Argon2idPasswordHasher() },
        VerificationRepository,
        ProofRepository,
        UserRepository,
        SessionRepository,
        VerificationService,
        RegistrationService,
        LoginService,
        SessionService,
        RoleContextService,
        RoleGrantParticipant,
        SessionAuthorizationParticipant,
        SessionAuthGuard,
        AdminIdentityParticipant,
        AdminPasswordVerifier,
      ],
      // A guard named in @UseGuards() of another module is built in THAT module, from its imports, so the
      // SessionService it depends on has to be exported together with the guard.
      exports: [
        SessionAuthGuard,
        SessionService,
        RoleGrantParticipant,
        SessionAuthorizationParticipant,
        AdminIdentityParticipant,
        AdminPasswordVerifier,
      ],
    };
  }
}
