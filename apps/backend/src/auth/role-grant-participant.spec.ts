import { describe, expect, it, jest } from '@jest/globals';
import { TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { RoleGrantParticipant, GrantableRole } from './role-grant-participant';
import { UserRepository } from './user-repository';

// The narrow participant onboarding coordinators use to grant a role (A2S: SHOP, A2D: DRIVER). It must never
// become a way to grant any other role. Authorization of the caller is SessionAuthorizationParticipant's job.

const CONTEXT = {} as TransactionContext;
const USER_ID = '11111111-1111-4111-8111-111111111111';

function rig() {
  const grantRole = jest.fn<(context: TransactionContext, userId: string, role: string) => Promise<boolean>>(async () => true);
  const participant = new RoleGrantParticipant({ grantRole } as unknown as UserRepository);
  return { participant, grantRole };
}

describe('RoleGrantParticipant.grant', () => {
  it.each<GrantableRole>(['SHOP', 'DRIVER'])('grants %s through the user repository inside the caller transaction', async (role) => {
    const { participant, grantRole } = rig();
    await expect(participant.grant(CONTEXT, USER_ID, role)).resolves.toBe(true);
    expect(grantRole).toHaveBeenCalledWith(CONTEXT, USER_ID, role);
  });

  it('reports false when the user already held the role (idempotent)', async () => {
    const { participant, grantRole } = rig();
    grantRole.mockResolvedValueOnce(false);
    await expect(participant.grant(CONTEXT, USER_ID, 'DRIVER')).resolves.toBe(false);
  });

  it.each(['ADMIN', 'SYSTEM', 'driver', 'shop', '', 'DRIVER '])('refuses %p as a programming error and writes nothing', async (role) => {
    const { participant, grantRole } = rig();
    const failure = await participant.grant(CONTEXT, USER_ID, role as GrantableRole).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TechnicalError);
    expect((failure as TechnicalError).kind).toBe('internal');
    expect(grantRole).not.toHaveBeenCalled();
  });
});
