import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AuthPrincipal } from '../auth/auth-principal';
import { CUSTOMER_ROLE } from '../auth/auth-constants';
import { UserRepository } from '../auth/user-repository';
import { ClientSessionAuthority } from '../client-auth/client-session-authority';
import { AppError } from '../common/app-errors';
import { DeliveryActors } from '../delivery/delivery-actors';
import { DeliveryRepository } from '../delivery/delivery-repository';
import { DeliveryViews } from '../delivery/delivery-views';
import { JsonObject } from '../idempotency/idempotency-executor';
import { parseIdempotencyKey } from '../idempotency/idempotency-key';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { OrderRepository } from '../orders/order-repository';
import { buildDeliveryStory, buildOrderStory, StoryDelivery } from '../orders/order-story';
import { OpsSettingsService } from '../ops/ops-settings-service';
import { OutboxWriter } from '../outbox/outbox-writer';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { CHAT_EVENT_LIMIT, CHAT_RATE_MAX, CHAT_RATE_WINDOW_MS, ChatRole, ChatRoomType, ORDER_CHAT_EVENT_SCHEMA, ORDER_CHAT_RESOURCE, OUTBOX_ORDER_CHAT_MESSAGE } from './order-chat-constants';
import { cursorOf, FeedEntry, pageOf, systemEntries } from './order-chat-feed';
import { ChatRoom, ChatSeat, deliveryIsOpen, OrderChatParticipants, orderIsOpen } from './order-chat-participants';
import { ChatMessageRow, OrderChatRepository } from './order-chat-repository';
import { encodeCursor, PageQuery, SendInput } from './order-chat-validation';

/** Which door the caller came through. The identifier in the path is the order (customer, shop) or the delivery (shop's direct call, Shipper). */
export type ChatDoor = 'CUSTOMER_ORDER' | 'SHOP_ORDER' | 'SHOP_DIRECT' | 'SHIPPER_DELIVERY';

/** A staff account asking for a room: who it is and the check of its current right, run inside the room's own transaction. */
export interface ChatAdmin {
  readonly userId: string;
  /** Decides the right under the admin's locks and says which kind of staff account it is (the label of its messages). */
  readonly authorize: (context: TransactionContext) => Promise<'ADMIN' | 'SYSTEM'>;
}

interface Caller {
  readonly userId: string;
  readonly role: ChatRole;
  /** The Shipper's driver id (SHIPPER only). */
  readonly driverId: string | null;
  readonly shopId: string | null;
  readonly shipperName: string | null;
}

const iso = (ms: number): string => new Date(ms).toISOString();

/**
 * The order chat ("Trao đổi đơn hàng", #191): one room per order (or per direct delivery), a feed of typed messages and business milestones. Rights are decided
 * on the server at every read and every send, from the locked session and the owners' tables (see OrderChatParticipants): knowing an id grants nothing, and a
 * Shipper who lost the assignment loses the room. A message changes nothing about the order (no fee, no cancellation, no state): those are the official
 * actions of M07/M10.
 *
 * A send is ONE transaction: session locks (shared) -> the Shipper's delivery row (SHARED) -> the order row (SHARED) -> the message. Every command that ends an
 * order or a delivery updates those same rows, so it waits for the sends in flight, and a send that comes after it reads the final status and is refused: a send
 * and a close cannot both win. The Idempotency-Key is the message's own key (unique per sender): a retry returns the stored message, even after the room closed.
 */
@Injectable()
export class OrderChatService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly actors: DeliveryActors,
    private readonly authority: ClientSessionAuthority,
    private readonly users: UserRepository,
    private readonly participants: OrderChatParticipants,
    private readonly repo: OrderChatRepository,
    private readonly orders: OrderRepository,
    private readonly deliveries: DeliveryRepository,
    private readonly deliveryViews: DeliveryViews,
    private readonly outbox: OutboxWriter,
    private readonly settings: OpsSettingsService,
  ) {}

  // ---- who is asking ---------------------------------------------------------------------------------------------------------

  async #caller(context: TransactionContext, principal: AuthPrincipal, door: ChatDoor): Promise<Caller> {
    if (door === 'CUSTOMER_ORDER') {
      const actor = await this.authority.lock(context, principal, 'share');
      if (actor.app !== 'FOOD' || !(await this.users.hasRole(context, actor.userId, CUSTOMER_ROLE))) {
        throw new AppError('ROLE_NOT_AVAILABLE');
      }
      return { userId: actor.userId, role: 'CUSTOMER', driverId: null, shopId: null, shipperName: null };
    }
    if (door === 'SHIPPER_DELIVERY') {
      const { actor, driver } = await this.actors.shipperReader(context, principal);
      return { userId: actor.userId, role: 'SHIPPER', driverId: driver.driverId, shopId: null, shipperName: driver.fullName };
    }
    const { actor, shop } = await this.actors.shopReader(context, principal);
    return { userId: actor.userId, role: 'SHOP', driverId: null, shopId: shop.shopId, shipperName: null };
  }

  async #seat(context: TransactionContext, caller: Caller, door: ChatDoor, id: string): Promise<ChatSeat> {
    let seat: ChatSeat | undefined;
    switch (door) {
      case 'CUSTOMER_ORDER':
        seat = await this.participants.customerSeat(context, caller.userId, id);
        break;
      case 'SHOP_ORDER':
        seat = await this.participants.shopOrderSeat(context, caller.shopId as string, id);
        break;
      case 'SHOP_DIRECT':
        seat = await this.participants.shopDirectSeat(context, caller.shopId as string, id);
        break;
      case 'SHIPPER_DELIVERY':
        seat = await this.participants.shipperSeat(context, caller.driverId as string, id);
        break;
    }
    if (seat === undefined || !seat.mayRead) {
      // A room that is not yours reads exactly like one that does not exist.
      throw new AppError(door === 'CUSTOMER_ORDER' || door === 'SHOP_ORDER' ? 'ORDER_NOT_FOUND' : 'DELIVERY_NOT_FOUND');
    }
    return seat;
  }

  // ---- read ------------------------------------------------------------------------------------------------------------------

  async read(principal: AuthPrincipal, door: ChatDoor, id: string, page: PageQuery): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const caller = await this.#caller(context, principal, door);
      const seat = await this.#seat(context, caller, door, id);
      return this.#readSeat(context, caller.userId, seat, page);
    });
  }

  async #readSeat(context: TransactionContext, viewerId: string, seat: ChatSeat, page: PageQuery): Promise<JsonObject> {
    const nowMs = await freshClockMs(context);
    const retention = await this.#retention(context, seat.room, nowMs);
    if (retention.expired) {
      // The retention ran out: no content of the conversation is returned any more (the order / delivery events and the audit are untouched).
      return { room: { ...this.#roomView(seat), ...retention.view }, items: [], has_more: false, next_before: null, server_now: iso(nowMs) };
    }
    const milestones = systemEntries(await this.#story(context, seat.room));
    const messages = await this.repo.listOlder(context, seat.room.type, seat.room.id, page.before, page.limit + 1);
    const result = pageOf(messages, milestones, page.before, page.limit);
    const first = result.entries[0];
    return {
      room: { ...this.#roomView(seat), ...retention.view },
      items: result.entries.map((e) => this.#entryView(e, viewerId)),
      has_more: result.hasMore,
      next_before: result.hasMore && first !== undefined ? encodeCursor(cursorOf(first)) : null,
      server_now: iso(nowMs),
    };
  }

  // ---- the Administration (ADMIN / SYSTEM) ------------------------------------------------------------------------------------

  /**
   * The Administration reads and writes a room only while its CURRENT right to view the file allows it: `admin.authorize` runs inside this transaction, under the
   * admin's own locks (the same check as the order / delivery detail of the Administration). There is no other door to a conversation for a staff account.
   */
  async readForAdmin(admin: ChatAdmin, kind: ChatRoomType, id: string, page: PageQuery): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      await admin.authorize(context);
      return this.#readSeat(context, admin.userId, await this.#adminSeat(context, kind, id), page);
    });
  }

  async sendForAdmin(admin: ChatAdmin, kind: ChatRoomType, id: string, input: SendInput, key: string | readonly string[] | undefined): Promise<JsonObject> {
    const clientKey = parseIdempotencyKey(key);
    return this.transactions.withTransaction(async (context) => {
      const role = await admin.authorize(context);
      const caller: Caller = { userId: admin.userId, role, driverId: null, shopId: null, shipperName: null };
      return this.#sendCore(context, caller, () => this.#adminSeat(context, kind, id), input, clientKey);
    });
  }

  async #adminSeat(context: TransactionContext, kind: ChatRoomType, id: string): Promise<ChatSeat> {
    const room = kind === 'ORDER' ? await this.participants.orderRoom(context, id) : await this.participants.directRoom(context, id);
    if (room === undefined) {
      throw new AppError(kind === 'ORDER' ? 'ORDER_NOT_FOUND' : 'DELIVERY_NOT_FOUND');
    }
    return { room, mayRead: true, maySend: room.open };
  }

  /**
   * How long the history of this room is kept (the SYSTEM setting `chat.retention_days`, default 7), counted from the moment the WHOLE file closed — the order, or the
   * direct delivery — and, when a complaint about it closed later, from that later moment. An open complaint holds the history. Expired: the feed is not returned.
   */
  async #retention(context: TransactionContext, room: ChatRoom, nowMs: number): Promise<{ expired: boolean; view: JsonObject }> {
    const days = (await this.settings.load(context)).settings['chat.retention_days'] as number;
    if (room.open) {
      return { expired: false, view: { retention_days: days, expires_at: null, expired: false } };
    }
    const r = await this.repo.retentionOf(context, room.type, room.id);
    if (r.endedAtMs === null) {
      return { expired: false, view: { retention_days: days, expires_at: null, expired: false } };
    }
    const expiresAt = r.openComplaints > 0 ? null : Math.max(r.endedAtMs, r.complaintClosedAtMs ?? 0) + days * 86_400_000;
    const expired = expiresAt !== null && nowMs >= expiresAt;
    return { expired, view: { retention_days: days, expires_at: expiresAt === null ? null : iso(expiresAt), expired } };
  }

  // ---- send ------------------------------------------------------------------------------------------------------------------

  async send(principal: AuthPrincipal, door: ChatDoor, id: string, input: SendInput, key: string | readonly string[] | undefined): Promise<JsonObject> {
    const clientKey = parseIdempotencyKey(key);
    return this.transactions.withTransaction(async (context) => {
      const caller = await this.#caller(context, principal, door);
      // A Shipper's room is decided under the lock of the delivery row: a release / cancel / completion holds that row, so the assignment read below is the
      // state AFTER it. (Lock order of the whole system: delivery, then order.)
      if (door === 'SHIPPER_DELIVERY') {
        if ((await this.repo.lockDeliveryState(context, id)) === undefined) {
          throw new AppError('DELIVERY_NOT_FOUND');
        }
      }
      return this.#sendCore(context, caller, () => this.#seat(context, caller, door, id), input, clientKey);
    });
  }

  async #sendCore(context: TransactionContext, caller: Caller, resolveSeat: () => Promise<ChatSeat>, input: SendInput, clientKey: string): Promise<JsonObject> {
    let seat = await resolveSeat();
    const stored = await this.repo.findByKey(context, caller.userId, clientKey);
    if (stored !== undefined) {
      return this.#replay(stored, seat.room, input, caller.userId);
    }
    // The status is read AFTER the shared lock: if a close committed first the room is closed; if it is still running the close waits for this transaction.
    const open = seat.room.type === 'ORDER' ? await this.#lockedOrderOpen(context, seat.room.id) : deliveryIsOpen((await this.repo.lockDeliveryState(context, seat.room.id)) ?? 'failed');
    if (!open) {
      throw new AppError('ORDER_CHAT_CLOSED');
    }
    seat = await resolveSeat();
    if (!seat.maySend) {
      throw new AppError(seat.room.open ? 'ORDER_CHAT_NOT_PARTICIPANT' : 'ORDER_CHAT_CLOSED');
    }
    if ((await this.repo.countRecent(context, caller.userId, CHAT_RATE_WINDOW_MS)) >= CHAT_RATE_MAX) {
      throw new AppError('ORDER_CHAT_RATE_LIMITED');
    }
    const created = await this.repo.insert(context, {
      messageId: randomUUID(),
      roomType: seat.room.type,
      roomId: seat.room.id,
      senderUserId: caller.userId,
      senderRole: caller.role,
      senderName: this.#senderName(caller, seat.room),
      body: input.body,
      clientKey,
    });
    if (created === undefined) {
      // The same key was written by a request that was still running when this one started (it committed meanwhile).
      const winner = await this.repo.findByKey(context, caller.userId, clientKey);
      if (winner === undefined) {
        throw new AppError('IDEMPOTENCY_BUSY');
      }
      return this.#replay(winner, seat.room, input, caller.userId);
    }
    await this.outbox.append(context, {
      eventType: OUTBOX_ORDER_CHAT_MESSAGE,
      eventSchemaVersion: ORDER_CHAT_EVENT_SCHEMA,
      resourceType: ORDER_CHAT_RESOURCE,
      resourceId: seat.room.id,
      resourceVersion: 1,
      payload: { room_type: seat.room.type, room_id: seat.room.id, message_id: created.messageId, sender_user_id: caller.userId, shop_id: seat.room.shopId },
    });
    return { message: this.#messageView(created, caller.userId), room: this.#roomView(seat), replayed: false };
  }

  #replay(stored: ChatMessageRow, room: ChatRoom, input: SendInput, userId: string): JsonObject {
    if (stored.roomType !== room.type || stored.roomId !== room.id || stored.body !== input.body) {
      throw new AppError('IDEMPOTENCY_KEY_REUSED');
    }
    return { message: this.#messageView(stored, userId), room: { type: room.type, id: room.id, open: room.open, can_send: room.open }, replayed: true };
  }

  async #lockedOrderOpen(context: TransactionContext, orderId: string): Promise<boolean> {
    const status = await this.repo.lockOrderStatus(context, orderId);
    if (status === undefined) {
      throw new AppError('ORDER_NOT_FOUND');
    }
    return orderIsOpen(status);
  }

  #senderName(caller: Caller, room: ChatRoom): string {
    if (caller.role === 'ADMIN' || caller.role === 'SYSTEM') {
      return caller.role === 'SYSTEM' ? 'Hệ thống' : 'Quản trị';
    }
    const name = caller.role === 'SHOP' ? room.shopName : caller.role === 'SHIPPER' ? caller.shipperName : room.customerName;
    const clean = (name ?? '').trim();
    return clean === '' ? (caller.role === 'CUSTOMER' ? 'Khách hàng' : caller.role === 'SHOP' ? 'Quán' : 'Shipper') : [...clean].slice(0, 120).join('');
  }

  // ---- milestones ------------------------------------------------------------------------------------------------------------

  /** The business milestones of the room, from the real order / delivery events (the same source and rules as the old "Diễn biến"), one wording for everybody. */
  async #story(context: TransactionContext, room: ChatRoom) {
    if (room.type === 'DIRECT') {
      const delivery = await this.deliveries.findById(context, room.id);
      return delivery === undefined ? [] : buildDeliveryStory(await this.deliveryViews.storyOf(context, delivery), 'room');
    }
    const events = (await this.orders.listEvents(context, room.id, CHAT_EVENT_LIMIT)).map((e) => ({ eventId: e.eventId, atMs: e.atMs, type: e.type, actorType: e.actorType, note: e.note, details: e.details }));
    const calls: StoryDelivery[] = [];
    for (const d of await this.deliveries.listOfOrder(context, room.id)) {
      calls.push(await this.deliveryViews.storyOf(context, d));
    }
    return buildOrderStory(events, calls, 'room');
  }

  // ---- views -----------------------------------------------------------------------------------------------------------------

  #roomView(seat: ChatSeat): JsonObject {
    return { type: seat.room.type, id: seat.room.id, open: seat.room.open, can_send: seat.maySend };
  }

  #messageView(m: ChatMessageRow, viewerId: string): JsonObject {
    return { type: 'message', id: m.messageId, at: iso(m.atMs), sender: { role: m.senderRole, name: m.senderName, mine: m.senderUserId === viewerId }, body: m.body };
  }

  #entryView(e: FeedEntry, viewerId: string): JsonObject {
    return e.kind === 'system' ? { type: 'system', id: e.id, at: iso(e.atMs), text: e.text } : this.#messageView(e.message, viewerId);
  }
}
