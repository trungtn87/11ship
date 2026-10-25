import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { SessionActor, SessionAuthorizationParticipant } from '../auth/session-authorization-participant';
import { ShopAvailabilityReader, ShopSnapshot } from '../shop/shop-availability-reader';
import { ShopRepository } from '../shop/shop-repository';
import { TransactionManager } from '../transaction/transaction-manager';
import { ShopActivation } from './shop-activation';
import { gateOf, ShopGateResult, ShopSetupGate } from './shop-setup-gate';

export interface ShopSetupView {
  readonly shop_id: string;
  readonly status: string;
  readonly version: number;
  readonly state: string;
  readonly completed_steps: number;
  readonly total_steps: number;
  readonly steps: { key: string; done: boolean; missing: string[] }[];
  readonly missing: string[];
  /** Customers can see the shop and its menu now. */
  readonly public: boolean;
  /** The system has activated the shop (it met every condition at least once). */
  readonly activated: boolean;
  readonly activated_at: string | null;
  readonly request: { note: string; requested_at: string } | null;
  readonly lock: 'ADMIN' | 'OWNER_ACCOUNT' | null;
  readonly availability: { online: boolean; reason: string; evaluated_at: string };
}

function viewOf(snapshot: ShopSnapshot, gate: ShopGateResult): ShopSetupView {
  return {
    shop_id: snapshot.shopId,
    status: snapshot.status,
    version: snapshot.version,
    state: gate.setup.state,
    completed_steps: gate.setup.completedSteps,
    total_steps: gate.setup.steps.length,
    steps: gate.setup.steps.map((step) => ({ key: step.key, done: step.done, missing: [...step.missing] })),
    missing: [...gate.setup.missing],
    public: gate.publicVisible,
    activated: snapshot.activatedAt !== null,
    activated_at: snapshot.activatedAt,
    request: snapshot.setupRequest === null ? null : { note: snapshot.setupRequest.note, requested_at: snapshot.setupRequest.at },
    lock: snapshot.status === 'DISABLED' ? 'ADMIN' : snapshot.ownerLocked ? 'OWNER_ACCOUNT' : null,
    availability: { online: gate.availability.online, reason: gate.availability.reason, evaluated_at: gate.availability.evaluatedAt },
  };
}

/**
 * GET /v1/onboarding/shop/setup (issue #190): the owner's "Hoàn tất thiết lập cửa hàng" checklist, x/4, computed by the SERVER from the real rows on
 * every call (reload, a new device and a lost response all read the same truth; nothing the app remembers counts). It needs no SHOP role: a profile that
 * is not finished yet reads it too. It is read-only except for one idempotent backstop: if every condition holds but the activation was never
 * recorded (data that became complete by a path that does not reconcile), this call records it, exactly once, under the shop row lock.
 */
@Injectable()
export class ShopSetupQueryService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly sessionAuth: SessionAuthorizationParticipant,
    private readonly shops: ShopRepository,
    private readonly reader: ShopAvailabilityReader,
    private readonly gate: ShopSetupGate,
    private readonly activation: ShopActivation,
  ) {}

  async read(actor: SessionActor, requestId: string = randomUUID()): Promise<ShopSetupView | null> {
    return this.transactions.withTransaction(async (context) => {
      await this.sessionAuth.lockAuthorizedActorShared(context, actor);
      let snapshot = await this.reader.snapshotOfOwner(context, actor.userId);
      if (snapshot === undefined) {
        return null;
      }
      let gate = await this.gate.evaluate(context, snapshot);
      if (snapshot.status === 'ACTIVE' && snapshot.activatedAt === null && gate.setup.complete && !snapshot.ownerLocked) {
        await this.shops.lockOwnedShop(context, actor.userId);
        if (await this.activation.reconcile(context, snapshot.shopId, requestId, 'owner_read')) {
          const again = await this.reader.snapshotOfOwner(context, actor.userId);
          if (again !== undefined) {
            snapshot = again;
            gate = gateOf(again, gate.setup.steps.every((step) => step.done));
          }
        }
      }
      return viewOf(snapshot, gate);
    });
  }
}
