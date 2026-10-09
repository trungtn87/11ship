import { describe, expect, it, jest } from '@jest/globals';
import { TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { AdminInvitationParticipant, CreateInvitationInput, MAX_INVITATION_TTL_SECONDS } from './admin-invitation-participant';
import { AdminInvitationRepository, InvitationPermission } from './admin-invitation-repository';

// M01-D-ADMIN-1A participant, with a recording repository: input is refused BEFORE any statement, the write order is
// insert -> every permission -> seal, and a terminal transition passes exactly the columns its status allows.

const CONTEXT = {} as TransactionContext;
const ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const ADMIN_ID = '33333333-3333-4333-8333-333333333333';
const VIEW_ONLY: InvitationPermission = { app: 'CUSTOMER', canView: true, canReviewProfile: false, canLock: false };

function input(overrides: Partial<CreateInvitationInput> = {}): CreateInvitationInput {
  return {
    invitationId: ID,
    generationId: OTHER_ID,
    phoneNormalized: '+84911111111',
    fullName: 'Nguyen Van A',
    note: null,
    tokenDigest: 'a'.repeat(64),
    createdBy: ADMIN_ID,
    ttlSeconds: 72 * 3600,
    permissions: [VIEW_ONLY],
    ...overrides,
  };
}

function rig() {
  const calls: string[] = [];
  const repository = {
    insert: jest.fn<(context: TransactionContext, row: object) => Promise<void>>(async () => void calls.push('insert')),
    insertPermission: jest.fn<(context: TransactionContext, id: string, permission: InvitationPermission) => Promise<void>>(
      async (_context, _id, permission) => void calls.push(`permission:${permission.app}`),
    ),
    seal: jest.fn<(context: TransactionContext, id: string) => Promise<void>>(async () => void calls.push('seal')),
    lock: jest.fn(),
    lockPendingByPhone: jest.fn(),
    transition: jest.fn<
      (
        context: TransactionContext,
        id: string,
        version: number,
        to: string,
        acceptedUserId: string | null,
        successorId: string | null,
      ) => Promise<number | undefined>
    >(async () => 2),
  };
  return { calls, repository, participant: new AdminInvitationParticipant(repository as unknown as AdminInvitationRepository) };
}

async function programmingError(run: () => Promise<unknown>): Promise<TechnicalError> {
  const failure = await run().catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(TechnicalError);
  expect((failure as TechnicalError).kind).toBe('internal');
  return failure as TechnicalError;
}

describe('AdminInvitationParticipant.create', () => {
  it('writes the invitation, then every permission, then seals - in that order, on the caller context', async () => {
    const { calls, repository, participant } = rig();
    await participant.create(
      CONTEXT,
      input({
        permissions: [
          VIEW_ONLY,
          { app: 'SHOP', canView: true, canReviewProfile: true, canLock: true },
          { app: 'DRIVER', canView: true, canReviewProfile: false, canLock: true },
        ],
      }),
    );
    expect(calls).toEqual(['insert', 'permission:CUSTOMER', 'permission:SHOP', 'permission:DRIVER', 'seal']);
    expect(repository.insert).toHaveBeenCalledWith(CONTEXT, expect.not.objectContaining({ permissions: expect.anything() }));
    expect(repository.seal).toHaveBeenCalledWith(CONTEXT, ID);
  });

  it.each<[string, InvitationPermission[]]>([
    ['REVIEW without VIEW', [VIEW_ONLY, { app: 'SHOP', canView: false, canReviewProfile: true, canLock: false }]],
    ['LOCK without VIEW', [VIEW_ONLY, { app: 'DRIVER', canView: false, canReviewProfile: false, canLock: true }]],
    ['CUSTOMER with REVIEW', [{ app: 'CUSTOMER', canView: true, canReviewProfile: true, canLock: false }]],
    ['no permission at all', []],
    ['no VIEW anywhere', [{ app: 'SHOP', canView: false, canReviewProfile: false, canLock: false }]],
    ['the same app twice', [VIEW_ONLY, VIEW_ONLY]],
    ['an unknown app', [{ app: 'ADMIN' as 'CUSTOMER', canView: true, canReviewProfile: false, canLock: false }]],
  ])('refuses %s before any statement', async (_label, permissions) => {
    const { calls, participant } = rig();
    await programmingError(() => participant.create(CONTEXT, input({ permissions })));
    expect(calls).toEqual([]);
  });

  it.each([0, 3599, MAX_INVITATION_TTL_SECONDS + 1, 1.5, Number.NaN])('refuses a lifetime of %p seconds (outside 1..168 hours)', async (ttlSeconds) => {
    const { calls, participant } = rig();
    await programmingError(() => participant.create(CONTEXT, input({ ttlSeconds })));
    expect(calls).toEqual([]);
  });

  it('accepts exactly 1 hour and exactly 168 hours', async () => {
    const { calls, participant } = rig();
    await participant.create(CONTEXT, input({ ttlSeconds: 3600 }));
    await participant.create(CONTEXT, input({ ttlSeconds: MAX_INVITATION_TTL_SECONDS }));
    expect(calls.filter((call) => call === 'seal')).toHaveLength(2);
  });

  it('does not seal when a permission write fails (the caller transaction rolls everything back)', async () => {
    const { calls, repository, participant } = rig();
    repository.insertPermission.mockRejectedValueOnce(new Error('boom'));
    await expect(participant.create(CONTEXT, input())).rejects.toThrow('boom');
    expect(calls).toEqual(['insert']);
  });
});

describe('AdminInvitationParticipant.transition', () => {
  it.each([
    [{ to: 'ACCEPTED', acceptedUserId: ADMIN_ID } as const, ADMIN_ID, null],
    [{ to: 'SUPERSEDED', successorId: OTHER_ID } as const, null, OTHER_ID],
    [{ to: 'REVOKED' } as const, null, null],
    [{ to: 'EXPIRED' } as const, null, null],
    [{ to: 'PHONE_CONFLICT' } as const, null, null],
  ])('passes only the columns %j allows', async (change, accepted, successor) => {
    const { repository, participant } = rig();
    await expect(participant.transition(CONTEXT, ID, 1, change)).resolves.toBe(2);
    expect(repository.transition).toHaveBeenCalledWith(CONTEXT, ID, 1, change.to, accepted, successor);
  });

  it('returns undefined when the invitation is no longer that PENDING version', async () => {
    const { repository, participant } = rig();
    repository.transition.mockResolvedValueOnce(undefined);
    await expect(participant.transition(CONTEXT, ID, 1, { to: 'REVOKED' })).resolves.toBeUndefined();
  });

  it.each([
    ['PENDING (never a target)', { to: 'PENDING' }, 1],
    ['SUPERSEDED pointing at itself', { to: 'SUPERSEDED', successorId: ID }, 1],
    ['SUPERSEDED without a successor', { to: 'SUPERSEDED', successorId: '' }, 1],
    ['ACCEPTED without a user', { to: 'ACCEPTED', acceptedUserId: '' }, 1],
    ['version 0', { to: 'REVOKED' }, 0],
    ['a fractional version', { to: 'REVOKED' }, 1.5],
  ])('refuses %s as a programming error and writes nothing', async (_label, change, version) => {
    const { repository, participant } = rig();
    await programmingError(() => participant.transition(CONTEXT, ID, version, change as never));
    expect(repository.transition).not.toHaveBeenCalled();
  });
});
