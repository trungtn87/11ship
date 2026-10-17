import { randomUUID } from 'node:crypto';
import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ADMIN_AUTH_CONFIG } from '../admin-auth/admin-auth-config.provider';
import { ADMIN_SESSION_COOKIE } from '../admin-auth/admin-auth-constants';
import { isJsonContentType } from '../admin-auth/admin-auth-validation';
import { readCookieToken } from '../admin-auth/admin-cookies';
import { AdminLimiter } from '../admin-auth/admin-limiter';
import { resolveClientIp } from '../admin-auth/client-ip';
import { AppError } from '../common/app-errors';
import { AdminAuthConfig } from '../config/admin-auth-config';
import { WALLET_PARAMETER_MAX_VND } from '../driver/shipper-wallet-parameters';
import { AdminShipperService, CommandInput, ShipperCommand } from './admin-shipper-service';
import { parseClassifyBody, parseDriverId, parseNoQuery, parseReasonBody, parseShipperListQuery, parseVersionBody, parseWalletParametersBody } from './admin-shipper-validation';
import { ShipperWalletParametersService } from './shipper-wallet-parameters-service';

interface AdminRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly socket: { readonly remoteAddress?: string };
  readonly requestId?: string;
}

interface StatusResponse {
  status(code: number): unknown;
}

type Csrf = string | string[] | undefined;

/** Which commands need a reason and which one carries the classification; everything else names only the version. */
const PARSERS: Readonly<Record<ShipperCommand, (body: unknown) => CommandInput>> = {
  approve: parseVersionBody,
  reject: parseReasonBody,
  lock: parseReasonBody,
  unlock: parseVersionBody,
  classify: parseClassifyBody,
  bank_verify: parseVersionBody,
  bank_reject: parseReasonBody,
  closure_reject: parseReasonBody,
  closure_finalize: parseVersionBody,
};

/** Shared transport of the administration routes: exact Origin, quota, JSON, then the cookie/CSRF precheck inside the service. */
class AdminTransport {
  readonly #origins: ReadonlySet<string>;
  readonly #trustedProxies: ReadonlySet<string>;

  constructor(
    private readonly limiter: AdminLimiter,
    config: AdminAuthConfig,
  ) {
    this.#origins = new Set(config.allowedOrigins);
    this.#trustedProxies = new Set(config.trustedProxyIps);
  }

  /** A GET: an Origin that is present must be an allowed one; returns the SESSION cookie token. */
  read(request: AdminRequest): string | undefined {
    const origin = request.headers.origin;
    if (origin !== undefined && (typeof origin !== 'string' || !this.#origins.has(origin))) {
      throw new AppError('ADMIN_CSRF_INVALID');
    }
    return readCookieToken(request.headers.cookie, ADMIN_SESSION_COOKIE);
  }

  /** A POST: Origin required, JSON only, then the ingress quota (its own short transaction, committed). */
  async write(request: AdminRequest): Promise<string | undefined> {
    const origin = request.headers.origin;
    if (typeof origin !== 'string' || !this.#origins.has(origin)) {
      throw new AppError('ADMIN_CSRF_INVALID');
    }
    if (!isJsonContentType(request.headers['content-type'])) {
      throw new BadRequestException();
    }
    await this.limiter.reserveTotpRequest(resolveClientIp(request.socket.remoteAddress, request.headers['x-forwarded-for'], this.#trustedProxies));
    return readCookieToken(request.headers.cookie, ADMIN_SESSION_COOKIE);
  }
}

/**
 * /v1/admin/shippers (M03, Administration web): GET list, GET detail and one POST per command. The SESSION cookie is the only
 * credential; the actor comes from the session and the target from the path, never from a body. Same order as every administration
 * write: transport, quota, strict parser, cookie/CSRF precheck, then the service authorizes again under locks. There is no delete
 * and no "add Shipper": Shippers register through M01. No-store comes from the module.
 */
@Controller('admin/shippers')
export class AdminShipperController {
  readonly #transport: AdminTransport;

  constructor(
    private readonly shippers: AdminShipperService,
    limiter: AdminLimiter,
    @Inject(ADMIN_AUTH_CONFIG) config: AdminAuthConfig,
  ) {
    this.#transport = new AdminTransport(limiter, config);
  }

  @Get()
  async list(@Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    return { data: await this.shippers.list(token, parseShipperListQuery(query)) };
  }

  @Get(':driver_id')
  async detail(@Param('driver_id') driverId: string, @Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    parseNoQuery(query);
    return { data: await this.shippers.detail(token, parseDriverId(driverId)) };
  }

  @Post(':driver_id/approve')
  @HttpCode(200)
  approve(@Param('driver_id') id: string, @Body() body: unknown, @Req() req: AdminRequest, @Res({ passthrough: true }) res: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    return this.#run('approve', id, body, req, res, csrf, key);
  }

  @Post(':driver_id/reject')
  @HttpCode(200)
  reject(@Param('driver_id') id: string, @Body() body: unknown, @Req() req: AdminRequest, @Res({ passthrough: true }) res: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    return this.#run('reject', id, body, req, res, csrf, key);
  }

  @Post(':driver_id/lock')
  @HttpCode(200)
  lock(@Param('driver_id') id: string, @Body() body: unknown, @Req() req: AdminRequest, @Res({ passthrough: true }) res: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    return this.#run('lock', id, body, req, res, csrf, key);
  }

  @Post(':driver_id/unlock')
  @HttpCode(200)
  unlock(@Param('driver_id') id: string, @Body() body: unknown, @Req() req: AdminRequest, @Res({ passthrough: true }) res: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    return this.#run('unlock', id, body, req, res, csrf, key);
  }

  @Post(':driver_id/classification')
  @HttpCode(200)
  classify(@Param('driver_id') id: string, @Body() body: unknown, @Req() req: AdminRequest, @Res({ passthrough: true }) res: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    return this.#run('classify', id, body, req, res, csrf, key);
  }

  @Post(':driver_id/bank/verify')
  @HttpCode(200)
  bankVerify(@Param('driver_id') id: string, @Body() body: unknown, @Req() req: AdminRequest, @Res({ passthrough: true }) res: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    return this.#run('bank_verify', id, body, req, res, csrf, key);
  }

  @Post(':driver_id/bank/reject')
  @HttpCode(200)
  bankReject(@Param('driver_id') id: string, @Body() body: unknown, @Req() req: AdminRequest, @Res({ passthrough: true }) res: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    return this.#run('bank_reject', id, body, req, res, csrf, key);
  }

  @Post(':driver_id/closure/reject')
  @HttpCode(200)
  closureReject(@Param('driver_id') id: string, @Body() body: unknown, @Req() req: AdminRequest, @Res({ passthrough: true }) res: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    return this.#run('closure_reject', id, body, req, res, csrf, key);
  }

  @Post(':driver_id/closure/finalize')
  @HttpCode(200)
  closureFinalize(@Param('driver_id') id: string, @Body() body: unknown, @Req() req: AdminRequest, @Res({ passthrough: true }) res: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    return this.#run('closure_finalize', id, body, req, res, csrf, key);
  }

  async #run(command: ShipperCommand, driverId: string, body: unknown, request: AdminRequest, response: StatusResponse, csrf: Csrf, key: Csrf) {
    const token = await this.#transport.write(request);
    const id = parseDriverId(driverId);
    const input = PARSERS[command](body);
    const outcome = await this.shippers.command(command, token, csrf, id, input, key, { requestId: request.requestId ?? randomUUID() });
    response.status(outcome.status);
    return { data: outcome.payload };
  }
}

/** /v1/admin/system-settings/shipper-wallet (SYSTEM changes, any ADMIN reads): the minimum top-up and withdrawal per request. */
@Controller('admin/system-settings/shipper-wallet')
export class ShipperWalletParametersController {
  readonly #transport: AdminTransport;

  constructor(
    private readonly parameters: ShipperWalletParametersService,
    limiter: AdminLimiter,
    @Inject(ADMIN_AUTH_CONFIG) config: AdminAuthConfig,
  ) {
    this.#transport = new AdminTransport(limiter, config);
  }

  @Get()
  async read(@Query() query: unknown, @Req() request: AdminRequest) {
    const token = this.#transport.read(request);
    parseNoQuery(query);
    return { data: await this.parameters.read(token) };
  }

  @Post()
  @HttpCode(200)
  async update(@Body() body: unknown, @Req() request: AdminRequest, @Res({ passthrough: true }) response: StatusResponse, @Headers('x-csrf-token') csrf: Csrf, @Headers('idempotency-key') key: Csrf) {
    const token = await this.#transport.write(request);
    const input = parseWalletParametersBody(body, WALLET_PARAMETER_MAX_VND);
    const outcome = await this.parameters.update(token, csrf, input, key, { requestId: request.requestId ?? randomUUID() });
    response.status(outcome.status);
    return { data: outcome.payload };
  }
}
