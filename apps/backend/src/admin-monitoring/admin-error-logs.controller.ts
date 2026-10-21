import { Controller, Get, Inject, Query, Req } from '@nestjs/common';
import { ADMIN_AUTH_CONFIG } from '../admin-auth/admin-auth-config.provider';
import { ADMIN_SESSION_COOKIE } from '../admin-auth/admin-auth-constants';
import { readCookieToken } from '../admin-auth/admin-cookies';
import { AdminSessionService } from '../admin-auth/admin-session-service';
import { AppError } from '../common/app-errors';
import { AdminAuthConfig } from '../config/admin-auth-config';
import { ErrorLogQuery, JsonLogger } from '../logging/json-logger';
import { APP_LOGGER } from '../logging/logging.module';

interface AdminRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly requestId?: string;
}

function parseQuery(value: unknown): ErrorLogQuery {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError('ADMIN_INPUT_INVALID');
  }
  const source = value as Record<string, unknown>;
  const keys = ['request_id', 'code', 'app', 'status', 'from', 'to', 'page', 'limit'];
  if (!Object.keys(source).every((key) => keys.includes(key))) {
    throw new AppError('ADMIN_INPUT_INVALID');
  }
  const get = (key: string): string | undefined => {
    const item = source[key];
    if (item === undefined) return undefined;
    if (typeof item !== 'string' || item.length > 128) throw new AppError('ADMIN_INPUT_INVALID');
    return item;
  };
  const requestId = get('request_id');
  const code = get('code');
  const app = get('app');
  const statusText = get('status');
  const fromText = get('from');
  const toText = get('to');
  const pageText = get('page');
  const limitText = get('limit');
  if (requestId !== undefined && !/^[a-f0-9]{8}-[a-f0-9-]{27,36}$/i.test(requestId)) throw new AppError('ADMIN_INPUT_INVALID');
  if (code !== undefined && !/^[A-Z0-9_]{1,128}$/.test(code)) throw new AppError('ADMIN_INPUT_INVALID');
  if (app !== undefined && !['SHIP', 'FOOD', 'ADMIN', 'API'].includes(app)) throw new AppError('ADMIN_INPUT_INVALID');
  const numberOf = (s: string | undefined, min: number, max: number, defaultValue: number): number => {
    if (s === undefined) return defaultValue;
    if (!/^[0-9]{1,6}$/.test(s)) throw new AppError('ADMIN_INPUT_INVALID');
    const v = Number(s);
    if (!Number.isSafeInteger(v) || v < min || v > max) throw new AppError('ADMIN_INPUT_INVALID');
    return v;
  };
  const dateOf = (s: string | undefined): number | undefined => {
    if (s === undefined) return undefined;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(s)) throw new AppError('ADMIN_INPUT_INVALID');
    const t = Date.parse(s);
    if (!Number.isFinite(t)) throw new AppError('ADMIN_INPUT_INVALID');
    return t;
  };
  const from = dateOf(fromText);
  const to = dateOf(toText);
  if (from !== undefined && to !== undefined && from > to) throw new AppError('ADMIN_INPUT_INVALID');
  return {
    page: numberOf(pageText, 1, 1000, 1),
    limit: numberOf(limitText, 1, 50, 30),
    ...(requestId === undefined ? {} : { requestId: requestId.toLowerCase() }),
    ...(code === undefined ? {} : { code }),
    ...(app === undefined ? {} : { app }),
    ...(statusText === undefined ? {} : { status: numberOf(statusText, 400, 599, 400) }),
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
  };
}

/** M13 / issue #155. Read-only diagnostic endpoint, never executes journalctl or reads arbitrary paths. */
@Controller('admin/monitoring')
export class AdminErrorLogsController {
  readonly #origins: ReadonlySet<string>;

  constructor(
    private readonly sessions: AdminSessionService,
    @Inject(APP_LOGGER) private readonly logger: JsonLogger,
    @Inject(ADMIN_AUTH_CONFIG) config: AdminAuthConfig,
  ) {
    this.#origins = new Set(config.allowedOrigins);
  }

  @Get('errors')
  async errors(@Req() request: AdminRequest, @Query() query: unknown) {
    const origin = request.headers.origin;
    if (origin !== undefined && (typeof origin !== 'string' || !this.#origins.has(origin))) {
      throw new AppError('ADMIN_CSRF_INVALID');
    }
    // Check live session AND role on the server, on every call. ADMIN is never grantable.
    const token = readCookieToken(request.headers.cookie, ADMIN_SESSION_COOKIE);
    const actor = await this.sessions.me(token);
    if (actor.adminRole !== 'SYSTEM') throw new AppError('ADMIN_FORBIDDEN');
    const parsed = parseQuery(query);
    this.logger.log('info', 'system_error_log_read', { request_id: request.requestId });
    return { data: this.logger.errorEvents(parsed) };
  }
}
