import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { normalizeVietnamPhone } from '../auth/phone';
import { TestSmsInbox } from './test-sms-inbox';
import { TokenBucket } from './token-bucket';
import {
  TEST_SMS_BUCKET_CAPACITY,
  TEST_SMS_BUCKET_REFILL_PER_SECOND,
  TEST_SMS_LIST_LIMIT_DEFAULT,
  TEST_SMS_LIST_LIMIT_MAX,
  TEST_SMS_LOOPBACK_HOST,
  TestSmsMessage,
  TestSmsPurpose,
  isTestSmsPurpose,
} from './test-sms-types';

// The private listener of the test SMS inbox (M01.22). It is NOT the product API: its own server, bound to
// 127.0.0.1 on an OS-assigned random port, with its own random read token. It exposes exactly two read-only routes
// and has no CORS, no redirects, no mutation, no body.
//
//   GET /messages               list metadata, newest first (never the code, never the unmasked phone)
//   GET /messages/:message_id   one message including the code, for the operator tool to show on purpose
//
// Order of checks (so nothing about a resource is revealed before the caller proved the token):
//   1. a request carrying an Origin header (a browser, including "null") -> 403, whatever it sends otherwise;
//   2. missing or wrong token -> 401, counted against a bounded unauthenticated budget (then 429);
//   3. the read quota of the token (capacity 10, +1/second = 60 per minute with a burst of 10) -> 429 + Retry-After;
//   4. method (only GET), body (none), size, route and query -> 405 / 400 / 404.
// Every response is no-store and closes the connection. Nothing is logged: no token, code, phone or Authorization.

export interface TestSmsListenerOptions {
  readonly inbox: TestSmsInbox;
  /** 256-bit random read token, base64url (43 characters). */
  readonly token: string;
  readonly now?: () => number;
}

export interface RunningTestSmsListener {
  readonly host: string;
  readonly port: number;
  stop(): Promise<void>;
}

const MAX_URL_LENGTH = 2048;
const MAX_HEADER_BYTES = 8192;
const TOKEN_HEADER = /^Bearer ([A-Za-z0-9_-]{43})$/;
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LIMIT_SHAPE = /^[1-9][0-9]?$/;
const LIST_KEYS: ReadonlySet<string> = new Set(['purpose', 'phone', 'limit']);

interface FixedError {
  readonly status: number;
  readonly code: string;
  readonly message: string;
}

const ERRORS = {
  badRequest: { status: 400, code: 'BAD_REQUEST', message: 'Bad request' },
  unauthorized: { status: 401, code: 'UNAUTHORIZED', message: 'Unauthorized' },
  forbidden: { status: 403, code: 'FORBIDDEN', message: 'Forbidden' },
  notFound: { status: 404, code: 'NOT_FOUND', message: 'Not found' },
  methodNotAllowed: { status: 405, code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' },
  tooManyRequests: { status: 429, code: 'TOO_MANY_REQUESTS', message: 'Too many requests' },
  internal: { status: 500, code: 'INTERNAL_ERROR', message: 'Internal error' },
} as const satisfies Record<string, FixedError>;

function digestOf(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/** "+84901234567" -> "*********567": only the last three characters stay visible. */
export function maskPhone(phoneNormalized: string): string {
  const visible = phoneNormalized.slice(-3);
  return `${'*'.repeat(Math.max(0, phoneNormalized.length - 3))}${visible}`;
}

function send(
  res: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Readonly<Record<string, string>> = {},
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(Buffer.byteLength(payload)),
    'Cache-Control': 'no-store, no-cache',
    Pragma: 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    Connection: 'close',
    ...extraHeaders,
  });
  res.end(payload);
}

function sendError(res: ServerResponse, error: FixedError, extraHeaders: Readonly<Record<string, string>> = {}): void {
  send(res, error.status, { error: { code: error.code, message: error.message, details: {} } }, extraHeaders);
}

function sendRateLimited(res: ServerResponse, retryAfterSeconds: number): void {
  sendError(res, ERRORS.tooManyRequests, { 'Retry-After': String(retryAfterSeconds) });
}

interface ListQuery {
  readonly purpose?: TestSmsPurpose;
  readonly phoneNormalized?: string;
  readonly limit: number;
}

/** Strict parser: known keys only, no duplicates, no empty pairs, exact value grammars. Undefined = 400. */
function parseListQuery(rawQuery: string): ListQuery | undefined {
  let purpose: TestSmsPurpose | undefined;
  let phoneNormalized: string | undefined;
  let limit = TEST_SMS_LIST_LIMIT_DEFAULT;
  if (rawQuery === '') {
    return { limit };
  }
  const seen = new Set<string>();
  for (const pair of rawQuery.split('&')) {
    const separator = pair.indexOf('=');
    if (separator <= 0) {
      return undefined;
    }
    const key = pair.slice(0, separator);
    if (!LIST_KEYS.has(key) || seen.has(key)) {
      return undefined;
    }
    seen.add(key);
    let value: string;
    try {
      value = decodeURIComponent(pair.slice(separator + 1));
    } catch {
      return undefined;
    }
    if (key === 'purpose') {
      if (!isTestSmsPurpose(value)) {
        return undefined;
      }
      purpose = value;
    } else if (key === 'phone') {
      const normalized = normalizeVietnamPhone(value);
      if (normalized === undefined) {
        return undefined;
      }
      phoneNormalized = normalized;
    } else {
      if (!LIMIT_SHAPE.test(value)) {
        return undefined;
      }
      const parsed = Number(value);
      if (parsed < 1 || parsed > TEST_SMS_LIST_LIMIT_MAX) {
        return undefined;
      }
      limit = parsed;
    }
  }
  return {
    limit,
    ...(purpose === undefined ? {} : { purpose }),
    ...(phoneNormalized === undefined ? {} : { phoneNormalized }),
  };
}

function listItem(message: TestSmsMessage): Record<string, string> {
  return {
    message_id: message.messageId,
    purpose: message.purpose,
    phone_masked: maskPhone(message.phoneNormalized),
    received_at: message.receivedAt,
    channel: message.channel,
  };
}

function detail(message: TestSmsMessage): Record<string, string> {
  return {
    message_id: message.messageId,
    purpose: message.purpose,
    phone_normalized: message.phoneNormalized,
    otp: message.otp,
    received_at: message.receivedAt,
    channel: message.channel,
  };
}

export function createTestSmsRequestHandler(
  options: TestSmsListenerOptions,
): (req: IncomingMessage, res: ServerResponse) => void {
  const now = options.now ?? Date.now;
  const tokenDigest = digestOf(options.token);
  const readQuota = new TokenBucket(TEST_SMS_BUCKET_CAPACITY, TEST_SMS_BUCKET_REFILL_PER_SECOND, now);
  // Requests without a valid token never reach the quota above; they spend this separate, equally small budget so
  // an unauthenticated flood is answered with 429 instead of unlimited work.
  const unauthenticatedBudget = new TokenBucket(TEST_SMS_BUCKET_CAPACITY, TEST_SMS_BUCKET_REFILL_PER_SECOND, now);

  const tokenMatches = (header: string | undefined): boolean => {
    if (header === undefined) {
      return false;
    }
    const match = TOKEN_HEADER.exec(header);
    if (match === null) {
      return false;
    }
    return timingSafeEqual(digestOf(match[1] as string), tokenDigest);
  };

  const route = (req: IncomingMessage, res: ServerResponse): void => {
    const url = req.url ?? '';
    if (url.length > MAX_URL_LENGTH || !url.startsWith('/')) {
      sendError(res, ERRORS.badRequest);
      return;
    }
    const contentLength = req.headers['content-length'];
    if (
      req.headers['transfer-encoding'] !== undefined ||
      (contentLength !== undefined && contentLength !== '0')
    ) {
      sendError(res, ERRORS.badRequest);
      return;
    }
    const queryStart = url.indexOf('?');
    const path = queryStart === -1 ? url : url.slice(0, queryStart);
    const rawQuery = queryStart === -1 ? undefined : url.slice(queryStart + 1);

    if (path === '/messages') {
      const query = parseListQuery(rawQuery ?? '');
      if (query === undefined) {
        sendError(res, ERRORS.badRequest);
        return;
      }
      const items = options.inbox.list({
        limit: query.limit,
        ...(query.purpose === undefined ? {} : { purpose: query.purpose }),
        ...(query.phoneNormalized === undefined ? {} : { phoneNormalized: query.phoneNormalized }),
      });
      send(res, 200, { data: { items: items.map(listItem) } });
      return;
    }
    if (path.startsWith('/messages/')) {
      const id = path.slice('/messages/'.length);
      if (rawQuery !== undefined || !CANONICAL_UUID.test(id)) {
        sendError(res, ERRORS.badRequest);
        return;
      }
      const message = options.inbox.get(id);
      if (message === undefined) {
        sendError(res, ERRORS.notFound);
        return;
      }
      send(res, 200, { data: detail(message) });
      return;
    }
    sendError(res, ERRORS.notFound);
  };

  return (req, res) => {
    try {
      // 1. A browser request (any Origin, including "null") is refused whatever the token is.
      const hasOrigin = req.headers.origin !== undefined;
      if (hasOrigin || !tokenMatches(req.headers.authorization)) {
        const budget = unauthenticatedBudget.take();
        if (!budget.ok) {
          sendRateLimited(res, budget.retryAfterSeconds);
          return;
        }
        sendError(res, hasOrigin ? ERRORS.forbidden : ERRORS.unauthorized);
        return;
      }
      // 3. The read quota of the valid token.
      const quota = readQuota.take();
      if (!quota.ok) {
        sendRateLimited(res, quota.retryAfterSeconds);
        return;
      }
      // 4. Only GET.
      if (req.method !== 'GET') {
        sendError(res, ERRORS.methodNotAllowed, { Allow: 'GET' });
        return;
      }
      route(req, res);
    } catch {
      if (!res.headersSent) {
        sendError(res, ERRORS.internal);
      } else {
        res.destroy();
      }
    }
  };
}

/** Starts the listener on 127.0.0.1 with an OS-assigned port. Rejects (and closes) if it did not bind to loopback. */
export async function startTestSmsListener(options: TestSmsListenerOptions): Promise<RunningTestSmsListener> {
  const server: Server = createServer(
    {
      maxHeaderSize: MAX_HEADER_BYTES,
      headersTimeout: 5000,
      requestTimeout: 5000,
      keepAliveTimeout: 1000,
    },
    createTestSmsRequestHandler(options),
  );
  server.maxConnections = 16;
  server.maxRequestsPerSocket = 1;
  server.on('clientError', (_error, socket) => {
    if (socket.writable) {
      socket.end('HTTP/1.1 400 Bad Request\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    } else {
      socket.destroy();
    }
  });

  const closeServer = (): Promise<void> =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: TEST_SMS_LOOPBACK_HOST, port: 0, exclusive: true }, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string' || (address as AddressInfo).address !== TEST_SMS_LOOPBACK_HOST) {
    await closeServer();
    throw new Error('the test SMS listener did not bind to loopback');
  }
  // After startup an unexpected socket error must not crash the backend.
  server.on('error', () => undefined);
  return { host: TEST_SMS_LOOPBACK_HOST, port: (address as AddressInfo).port, stop: closeServer };
}
