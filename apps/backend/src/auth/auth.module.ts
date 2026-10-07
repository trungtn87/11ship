import { DynamicModule, Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { OutboxModule } from '../outbox/outbox.module';
import { TransactionModule } from '../transaction/transaction.module';
import { authConfigProvider } from './auth-config.provider';
import { AuthController } from './auth.controller';
import { LoginService } from './login-service';
import { OTP_PROVIDER, OtpProvider } from './otp-provider';
import { Argon2idPasswordHasher, PASSWORD_HASHER } from './password-hasher';
import { ProofRepository } from './proof-repository';
import { RegistrationService } from './registration-service';
import { RoleContextService } from './role-context-service';
import { SessionAuthGuard } from './session-auth.guard';
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
 */
@Module({})
export class AuthModule {
  static register(options: AuthModuleOptions): DynamicModule {
    return {
      module: AuthModule,
      imports: [TransactionModule, IdempotencyModule, AuditModule, OutboxModule],
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
        SessionAuthGuard,
      ],
    };
  }
}
