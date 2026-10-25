import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AuditWriter } from '../audit/audit-writer';
import { OutboxWriter } from '../outbox/outbox-writer';
import { ShopAvailabilityReader } from '../shop/shop-availability-reader';
import { ShopRepository } from '../shop/shop-repository';
import { TransactionContext } from '../transaction/transaction-context';
import { SHOP_ACTIVATED_EVENT_TYPE, SHOP_SETUP_AUDIT_ACTIONS, SHOP_SETUP_EVENT_SCHEMA_VERSION, SHOP_SETUP_RESOURCE_TYPE } from './shop-setup-constants';
import { ShopSetupGate } from './shop-setup-gate';

/**
 * Automatic activation (issue #190): no "submit for review", no administrator approval. After every change that can complete the setup (profile,
 * schedule, a dish, an administrator re-enabling the shop) the coordinator calls `reconcile` INSIDE its own transaction, while it holds the shop row
 * FOR UPDATE. If the shop is ACTIVE, not locked and every condition holds for the first time, the activation is recorded once (activated_at, one audit
 * row by the SYSTEM actor, one outbox event). A repeated, replayed or concurrent call finds activated_at set and does nothing: no second transition,
 * no second audit row. It never touches the profile version or any order.
 */
@Injectable()
export class ShopActivation {
  constructor(
    private readonly shops: ShopRepository,
    private readonly reader: ShopAvailabilityReader,
    private readonly gate: ShopSetupGate,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
  ) {}

  /** True only for the call that activated the shop. The caller must hold the shop row FOR UPDATE. */
  async reconcile(context: TransactionContext, shopId: string, requestId: string = randomUUID(), trigger = 'owner_change'): Promise<boolean> {
    const snapshot = await this.reader.snapshotOfShop(context, shopId);
    if (snapshot === undefined || snapshot.status !== 'ACTIVE' || snapshot.activatedAt !== null || snapshot.ownerLocked) {
      return false;
    }
    const result = await this.gate.evaluate(context, snapshot);
    if (!result.setup.complete || !(await this.shops.markActivated(context, shopId))) {
      return false;
    }
    await this.audit.append(context, {
      requestId,
      actorType: 'SYSTEM',
      actorId: null,
      action: SHOP_SETUP_AUDIT_ACTIONS.autoActivated,
      resourceType: SHOP_SETUP_RESOURCE_TYPE,
      resourceId: shopId,
      resourceVersion: snapshot.version,
      outcome: 'SUCCESS',
      metadata: { shop_id: shopId, trigger, to_state: 'ACTIVATED', from_state: 'INCOMPLETE', cleared_request: snapshot.setupRequest !== null },
    });
    await this.outbox.append(context, {
      eventType: SHOP_ACTIVATED_EVENT_TYPE,
      eventSchemaVersion: SHOP_SETUP_EVENT_SCHEMA_VERSION,
      resourceType: SHOP_SETUP_RESOURCE_TYPE,
      resourceId: shopId,
      resourceVersion: snapshot.version,
      payload: { shop_id: shopId, version: snapshot.version },
    });
    return true;
  }
}
