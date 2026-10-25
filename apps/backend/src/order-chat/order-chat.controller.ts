import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, AuthPrincipal } from '../auth/auth-principal';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { AppError } from '../common/app-errors';
import { ChatDoor, OrderChatService } from './order-chat-service';
import { parsePageQuery, parseRoomId, parseSendBody } from './order-chat-validation';

type Key = string | string[] | undefined;

function principalOf(request: AuthenticatedRequest): AuthPrincipal {
  if (request.auth === undefined) {
    // Unreachable behind the guard; fail closed rather than act without an identity.
    throw new AppError('SESSION_INVALID');
  }
  return request.auth;
}

/**
 * The order chat routes (#191), behind the client session guard. Identity is the principal only; the only identifier is the order (customer, shop) or the delivery
 * (the shop's direct call, the Shipper), resolved against what the caller may see, so a room that is not theirs reads as not found. A send takes an Idempotency-Key.
 */
abstract class ChatRoutes {
  protected constructor(protected readonly chat: OrderChatService) {}

  protected async readRoom(request: AuthenticatedRequest, door: ChatDoor, id: string, query: unknown) {
    return { data: await this.chat.read(principalOf(request), door, parseRoomId(id), parsePageQuery(query)) };
  }

  protected async sendTo(request: AuthenticatedRequest, door: ChatDoor, id: string, body: unknown, key: Key) {
    return { data: await this.chat.send(principalOf(request), door, parseRoomId(id), parseSendBody(body), key) };
  }
}

@UseGuards(SessionAuthGuard)
@Controller('customers/me/orders/:order_id/chat')
export class CustomerOrderChatController extends ChatRoutes {
  constructor(chat: OrderChatService) {
    super(chat);
  }

  @Get()
  read(@Param('order_id') id: string, @Req() request: AuthenticatedRequest, @Query() query: unknown) {
    return this.readRoom(request, 'CUSTOMER_ORDER', id, query);
  }

  @Post()
  @HttpCode(201)
  send(@Param('order_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    return this.sendTo(request, 'CUSTOMER_ORDER', id, body, key);
  }
}

@UseGuards(SessionAuthGuard)
@Controller('shop/me')
export class ShopOrderChatController extends ChatRoutes {
  constructor(chat: OrderChatService) {
    super(chat);
  }

  @Get('orders/:order_id/chat')
  readOrder(@Param('order_id') id: string, @Req() request: AuthenticatedRequest, @Query() query: unknown) {
    return this.readRoom(request, 'SHOP_ORDER', id, query);
  }

  @Post('orders/:order_id/chat')
  @HttpCode(201)
  sendOrder(@Param('order_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    return this.sendTo(request, 'SHOP_ORDER', id, body, key);
  }

  /** The chat of a direct call (no order around it): the delivery itself is the file. */
  @Get('deliveries/:delivery_id/chat')
  readDirect(@Param('delivery_id') id: string, @Req() request: AuthenticatedRequest, @Query() query: unknown) {
    return this.readRoom(request, 'SHOP_DIRECT', id, query);
  }

  @Post('deliveries/:delivery_id/chat')
  @HttpCode(201)
  sendDirect(@Param('delivery_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    return this.sendTo(request, 'SHOP_DIRECT', id, body, key);
  }
}

@UseGuards(SessionAuthGuard)
@Controller('driver/deliveries/:delivery_id/chat')
export class ShipperOrderChatController extends ChatRoutes {
  constructor(chat: OrderChatService) {
    super(chat);
  }

  @Get()
  read(@Param('delivery_id') id: string, @Req() request: AuthenticatedRequest, @Query() query: unknown) {
    return this.readRoom(request, 'SHIPPER_DELIVERY', id, query);
  }

  @Post()
  @HttpCode(201)
  send(@Param('delivery_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    return this.sendTo(request, 'SHIPPER_DELIVERY', id, body, key);
  }
}
