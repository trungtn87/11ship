import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, AuthPrincipal } from '../auth/auth-principal';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { AppError } from '../common/app-errors';
import { parsePageQuery, parseRoomId, parseSendBody } from '../order-chat/order-chat-validation';
import { parseEmptyBody } from '../shop-payment/shop-payment-validation';
import { CaseKind } from './payment-chat-constants';
import { PaymentChatService } from './payment-chat-service';
import { TopupReportService } from './topup-report-service';
import { randomUUID } from 'node:crypto';

type Key = string | string[] | undefined;

function principalOf(request: AuthenticatedRequest): AuthPrincipal {
  if (request.auth === undefined) {
    // Unreachable behind the guard; fail closed rather than act without an identity.
    throw new AppError('SESSION_INVALID');
  }
  return request.auth;
}

abstract class PaymentChatRoutes {
  protected constructor(protected readonly chat: PaymentChatService) {}

  protected async readRoom(request: AuthenticatedRequest, kind: CaseKind, id: string, query: unknown) {
    return { data: await this.chat.read(principalOf(request), kind, parseRoomId(id), parsePageQuery(query)) };
  }

  protected async sendTo(request: AuthenticatedRequest, kind: CaseKind, id: string, body: unknown, key: Key) {
    return { data: await this.chat.send(principalOf(request), kind, parseRoomId(id), parseSendBody(body), key) };
  }
}

/** The Shipper's door (11Ship): the room of ONE of the Shipper's own top-up requests, and the "Tôi đã chuyển khoản" mark. Nothing here moves money. */
@UseGuards(SessionAuthGuard)
@Controller('driver/wallet/topup-requests/:request_id')
export class ShipperPaymentChatController extends PaymentChatRoutes {
  constructor(
    chat: PaymentChatService,
    private readonly reports: TopupReportService,
  ) {
    super(chat);
  }

  @Get('chat')
  read(@Param('request_id') id: string, @Req() request: AuthenticatedRequest, @Query() query: unknown) {
    return this.readRoom(request, 'DRIVER_TOPUP', id, query);
  }

  @Post('chat')
  @HttpCode(201)
  send(@Param('request_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    return this.sendTo(request, 'DRIVER_TOPUP', id, body, key);
  }

  @Post('report-transfer')
  @HttpCode(200)
  async report(@Param('request_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest & { requestId?: string }) {
    parseEmptyBody(body);
    return { data: await this.reports.report(principalOf(request), parseRoomId(id), key, request.requestId ?? randomUUID()) };
  }
}

/** The shop owner's door (11Food): the room of ONE of the shop's own payment requests. */
@UseGuards(SessionAuthGuard)
@Controller('shop/me/payment-requests/:request_id/chat')
export class ShopPaymentChatController extends PaymentChatRoutes {
  constructor(chat: PaymentChatService) {
    super(chat);
  }

  @Get()
  read(@Param('request_id') id: string, @Req() request: AuthenticatedRequest, @Query() query: unknown) {
    return this.readRoom(request, 'SHOP_PAYMENT', id, query);
  }

  @Post()
  @HttpCode(201)
  send(@Param('request_id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    return this.sendTo(request, 'SHOP_PAYMENT', id, body, key);
  }
}
