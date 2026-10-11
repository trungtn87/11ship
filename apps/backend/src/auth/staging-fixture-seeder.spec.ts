import { describe, expect, it } from '@jest/globals';
import { MAX_STAGING_ALLOWED_PHONES, PhoneAllowlist } from '../config/staging-fixtures-config';
import { TransactionContext } from '../transaction/transaction-context';
import { AccountOrigin } from './account-origin';
import { AUDIT_ACTIONS } from './auth-constants';
import { PasswordHasher } from './password-hasher';
import { parseSeedPayload, StagingFixtureSeeder, StagingSeedConflictError } from './staging-fixture-seeder';
import { UserRepository } from './user-repository';

const P1 = '+84901000001';
const P2 = '+84901000002';
const P3 = '+84901000003';
const PASSWORD = 'Correct-Horse-Battery-9';
const ALLOW = new PhoneAllowlist([P1, P2, P3]);

describe('parseSeedPayload', () => {
  const ok = (raw: unknown) => parseSeedPayload(raw, ALLOW);

  it('accepts 1..20 exact {phone, password} objects whose phones are normalized, unique and allowlisted', () => {
    expect(ok([{ phone: P1, password: PASSWORD }, { phone: P2, password: PASSWORD }])).toEqual({
      ok: true,
      entries: [
        { phoneNormalized: P1, password: PASSWORD },
        { phoneNormalized: P2, password: PASSWORD },
      ],
    });
  });

  it.each([
    ['an object instead of an array', { phone: P1, password: PASSWORD }, 'SHAPE'],
    ['a string', 'x', 'SHAPE'],
    ['an empty array', [], 'EMPTY'],
    ['more than the allowlist maximum', Array.from({ length: MAX_STAGING_ALLOWED_PHONES + 1 }, () => ({ phone: P1, password: PASSWORD })), 'TOO_MANY'],
    ['a null item', [null], 'SHAPE'],
    ['an extra key (origin)', [{ phone: P1, password: PASSWORD, account_origin: 'PHONE_VERIFIED' }], 'SHAPE'],
    ['an extra key (role)', [{ phone: P1, password: PASSWORD, role: 'ADMIN' }], 'SHAPE'],
    ['a missing password', [{ phone: P1 }], 'SHAPE'],
    ['a local-form phone', [{ phone: '0901000001', password: PASSWORD }], 'PHONE_INVALID'],
    ['a non-string phone', [{ phone: 84901000001, password: PASSWORD }], 'PHONE_INVALID'],
    ['a phone outside the allowlist', [{ phone: '+84901000099', password: PASSWORD }], 'PHONE_NOT_ALLOWED'],
    ['a duplicate phone', [{ phone: P1, password: PASSWORD }, { phone: P1, password: PASSWORD }], 'PHONE_DUPLICATE'],
    ['a weak password', [{ phone: P1, password: 'short' }], 'PASSWORD_INVALID'],
    ['a non-string password', [{ phone: P1, password: 12345678901234 }], 'PASSWORD_INVALID'],
  ])('refuses %s with the fixed code %s and echoes nothing', (_name, raw, problem) => {
    const result = ok(raw);
    expect(result).toEqual({ ok: false, problem });
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
    expect(JSON.stringify(result)).not.toContain('+84');
  });
});

interface Stored {
  userId: string;
  phoneNormalized: string;
  passwordHash: string;
  accountOrigin: AccountOrigin;
}

function rig(options: { existing?: Stored[]; failAuditAt?: number; raceOn?: string } = {}) {
  const rows = new Map<string, Stored>((options.existing ?? []).map((row) => [row.phoneNormalized, row]));
  const queries: string[] = [];
  const audits: Array<Record<string, unknown>> = [];
  let hashed = 0;
  let inserted = 0;
  const users = {
    findByPhone: async (_context: unknown, phone: string) => rows.get(phone),
    insertStagingFixture: async (_context: unknown, input: { userId: string; phoneNormalized: string; passwordHash: string }) => {
      inserted += 1;
      if (options.raceOn === input.phoneNormalized) {
        // A concurrent registration took the phone between our SELECT and INSERT.
        rows.set(input.phoneNormalized, { ...input, accountOrigin: 'PHONE_VERIFIED' });
        return false;
      }
      rows.set(input.phoneNormalized, { ...input, accountOrigin: 'STAGING_FIXTURE' });
      return true;
    },
  } as unknown as UserRepository;
  const audit = {
    append: async (_context: unknown, entry: Record<string, unknown>) => {
      if (options.failAuditAt !== undefined && audits.length + 1 === options.failAuditAt) {
        throw new Error('audit down');
      }
      audits.push(entry);
    },
  };
  const hasher: PasswordHasher = {
    hash: async (plain: string) => {
      hashed += 1;
      return `$argon2id$test$${plain.length}$${hashed}`;
    },
    verify: async () => false,
    verifyAgainstDummy: async () => undefined,
  } as unknown as PasswordHasher;
  let counter = 0;
  const seeder = new StagingFixtureSeeder(users, audit as never, hasher, () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`);
  const context = { query: async (sql: string) => { queries.push(sql); return { rows: [], rowCount: 0 }; } } as unknown as TransactionContext;
  return { seeder, context, rows, audits, queries, inserted: () => inserted, hashed: () => hashed };
}

describe('StagingFixtureSeeder', () => {
  it('prepare hashes every password (outside any transaction) and orders the batch by phone', async () => {
    const { seeder, hashed } = rig();
    const prepared = await seeder.prepare([
      { phoneNormalized: P3, password: PASSWORD },
      { phoneNormalized: P1, password: PASSWORD },
    ]);
    expect(prepared.map((p) => p.phoneNormalized)).toEqual([P1, P3]);
    expect(prepared.every((p) => p.passwordHash.startsWith('$argon2id$'))).toBe(true);
    expect(prepared.some((p) => p.passwordHash.includes(PASSWORD))).toBe(false);
    expect(hashed()).toBe(2);
  });

  it('takes the fixed advisory lock FIRST, then inserts and audits each new fixture with the operator actor', async () => {
    const { seeder, context, queries, audits, rows } = rig();
    const prepared = await seeder.prepare([{ phoneNormalized: P1, password: PASSWORD }, { phoneNormalized: P2, password: PASSWORD }]);
    const result = await seeder.seed(context, prepared, '11111111-1111-4111-8111-111111111111');
    expect(result).toEqual({ created: 2, skipped: 0 });
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain('pg_advisory_xact_lock');
    expect([...rows.values()].map((r) => r.accountOrigin)).toEqual(['STAGING_FIXTURE', 'STAGING_FIXTURE']);
    expect(audits).toHaveLength(2);
    for (const entry of audits) {
      expect(entry).toMatchObject({
        action: AUDIT_ACTIONS.stagingFixtureCreated,
        actorType: 'OPERATOR',
        actorId: 'staging-seed-cli',
        resourceType: 'user',
        outcome: 'SUCCESS',
        requestId: '11111111-1111-4111-8111-111111111111',
      });
      expect(JSON.stringify(entry)).not.toContain('+84');
    }
    expect(AUDIT_ACTIONS.stagingFixtureCreated).toBe('auth.staging_fixture_created.v1');
  });

  it('an existing fixture is skipped untouched: no insert, no audit', async () => {
    const existing: Stored = { userId: 'u1', phoneNormalized: P1, passwordHash: '$argon2id$old', accountOrigin: 'STAGING_FIXTURE' };
    const { seeder, context, rows, audits, inserted } = rig({ existing: [existing] });
    const prepared = await seeder.prepare([{ phoneNormalized: P1, password: 'Another-Passw0rd-Entirely' }]);
    expect(await seeder.seed(context, prepared, '11111111-1111-4111-8111-111111111111')).toEqual({ created: 0, skipped: 1 });
    expect(rows.get(P1)).toEqual(existing);
    expect(audits).toEqual([]);
    expect(inserted()).toBe(0);
  });

  it('a verified account in the batch throws the conflict error (the caller rolls the whole batch back)', async () => {
    const verified: Stored = { userId: 'u1', phoneNormalized: P2, passwordHash: '$argon2id$old', accountOrigin: 'PHONE_VERIFIED' };
    const { seeder, context, rows } = rig({ existing: [verified] });
    const prepared = await seeder.prepare([{ phoneNormalized: P1, password: PASSWORD }, { phoneNormalized: P2, password: PASSWORD }]);
    await expect(seeder.seed(context, prepared, '11111111-1111-4111-8111-111111111111')).rejects.toBeInstanceOf(StagingSeedConflictError);
    expect(rows.get(P2)).toEqual(verified);
    const error = await seeder.seed(context, prepared, '11111111-1111-4111-8111-111111111111').catch((e: Error) => e);
    expect((error as Error).message).not.toContain('+84');
  });

  it('an administration account on an allowlisted phone is also the conflict error, and is never touched', async () => {
    const admin: Stored = { userId: 'u9', phoneNormalized: P2, passwordHash: '$argon2id$admin', accountOrigin: 'ADMIN_PROVISIONED' };
    const { seeder, context, rows, audits } = rig({ existing: [admin] });
    const prepared = await seeder.prepare([{ phoneNormalized: P2, password: PASSWORD }]);
    await expect(seeder.seed(context, prepared, '11111111-1111-4111-8111-111111111111')).rejects.toBeInstanceOf(StagingSeedConflictError);
    expect(rows.get(P2)).toEqual(admin);
    expect(audits).toEqual([]);
  });

  it('losing the insert race to a verified registration is also the conflict error', async () => {
    const lostToVerified = rig({ raceOn: P1 });
    const prepared = await lostToVerified.seeder.prepare([{ phoneNormalized: P1, password: PASSWORD }]);
    await expect(lostToVerified.seeder.seed(lostToVerified.context, prepared, '11111111-1111-4111-8111-111111111111')).rejects.toBeInstanceOf(
      StagingSeedConflictError,
    );
  });

  it('an audit failure propagates (the user insert shares the transaction, so it rolls back with it)', async () => {
    const { seeder, context } = rig({ failAuditAt: 2 });
    const prepared = await seeder.prepare([{ phoneNormalized: P1, password: PASSWORD }, { phoneNormalized: P2, password: PASSWORD }]);
    await expect(seeder.seed(context, prepared, '11111111-1111-4111-8111-111111111111')).rejects.toThrow('audit down');
  });
});
