import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-errors';
import { OutboxWriter } from '../outbox/outbox-writer';
import { SessionRepository } from '../auth/session-repository';
import { TransactionContext } from '../transaction/transaction-context';
import { DEVICE_REPLACED_EVENT_SCHEMA_VERSION, DEVICE_REPLACED_EVENT_TYPE } from './client-device-constants';
import { ClientDeviceRepository, DeviceApp } from './client-device-repository';
import { NativeAuthProof } from './client-device-proof-service';

export type BindingKind = 'SAME_BINDING' | 'JOIN' | 'NEW_BINDING';

/** The decision of one native authentication, taken under the user root lock and applied before the session is created. */
export interface BindingPlan {
  readonly kind: BindingKind;
  readonly bindingId: string;
  readonly generation: number;
  readonly keyId: string;
  readonly app: DeviceApp;
  readonly grantId: string;
  readonly replacedBindingId: string | null;
}

/** What the HTTP adapter exposes of a binding (response headers; never a body field of the exact identity contract). */
export interface BindingInfo {
  readonly bindingId: string;
  readonly generation: number;
}

/**
 * The binding half of a native login / register (contract11 section 8), a PARTICIPANT: it opens no transaction and runs inside
 * the one the caller already holds, after the idempotency record and the USER ROOT lock (lock order: idempotency -> user root
 * -> binding/head -> sessions -> eligibility). It never creates an account or a session of its own:
 *   prepare(): validates the one-use grant, chooses between
 *     SAME_BINDING  the key is already linked to the user's current binding: only THIS app's current session is revoked;
 *     JOIN          the grant was endorsed by the other app of the current binding: the other app's session is untouched;
 *     NEW_BINDING   anything else: every ordinary session of the user is revoked, the previous binding and its key links are
 *                   closed, a new binding with the next generation is opened. Admin sessions are a separate table.
 *   finish():   after the session row exists, ties it to the binding, consumes the grant and (new binding that replaced an
 *               old one) writes the device-replaced outbox event.
 */
@Injectable()
export class ClientDeviceBindingParticipant {
  constructor(
    private readonly devices: ClientDeviceRepository,
    private readonly sessions: SessionRepository,
    private readonly outbox: OutboxWriter,
  ) {}

  async prepare(context: TransactionContext, args: { userId: string; app: DeviceApp; proof: NativeAuthProof }): Promise<BindingPlan> {
    const { userId, app, proof } = args;
    const grant = await this.devices.findGrantByDigest(context, proof.tokenDigest, true);
    if (grant === undefined || grant.consumedOperationId !== null) {
      throw new AppError('DEVICE_PROOF_INVALID');
    }
    if (grant.expired) {
      throw new AppError('DEVICE_PROOF_EXPIRED');
    }
    const key = await this.devices.findKeyById(context, grant.keyId);
    if (key === undefined || key.revoked || key.app !== app || key.keyId !== proof.keyId) {
      throw new AppError('DEVICE_PROOF_INVALID');
    }

    const current = await this.devices.lockCurrentBinding(context, userId);

    if (grant.joinBindingId !== null) {
      return this.#join(context, { userId, app, key: key.keyId, grant: grant.grantId, joinBindingId: grant.joinBindingId, authorizer: grant.authorizerKeyId, current });
    }

    const keyLink = await this.devices.lockCurrentLinkOfKey(context, key.keyId);
    if (current !== undefined && keyLink !== undefined && keyLink.bindingId === current.bindingId) {
      // Same phone, same app: the login replaces that app's session and nothing else.
      await this.#revokeCurrentSession(context, current.bindingId, app);
      return { kind: 'SAME_BINDING', bindingId: current.bindingId, generation: current.generation, keyId: key.keyId, app, grantId: grant.grantId, replacedBindingId: null };
    }

    // A different phone (or none yet). The key may still be linked to another user's binding: that link ends, with its session.
    if (keyLink !== undefined) {
      await this.#revokeCurrentSession(context, keyLink.bindingId, keyLink.app);
      await this.devices.detachLinkOfKey(context, key.keyId);
    }
    if (current !== undefined) {
      await this.devices.detachLinksOfBinding(context, current.bindingId);
      await this.devices.deactivateBinding(context, current.bindingId);
    }
    // Every ordinary session of the user, native, web and legacy alike (the rows stay; admin_sessions is another table).
    await this.sessions.revokeAllForUser(context, userId);

    const generation = await this.devices.nextGeneration(context, userId);
    const bindingId = randomUUID();
    await this.devices.insertBinding(context, { bindingId, userId, generation });
    await this.devices.insertLink(context, { bindingId, keyId: key.keyId, userId, app });
    return { kind: 'NEW_BINDING', bindingId, generation, keyId: key.keyId, app, grantId: grant.grantId, replacedBindingId: current?.bindingId ?? null };
  }

  async #join(
    context: TransactionContext,
    args: {
      userId: string;
      app: DeviceApp;
      key: string;
      grant: string;
      joinBindingId: string;
      authorizer: string | null;
      current: { bindingId: string; generation: number } | undefined;
    },
  ): Promise<BindingPlan> {
    const { userId, app, current } = args;
    const binding = await this.devices.bindingById(context, args.joinBindingId);
    // The endorsement is valid only while the endorsing binding is THIS user's current one and its authorizer key still serves
    // the other app: a replaced binding, another user or a detached key all end the same way.
    if (binding === undefined || !binding.active || binding.userId !== userId || current === undefined || current.bindingId !== binding.bindingId) {
      throw new AppError('DEVICE_PROOF_INVALID');
    }
    const links = await this.devices.currentLinks(context, binding.bindingId);
    if (!links.some((link) => link.keyId === args.authorizer && link.app !== app)) {
      throw new AppError('DEVICE_PROOF_INVALID');
    }
    const keyLink = await this.devices.lockCurrentLinkOfKey(context, args.key);
    if (keyLink !== undefined && keyLink.bindingId !== binding.bindingId) {
      await this.#revokeCurrentSession(context, keyLink.bindingId, keyLink.app);
      await this.devices.detachLinkOfKey(context, args.key);
    }
    const existing = links.find((link) => link.app === app);
    if (existing !== undefined && existing.keyId !== args.key) {
      // The app lost its key (cleared / reinstalled) and joins again with a new one: the old link is history.
      await this.#revokeCurrentSession(context, binding.bindingId, app);
      await this.devices.detachLinkOfApp(context, binding.bindingId, app);
    } else if (existing !== undefined) {
      await this.#revokeCurrentSession(context, binding.bindingId, app);
    }
    if (existing === undefined || existing.keyId !== args.key) {
      await this.devices.insertLink(context, { bindingId: binding.bindingId, keyId: args.key, userId, app });
    }
    return { kind: 'JOIN', bindingId: binding.bindingId, generation: binding.generation, keyId: args.key, app, grantId: args.grant, replacedBindingId: null };
  }

  async #revokeCurrentSession(context: TransactionContext, bindingId: string, app: DeviceApp): Promise<void> {
    const sessionId = await this.devices.lockCurrentSessionOf(context, bindingId, app);
    if (sessionId !== undefined) {
      // The trigger on app.sessions clears is_current in the same statement.
      await this.devices.revokeSession(context, sessionId);
    }
  }

  async finish(context: TransactionContext, plan: BindingPlan, args: { userId: string; sessionId: string }): Promise<BindingInfo> {
    await this.devices.insertSessionBinding(context, {
      sessionId: args.sessionId,
      bindingId: plan.bindingId,
      keyId: plan.keyId,
      app: plan.app,
      generation: plan.generation,
    });
    await this.devices.consumeGrant(context, plan.grantId, args.sessionId);
    if (plan.replacedBindingId !== null) {
      await this.outbox.append(context, {
        eventType: DEVICE_REPLACED_EVENT_TYPE,
        eventSchemaVersion: DEVICE_REPLACED_EVENT_SCHEMA_VERSION,
        resourceType: 'user',
        resourceId: args.userId,
        resourceVersion: plan.generation,
        payload: {
          user_id: args.userId,
          old_binding_id: plan.replacedBindingId,
          new_binding_id: plan.bindingId,
          generation: plan.generation,
        },
      });
    }
    return { bindingId: plan.bindingId, generation: plan.generation };
  }

  /**
   * Replay authorization of a native login / register (contract11 section 5): the SAME session, the SAME key, the grant that was
   * consumed by exactly that session, and a binding that is still the user's current one. Anything else is not replayable.
   */
  async assertReplayable(context: TransactionContext, args: { sessionId: string; proof: NativeAuthProof }): Promise<BindingInfo> {
    const binding = await this.devices.sessionBinding(context, args.sessionId);
    const grant = await this.devices.findGrantByDigest(context, args.proof.tokenDigest, false);
    if (
      binding === undefined ||
      !binding.usable ||
      binding.keyId !== args.proof.keyId ||
      grant === undefined ||
      grant.consumedOperationId !== args.sessionId ||
      grant.keyId !== args.proof.keyId
    ) {
      throw new AppError('AUTH_RESULT_NOT_REPLAYABLE');
    }
    return { bindingId: binding.bindingId, generation: binding.generation };
  }
}
