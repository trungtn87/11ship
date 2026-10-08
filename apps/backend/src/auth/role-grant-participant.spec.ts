import { describe, expect, it, jest } from '@jest/globals';
import { AppError, TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { RoleGrantParticipant, GrantableRole } from './role-grant-participant';
import { UserRepository } from './user-repository';

// The narrow participant onboarding coordinators use to hold the user lock and grant a role (A2S: SHOP, A2D:
// DRIVER). It must never become a way to grant any other role.

const CONTEXT = {} as TransactionContext;
const USER_ID = '11111111-1111-4111-8111-111111111111';

function rig(user: { status: string } | undefined = { status: 'ACTIVE' }) {
  const grantRole = jest.fn<(context: TransactionContext, userId: string, role: string) => Promise<boolean>>(async () => true);
  const lockById = jest.fn<(context: TransactionContext, userId: string) => Promise<{ status: string } | undefined>>(async () => user);
  const participant = new RoleGrantParticipant({ grantRole, lockById } as unknown as UserRepository);
  return { participant, grantRole, lockById };
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

describe('RoleGrantParticipant.lockActiveUser', () => {
  it('passes for an ACTIVE user', async () => {
    const { participant, lockById } = rig({ status: 'ACTIVE' });
    await expect(participant.lockActiveUser(CONTEXT, USER_ID)).resolves.toBeUndefined();
    expect(lockById).toHaveBeenCalledWith(CONTEXT, USER_ID);
  });

  it('a missing user is SESSION_INVALID and a DISABLED user is ACCOUNT_DISABLED', async () => {
    const missing = await rig(undefined).participant.lockActiveUser(CONTEXT, USER_ID).catch((error: unknown) => error);
    expect(missing).toBeInstanceOf(AppError);
    expect((missing as AppError).code).toBe('SESSION_INVALID');
    const disabled = await rig({ status: 'DISABLED' }).participant.lockActiveUser(CONTEXT, USER_ID).catch((error: unknown) => error);
    expect((disabled as AppError).code).toBe('ACCOUNT_DISABLED');
  });
});
