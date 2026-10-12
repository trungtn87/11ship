import { Injectable } from '@nestjs/common';
import { CUSTOMER_ROLE } from '../auth/auth-constants';
import { AuthPrincipal } from '../auth/auth-principal';
import { UserRepository } from '../auth/user-repository';
import { ClientSessionAuthority } from '../client-auth/client-session-authority';
import { AppError } from '../common/app-errors';
import { ServiceAreaRepository } from '../shop/service-area-repository';
import { TransactionManager } from '../transaction/transaction-manager';

/** One choice of GET /v1/onboarding/shop/service-areas. Exactly these two fields: no code, no status, no geometry. */
export interface ServiceAreaChoice {
  readonly service_area_id: string;
  readonly name: string;
}

/**
 * Read side of the area choice in Shop onboarding: the ACTIVE service areas a person can put on a shop draft, so a client
 * lists real identifiers instead of asking for one to be typed. One read transaction and nothing else: it writes no audit
 * row, no outbox event and no idempotency record, and it takes no lock on an area (a deactivation between this read and a
 * save is caught by the FOR SHARE re-check that save and complete already make).
 *
 * The caller is the authenticated principal only. The authorization that counts runs inside the transaction through the
 * client session authority (user row, CURRENT session row FOR SHARE, fresh database clock, client-session and platform gates,
 * ordinary account; the account origin policy refuses an unverified test account unless that test mode is on), and then
 * the account must hold the CUSTOMER role.
 */
@Injectable()
export class ShopServiceAreaQueryService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly authority: ClientSessionAuthority,
    private readonly users: UserRepository,
    private readonly serviceAreas: ServiceAreaRepository,
  ) {}

  async activeChoices(principal: AuthPrincipal): Promise<ServiceAreaChoice[]> {
    return this.transactions.withTransaction(async (context) => {
      const actor = await this.authority.lock(context, principal, 'share');
      if (!(await this.users.hasRole(context, actor.userId, CUSTOMER_ROLE))) {
        throw new AppError('ROLE_NOT_AVAILABLE');
      }
      const rows = await this.serviceAreas.listActive(context);
      return rows.map((row) => ({ service_area_id: row.serviceAreaId, name: row.name }));
    });
  }
}
