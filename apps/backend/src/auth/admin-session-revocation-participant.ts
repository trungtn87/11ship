import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../transaction/transaction-context';
import { SessionRepository } from './session-repository';

/**
 * Narrow, Auth-owned access to app.sessions for the local SYSTEM recovery (M01-RESET): revoking every app session of one
 * account. A PARTICIPANT: it runs in the caller's transaction (the caller holds the user row FOR UPDATE) and decides no right.
 */
@Injectable()
export class AdminSessionRevocationParticipant {
  constructor(private readonly sessions: SessionRepository = new SessionRepository()) {}

  async revokeAllForUser(context: TransactionContext, userId: string): Promise<number> {
    return this.sessions.revokeAllForUser(context, userId);
  }
}
