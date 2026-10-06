import { randomUUID } from 'node:crypto';
import { JsonLogger } from '../logging/json-logger';

// Minimal structural types so this code does not depend on Express typings.
export interface RequestWithContext {
  requestId?: string;
  method?: string;
}

export interface ResponseLike {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  on(event: 'finish', listener: () => void): unknown;
}

const KNOWN_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

// Clients can send arbitrary method tokens; only well-known ones are ever logged.
export function safeMethod(method: unknown): string {
  return typeof method === 'string' && KNOWN_METHODS.has(method) ? method : 'OTHER';
}

/**
 * Assigns a server-generated UUID request id to every request and returns it as X-Request-ID.
 * An X-Request-ID sent by the client is ignored: arbitrary client strings are never reflected
 * into responses or logs. The access log carries whitelisted metadata only (no path or query).
 */
export function createRequestContextMiddleware(logger: JsonLogger) {
  return (req: RequestWithContext, res: ResponseLike, next: () => void): void => {
    const requestId = randomUUID();
    const startedAt = process.hrtime.bigint();

    req.requestId = requestId;
    res.setHeader('X-Request-ID', requestId);

    res.on('finish', () => {
      const durationMs = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
      logger.log('info', 'request_completed', {
        request_id: requestId,
        method: safeMethod(req.method),
        status: res.statusCode,
        duration_ms: durationMs,
      });
    });

    next();
  };
}
