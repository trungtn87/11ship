import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AuditWriter } from '../audit/audit-writer';
import { RoleGrantParticipant } from '../auth/role-grant-participant';
import { SessionActor, SessionAuthorizationParticipant } from '../auth/session-authorization-participant';
import { AppError, TechnicalError } from '../common/app-errors';
import { DriverRepository } from '../driver/driver-repository';
import { IdempotencyExecutor, JsonObject } from '../idempotency/idempotency-executor';
import { OutboxWriter } from '../outbox/outbox-writer';
import { isCanonicalUuid } from '../shared/identifiers';
import { TransactionContext } from '../transaction/transaction-context';
import { DriverOnboardingInput } from './driver-onboarding-validation';
import {
  DRIVER_CREATE_OPERATION_ID,
  DRIVER_ONBOARDED_EVENT_SCHEMA_VERSION,
  DRIVER_ONBOARDED_EVENT_TYPE,
  DRIVER_RESOURCE_TYPE,
  ONBOARDING_AUDIT_ACTIONS,
  ONBOARDING_SCOPE_TYPE,
} from './onboarding-constants';
import { OnboardingOutcome } from './shop-onboarding-service';

/**
 * Driver onboarding coordinator (M01-A2D). One transaction per command, opened by the M00 IdempotencyExecutor.
 *
 * Lock order inside the callback (the A2 global order, after the executor's own advisory + record locks):
 *   user row FOR UPDATE -> CURRENT session row FOR UPDATE -> existing Driver row -> Driver insert -> DRIVER role
 *   grant -> audit -> outbox -> idempotency record (the executor writes it last). Driver onboarding takes no
 *   operating area (Owner revision, task section 22), so no M02 row is read or locked.
 * The authenticated user AND session come from the guard's principal and are authorized again inside this
 * transaction under their locks (SessionAuthorizationParticipant); the HTTP guard is only a precheck. Nothing
 * about identity, session, role, type, status or accepting_deliveries is read from the request body, and the
 * Driver row is always inserted as
 * EXTERNAL / PENDING / accepting_deliveries=false / version 1 by M03's own statement.
 *
 * Self-onboarding does not activate anything: it creates the PENDING profile and grants the DRIVER role, in one
 * transaction with the audit row and the outbox event, so the role can never exist without the profile
 * that earned it (and the role-select eligibility rule would refuse a role without a profile anyway).
 */
@Injectable()
export class DriverOnboardingService {
  constructor(
    private readonly executor: IdempotencyExecutor,
    private readonly sessionAuth: SessionAuthorizationParticipant,
    private readonly roleGrants: RoleGrantParticipant,
    private readonly drivers: DriverRepository,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
  ) {}

  async create(
    actor: SessionActor,
    input: DriverOnboardingInput,
    idempotencyKey: string | readonly string[] | undefined,
    requestId: string,
  ): Promise<OnboardingOutcome> {
    const userId = actor.userId;
    const outcome = await this.executor.execute(
      {
        scopeType: ONBOARDING_SCOPE_TYPE,
        scopeId: userId,
        operationId: DRIVER_CREATE_OPERATION_ID,
        idempotencyKey,
        // The NORMALIZED request: "absent" and null are the same plate.
        logicalRequest: { full_name: input.fullName, plate_number: input.plateNumber },
        replay: { kind: 'sensitive', authorize: (context, guard) => this.#authorizeReplay(context, guard, actor) },
      },
      (context) => this.#create(context, actor, input, requestId),
    );
    return { status: outcome.status, payload: outcome.payload, replayed: outcome.replayed };
  }

  async #create(context: TransactionContext, actor: SessionActor, input: DriverOnboardingInput, requestId: string) {
    const userId = actor.userId;
    await this.sessionAuth.lockAuthorizedActor(context, actor);

    // One Driver per user, proven under the user lock: a user who already has a profile (in any status,
    // CLOSED included) gets the same answer whatever Idempotency-Key the request carries.
    if ((await this.drivers.lockByUserId(context, userId)) !== undefined) {
      throw new AppError('DRIVER_PROFILE_EXISTS');
    }

    const driverId = randomUUID();
    const inserted = await this.drivers.insertPending(context, {
      driverId,
      userId,
      fullName: input.fullName,
      plateNumber: input.plateNumber,
    });
    if (!inserted) {
      // Unreachable under the user lock; the database's UNIQUE(user_id) is the last word.
      throw new AppError('DRIVER_PROFILE_EXISTS');
    }
    await this.roleGrants.grant(context, userId, 'DRIVER');

    // Nothing the client typed goes into the audit row or the event: no name, no plate number.
    await this.audit.append(context, {
      requestId,
      actorType: 'USER',
      actorId: userId,
      action: ONBOARDING_AUDIT_ACTIONS.driverCreate,
      resourceType: DRIVER_RESOURCE_TYPE,
      resourceId: driverId,
      resourceVersion: 1,
      outcome: 'SUCCESS',
      metadata: { role: 'DRIVER' },
    });
    await this.outbox.append(context, {
      eventType: DRIVER_ONBOARDED_EVENT_TYPE,
      eventSchemaVersion: DRIVER_ONBOARDED_EVENT_SCHEMA_VERSION,
      resourceType: DRIVER_RESOURCE_TYPE,
      resourceId: driverId,
      resourceVersion: 1,
      payload: { driver_id: driverId, user_id: userId },
    });

    return {
      status: 201,
      replayGuard: { user_id: userId },
      payload: {
        driver_id: driverId,
        driver_type: 'EXTERNAL',
        status: 'PENDING',
        accepting_deliveries: false,
        role_granted: true,
        version: 1,
      },
    };
  }

  /**
   * A stored result is replayed only while the CURRENT session is still valid for this user and the account is
   * ACTIVE: the same authorization as a new execution (user then session, locked, fresh database clock) runs
   * before anything is decrypted. The replay guard names the user only, so a valid replacement session of the same
   * user may replay and a revoked or expired one may not.
   */
  async #authorizeReplay(context: TransactionContext, guard: JsonObject, actor: SessionActor): Promise<true> {
    const guarded = guard.user_id;
    if (!isCanonicalUuid(guarded) || guarded !== actor.userId) {
      throw new TechnicalError('internal', 'Invalid replay guard');
    }
    await this.sessionAuth.lockAuthorizedActor(context, actor);
    return true;
  }
}
