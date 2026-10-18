import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AuditWriter } from '../audit/audit-writer';
import { JsonObject } from '../idempotency/idempotency-executor';
import { OutboxWriter } from '../outbox/outbox-writer';
import { TransactionContext } from '../transaction/transaction-context';
import { ORDER_EVENT_SCHEMA, ORDER_RESOURCE, OrderActor, OUTBOX_ORDER_CHANGED } from './order-constants';
import { OrderRepository, OrderRow } from './order-repository';

// The three records every Order change leaves, written in the SAME transaction as the change: the history event (what the customer, the shop and the Admin
// read), the audit row (who did it and why) and the outbox event (what M08 turns into a notification after the commit). They carry identifiers, the status
// and the version only: no phone, no address, no amount, no dish.

export interface OrderChange {
  /** The Order AFTER the change. */
  readonly order: OrderRow;
  /** Short suffix of the event, e.g. `placed`, `confirmed`, `cancelled_by_customer`. */
  readonly type: string;
  readonly actorType: OrderActor;
  readonly actorId: string | null;
  readonly note?: string | null;
  /** Before / after of an edit, kept on the history event for the customer and the Admin. */
  readonly details?: JsonObject | null;
  readonly operation: string;
  readonly requestId: string;
  readonly metadata?: JsonObject;
  /** False for a step that tells nobody (an edit before confirmation, a payment note). Default true. */
  readonly notify?: boolean;
}

@Injectable()
export class OrderRecorder {
  constructor(
    private readonly orders: OrderRepository,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
  ) {}

  async record(context: TransactionContext, change: OrderChange): Promise<void> {
    const o = change.order;
    await this.orders.appendEvent(context, {
      eventId: randomUUID(),
      orderId: o.orderId,
      type: `order.${change.type}`,
      actorType: change.actorType,
      actorId: change.actorId,
      note: change.note ?? null,
      details: change.details ?? null,
    });
    await this.audit.append(context, {
      requestId: change.requestId,
      actorType: change.actorType === 'CUSTOMER' || change.actorType === 'SHOP' ? 'USER' : change.actorType,
      actorId: change.actorId,
      action: change.operation,
      resourceType: ORDER_RESOURCE,
      resourceId: o.orderId,
      resourceVersion: o.version,
      outcome: 'SUCCESS',
      metadata: { change: change.type, status: o.status, ...change.metadata },
    });
    if (change.notify !== false) {
      await this.outbox.append(context, {
        eventType: OUTBOX_ORDER_CHANGED,
        eventSchemaVersion: ORDER_EVENT_SCHEMA,
        resourceType: ORDER_RESOURCE,
        resourceId: o.orderId,
        resourceVersion: o.version,
        payload: { order_id: o.orderId, code: o.code, shop_id: o.shopId, customer_user_id: o.customerUserId, change: change.type, status: o.status, version: o.version },
      });
    }
  }
}
