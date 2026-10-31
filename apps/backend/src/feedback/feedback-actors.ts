import { Injectable } from '@nestjs/common';
import { AuthPrincipal } from '../auth/auth-principal';
import { CUSTOMER_ROLE } from '../auth/auth-constants';
import { CustomerProfileRepository } from '../auth/customer-profile-repository';
import { UserRepository } from '../auth/user-repository';
import { ClientSessionAuthority } from '../client-auth/client-session-authority';
import { AppError } from '../common/app-errors';
import { DeliveryActors } from '../delivery/delivery-actors';
import { DriverRow } from '../driver/driver-repository';
import { ShopRow } from '../shop/shop-repository';
import { TransactionContext } from '../transaction/transaction-context';
import { PartyRole } from './feedback-constants';

// Who is calling M11, re-checked INSIDE the business transaction under the locks (the guard of the HTTP layer is only a precheck). The three roles
// reuse what already decides them: the customer by the client session authority + the CUSTOMER role of the ACCOUNT (never the phone number), the shop
// and the Shipper through M07's DeliveryActors (user row, CURRENT session row, role context, then the shop / driver row). Lock order is therefore the
// same as every other command: user, session, then shop or driver.

export type Caller =
  | { readonly role: 'CUSTOMER'; readonly userId: string; readonly displayName: string }
  | { readonly role: 'SHOP'; readonly userId: string; readonly shop: ShopRow }
  | { readonly role: 'SHIPPER'; readonly userId: string; readonly driver: DriverRow };

export type LockMode = 'update' | 'share';

@Injectable()
export class FeedbackActors {
  constructor(
    private readonly authority: ClientSessionAuthority,
    private readonly users: UserRepository,
    private readonly profiles: CustomerProfileRepository,
    private readonly delivery: DeliveryActors,
  ) {}

  async resolve(context: TransactionContext, principal: AuthPrincipal, role: PartyRole, mode: LockMode): Promise<Caller> {
    switch (role) {
      case 'CUSTOMER':
        return this.customer(context, principal, mode);
      case 'SHOP': {
        const caller = mode === 'update' ? await this.delivery.shopWriter(context, principal) : await this.delivery.shopReader(context, principal);
        return { role: 'SHOP', userId: caller.actor.userId, shop: caller.shop };
      }
      case 'SHIPPER': {
        const caller = await this.delivery.shipperOwnFeedback(context, principal, mode);
        return { role: 'SHIPPER', userId: caller.actor.userId, driver: caller.driver };
      }
    }
  }

  /** A customer: the 11Food app, the CUSTOMER role of the account. The name is what the public page shows with a rating (never the phone). */
  async customer(context: TransactionContext, principal: AuthPrincipal, mode: LockMode): Promise<Extract<Caller, { role: 'CUSTOMER' }>> {
    const actor = await this.authority.lock(context, principal, mode);
    if (actor.app !== 'FOOD' || !(await this.users.hasRole(context, actor.userId, CUSTOMER_ROLE))) {
      throw new AppError('ROLE_NOT_AVAILABLE');
    }
    const row = await this.profiles.findProfile(context, actor.userId);
    const name = row?.fullName?.trim();
    return { role: 'CUSTOMER', userId: actor.userId, displayName: name === undefined || name === '' ? 'Khách hàng' : name.slice(0, 80) };
  }
}
