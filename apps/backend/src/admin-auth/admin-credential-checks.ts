import { Injectable } from '@nestjs/common';
import { AdminIdentity, AdminIdentityParticipant } from '../auth/admin-identity-participant';
import { TransactionContext } from '../transaction/transaction-context';
import { AdminCrypto } from './admin-crypto';
import { AdminMembershipRepository, MembershipRow } from './admin-membership-repository';

/** What a credential (preauth step or session) was issued against. */
export interface CredentialSnapshot {
  readonly userId: string;
  readonly passwordBinding: string;
  readonly passwordKeyId: string;
  readonly membershipVersion: number;
}

export interface CheckedAdmin {
  readonly identity: AdminIdentity;
  readonly membership: MembershipRow;
}

/**
 * The authorization recheck that every state read and every mutation repeats UNDER LOCKS (user, then membership; the
 * factor and the credential are locked by the caller after this, which is the contract's order): the account is still
 * ACTIVE, its current password still matches the binding stored with the credential (recomputed with the key the
 * binding was stored with), and the membership is still ACTIVE at the version the credential was issued for.
 * Readers take shared locks, writers exclusive ones.
 */
@Injectable()
export class AdminCredentialChecks {
  constructor(
    private readonly identities: AdminIdentityParticipant,
    private readonly memberships: AdminMembershipRepository,
    private readonly crypto: AdminCrypto,
  ) {}

  async lockAndCheck(
    context: TransactionContext,
    snapshot: CredentialSnapshot,
    mode: 'write' | 'read',
  ): Promise<CheckedAdmin | undefined> {
    const identity =
      mode === 'write'
        ? await this.identities.lockById(context, snapshot.userId)
        : await this.identities.lockByIdShared(context, snapshot.userId);
    if (identity === undefined || identity.status !== 'ACTIVE') {
      return undefined;
    }
    const bindingOk = this.crypto.passwordBindingMatches({
      keyId: snapshot.passwordKeyId,
      userId: identity.userId,
      passwordHash: identity.passwordHash,
      stored: snapshot.passwordBinding,
    });
    if (!bindingOk) {
      return undefined;
    }
    const membership =
      mode === 'write'
        ? await this.memberships.lock(context, snapshot.userId)
        : await this.memberships.lockShared(context, snapshot.userId);
    if (
      membership === undefined ||
      membership.status !== 'ACTIVE' ||
      membership.version !== snapshot.membershipVersion
    ) {
      return undefined;
    }
    return { identity, membership };
  }
}
