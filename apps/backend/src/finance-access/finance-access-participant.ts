import { Injectable } from '@nestjs/common';
import { LockedActor } from '../admin-provisioning/admin-system-actor';
import { AppError } from '../common/app-errors';
import { isExpiredAt } from '../admin-auth/admin-expiry';
import { TransactionContext } from '../transaction/transaction-context';
import { FinancePermissionKey, GRANTABLE_FINANCE_PERMISSIONS } from './finance-access-constants';
import { FinanceAccessRepository } from './finance-access-repository';

/**
 * What a finance command of the administration asks BEFORE it touches money: "may this actor do this, now?". It is a participant: it opens no
 * transaction and takes no lock but the one grant row, FOR SHARE, so it must be called INSIDE the command's transaction, after the actor's locks
 * (user, membership, factor, session) and after the fresh database clock was read:
 *  - the session must still be live;
 *  - SYSTEM has every right, implicitly (no row is read);
 *  - an ADMIN has the right only when its row is GRANTED at this moment. The row lock FOR SHARE lives to the end of the transaction, so a revocation
 *    (FOR UPDATE) waits for a command that already passed, and a command that starts after the revocation is refused. No right is ever derived from
 *    the app permissions (can_view, can_review_profile) or from the Shipper review rights.
 * Anything else is ADMIN_FORBIDDEN.
 */
@Injectable()
export class FinanceAccessParticipant {
  constructor(private readonly grants: FinanceAccessRepository) {}

  async require(context: TransactionContext, actor: LockedActor, permission: FinancePermissionKey, nowMs: number): Promise<void> {
    if (isExpiredAt(actor.session.expiresAtMs, nowMs)) {
      throw new AppError('ADMIN_SESSION_INVALID');
    }
    if (actor.checked.membership.adminRole === 'SYSTEM') {
      return;
    }
    const row = await this.grants.lockForShare(context, actor.known.userId, permission);
    if (row === undefined || row.state !== 'GRANTED') {
      throw new AppError('ADMIN_FORBIDDEN');
    }
  }

  async has(context:TransactionContext,actor:LockedActor,permission:FinancePermissionKey,nowMs:number):Promise<boolean> {
    if(isExpiredAt(actor.session.expiresAtMs,nowMs))throw new AppError('ADMIN_SESSION_INVALID');
    if(actor.checked.membership.adminRole==='SYSTEM')return true;
    return (await this.grants.lockForShare(context,actor.known.userId,permission))?.state==='GRANTED';
  }

  /** The rights the actor holds now (for the actor's own read). SYSTEM: all of the grantable ones, implicitly. */
  async held(context: TransactionContext, actor: LockedActor): Promise<{ readonly implicit: boolean; readonly permissions: readonly string[] }> {
    if (actor.checked.membership.adminRole === 'SYSTEM') {
      return { implicit: true, permissions: GRANTABLE_FINANCE_PERMISSIONS };
    }
    const rows = await this.grants.listForUser(context, actor.known.userId);
    return { implicit: false, permissions: rows.filter((row) => row.state === 'GRANTED').map((row) => row.permissionKey) };
  }
}
