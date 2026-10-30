import { Injectable } from '@nestjs/common';
import { TERMINAL_STATES } from '../delivery/delivery-constants';
import { DeliveryRepository, DeliveryRow } from '../delivery/delivery-repository';
import { DriverRepository } from '../driver/driver-repository';
import { ENDED_STATUSES, OrderStatus } from '../orders/order-constants';
import { OrderRepository, OrderRow } from '../orders/order-repository';
import { ShopRepository } from '../shop/shop-repository';
import { TransactionContext } from '../transaction/transaction-context';
import { ChatRoomType } from './order-chat-constants';

// WHO belongs to a room, decided from the owners' tables at the moment of asking (never from a client, an old notification or a role name):
//  - the customer who placed the order;
//  - the owner of the shop the order (or the direct delivery) belongs to;
//  - the Shipper who HOLDS the delivery now (an ACTIVE assignment). A Shipper who has not accepted, gave the delivery back, was released by the Admin or lost
//    it because the call was cancelled is not a participant. A Shipper whose assignment ended by finishing (completed / failed) may still READ once the room is
//    closed, never write.
// A room is OPEN while its subject is: the order has not reached a terminal status (a failed delivery does not end an order), or the direct delivery has not
// reached a terminal state. The same predicate is used to read, to send and to decide who a push goes to.

export interface ChatRoom {
  readonly type: ChatRoomType;
  /** The order id (ORDER) or the delivery id (DIRECT). */
  readonly id: string;
  readonly shopId: string | null;
  readonly customerUserId: string | null;
  readonly customerName: string | null;
  readonly shopName: string;
  readonly open: boolean;
}

export interface ChatSeat {
  readonly room: ChatRoom;
  readonly mayRead: boolean;
  readonly maySend: boolean;
}

export interface ChatRecipient {
  readonly userId: string;
  readonly app: 'FOOD' | 'SHIP';
  readonly targetType: 'ORDER' | 'DELIVERY';
  readonly targetId: string;
}

export const orderIsOpen = (status: string): boolean => !ENDED_STATUSES.includes(status as OrderStatus);
export const deliveryIsOpen = (state: string): boolean => !(TERMINAL_STATES as readonly string[]).includes(state);

const orderRoom = (o: OrderRow): ChatRoom => ({ type: 'ORDER', id: o.orderId, shopId: o.shopId, customerUserId: o.customerUserId, customerName: o.recipientName, shopName: o.shopName, open: orderIsOpen(o.status) });
const directRoom = (d: DeliveryRow): ChatRoom => ({
  type: 'DIRECT',
  id: d.deliveryId,
  shopId: d.shopId,
  customerUserId: d.source === 'CUSTOMER' ? d.requestedBy : null,
  customerName: d.source === 'CUSTOMER' ? d.shopName : null,
  shopName: d.shopName,
  open: deliveryIsOpen(d.state),
});

@Injectable()
export class OrderChatParticipants {
  constructor(
    private readonly orders: OrderRepository,
    private readonly deliveries: DeliveryRepository,
    private readonly shops: ShopRepository,
    private readonly drivers: DriverRepository,
  ) {}

  /** The room of an order or of a direct delivery by id, for the server's own use (M08); a client never gets a room this way. */
  async orderRoom(context: TransactionContext, orderId: string): Promise<ChatRoom | undefined> {
    const order = await this.orders.findById(context, orderId);
    return order === undefined ? undefined : orderRoom(order);
  }

  async directRoom(context: TransactionContext, deliveryId: string): Promise<ChatRoom | undefined> {
    const delivery = await this.deliveries.findById(context, deliveryId);
    return delivery === undefined || (delivery.source !== 'DIRECT' && delivery.source !== 'CUSTOMER') ? undefined : directRoom(delivery);
  }

  /** The customer's own order. Another account's order reads as missing. */
  async customerSeat(context: TransactionContext, userId: string, orderId: string): Promise<ChatSeat | undefined> {
    const order = await this.orders.findOfCustomer(context, orderId, userId);
    return order === undefined ? undefined : { room: orderRoom(order), mayRead: true, maySend: orderIsOpen(order.status) };
  }

  /** The customer's own direct delivery (source CUSTOMER). Another account's delivery reads as missing. */
  async customerDirectSeat(context: TransactionContext, userId: string, deliveryId: string): Promise<ChatSeat | undefined> {
    const delivery = await this.deliveries.findOfCustomer(context, deliveryId, userId);
    return delivery === undefined || delivery.source !== 'CUSTOMER' ? undefined : { room: directRoom(delivery), mayRead: true, maySend: deliveryIsOpen(delivery.state) };
  }

  /** The order of the caller's own shop. */
  async shopOrderSeat(context: TransactionContext, shopId: string, orderId: string): Promise<ChatSeat | undefined> {
    const order = await this.orders.findOfShop(context, orderId, shopId);
    return order === undefined ? undefined : { room: orderRoom(order), mayRead: true, maySend: orderIsOpen(order.status) };
  }

  /** A direct delivery of the caller's own shop (an ORDER delivery is a room of its order, never of the delivery). */
  async shopDirectSeat(context: TransactionContext, shopId: string, deliveryId: string): Promise<ChatSeat | undefined> {
    const delivery = await this.deliveries.findById(context, deliveryId);
    if (delivery === undefined || delivery.source !== 'DIRECT' || delivery.shopId !== shopId) {
      return undefined;
    }
    return { room: directRoom(delivery), mayRead: true, maySend: deliveryIsOpen(delivery.state) };
  }

  /** The room of a delivery for a Shipper: through the delivery the Shipper is (or was) assigned to, nothing else. */
  async shipperSeat(context: TransactionContext, driverId: string, deliveryId: string): Promise<ChatSeat | undefined> {
    const delivery = await this.deliveries.findById(context, deliveryId);
    if (delivery === undefined) {
      return undefined;
    }
    const mine = (await this.deliveries.listAssignments(context, deliveryId)).filter((a) => a.driverId === driverId);
    if (mine.length === 0) {
      return undefined;
    }
    let room: ChatRoom;
    if (delivery.source === 'ORDER') {
      const order = delivery.orderId === null ? undefined : await this.orders.findById(context, delivery.orderId);
      if (order === undefined) {
        return undefined;
      }
      room = orderRoom(order);
    } else {
      room = directRoom(delivery);
    }
    const holds = mine.some((a) => a.status === 'ACTIVE') && deliveryIsOpen(delivery.state);
    const finished = mine.some((a) => a.status === 'COMPLETED' || a.status === 'FAILED');
    return { room, mayRead: holds || (finished && !room.open), maySend: holds && room.open };
  }

  /** The accounts to tell about a new message, never the sender: who may write in the room now. */
  async recipients(context: TransactionContext, room: ChatRoom, excludeUserId: string): Promise<ChatRecipient[]> {
    const out: ChatRecipient[] = [];
    if (room.customerUserId !== null) {
      out.push({ userId: room.customerUserId, app: 'FOOD', targetType: room.type === 'ORDER' ? 'ORDER' : 'DELIVERY', targetId: room.id });
    }
    if (room.shopId !== null) {
      const owner = await this.shops.ownerUserIdOfShop(context, room.shopId);
      if (owner !== undefined) {
        out.push({ userId: owner, app: 'FOOD', targetType: room.type === 'ORDER' ? 'ORDER' : 'DELIVERY', targetId: room.id });
      }
    }
    const running = room.type === 'ORDER' ? (await this.deliveries.listOfOrder(context, room.id)).filter((d) => deliveryIsOpen(d.state)) : [];
    const holders = room.type === 'ORDER' ? running : [await this.deliveries.findById(context, room.id)].filter((d): d is DeliveryRow => d !== undefined);
    for (const delivery of holders) {
      const active = await this.deliveries.findActiveAssignment(context, delivery.deliveryId);
      const driver = active === undefined ? undefined : await this.drivers.findById(context, active.driverId);
      if (driver !== undefined && (driver.status === 'ACTIVE' || driver.status === 'CLOSING')) {
        out.push({ userId: driver.userId, app: 'SHIP', targetType: 'DELIVERY', targetId: delivery.deliveryId });
      }
    }
    return out.filter((r) => r.userId !== excludeUserId);
  }
}
