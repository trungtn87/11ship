import { describe, expect, it, jest } from '@jest/globals';
import { TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { AccountOriginPolicy, createAccountOriginPolicy } from './account-origin';
import { CUSTOMER_ROLE, SUPPORTED_ROLES } from './auth-constants';
import { ConsentRecord, CustomerEligibility, CustomerProfileRepository } from './customer-profile-repository';
import { CustomerConsentInput, CustomerProvisioningParticipant } from './customer-provisioning-participant';
import { UserRepository } from './user-repository';

// M01.02 — the participant that gives an ordinary phone-verified account the CUSTOMER role, an empty profile and (when
// asked) one consent row. It runs on the CALLER's transaction: it must never be able to commit, it must refuse every
// account that is not an ordinary verified one before it writes anything, and a repeat must add and overwrite nothing.

const CONTEXT = { isActive: true, query: async () => ({ rows: [], rowCount: 0 }) } as TransactionContext;
const USER_ID = '11111111-1111-4111-8111-111111111111';
const CONSENT: CustomerConsentInput = { termsVersion: 'terms-2026.10', privacyVersion: 'privacy_1.0', clientApp: 'FOOD' };
const ELIGIBLE: CustomerEligibility = { accountOrigin: 'PHONE_VERIFIED', phoneVerified: true, hasAdminMembership: false };

// null stands for "no such user" (an explicit undefined would pick the default eligible account).
function rig(eligibility: CustomerEligibility | null = ELIGIBLE, policy?: AccountOriginPolicy) {
  const lockEligibility = jest.fn<(context: TransactionContext, userId: string) => Promise<CustomerEligibility | undefined>>(
    async () => eligibility ?? undefined,
  );
  const insertProfileIfAbsent = jest.fn<(context: TransactionContext, userId: string, initialFullName?: string) => Promise<boolean>>(
    async () => true,
  );
  const insertConsentIfAbsent = jest.fn<(context: TransactionContext, input: ConsentRecord) => Promise<boolean>>(async () => true);
  const grantRole = jest.fn<(context: TransactionContext, userId: string, role: string) => Promise<boolean>>(async () => true);
  const participant = new CustomerProvisioningParticipant(
    { grantRole } as unknown as UserRepository,
    { lockEligibility, insertProfileIfAbsent, insertConsentIfAbsent } as unknown as CustomerProfileRepository,
    policy,
  );
  return { participant, lockEligibility, insertProfileIfAbsent, insertConsentIfAbsent, grantRole };
}

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

describe('CustomerProvisioningParticipant.provision — eligible account', () => {
  it('grants CUSTOMER, creates the profile and reports exactly what this call created', async () => {
    const { participant, lockEligibility, grantRole, insertProfileIfAbsent, insertConsentIfAbsent } = rig();
    await expect(participant.provision(CONTEXT, USER_ID)).resolves.toEqual({
      roleGranted: true,
      profileCreated: true,
      consentRecorded: false,
    });
    expect(lockEligibility).toHaveBeenCalledWith(CONTEXT, USER_ID);
    expect(grantRole).toHaveBeenCalledWith(CONTEXT, USER_ID, CUSTOMER_ROLE);
    expect(insertProfileIfAbsent).toHaveBeenCalledWith(CONTEXT, USER_ID);
    // No consent was asked for, so none is written (and none is ever invented).
    expect(insertConsentIfAbsent).not.toHaveBeenCalled();
  });

  it('records the consent with a server-made UUID, the exact versions and the client app', async () => {
    const { participant, insertConsentIfAbsent } = rig();
    await expect(participant.provision(CONTEXT, USER_ID, CONSENT)).resolves.toEqual({
      roleGranted: true,
      profileCreated: true,
      consentRecorded: true,
    });
    expect(insertConsentIfAbsent).toHaveBeenCalledTimes(1);
    const record = insertConsentIfAbsent.mock.calls[0]?.[1] as ConsentRecord;
    expect(record.consentId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect({ ...record, consentId: 'x' }).toEqual({
      consentId: 'x',
      userId: USER_ID,
      termsVersion: 'terms-2026.10',
      privacyVersion: 'privacy_1.0',
      clientApp: 'FOOD',
    });
  });

  it('is idempotent: when everything already exists nothing is reported as created and nothing throws', async () => {
    const { participant, grantRole, insertProfileIfAbsent, insertConsentIfAbsent } = rig();
    grantRole.mockResolvedValue(false);
    insertProfileIfAbsent.mockResolvedValue(false);
    insertConsentIfAbsent.mockResolvedValue(false);
    await expect(participant.provision(CONTEXT, USER_ID, CONSENT)).resolves.toEqual({
      roleGranted: false,
      profileCreated: false,
      consentRecorded: false,
    });
  });

  it('checks eligibility (and takes the root user lock) BEFORE any write', async () => {
    const { participant, lockEligibility, grantRole, insertProfileIfAbsent, insertConsentIfAbsent } = rig();
    await participant.provision(CONTEXT, USER_ID, CONSENT);
    const lockOrder = lockEligibility.mock.invocationCallOrder[0] as number;
    for (const write of [grantRole, insertProfileIfAbsent, insertConsentIfAbsent]) {
      expect(lockOrder).toBeLessThan(write.mock.invocationCallOrder[0] as number);
    }
  });

  it('accepts the longest legal version tokens (64 characters) and both client apps', async () => {
    const { participant, insertConsentIfAbsent } = rig();
    const long = 'a.B-9_'.repeat(10) + 'abcd';
    expect(long).toHaveLength(64);
    await participant.provision(CONTEXT, USER_ID, { termsVersion: long, privacyVersion: long, clientApp: 'SHIP' });
    expect((insertConsentIfAbsent.mock.calls[0]?.[1] as ConsentRecord).clientApp).toBe('SHIP');
  });

  it('lets a repository failure through unchanged so the caller rolls everything back', async () => {
    const { participant, insertProfileIfAbsent } = rig();
    const failure = new Error('write failed');
    insertProfileIfAbsent.mockRejectedValueOnce(failure);
    await expect(participant.provision(CONTEXT, USER_ID)).rejects.toBe(failure);
  });
});

describe('CustomerProvisioningParticipant.provision — accounts that must never become customers', () => {
  const cases: ReadonlyArray<readonly [string, CustomerEligibility | null]> = [
    ['an unknown user', null],
    ['an administration-provisioned account', { accountOrigin: 'ADMIN_PROVISIONED', phoneVerified: false, hasAdminMembership: true }],
    ['an administration-provisioned account without a membership', { accountOrigin: 'ADMIN_PROVISIONED', phoneVerified: false, hasAdminMembership: false }],
    ['a fixture origin', { accountOrigin: 'STAGING_FIXTURE', phoneVerified: false, hasAdminMembership: false }],
    ['a phone-verified account without a verification time', { accountOrigin: 'PHONE_VERIFIED', phoneVerified: false, hasAdminMembership: false }],
    ['a phone-verified account that holds an administration membership', { accountOrigin: 'PHONE_VERIFIED', phoneVerified: true, hasAdminMembership: true }],
  ];

  it.each(cases)('refuses %s as a programming error and writes nothing', async (_name, eligibility) => {
    const { participant, grantRole, insertProfileIfAbsent, insertConsentIfAbsent } = rig(eligibility);
    const failure = await failureOf(participant.provision(CONTEXT, USER_ID, CONSENT));
    expect(failure).toBeInstanceOf(TechnicalError);
    expect((failure as TechnicalError).kind).toBe('internal');
    expect(grantRole).not.toHaveBeenCalled();
    expect(insertProfileIfAbsent).not.toHaveBeenCalled();
    expect(insertConsentIfAbsent).not.toHaveBeenCalled();
  });

  it('never echoes the user id or any input in its error message', async () => {
    const { participant } = rig(null);
    const failure = (await failureOf(participant.provision(CONTEXT, USER_ID, CONSENT))) as TechnicalError;
    expect(failure.message).not.toContain(USER_ID);
    expect(failure.message).not.toContain(CONSENT.termsVersion);
  });
});

describe('CustomerProvisioningParticipant.provision — malformed input is refused before the database is touched', () => {
  it.each(['', 'not-a-uuid', 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA', `${USER_ID} `, '11111111-1111-4111-8111-11111111111'])(
    'refuses the user id %p',
    async (userId) => {
      const { participant, lockEligibility, grantRole } = rig();
      const failure = await failureOf(participant.provision(CONTEXT, userId));
      expect(failure).toBeInstanceOf(TechnicalError);
      expect((failure as TechnicalError).kind).toBe('internal');
      expect(lockEligibility).not.toHaveBeenCalled();
      expect(grantRole).not.toHaveBeenCalled();
    },
  );

  const badConsents: ReadonlyArray<readonly [string, Partial<Record<keyof CustomerConsentInput, string>>]> = [
    ['an empty terms version', { termsVersion: '' }],
    ['a terms version with a space', { termsVersion: 'terms 1' }],
    ['a terms version with a slash', { termsVersion: 'a/b' }],
    ['a terms version with a trailing newline', { termsVersion: '1.0\n' }],
    ['a terms version of 65 characters', { termsVersion: 'a'.repeat(65) }],
    ['an empty privacy version', { privacyVersion: '' }],
    ['a privacy version with a non-ASCII letter', { privacyVersion: 'phiên-bản' }],
    ['a privacy version of 65 characters', { privacyVersion: 'a'.repeat(65) }],
    ['the client app WEB', { clientApp: 'WEB' }],
    ['a lower-case client app', { clientApp: 'food' }],
    ['an empty client app', { clientApp: '' }],
    ['a client app with a trailing space', { clientApp: 'SHIP ' }],
  ];

  it.each(badConsents)('refuses %s', async (_name, override) => {
    const { participant, lockEligibility, grantRole, insertProfileIfAbsent, insertConsentIfAbsent } = rig();
    const consent = { ...CONSENT, ...override } as unknown as CustomerConsentInput;
    const failure = await failureOf(participant.provision(CONTEXT, USER_ID, consent));
    expect(failure).toBeInstanceOf(TechnicalError);
    expect((failure as TechnicalError).kind).toBe('internal');
    // Not even the lock is taken, and no role or profile is written without the consent that was asked for.
    expect(lockEligibility).not.toHaveBeenCalled();
    expect(grantRole).not.toHaveBeenCalled();
    expect(insertProfileIfAbsent).not.toHaveBeenCalled();
    expect(insertConsentIfAbsent).not.toHaveBeenCalled();
  });
});

describe('CustomerProvisioningParticipant.provision — initial name of a NEW profile (M01.03)', () => {
  it('hands the already normalized name to the profile initialization together with the user id', async () => {
    const { participant, insertProfileIfAbsent } = rig();
    await expect(participant.provision(CONTEXT, USER_ID, CONSENT, { initialFullName: 'Nguyễn Văn A' })).resolves.toEqual({
      roleGranted: true,
      profileCreated: true,
      consentRecorded: true,
    });
    expect(insertProfileIfAbsent).toHaveBeenCalledWith(CONTEXT, USER_ID, 'Nguyễn Văn A');
  });

  it('keeps the exact M01.02 call (no third argument) when no initial name is given', async () => {
    const { participant, insertProfileIfAbsent } = rig();
    await participant.provision(CONTEXT, USER_ID, CONSENT, {});
    expect(insertProfileIfAbsent).toHaveBeenCalledWith(CONTEXT, USER_ID);
    expect(insertProfileIfAbsent.mock.calls[0]).toHaveLength(2);
  });

  it('reports the profile as NOT created when one already exists: the repository never overwrites it', async () => {
    const { participant, insertProfileIfAbsent } = rig();
    insertProfileIfAbsent.mockResolvedValue(false);
    await expect(participant.provision(CONTEXT, USER_ID, CONSENT, { initialFullName: 'Tên Mới' })).resolves.toMatchObject({
      profileCreated: false,
    });
  });

  it.each([['an empty name', ''], ['a name of 121 code points', 'a'.repeat(121)]])(
    'refuses %s before the lock or any write',
    async (_label, initialFullName) => {
      const { participant, lockEligibility, grantRole, insertProfileIfAbsent } = rig();
      const failure = await failureOf(participant.provision(CONTEXT, USER_ID, CONSENT, { initialFullName }));
      expect(failure).toBeInstanceOf(TechnicalError);
      expect(lockEligibility).not.toHaveBeenCalled();
      expect(grantRole).not.toHaveBeenCalled();
      expect(insertProfileIfAbsent).not.toHaveBeenCalled();
    },
  );

  it('counts the length in code points, so 120 astral characters are accepted', async () => {
    const { participant, insertProfileIfAbsent } = rig();
    const name = '𝒜'.repeat(120);
    expect(name.length).toBe(240);
    await participant.provision(CONTEXT, USER_ID, CONSENT, { initialFullName: name });
    expect(insertProfileIfAbsent).toHaveBeenCalledWith(CONTEXT, USER_ID, name);
  });
});

describe('CustomerProvisioningParticipant — boundaries', () => {
  it('has no way to commit, roll back or open a transaction: it only calls query-shaped repository methods', () => {
    const { participant } = rig();
    const members = Object.getOwnPropertyNames(Object.getPrototypeOf(participant));
    expect(members.sort()).toEqual(['constructor', 'provision']);
  });

  it('does not widen the legacy selectable roles: CUSTOMER is a storage role, not a SUPPORTED_ROLES entry', () => {
    expect([...SUPPORTED_ROLES]).toEqual(['DRIVER', 'SHOP']);
    expect(CUSTOMER_ROLE).toBe('CUSTOMER');
  });
});

// No-OTP test registration: a TEST_UNVERIFIED account (phone_verified_at NULL) is provisioned only while the validated no-proof
// test policy is on; a verification time on it, an admin membership, or the policy being off refuses it before any write.
describe('CustomerProvisioningParticipant.provision — TEST_UNVERIFIED account', () => {
  const TEST_ACCOUNT: CustomerEligibility = { accountOrigin: 'TEST_UNVERIFIED', phoneVerified: false, hasAdminMembership: false };
  const testPolicy = createAccountOriginPolicy({ appEnv: 'test', fixtureModeEnabled: false, allowedPhones: undefined, unverifiedTestModeEnabled: true });

  it('is provisioned under the no-proof test policy', async () => {
    const { participant, grantRole, insertProfileIfAbsent } = rig(TEST_ACCOUNT, testPolicy);
    await expect(participant.provision(CONTEXT, USER_ID, CONSENT, { initialFullName: 'Nguyễn Văn An' })).resolves.toEqual({
      roleGranted: true,
      profileCreated: true,
      consentRecorded: true,
    });
    expect(grantRole).toHaveBeenCalledWith(CONTEXT, USER_ID, CUSTOMER_ROLE);
    expect(insertProfileIfAbsent).toHaveBeenCalledWith(CONTEXT, USER_ID, 'Nguyễn Văn An');
  });

  it('is refused without the policy (the default policy, or the mode switched off), before any write', async () => {
    for (const policy of [
      undefined,
      createAccountOriginPolicy({ appEnv: 'test', fixtureModeEnabled: false, allowedPhones: undefined, unverifiedTestModeEnabled: false }),
      // The mode is honoured for development/test only, whatever else is passed.
      createAccountOriginPolicy({ appEnv: 'production', fixtureModeEnabled: false, allowedPhones: undefined, unverifiedTestModeEnabled: true }),
      createAccountOriginPolicy({ appEnv: 'staging', fixtureModeEnabled: false, allowedPhones: undefined, unverifiedTestModeEnabled: true }),
    ]) {
      const { participant, grantRole, insertProfileIfAbsent, insertConsentIfAbsent } = rig(TEST_ACCOUNT, policy);
      expect(await failureOf(participant.provision(CONTEXT, USER_ID, CONSENT))).toBeInstanceOf(TechnicalError);
      expect(grantRole).not.toHaveBeenCalled();
      expect(insertProfileIfAbsent).not.toHaveBeenCalled();
      expect(insertConsentIfAbsent).not.toHaveBeenCalled();
    }
  });

  it('refuses a TEST_UNVERIFIED row that carries a verification time or an administration membership, even under the policy', async () => {
    for (const eligibility of [
      { ...TEST_ACCOUNT, phoneVerified: true },
      { ...TEST_ACCOUNT, hasAdminMembership: true },
    ]) {
      const { participant, grantRole } = rig(eligibility, testPolicy);
      expect(await failureOf(participant.provision(CONTEXT, USER_ID, CONSENT))).toBeInstanceOf(TechnicalError);
      expect(grantRole).not.toHaveBeenCalled();
    }
  });
});
