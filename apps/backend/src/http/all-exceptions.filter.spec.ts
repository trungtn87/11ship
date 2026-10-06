import { describe, expect, it } from '@jest/globals';
import {
  ArgumentsHost,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { JsonLogger, LOG_META_WHITELIST } from '../logging/json-logger';
import { AllExceptionsFilter } from './all-exceptions.filter';

const SECRET = 'SECRET_MARKER_FILTER_91c2';
const REQUEST_ID = '11111111-2222-4333-8444-555555555555';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface Reply {
  body: { error: { code: string; message: string; request_id: string; details: object } };
  status: number;
}

function run(exception: unknown, request: { requestId?: string; method?: string } = {
  requestId: REQUEST_ID,
  method: 'GET',
}): { reply: Reply; logs: string[] } {
  const logs: string[] = [];
  const replies: Reply[] = [];
  const adapterHost = {
    httpAdapter: {
      reply: (_response: unknown, body: Reply['body'], status: number) => {
        replies.push({ body, status });
      },
    },
  } as unknown as HttpAdapterHost;
  const host = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}) }),
  } as unknown as ArgumentsHost;
  const logger = new JsonLogger((line) => {
    logs.push(line);
  });

  new AllExceptionsFilter(adapterHost, logger).catch(exception, host);

  const reply = replies[0];
  if (reply === undefined) {
    throw new Error('the filter did not reply');
  }
  return { reply, logs };
}

describe('AllExceptionsFilter', () => {
  it('returns 503 SERVICE_UNAVAILABLE in the documented envelope', () => {
    const { reply } = run(new ServiceUnavailableException());
    expect(reply.status).toBe(503);
    expect(reply.body).toEqual({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service unavailable',
        request_id: REQUEST_ID,
        details: {},
      },
    });
  });

  it('returns 404 NOT_FOUND without echoing the exception message', () => {
    const { reply, logs } = run(new NotFoundException(`Cannot GET /${SECRET}`));
    expect(reply.status).toBe(404);
    expect(reply.body.error.code).toBe('NOT_FOUND');
    expect(reply.body.error.message).toBe('Not found');
    expect(reply.body.error.request_id).toBe(REQUEST_ID);
    expect(JSON.stringify(reply.body)).not.toContain(SECRET);
    expect(logs.join('\n')).not.toContain(SECRET);
  });

  it('maps an unexpected error to 500 INTERNAL_ERROR and never leaks its message', () => {
    const databaseError = Object.assign(
      new Error(`password authentication failed for user "x" at 10.0.0.5 ${SECRET}`),
      { code: '28P01' },
    );
    const { reply, logs } = run(databaseError);
    expect(reply.status).toBe(500);
    expect(reply.body).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        request_id: REQUEST_ID,
        details: {},
      },
    });
    expect(JSON.stringify(reply.body)).not.toContain(SECRET);
    expect(logs.join('\n')).not.toContain(SECRET);
    expect(logs.join('\n')).not.toContain('10.0.0.5');
  });

  it('treats a thrown non-Error value as 500 without leaking it', () => {
    const { reply, logs } = run(`connection string postgres://u:${SECRET}@h/db`);
    expect(reply.status).toBe(500);
    expect(JSON.stringify(reply.body)).not.toContain(SECRET);
    expect(logs.join('\n')).not.toContain(SECRET);
  });

  it('replaces a custom HttpException message with a fixed one', () => {
    const { reply } = run(new BadRequestException(`bad value ${SECRET}`));
    expect(reply.status).toBe(400);
    expect(reply.body.error.code).toBe('BAD_REQUEST');
    expect(JSON.stringify(reply.body)).not.toContain(SECRET);
  });

  it('honours 4xx statuses raised by the HTTP layer but never a 5xx one', () => {
    expect(run({ status: 400, message: SECRET }).reply.status).toBe(400);
    expect(run({ statusCode: 413 }).reply.body.error.code).toBe('CLIENT_ERROR');
    expect(run({ status: 502, message: SECRET }).reply.status).toBe(500);
  });

  it('generates a UUID request id when none was assigned', () => {
    const { reply } = run(new NotFoundException(), { method: 'GET' });
    expect(reply.body.error.request_id).toMatch(UUID);
  });

  it('logs only whitelisted metadata', () => {
    const { logs } = run(new Error(SECRET));
    expect(logs).toHaveLength(1);
    const entry = JSON.parse(logs[0] ?? '{}') as Record<string, unknown>;
    const allowed = new Set<string>(['time', 'level', 'event', ...LOG_META_WHITELIST]);
    for (const key of Object.keys(entry)) {
      expect(allowed.has(key)).toBe(true);
    }
    expect(entry.event).toBe('request_failed');
    expect(entry.level).toBe('error');
    expect(entry.request_id).toBe(REQUEST_ID);
    expect(entry.status).toBe(500);
    expect(entry.code).toBe('INTERNAL_ERROR');
  });
});
