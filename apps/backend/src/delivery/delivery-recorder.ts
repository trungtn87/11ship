import { WalletService } from '../wallet/wallet-service';
import { cancellationAudit } from '../order-timeouts/cancellation-audit';
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AuditWriter } from '../audit/audit-writer';
import { JsonObject } from '../idempotency/idempotency-executor';
import { OutboxWriter } from '../outbox/outbox-writer';
import { TransactionContext } from '../transaction/transaction-context';
import { ActorType, DELIVERY_EVENT_SCHEMA, DELIVERY_RESOURCE } from './delivery-constants';
import { DeliveryRepository, DeliveryRow } from './delivery-repository';

// The three records every delivery change leaves, written in the SAME transaction as the change: the timeline event (what the shop, the Shipper and the
// Admin read), the audit row (who did it and why) and the outbox event (what notification / monitoring modules consume after the commit). They carry
// identifiers, the state and the version only: no phone, no address, no amount of a Shipper's wallet.

export interface Change {
  /** The delivery AFTER the change. */
  readonly delivery: DeliveryRow;
  /** Short dotted suffix of the event, e.g. `created`, `accepted`, `picked_up`. */
  readonly type: string;
  readonly actorType: ActorType;
  readonly actorId: string | null;
  readonly assignmentId?: string | null;
  readonly driverId?: string | null;
  readonly note?: string | null;
  /** Audit action (the operation name), request id and optional extra safe metadata. */
  readonly operation: string;
  readonly requestId: string;
  readonly metadata?: JsonObject;
}

export const OUTBOX_DELIVERY_CHANGED = 'delivery.changed.v1';

@Injectable()
export class DeliveryRecorder {
  constructor(
    private readonly deliveries: DeliveryRepository,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    private readonly wallets: WalletService,
  ) {}

  async record(context: TransactionContext, change: Change): Promise<void> {
    const d = change.delivery;
    const isCancellation = /cancel|release|search_stopped/.test(change.type);
    const cancellation = isCancellation ? await cancellationAudit(context, 'deliveries', d.deliveryId, d.version, change.assignmentId) : {};
    if (isCancellation && change.assignmentId) {
      cancellation.commission_hold_status = await this.wallets.commissionHoldStatus(context, change.assignmentId);
    }
    await this.deliveries.appendEvent(context, {
      eventId: randomUUID(),
      deliveryId: d.deliveryId,
      type: `delivery.${change.type}`,
      actorType: change.actorType,
      actorId: change.actorId,
      assignmentId: change.assignmentId ?? null,
      note: change.note ?? null,
    });
    await this.audit.append(context, {
      requestId: change.requestId,
      actorType: change.actorType === 'SHOP' || change.actorType === 'SHIPPER' ? 'USER' : change.actorType,
      actorId: change.actorId,
      action: change.operation,
      resourceType: DELIVERY_RESOURCE,
      resourceId: d.deliveryId,
      resourceVersion: d.version,
      outcome: 'SUCCESS',
      metadata: { change: change.type, state: d.state, reason:change.note??null,actor_type:change.actorType,...cancellation,...change.metadata },
    });
    await this.outbox.append(context, {
      eventType: OUTBOX_DELIVERY_CHANGED,
      eventSchemaVersion: DELIVERY_EVENT_SCHEMA,
      resourceType: DELIVERY_RESOURCE,
      resourceId: d.deliveryId,
      resourceVersion: d.version,
      payload: {
        delivery_id: d.deliveryId,
        code: d.code,
        shop_id: d.shopId,
        order_id: d.orderId,
        change: change.type,
        state: d.state,
        version: d.version,
        assignment_id: change.assignmentId ?? null,
        driver_id: change.driverId ?? null,
      },
    });
  }
}
