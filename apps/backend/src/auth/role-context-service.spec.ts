import { describe, expect, it } from '@jest/globals';
import { AuditWriter } from '../audit/audit-writer';
import { AppError } from '../common/app-errors';
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
}): Rig {
  const { manager, state, events } = fakeTransactions(NOW);
  const audits: Array<Record<string, unknown>> = [];
  const users = {
    lockById: async () => {
      events.push('user.lock');
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
  return { service: new RoleContextService(manager, users, sessions, audit), events, audits, transactions: state };
}

async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof AppError ? error.code : `OTHER:${String(error)}`;
  }
  return 'OK';
}

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
    const r = rig({ roles: [] });
    expect(await r.service.me(PRINCIPAL)).toEqual({
      user_id: PRINCIPAL.userId,
      phone_normalized: PRINCIPAL.phoneNormalized,
      available_roles: [],
      active_role: null,
      onboarding_required: true,
      role_selection_required: false,
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

  it('never invents SHOP/DRIVER onboarding state (no such field exists before M02/M03)', async () => {
    const result = await rig({ roles: ['SHOP'] }).service.me(PRINCIPAL);
    expect(Object.keys(result).sort()).toEqual([
      'active_role',
      'available_roles',
      'onboarding_required',
      'phone_normalized',
      'role_selection_required',
      'user_id',
    ]);
  });
});
