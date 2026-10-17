import { describe, expect, it } from '@jest/globals';
import { AuditWriter } from '../audit/audit-writer';
import { fakeContext } from '../auth/auth-fakes.fixture';
import { RoleGrantParticipant } from '../auth/role-grant-participant';
import { SessionActor, SessionAuthorizationParticipant } from '../auth/session-authorization-participant';
import { AppError } from '../common/app-errors';
import { DriverRepository, DriverRow, NewDriverFields } from '../driver/driver-repository';
import { IdempotencyExecutor, IdempotentRequest, IdempotentResult } from '../idempotency/idempotency-executor';
import { OutboxWriter } from '../outbox/outbox-writer';
import { codeOf as sourceOf } from '../shared/source-scan.fixture';
import { TransactionContext } from '../transaction/transaction-context';
import { DriverOnboardingService } from './driver-onboarding-service';
import { DriverOnboardingInput } from './driver-onboarding-validation';

const USER_ID = '523e4567-e89b-42d3-a456-426614174000';
const SESSION_ID = 'a23e4567-e89b-42d3-a456-426614174000';
const ACTOR: SessionActor = { userId: USER_ID, sessionId: SESSION_ID };
const DRIVER_ID = '623e4567-e89b-42d3-a456-426614174000';
const REQUEST_ID = '323e4567-e89b-42d3-a456-426614174000';
const KEY = '923e4567-e89b-42d3-a456-426614174000';

const INPUT: DriverOnboardingInput = { fullName: 'Nguyễn Văn A', plateNumber: '11B1-12345' };

function driverRow(overrides: Partial<DriverRow> = {}): DriverRow {
  return {
    driverId: DRIVER_ID,
    userId: USER_ID,
    fullName: 'Existing',
    plateNumber: null,
    driverType: 'EXTERNAL',
    status: 'PENDING',
    acceptingDeliveries: false,
    version: 1,
    shipperCode: 'SH000001',
    reviewState: 'DRAFT',
    submittedAtMs: null,
    reviewedAtMs: null,
    reviewedBy: null,
    rejectionReason: null,
    suspensionReason: null,
    suspendedAtMs: null,
    statusBeforeClosing: null,
    closureRequestedAtMs: null,
    closureNote: null,
    createdAtMs: 0,
    updatedAtMs: 0,
    ...overrides,
  };
}

interface Rig {
  service: DriverOnboardingService;
  events: string[];
  requests: IdempotentRequest[];
  audits: Array<Record<string, unknown>>;
  outbox: Array<Record<string, unknown>>;
  inserted: NewDriverFields[];
  /** Every actor the coordinator asked the session-authorization participant to lock and check. */
  authorized: SessionActor[];
  /** Set an error to make the NEXT authorization (a command or a replay hook) refuse. */
  gate: { error: AppError | undefined };
}

function rig(
  options: {
    existing?: DriverRow | undefined;
    insertConflict?: boolean;
    lockFailure?: AppError;
  } = {},
): Rig {
  const events: string[] = [];
  const requests: IdempotentRequest[] = [];
  const audits: Array<Record<string, unknown>> = [];
  const outbox: Array<Record<string, unknown>> = [];
  const inserted: NewDriverFields[] = [];
  const existing = 'existing' in options ? options.existing : undefined;

  const executor = {
    execute: async (request: IdempotentRequest, work: (context: TransactionContext) => Promise<IdempotentResult>) => {
      requests.push(request);
      events.push('executor');
      const result = await work(fakeContext(1, []));
      return { status: result.status, payload: result.payload, replayed: false, persisted: true };
    },
  } as unknown as IdempotencyExecutor;
  const authorized: SessionActor[] = [];
  const gate: { error: AppError | undefined } = { error: options.lockFailure };
  const sessionAuth = {
    lockAuthorizedActor: async (_c: unknown, actor: SessionActor) => {
      events.push('actor.authorize');
      authorized.push(actor);
      if (gate.error !== undefined) {
        throw gate.error;
      }
    },
  } as unknown as SessionAuthorizationParticipant;
  const roleGrants = {
    grant: async (_c: unknown, _u: string, role: string) => void events.push(`role.grant:${role}`),
  } as unknown as RoleGrantParticipant;
  const drivers = {
    lockByUserId: async () => {
      events.push('driver.lock');
      return existing;
    },
    insertPending: async (_c: unknown, fields: NewDriverFields) => {
      events.push('driver.insert');
      inserted.push(fields);
      return !(options.insertConflict ?? false);
    },
  } as unknown as DriverRepository;
  const audit = {
    append: async (_c: unknown, entry: Record<string, unknown>) => void (events.push('audit'), audits.push(entry)),
  } as unknown as AuditWriter;
  const outboxWriter = {
    append: async (_c: unknown, entry: Record<string, unknown>) => void (events.push('outbox'), outbox.push(entry)),
  } as unknown as OutboxWriter;

  return {
    service: new DriverOnboardingService(executor, sessionAuth, roleGrants, drivers, audit, outboxWriter),
    events,
    requests,
    audits,
    outbox,
    inserted,
    authorized,
    gate,
  };
}

async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof AppError ? error.code : `OTHER:${String(error)}`;
  }
  return 'OK';
}

const create = (r: Rig, input: DriverOnboardingInput = INPUT) => r.service.create(ACTOR, input, KEY, REQUEST_ID);

describe('DriverOnboardingService.create (A03-26)', () => {
  it('runs in the A2 lock order: user and session, existing driver, driver insert, role, audit, outbox', async () => {
    const r = rig();
    const outcome = await create(r);
    expect(r.events).toEqual([
      'executor',
      'actor.authorize',
      'driver.lock',
      'driver.insert',
      'role.grant:DRIVER',
      'audit',
      'outbox',
    ]);
    expect(outcome.status).toBe(201);
    expect(outcome.replayed).toBe(false);
  });

  it('answers with exactly the contract payload (no internal classification): PENDING, not accepting, role granted, version 1', async () => {
    const outcome = await create(rig());
    expect(outcome.payload).toEqual({
      driver_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      status: 'PENDING',
      accepting_deliveries: false,
      role_granted: true,
      version: 1,
    });
    expect(Object.keys(outcome.payload as object).sort()).toEqual([
      'accepting_deliveries',
      'driver_id',
      'role_granted',
      'status',
      'version',
    ]);
  });

  it('hands M03 only the validated identity fields: the type, status and flags are not parameters of the insert', async () => {
    const r = rig();
    await create(r);
    expect(r.inserted).toHaveLength(1);
    expect(Object.keys(r.inserted[0] as object).sort()).toEqual(['driverId', 'fullName', 'plateNumber', 'userId']);
    expect(r.inserted[0]).toMatchObject({ userId: USER_ID, fullName: 'Nguyễn Văn A', plateNumber: '11B1-12345' });
  });

  it('is scoped to the authenticated user under the locked operation id, with the normalized request', async () => {
    const r = rig();
    await create(r);
    expect(r.requests[0]).toMatchObject({
      scopeType: 'user',
      scopeId: USER_ID,
      operationId: 'onboarding.driver.create.v1',
      idempotencyKey: KEY,
      logicalRequest: { full_name: 'Nguyễn Văn A', plate_number: '11B1-12345' },
    });
    expect(r.requests[0]?.replay.kind).toBe('sensitive');
  });

  it('a missing plate number is the same logical request as null', async () => {
    const r = rig();
    await create(r, { ...INPUT, plateNumber: null });
    expect((r.requests[0]?.logicalRequest as Record<string, unknown>).plate_number).toBeNull();
    expect(r.inserted[0]?.plateNumber).toBeNull();
  });

  it('audits driver.create and publishes driver.onboarded.v1 with exactly {driver_id,user_id}', async () => {
    const r = rig();
    await create(r);
    const driverId = r.inserted[0]?.driverId;
    expect(r.audits[0]).toMatchObject({
      action: 'onboarding.driver.create.v1',
      actorType: 'USER',
      actorId: USER_ID,
      requestId: REQUEST_ID,
      resourceType: 'driver',
      resourceId: driverId,
      resourceVersion: 1,
      outcome: 'SUCCESS',
      metadata: { role: 'DRIVER' },
    });
    expect(r.outbox[0]).toMatchObject({
      eventType: 'driver.onboarded.v1',
      eventSchemaVersion: 1,
      resourceType: 'driver',
      resourceId: driverId,
      resourceVersion: 1,
      payload: { driver_id: driverId, user_id: USER_ID },
    });
    expect(Object.keys(r.outbox[0]?.payload as object).sort()).toEqual(['driver_id', 'user_id']);
  });

  it('puts nothing the client typed into the audit row or the event', async () => {
    const r = rig();
    await create(r);
    const written = JSON.stringify([r.audits, r.outbox]);
    for (const secret of ['Nguyễn Văn A', '11B1-12345', KEY]) {
      expect([secret, written.includes(secret)]).toEqual([secret, false]);
    }
  });
});

describe('DriverOnboardingService.create refusals', () => {
  const none = (r: Rig) => [r.audits.length, r.outbox.length, r.inserted.length];

  it('a user who already has a Driver profile gets DRIVER_PROFILE_EXISTS in every status', async () => {
    for (const status of ['PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSING', 'CLOSED'] as const) {
      const r = rig({ existing: driverRow({ status }) });
      expect([status, await codeOf(() => create(r))]).toEqual([status, 'DRIVER_PROFILE_EXISTS']);
      expect(r.events).toEqual(['executor', 'actor.authorize', 'driver.lock']);
      expect(none(r)).toEqual([0, 0, 0]);
    }
  });

  it('a unique-violation on insert (only reachable without the user lock) is DRIVER_PROFILE_EXISTS and grants nothing', async () => {
    const r = rig({ insertConflict: true });
    expect(await codeOf(() => create(r))).toBe('DRIVER_PROFILE_EXISTS');
    expect(r.events.filter((event) => event.startsWith('role.grant'))).toEqual([]);
    expect([r.audits.length, r.outbox.length]).toEqual([0, 0]);
  });

  it('a disabled account is refused at the user/session lock, before anything else is read', async () => {
    const r = rig({ lockFailure: new AppError('ACCOUNT_DISABLED') });
    expect(await codeOf(() => create(r))).toBe('ACCOUNT_DISABLED');
    expect(r.events).toEqual(['executor', 'actor.authorize']);
  });
});

describe('DriverOnboardingService session authorization (post-merge repair, section 1)', () => {
  it('authorizes the server-authenticated user AND session first, before any business read', async () => {
    const r = rig();
    await create(r);
    expect(r.authorized).toEqual([ACTOR]);
    expect(r.events.slice(0, 3)).toEqual(['executor', 'actor.authorize', 'driver.lock']);
  });

  it('a revoked, expired or foreign session refuses the command before any business effect', async () => {
    for (const code of ['SESSION_REVOKED', 'SESSION_EXPIRED', 'SESSION_INVALID', 'ACCOUNT_DISABLED'] as const) {
      const r = rig({ lockFailure: new AppError(code) });
      expect([code, await codeOf(() => create(r))]).toEqual([code, code]);
      expect(r.events).toEqual(['executor', 'actor.authorize']);
      expect([r.audits.length, r.outbox.length, r.inserted.length]).toEqual([0, 0, 0]);
    }
  });

  it('the sensitive replay hook runs the same authorization with the CURRENT session, before it allows anything', async () => {
    const r = rig();
    await create(r);
    const replay = r.requests[0]?.replay;
    if (replay?.kind !== 'sensitive') {
      throw new Error('expected a sensitive replay policy');
    }

    r.events.length = 0;
    r.authorized.length = 0;
    await expect(replay.authorize(fakeContext(1, []), { user_id: USER_ID })).resolves.toBe(true);
    expect(r.events).toEqual(['actor.authorize']);
    expect(r.authorized).toEqual([ACTOR]);

    r.gate.error = new AppError('SESSION_EXPIRED');
    const denied = await replay.authorize(fakeContext(1, []), { user_id: USER_ID }).catch((error: unknown) => error);
    expect(denied).toBeInstanceOf(AppError);
    expect((denied as AppError).code).toBe('SESSION_EXPIRED');
  });

  it('the replay guard names the user only: the session id is neither in the logical request nor the scope', async () => {
    const r = rig();
    const outcome = await create(r);
    const request = r.requests[0];
    expect(request?.scopeId).toBe(USER_ID);
    expect(JSON.stringify(request?.logicalRequest)).not.toContain(SESSION_ID);
    expect(JSON.stringify(outcome)).not.toContain(SESSION_ID);
  });

  it('a replay guard of another user is an internal error and never reaches the authorization', async () => {
    const r = rig();
    await create(r);
    const replay = r.requests[0]?.replay;
    if (replay?.kind !== 'sensitive') {
      throw new Error('expected a sensitive replay policy');
    }
    r.events.length = 0;
    const failure = await replay
      .authorize(fakeContext(1, []), { user_id: '123e4567-e89b-42d3-a456-426614174999' })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(AppError);
    expect(r.events).toEqual([]);
  });
});

describe('DriverOnboardingService boundaries', () => {
  it('only the Driver repository writes the Driver; the service names no SQL and passes no type, status or flag', () => {
    const code = sourceOf('onboarding/driver-onboarding-service.ts');
    expect(code).not.toMatch(/\.query\(|INSERT|UPDATE|SELECT/);
    // The shape of the new driver is M03's statement; the coordinator never passes a type, status or flag.
    expect(code).not.toMatch(/driverType|acceptingDeliveries/);
    expect(code.split('this.executor.execute(').length - 1).toBe(1);
  });

  it('takes no service area at all: no area repository, no area lock, no area SQL (Owner revision, task section 22)', () => {
    const code = sourceOf('onboarding/driver-onboarding-service.ts');
    expect(code).not.toMatch(/ServiceArea|serviceArea|service_area|lockShared|INVALID_SERVICE_AREA/);
  });
});
