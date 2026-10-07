import { describe, expect, it } from '@jest/globals';
import { AuditWriter } from '../audit/audit-writer';
import { AppError, TechnicalError } from '../common/app-errors';
import { AuthConfig, OtpHmacKey } from '../config/auth-config';
import { IdempotencyExecutor, IdempotentRequest, IdempotentResult } from '../idempotency/idempotency-executor';
import { OutboxWriter } from '../outbox/outbox-writer';
import { TransactionContext } from '../transaction/transaction-context';
import { fakeContext, fakeTransactions } from './auth-fakes.fixture';
import { PasswordHasher } from './password-hasher';
import { ProofForRegister, ProofRepository } from './proof-repository';
import { RegistrationService } from './registration-service';
import { SessionRepository } from './session-repository';
import { digestToken, generateToken } from './tokens';
import { UserRepository, UserRow } from './user-repository';

const CONFIG: AuthConfig = {
  otpTtlSeconds: 300,
  otpResendSeconds: 60,
  otpMaxAttempts: 5,
  proofTtlSeconds: 600,
  sessionTtlSeconds: 3600,
  otpHmacKey: new OtpHmacKey(Buffer.alloc(32, 1)),
};
const KEY = '123e4567-e89b-42d3-a456-426614174000';
const REQUEST_ID = '323e4567-e89b-42d3-a456-426614174000';
const PROOF_ID = '423e4567-e89b-42d3-a456-426614174000';
const USER_ID = '523e4567-e89b-42d3-a456-426614174000';
const SESSION_ID = '623e4567-e89b-42d3-a456-426614174000';
const PHONE = '+84987654321';
const NOW = 1_000_000;

function input(token: string) {
  return {
    phoneNormalized: PHONE,
    password: 'very secret pw',
    verificationToken: token,
    device: { deviceId: 'dev-1', platform: 'ANDROID', app: 'SHIP11' },
  };
}

function proof(overrides: Partial<ProofForRegister> = {}): ProofForRegister {
  return {
    proofId: PROOF_ID,
    phoneNormalized: PHONE,
    purpose: 'REGISTER',
    expiresAtMs: NOW + 60_000,
    consumed: false,
    invalidated: false,
    ...overrides,
  };
}

interface Rig {
  service: RegistrationService;
  events: string[];
  captured: { request?: IdempotentRequest; work?: (context: TransactionContext) => Promise<IdempotentResult> };
  hashed: string[];
  appended: { audit: unknown[]; outbox: unknown[] };
  state: { inTransaction: boolean };
}

function rig(options: {
  knownProofId?: string | undefined;
  lockedProof?: ProofForRegister | undefined;
  userCreated?: boolean;
  replay?: {
    proof?: { invalidated: boolean } | undefined;
    user?: UserRow | undefined;
    session?: { sessionId: string; userId: string; revoked: boolean; expiresAtMs: number } | undefined;
  };
}): Rig {
  const { manager, state } = fakeTransactions(NOW);
  const events: string[] = [];
  const hashed: string[] = [];
  const appended = { audit: [] as unknown[], outbox: [] as unknown[] };
  const captured: Rig['captured'] = {};
  const knownProofId = 'knownProofId' in options ? options.knownProofId : PROOF_ID;

  const proofs = {
    findIdByDigest: async () => knownProofId,
    lockForRegister: async () => {
      events.push('proof.lock');
      return 'lockedProof' in options ? options.lockedProof : proof();
    },
    lockForReplay: async () => {
      events.push('proof.lock');
      return options.replay && 'proof' in options.replay ? options.replay.proof : { invalidated: false };
    },
    consume: async () => void events.push('proof.consume'),
  } as unknown as ProofRepository;
  const users = {
    insertRegistered: async () => {
      events.push('user.insert');
      return options.userCreated ?? true;
    },
    lockById: async () => {
      events.push('user.lock');
      return options.replay && 'user' in options.replay
        ? options.replay.user
        : ({ userId: USER_ID, phoneNormalized: PHONE, passwordHash: 'h', status: 'ACTIVE' } as UserRow);
    },
  } as unknown as UserRepository;
  const sessions = {
    create: async () => {
      events.push('session.create');
      return { sessionId: SESSION_ID, accessToken: 'T'.repeat(43) };
    },
    lockById: async () => {
      events.push('session.lock');
      return options.replay && 'session' in options.replay
        ? options.replay.session
        : { sessionId: SESSION_ID, userId: USER_ID, revoked: false, expiresAtMs: NOW + 60_000 };
    },
  } as unknown as SessionRepository;
  const audit = {
    append: async (_c: unknown, entry: unknown) => {
      events.push('audit');
      appended.audit.push(entry);
    },
  } as unknown as AuditWriter;
  const outbox = {
    append: async (_c: unknown, event: unknown) => {
      events.push('outbox');
      appended.outbox.push(event);
      return 'event-id';
    },
  } as unknown as OutboxWriter;
  const executor = {
    execute: async (request: IdempotentRequest, work: (context: TransactionContext) => Promise<IdempotentResult>) => {
      events.push(state.inTransaction ? 'executor(in-tx)' : 'executor');
      captured.request = request;
      captured.work = work;
      return { status: 201, payload: { ok: true }, replayed: false, persisted: true };
    },
  } as unknown as IdempotencyExecutor;
  const hasher: PasswordHasher = {
    hash: async (password) => {
      events.push(state.inTransaction ? 'hash(in-tx)' : 'hash');
      hashed.push(password);
      return '$argon2id$v=19$m=19456,t=2,p=1$salt$hash';
    },
    verify: async () => true,
    verifyAgainstDummy: async () => undefined,
  };

  const service = new RegistrationService(manager, executor, proofs, users, sessions, audit, outbox, CONFIG, hasher);
  return { service, events, captured, hashed, appended, state };
}

async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof AppError) {
      return error.code;
    }
    if (error instanceof TechnicalError) {
      return `TECHNICAL:${error.kind}`;
    }
    throw error;
  }
  return 'OK';
}

describe('RegistrationService.register — before the idempotency transaction (task sections 9.1, 9.2)', () => {
  it('refuses a malformed token, an unknown proof and a bad key before hashing or executing anything', async () => {
    const malformed = rig({});
    expect(await codeOf(() => malformed.service.register(input('short'), KEY, REQUEST_ID))).toBe('VERIFICATION_PROOF_INVALID');
    expect(malformed.events).toEqual([]);

    const unknown = rig({ knownProofId: undefined });
    expect(await codeOf(() => unknown.service.register(input(generateToken().token), KEY, REQUEST_ID))).toBe('VERIFICATION_PROOF_INVALID');
    expect(unknown.events).toEqual([]);

    const noKey = rig({});
    expect(await codeOf(() => noKey.service.register(input(generateToken().token), undefined, REQUEST_ID))).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(await codeOf(() => noKey.service.register(input(generateToken().token), 'not-a-uuid', REQUEST_ID))).toBe('INVALID_IDEMPOTENCY_KEY');
    expect(noKey.events).toEqual([]);
  });

  it('resolves the proof WITHOUT any state check: used, expired or mismatched proofs still reach the executor', async () => {
    const r = rig({ lockedProof: proof({ consumed: true, invalidated: true, expiresAtMs: 1 }) });
    await r.service.register(input(generateToken().token), KEY, REQUEST_ID);
    expect(r.events).toEqual(['hash', 'executor']);
  });

  it('hashes the password OUTSIDE any transaction, exactly as sent, before the executor', async () => {
    const r = rig({});
    const token = generateToken().token;
    await r.service.register({ ...input(token), password: '  untrimmed  ' }, KEY, REQUEST_ID);
    expect(r.hashed).toEqual(['  untrimmed  ']);
    expect(r.events).toEqual(['hash', 'executor']); // never "(in-tx)"
  });

  it('declares the idempotency identity and the exact logical request', async () => {
    const r = rig({});
    const token = generateToken().token;
    const outcome = await r.service.register(input(token), KEY, REQUEST_ID);
    expect(outcome).toEqual({ status: 201, payload: { ok: true }, replayed: false });
    expect(r.captured.request).toMatchObject({
      scopeType: 'verification_proof',
      scopeId: PROOF_ID,
      operationId: 'auth.register.v1',
      idempotencyKey: KEY,
      replay: { kind: 'sensitive' },
    });
    expect(r.captured.request?.logicalRequest).toEqual({
      phone_normalized: PHONE,
      password: 'very secret pw',
      verification_token: token,
      device: { device_id: 'dev-1', platform: 'ANDROID', app: 'SHIP11' },
    });
    expect(Object.keys(r.captured.request?.logicalRequest as object).sort()).toEqual([
      'device',
      'password',
      'phone_normalized',
      'verification_token',
    ]);
  });
});

describe('RegistrationService — the new-execution callback (task section 9.3)', () => {
  async function runWork(r: Rig): Promise<IdempotentResult> {
    await r.service.register(input(generateToken().token), KEY, REQUEST_ID);
    r.events.length = 0;
    return (r.captured.work as (context: TransactionContext) => Promise<IdempotentResult>)(fakeContext(NOW, r.events));
  }

  it('checks the proof under its row lock: missing, purpose, phone, used, expired, invalidated', async () => {
    const cases: Array<[string, Partial<ProofForRegister> | undefined, string]> = [
      ['missing', undefined, 'VERIFICATION_PROOF_INVALID'],
      ['purpose', { purpose: 'RESET' }, 'VERIFICATION_PURPOSE_MISMATCH'],
      ['phone', { phoneNormalized: '+84900000000' }, 'VERIFICATION_PROOF_INVALID'],
      ['used', { consumed: true }, 'VERIFICATION_PROOF_USED'],
      ['expired', { expiresAtMs: NOW }, 'VERIFICATION_PROOF_INVALID'], // equality counts as expired
      ['expired earlier', { expiresAtMs: NOW - 1 }, 'VERIFICATION_PROOF_INVALID'],
      ['invalidated', { invalidated: true }, 'VERIFICATION_PROOF_INVALID'],
    ];
    for (const [label, overrides, expected] of cases) {
      const r = rig(overrides === undefined ? { lockedProof: undefined } : { lockedProof: proof(overrides) });
      expect([label, await codeOf(() => runWork(r))]).toEqual([label, expected]);
      expect(r.events).not.toContain('user.insert');
      expect(r.events).not.toContain('session.create');
    }
  });

  it('a lost unique-phone race is PHONE_ALREADY_REGISTERED and consumes nothing', async () => {
    const r = rig({ userCreated: false });
    expect(await codeOf(() => runWork(r))).toBe('PHONE_ALREADY_REGISTERED');
    expect(r.events).toEqual(['proof.lock', 'clock', 'user.insert']);
  });

  it('on success: proof lock, user, consume, session, audit, outbox - in that order - and a 201 roleless result', async () => {
    const r = rig({});
    const result = await runWork(r);
    expect(r.events).toEqual(['proof.lock', 'clock', 'user.insert', 'proof.consume', 'session.create', 'audit', 'outbox']);
    expect(result.status).toBe(201);
    expect(Object.keys(result.replayGuard).sort()).toEqual(['proof_id', 'session_id', 'user_id']);
    expect(result.replayGuard.proof_id).toBe(PROOF_ID);
    expect(result.replayGuard.session_id).toBe(SESSION_ID);
    const payload = result.payload as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual([
      'access_token',
      'active_role',
      'available_roles',
      'onboarding_required',
      'phone_normalized',
      'user_id',
    ]);
    expect(payload.available_roles).toEqual([]);
    expect(payload.active_role).toBeNull();
    expect(payload.onboarding_required).toBe(true);
    expect(payload.access_token).toBe('T'.repeat(43));
  });

  it('audits and emits the event with safe fields only', async () => {
    const r = rig({});
    const result = await runWork(r);
    const userId = (result.payload as { user_id: string }).user_id;
    expect(r.appended.audit).toHaveLength(1);
    expect(r.appended.audit[0]).toMatchObject({
      requestId: REQUEST_ID,
      actorType: 'USER',
      actorId: userId,
      action: 'auth.register.v1',
      resourceType: 'user',
      resourceId: userId,
      resourceVersion: 1,
      outcome: 'SUCCESS',
      metadata: { session_id: SESSION_ID },
    });
    expect(r.appended.outbox).toEqual([
      {
        eventType: 'auth.user_registered.v1',
        eventSchemaVersion: 1,
        resourceType: 'user',
        resourceId: userId,
        resourceVersion: 1,
        payload: { user_id: userId },
      },
    ]);
    const everything = JSON.stringify([r.appended.audit, r.appended.outbox, result.replayGuard]);
    for (const secret of ['very secret pw', 'T'.repeat(43), PHONE, '$argon2id']) {
      expect(everything).not.toContain(secret);
    }
  });

  it('never creates a role (there is no role repository dependency at all)', () => {
    const r = rig({});
    expect(Object.keys(r.service)).not.toContain('roles');
  });
});

describe('RegistrationService — the replay authorization hook (task section 9.4)', () => {
  const GUARD = { proof_id: PROOF_ID, user_id: USER_ID, session_id: SESSION_ID };

  async function authorize(r: Rig, guard: Record<string, unknown> = GUARD): Promise<true> {
    await r.service.register(input(generateToken().token), KEY, REQUEST_ID);
    r.events.length = 0;
    const hook = (r.captured.request?.replay as { authorize: (c: TransactionContext, g: Record<string, never>) => Promise<true> }).authorize;
    return hook(fakeContext(NOW, r.events), guard as never);
  }

  it('locks proof, then user, then session, reads the clock after the locks, and allows an intact registration', async () => {
    const r = rig({});
    expect(await authorize(r)).toBe(true);
    expect(r.events).toEqual(['proof.lock', 'user.lock', 'session.lock', 'clock']);
  });

  it('natural expiry of the proof does not matter (only invalidation does)', async () => {
    const r = rig({ lockedProof: proof({ consumed: true, expiresAtMs: 1 }) });
    expect(await authorize(r)).toBe(true);
  });

  it('denies an invalidated or missing proof with VERIFICATION_PROOF_INVALID', async () => {
    expect(await codeOf(() => authorize(rig({ replay: { proof: { invalidated: true } } })))).toBe('VERIFICATION_PROOF_INVALID');
    expect(await codeOf(() => authorize(rig({ replay: { proof: undefined } })))).toBe('VERIFICATION_PROOF_INVALID');
  });

  it('denies a disabled or missing user with ACCOUNT_DISABLED', async () => {
    const disabled = { userId: USER_ID, phoneNormalized: PHONE, passwordHash: 'h', status: 'DISABLED' } as UserRow;
    expect(await codeOf(() => authorize(rig({ replay: { user: disabled } })))).toBe('ACCOUNT_DISABLED');
    expect(await codeOf(() => authorize(rig({ replay: { user: undefined } })))).toBe('ACCOUNT_DISABLED');
  });

  it('denies a revoked, missing or wrongly bound session with SESSION_REVOKED', async () => {
    const live = { sessionId: SESSION_ID, userId: USER_ID, revoked: false, expiresAtMs: NOW + 1000 };
    expect(await codeOf(() => authorize(rig({ replay: { session: { ...live, revoked: true } } })))).toBe('SESSION_REVOKED');
    expect(await codeOf(() => authorize(rig({ replay: { session: undefined } })))).toBe('SESSION_REVOKED');
    expect(
      await codeOf(() => authorize(rig({ replay: { session: { ...live, userId: '723e4567-e89b-42d3-a456-426614174000' } } }))),
    ).toBe('SESSION_REVOKED');
  });

  it('denies an expired session with SESSION_EXPIRED (equality counts as expired)', async () => {
    const at = { sessionId: SESSION_ID, userId: USER_ID, revoked: false, expiresAtMs: NOW };
    expect(await codeOf(() => authorize(rig({ replay: { session: at } })))).toBe('SESSION_EXPIRED');
    expect(await codeOf(() => authorize(rig({ replay: { session: { ...at, expiresAtMs: NOW - 1 } } })))).toBe('SESSION_EXPIRED');
    expect(await codeOf(() => authorize(rig({ replay: { session: { ...at, expiresAtMs: NOW + 1 } } })))).toBe('OK');
  });

  it('fails closed on a guard it did not write (nothing is locked, nothing decrypted)', async () => {
    for (const guard of [{}, { ...GUARD, proof_id: 'x' }, { ...GUARD, user_id: 5 }, { proof_id: PROOF_ID }]) {
      const r = rig({});
      expect(await codeOf(() => authorize(r, guard))).toBe('TECHNICAL:internal');
      expect(r.events).toEqual([]);
    }
  });

  it('matches the stored digest function used for the proof lookup', () => {
    const { token, digest } = generateToken();
    expect(digestToken(token)).toBe(digest);
  });
});
