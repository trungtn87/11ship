import { Injectable } from '@nestjs/common';
import { AuthPrincipal } from '../auth/auth-principal';
import { UserRepository } from '../auth/user-repository';
import { ClientActor, ClientSessionAuthority } from '../client-auth/client-session-authority';
import { AppError } from '../common/app-errors';
import { DriverRepository, DriverRow } from '../driver/driver-repository';
import { TransactionContext } from '../transaction/transaction-context';

/**
 * Who the caller of a Shipper wallet route is, decided INSIDE the route's transaction (M04-C). The 11Ship app, the DRIVER hat on the locked session and the
 * DRIVER role still held now are required; a LOCKED driver is served here too, wallet only (Owner decision 2026-10-14: balance, history and withdrawal
 * requests stay available). Identity is the authenticated principal only: no route takes a driver, wallet or user id from the client.
 *  - reader: shared locks on the user and session; the Shipper profile is read, not locked. A CLOSED profile can still read its own history.
 *  - writer: user row, CURRENT session row, then the driver row FOR UPDATE (the guard root of everything money-related). A CLOSED profile cannot withdraw.
 */
@Injectable()
export class DriverWalletAccess {
  constructor(
    private readonly authority: ClientSessionAuthority,
    private readonly users: UserRepository,
    private readonly drivers: DriverRepository,
  ) {}

  async reader(context: TransactionContext, principal: AuthPrincipal): Promise<{ actor: ClientActor; driver: DriverRow }> {
    const actor = await this.authority.lock(context, principal, 'share', { allowLockedDriver: true });
    await this.#assertShipDriver(context, actor);
    const driver = await this.drivers.findByUserId(context, actor.userId);
    if (driver === undefined) {
      throw new AppError('DRIVER_NOT_FOUND');
    }
    return { actor, driver };
  }

  async writer(context: TransactionContext, principal: AuthPrincipal): Promise<{ actor: ClientActor; driver: DriverRow }> {
    const actor = await this.authority.lock(context, principal, 'update', { allowLockedDriver: true });
    await this.#assertShipDriver(context, actor);
    const driver = await this.drivers.lockByUserId(context, actor.userId);
    if (driver === undefined) {
      throw new AppError('DRIVER_NOT_FOUND');
    }
    if (driver.status === 'CLOSED') {
      throw new AppError('DRIVER_STATE_CONFLICT');
    }
    return { actor, driver };
  }

  async #assertShipDriver(context: TransactionContext, actor: ClientActor): Promise<void> {
    if (actor.app !== 'SHIP' || actor.storedActiveRole !== 'DRIVER') {
      throw new AppError('ROLE_NOT_AVAILABLE');
    }
    if (!(await this.users.hasRole(context, actor.userId, 'DRIVER'))) {
      throw new AppError('ROLE_NOT_AVAILABLE');
    }
  }
}
