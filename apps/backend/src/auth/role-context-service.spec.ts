import { describe, expect, it } from '@jest/globals';
import { AuditWriter } from '../audit/audit-writer';
import { AppError } from '../common/app-errors';
import { DriverEligibilityReader } from '../driver/driver-eligibility-reader';
import { OwnerDriverEligibility } from '../driver/driver-types';
import { ShopEligibilityReader } from '../shop/shop-eligibility-reader';
import { OwnerShopEligibility } from '../shop/shop-types';
import { codeOf as sourceOf } from '../shared/source-scan.fixture';
import { PhoneAllowlist } from '../config/staging-fixtures-config';
import { AccountOriginPolicy, createAccountOriginPolicy } from './account-origin';
import { fakeTransactions } from './auth-fakes.fixture';
import { AuthPrincipal } from './auth-principal';
import { RoleContextService } from './role-context-service';
import { SessionAuthorizationParticipant } from './session-authorization-participant';
import { LockedSession, SessionRepository } from './session-repository';
import { UserRepository, UserRow } from './user-repository';

const NOW = 5_000_000;
const REQUEST_ID = '323e4567-e89b-42d3-a456-426614174000';
const PRINCIPAL: AuthPrincipal = {
  userId: '523e4567-e89b-42d3-a456-426614174000',
  sessionId: '623e4567-e89b-42d3-a456-426614174000',
  activeRole: null,
  phoneNormalized: '+84987654321',
};
const USER: UserRow = { userId: PRINCIPAL.userId, phoneNormalized: PRINCIPAL.phoneNormalized, passwordHash: 'h', status: 'ACTIVE', accountOrigin: 'PHONE_VERIFIED' };
const FIXTURE_POLICY = createAccountOriginPolicy({
  appEnv: 'staging',
  fixtureModeEnabled: true,
  allowedPhones: new PhoneAllowlist(['+84987654321']),
});
const SESSION: LockedSession = { sessionId: PRINCIPAL.sessionId, userId: PRINCIPAL.userId, activeRole: null, revoked: false, expiresAtMs: NOW + 60_000 };

interface Rig {
  service: RoleContextService;
  events: string[];
  audits: Array<Record<string, unknown>>;
  transactions: { transactions: number };
}

function rig(options: {
  user?: UserRow | undefined;
  session?: LockedSession | undefined;
  holdsRole?: boolean;
  revokedByShop?: string[];
  roles?: string[];
  shop?: OwnerShopEligibility;
  /** Default: a PENDING (selectable) Driver profile, which is what a user holding DRIVER normally has. */
  driver?: OwnerDriverEligibility;
  /** The role STORED on the locked session row, as /me reads it (the principal's copy is deliberately ignored). */
  activeRole?: string | null;
  /** M00-D2: the account origin policy of the process. Default: the standard one (verified accounts only). */
  policy?: AccountOriginPolicy;
}): Rig {
  const { manager, state, events } = fakeTransactions(NOW);
  const audits: Array<Record<string, unknown>> = [];
  const users = {
    lockById: async () => {
      events.push('user.lock');
      return 'user' in options ? options.user : USER;
    },
    lockByIdForShare: async () => {
      events.push('user.share');
      return 'user' in options ? options.user : USER;
    },
    hasRole: async () => {
      events.push('role.check');
      return options.holdsRole ?? true;
    },
    supportedRoles: async () => {
      events.push('roles.read');
      return options.roles ?? ['DRIVER', 'SHOP'];
    },
  } as unknown as UserRepository;
  const sessions = {
    lockById: async () => {
      events.push('session.lock');
      return 'session' in options ? options.session : SESSION;
    },
    lockByIdForShare: async () => {
      events.push('session.share');
      const locked = 'session' in options ? options.session : SESSION;
      return locked === undefined ? undefined : { ...locked, activeRole: options.activeRole ?? null };
    },
    revokeOtherShopSessions: async () => {
      events.push('shop.revoke');
      return options.revokedByShop ?? [];
    },
    setActiveRole: async (_c: unknown, _id: string, role: string) => void events.push(`role.set:${role}`),
  } as unknown as SessionRepository;
  const audit = { append: async (_c: unknown, entry: Record<string, unknown>) => void (events.push('audit'), audits.push(entry)) } as unknown as AuditWriter;
  const shops = {
    ownerShopEligibility: async () => {
      events.push('shop.read');
      return options.shop ?? { onboarding: 'COMPLETED', selectable: true };
    },
  } as unknown as ShopEligibilityReader;
  const drivers = {
    ownerDriverEligibility: async () => {
      events.push('driver.read');
      return options.driver ?? { onboarding: 'PENDING_APPROVAL', selectable: true };
    },
  } as unknown as DriverEligibilityReader;
  const sessionAuth = new SessionAuthorizationParticipant(users, sessions, options.policy);
  return {
    service: new RoleContextService(manager, users, sessions, audit, shops, drivers, sessionAuth),
    events,
    audits,
    transactions: state,
  };
}

async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof AppError ? error.code : `OTHER:${String(error)}`;
  }
  return 'OK';
}

const NO_DRIVER: OwnerDriverEligibility = { onboarding: 'NOT_STARTED', selectable: false };
const PENDING: OwnerDriverEligibility = { onboarding: 'PENDING_APPROVAL', selectable: true };
const DRIVER_ACTIVE: OwnerDriverEligibility = { onboarding: 'ACTIVE', selectable: true };
const SUSPENDED: OwnerDriverEligibility = { onboarding: 'SUSPENDED', selectable: true };
const CLOSING: OwnerDriverEligibility = { onboarding: 'CLOSING', selectable: true };
const CLOSED: OwnerDriverEligibility = { onboarding: 'CLOSED', selectable: false };

describe('RoleContextService.selectRole (task section 12)', () => {
  it('refuses ADMIN, SYSTEM, PLATFORM, EXTERNAL and unknown roles before touching the database', async () => {
    for (const role of ['ADMIN', 'SYSTEM', 'PLATFORM', 'EXTERNAL', 'shop', 'driver', 'SHOP ', '', 'NOPE']) {
      const r = rig({});
      expect([role, await codeOf(() => r.service.selectRole(PRINCIPAL, role, REQUEST_ID))]).toEqual([role, 'ROLE_NOT_AVAILABLE']);
      expect(r.transactions.transactions).toBe(0);
    }
  });

  it('SHOP: locks user, then session, reads the clock, checks membership, revokes other SHOP sessions, activates, audits', async () => {
    const r = rig({ revokedByShop: ['723e4567-e89b-42d3-a456-426614174000'] });
    const result = await r.service.selectRole(PRINCIPAL, 'SHOP', REQUEST_ID);
    expect(r.events).toEqual([
      'user.lock',
      'session.lock',
      'clock',
      'role.check',
      'shop.read',
      'driver.read',
      'shop.revoke',
      'role.set:SHOP',
      'audit', // the revoked session
      'audit', // the role selection
      'roles.read',
    ]);
    expect(result).toEqual({
      user_id: PRINCIPAL.userId,
      phone_normalized: PRINCIPAL.phoneNormalized,
      available_roles: ['DRIVER', 'SHOP'],
      active_role: 'SHOP',
      onboarding_required: false,
      role_selection_required: false,
    });
    expect(r.audits[0]).toMatchObject({
      action: 'auth.session_revoke.v1',
      resourceType: 'session',
      resourceId: '723e4567-e89b-42d3-a456-426614174000',
      outcome: 'SUCCESS',
      metadata: { reason: 'SHOP_REPLACED' },
    });
    expect(r.audits[1]).toMatchObject({
      action: 'auth.role_select.v1',
      resourceId: PRINCIPAL.sessionId,
      outcome: 'SUCCESS',
      metadata: { role: 'SHOP', revoked_sessions: 1 },
      requestId: REQUEST_ID,
      actorId: PRINCIPAL.userId,
    });
  });

  it('SHOP with no other SHOP session writes one audit and revokes nothing', async () => {
    const r = rig({});
    await r.service.selectRole(PRINCIPAL, 'SHOP', REQUEST_ID);
    expect(r.audits).toHaveLength(1);
    expect(r.audits[0]).toMatchObject({ metadata: { role: 'SHOP', revoked_sessions: 0 } });
  });

  it('SHOP held without an ACTIVE owned shop (stray role) is ROLE_NOT_AVAILABLE and changes nothing', async () => {
    for (const shop of [
      { onboarding: 'NOT_STARTED', selectable: false },
      { onboarding: 'INCOMPLETE', selectable: false },
      { onboarding: 'COMPLETED', selectable: false },
    ] as const) {
      const r = rig({ shop });
      expect(await codeOf(() => r.service.selectRole(PRINCIPAL, 'SHOP', REQUEST_ID))).toBe('ROLE_NOT_AVAILABLE');
      expect(r.events).toEqual(['user.lock', 'session.lock', 'clock', 'role.check', 'shop.read', 'driver.read']);
      expect(r.audits).toHaveLength(0);
    }
  });

  it('DRIVER with a PENDING, ACTIVE, SUSPENDED or CLOSING profile is selectable whatever the shop state', async () => {
    for (const driver of [PENDING, DRIVER_ACTIVE, SUSPENDED, CLOSING]) {
      const r = rig({ shop: { onboarding: 'NOT_STARTED', selectable: false }, roles: ['DRIVER'], driver });
      expect([driver.onboarding, (await r.service.selectRole(PRINCIPAL, 'DRIVER', REQUEST_ID)).active_role]).toEqual([
        driver.onboarding,
        'DRIVER',
      ]);
    }
  });

  it('DRIVER held without a Driver profile (stray role) or with a CLOSED one is ROLE_NOT_AVAILABLE and changes nothing', async () => {
    for (const driver of [NO_DRIVER, CLOSED]) {
      const r = rig({ roles: ['DRIVER'], driver });
      expect([driver.onboarding, await codeOf(() => r.service.selectRole(PRINCIPAL, 'DRIVER', REQUEST_ID))]).toEqual([
        driver.onboarding,
        'ROLE_NOT_AVAILABLE',
      ]);
      expect(r.events).toEqual(['user.lock', 'session.lock', 'clock', 'role.check', 'shop.read', 'driver.read']);
      expect(r.audits).toHaveLength(0);
    }
  });

  it('the Driver rule does not touch SHOP selection and the Shop rule does not touch DRIVER selection', async () => {
    const shopOnly = rig({ roles: ['SHOP'], driver: NO_DRIVER });
    expect((await shopOnly.service.selectRole(PRINCIPAL, 'SHOP', REQUEST_ID)).active_role).toBe('SHOP');
    const driverOnly = rig({ roles: ['DRIVER'], shop: { onboarding: 'NOT_STARTED', selectable: false } });
    expect((await driverOnly.service.selectRole(PRINCIPAL, 'DRIVER', REQUEST_ID)).active_role).toBe('DRIVER');
  });

  it('DRIVER: sets the role on this session and NEVER revokes another session', async () => {
    const r = rig({ revokedByShop: ['should-not-be-used'] });
    const result = await r.service.selectRole(PRINCIPAL, 'DRIVER', REQUEST_ID);
    expect(r.events).not.toContain('shop.revoke');
    expect(r.events).toContain('role.set:DRIVER');
    expect(result.active_role).toBe('DRIVER');
    expect(r.audits).toHaveLength(1);
  });

  it('refuses a role the user does not hold, and changes nothing', async () => {
    const r = rig({ holdsRole: false });
    expect(await codeOf(() => r.service.selectRole(PRINCIPAL, 'SHOP', REQUEST_ID))).toBe('ROLE_NOT_AVAILABLE');
    expect(r.events).toEqual(['user.lock', 'session.lock', 'clock', 'role.check']);
    expect(r.audits).toHaveLength(0);
  });

  it('re-checks the session and the user INSIDE the transaction', async () => {
    expect(await codeOf(() => rig({ session: { ...SESSION, revoked: true } }).service.selectRole(PRINCIPAL, 'SHOP', REQUEST_ID))).toBe('SESSION_REVOKED');
    expect(await codeOf(() => rig({ session: { ...SESSION, expiresAtMs: NOW } }).service.selectRole(PRINCIPAL, 'SHOP', REQUEST_ID))).toBe('SESSION_EXPIRED');
    expect(await codeOf(() => rig({ user: { ...USER, status: 'DISABLED' } }).service.selectRole(PRINCIPAL, 'SHOP', REQUEST_ID))).toBe('ACCOUNT_DISABLED');
    expect(await codeOf(() => rig({ session: undefined }).service.selectRole(PRINCIPAL, 'SHOP', REQUEST_ID))).toBe('SESSION_INVALID');
    expect(await codeOf(() => rig({ user: undefined }).service.selectRole(PRINCIPAL, 'SHOP', REQUEST_ID))).toBe('SESSION_INVALID');
    expect(
      await codeOf(() => rig({ session: { ...SESSION, userId: '723e4567-e89b-42d3-a456-426614174000' } }).service.selectRole(PRINCIPAL, 'SHOP', REQUEST_ID)),
    ).toBe('SESSION_INVALID');
  });
});

describe('RoleContextService.me (task section 13)', () => {
  it('no roles: onboarding_required, no role selection', async () => {
    const r = rig({ roles: [], shop: { onboarding: 'NOT_STARTED', selectable: false }, driver: NO_DRIVER });
    expect(await r.service.me(PRINCIPAL)).toEqual({
      user_id: PRINCIPAL.userId,
      phone_normalized: PRINCIPAL.phoneNormalized,
      available_roles: [],
      active_role: null,
      onboarding_required: true,
      role_selection_required: false,
      onboarding: { shop: 'NOT_STARTED', driver: 'NOT_STARTED' },
      phone_verification_status: 'VERIFIED',
    });
  });

  it('a staging fixture user (fixture mode on) is reported UNVERIFIED_TEST, a registered one VERIFIED', async () => {
    const fixtureUser: UserRow = { ...USER, accountOrigin: 'STAGING_FIXTURE' };
    const result = await rig({ user: fixtureUser, policy: FIXTURE_POLICY }).service.me(PRINCIPAL);
    expect(result.phone_verification_status).toBe('UNVERIFIED_TEST');
    expect((await rig({}).service.me(PRINCIPAL)).phone_verification_status).toBe('VERIFIED');
  });

  it('a staging fixture user under the standard policy (production, or mode off) is refused inside the /me transaction', async () => {
    const fixtureUser: UserRow = { ...USER, accountOrigin: 'STAGING_FIXTURE' };
    expect(await codeOf(() => rig({ user: fixtureUser }).service.me(PRINCIPAL))).toBe('SESSION_INVALID');
  });

  it('roles and no active role: role_selection_required', async () => {
    const result = await rig({ roles: ['DRIVER', 'SHOP'] }).service.me(PRINCIPAL);
    expect(result.available_roles).toEqual(['DRIVER', 'SHOP']);
    expect(result.onboarding_required).toBe(false);
    expect(result.role_selection_required).toBe(true);
  });

  it('roles and an active role: nothing more is required', async () => {
    const result = await rig({ roles: ['SHOP'], activeRole: 'SHOP' }).service.me(PRINCIPAL);
    expect(result.active_role).toBe('SHOP');
    expect(result.role_selection_required).toBe(false);
    expect(result.onboarding_required).toBe(false);
  });

  it('reports the shop onboarding state, DRIVER NOT_STARTED without a profile, and a stray SHOP role is hidden', async () => {
    const started = await rig({ roles: ['SHOP'], shop: { onboarding: 'INCOMPLETE', selectable: false }, driver: NO_DRIVER }).service.me(
      PRINCIPAL,
    );
    expect(started.onboarding).toEqual({ shop: 'INCOMPLETE', driver: 'NOT_STARTED' });
    expect(started.available_roles).toEqual([]);
    expect(started.onboarding_required).toBe(true);
    const done = await rig({ roles: ['SHOP'], driver: NO_DRIVER }).service.me(PRINCIPAL);
    expect(done.onboarding).toEqual({ shop: 'COMPLETED', driver: 'NOT_STARTED' });
    expect(done.available_roles).toEqual(['SHOP']);
  });

  it('reports the Driver profile status from the owner port: NOT_STARTED, PENDING_APPROVAL, ACTIVE, SUSPENDED, CLOSING, CLOSED', async () => {
    for (const driver of [NO_DRIVER, PENDING, DRIVER_ACTIVE, SUSPENDED, CLOSING, CLOSED]) {
      const result = await rig({ roles: ['DRIVER'], driver }).service.me(PRINCIPAL);
      expect([driver.onboarding, result.onboarding.driver]).toEqual([driver.onboarding, driver.onboarding]);
      expect([driver.onboarding, result.available_roles]).toEqual([driver.onboarding, driver.selectable ? ['DRIVER'] : []]);
    }
  });

  it('takes the user row FOR SHARE, then the session row FOR SHARE, validates, then reads roles, shop and driver in ONE transaction', async () => {
    const r = rig({ roles: ['SHOP'] });
    await r.service.me(PRINCIPAL);
    expect(r.events).toEqual(['user.share', 'session.share', 'clock', 'roles.read', 'shop.read', 'driver.read']);
    expect(r.transactions.transactions).toBe(1);
    // A reader: never an exclusive lock, never an audit row.
    expect(r.events).not.toContain('user.lock');
    expect(r.events).not.toContain('session.lock');
    expect(r.audits).toHaveLength(0);
  });

  it('re-validates the user AND the session after the shared locks, and reads nothing else when it refuses', async () => {
    const cases: Array<[string, Parameters<typeof rig>[0], string, string[]]> = [
      ['user gone', { user: undefined }, 'SESSION_INVALID', ['user.share']],
      ['session gone', { session: undefined }, 'SESSION_INVALID', ['user.share', 'session.share']],
      [
        'session of another user',
        { session: { ...SESSION, userId: '723e4567-e89b-42d3-a456-426614174000' } },
        'SESSION_INVALID',
        ['user.share', 'session.share'],
      ],
      ['session revoked', { session: { ...SESSION, revoked: true } }, 'SESSION_REVOKED', ['user.share', 'session.share']],
      [
        'session expired (equality counts)',
        { session: { ...SESSION, expiresAtMs: NOW } },
        'SESSION_EXPIRED',
        ['user.share', 'session.share', 'clock'],
      ],
      [
        'user disabled',
        { user: { ...USER, status: 'DISABLED' } },
        'ACCOUNT_DISABLED',
        ['user.share', 'session.share', 'clock'],
      ],
    ];
    for (const [label, options, code, events] of cases) {
      const r = rig(options);
      expect([label, await codeOf(() => r.service.me(PRINCIPAL))]).toEqual([label, code]);
      expect([label, r.events]).toEqual([label, events]);
    }
  });

  it('reads the CURRENT active role from the locked session row, never the one the guard saw earlier', async () => {
    // The guard's principal says SHOP, but a role selection committed while /me waited: the row now says DRIVER.
    const moved = await rig({ roles: ['DRIVER', 'SHOP'], activeRole: 'DRIVER' }).service.me({ ...PRINCIPAL, activeRole: 'SHOP' });
    expect([moved.active_role, moved.role_selection_required]).toEqual(['DRIVER', false]);
    // The guard's principal says DRIVER, but the row was cleared or never set: nothing is selected.
    const cleared = await rig({ roles: ['DRIVER', 'SHOP'], activeRole: null }).service.me({ ...PRINCIPAL, activeRole: 'DRIVER' });
    expect([cleared.active_role, cleared.role_selection_required]).toEqual([null, true]);
  });

  it('the shared locks are real FOR SHARE statements in the Auth repositories and /me asks for them before any read', () => {
    const users = sourceOf('auth/user-repository.ts');
    const userShare = users.slice(users.indexOf('async lockByIdForShare('), users.indexOf('async findById('));
    expect(userShare).toMatch(/FROM app\.users WHERE user_id = \$1::uuid FOR SHARE/);
    expect(userShare).not.toMatch(/FOR UPDATE|INSERT|UPDATE app|DELETE/);
    // The reset target (M01-RESET): the locking method takes FOR UPDATE, the read-only twin takes no lock at all.
    const lockReset = users.slice(users.indexOf('async lockResetTarget('), users.indexOf('async readResetTarget('));
    expect(lockReset).toMatch(/FOR UPDATE OF u/);
    const readReset = users.slice(users.indexOf('async readResetTarget('), users.indexOf('async setPasswordHash('));
    expect(readReset).not.toMatch(/FOR UPDATE|FOR SHARE|INSERT|UPDATE app|DELETE/);

    const sessions = sourceOf('auth/session-repository.ts');
    const sessionShare = sessions.slice(sessions.indexOf('async lockByIdForShare('), sessions.indexOf('async revokeOtherShopSessions('));
    expect(sessionShare).toMatch(/FROM app\.sessions WHERE session_id = \$1::uuid FOR SHARE/);
    expect(sessionShare).not.toMatch(/FOR UPDATE|INSERT|UPDATE app|DELETE/);
    // + revoke-all and password-change revoke-others (rows locked in session_id order, then updated).
    expect(sessions.split('FOR UPDATE').length - 1).toBe(3);

    const service = sourceOf('auth/role-context-service.ts');
    const me = service.slice(service.indexOf('async me('), service.indexOf('async selectRole('));
    expect(me.indexOf('lockAuthorizedActorShared(')).toBeGreaterThan(-1);
    expect(me.indexOf('lockAuthorizedActorShared(')).toBeLessThan(me.indexOf('supportedRoles('));
    expect(me.indexOf('supportedRoles(')).toBeLessThan(me.indexOf('ownerShopEligibility('));
    expect(me.indexOf('ownerShopEligibility(')).toBeLessThan(me.indexOf('ownerDriverEligibility('));
    // No exclusive lock, no nested transaction, no SERIALIZABLE, no raw SQL, no read of the guard's role.
    expect(me).not.toMatch(/lockById\(|lockAuthorizedActor\(|SERIALIZABLE|\.query\(|principal\.activeRole/);
    expect(service).not.toMatch(/forwardRef/);
  });

  describe('onboarding_required / role_selection_required by shop state (A2S review addendum)', () => {
    const NOT_STARTED: OwnerShopEligibility = { onboarding: 'NOT_STARTED', selectable: false };
    const INCOMPLETE: OwnerShopEligibility = { onboarding: 'INCOMPLETE', selectable: false };
    const ACTIVE: OwnerShopEligibility = { onboarding: 'COMPLETED', selectable: true };
    const DISABLED: OwnerShopEligibility = { onboarding: 'COMPLETED', selectable: false };

    const flags = async (
      roles: string[],
      shop: OwnerShopEligibility,
      activeRole: string | null = null,
      driver: OwnerDriverEligibility = NO_DRIVER,
    ) => {
      const result = await rig({ roles, shop, driver, activeRole }).service.me(PRINCIPAL);
      return [result.available_roles, result.onboarding.shop, result.onboarding_required, result.role_selection_required];
    };

    it('NOT_STARTED: onboarding is required, with or without a stray SHOP role', async () => {
      expect(await flags([], NOT_STARTED)).toEqual([[], 'NOT_STARTED', true, false]);
      expect(await flags(['SHOP'], NOT_STARTED)).toEqual([[], 'NOT_STARTED', true, false]);
    });

    it('INCOMPLETE: onboarding is still required', async () => {
      expect(await flags([], INCOMPLETE)).toEqual([[], 'INCOMPLETE', true, false]);
      expect(await flags(['SHOP'], INCOMPLETE)).toEqual([[], 'INCOMPLETE', true, false]);
    });

    it('ACTIVE: SHOP is available, onboarding is not required, selection is required until a role is active', async () => {
      expect(await flags(['SHOP'], ACTIVE)).toEqual([['SHOP'], 'COMPLETED', false, true]);
      expect(await flags(['SHOP'], ACTIVE, 'SHOP')).toEqual([['SHOP'], 'COMPLETED', false, false]);
    });

    it('DISABLED: COMPLETED, SHOP hidden, and the user is NOT sent back to onboarding or to role selection', async () => {
      expect(await flags(['SHOP'], DISABLED)).toEqual([[], 'COMPLETED', false, false]);
    });

    it('DRIVER + DISABLED shop: only DRIVER is offered, no onboarding, role selection as usual', async () => {
      expect(await flags(['DRIVER', 'SHOP'], DISABLED, null, PENDING)).toEqual([['DRIVER'], 'COMPLETED', false, true]);
      expect(await flags(['DRIVER', 'SHOP'], DISABLED, 'DRIVER', PENDING)).toEqual([['DRIVER'], 'COMPLETED', false, false]);
    });

    it('a Driver profile is unaffected by an unfinished shop: it is offered and turns onboarding off', async () => {
      expect(await flags(['DRIVER'], NOT_STARTED, null, PENDING)).toEqual([['DRIVER'], 'NOT_STARTED', false, true]);
      expect(await flags(['DRIVER', 'SHOP'], INCOMPLETE, null, PENDING)).toEqual([['DRIVER'], 'INCOMPLETE', false, true]);
    });

    it('a stray DRIVER role without a profile is hidden and onboarding is still required (A03-C06)', async () => {
      expect(await flags(['DRIVER'], NOT_STARTED)).toEqual([[], 'NOT_STARTED', true, false]);
      expect(await flags(['DRIVER'], INCOMPLETE)).toEqual([[], 'INCOMPLETE', true, false]);
    });

    it('a CLOSED Driver profile is hidden and the user is NOT sent back to onboarding or to role selection', async () => {
      expect(await flags(['DRIVER'], NOT_STARTED, null, CLOSED)).toEqual([[], 'NOT_STARTED', false, false]);
      expect(await flags(['DRIVER', 'SHOP'], ACTIVE, null, CLOSED)).toEqual([['SHOP'], 'COMPLETED', false, true]);
    });
  });

  describe('effective active role: the stored role counts only while it is still available (router repair, section 3)', () => {
    const SHOP_OK: OwnerShopEligibility = { onboarding: 'COMPLETED', selectable: true };
    const SHOP_DISABLED: OwnerShopEligibility = { onboarding: 'COMPLETED', selectable: false };
    const SHOP_NONE: OwnerShopEligibility = { onboarding: 'NOT_STARTED', selectable: false };

    const projected = async (options: Parameters<typeof rig>[0]) => {
      const result = await rig(options).service.me(PRINCIPAL);
      return [result.active_role, result.available_roles, result.role_selection_required, result.onboarding_required];
    };

    it('DRIVER selected, the Driver becomes CLOSED, a usable SHOP remains: null, [SHOP], selection required', async () => {
      expect(await projected({ roles: ['DRIVER', 'SHOP'], shop: SHOP_OK, driver: CLOSED, activeRole: 'DRIVER' })).toEqual([
        null,
        ['SHOP'],
        true,
        false,
      ]);
    });

    it('SHOP selected, the Shop becomes DISABLED, a usable DRIVER remains: null, [DRIVER], selection required', async () => {
      expect(await projected({ roles: ['DRIVER', 'SHOP'], shop: SHOP_DISABLED, driver: PENDING, activeRole: 'SHOP' })).toEqual([
        null,
        ['DRIVER'],
        true,
        false,
      ]);
    });

    it('the selected role row is removed, or there is no profile for it: the same rule', async () => {
      // DRIVER stored, but the user no longer holds DRIVER.
      expect(await projected({ roles: ['SHOP'], shop: SHOP_OK, driver: NO_DRIVER, activeRole: 'DRIVER' })).toEqual([
        null,
        ['SHOP'],
        true,
        false,
      ]);
      // SHOP stored with the role row but no shop profile at all.
      expect(await projected({ roles: ['SHOP', 'DRIVER'], shop: SHOP_NONE, driver: PENDING, activeRole: 'SHOP' })).toEqual([
        null,
        ['DRIVER'],
        true,
        false,
      ]);
    });

    it('no usable role with a completed but disabled / closed profile: null, [], no selection, no onboarding loop', async () => {
      expect(await projected({ roles: ['SHOP'], shop: SHOP_DISABLED, driver: NO_DRIVER, activeRole: 'SHOP' })).toEqual([
        null,
        [],
        false,
        false,
      ]);
      expect(await projected({ roles: ['DRIVER'], shop: SHOP_NONE, driver: CLOSED, activeRole: 'DRIVER' })).toEqual([
        null,
        [],
        false,
        false,
      ]);
    });

    it('a valid active role stays selected, and a roleless session is unchanged', async () => {
      expect(await projected({ roles: ['DRIVER', 'SHOP'], shop: SHOP_OK, driver: PENDING, activeRole: 'DRIVER' })).toEqual([
        'DRIVER',
        ['DRIVER', 'SHOP'],
        false,
        false,
      ]);
      expect(await projected({ roles: ['SHOP'], shop: SHOP_OK, driver: NO_DRIVER, activeRole: null })).toEqual([
        null,
        ['SHOP'],
        true,
        false,
      ]);
      expect(await projected({ roles: [], shop: SHOP_NONE, driver: NO_DRIVER, activeRole: null })).toEqual([null, [], false, true]);
    });

    it('rewrites no session row merely to shape /me: only locks and reads happen', async () => {
      const r = rig({ roles: ['DRIVER', 'SHOP'], shop: SHOP_OK, driver: CLOSED, activeRole: 'DRIVER' });
      await r.service.me(PRINCIPAL);
      expect(r.events.filter((event) => event.startsWith('role.set') || event === 'shop.revoke')).toEqual([]);
      expect(r.audits).toHaveLength(0);
    });

    it('role selection answers with the same rule: the role it just validated is the effective one', async () => {
      const r = rig({ roles: ['DRIVER', 'SHOP'], shop: SHOP_OK, driver: PENDING });
      const shop = await r.service.selectRole(PRINCIPAL, 'SHOP', REQUEST_ID);
      expect([shop.active_role, shop.available_roles, shop.role_selection_required]).toEqual(['SHOP', ['DRIVER', 'SHOP'], false]);
      const driver = await rig({ roles: ['DRIVER', 'SHOP'], shop: SHOP_OK, driver: PENDING }).service.selectRole(
        PRINCIPAL,
        'DRIVER',
        REQUEST_ID,
      );
      expect([driver.active_role, driver.role_selection_required]).toEqual(['DRIVER', false]);
    });
  });

  it('has exactly the documented fields', async () => {
    const result = await rig({ roles: ['SHOP'] }).service.me(PRINCIPAL);
    expect(Object.keys(result).sort()).toEqual([
      'active_role',
      'available_roles',
      'onboarding',
      'onboarding_required',
      'phone_normalized',
      'phone_verification_status',
      'role_selection_required',
      'user_id',
    ]);
  });
});
