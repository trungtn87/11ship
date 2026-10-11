import { request as httpRequest } from 'node:http';
import { TEST_SMS_LOOPBACK_HOST, TestSmsPurpose, isTestSmsPurpose } from './test-sms-types';

// HTTP client of the operator tool (M01.22). READ-ONLY by construction: it can only issue GET to the two routes of the
// private listener on 127.0.0.1. It follows no redirect, caps the time and the size of a response, validates the shape
// of every answer and never puts the token or a code anywhere except the Authorization header / the caller's screen.

export type ToolClientErrorKind =
  | 'UNREACHABLE'
  | 'TIMEOUT'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'BAD_RESPONSE';

export class ToolClientError extends Error {
  readonly kind: ToolClientErrorKind;
  readonly retryAfterSeconds?: number;

  constructor(kind: ToolClientErrorKind, retryAfterSeconds?: number) {
    super(`test inbox request failed (${kind})`);
    this.name = 'ToolClientError';
    this.kind = kind;
    if (retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = retryAfterSeconds;
    }
  }
}

export interface MessageSummary {
  readonly messageId: string;
  readonly purpose: TestSmsPurpose;
  readonly phoneMasked: string;
  readonly receivedAt: string;
}

export interface MessageDetail {
  readonly messageId: string;
  readonly purpose: TestSmsPurpose;
  readonly phoneNormalized: string;
  readonly otp: string;
  readonly receivedAt: string;
}

export interface ListFilter {
  readonly purpose?: TestSmsPurpose;
  readonly phone?: string;
  readonly limit?: number;
}

export interface ToolClient {
  list(filter?: ListFilter): Promise<MessageSummary[]>;
  get(messageId: string): Promise<MessageDetail>;
}

export interface ToolClientOptions {
  readonly host: string;
  readonly port: number;
  readonly token: string;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
}

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface RawReply {
  readonly status: number;
  readonly retryAfter: string | undefined;
  readonly body: string;
}

function get(options: ToolClientOptions, pathAndQuery: string): Promise<RawReply> {
  const timeoutMs = options.timeoutMs ?? 3000;
  const maxBytes = options.maxBytes ?? 65_536;
  return new Promise<RawReply>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void): void => {
      if (!settled) {
        settled = true;
        action();
      }
    };
    const req = httpRequest(
      {
        host: options.host,
        port: options.port,
        path: pathAndQuery,
        method: 'GET',
        agent: false,
        headers: { Authorization: `Bearer ${options.token}`, Accept: 'application/json', Connection: 'close' },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            res.destroy();
            finish(() => reject(new ToolClientError('BAD_RESPONSE')));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () =>
          finish(() =>
            resolve({
              status: res.statusCode ?? 0,
              retryAfter: typeof res.headers['retry-after'] === 'string' ? res.headers['retry-after'] : undefined,
              body: Buffer.concat(chunks).toString('utf8'),
            }),
          ),
        );
        res.on('error', () => finish(() => reject(new ToolClientError('UNREACHABLE'))));
      },
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      finish(() => reject(new ToolClientError('TIMEOUT')));
    });
    req.on('error', () => finish(() => reject(new ToolClientError('UNREACHABLE'))));
    req.end();
  });
}

function objectOf(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ToolClientError('BAD_RESPONSE');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, pattern?: RegExp): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64 || (pattern !== undefined && !pattern.test(value))) {
    throw new ToolClientError('BAD_RESPONSE');
  }
  return value;
}

function purposeOf(value: unknown): TestSmsPurpose {
  if (typeof value !== 'string' || !isTestSmsPurpose(value)) {
    throw new ToolClientError('BAD_RESPONSE');
  }
  return value;
}

function dataOf(reply: RawReply): unknown {
  if (reply.status === 200) {
    try {
      return objectOf(JSON.parse(reply.body)).data;
    } catch (error) {
      throw error instanceof ToolClientError ? error : new ToolClientError('BAD_RESPONSE');
    }
  }
  if (reply.status === 401) throw new ToolClientError('UNAUTHORIZED');
  if (reply.status === 403) throw new ToolClientError('FORBIDDEN');
  if (reply.status === 404) throw new ToolClientError('NOT_FOUND');
  if (reply.status === 429) {
    const seconds = Number(reply.retryAfter);
    throw new ToolClientError('RATE_LIMITED', Number.isInteger(seconds) && seconds >= 1 && seconds <= 3600 ? seconds : 1);
  }
  throw new ToolClientError('BAD_RESPONSE');
}

export function createToolClient(options: ToolClientOptions): ToolClient {
  if (options.host !== TEST_SMS_LOOPBACK_HOST || !Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new ToolClientError('BAD_RESPONSE');
  }
  return {
    async list(filter: ListFilter = {}): Promise<MessageSummary[]> {
      const query: string[] = [];
      if (filter.purpose !== undefined) query.push(`purpose=${encodeURIComponent(filter.purpose)}`);
      if (filter.phone !== undefined) query.push(`phone=${encodeURIComponent(filter.phone)}`);
      if (filter.limit !== undefined) query.push(`limit=${filter.limit}`);
      const data = objectOf(dataOf(await get(options, `/messages${query.length > 0 ? `?${query.join('&')}` : ''}`)));
      if (!Array.isArray(data.items) || data.items.length > 100) {
        throw new ToolClientError('BAD_RESPONSE');
      }
      return data.items.map((entry: unknown) => {
        const item = objectOf(entry);
        return {
          messageId: text(item.message_id, CANONICAL_UUID),
          purpose: purposeOf(item.purpose),
          phoneMasked: text(item.phone_masked),
          receivedAt: text(item.received_at),
        };
      });
    },
    async get(messageId: string): Promise<MessageDetail> {
      if (!CANONICAL_UUID.test(messageId)) {
        throw new ToolClientError('NOT_FOUND');
      }
      const item = objectOf(dataOf(await get(options, `/messages/${messageId}`)));
      return {
        messageId: text(item.message_id, CANONICAL_UUID),
        purpose: purposeOf(item.purpose),
        phoneNormalized: text(item.phone_normalized),
        otp: text(item.otp, /^[0-9]{6}$/),
        receivedAt: text(item.received_at),
      };
    },
  };
}
