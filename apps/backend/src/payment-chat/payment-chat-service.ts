import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AuthPrincipal } from '../auth/auth-principal';
import { AppError } from '../common/app-errors';
import { DeliveryActors } from '../delivery/delivery-actors';
import { JsonObject } from '../idempotency/idempotency-executor';
import { parseIdempotencyKey } from '../idempotency/idempotency-key';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { OutboxWriter } from '../outbox/outbox-writer';
import { encodeCursor, PageQuery, SendInput } from '../order-chat/order-chat-validation';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { CaseKind, OUTBOX_PAYMENT_CHAT_MESSAGE, PAYMENT_CHAT_EVENT_SCHEMA, PAYMENT_CHAT_RATE_MAX, PAYMENT_CHAT_RATE_WINDOW_MS, PAYMENT_CHAT_RESOURCE, PaymentChatRole } from './payment-chat-constants';
import { cursorOf, milestones, PaymentFeedEntry, pageOf } from './payment-chat-feed';
import { CaseOwner, PaymentChatRepository, PaymentMessageRow } from './payment-chat-repository';

/** What the Administration's CURRENT rights give this account on a payment room, decided inside the room's transaction under the administrator's locks. */
export interface PaymentChatAccess {
  readonly role: 'ADMIN' | 'SYSTEM';
  /** May write: the right to HANDLE the money of this kind of request (not merely to read it). */
  readonly maySend: boolean;
}

export interface PaymentChatAdmin {
  readonly userId: string;
  readonly authorize: (context: TransactionContext) => Promise<PaymentChatAccess>;
}

interface Caller {
  readonly userId: string;
  readonly role: PaymentChatRole;
  readonly name: string;
}

const iso = (ms: number): string => new Date(ms).toISOString();

/**
 * The payment conversation (#199): one room per Shipper top-up request or per shop payment request, a feed of typed messages and the milestones of the request.
 * Rights are decided on the server at every read and every send, from the locked session and the owners' tables: knowing an id grants nothing, and another
 * Shipper's / shop's request reads as not found. A message changes nothing about the request, a wallet, the ledger or a right: money is confirmed by the
 * administration's own buttons, and the right to extra dishes is a third, separate act.
 *
 * A send is ONE transaction: session locks (shared) -> the request row (SHARED) -> the message. Confirming, rejecting and cancelling update that same row, so they
 * wait for the sends in flight and a send that comes after them reads the final state and is refused (409 PAYMENT_CHAT_CLOSED): a send and a close cannot both win.
 * The Idempotency-Key is the message's own key (unique per sender): a retry returns the stored message, even after the request closed. The history of a closed
 * room stays readable; there is no purge (the retention period is not approved yet).
 */
@Injectable()
export class PaymentChatService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly actors: DeliveryActors,
    private readonly repo: PaymentChatRepository,
    private readonly outbox: OutboxWriter,
  ) {}

  // ---- the apps ----------------------------------------------------------------------------------------------------------------

  /** `kind` DRIVER_TOPUP is the Shipper's door (11Ship); SHOP_PAYMENT is the shop owner's (11Food). */
  async read(principal: AuthPrincipal, kind: CaseKind, id: string, page: PageQuery): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const { caller, owner } = await this.#seat(context, principal, kind, id);
      return this.#feed(context, owner, caller.userId, page, true);
    });
  }

  async send(principal: AuthPrincipal, kind: CaseKind, id: string, input: SendInput, key: string | readonly string[] | undefined): Promise<JsonObject> {
    const clientKey = parseIdempotencyKey(key);
    return this.transactions.withTransaction(async (context) => {
      const { caller, owner } = await this.#seat(context, principal, kind, id);
      return this.#sendCore(context, caller, owner, input, clientKey);
    });
  }

  async #seat(context: TransactionContext, principal: AuthPrincipal, kind: CaseKind, id: string): Promise<{ caller: Caller; owner: CaseOwner }> {
    const notFound = kind === 'DRIVER_TOPUP' ? 'TOPUP_REQUEST_NOT_FOUND' : 'SHOP_PAYMENT_NOT_FOUND';
    if (kind === 'DRIVER_TOPUP') {
      const { actor, driver } = await this.actors.shipperReader(context, principal);
      const owner = await this.repo.findCase(context, kind, id);
      if (owner === undefined || owner.subjectId !== driver.driverId) {
        throw new AppError(notFound);
      }
      return { caller: { userId: actor.userId, role: 'SHIPPER', name: cleanName(driver.fullName, 'Shipper') }, owner };
    }
    const { actor, shop } = await this.actors.shopReader(context, principal);
    const owner = await this.repo.findCase(context, kind, id);
    if (owner === undefined || owner.subjectId !== shop.shopId) {
      throw new AppError(notFound);
    }
    return { caller: { userId: actor.userId, role: 'SHOP', name: cleanName(shop.name, 'Quán') }, owner };
  }

  // ---- the Administration ------------------------------------------------------------------------------------------------------

  async readForAdmin(admin: PaymentChatAdmin, kind: CaseKind, id: string, page: PageQuery): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const access = await admin.authorize(context);
      const owner = await this.#adminCase(context, kind, id);
      return this.#feed(context, owner, admin.userId, page, access.maySend);
    });
  }

  async sendForAdmin(admin: PaymentChatAdmin, kind: CaseKind, id: string, input: SendInput, key: string | readonly string[] | undefined): Promise<JsonObject> {
    const clientKey = parseIdempotencyKey(key);
    return this.transactions.withTransaction(async (context) => {
      const access = await admin.authorize(context);
      const owner = await this.#adminCase(context, kind, id);
      if (!access.maySend) {
        // A read-only administrator cannot write, whatever the screen shows: the right to handle this money is checked here, on the server.
        throw new AppError('ADMIN_FORBIDDEN');
      }
      const caller: Caller = { userId: admin.userId, role: access.role, name: access.role === 'SYSTEM' ? 'Hệ thống' : 'Quản trị' };
      return this.#sendCore(context, caller, owner, input, clientKey);
    });
  }

  async #adminCase(context: TransactionContext, kind: CaseKind, id: string): Promise<CaseOwner> {
    const owner = await this.repo.findCase(context, kind, id);
    if (owner === undefined) {
      throw new AppError(kind === 'DRIVER_TOPUP' ? 'TOPUP_REQUEST_NOT_FOUND' : 'SHOP_PAYMENT_NOT_FOUND');
    }
    return owner;
  }

  // ---- read ----------------------------------------------------------------------------------------------------------------------

  async #feed(context: TransactionContext, owner: CaseOwner, viewerId: string, page: PageQuery, maySendIfOpen: boolean): Promise<JsonObject> {
    const nowMs = await freshClockMs(context);
    const facts = await this.repo.facts(context, owner.kind, owner.id);
    if (facts === undefined) {
      throw new AppError(owner.kind === 'DRIVER_TOPUP' ? 'TOPUP_REQUEST_NOT_FOUND' : 'SHOP_PAYMENT_NOT_FOUND');
    }
    const messages = await this.repo.listOlder(context, owner.kind, owner.id, page.before, page.limit + 1);
    const result = pageOf(messages, milestones(facts), page.before, page.limit);
    const first = result.entries[0];
    const open = facts.state === 'PENDING';
    return {
      room: { kind: owner.kind, id: owner.id, open, can_send: open && maySendIfOpen, state: facts.state },
      items: result.entries.map((e) => entryView(e, viewerId)),
      has_more: result.hasMore,
      next_before: result.hasMore && first !== undefined ? encodeCursor(cursorOf(first)) : null,
      server_now: iso(nowMs),
    };
  }

  // ---- send ----------------------------------------------------------------------------------------------------------------------

  async #sendCore(context: TransactionContext, caller: Caller, owner: CaseOwner, input: SendInput, clientKey: string): Promise<JsonObject> {
    const stored = await this.repo.findByKey(context, caller.userId, clientKey);
    if (stored !== undefined) {
      return replay(stored, owner, input, caller.userId, (await this.repo.facts(context, owner.kind, owner.id))?.state ?? 'PENDING');
    }
    // The state is read AFTER the shared lock: if a close committed first the room is closed; if it is still running the close waits for this transaction.
    const state = await this.repo.lockStateShared(context, owner.kind, owner.id);
    if (state === undefined) {
      throw new AppError(owner.kind === 'DRIVER_TOPUP' ? 'TOPUP_REQUEST_NOT_FOUND' : 'SHOP_PAYMENT_NOT_FOUND');
    }
    if (state !== 'PENDING') {
      throw new AppError('PAYMENT_CHAT_CLOSED');
    }
    if ((await this.repo.countRecent(context, caller.userId, owner.kind, owner.id, PAYMENT_CHAT_RATE_WINDOW_MS)) >= PAYMENT_CHAT_RATE_MAX) {
      throw new AppError('PAYMENT_CHAT_RATE_LIMITED');
    }
    const created = await this.repo.insert(context, { messageId: randomUUID(), caseKind: owner.kind, caseId: owner.id, senderUserId: caller.userId, senderRole: caller.role, senderName: caller.name, body: input.body, clientKey });
    if (created === undefined) {
      // The same key was written by a request that was still running when this one started (it committed meanwhile).
      const winner = await this.repo.findByKey(context, caller.userId, clientKey);
      if (winner === undefined) {
        throw new AppError('IDEMPOTENCY_BUSY');
      }
      return replay(winner, owner, input, caller.userId, 'PENDING');
    }
    await this.outbox.append(context, {
      eventType: OUTBOX_PAYMENT_CHAT_MESSAGE,
      eventSchemaVersion: PAYMENT_CHAT_EVENT_SCHEMA,
      resourceType: PAYMENT_CHAT_RESOURCE,
      resourceId: owner.id,
      resourceVersion: 1,
      payload: { case_kind: owner.kind, case_id: owner.id, message_id: created.messageId, sender_user_id: caller.userId },
    });
    return { message: messageView(created, caller.userId), room: { kind: owner.kind, id: owner.id, open: true, can_send: true, state: 'PENDING' }, replayed: false };
  }
}

function replay(stored: PaymentMessageRow, owner: CaseOwner, input: SendInput, userId: string, state: string): JsonObject {
  const open = state === 'PENDING';
  if (stored.caseKind !== owner.kind || stored.caseId !== owner.id || stored.body !== input.body) {
    throw new AppError('IDEMPOTENCY_KEY_REUSED');
  }
  return { message: messageView(stored, userId), room: { kind: owner.kind, id: owner.id, open, can_send: open, state }, replayed: true };
}

function cleanName(name: string | null, fallback: string): string {
  const clean = (name ?? '').trim();
  return clean === '' ? fallback : [...clean].slice(0, 120).join('');
}

function messageView(m: PaymentMessageRow, viewerId: string): JsonObject {
  return { type: 'message', id: m.messageId, at: iso(m.atMs), sender: { role: m.senderRole, name: m.senderName, mine: m.senderUserId === viewerId }, body: m.body };
}

function entryView(e: PaymentFeedEntry, viewerId: string): JsonObject {
  return e.kind === 'system' ? { type: 'system', id: e.id, at: iso(e.atMs), text: e.text } : messageView(e.message, viewerId);
}
