import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { ADMIN_AUTH_CONFIG } from '../admin-auth/admin-auth-config.provider';
import { AdminLimiter } from '../admin-auth/admin-limiter';
import { AdminRequest, AdminTransport, Csrf } from '../admin-shippers/admin-shipper.controller';
import { AdminAuthConfig } from '../config/admin-auth-config';
import { parsePageQuery, parseRoomId, parseSendBody } from '../order-chat/order-chat-validation';
import { AdminPaymentChatService } from './admin-payment-chat-service';

/**
 * /v1/admin/finance/topup-requests/:id/chat and /v1/admin/shop-payments/:id/chat (#199): the payment room of ONE request, for the Administration web. The SESSION
 * cookie is the only credential; a send needs CSRF and an Idempotency-Key; the rights are asked again under the locks in the service. No-store comes from the module.
 */
@Controller('admin')
export class AdminPaymentChatController {
  readonly #transport: AdminTransport;

  constructor(
    private readonly chat: AdminPaymentChatService,
    limiter: AdminLimiter,
    @Inject(ADMIN_AUTH_CONFIG) config: AdminAuthConfig,
  ) {
    this.#transport = new AdminTransport(limiter, config);
  }

  @Get('finance/topup-requests/:request_id/chat')
  async topupRead(@Param('request_id') id: string, @Query() query: unknown, @Req() request: AdminRequest) {
    return { data: await this.chat.read(this.#transport.read(request), 'DRIVER_TOPUP', parseRoomId(id), parsePageQuery(query)) };
  }

  @Post('finance/topup-requests/:request_id/chat')
  @HttpCode(201)
  async topupSend(@Param('request_id') id: string, @Body() body: unknown, @Req() request: AdminRequest, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    const token = await this.#transport.write(request);
    return { data: await this.chat.send(token, csrf, 'DRIVER_TOPUP', parseRoomId(id), parseSendBody(body), key) };
  }

  @Get('shop-payments/:request_id/chat')
  async shopRead(@Param('request_id') id: string, @Query() query: unknown, @Req() request: AdminRequest) {
    return { data: await this.chat.read(this.#transport.read(request), 'SHOP_PAYMENT', parseRoomId(id), parsePageQuery(query)) };
  }

  @Post('shop-payments/:request_id/chat')
  @HttpCode(201)
  async shopSend(@Param('request_id') id: string, @Body() body: unknown, @Req() request: AdminRequest, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    const token = await this.#transport.write(request);
    return { data: await this.chat.send(token, csrf, 'SHOP_PAYMENT', parseRoomId(id), parseSendBody(body), key) };
  }
}
