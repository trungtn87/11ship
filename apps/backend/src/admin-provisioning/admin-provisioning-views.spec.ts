import { describe, expect, it } from '@jest/globals';
import { OperationRow } from './admin-operation-repository';
import { activationLink, maskPhone, operationView, permissionsAudit } from './admin-provisioning-views';

const BASE: OperationRow = {
  operationId: '123e4567-e89b-42d3-a456-426614174000',
  actorUserId: '223e4567-e89b-42d3-a456-426614174000',
  actorSessionId: '323e4567-e89b-42d3-a456-426614174000',
  factorId: '423e4567-e89b-42d3-a456-426614174000',
  factorVersion: 1,
  membershipVersion: 1,
  action: 'CREATE_INVITATION',
  targetId: null,
  expectedVersion: null,
  payloadFingerprint: 'a'.repeat(64),
  fingerprintKeyId: 'k1',
  status: 'VERIFIED',
  attemptCount: 0,
  expiresAtMs: 1_000_000,
  verifiedAtMs: 990_000,
  consumedAtMs: null,
  invalidatedReason: null,
};

describe('M01-D-ADMIN-1B views', () => {
  it('masks the phone like UI-06 and never returns the full number', () => {
    expect(maskPhone('+84912345101')).toBe('09•• ••• 101');
    expect(maskPhone('+84912345101')).not.toContain('2345');
    expect(maskPhone('garbage')).toBe('•• ••• •••');
  });

  it('puts the token in the fragment of the activation link', () => {
    expect(activationLink('https://admin.example.test', 'T'.repeat(43))).toBe(`https://admin.example.test/activate#t=${'T'.repeat(43)}`);
  });

  it('summarizes a permission snapshot for audit without anything personal', () => {
    expect(
      permissionsAudit([
        { app: 'CUSTOMER', canView: true, canReviewProfile: false, canLock: false },
        { app: 'SHOP', canView: true, canReviewProfile: true, canLock: true },
      ]),
    ).toEqual(['CUSTOMER:V--', 'SHOP:VRL']);
  });

  it('F5: a VERIFIED operation is usable only before expires_at AND with its bindings; status stays the stored one', () => {
    expect(operationView(BASE, 999_999, true)).toMatchObject({ status: 'VERIFIED', expired: false, usable: true, verifiable: false });
    expect(operationView(BASE, 1_000_000, true)).toMatchObject({ status: 'VERIFIED', expired: true, usable: false });
    expect(operationView(BASE, 500_000, false)).toMatchObject({ status: 'VERIFIED', expired: false, usable: false });
  });

  it('a PENDING operation is verifiable only while live, bound and under five attempts', () => {
    const pending: OperationRow = { ...BASE, status: 'PENDING', verifiedAtMs: null, attemptCount: 2 };
    expect(operationView(pending, 1, true)).toMatchObject({ verifiable: true, usable: false, attempts_remaining: 3 });
    expect(operationView(pending, 1, false)).toMatchObject({ verifiable: false });
    expect(operationView(pending, 1_000_000, true)).toMatchObject({ verifiable: false, expired: true });
    expect(operationView({ ...BASE, status: 'CONSUMED', consumedAtMs: 995_000 }, 1, true)).toMatchObject({
      verifiable: false,
      usable: false,
      attempts_remaining: null,
    });
  });
});
