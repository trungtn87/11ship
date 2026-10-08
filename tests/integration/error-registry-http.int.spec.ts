import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { AddressInfo } from 'node:net';
import { configureApp } from '../../apps/backend/src/app.setup';
import {
  APP_ERROR_DEFINITIONS,
  AppErrorCode,
} from '../../apps/backend/src/common/app-errors';
import { JsonLogger } from '../../apps/backend/src/logging/json-logger';
import { LoggingModule } from '../../apps/backend/src/logging/logging.module';
import { ErrorHarnessModule, HARNESS_SECRET } from './support/error-harness';
import { loadIntegrationConfig, UUID_PATTERN } from './support/test-helpers';
import { poolClientSource } from '../../apps/backend/src/transaction/pg-client-source';
import { expectPoolRecovered, faultySource, managerFor, testPool } from './support/transaction-fixtures';

interface Envelope {
  error: { code: string; message: string; request_id: string; details: Record<string, unknown> };
}

// C22-A0 — the typed error registry through a REAL Nest HTTP pipeline (request-id middleware, route
// matching, AllExceptionsFilter), not by calling the filter directly. No database is involved.
describe('C22-A0 — typed errors over real HTTP', () => {
  let app: INestApplication;
  let baseUrl: string;
  const pool = testPool(loadIntegrationConfig().database);
  const logs: string[] = [];
  const requestIds = new Set<string>();

  async function get(path: string): Promise<{ status: number; text: string; body: Envelope; header: string | null }> {
    const response = await fetch(`${baseUrl}/v1/harness/${path}`);
    const text = await response.text();
    const body = JSON.parse(text) as Envelope;
    requestIds.add(body.error.request_id);
    return { status: response.status, text, body, header: response.headers.get('x-request-id') };
  }

  beforeAll(async () => {
    const logger = new JsonLogger((line) => {
      logs.push(line);
    });
    const moduleRef = await Test.createTestingModule({
      imports: [
        LoggingModule.forRoot(logger),
        ErrorHarnessModule.register({
          database: managerFor(poolClientSource(pool)),
          // Injected: the server commits, but the acknowledgement never reaches the client.
          unknownCommit: managerFor(
            faultySource(pool, (text, real) =>
              text === 'COMMIT'
                ? real
                    .query('COMMIT')
                    .then(() =>
                      Promise.reject(
                        Object.assign(new Error(`ack lost ${HARNESS_SECRET}`), { code: 'ECONNRESET' }),
                      ),
                    )
                : undefined,
            ),
          ),
          shortDeadline: managerFor(poolClientSource(pool), { timeoutMs: 100 }),
        }),
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  const codes = Object.keys(APP_ERROR_DEFINITIONS) as AppErrorCode[];

  it.each(codes)('keeps %s (status, code and fixed message) and a request_id of the current request', async (code) => {
    const { status, body, header } = await get(`app-error/${code}`);

    expect(status).toBe(APP_ERROR_DEFINITIONS[code].status);
    expect(body).toEqual({
      error: {
        code,
        message: APP_ERROR_DEFINITIONS[code].message,
        request_id: body.error.request_id,
        details: {},
      },
    });
    expect(body.error.request_id).toMatch(UUID_PATTERN);
    expect(body.error.request_id).toBe(header);
  });

  it('covers exactly the six idempotency codes, the unknown transaction outcome and the 15 Auth Core codes and the 4 Shop onboarding codes', () => {
    // 7 foundation codes (M00-C1) + 15 Auth Core codes (M01-A1) + 4 Shop onboarding codes (M01-A2S): the total is pinned so that an accidental
    // addition or removal is still caught.
    expect(codes).toHaveLength(26);
    expect(codes.filter((code) => code.startsWith('IDEMPOTENCY_') || code === 'INVALID_IDEMPOTENCY_KEY')).toHaveLength(6);
    expect(codes).toContain('TRANSACTION_OUTCOME_UNKNOWN');
  });

  it('issues a new request_id for every request', async () => {
    const before = requestIds.size;
    await get('app-error/IDEMPOTENCY_BUSY');
    await get('app-error/IDEMPOTENCY_BUSY');
    await get('app-error/IDEMPOTENCY_BUSY');
    expect(requestIds.size).toBe(before + 3);
  });

  it('does not let an arbitrary exception choose its public code, message or details', async () => {
    const withStatus = await get('impostor/with-status');
    expect(withStatus.status).toBe(409);
    expect(withStatus.body.error.code).toBe('CONFLICT');
    expect(withStatus.body.error.message).toBe('Conflict');
    expect(withStatus.body.error.details).toEqual({});

    const codeOnly = await get('impostor/code-only');
    expect(codeOnly.status).toBe(500);
    expect(codeOnly.body.error.code).toBe('INTERNAL_ERROR');

    const http = await get('http-exception');
    expect(http.status).toBe(409);
    expect(http.body.error.code).toBe('CONFLICT');

    for (const result of [withStatus, codeOnly, http]) {
      expect(result.text).not.toContain(HARNESS_SECRET);
    }
  });

  it('never leaks SQL, driver, crypto, JSON or string-thrown values', async () => {
    for (const path of ['sql-error', 'crypto-error', 'json-error', 'thrown-string']) {
      const { status, body, text } = await get(path);
      expect(status).toBe(500);
      expect(body.error).toEqual({
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        request_id: body.error.request_id,
        details: {},
      });
      expect(text).not.toContain(HARNESS_SECRET);
      expect(text).not.toContain('23505');
      expect(text).not.toContain('users_phone_key');
      expect(text).not.toContain('authentication_failed');
      expect(text).not.toContain('secret_key');
    }
  });

  it('maps transaction failures to the generic 503/500 envelopes without the SQLSTATE or reason', async () => {
    const unavailable = await get('transaction-error/DEADLINE_EXCEEDED');
    expect(unavailable.status).toBe(503);
    expect(unavailable.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(unavailable.body.error.message).toBe('Service unavailable');
    expect(unavailable.text).not.toContain('40P01');
    expect(unavailable.text).not.toContain('DEADLINE');

    const programming = await get('transaction-error/CONTEXT_CLOSED');
    expect(programming.status).toBe(500);
    expect(programming.body.error.code).toBe('INTERNAL_ERROR');
  });

  it('hides what a REAL TransactionManager and PostgreSQL raise: database error, unknown COMMIT, deadline', async () => {
    const dbError = await get('tx/db-error');
    expect(dbError.status).toBe(500);
    expect(dbError.body.error.code).toBe('INTERNAL_ERROR');
    expect(dbError.body.error.message).toBe('Internal server error');

    const unknown = await get('tx/unknown-commit');
    expect(unknown.status).toBe(503);
    expect(unknown.body.error.code).toBe('TRANSACTION_OUTCOME_UNKNOWN');
    expect(unknown.body.error.message).toBe(APP_ERROR_DEFINITIONS.TRANSACTION_OUTCOME_UNKNOWN.message);

    const deadline = await get('tx/deadline');
    expect(deadline.status).toBe(503);
    expect(deadline.body.error.code).toBe('SERVICE_UNAVAILABLE');

    for (const result of [dbError, unknown, deadline]) {
      expect(result.text).not.toContain(HARNESS_SECRET);
      expect(result.text).not.toContain('RAISE');
      expect(result.text).not.toContain('P0001');
      expect(result.body.error.request_id).toBe(result.header);
    }
    // Each failed transaction gave its connection back (or destroyed it): nothing leaked.
    await expectPoolRecovered(pool);
  });

  it('writes only whitelisted, secret-free log lines', () => {
    const joined = logs.join('\n');
    expect(joined).not.toContain(HARNESS_SECRET);
    expect(joined).not.toContain('users_phone_key');
    const failures = logs
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => entry.event === 'request_failed');
    expect(failures.length).toBeGreaterThan(0);
    const allowedCodes = new Set<string>([
      ...codes,
      'CONFLICT',
      'INTERNAL_ERROR',
      'SERVICE_UNAVAILABLE',
    ]);
    for (const entry of failures) {
      expect(allowedCodes.has(String(entry.code))).toBe(true);
    }
  });
});
