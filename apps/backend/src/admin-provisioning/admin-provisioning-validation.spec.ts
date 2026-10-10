import { describe, expect, it } from '@jest/globals';
import { AppError } from '../common/app-errors';
import {
  canonicalPayload,
  encodeCursor,
  OperationRequest,
  parseCreateInvitationBody,
  parseListQuery,
  parseOperationBody,
  parsePermissions,
  parseReissueBody,
  parseRevokeBody,
  parseUuid,
  parseVerifyBody,
} from './admin-provisioning-validation';

const ID = '123e4567-e89b-42d3-a456-426614174000';
const OP = '223e4567-e89b-42d3-a456-426614174000';
const SHOP = { app: 'SHOP', can_view: true, can_review_profile: false, can_lock: true };
const CUSTOMER = { app: 'CUSTOMER', can_view: true, can_review_profile: false, can_lock: false };
const CREATE = { full_name: '  Trần Thị B  ', phone: '0912345678', note: '', permissions: [SHOP, CUSTOMER] };

function inputInvalid(run: () => unknown): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('ADMIN_INPUT_INVALID');
    expect((error as AppError).message).not.toContain('0912345678');
    return;
  }
  throw new Error('expected ADMIN_INPUT_INVALID');
}

describe('M01-D-ADMIN-1B parser (contract 6.1)', () => {
  it('normalizes a create payload: trimmed name, +84 phone, empty note -> null, permissions sorted by app', () => {
    const request = parseOperationBody({ action: 'CREATE_INVITATION', payload: CREATE });
    expect(request.action).toBe('CREATE_INVITATION');
    expect(canonicalPayload(request)).toEqual({
      full_name: 'Trần Thị B',
      phone: '+84912345678',
      note: null,
      permissions: [
        { app: 'CUSTOMER', can_view: true, can_review_profile: false, can_lock: false },
        { app: 'SHOP', can_view: true, can_review_profile: false, can_lock: true },
      ],
    });
  });

  it('gives the create-operation payload and the create route the SAME canonical payload (same fingerprint input)', () => {
    const fromOperation = parseOperationBody({ action: 'CREATE_INVITATION', payload: CREATE });
    const fromRoute = parseCreateInvitationBody({ operation_id: OP, ...CREATE });
    expect(fromRoute.operationId).toBe(OP);
    expect(canonicalPayload({ action: 'CREATE_INVITATION', payload: fromRoute.payload })).toEqual(canonicalPayload(fromOperation));
  });

  it('reissue: an absent permissions key means "copy" (null), a present one a new sorted snapshot (Q1, F4)', () => {
    const copy = parseReissueBody(ID, { operation_id: OP, expected_version: 2, reason: ' lost ' });
    expect(copy.payload).toEqual({ invitationId: ID, expectedVersion: 2, reason: 'lost', permissions: null });
    expect(canonicalPayload({ action: 'REISSUE_INVITATION', payload: copy.payload })).toEqual({
      invitation_id: ID,
      expected_version: 2,
      reason: 'lost',
      permissions: null,
    });
    const explicit = parseReissueBody(ID, { operation_id: OP, expected_version: 2, reason: 'lost', permissions: [SHOP] });
    expect(canonicalPayload({ action: 'REISSUE_INVITATION', payload: explicit.payload })).not.toEqual(
      canonicalPayload({ action: 'REISSUE_INVITATION', payload: copy.payload }),
    );
    const viaOperation = parseOperationBody({
      action: 'REISSUE_INVITATION',
      payload: { invitation_id: ID, expected_version: 2, reason: 'lost', permissions: [SHOP] },
    });
    expect(canonicalPayload(viaOperation)).toEqual(canonicalPayload({ action: 'REISSUE_INVITATION', payload: explicit.payload }));
  });

  it.each([
    ['explicit null permissions', { permissions: null }],
    ['an empty permission list', { permissions: [] }],
    ['a name (never changed by a reissue)', { full_name: 'A' }],
    ['a phone', { phone: '0912345678' }],
    ['a note', { note: 'x' }],
  ])('reissue refuses %s', (_name, extra) => {
    inputInvalid(() => parseReissueBody(ID, { operation_id: OP, expected_version: 1, reason: 'r', ...extra }));
  });

  it('revoke accepts exactly operation_id, expected_version and reason', () => {
    expect(parseRevokeBody(ID, { operation_id: OP, expected_version: 3, reason: 'r' }).payload).toEqual({
      invitationId: ID,
      expectedVersion: 3,
      reason: 'r',
    });
    inputInvalid(() => parseRevokeBody(ID, { operation_id: OP, expected_version: 3, reason: 'r', permissions: [SHOP] }));
    inputInvalid(() => parseRevokeBody('not-a-uuid', { operation_id: OP, expected_version: 3, reason: 'r' }));
  });

  it.each([
    ['not an object', () => parseOperationBody([])],
    ['an unknown action', () => parseOperationBody({ action: 'X', payload: CREATE })],
    ['an extra root key', () => parseOperationBody({ action: 'CREATE_INVITATION', payload: CREATE, extra: 1 })],
    ['a client role', () => parseOperationBody({ action: 'CREATE_INVITATION', payload: { ...CREATE, role: 'SYSTEM' } })],
    ['a client token', () => parseCreateInvitationBody({ operation_id: OP, ...CREATE, token: 'x' })],
    ['a client account_origin', () => parseCreateInvitationBody({ operation_id: OP, ...CREATE, account_origin: 'x' })],
    ['a missing operation id', () => parseCreateInvitationBody({ ...CREATE })],
    ['a nil operation id', () => parseCreateInvitationBody({ operation_id: '00000000-0000-0000-0000-000000000000', ...CREATE })],
    ['a 121 code-point name', () => parseCreateInvitationBody({ operation_id: OP, ...CREATE, full_name: 'ắ'.repeat(121) })],
    ['a number as name', () => parseCreateInvitationBody({ operation_id: OP, ...CREATE, full_name: 5 })],
    ['a landline', () => parseCreateInvitationBody({ operation_id: OP, ...CREATE, phone: '02812345678' })],
    ['a version 0', () => parseRevokeBody(ID, { operation_id: OP, expected_version: 0, reason: 'r' })],
    ['a fractional version', () => parseRevokeBody(ID, { operation_id: OP, expected_version: 1.5, reason: 'r' })],
  ])('refuses %s with ADMIN_INPUT_INVALID', (_name, run) => {
    inputInvalid(run);
  });

  it('accepts exactly 120 code points of a name and 500 of a reason', () => {
    expect(parseCreateInvitationBody({ operation_id: OP, ...CREATE, full_name: 'ắ'.repeat(120) }).payload.fullName).toHaveLength(120);
    expect(parseRevokeBody(ID, { operation_id: OP, expected_version: 1, reason: 'r'.repeat(500) }).payload.reason).toHaveLength(500);
    inputInvalid(() => parseRevokeBody(ID, { operation_id: OP, expected_version: 1, reason: 'r'.repeat(501) }));
  });

  it.each([
    [[{ ...SHOP, can_view: false }]],
    [[{ app: 'CUSTOMER', can_view: true, can_review_profile: true, can_lock: false }]],
    [[SHOP, SHOP]],
    [[{ app: 'ADMIN', can_view: true, can_review_profile: false, can_lock: false }]],
    [[{ app: 'SHOP', can_view: true, can_review_profile: false }]],
    [[{ ...SHOP, can_view: 'true' }]],
    [[SHOP, CUSTOMER, { app: 'DRIVER', can_view: true, can_review_profile: false, can_lock: false }, SHOP]],
    [[{ app: 'SHOP', can_view: false, can_review_profile: false, can_lock: false }]],
  ])('refuses the permission list %j', (list) => {
    inputInvalid(() => parsePermissions(list));
  });

  it('verify body is exactly six ASCII digits', () => {
    expect(parseVerifyBody({ code: '012345' })).toBe('012345');
    for (const body of [{ code: '12345' }, { code: '1234567' }, { code: ' 12345' }, { code: 123456 }, { code: '١٢٣٤٥٦' }, {}, null]) {
      inputInvalid(() => parseVerifyBody(body));
    }
  });

  it('ids are canonical lower-case UUIDs', () => {
    expect(parseUuid(ID)).toBe(ID);
    inputInvalid(() => parseUuid(ID.toUpperCase()));
    inputInvalid(() => parseUuid(`${ID} `));
  });

  it('list query: defaults, bounds, status, and only server-issued cursors round-trip', () => {
    expect(parseListQuery({})).toEqual({ status: null, limit: 20, cursor: null });
    expect(parseListQuery({ limit: '50', status: 'PENDING' })).toMatchObject({ limit: 50, status: 'PENDING' });
    const cursor = encodeCursor({ createdAtMs: 1760000000123, invitationId: ID });
    expect(parseListQuery({ cursor }).cursor).toEqual({ createdAtMs: 1760000000123, invitationId: ID });
    for (const query of [{ limit: '0' }, { limit: '51' }, { limit: '05' }, { status: 'DELETED' }, { cursor: 'abc' }, { limit: ['1', '2'] }, { page: '1' }]) {
      inputInvalid(() => parseListQuery(query));
    }
    inputInvalid(() => parseListQuery({ cursor: Buffer.from(JSON.stringify([-1, ID])).toString('base64url') }));
    inputInvalid(() => parseListQuery({ cursor: Buffer.from(JSON.stringify([1, ID.toUpperCase()])).toString('base64url') }));
  });

  it('the canonical payload of a revoke has no permissions key', () => {
    const request: OperationRequest = parseOperationBody({
      action: 'REVOKE_INVITATION',
      payload: { invitation_id: ID, expected_version: 1, reason: 'r' },
    });
    expect(Object.keys(canonicalPayload(request)).sort()).toEqual(['expected_version', 'invitation_id', 'reason']);
  });
});
