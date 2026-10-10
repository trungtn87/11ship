import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { AdminBootstrapService } from '../../apps/backend/src/admin-auth/admin-bootstrap-service';
import { AdminLimitConfigRepository } from '../../apps/backend/src/admin-auth/admin-limit-config-repository';
import { AdminLimitConfigService } from '../../apps/backend/src/admin-auth/admin-limit-config-service';
import { AdminMembershipRepository } from '../../apps/backend/src/admin-auth/admin-membership-repository';
import { AdminIdentityParticipant } from '../../apps/backend/src/auth/admin-identity-participant';
import { AdminPasswordVerifier } from '../../apps/backend/src/auth/admin-password-verifier';
import { Argon2idPasswordHasher } from '../../apps/backend/src/auth/password-hasher';
import { UserRepository } from '../../apps/backend/src/auth/user-repository';
import { AuditWriter } from '../../apps/backend/src/audit/audit-writer';
import {
  OperationRequest,
  parseCreateInvitationBody,
  parseOperationBody,
  parseReissueBody,
  parseRevokeBody,
} from '../../apps/backend/src/admin-provisioning/admin-provisioning-validation';
import { AppError } from '../../apps/backend/src/common/app-errors';
import { poolClientSource } from '../../apps/backend/src/transaction/pg-client-source';
import { TransactionClientSource, TransactionManager } from '../../apps/backend/src/transaction/transaction-manager';
import { ADMIN_PASSWORD, AdminApp, adminErrorCode, count, rewindAcceptedStep, startAdminApp, totpNow } from './support/admin-fixtures';
import { failureOf } from './support/async-helpers';
import { waitForBlockedBackends } from './support/lock-fixtures';
import {
  api,
  createInvitation,
  createOperation,
  createPayload,
  directServices,
  DirectServices,
  gatedSource,
  isNonDecreasing,
  lockSequence,
  newGate,
  operationRow,
  invitationRow,
  sessionOf,
  stepUp,
  SystemSession,
  systemSession,
  totpBucketFailures,
} from './support/provisioning-fixtures';

// M01-D-ADMIN-1B lock protocol (contract section 8). Two kinds of evidence, both on the real PostgreSQL:
//  1. TRACE: every route's transaction is recorded statement by statement through the real services; the row and
//     advisory locks it takes must follow the global order L1 < L2 < L3 < L4 < L5 < L6 < L7 < L8 < L9 (never downwards),
//     and every non-executor transaction sets lock_timeout before its first lock.
//  2. SCHEDULES S1-S11: deterministic interleavings decided by barriers (a statement is paused AFTER PostgreSQL granted
//     its lock; the test waits until the other request is really blocked), in both orders where the order matters.
// No sleeps and no random races decide anything here. S12 (two creates of one phone) stays at the 1A participant level
// (admin-invitations.int.spec.ts): with one SYSTEM and at most one live operation it cannot be built at the route level.

const USER_X = /FROM app\.users WHERE user_id = \$1::uuid FOR UPDATE/;
const USER_S = /FROM app\.users WHERE user_id = \$1::uuid FOR SHARE/;
const BUCKET = /SELECT bucket_key FROM app\.admin_auth_limits[\s\S]*FOR UPDATE/;
const LIVE_OPERATIONS = /status IN \('PENDING','VERIFIED'\)\s+ORDER BY operation_id FOR UPDATE/;
const LOCK_TIMEOUT = "SELECT set_config('lock_timeout', $1, true)";

type Settled<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown };

function settle<T>(run: Promise<T>): Promise<Settled<T>> {
  return run.then(
    (value): Settled<T> => ({ ok: true, value }),
    (error: unknown): Settled<T> => ({ ok: false, error }),
  );
}

function codeOf(result: Settled<unknown>): string | undefined {
  return !result.ok && result.error instanceof AppError ? result.error.code : undefined;
}

describe('M01-D-ADMIN-1B - lock protocol: trace and barrier schedules', () => {
  let app: AdminApp;
  let system: SystemSession;
  const meta = (): { requestId: string } => ({ requestId: randomUUID() });

  beforeAll(async () => {
    app = await startAdminApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.clearLimits();
    system = await systemSession(app);
  });

  function plain(): DirectServices {
    return directServices(app, poolClientSource(app.pool));
  }

  function gated(pattern: RegExp): { services: DirectServices; gate: ReturnType<typeof newGate> } {
    const gate = newGate();
    return { services: directServices(app, gatedSource(app.pool, pattern, gate)), gate };
  }

  function createRequest(payload: Record<string, unknown>): OperationRequest {
    return parseOperationBody({ action: 'CREATE_INVITATION', payload });
  }

  const cookie = (): string => system.login.cookie;
  const csrf = (): string => system.login.csrf;

  // ----- 1. trace -----------------------------------------------------------------------------------------------------

  describe('trace of the lock order of every route', () => {
    function traced(): { services: DirectServices; trace: string[][] } {
      const trace: string[][] = [];
      return { services: directServices(app, gatedSource(app.pool, null, null, trace)), trace };
    }

    function lockingTransactions(trace: string[][]): string[][] {
      return trace.filter((statements) => lockSequence(statements).length > 0);
    }

    function expectOrdered(trace: string[][], expected: string[], options: { ownLockTimeout: boolean }): void {
      const transactions = lockingTransactions(trace);
      expect(transactions).toHaveLength(1);
      const statements = transactions[0] as string[];
      expect(isNonDecreasing(statements)).toBe(true);
      expect(lockSequence(statements)).toEqual(expected);
      if (options.ownLockTimeout) {
        const timeoutAt = statements.indexOf(LOCK_TIMEOUT);
        const firstLock = statements.findIndex((statement) => lockSequence([statement]).length > 0);
        expect(timeoutAt).toBeGreaterThanOrEqual(0);
        expect(timeoutAt).toBeLessThan(firstLock);
      }
    }

    const ACTOR_WRITE = ['L4 users', 'L5 admin_memberships', 'L6 admin_totp_factors', 'L7 admin_sessions'];

    /**
     * Reissue/revoke (finding on ad9b092): a read-only authorization transaction (L4-L7 FOR SHARE, lock_timeout first)
     * runs and ENDS before the coordinator, which then takes L1, L3 and the actor rows again in its own order. The two
     * transactions are checked separately; no actor lock is held while L1/L3 are acquired.
     */
    function expectAuthorizedThenMutation(trace: string[][], mutation: string[]): void {
      const transactions = lockingTransactions(trace);
      expect(transactions).toHaveLength(2);
      const [authorization, coordinator] = transactions as [string[], string[]];
      expect(lockSequence(authorization)).toEqual(['L4 users', 'L5 admin_memberships', 'L6 admin_totp_factors', 'L7 admin_sessions']);
      expect(authorization.some((statement) => /\bFOR UPDATE\b/.test(statement))).toBe(false);
      expect(authorization.some((statement) => /pg_advisory_xact_lock/.test(statement))).toBe(false);
      const timeoutAt = authorization.indexOf(LOCK_TIMEOUT);
      const firstLock = authorization.findIndex((statement) => lockSequence([statement]).length > 0);
      expect(timeoutAt).toBeGreaterThanOrEqual(0);
      expect(timeoutAt).toBeLessThan(firstLock);
      expect(isNonDecreasing(coordinator)).toBe(true);
      expect(lockSequence(coordinator)).toEqual(mutation);
      expect(trace.indexOf(authorization)).toBeLessThan(trace.indexOf(coordinator));
    }

    it('create-operation (create / reissue target) and verify', async () => {
      const create = traced();
      const payload = createPayload();
      const created = await create.services.operations.createOperation(cookie(), csrf(), createRequest(payload), meta());
      expectOrdered(create.trace, [...ACTOR_WRITE, 'L9 admin_sensitive_operations'], { ownLockTimeout: true });

      await rewindAcceptedStep(app, system.account.userId);
      const verify = traced();
      await verify.services.operations.verify(cookie(), csrf(), created.operation_id, totpNow(system.login.secret), meta());
      expectOrdered(verify.trace, ['L2 TOTP bucket', 'L2 TOTP bucket', ...ACTOR_WRITE, 'L9 admin_sensitive_operations'], {
        ownLockTimeout: true,
      });

      const invitation = await createInvitation(app, system);
      await app.clearLimits();
      const reissue = traced();
      await reissue.services.operations.createOperation(
        cookie(),
        csrf(),
        parseOperationBody({ action: 'REISSUE_INVITATION', payload: { invitation_id: invitation.invitationId, expected_version: 1, reason: 'r' } }),
        meta(),
      );
      expectOrdered(reissue.trace, [...ACTOR_WRITE, 'L8 admin_invitations', 'L9 admin_sensitive_operations'], { ownLockTimeout: true });
    });

    it('create / reissue / revoke (executor) and the sensitive replay', async () => {
      const payload = createPayload();
      const operationId = await stepUp(app, system, 'CREATE_INVITATION', payload);
      const key = randomUUID();
      const create = traced();
      const input = parseCreateInvitationBody({ operation_id: operationId, ...payload });
      await create.services.invitations.create(cookie(), csrf(), input, key, meta());
      const mutation = [
        'L1 idempotency advisory',
        'L1 idempotency record',
        'L3 phone advisory',
        ...ACTOR_WRITE,
        'L8 admin_invitations',
        'L9 admin_sensitive_operations',
      ];
      expectOrdered(create.trace, mutation, { ownLockTimeout: false });

      const replay = traced();
      const replayed = await replay.services.invitations.create(cookie(), csrf(), input, key, meta());
      expect(replayed.replayed).toBe(true);
      expectOrdered(
        replay.trace,
        ['L1 idempotency advisory', 'L1 idempotency record', 'L4 users', 'L5 admin_memberships', 'L6 admin_totp_factors', 'L7 admin_sessions', 'L8 admin_invitations'],
        { ownLockTimeout: false },
      );

      const invitationId = String(((replayed.payload as Record<string, unknown>).invitation as Record<string, unknown>).invitation_id);
      await app.clearLimits();
      const reissueOp = await stepUp(app, system, 'REISSUE_INVITATION', { invitation_id: invitationId, expected_version: 1, reason: 'r' });
      const reissue = traced();
      const reissued = await reissue.services.invitations.reissue(
        cookie(),
        csrf(),
        parseReissueBody(invitationId, { operation_id: reissueOp, expected_version: 1, reason: 'r' }),
        randomUUID(),
        meta(),
      );
      expectAuthorizedThenMutation(reissue.trace, mutation);

      const successor = String(((reissued.payload as Record<string, unknown>).invitation as Record<string, unknown>).invitation_id);
      await app.clearLimits();
      const revokeOp = await stepUp(app, system, 'REVOKE_INVITATION', { invitation_id: successor, expected_version: 1, reason: 'r' });
      const revoke = traced();
      await revoke.services.invitations.revoke(
        cookie(),
        csrf(),
        parseRevokeBody(successor, { operation_id: revokeOp, expected_version: 1, reason: 'r' }),
        randomUUID(),
        meta(),
      );
      expectAuthorizedThenMutation(revoke.trace, mutation);
    });

    it('the three reads take shared locks in the same order and set lock_timeout first', async () => {
      const invitation = await createInvitation(app, system);
      const operationId = await createOperation(app, system, 'REVOKE_INVITATION', {
        invitation_id: invitation.invitationId,
        expected_version: 1,
        reason: 'r',
      });
      const read = ['L4 users', 'L5 admin_memberships', 'L6 admin_totp_factors', 'L7 admin_sessions'];
      const one = traced();
      await one.services.invitations.get(cookie(), invitation.invitationId);
      expectOrdered(one.trace, [...read, 'L8 admin_invitations'], { ownLockTimeout: true });
      const list = traced();
      await list.services.invitations.list(cookie(), { status: null, limit: 20, cursor: null });
      expectOrdered(list.trace, read, { ownLockTimeout: true });
      const operation = traced();
      await operation.services.operations.read(cookie(), operationId);
      expectOrdered(operation.trace, [...read, 'L8 admin_invitations', 'L9 admin_sensitive_operations'], { ownLockTimeout: true });
      for (const statements of [...one.trace, ...list.trace, ...operation.trace]) {
        expect(statements.some((statement) => /\bFOR UPDATE\b/.test(statement))).toBe(false);
        expect(statements.some((statement) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(statement))).toBe(false);
      }
    });
  });

  // ----- 2. schedules -----------------------------------------------------------------------------------------------

  describe('barrier schedules', () => {
    async function liveOperations(): Promise<number> {
      return count(app.pool, "SELECT 1 FROM app.admin_sensitive_operations WHERE status IN ('PENDING','VERIFIED')");
    }

    it('S1 create-operation x create-operation, no live operation: the second waits, then replaces the first (no 23505)', async () => {
      const a = gated(USER_X);
      const first = settle(a.services.operations.createOperation(cookie(), csrf(), createRequest(createPayload()), meta()));
      await a.gate.reached.promise;
      const second = settle(plain().operations.createOperation(cookie(), csrf(), createRequest(createPayload()), meta()));
      await waitForBlockedBackends(app.pool);
      a.gate.release.resolve();
      const [one, two] = await Promise.all([first, second]);
      expect(one.ok && two.ok).toBe(true);
      const firstId = one.ok ? one.value.operation_id : '';
      const secondId = two.ok ? two.value.operation_id : '';
      expect(await operationRow(app.pool, firstId)).toMatchObject({ status: 'INVALIDATED', invalidated_reason: 'REPLACED' });
      expect(await operationRow(app.pool, secondId)).toMatchObject({ status: 'PENDING' });
      expect(await liveOperations()).toBe(1);
    });

    it('S2 create-operation x create-operation with a live operation: both replace in lock order, one live row remains', async () => {
      const existing = await createOperation(app, system, 'CREATE_INVITATION', createPayload());
      const a = gated(LIVE_OPERATIONS);
      const first = settle(a.services.operations.createOperation(cookie(), csrf(), createRequest(createPayload()), meta()));
      await a.gate.reached.promise;
      const second = settle(plain().operations.createOperation(cookie(), csrf(), createRequest(createPayload()), meta()));
      await waitForBlockedBackends(app.pool);
      a.gate.release.resolve();
      const [one, two] = await Promise.all([first, second]);
      expect(one.ok && two.ok).toBe(true);
      expect(await operationRow(app.pool, existing)).toMatchObject({ status: 'INVALIDATED', invalidated_reason: 'REPLACED' });
      expect(await operationRow(app.pool, one.ok ? one.value.operation_id : '')).toMatchObject({ status: 'INVALIDATED', invalidated_reason: 'REPLACED' });
      expect(await operationRow(app.pool, two.ok ? two.value.operation_id : '')).toMatchObject({ status: 'PENDING' });
      expect(await liveOperations()).toBe(1);
    });

    it('S3 a new create-operation racing the consumption of the verified one: the result follows the lock order', async () => {
      // (a) create-operation first: it replaces the verified operation; the mutation then finds it INVALIDATED.
      const payload = createPayload();
      const verified = await stepUp(app, system, 'CREATE_INVITATION', payload);
      const a = gated(USER_X);
      const replacing = settle(a.services.operations.createOperation(cookie(), csrf(), createRequest(createPayload()), meta()));
      await a.gate.reached.promise;
      const consuming = settle(
        plain().invitations.create(cookie(), csrf(), parseCreateInvitationBody({ operation_id: verified, ...payload }), randomUUID(), meta()),
      );
      await waitForBlockedBackends(app.pool);
      a.gate.release.resolve();
      const [replaced, consumed] = await Promise.all([replacing, consuming]);
      expect(replaced.ok).toBe(true);
      expect(codeOf(consumed)).toBe('ADMIN_STEP_UP_REQUIRED');
      expect(await operationRow(app.pool, verified)).toMatchObject({ status: 'INVALIDATED', invalidated_reason: 'REPLACED' });
      expect(await count(app.pool, 'SELECT 1 FROM app.admin_invitations')).toBe(0);

      // (b) the mutation first: it consumes the operation; the create-operation then has nothing live to replace.
      await app.clearLimits();
      const payload2 = createPayload();
      const verified2 = await stepUp(app, system, 'CREATE_INVITATION', payload2);
      const b = gated(USER_X);
      const consuming2 = settle(
        b.services.invitations.create(cookie(), csrf(), parseCreateInvitationBody({ operation_id: verified2, ...payload2 }), randomUUID(), meta()),
      );
      await b.gate.reached.promise;
      const creating2 = settle(plain().operations.createOperation(cookie(), csrf(), createRequest(createPayload()), meta()));
      await waitForBlockedBackends(app.pool);
      b.gate.release.resolve();
      const [consumed2, created2] = await Promise.all([consuming2, creating2]);
      expect(consumed2.ok).toBe(true);
      expect(created2.ok).toBe(true);
      expect(await operationRow(app.pool, verified2)).toMatchObject({ status: 'CONSUMED' });
      expect(await count(app.pool, 'SELECT 1 FROM app.admin_invitations')).toBe(1);
      expect(await liveOperations()).toBe(1);
    });

    it('S4 one operation, two Idempotency-Keys, same payload (create): exactly one invitation; the other is STEP_UP_REQUIRED', async () => {
      const payload = createPayload();
      const operationId = await stepUp(app, system, 'CREATE_INVITATION', payload);
      const input = parseCreateInvitationBody({ operation_id: operationId, ...payload });
      const a = gated(USER_X);
      const first = settle(a.services.invitations.create(cookie(), csrf(), input, randomUUID(), meta()));
      await a.gate.reached.promise;
      const second = settle(plain().invitations.create(cookie(), csrf(), input, randomUUID(), meta()));
      await waitForBlockedBackends(app.pool);
      a.gate.release.resolve();
      const results = await Promise.all([first, second]);
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.map(codeOf).filter((code) => code !== undefined)).toEqual(['ADMIN_STEP_UP_REQUIRED']);
      expect(await count(app.pool, 'SELECT 1 FROM app.admin_invitations')).toBe(1);
      expect(await count(app.pool, "SELECT 1 FROM app.audit_logs WHERE action = 'admin_invitation.created.v1' AND actor_id = $1", [system.account.userId])).toBe(1);
    });

    it.each(['reissue', 'revoke'] as const)('S5 one operation, two Idempotency-Keys (%s): the old row moves exactly once', async (kind) => {
      const invitation = await createInvitation(app, system);
      await app.clearLimits();
      const body = { expected_version: 1, reason: 'r' };
      const operationId = await stepUp(app, system, kind === 'reissue' ? 'REISSUE_INVITATION' : 'REVOKE_INVITATION', {
        invitation_id: invitation.invitationId,
        ...body,
      });
      const run = (services: DirectServices) =>
        kind === 'reissue'
          ? services.invitations.reissue(cookie(), csrf(), parseReissueBody(invitation.invitationId, { operation_id: operationId, ...body }), randomUUID(), meta())
          : services.invitations.revoke(cookie(), csrf(), parseRevokeBody(invitation.invitationId, { operation_id: operationId, ...body }), randomUUID(), meta());
      const a = gated(USER_X);
      const first = settle(run(a.services));
      await a.gate.reached.promise;
      const second = settle(run(plain()));
      await waitForBlockedBackends(app.pool);
      a.gate.release.resolve();
      const results = await Promise.all([first, second]);
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.map(codeOf).filter((code) => code !== undefined)).toEqual(['ADMIN_STEP_UP_REQUIRED']);
      expect(await invitationRow(app.pool, invitation.invitationId)).toMatchObject({
        status: kind === 'reissue' ? 'SUPERSEDED' : 'REVOKED',
        version: '2',
      });
      expect(await count(app.pool, 'SELECT 1 FROM app.admin_invitations')).toBe(kind === 'reissue' ? 2 : 1);
    });

    it('S6 verify x verify of one operation: one VERIFIED; the other is refused before any comparison, nothing counted', async () => {
      const operationId = await createOperation(app, system, 'CREATE_INVITATION', createPayload());
      await rewindAcceptedStep(app, system.account.userId);
      const code = totpNow(system.login.secret);
      const a = gated(BUCKET);
      const first = settle(a.services.operations.verify(cookie(), csrf(), operationId, code, meta()));
      await a.gate.reached.promise;
      const second = settle(plain().operations.verify(cookie(), csrf(), operationId, code, meta()));
      await waitForBlockedBackends(app.pool);
      a.gate.release.resolve();
      const [one, two] = await Promise.all([first, second]);
      expect(one.ok).toBe(true);
      expect(codeOf(two)).toBe('ADMIN_STEP_UP_REQUIRED');
      expect(await operationRow(app.pool, operationId)).toMatchObject({ status: 'VERIFIED', attempt_count: 0 });
      expect(await totpBucketFailures(app.pool)).toBe(0);
    });

    it('S7 verify x create-operation, both orders', async () => {
      // (a) verify first: VERIFIED, then replaced by the new operation.
      const op1 = await createOperation(app, system, 'CREATE_INVITATION', createPayload());
      await rewindAcceptedStep(app, system.account.userId);
      const a = gated(USER_X);
      const verifying = settle(a.services.operations.verify(cookie(), csrf(), op1, totpNow(system.login.secret), meta()));
      await a.gate.reached.promise;
      const creating = settle(plain().operations.createOperation(cookie(), csrf(), createRequest(createPayload()), meta()));
      await waitForBlockedBackends(app.pool);
      a.gate.release.resolve();
      const [verified, created] = await Promise.all([verifying, creating]);
      expect(verified.ok && created.ok).toBe(true);
      expect(await operationRow(app.pool, op1)).toMatchObject({ status: 'INVALIDATED', invalidated_reason: 'REPLACED' });

      // (b) create-operation first: the verify then finds its operation INVALIDATED and counts nothing.
      await app.clearLimits();
      const op2 = await createOperation(app, system, 'CREATE_INVITATION', createPayload());
      await rewindAcceptedStep(app, system.account.userId);
      const b = gated(USER_X);
      const creating2 = settle(b.services.operations.createOperation(cookie(), csrf(), createRequest(createPayload()), meta()));
      await b.gate.reached.promise;
      const verifying2 = settle(plain().operations.verify(cookie(), csrf(), op2, totpNow(system.login.secret), meta()));
      await waitForBlockedBackends(app.pool);
      b.gate.release.resolve();
      const [created2, verified2] = await Promise.all([creating2, verifying2]);
      expect(created2.ok).toBe(true);
      expect(codeOf(verified2)).toBe('ADMIN_STEP_UP_REQUIRED');
      expect(await operationRow(app.pool, op2)).toMatchObject({ status: 'INVALIDATED', attempt_count: 0 });
      expect(await totpBucketFailures(app.pool)).toBe(0);
    });

    it('S8 GET operation x verify: verify first -> VERIFIED; GET first -> may see PENDING, verify then succeeds', async () => {
      const op1 = await createOperation(app, system, 'CREATE_INVITATION', createPayload());
      await rewindAcceptedStep(app, system.account.userId);
      const a = gated(USER_X);
      const verifying = settle(a.services.operations.verify(cookie(), csrf(), op1, totpNow(system.login.secret), meta()));
      await a.gate.reached.promise;
      const reading = settle(plain().operations.read(cookie(), op1));
      await waitForBlockedBackends(app.pool);
      a.gate.release.resolve();
      const [verified, read] = await Promise.all([verifying, reading]);
      expect(verified.ok).toBe(true);
      expect(read.ok ? read.value : undefined).toMatchObject({ status: 'VERIFIED', usable: true });

      await app.clearLimits();
      const op2 = await createOperation(app, system, 'CREATE_INVITATION', createPayload());
      await rewindAcceptedStep(app, system.account.userId);
      const b = gated(USER_S);
      const reading2 = settle(b.services.operations.read(cookie(), op2));
      await b.gate.reached.promise;
      const verifying2 = settle(plain().operations.verify(cookie(), csrf(), op2, totpNow(system.login.secret), meta()));
      await waitForBlockedBackends(app.pool);
      b.gate.release.resolve();
      const [read2, verified2] = await Promise.all([reading2, verifying2]);
      expect(read2.ok ? read2.value : undefined).toMatchObject({ status: 'PENDING', verifiable: true });
      expect(verified2.ok).toBe(true);
    });

    it('S9 bootstrap (operator) x create-operation, both orders: no deadlock, bootstrap stays UNCHANGED', async () => {
      const limiter = app.config.adminAuth?.limiter;
      expect(limiter).toBeDefined();
      const bootstrapOver = (source: TransactionClientSource): AdminBootstrapService => {
        const transactions = new TransactionManager(source, { timeoutMs: 30_000, idleInTransactionTimeoutMs: 25_000 });
        return new AdminBootstrapService(
          transactions,
          new AdminIdentityParticipant(new UserRepository()),
          new AdminMembershipRepository(),
          new AdminLimitConfigService(transactions, new AdminLimitConfigRepository()),
          new AdminPasswordVerifier(new Argon2idPasswordHasher()),
          new AuditWriter(),
        );
      };
      const input = { phoneNormalized: system.account.phone.normalized, password: ADMIN_PASSWORD };

      const bootGate = newGate();
      const booting = settle(bootstrapOver(gatedSource(app.pool, USER_X, bootGate)).bootstrapSystem(input, limiter as NonNullable<typeof limiter>));
      await bootGate.reached.promise;
      const creating = settle(plain().operations.createOperation(cookie(), csrf(), createRequest(createPayload()), meta()));
      await waitForBlockedBackends(app.pool);
      bootGate.release.resolve();
      const [booted, created] = await Promise.all([booting, creating]);
      expect(booted).toEqual({ ok: true, value: 'UNCHANGED' });
      expect(created.ok).toBe(true);

      const a = gated(USER_X);
      const creating2 = settle(a.services.operations.createOperation(cookie(), csrf(), createRequest(createPayload()), meta()));
      await a.gate.reached.promise;
      const booting2 = settle(bootstrapOver(poolClientSource(app.pool)).bootstrapSystem(input, limiter as NonNullable<typeof limiter>));
      await waitForBlockedBackends(app.pool);
      a.gate.release.resolve();
      const [created2, booted2] = await Promise.all([creating2, booting2]);
      expect(created2.ok).toBe(true);
      expect(booted2).toEqual({ ok: true, value: 'UNCHANGED' });
    });

    it('S10 a login that revokes the session (user X, then sessions) while a mutation waits: the mutation sees the revocation', async () => {
      const payload = createPayload();
      const operationId = await stepUp(app, system, 'CREATE_INVITATION', payload);
      const client = await app.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT 1 FROM app.users WHERE user_id = $1::uuid FOR UPDATE', [system.account.userId]);
        await client.query('UPDATE app.admin_sessions SET revoked_at = clock_timestamp() WHERE user_id = $1::uuid AND revoked_at IS NULL', [
          system.account.userId,
        ]);
        const pending = settle(
          plain().invitations.create(cookie(), csrf(), parseCreateInvitationBody({ operation_id: operationId, ...payload }), randomUUID(), meta()),
        );
        await waitForBlockedBackends(app.pool);
        await client.query('COMMIT');
        const result = await pending;
        expect(codeOf(result)).toBe('ADMIN_SESSION_INVALID');
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
      }
      expect(await count(app.pool, 'SELECT 1 FROM app.admin_invitations')).toBe(0);
      expect((await operationRow(app.pool, operationId))?.status).toBe('VERIFIED');
    });

    it('S11 a replay that waits for a concurrent revoke of its invitation never decrypts the link', async () => {
      const payload = createPayload();
      const operationId = await stepUp(app, system, 'CREATE_INVITATION', payload);
      const key = randomUUID();
      const body = { operation_id: operationId, ...payload };
      const first = await api(app, 'POST', '/invitations', { body, headers: { 'idempotency-key': key }, ...sessionOf(system) });
      expect(first.status).toBe(201);
      const invitationId = String(((first.body.data as Record<string, unknown>).invitation as Record<string, unknown>).invitation_id);
      await app.pool.query("UPDATE app.idempotency_records SET replay_ciphertext = decode('00ff00ff', 'hex') WHERE idempotency_key = $1", [key]);
      const client = await app.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT 1 FROM app.admin_invitations WHERE invitation_id = $1::uuid FOR UPDATE', [invitationId]);
        await client.query(
          "UPDATE app.admin_invitations SET status = 'REVOKED', version = version + 1, terminal_at = now() WHERE invitation_id = $1::uuid",
          [invitationId],
        );
        const replay = settle(plain().invitations.create(cookie(), csrf(), parseCreateInvitationBody(body), key, meta()));
        await waitForBlockedBackends(app.pool);
        await client.query('COMMIT');
        expect(codeOf(await replay)).toBe('ADMIN_INVITATION_NOT_REPLAYABLE');
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
      }
    });

    it('a business lock wait longer than lock_timeout ends as a lock timeout, never as a deadlock or a partial write', async () => {
      const shortApp = await startAdminApp({ businessLockTimeoutMs: 200, keepLimits: true });
      try {
        const services = directServices(shortApp, poolClientSource(shortApp.pool));
        const client = await shortApp.pool.connect();
        try {
          await client.query('BEGIN');
          await client.query('SELECT 1 FROM app.users WHERE user_id = $1::uuid FOR UPDATE', [system.account.userId]);
          const failure = await failureOf(() => services.operations.createOperation(cookie(), csrf(), createRequest(createPayload()), meta()));
          const sqlState = (failure as { code?: unknown; sqlState?: unknown }).sqlState ?? (failure as { code?: unknown }).code;
          expect(sqlState).toBe('55P03');
        } finally {
          await client.query('ROLLBACK');
          client.release();
        }
        expect(await count(shortApp.pool, 'SELECT 1 FROM app.admin_sensitive_operations')).toBe(0);
      } finally {
        await shortApp.running.app.close();
        await shortApp.pool.end();
      }
    });
  });

  it('keeps the HTTP view consistent with the direct services (sanity)', async () => {
    const response = await api(app, 'GET', '/invitations', { cookies: sessionOf(system).cookies });
    expect(response.status).toBe(200);
    expect(adminErrorCode(response)).toBeUndefined();
  });
});
