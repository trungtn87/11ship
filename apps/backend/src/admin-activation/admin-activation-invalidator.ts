import { Injectable } from '@nestjs/common';
import { AuditWriter } from '../audit/audit-writer';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { TransactionContext } from '../transaction/transaction-context';
import { ACTIVATION_AUDIT_ACTIONS, RESOURCE_ATTEMPT, RESOURCE_CHALLENGE } from './admin-activation-constants';
import { AdminActivationRepository } from './admin-activation-repository';

/**
 * The hook of M01-D-ADMIN-1B section 8.8, implemented by 1C: `invalidateActivationFor(context, invitationId)`. 1B calls
 * it INSIDE its reissue / revoke / expire-on-create transaction, after it holds L3 (phone), L8 (invitation, X) and L9
 * (operation). The hook then takes L9a (the live attempt, FOR UPDATE) and L9b (its live challenge, FOR UPDATE) - the
 * order of the contract, section 9 - and ends them: the attempt becomes INVALIDATED(INVITATION_CLOSED) (and loses its
 * password hash and sealed secret), the challenge INVALIDATED, with one audit row in the same transaction. A closed
 * invitation therefore can never be completed: a concurrent complete either already committed (then the invitation is
 * ACCEPTED and 1B refuses first) or waits on L8 and finds the invitation closed.
 *
 * It opens no transaction, takes no lock above L9b and is a no-op when the invitation has no live attempt.
 */
@Injectable()
export class AdminActivationInvalidator {
  constructor(
    private readonly repo: AdminActivationRepository,
    private readonly audit: AuditWriter,
  ) {}

  async invalidateActivationFor(
    context: TransactionContext,
    invitationId: string,
    meta: { readonly requestId: string; readonly actorId: string },
  ): Promise<void> {
    const attempt = await this.repo.lockLiveAttempt(context, invitationId);
    if (attempt === undefined) {
      return;
    }
    const challenge = await this.repo.lockLiveChallenge(context, attempt.attemptId);
    // `T` is read once, after the last lock this hook takes.
    const nowMs = await freshClockMs(context);
    if (challenge !== undefined) {
      await this.repo.invalidateChallenge(context, { challengeId: challenge.challengeId, atMs: nowMs });
      await this.audit.append(context, {
        requestId: meta.requestId,
        actorType: 'SYSTEM',
        actorId: meta.actorId,
        action: ACTIVATION_AUDIT_ACTIONS.attemptInvalidated,
        resourceType: RESOURCE_CHALLENGE,
        resourceId: challenge.challengeId,
        outcome: 'SUCCESS',
        metadata: { attempt_id: attempt.attemptId, to_state: 'INVALIDATED', reason: 'INVITATION_CLOSED' },
      });
    }
    await this.repo.invalidateAttempt(context, { attemptId: attempt.attemptId, reason: 'INVITATION_CLOSED', atMs: nowMs });
    await this.audit.append(context, {
      requestId: meta.requestId,
      actorType: 'SYSTEM',
      actorId: meta.actorId,
      action: ACTIVATION_AUDIT_ACTIONS.attemptInvalidated,
      resourceType: RESOURCE_ATTEMPT,
      resourceId: attempt.attemptId,
      outcome: 'SUCCESS',
      metadata: { invitation_id: invitationId, from_state: attempt.status, to_state: 'INVALIDATED', reason: 'INVITATION_CLOSED' },
    });
  }
}
