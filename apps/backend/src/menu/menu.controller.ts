import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Headers, HttpCode, Param, Post, Put, Req, Res, StreamableFile, UseGuards } from '@nestjs/common';
import { actorOf, AuthenticatedRequest } from '../auth/auth-principal';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { AppError } from '../common/app-errors';
import { MenuService } from './menu-service';
import {
  parseImageUploadBody,
  parseItemCreateBody,
  parseItemId,
  parseItemUpdateBody,
  parseItemVersionBody,
} from './menu-validation';

function requestIdOf(request: { requestId?: string }): string {
  return request.requestId ?? randomUUID();
}

type Key = string | string[] | undefined;

/**
 * HTTP adapter of the owner's menu (M02-MON): parses strictly, calls one service, wraps the result in { data }. The user and the
 * session come only from the authenticated principal. No route here takes a shop id: the shop is the caller's own.
 */
@Controller('shop/me/menu')
@UseGuards(SessionAuthGuard)
export class MenuOwnerController {
  constructor(private readonly menu: MenuService) {}

  @Get()
  async read(@Req() request: AuthenticatedRequest) {
    return { data: await this.menu.readOwnMenu(actorOf(this.#principal(request))) };
  }

  @Post('images')
  async uploadImage(@Body() body: unknown, @Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: { status(code: number): unknown }) {
    const outcome = await this.menu.uploadImage(actorOf(this.#principal(request)), parseImageUploadBody(body));
    response.status(outcome.status);
    return { data: outcome.payload };
  }

  @Post('items')
  async createItem(
    @Body() body: unknown,
    @Headers('idempotency-key') key: Key,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: { status(code: number): unknown },
  ) {
    const input = parseItemCreateBody(body);
    const outcome = await this.menu.createItem(actorOf(this.#principal(request)), input, key, requestIdOf(request));
    response.status(outcome.status);
    return { data: outcome.payload };
  }

  @Put('items/:itemId')
  async updateItem(@Param('itemId') itemId: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    const id = parseItemId(itemId);
    const input = parseItemUpdateBody(body);
    const outcome = await this.menu.updateItem(actorOf(this.#principal(request)), id, input, key, requestIdOf(request));
    return { data: outcome.payload };
  }

  @Post('items/:itemId/hide')
  @HttpCode(200)
  async hide(@Param('itemId') itemId: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    const id = parseItemId(itemId);
    const outcome = await this.menu.hideItem(actorOf(this.#principal(request)), id, parseItemVersionBody(body), key, requestIdOf(request));
    return { data: outcome.payload };
  }

  @Post('items/:itemId/show')
  @HttpCode(200)
  async show(@Param('itemId') itemId: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    const id = parseItemId(itemId);
    const outcome = await this.menu.showItem(actorOf(this.#principal(request)), id, parseItemVersionBody(body), key, requestIdOf(request));
    return { data: outcome.payload };
  }

  @Post('items/:itemId/delete')
  @HttpCode(200)
  async remove(@Param('itemId') itemId: string, @Body() body: unknown, @Headers('idempotency-key') key: Key, @Req() request: AuthenticatedRequest) {
    const id = parseItemId(itemId);
    const outcome = await this.menu.deleteItem(actorOf(this.#principal(request)), id, parseItemVersionBody(body), key, requestIdOf(request));
    return { data: outcome.payload };
  }

  #principal(request: AuthenticatedRequest) {
    if (request.auth === undefined) {
      throw new AppError('SESSION_INVALID');
    }
    return request.auth;
  }
}

/**
 * What a customer (no session) may read: the public view of one shop with its menu, and a dish picture by its unguessable id. Read
 * only, nothing personal in either answer. This is not a search: a shop id has to be known (a link, a later discovery module).
 */
@Controller()
export class MenuPublicController {
  constructor(private readonly menu: MenuService) {}

  @Get('shops/:shopId')
  async shop(@Param('shopId') shopId: string, @Res({ passthrough: true }) response: { setHeader(name: string, value: string): unknown }) {
    response.setHeader('Cache-Control', 'no-store');
    return { data: await this.menu.readPublicShop(shopId) };
  }

  @Get('menu-images/:imageId')
  async image(@Param('imageId') imageId: string, @Res({ passthrough: true }) response: { setHeader(name: string, value: string): unknown }) {
    const image = await this.menu.readImage(imageId);
    response.setHeader('Content-Type', image.contentType);
    // The id names immutable bytes, so the answer never changes.
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    return new StreamableFile(image.data);
  }
}
