import { describe, expect, it } from '@jest/globals';
import { AuditWriter } from '../audit/audit-writer';
import { StandaloneAuditRecorder } from '../audit/standalone-audit-recorder';
import { AppError } from '../common/app-errors';
import { OtpHmacKey } from '../config/auth-config';
import { AuthConfig } from '../config/auth-config';
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
};
const INPUT = {
  phoneNormalized: '+84987654321',
  password: 'correct horse',
  device: { deviceId: 'd1', platform: 'ANDROID', app: 'SHIP11' },
};
const REQUEST_ID = '223e4567-e89b-42d3-a456-426614174000';

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
  return { service: new LoginService(manager, users, sessions, audit, recorder, CONFIG, hasher), calls, state, audits, denials };
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

  it('wrong password: INVALID_CREDENTIALS, no dummy, no session', async () => {
    const r = rig({ passwordOk: false });
    expect(await codeOf(() => r.service.login(INPUT, REQUEST_ID))).toBe('INVALID_CREDENTIALS');
    expect(r.calls).toEqual(['verify']);
  });

  it('verifies the password OUTSIDE any transaction, then creates the session and the audit inside one', async () => {
    const r = rig({ roles: [] });
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
    const r = rig({ roles: ['DRIVER', 'SHOP'] });
    const result = await r.service.login(INPUT, REQUEST_ID);
    expect(result.available_roles).toEqual(['DRIVER', 'SHOP']);
    expect(result.active_role).toBeNull();
    expect(result.onboarding_required).toBe(false);
    expect(result.role_selection_required).toBe(true);
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
