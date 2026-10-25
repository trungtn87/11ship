import { Injectable } from '@nestjs/common';
import { AuditWriter } from '../audit/audit-writer';
import { AuthPrincipal } from '../auth/auth-principal';
import { AppError, TechnicalError } from '../common/app-errors';
import { DeliveryActors } from '../delivery/delivery-actors';
import { IdempotencyExecutor, JsonObject } from '../idempotency/idempotency-executor';
import { OutboxWriter } from '../outbox/outbox-writer';
import { isCanonicalUuid } from '../shared/identifiers';
import { TransactionContext } from '../transaction/transaction-context';
import { OUTBOX_TOPUP_REPORTED } from './payment-chat-constants';
import { PaymentChatRepository } from './payment-chat-repository';

const OPERATION = 'wallet.topup_request.report.v1';
const RESOURCE = 'wallet_topup_request';

/**
 * "Tôi đã chuyển khoản" of a Shipper top-up request (#199). It writes ONE immutable mark (app.wallet_topup_reports), an audit row and an outbox event, and nothing
 * else: the request stays PENDING, the wallet balance and the ledger are untouched, no topup or bank record is made. Only an administrator's confirmation (the M04
 * flow, unchanged) credits the wallet. Repeating the call (another key, another phone) returns the same state and writes nothing new. A request that is no longer
 * PENDING cannot be reported. The request row is locked FOR SHARE, so a report and a confirmation/rejection/cancellation have one winner decided by the database.
 */
@Injectable()
export class TopupReportService {
  constructor(
    private readonly executor: IdempotencyExecutor,
    private readonly actors: DeliveryActors,
    private readonly repo: PaymentChatRepository,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
  ) {}

  async report(principal: AuthPrincipal, requestId: string, key: string | readonly string[] | undefined, auditRequestId: string): Promise<JsonObject> {
    const outcome = await this.executor.execute(
      {
        scopeType: 'user',
        scopeId: principal.userId,
        operationId: OPERATION,
        idempotencyKey: key,
        logicalRequest: { request_id: requestId },
        replay: {
          kind: 'sensitive' as const,
          authorize: async (context: TransactionContext, guard: JsonObject): Promise<true> => {
            if (!isCanonicalUuid(guard.user_id) || guard.user_id !== principal.userId) {
              throw new TechnicalError('internal', 'Invalid replay guard');
            }
            await this.actors.shipperWriter(context, principal, { acceptNew: false });
            return true;
          },
        },
      },
      async (context) => {
        const { actor, driver } = await this.actors.shipperWriter(context, principal, { acceptNew: false });
        const owner = await this.repo.findCase(context, 'DRIVER_TOPUP', requestId);
        if (owner === undefined || owner.subjectId !== driver.driverId) {
          throw new AppError('TOPUP_REQUEST_NOT_FOUND');
        }
        const state = await this.repo.lockStateShared(context, 'DRIVER_TOPUP', requestId);
        if (state !== 'PENDING') {
          throw new AppError('TOPUP_REQUEST_STATE_CONFLICT');
        }
        const written = await this.repo.insertTopupReport(context, requestId, actor.userId);
        if (written) {
          await this.audit.append(context, { requestId: auditRequestId, actorType: 'USER', actorId: actor.userId, action: OPERATION, resourceType: RESOURCE, resourceId: requestId, resourceVersion: 1, outcome: 'SUCCESS', metadata: { change: 'reported' } });
          await this.outbox.append(context, { eventType: OUTBOX_TOPUP_REPORTED, eventSchemaVersion: 1, resourceType: RESOURCE, resourceId: requestId, resourceVersion: 1, payload: { request_id: requestId } });
        }
        const facts = await this.repo.facts(context, 'DRIVER_TOPUP', requestId);
        return { status: 200, replayGuard: { user_id: actor.userId }, payload: { request_id: requestId, reported_at: facts?.reportedAtMs == null ? null : new Date(facts.reportedAtMs).toISOString(), state: 'PENDING' } };
      },
    );
    return outcome.payload as JsonObject;
  }
}
