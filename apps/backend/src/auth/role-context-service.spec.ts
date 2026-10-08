import { describe, expect, it } from '@jest/globals';
import { AuditWriter } from '../audit/audit-writer';
import { AppError } from '../common/app-errors';
import { DriverEligibilityReader } from '../driver/driver-eligibility-reader';
import { OwnerDriverEligibility } from '../driver/driver-types';
import { ShopEligibilityReader } from '../shop/shop-eligibility-reader';
import { OwnerShopEligibility } from '../shop/shop-types';
import { codeOf as sourceOf } from '../shared/source-scan.fixture';
import { fakeTransactions } from './auth-fakes.fixture';
import { AuthPrincipal } from './auth-principal';
import { RoleContextService } from './role-context-service';
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
const USER: UserRow = { userId: PRINCIPAL.userId, phoneNormalized: PRINCIPAL.phoneNormalized, passwordHash: 'h', status: 'ACTIVE' };
const SESSION: LockedSession = { sessionId: PRINCIPAL.sessionId, userId: PRINCIPAL.userId, revoked: false, expiresAtMs: NOW + 60_000 };

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
  return { service: new RoleContextService(manager, users, sessions, audit, shops, drivers), events, audits, transactions: state };
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
    });
  });

  it('roles and no active role: role_selection_required', async () => {
    const result = await rig({ roles: ['DRIVER', 'SHOP'] }).service.me(PRINCIPAL);
    expect(result.available_roles).toEqual(['DRIVER', 'SHOP']);
    expect(result.onboarding_required).toBe(false);
    expect(result.role_selection_required).toBe(true);
  });

  it('roles and an active role: nothing more is required', async () => {
    const result = await rig({ roles: ['SHOP'] }).service.me({ ...PRINCIPAL, activeRole: 'SHOP' });
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

  it('takes the user row FOR SHARE first, re-checks it, then reads roles, shop and driver in ONE transaction', async () => {
    const r = rig({ roles: ['SHOP'] });
    await r.service.me(PRINCIPAL);
    expect(r.events).toEqual(['user.share', 'roles.read', 'shop.read', 'driver.read']);
    expect(r.transactions.transactions).toBe(1);
    // A reader: never the exclusive lock, never a session lock, never an audit row.
    expect(r.events).not.toContain('user.lock');
    expect(r.audits).toHaveLength(0);
  });

  it('re-checks the user AFTER the shared lock: gone is SESSION_INVALID, disabled is ACCOUNT_DISABLED, nothing else is read', async () => {
    const gone = rig({ user: undefined });
    expect(await codeOf(() => gone.service.me(PRINCIPAL))).toBe('SESSION_INVALID');
    expect(gone.events).toEqual(['user.share']);
    const disabled = rig({ user: { ...USER, status: 'DISABLED' } });
    expect(await codeOf(() => disabled.service.me(PRINCIPAL))).toBe('ACCOUNT_DISABLED');
    expect(disabled.events).toEqual(['user.share']);
  });

  it('the shared lock is a real FOR SHARE in the Auth repository and /me asks for it before any read', () => {
    const repository = sourceOf('auth/user-repository.ts');
    const share = repository.slice(repository.indexOf('async lockByIdForShare('), repository.indexOf('async findById('));
    expect(share).toMatch(/FROM app\.users WHERE user_id = \$1::uuid FOR SHARE/);
    expect(share).not.toMatch(/FOR UPDATE|INSERT|UPDATE app|DELETE/);
    // The exclusive lock of the mutations is untouched.
    expect(repository.split('FOR UPDATE').length - 1).toBe(1);

    const service = sourceOf('auth/role-context-service.ts');
    const me = service.slice(service.indexOf('async me('), service.indexOf('async selectRole('));
    expect(me.indexOf('lockByIdForShare(')).toBeGreaterThan(-1);
    expect(me.indexOf('lockByIdForShare(')).toBeLessThan(me.indexOf('supportedRoles('));
    expect(me.indexOf('supportedRoles(')).toBeLessThan(me.indexOf('ownerShopEligibility('));
    expect(me.indexOf('ownerShopEligibility(')).toBeLessThan(me.indexOf('ownerDriverEligibility('));
    expect(me).not.toMatch(/lockById\(|SERIALIZABLE|\.query\(/);
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
      const result = await rig({ roles, shop, driver }).service.me({ ...PRINCIPAL, activeRole });
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

  it('has exactly the documented fields', async () => {
    const result = await rig({ roles: ['SHOP'] }).service.me(PRINCIPAL);
    expect(Object.keys(result).sort()).toEqual([
      'active_role',
      'available_roles',
      'onboarding',
      'onboarding_required',
      'phone_normalized',
      'role_selection_required',
      'user_id',
    ]);
  });
});
