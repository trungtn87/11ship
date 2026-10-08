import { describe, expect, it } from '@jest/globals';
import { AppError } from '../common/app-errors';
import { codeOf as sourceOf } from '../shared/source-scan.fixture';
import { fakeContext } from './auth-fakes.fixture';
import { SessionActor, SessionAuthorizationParticipant } from './session-authorization-participant';
import { LockedSession, SessionRepository, SharedLockedSession } from './session-repository';
import { UserRepository, UserRow } from './user-repository';

// Post-merge repair, section 1: the participant that re-authorizes the caller INSIDE a business transaction.
// These specs pin ORDER (user, then session, then the database clock), PRECEDENCE of the error codes and the
// equality rule of expiry. Real locking and real waits are proven against PostgreSQL in
// tests/integration/onboarding-session-authorization.int.spec.ts.

const NOW = 5_000_000;
const ACTOR: SessionActor = {
  userId: '523e4567-e89b-42d3-a456-426614174000',
  sessionId: '623e4567-e89b-42d3-a456-426614174000',
};
const OTHER_USER = '723e4567-e89b-42d3-a456-426614174000';
const USER: UserRow = { userId: ACTOR.userId, phoneNormalized: '+84987654321', passwordHash: 'h', status: 'ACTIVE' };
const SESSION: SharedLockedSession = {
  sessionId: ACTOR.sessionId,
  userId: ACTOR.userId,
  activeRole: null,
  revoked: false,
  expiresAtMs: NOW + 60_000,
};

function rig(
  options: { user?: UserRow | undefined; session?: SharedLockedSession | undefined; roles?: readonly string[] } = {},
) {
  const events: string[] = [];
  const user = 'user' in options ? options.user : USER;
  const session = 'session' in options ? options.session : SESSION;
  const users = {
    lockById: async () => {
      events.push('user.update');
      return user;
    },
    lockByIdForShare: async () => {
      events.push('user.share');
      return user;
    },
    hasRole: async (_c: unknown, _u: string, role: string) => {
      events.push(`role.check:${role}`);
      return (options.roles ?? []).includes(role);
    },
  } as unknown as UserRepository;
  const sessions = {
    lockById: async (): Promise<LockedSession | undefined> => {
      events.push('session.update');
      return session;
    },
    lockByIdForShare: async () => {
      events.push('session.share');
      return session;
    },
  } as unknown as SessionRepository;
  return { participant: new SessionAuthorizationParticipant(users, sessions), events };
}

async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof AppError ? error.code : `OTHER:${String(error)}`;
  }
  return 'OK';
}

describe('SessionAuthorizationParticipant.lockAuthorizedActor (writers)', () => {
  it('locks the user FOR UPDATE, then the session FOR UPDATE, and only then reads the database clock', async () => {
    const { participant, events } = rig();
    const context = fakeContext(NOW, events);
    await participant.lockAuthorizedActor(context, ACTOR);
    expect(events).toEqual(['user.update', 'session.update', 'clock']);
  });

  it('refuses a missing user with SESSION_INVALID and never reaches the session lock', async () => {
    const { participant, events } = rig({ user: undefined });
    expect(await codeOf(() => participant.lockAuthorizedActor(fakeContext(NOW, events), ACTOR))).toBe('SESSION_INVALID');
    expect(events).toEqual(['user.update']);
  });

  it('a missing session and a session of ANOTHER user are the same SESSION_INVALID (no cross-user disclosure)', async () => {
    const missing = rig({ session: undefined });
    expect(await codeOf(() => missing.participant.lockAuthorizedActor(fakeContext(NOW, missing.events), ACTOR))).toBe(
      'SESSION_INVALID',
    );
    const foreign = rig({ session: { ...SESSION, userId: OTHER_USER } });
    const failure = await foreign.participant
      .lockAuthorizedActor(fakeContext(NOW, foreign.events), ACTOR)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AppError);
    expect((failure as AppError).code).toBe('SESSION_INVALID');
    // The clock is never read for a session that is not the caller's: nothing about it is examined further.
    expect(foreign.events).toEqual(['user.update', 'session.update']);
  });

  it('refuses a revoked session with SESSION_REVOKED', async () => {
    const { participant, events } = rig({ session: { ...SESSION, revoked: true } });
    expect(await codeOf(() => participant.lockAuthorizedActor(fakeContext(NOW, events), ACTOR))).toBe('SESSION_REVOKED');
  });

  it('expiry is decided by the FRESH database clock and equality counts as expired', async () => {
    const equal = rig({ session: { ...SESSION, expiresAtMs: NOW } });
    expect(await codeOf(() => equal.participant.lockAuthorizedActor(fakeContext(NOW, equal.events), ACTOR))).toBe(
      'SESSION_EXPIRED',
    );
    const before = rig({ session: { ...SESSION, expiresAtMs: NOW - 1 } });
    expect(await codeOf(() => before.participant.lockAuthorizedActor(fakeContext(NOW, before.events), ACTOR))).toBe(
      'SESSION_EXPIRED',
    );
    const after = rig({ session: { ...SESSION, expiresAtMs: NOW + 1 } });
    expect(await codeOf(() => after.participant.lockAuthorizedActor(fakeContext(NOW, after.events), ACTOR))).toBe('OK');
  });

  it('refuses a DISABLED user with ACCOUNT_DISABLED', async () => {
    const { participant, events } = rig({ user: { ...USER, status: 'DISABLED' } });
    expect(await codeOf(() => participant.lockAuthorizedActor(fakeContext(NOW, events), ACTOR))).toBe('ACCOUNT_DISABLED');
  });

  it('error precedence for an existing matching session: SESSION_REVOKED, then SESSION_EXPIRED, then ACCOUNT_DISABLED', async () => {
    const disabled: UserRow = { ...USER, status: 'DISABLED' };
    const all = rig({ user: disabled, session: { ...SESSION, revoked: true, expiresAtMs: NOW - 1 } });
    expect(await codeOf(() => all.participant.lockAuthorizedActor(fakeContext(NOW, all.events), ACTOR))).toBe(
      'SESSION_REVOKED',
    );
    const expiredAndDisabled = rig({ user: disabled, session: { ...SESSION, expiresAtMs: NOW - 1 } });
    expect(
      await codeOf(() =>
        expiredAndDisabled.participant.lockAuthorizedActor(fakeContext(NOW, expiredAndDisabled.events), ACTOR),
      ),
    ).toBe('SESSION_EXPIRED');
    const onlyDisabled = rig({ user: disabled });
    expect(
      await codeOf(() => onlyDisabled.participant.lockAuthorizedActor(fakeContext(NOW, onlyDisabled.events), ACTOR)),
    ).toBe('ACCOUNT_DISABLED');
  });

  it('requires no role: a roleless session passes', async () => {
    const { participant, events } = rig({ session: { ...SESSION, activeRole: null } });
    expect(await codeOf(() => participant.lockAuthorizedActor(fakeContext(NOW, events), ACTOR))).toBe('OK');
  });

  it.each([
    ['not a uuid', { userId: 'x', sessionId: ACTOR.sessionId }],
    ['empty session id', { userId: ACTOR.userId, sessionId: '' }],
    ['upper-case uuid', { userId: ACTOR.userId.toUpperCase(), sessionId: ACTOR.sessionId }],
    ['nil uuid', { userId: '00000000-0000-0000-0000-000000000000', sessionId: ACTOR.sessionId }],
  ])('a malformed actor (%s) is SESSION_INVALID before any SQL runs', async (_label, actor) => {
    const { participant, events } = rig();
    expect(await codeOf(() => participant.lockAuthorizedActor(fakeContext(NOW, events), actor))).toBe('SESSION_INVALID');
    expect(events).toEqual([]);
  });
});

describe('SessionAuthorizationParticipant.lockAuthorizedActorShared (readers)', () => {
  it('locks the user FOR SHARE, then the session FOR SHARE, then reads the clock; never a FOR UPDATE lock', async () => {
    const { participant, events } = rig();
    await participant.lockAuthorizedActorShared(fakeContext(NOW, events), ACTOR);
    expect(events).toEqual(['user.share', 'session.share', 'clock']);
  });

  it('returns the CURRENT active role of the locked session row', async () => {
    const { participant, events } = rig({ session: { ...SESSION, activeRole: 'DRIVER' } });
    await expect(participant.lockAuthorizedActorShared(fakeContext(NOW, events), ACTOR)).resolves.toEqual({
      activeRole: 'DRIVER',
    });
    const roleless = rig();
    await expect(
      roleless.participant.lockAuthorizedActorShared(fakeContext(NOW, roleless.events), ACTOR),
    ).resolves.toEqual({ activeRole: null });
  });

  it('applies the same checks and precedence as the writer variant', async () => {
    const cases: Array<[string, Parameters<typeof rig>[0], string]> = [
      ['missing user', { user: undefined }, 'SESSION_INVALID'],
      ['missing session', { session: undefined }, 'SESSION_INVALID'],
      ['foreign session', { session: { ...SESSION, userId: OTHER_USER } }, 'SESSION_INVALID'],
      ['revoked', { session: { ...SESSION, revoked: true } }, 'SESSION_REVOKED'],
      ['expired (equality)', { session: { ...SESSION, expiresAtMs: NOW } }, 'SESSION_EXPIRED'],
      ['disabled', { user: { ...USER, status: 'DISABLED' } }, 'ACCOUNT_DISABLED'],
      [
        'revoked beats expired beats disabled',
        { user: { ...USER, status: 'DISABLED' }, session: { ...SESSION, revoked: true, expiresAtMs: NOW - 1 } },
        'SESSION_REVOKED',
      ],
    ];
    for (const [label, options, expected] of cases) {
      const r = rig(options);
      expect([label, await codeOf(() => r.participant.lockAuthorizedActorShared(fakeContext(NOW, r.events), ACTOR))]).toEqual([
        label,
        expected,
      ]);
    }
  });

  it('refuses a malformed actor before any SQL runs', async () => {
    const { participant, events } = rig();
    expect(
      await codeOf(() => participant.lockAuthorizedActorShared(fakeContext(NOW, events), { userId: 'x', sessionId: 'y' })),
    ).toBe('SESSION_INVALID');
    expect(events).toEqual([]);
  });
});

describe('SessionAuthorizationParticipant boundaries', () => {
  const code = sourceOf('auth/session-authorization-participant.ts');

  it('is a participant: no transaction manager, no pool, no SQL of its own, no token', () => {
    expect(code).not.toMatch(/TransactionManager|withTransaction|DATABASE_POOL|from 'pg'|\.query\(|BEGIN|COMMIT|ROLLBACK/);
    expect(code).not.toMatch(/token|bearer/i);
  });

  it('reads the database clock only after both locks, never an application clock', () => {
    expect(code).not.toMatch(/Date\.now|new Date|performance\.now/);
    const exclusive = code.slice(code.indexOf('async lockAuthorizedActor('), code.indexOf('async lockAuthorizedActorShared('));
    expect(exclusive.indexOf('this.users.lockById(')).toBeGreaterThan(-1);
    expect(exclusive.indexOf('this.users.lockById(')).toBeLessThan(exclusive.indexOf('this.sessions.lockById('));
    expect(exclusive).not.toMatch(/freshClockMs/);
    const decide = code.slice(code.indexOf('async #decide('));
    expect(decide.indexOf('session.revoked')).toBeLessThan(decide.indexOf('freshClockMs('));
    expect(decide.indexOf('freshClockMs(')).toBeLessThan(decide.indexOf("user.status !== 'ACTIVE'"));
  });
});

describe('SessionAuthorizationParticipant Shop variants (M02-A)', () => {
  const SHOP_SESSION: SharedLockedSession = { ...SESSION, activeRole: 'SHOP' };

  it('writer: user FOR UPDATE, session FOR UPDATE, clock, then the SHOP role check', async () => {
    const { participant, events } = rig({ session: SHOP_SESSION, roles: ['SHOP'] });
    await participant.lockAuthorizedShopActor(fakeContext(NOW, events), ACTOR);
    expect(events).toEqual(['user.update', 'session.update', 'clock', 'role.check:SHOP']);
  });

  it('reader: shared locks, clock, then the SHOP role check; never FOR UPDATE', async () => {
    const { participant, events } = rig({ session: SHOP_SESSION, roles: ['SHOP'] });
    await participant.lockAuthorizedShopActorShared(fakeContext(NOW, events), ACTOR);
    expect(events).toEqual(['user.share', 'session.share', 'clock', 'role.check:SHOP']);
  });

  it.each([
    ['roleless session', null],
    ['DRIVER context', 'DRIVER'],
  ])('refuses a %s with SHOP_ROLE_REQUIRED without querying roles', async (_label, activeRole) => {
    const { participant, events } = rig({ session: { ...SESSION, activeRole }, roles: ['SHOP', 'DRIVER'] });
    expect(await codeOf(() => participant.lockAuthorizedShopActor(fakeContext(NOW, events), ACTOR))).toBe('SHOP_ROLE_REQUIRED');
    expect(events).not.toContain('role.check:SHOP');
    const shared = rig({ session: { ...SESSION, activeRole }, roles: ['SHOP'] });
    expect(await codeOf(() => shared.participant.lockAuthorizedShopActorShared(fakeContext(NOW, shared.events), ACTOR))).toBe('SHOP_ROLE_REQUIRED');
  });

  it('refuses a SHOP session whose user no longer holds the SHOP role', async () => {
    const { participant, events } = rig({ session: SHOP_SESSION, roles: [] });
    expect(await codeOf(() => participant.lockAuthorizedShopActor(fakeContext(NOW, events), ACTOR))).toBe('SHOP_ROLE_REQUIRED');
  });

  it('session errors keep their precedence over the role requirement', async () => {
    const revoked = rig({ session: { ...SESSION, revoked: true }, roles: [] });
    expect(await codeOf(() => revoked.participant.lockAuthorizedShopActor(fakeContext(NOW, revoked.events), ACTOR))).toBe('SESSION_REVOKED');
    const missing = rig({ session: undefined });
    expect(await codeOf(() => missing.participant.lockAuthorizedShopActorShared(fakeContext(NOW, missing.events), ACTOR))).toBe('SESSION_INVALID');
  });

  it('lockAuthorizedActor stays roleless (onboarding)', async () => {
    const { participant, events } = rig({ session: SESSION, roles: [] });
    await participant.lockAuthorizedActor(fakeContext(NOW, events), ACTOR);
    expect(events).not.toContain('role.check:SHOP');
  });
});
