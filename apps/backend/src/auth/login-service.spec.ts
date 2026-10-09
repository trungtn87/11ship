import { describe, expect, it } from '@jest/globals';
import { AuditWriter } from '../audit/audit-writer';
import { StandaloneAuditRecorder } from '../audit/standalone-audit-recorder';
import { AppError } from '../common/app-errors';
import { DriverEligibilityReader } from '../driver/driver-eligibility-reader';
import { OwnerDriverEligibility } from '../driver/driver-types';
import { ShopEligibilityReader } from '../shop/shop-eligibility-reader';
import { OwnerShopEligibility } from '../shop/shop-types';
import { OtpHmacKey } from '../config/auth-config';
import { AuthConfig } from '../config/auth-config';
import { codeOf as sourceOf } from '../shared/source-scan.fixture';
import { fakeTransactions } from './auth-fakes.fixture';
import { LoginService } from './login-service';
import { PasswordHasher } from './password-hasher';
import { SessionRepository } from './session-repository';
import { UserRepository, UserRow } from './user-repository';

const CONFIG: AuthConfig = {
  otpTtlSeconds: 300,
  otpResendSeconds: 60,
  otpMaxAttempts: 5,
  proofTtlSeconds: 600,
  sessionTtlSeconds: 3600,
  otpHmacKey: new OtpHmacKey(Buffer.alloc(32, 1)),
};
const USER: UserRow = {
  userId: '123e4567-e89b-42d3-a456-426614174000',
  phoneNormalized: '+84987654321',
  passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$salt$hash',
  status: 'ACTIVE',
  accountOrigin: 'PHONE_VERIFIED',
};
const INPUT = {
  phoneNormalized: '+84987654321',
  password: 'correct horse',
  device: { deviceId: 'd1', platform: 'ANDROID', app: 'SHIP11' },
};
const REQUEST_ID = '223e4567-e89b-42d3-a456-426614174000';

const NOT_STARTED_SHOP: OwnerShopEligibility = { onboarding: 'NOT_STARTED', selectable: false };
const NO_DRIVER: OwnerDriverEligibility = { onboarding: 'NOT_STARTED', selectable: false };
const PENDING: OwnerDriverEligibility = { onboarding: 'PENDING_APPROVAL', selectable: true };
const DRIVER_ACTIVE: OwnerDriverEligibility = { onboarding: 'ACTIVE', selectable: true };
const SUSPENDED: OwnerDriverEligibility = { onboarding: 'SUSPENDED', selectable: true };
const CLOSING: OwnerDriverEligibility = { onboarding: 'CLOSING', selectable: true };
const CLOSED: OwnerDriverEligibility = { onboarding: 'CLOSED', selectable: false };

interface Rig {
  service: LoginService;
  calls: string[];
  state: { inTransaction: boolean; transactions: number };
  audits: unknown[];
  denials: unknown[];
}

function rig(options: {
  found?: UserRow | undefined;
  locked?: UserRow | undefined;
  passwordOk?: boolean;
  roles?: string[];
  shop?: OwnerShopEligibility;
  /** Default: no Driver profile. A test that holds the DRIVER role states the profile it holds. */
  driver?: OwnerDriverEligibility;
}): Rig {
  const { manager, state } = fakeTransactions();
  const calls: string[] = [];
  const audits: unknown[] = [];
  const denials: unknown[] = [];
  const found = 'found' in options ? options.found : USER;
  const locked = 'locked' in options ? options.locked : found;

  const users = {
    findByPhone: async () => found,
    lockById: async () => locked,
    supportedRoles: async () => options.roles ?? [],
  } as unknown as UserRepository;
  const sessions = {
    create: async () => {
      calls.push('session.create');
      return { sessionId: 's1', accessToken: 'T'.repeat(43) };
    },
  } as unknown as SessionRepository;
  const audit = { append: async (_c: unknown, entry: unknown) => void audits.push(entry) } as unknown as AuditWriter;
  const recorder = { recordBestEffort: async (entry: unknown) => void denials.push(entry) } as unknown as StandaloneAuditRecorder;
  const shops = {
    ownerShopEligibility: async () => options.shop ?? { onboarding: 'COMPLETED', selectable: true },
  } as unknown as ShopEligibilityReader;
  const drivers = {
    ownerDriverEligibility: async () => options.driver ?? { onboarding: 'NOT_STARTED', selectable: false },
  } as unknown as DriverEligibilityReader;
  const hasher: PasswordHasher = {
    hash: async () => 'never',
    verify: async () => {
      calls.push(state.inTransaction ? 'verify(in-tx)' : 'verify');
      return options.passwordOk ?? true;
    },
    verifyAgainstDummy: async () => {
      calls.push(state.inTransaction ? 'dummy(in-tx)' : 'dummy');
    },
  };
  return { service: new LoginService(manager, users, sessions, audit, recorder, CONFIG, hasher, shops, drivers), calls, state, audits, denials };
}

async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof AppError) {
      return error.code;
    }
    throw error;
  }
  return 'OK';
}

describe('LoginService (task section 11)', () => {
  it('unknown phone: spends a dummy verification and answers INVALID_CREDENTIALS, never touching sessions', async () => {
    const r = rig({ found: undefined });
    expect(await codeOf(() => r.service.login(INPUT, REQUEST_ID))).toBe('INVALID_CREDENTIALS');
    expect(r.calls).toEqual(['dummy']);
    expect(r.state.transactions).toBe(1); // only the lookup
  });

  it('an administration account is refused like an unknown phone: dummy verification, INVALID_CREDENTIALS, no session', async () => {
    const r = rig({ found: { ...USER, accountOrigin: 'ADMIN_PROVISIONED' } });
    expect(await codeOf(() => r.service.login(INPUT, REQUEST_ID))).toBe('INVALID_CREDENTIALS');
    expect(r.calls).toEqual(['dummy']);
    expect(r.state.transactions).toBe(1);
  });

  it('an account whose origin changed to administration before the lock is refused without a session', async () => {
    const r = rig({ locked: { ...USER, accountOrigin: 'ADMIN_PROVISIONED' } });
    expect(await codeOf(() => r.service.login(INPUT, REQUEST_ID))).toBe('INVALID_CREDENTIALS');
    expect(r.calls).toEqual(['verify']);
  });

  it('wrong password: INVALID_CREDENTIALS, no dummy, no session', async () => {
    const r = rig({ passwordOk: false });
    expect(await codeOf(() => r.service.login(INPUT, REQUEST_ID))).toBe('INVALID_CREDENTIALS');
    expect(r.calls).toEqual(['verify']);
  });

  it('verifies the password OUTSIDE any transaction, then creates the session and the audit inside one', async () => {
    // A roleless user who never started Shop onboarding (the rig's default shop is a completed ACTIVE one).
    const r = rig({ roles: [], shop: { onboarding: 'NOT_STARTED', selectable: false } });
    const result = await r.service.login(INPUT, REQUEST_ID);
    expect(r.calls).toEqual(['verify', 'session.create']);
    expect(r.state.transactions).toBe(2); // lookup, then the short login transaction
    expect(result).toEqual({
      user_id: USER.userId,
      available_roles: [],
      active_role: null,
      onboarding_required: true,
      role_selection_required: false,
      access_token: 'T'.repeat(43),
    });
    expect(r.audits).toHaveLength(1);
    expect(r.audits[0]).toMatchObject({ action: 'auth.login.v1', outcome: 'SUCCESS', actorId: USER.userId, requestId: REQUEST_ID });
    expect(JSON.stringify(r.audits[0])).not.toContain('T'.repeat(43));
    expect(JSON.stringify(r.audits[0])).not.toContain(INPUT.password);
    expect(JSON.stringify(r.audits[0])).not.toContain(INPUT.phoneNormalized);
  });

  it('with roles: returns them, selects none and asks for role selection', async () => {
    const r = rig({ roles: ['DRIVER', 'SHOP'], driver: PENDING });
    const result = await r.service.login(INPUT, REQUEST_ID);
    expect(result.available_roles).toEqual(['DRIVER', 'SHOP']);
    expect(result.active_role).toBeNull();
    expect(result.onboarding_required).toBe(false);
    expect(result.role_selection_required).toBe(true);
  });

  it('a SHOP role without an ACTIVE owned shop is not offered at login', async () => {
    const r = rig({ roles: ['DRIVER', 'SHOP'], shop: { onboarding: 'INCOMPLETE', selectable: false }, driver: PENDING });
    const result = await r.service.login(INPUT, REQUEST_ID);
    expect(result.available_roles).toEqual(['DRIVER']);
  });

  it('a DRIVER role without a Driver profile (stray) or with a CLOSED one is not offered at login', async () => {
    for (const driver of [NO_DRIVER, CLOSED]) {
      const result = await rig({ roles: ['DRIVER', 'SHOP'], driver }).service.login(INPUT, REQUEST_ID);
      expect([driver.onboarding, result.available_roles]).toEqual([driver.onboarding, ['SHOP']]);
    }
  });

  it('a PENDING, ACTIVE, SUSPENDED or CLOSING Driver profile is offered at login (selectable is not "may take deliveries")', async () => {
    for (const driver of [PENDING, DRIVER_ACTIVE, SUSPENDED, CLOSING]) {
      const result = await rig({ roles: ['DRIVER'], shop: NOT_STARTED_SHOP, driver }).service.login(INPUT, REQUEST_ID);
      expect([driver.onboarding, result.available_roles, result.onboarding_required, result.role_selection_required]).toEqual([
        driver.onboarding,
        ['DRIVER'],
        false,
        true,
      ]);
    }
  });

  it('reads the Driver eligibility inside the login transaction, after the user lock, through the owner port only', () => {
    const code = sourceOf('auth/login-service.ts');
    expect(code).toContain('this.drivers.ownerDriverEligibility(context');
    expect(code.indexOf('this.users.lockById(')).toBeLessThan(code.indexOf('this.drivers.ownerDriverEligibility('));
    expect(code).not.toMatch(/app\.drivers/);
  });

  it('reports the same onboarding / role-selection flags as /me for every shop state (A2S review addendum)', async () => {
    const NOT_STARTED: OwnerShopEligibility = { onboarding: 'NOT_STARTED', selectable: false };
    const INCOMPLETE: OwnerShopEligibility = { onboarding: 'INCOMPLETE', selectable: false };
    const ACTIVE: OwnerShopEligibility = { onboarding: 'COMPLETED', selectable: true };
    const DISABLED: OwnerShopEligibility = { onboarding: 'COMPLETED', selectable: false };
    const cases: Array<[string, string[], OwnerShopEligibility, OwnerDriverEligibility, string[], boolean, boolean]> = [
      ['no role, NOT_STARTED', [], NOT_STARTED, NO_DRIVER, [], true, false],
      ['stray SHOP, NOT_STARTED', ['SHOP'], NOT_STARTED, NO_DRIVER, [], true, false],
      ['INCOMPLETE', [], INCOMPLETE, NO_DRIVER, [], true, false],
      ['stray SHOP, INCOMPLETE', ['SHOP'], INCOMPLETE, NO_DRIVER, [], true, false],
      ['ACTIVE', ['SHOP'], ACTIVE, NO_DRIVER, ['SHOP'], false, true],
      // Completed but DISABLED: nothing to select and nothing to onboard.
      ['DISABLED', ['SHOP'], DISABLED, NO_DRIVER, [], false, false],
      ['DRIVER + DISABLED', ['DRIVER', 'SHOP'], DISABLED, PENDING, ['DRIVER'], false, true],
      ['DRIVER, NOT_STARTED shop', ['DRIVER'], NOT_STARTED, PENDING, ['DRIVER'], false, true],
      // A2D: a stray DRIVER role is hidden and still needs onboarding; a CLOSED profile is hidden and does not.
      ['stray DRIVER', ['DRIVER'], NOT_STARTED, NO_DRIVER, [], true, false],
      ['CLOSED driver, NOT_STARTED shop', ['DRIVER'], NOT_STARTED, CLOSED, [], false, false],
      ['CLOSED driver + ACTIVE shop', ['DRIVER', 'SHOP'], ACTIVE, CLOSED, ['SHOP'], false, true],
    ];
    for (const [name, roles, shop, driver, available, onboardingRequired, selectionRequired] of cases) {
      const result = await rig({ roles, shop, driver }).service.login(INPUT, REQUEST_ID);
      expect([name, result.available_roles, result.onboarding_required, result.role_selection_required]).toEqual([
        name,
        available,
        onboardingRequired,
        selectionRequired,
      ]);
      expect(result.active_role).toBeNull();
    }
  });

  it('correct password on a disabled account: ACCOUNT_DISABLED, a DENIED audit, and no session', async () => {
    const r = rig({ found: { ...USER, status: 'DISABLED' } });
    expect(await codeOf(() => r.service.login(INPUT, REQUEST_ID))).toBe('ACCOUNT_DISABLED');
    expect(r.calls).toEqual(['verify']);
    expect(r.denials).toHaveLength(1);
    expect(r.denials[0]).toMatchObject({ action: 'auth.login.v1', outcome: 'DENIED', reasonCode: 'ACCOUNT_DISABLED' });
    expect(r.audits).toHaveLength(0);
  });

  it('wrong password on a disabled account does not reveal that it is disabled', async () => {
    const r = rig({ found: { ...USER, status: 'DISABLED' }, passwordOk: false });
    expect(await codeOf(() => r.service.login(INPUT, REQUEST_ID))).toBe('INVALID_CREDENTIALS');
    expect(r.denials).toHaveLength(0);
  });

  it('the account becoming disabled between verification and the transaction is still refused', async () => {
    const r = rig({ locked: { ...USER, status: 'DISABLED' } });
    expect(await codeOf(() => r.service.login(INPUT, REQUEST_ID))).toBe('ACCOUNT_DISABLED');
    expect(r.calls).toEqual(['verify']);
  });

  it('a password hash that changed after verification is INVALID_CREDENTIALS (the verified credential is stale)', async () => {
    const r = rig({ locked: { ...USER, passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$other$hash' } });
    expect(await codeOf(() => r.service.login(INPUT, REQUEST_ID))).toBe('INVALID_CREDENTIALS');
    expect(r.calls).toEqual(['verify']);
  });

  it('a user that vanished before the lock is INVALID_CREDENTIALS', async () => {
    const r = rig({ locked: undefined });
    expect(await codeOf(() => r.service.login(INPUT, REQUEST_ID))).toBe('INVALID_CREDENTIALS');
    expect(r.calls).toEqual(['verify']);
  });
});
