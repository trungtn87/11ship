import { describe, expect, it } from '@jest/globals';
import { EMPTY_PERMISSIONS, togglePermission } from './inputs';
import { ADMIN_COPY } from './messages';
import { ComposeDraft, EMPTY_DRAFT, ProvisioningController, ProvisioningScreen } from './provisioning-controller';
import {
  FakeClock,
  FakeServer,
  INVITATION_ID,
  KEY_1,
  LINK,
  OPERATION_ID,
  deferred,
  fail,
  invitationWire,
  issuedCreated,
  issuedReissued,
  listOk,
  ok,
  operationCreated,
  operationCreatedFor,
  operationVerified,
  operationView,
  revokedOk,
  Scripted,
  settle,
} from './test-support';

// Unit tests of the SYSTEM invitation flow against a SCRIPTED server. Not integration tests: the real backend and a real
// browser are exercised by tests/integration/admin-web-browser.int.spec.ts.

function setup(server: FakeServer, csrf: string | undefined = 'csrf-s') {
  const clock = new FakeClock();
  const calls = { lost: 0, refresh: 0 };
  const controller = new ProvisioningController(
    server.provisioningApi(),
    {
      csrf: () => csrf,
      lost: () => {
        calls.lost += 1;
      },
      refresh: async () => {
        calls.refresh += 1;
        return true;
      },
    },
    clock,
    () => KEY_1,
  );
  const screens: ProvisioningScreen[] = [];
  controller.subscribe((screen) => screens.push(screen));
  return { controller, clock, calls, screens };
}

const shopView = togglePermission(EMPTY_PERMISSIONS, 'SHOP', 'canView', true);
const validDraft: ComposeDraft = { ...EMPTY_DRAFT, fullName: ' Nguyễn Văn A ', phone: '0912345678', permissions: shopView };

function compose(controller: ProvisioningController) {
  const screen = controller.screen;
  if (screen.name !== 'compose') {
    throw new Error(`expected compose, got ${screen.name}`);
  }
  return screen;
}

async function toCodeStep(server: FakeServer) {
  server.on('POST', '/operations', operationCreated());
  const context = setup(server);
  await context.controller.openCompose('create');
  expect(await context.controller.submitForm(validDraft)).toBe('sent');
  expect(compose(context.controller).phase).toBe('code');
  return context;
}

describe('invitation list and detail', () => {
  it('loads the list with the filter, pages with the cursor, and 401 hands over to login', async () => {
    const server = new FakeServer()
      .on('GET', '/invitations?limit=20', listOk([invitationWire()], 'c2'))
      .on('GET', '/invitations?limit=20&cursor=c2', listOk([invitationWire({ invitation_id: '55555555-5555-4555-8555-555555555555' })]))
      .on('GET', '/invitations?status=EXPIRED&limit=20', fail(401, 'ADMIN_SESSION_INVALID'));
    const { controller, calls } = setup(server);
    await controller.openList('ALL');
    expect(controller.screen).toMatchObject({ name: 'list', loading: false, nextCursor: 'c2' });
    await controller.loadMore();
    expect(controller.screen.name === 'list' && controller.screen.items.length).toBe(2);
    await controller.openList('EXPIRED');
    expect(calls.lost).toBe(1);
  });

  it('a SYSTEM-only route answered 403 ADMIN_FORBIDDEN shows the no-permission screen, never data', async () => {
    const server = new FakeServer().on('GET', '/invitations?limit=20', fail(403, 'ADMIN_FORBIDDEN'));
    const { controller } = setup(server);
    await controller.openList('ALL');
    expect(controller.screen).toEqual({ name: 'forbidden' });
  });

  it('detail: not found is its own state', async () => {
    const server = new FakeServer().on('GET', `/invitations/${INVITATION_ID}`, fail(404, 'ADMIN_INVITATION_NOT_FOUND'));
    const { controller } = setup(server);
    await controller.openDetail(INVITATION_ID);
    expect(controller.screen).toMatchObject({ name: 'detail', notFound: true });
  });
});

describe('create invitation (step-up)', () => {
  it('validates before any request', async () => {
    const server = new FakeServer();
    const { controller } = setup(server);
    await controller.openCompose('create');
    expect(await controller.submitForm({ ...EMPTY_DRAFT, fullName: '', phone: '123' })).toBe('invalid');
    const screen = compose(controller);
    expect(screen.fieldErrors.fullName).toBeDefined();
    expect(screen.fieldErrors.phone).toBeDefined();
    expect(screen.fieldErrors.permissions).toBe(ADMIN_COPY.permissionsRequired);
    expect(server.requests).toEqual([]);
  });

  it('operation -> verify -> business with ONE key, the same payload and the operation id; the link only on the result', async () => {
    const server = new FakeServer().on('POST', `/operations/${OPERATION_ID}/verify`, operationVerified()).on('POST', '/invitations', issuedCreated());
    const { controller } = await toCodeStep(server);
    expect(JSON.stringify(controller.screen)).not.toContain(LINK);
    expect(await controller.submitCode('012345')).toBe('sent');
    const done = compose(controller);
    expect(done.phase).toBe('done');
    expect(done.result?.kind === 'issued' && done.result.issued.activationLink).toBe(LINK);
    const [op, verify, business] = server.requests;
    expect(op).toMatchObject({ path: '/operations', csrf: 'csrf-s', body: { action: 'CREATE_INVITATION' } });
    expect(verify).toMatchObject({ path: `/operations/${OPERATION_ID}/verify`, body: { code: '012345' } });
    expect(business).toMatchObject({ path: '/invitations', idempotencyKey: KEY_1, body: { operation_id: OPERATION_ID, full_name: 'Nguyễn Văn A', phone: '0912345678' } });
    expect((op?.body as { payload: unknown }).payload).toEqual({ full_name: 'Nguyễn Văn A', phone: '0912345678', permissions: [{ app: 'SHOP', can_view: true, can_review_profile: false, can_lock: false }] });
    // the code is not kept anywhere in the screen
    expect(JSON.stringify(controller.screen)).not.toContain('012345');
  });

  it('leaving the result page drops the link from memory', async () => {
    const server = new FakeServer().on('POST', `/operations/${OPERATION_ID}/verify`, operationVerified()).on('POST', '/invitations', issuedCreated());
    const { controller } = await toCodeStep(server);
    await controller.submitCode('012345');
    expect(JSON.stringify(controller.screen)).toContain(LINK);
    controller.clear();
    expect(JSON.stringify(controller.screen)).not.toContain(LINK);
  });

  it('a wrong code keeps the operation: no business call, and the next right code completes it', async () => {
    const server = new FakeServer()
      .on('POST', `/operations/${OPERATION_ID}/verify`, fail(400, 'ADMIN_TOTP_INVALID'), operationVerified())
      .on('POST', '/invitations', issuedCreated());
    const { controller } = await toCodeStep(server);
    await controller.submitCode('111111');
    expect(compose(controller)).toMatchObject({ phase: 'code', codeError: 'totp', pending: false });
    expect(server.count('POST', '/invitations')).toBe(0);
    await controller.submitCode('222222');
    expect(compose(controller).phase).toBe('done');
    expect(server.count('POST', '/operations')).toBe(1);
  });

  it('an incomplete code sends nothing', async () => {
    const server = new FakeServer();
    server.on('POST', '/operations', operationCreated());
    const { controller } = setup(server);
    await controller.openCompose('create');
    await controller.submitForm(validDraft);
    expect(await controller.submitCode('12345')).toBe('incomplete');
    expect(server.requests.length).toBe(1);
  });

  it('lost answer to the code step: only GET /operations/:id; usable -> carries on, the code is sent exactly once', async () => {
    const server = new FakeServer()
      .on('POST', `/operations/${OPERATION_ID}/verify`, 'network')
      .on('GET', `/operations/${OPERATION_ID}`, operationView({ verifiable: false, usable: true }))
      .on('POST', '/invitations', issuedCreated());
    const { controller } = await toCodeStep(server);
    await controller.submitCode('123456');
    expect(compose(controller).phase).toBe('done');
    expect(server.count('POST', `/operations/${OPERATION_ID}/verify`)).toBe(1);
  });

  it('lost answer to the code step, operation still waiting: shows an error, never resends the code by itself', async () => {
    const server = new FakeServer().on('POST', `/operations/${OPERATION_ID}/verify`, fail(503, 'SERVICE_UNAVAILABLE')).on('GET', `/operations/${OPERATION_ID}`, operationView({ verifiable: true, usable: false }));
    const { controller, clock } = await toCodeStep(server);
    await controller.submitCode('123456');
    expect(compose(controller)).toMatchObject({ phase: 'code', codeError: 'unavailable', pending: false });
    clock.advance(60_000);
    await settle();
    expect(server.count('POST', `/operations/${OPERATION_ID}/verify`)).toBe(1);
    expect(server.count('POST', '/invitations')).toBe(0);
  });

  it('lost answer to the business POST: retry sends the SAME key and operation id, with no new code and no new operation', async () => {
    const server = new FakeServer().on('POST', `/operations/${OPERATION_ID}/verify`, operationVerified()).on('POST', '/invitations', 'network', issuedCreated());
    const { controller } = await toCodeStep(server);
    await controller.submitCode('123456');
    expect(compose(controller)).toMatchObject({ phase: 'retry', pending: false, formError: ADMIN_COPY.outcomeUnknown });
    await settle();
    expect(server.count('POST', '/invitations')).toBe(1); // nothing was repeated by itself
    await controller.retryBusiness();
    expect(compose(controller).phase).toBe('done');
    const posts = server.requests.filter((request) => request.path === '/invitations');
    expect(posts.map((request) => request.idempotencyKey)).toEqual([KEY_1, KEY_1]);
    expect(posts[0]?.body).toEqual(posts[1]?.body);
    expect(server.count('POST', `/operations/${OPERATION_ID}/verify`)).toBe(1);
    expect(server.count('POST', '/operations')).toBe(1);
  });

  it('retry inside Retry-After sends nothing; after it, the SAME key, operation id and payload go again (F2)', async () => {
    const server = new FakeServer()
      .on('POST', `/operations/${OPERATION_ID}/verify`, operationVerified())
      .on('POST', '/invitations', 'network', fail(429, 'ADMIN_AUTH_RATE_LIMITED', { 'retry-after': '20' }), issuedCreated());
    const { controller, clock } = await toCodeStep(server);
    await controller.submitCode('123456');
    expect(compose(controller)).toMatchObject({ phase: 'retry', pending: false });
    await controller.retryBusiness(); // 429 with Retry-After: 20
    expect(compose(controller)).toMatchObject({ phase: 'retry', pending: false });
    expect(controller.lockRemainingSeconds()).toBe(20);
    expect(server.count('POST', '/invitations')).toBe(2);

    await controller.retryBusiness(); // still locked: ignored
    clock.advance(10_000);
    await controller.retryBusiness();
    await settle();
    expect(server.count('POST', '/invitations')).toBe(2);
    expect(controller.lockRemainingSeconds()).toBe(10);
    expect(compose(controller).phase).toBe('retry');

    clock.advance(11_000); // the wait is over: the button opens, nothing is sent by itself
    await settle();
    expect(controller.lockRemainingSeconds()).toBe(0);
    expect(compose(controller).lockUntilMs).toBeUndefined();
    expect(server.count('POST', '/invitations')).toBe(2);

    await controller.retryBusiness();
    expect(compose(controller).phase).toBe('done');
    const posts = server.requests.filter((request) => request.path === '/invitations');
    expect(posts).toHaveLength(3);
    expect(posts.map((request) => request.idempotencyKey)).toEqual([KEY_1, KEY_1, KEY_1]);
    expect(posts[1]?.body).toEqual(posts[0]?.body);
    expect(posts[2]?.body).toEqual(posts[0]?.body);
    expect(server.count('POST', `/operations/${OPERATION_ID}/verify`)).toBe(1);
    expect(server.count('POST', '/operations')).toBe(1);
  });

  it('503 TRANSACTION_OUTCOME_UNKNOWN is treated like a lost answer', async () => {
    const server = new FakeServer().on('POST', `/operations/${OPERATION_ID}/verify`, operationVerified()).on('POST', '/invitations', fail(503, 'TRANSACTION_OUTCOME_UNKNOWN'), issuedCreated());
    const { controller } = await toCodeStep(server);
    await controller.submitCode('123456');
    expect(compose(controller).phase).toBe('retry');
    await controller.retryBusiness();
    expect(compose(controller).phase).toBe('done');
  });

  it('CSRF refused on the business POST: a fresh token is read and the user retries with the same key', async () => {
    const server = new FakeServer().on('POST', `/operations/${OPERATION_ID}/verify`, operationVerified()).on('POST', '/invitations', fail(403, 'ADMIN_CSRF_INVALID'), issuedCreated());
    const { controller, calls } = await toCodeStep(server);
    await controller.submitCode('123456');
    expect(calls.refresh).toBe(1);
    expect(compose(controller).phase).toBe('retry');
    await controller.retryBusiness();
    expect(compose(controller).phase).toBe('done');
    expect(server.requests.filter((request) => request.path === '/invitations').map((request) => request.idempotencyKey)).toEqual([KEY_1, KEY_1]);
  });

  it('the operation expires after its 120 s: the form comes back, nothing is sent', async () => {
    const server = new FakeServer();
    const { controller, clock } = await toCodeStep(server);
    clock.advance(121_000);
    await settle();
    expect(compose(controller)).toMatchObject({ phase: 'form', notice: ADMIN_COPY.stepUpExpired });
    expect(server.requests.length).toBe(1);
  });

  it('rate-limited code step: locked with Retry-After, ignored during the lock, nothing sent when it ends', async () => {
    const server = new FakeServer().on('POST', `/operations/${OPERATION_ID}/verify`, fail(429, 'ADMIN_AUTH_RATE_LIMITED', { 'retry-after': '20' }));
    const { controller, clock } = await toCodeStep(server);
    await controller.submitCode('123456');
    expect(controller.lockRemainingSeconds()).toBe(20);
    expect(await controller.submitCode('654321')).toBe('ignored');
    clock.advance(21_000);
    expect(compose(controller).lockUntilMs).toBeUndefined();
    expect(server.count('POST', `/operations/${OPERATION_ID}/verify`)).toBe(1);
  });

  it('business conflicts return to the form with the specific message', async () => {
    const server = new FakeServer().on('POST', '/operations', fail(409, 'ADMIN_INVITATION_PENDING_EXISTS'));
    const { controller } = setup(server);
    await controller.openCompose('create');
    await controller.submitForm(validDraft);
    expect(compose(controller)).toMatchObject({ phase: 'form', formError: ADMIN_COPY.pendingExists });
  });

  it('insufficient permission (ADMIN session on a SYSTEM route): the no-permission screen', async () => {
    const server = new FakeServer().on('POST', '/operations', fail(403, 'ADMIN_FORBIDDEN'));
    const { controller } = setup(server);
    await controller.openCompose('create');
    await controller.submitForm(validDraft);
    expect(controller.screen).toEqual({ name: 'forbidden' });
  });

  it('session gone mid-flow (401): hands over to login and drops the flow', async () => {
    const server = new FakeServer().on('POST', `/operations/${OPERATION_ID}/verify`, fail(401, 'ADMIN_SESSION_INVALID'));
    const { controller, calls } = await toCodeStep(server);
    await controller.submitCode('123456');
    expect(calls.lost).toBe(1);
    expect(await controller.submitCode('123456')).toBe('ignored');
  });

  it('a second click while the first request is in flight is ignored', async () => {
    const pending = deferred<Scripted>();
    const server = new FakeServer().on('POST', '/operations', pending.promise);
    const { controller } = setup(server);
    await controller.openCompose('create');
    const first = controller.submitForm(validDraft);
    await settle();
    expect(await controller.submitForm(validDraft)).toBe('ignored');
    pending.resolve(operationCreated());
    await first;
    expect(server.count('POST', '/operations')).toBe(1);
  });
});

describe('reissue and revoke', () => {
  it('reissue without replacing permissions omits them, carries expected_version and the reason', async () => {
    const server = new FakeServer()
      .on('GET', `/invitations/${INVITATION_ID}`, ok({ invitation: invitationWire({ version: 3 }), activation: { state: 'NONE' } }))
      .on('POST', '/operations', operationCreatedFor('REISSUE_INVITATION'))
      .on('POST', `/operations/${OPERATION_ID}/verify`, operationVerified())
      .on('POST', `/invitations/${INVITATION_ID}/reissue`, issuedReissued());
    const { controller } = setup(server);
    await controller.openCompose('reissue', INVITATION_ID);
    await controller.submitForm({ ...EMPTY_DRAFT, reason: ' mất liên kết ', keepPermissions: true });
    await controller.submitCode('000123');
    const screen = compose(controller);
    expect(screen.phase).toBe('done');
    expect(screen.result?.kind === 'issued' && screen.result.issued.supersededInvitationId).toBe(INVITATION_ID);
    expect(server.requests[1]?.body).toEqual({ action: 'REISSUE_INVITATION', payload: { invitation_id: INVITATION_ID, expected_version: 3, reason: 'mất liên kết' } });
    expect(server.requests[3]).toMatchObject({ path: `/invitations/${INVITATION_ID}/reissue`, idempotencyKey: KEY_1, body: { operation_id: OPERATION_ID, expected_version: 3, reason: 'mất liên kết' } });
  });

  it('reissue with replaced permissions sends them, and requires at least one VIEW', async () => {
    const server = new FakeServer()
      .on('GET', `/invitations/${INVITATION_ID}`, ok({ invitation: invitationWire(), activation: { state: 'NONE' } }))
      .on('POST', '/operations', operationCreatedFor('REISSUE_INVITATION'));
    const { controller } = setup(server);
    await controller.openCompose('reissue', INVITATION_ID);
    expect(await controller.submitForm({ ...EMPTY_DRAFT, reason: 'x', keepPermissions: false })).toBe('invalid');
    await controller.submitForm({ ...EMPTY_DRAFT, reason: 'x', keepPermissions: false, permissions: togglePermission(EMPTY_PERMISSIONS, 'DRIVER', 'canLock', true) });
    expect((server.requests[1]?.body as { payload: { permissions: unknown } }).payload.permissions).toEqual([{ app: 'DRIVER', can_view: true, can_review_profile: false, can_lock: true }]);
  });

  it('revoke works for a PENDING invitation that is already past its expiry', async () => {
    const server = new FakeServer()
      .on('GET', `/invitations/${INVITATION_ID}`, ok({ invitation: invitationWire({ expired: true }), activation: { state: 'NONE' } }))
      .on('POST', '/operations', operationCreatedFor('REVOKE_INVITATION'))
      .on('POST', `/operations/${OPERATION_ID}/verify`, operationVerified())
      .on('POST', `/invitations/${INVITATION_ID}/revoke`, revokedOk());
    const { controller } = setup(server);
    await controller.openCompose('revoke', INVITATION_ID);
    await controller.submitForm({ ...EMPTY_DRAFT, reason: 'nhầm số' });
    await controller.submitCode('123456');
    expect(compose(controller).result).toMatchObject({ kind: 'revoked' });
  });

  it('an invitation that is not PENDING cannot be reissued or revoked from the form', async () => {
    const server = new FakeServer().on('GET', `/invitations/${INVITATION_ID}`, ok({ invitation: invitationWire({ status: 'ACCEPTED' }), activation: { state: 'NONE' } }));
    const { controller } = setup(server);
    await controller.openCompose('revoke', INVITATION_ID);
    expect(compose(controller).formError).toBe(ADMIN_COPY.notPending);
    expect(await controller.submitForm({ ...EMPTY_DRAFT, reason: 'x' })).toBe('ignored');
    expect(server.count('POST', '/operations')).toBe(0);
  });

  it('a version conflict explains itself and keeps the user on the form', async () => {
    const server = new FakeServer()
      .on('GET', `/invitations/${INVITATION_ID}`, ok({ invitation: invitationWire(), activation: { state: 'NONE' } }))
      .on('POST', '/operations', fail(409, 'ADMIN_VERSION_CONFLICT'));
    const { controller } = setup(server);
    await controller.openCompose('revoke', INVITATION_ID);
    await controller.submitForm({ ...EMPTY_DRAFT, reason: 'x' });
    expect(compose(controller)).toMatchObject({ phase: 'form', formError: ADMIN_COPY.versionConflict });
  });
});
