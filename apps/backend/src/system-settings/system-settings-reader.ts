import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { SystemSettingsRepository } from './system-settings-repository';
import { OTP_PASSWORD_RESET_ENABLED, OTP_REGISTRATION_ENABLED, SystemSettingKey } from './system-settings-constants';

/**
 * Runtime read of the SYSTEM settings by the application (registration, password reset). It reads the database every time:
 * there is no cache and no restart, so a change by SYSTEM is in effect at the next request. A read that fails is an error, never
 * a guess: the callers refuse rather than assume a value.
 */
@Injectable()
export class SystemSettingsReader {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly repository: SystemSettingsRepository,
  ) {}

  isEnabled(key: SystemSettingKey): Promise<boolean> {
    return this.transactions.withTransaction((context) => this.repository.readOne(context, key));
  }

  /** Inside a caller's transaction (the value is then one with the rest of that transaction's reads). */
  isEnabledIn(context: TransactionContext, key: SystemSettingKey): Promise<boolean> {
    return this.repository.readOne(context, key);
  }

  registrationOtpRequired(): Promise<boolean> {
    return this.isEnabled(OTP_REGISTRATION_ENABLED);
  }

  passwordResetOtpEnabled(): Promise<boolean> {
    return this.isEnabled(OTP_PASSWORD_RESET_ENABLED);
  }
}
