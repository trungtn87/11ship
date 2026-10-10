import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { AdminAuthConfig } from '../config/admin-auth-config';
import { StartupConfigError } from '../config/startup-config-error';
import { ADMIN_AUTH_CONFIG } from './admin-auth-config.provider';
import { AdminLimitConfigService } from './admin-limit-config-service';

/**
 * Startup gate: before the server listens, the limiter configuration row must exist and agree with the configured key
 * id and secret. A missing row (not initialized), a table that is not migrated, or a different key refuses startup with
 * the NAMES of the two variables only - the application never writes the row and never invents a new bucket namespace.
 */
@Injectable()
export class AdminLimitConfigVerifier implements OnApplicationBootstrap {
  constructor(
    private readonly service: AdminLimitConfigService,
    @Inject(ADMIN_AUTH_CONFIG) private readonly config: AdminAuthConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    let state: Awaited<ReturnType<AdminLimitConfigService['check']>>;
    try {
      state = await this.service.check(this.config.limiter);
    } catch {
      // Unreadable (for example the table is missing because migrations have not run): refuse, naming the variables.
      throw new StartupConfigError(['ADMIN_RATE_LIMIT_HMAC_KEY', 'ADMIN_RATE_LIMIT_KEY_ID']);
    }
    if (state !== 'MATCHES') {
      throw new StartupConfigError(['ADMIN_RATE_LIMIT_HMAC_KEY', 'ADMIN_RATE_LIMIT_KEY_ID']);
    }
  }
}
