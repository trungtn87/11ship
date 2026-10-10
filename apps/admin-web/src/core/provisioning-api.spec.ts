import { describe, expect, it } from '@jest/globals';
import { businessBody, operationPayload, OperationRequest } from './provisioning-api';
import { FakeServer, INVITATION_ID, KEY_1, LINK, OPERATION_ID, fail, invitationWire, issuedCreated, issuedReissued, listOk, ok, operationCreated, operationVerified, operationView, permissionWire, revokedOk } from './test-support';

const create: OperationRequest = {
  action: 'CREATE_INVITATION',
  fullName: 'Nguyễn Văn A',
  phone: '0912345678',
  note: null,
  permissions: [{ app: 'SHOP', canView: true, canReviewProfile: true, canLock: false }],
};

describe('admin web 1B client - wire shapes', () => {
  it('the operation payload and the business body carry the same snake_case fields (no drift)', () => {
    expect(operationPayload(create)).toEqual({
      full_name: 'Nguyễn Văn A',
      phone: '0912345678',
      permissions: [{ app: 'SHOP', can_view: true, can_review_profile: true, can_lock: false }],
    });
    expect(businessBody(OPERATION_ID, create)).toEqual({ operation_id: OPERATION_ID, ...operationPayload(create) });
    const withNote: OperationRequest = { ...create, note: 'ghi chú' };
    expect(operationPayload(withNote).note).toBe('ghi chú');
  });

  it('reissue: the id travels in the URL, permissions are ABSENT unless replaced, never null or []', () => {
    const copy: OperationRequest = { action: 'REISSUE_INVITATION', invitationId: INVITATION_ID, expectedVersion: 3, reason: 'mất liên kết', permissions: null };
    expect(operationPayload(copy)).toEqual({ invitation_id: INVITATION_ID, expected_version: 3, reason: 'mất liên kết' });
    expect(businessBody(OPERATION_ID, copy)).toEqual({ operation_id: OPERATION_ID, expected_version: 3, reason: 'mất liên kết' });
    const replace: OperationRequest = { ...copy, permissions: [{ app: 'DRIVER', canView: true, canReviewProfile: false, canLock: true }] };
    expect(businessBody(OPERATION_ID, replace).permissions).toEqual([{ app: 'DRIVER', can_view: true, can_review_profile: false, can_lock: true }]);
  });

  it('createOperation sends {action,payload}+CSRF and accepts only 201 with a PENDING operation', async () => {
    const server = new FakeServer().on('POST', '/operations', operationCreated()).on('POST', '/operations', { status: 200, body: operationCreated().body });
    const api = server.provisioningApi();
    const first = await api.createOperation('csrf-s', create);
    expect(first).toEqual({ kind: 'ok', data: { operationId: OPERATION_ID, action: 'CREATE_INVITATION', expiresAt: '2026-10-09T09:02:00.000Z' } });
    expect(server.requests[0]).toEqual({ method: 'POST', path: '/operations', csrf: 'csrf-s', body: { action: 'CREATE_INVITATION', payload: operationPayload(create) } });
    expect((await api.createOperation('csrf-s', create)).kind).toBe('network'); // 200 is not the documented success
  });

  it('createInvitation sends the Idempotency-Key and operation_id; the link must be a real activation link', async () => {
    const server = new FakeServer().on('POST', '/invitations', issuedCreated()).on('POST', '/invitations', { status: 201, body: { data: { invitation: invitationWire(), activation_link: 'https://evil.example/?t=x' } } });
    const api = server.provisioningApi();
    const done = await api.createInvitation('csrf-s', KEY_1, OPERATION_ID, create as Extract<OperationRequest, { action: 'CREATE_INVITATION' }>);
    expect(done.kind === 'ok' && done.data.activationLink).toBe(LINK);
    expect(server.requests[0]).toMatchObject({ method: 'POST', path: '/invitations', csrf: 'csrf-s', idempotencyKey: KEY_1, body: { operation_id: OPERATION_ID } });
    const bad = await api.createInvitation('csrf-s', KEY_1, OPERATION_ID, create as Extract<OperationRequest, { action: 'CREATE_INVITATION' }>);
    expect(bad.kind).toBe('network');
  });

  it('reissue and revoke post to /invitations/:id/... and parse their views', async () => {
    const server = new FakeServer().on('POST', `/invitations/${INVITATION_ID}/reissue`, issuedReissued()).on('POST', `/invitations/${INVITATION_ID}/revoke`, revokedOk());
    const api = server.provisioningApi();
    const reissued = await api.reissueInvitation('c', KEY_1, OPERATION_ID, { action: 'REISSUE_INVITATION', invitationId: INVITATION_ID, expectedVersion: 1, reason: 'r', permissions: null });
    expect(reissued.kind === 'ok' && reissued.data.supersededInvitationId).toBe(INVITATION_ID);
    const revoked = await api.revokeInvitation('c', KEY_1, OPERATION_ID, { action: 'REVOKE_INVITATION', invitationId: INVITATION_ID, expectedVersion: 1, reason: 'r' });
    expect(revoked.kind === 'ok' && revoked.data.status).toBe('REVOKED');
  });

  it('verifyOperation sends {code} as a string (leading zeros kept) and readOperation parses usable/verifiable', async () => {
    const server = new FakeServer().on('POST', `/operations/${OPERATION_ID}/verify`, operationVerified()).on('GET', `/operations/${OPERATION_ID}`, operationView({ verifiable: false, usable: true }));
    const api = server.provisioningApi();
    await api.verifyOperation('c', OPERATION_ID, '012345');
    expect(server.requests[0]?.body).toEqual({ code: '012345' });
    const view = await api.readOperation(OPERATION_ID);
    expect(view.kind === 'ok' && view.data.usable).toBe(true);
  });

  it('list builds the query from status/limit/cursor and rejects malformed items', async () => {
    const server = new FakeServer()
      .on('GET', '/invitations?status=PENDING&limit=20&cursor=abc', listOk([invitationWire()], 'next'))
      .on('GET', '/invitations', ok({ items: [{ invitation_id: 'not-a-uuid' }], next_cursor: null }));
    const api = server.provisioningApi();
    const page = await api.listInvitations({ status: 'PENDING', limit: 20, cursor: 'abc' });
    expect(page.kind === 'ok' && page.data.nextCursor).toBe('next');
    expect((await api.listInvitations()).kind).toBe('network');
  });

  it('keeps the error code and Retry-After (429 only) of 1B answers', async () => {
    const server = new FakeServer().on('POST', `/operations/${OPERATION_ID}/verify`, fail(429, 'ADMIN_AUTH_RATE_LIMITED', { 'retry-after': '30' })).on('POST', '/invitations', fail(409, 'ADMIN_INVITATION_PENDING_EXISTS', { 'retry-after': '9' }));
    const api = server.provisioningApi();
    expect(await api.verifyOperation('c', OPERATION_ID, '123456')).toEqual({ kind: 'error', status: 429, code: 'ADMIN_AUTH_RATE_LIMITED', retryAfterSeconds: 30 });
    expect(await api.createInvitation('c', KEY_1, OPERATION_ID, create as Extract<OperationRequest, { action: 'CREATE_INVITATION' }>)).toEqual({ kind: 'error', status: 409, code: 'ADMIN_INVITATION_PENDING_EXISTS' });
  });

  it('permission fixtures keep the four keys', () => {
    expect(Object.keys(permissionWire())).toEqual(['app', 'can_view', 'can_review_profile', 'can_lock']);
  });
});
