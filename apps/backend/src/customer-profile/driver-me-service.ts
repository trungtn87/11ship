import { Injectable } from '@nestjs/common';
import { AuthPrincipal } from '../auth/auth-principal';
import { ClientSessionAuthority } from '../client-auth/client-session-authority';
import { DriverRepository } from '../driver/driver-repository';
import { DriverStatus, DriverType } from '../driver/driver-types';
import { TransactionManager } from '../transaction/transaction-manager';

/** The `data` of GET /v1/driver/me when a profile exists: stored values, stored enums (PENDING stays PENDING here). */
export type DriverMeView = {
  driver_id: string;
  user_id: string;
  full_name: string;
  plate_number: string | null;
  driver_type: DriverType;
  status: DriverStatus;
  accepting_deliveries: boolean;
  version: number;
};

/**
 * Own driver profile read (M01.05): GET /v1/driver/me. Identity is the principal only. One read transaction through the
 * M01.04 authority (user FOR SHARE, CURRENT session FOR SHARE, ordinary enabled account, platform gate), then the user's own
 * driver row. It needs neither the DRIVER role nor the DRIVER active context, so a PENDING, SUSPENDED or CLOSED driver reads
 * its own status from either app; reading grants nothing (no role, no context, no right to take deliveries). It writes
 * nothing: no audit, no outbox, no idempotency record. A user without a driver profile gets null.
 */
@Injectable()
export class DriverMeService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly authority: ClientSessionAuthority,
    private readonly drivers: DriverRepository,
  ) {}

  async read(principal: AuthPrincipal): Promise<DriverMeView | null> {
    return this.transactions.withTransaction(async (context) => {
      const actor = await this.authority.lock(context, principal, 'share');
      const driver = await this.drivers.findByUserId(context, actor.userId);
      if (driver === undefined) {
        return null;
      }
      return {
        driver_id: driver.driverId,
        user_id: driver.userId,
        full_name: driver.fullName,
        plate_number: driver.plateNumber,
        driver_type: driver.driverType,
        status: driver.status,
        accepting_deliveries: driver.acceptingDeliveries,
        version: driver.version,
      };
    });
  }
}
