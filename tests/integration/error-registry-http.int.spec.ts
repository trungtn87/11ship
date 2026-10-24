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

  it('covers exactly the six idempotency codes, the unknown transaction outcome, the 15 Auth Core codes, the 4 Shop onboarding codes, the 2 Driver onboarding codes and the 4 Shop management codes, the 6 administration authentication codes, the 9 ADMIN invitation codes and the 3 ADMIN activation codes, the 1 staging-fixture registration code, the 3 client registration codes the 1 account read code and the 3 USER lock/unlock codes and the 4 native device codes', () => {
    // 7 foundation codes (M00-C1) + 15 Auth Core codes (M01-A1) + 4 Shop onboarding codes (M01-A2S) + 2 Driver onboarding codes (M01-A2D)
    // + 4 Shop management codes (M02-A) + 6 administration authentication codes (M01-D-LOGIN) + 9 ADMIN invitation codes (M01-D-ADMIN-1B) + 3 ADMIN activation codes (M01-D-ADMIN-1C):
    // + 1 AUTH_REGISTRATION_UNAVAILABLE (M00-D2, issue #49)
    // + 3 client registration codes (M01.03: CONSENT_VERSION_UNSUPPORTED, AUTH_RESULT_NOT_REPLAYABLE, DEVICE_PROOF_REQUIRED)
    // + 1 account read code (M01 account read: USER_NOT_AVAILABLE)
    // + 3 USER lock/unlock codes (M01 account lock, D15: USER_ACCOUNT_VERSION_CONFLICT, USER_ACCOUNT_ALREADY_IN_STATE, USER_ACCOUNT_IMPACT_REVIEW_REQUIRED):
    // + 4 native device codes (M01-ANDROID: DEVICE_PROOF_INVALID, DEVICE_PROOF_EXPIRED, DEVICE_PROOF_UNSUPPORTED, DEVICE_RATE_LIMITED)
    // + 3 SMS gateway codes (issue #102: GATEWAY_UNAUTHORIZED, GATEWAY_JOB_NOT_FOUND, GATEWAY_ACK_CONFLICT)
    // + 1 own-password change code (M01 client apps, reused from #114: CURRENT_PASSWORD_INVALID)
    // + 6 menu/discovery codes (M02: MENU_ITEM_NOT_FOUND, MENU_CATEGORY_NOT_AVAILABLE, INVALID_MENU_IMAGE, MENU_LIMIT_REACHED, MENU_IMAGE_NOT_FOUND, SHOP_UNAVAILABLE)
    // + 6 account lifecycle codes (M01 final package: SYSTEM_SETTING_VERSION_CONFLICT, PHONE_VERIFICATION_NOT_REQUIRED, PHONE_VERIFICATION_REQUIRED,
    //   PASSWORD_RESET_DISABLED, ACCOUNT_RECOVERY_AVAILABLE, USER_ACCOUNT_HAS_ACTIVE_WORK)
    // + 4 dish-group management codes (M02 Admin: MENU_CATEGORY_NOT_FOUND, MENU_CATEGORY_NAME_TAKEN, MENU_CATEGORY_NAME_TAKEN_INACTIVE, MENU_CATEGORY_VERSION_CONFLICT)
    // + 12 Shipper management codes (M03: DRIVER_NOT_FOUND, DRIVER_STATE_CONFLICT, DRIVER_PROFILE_LOCKED, DRIVER_PROFILE_INCOMPLETE, BANK_HOLDER_MISMATCH,
    //   DRIVER_BANK_NOT_VERIFIED, DRIVER_NOT_ACTIVE, DRIVER_WALLET_NOT_READY, DRIVER_HAS_ACTIVE_WORK, DRIVER_WALLET_NOT_SETTLED,
    //   DRIVER_SELF_ACTION_FORBIDDEN, WALLET_PARAMETER_VERSION_CONFLICT)
    // + 1 customer address code (M05: CUSTOMER_ADDRESS_NOT_FOUND)
    // + 4 shipping fee policy codes (M06-A) + 1 eligibility parameters code (M06-B/C)
    // + 4 Shipper top-up request codes (M04-B2.1: TOPUP_AMOUNT_BELOW_MINIMUM, TOPUP_RECEIVING_ACCOUNT_NOT_CONFIGURED, TOPUP_REQUEST_NOT_FOUND, TOPUP_REQUEST_STATE_CONFLICT)
    // + 5 finance access / receiving account codes (M04-B2.2a: FINANCE_ADMIN_NOT_FOUND, FINANCE_GRANT_STATE_CONFLICT, FINANCE_VERSION_CONFLICT, FINANCE_BANK_ACCOUNT_EXISTS, FINANCE_BANK_ACCOUNT_NOT_FOUND)
    // + 4 top-up posting codes (M04-B2.2b: TOPUP_ACCOUNT_NOT_RECEIVING, BANK_TRANSACTION_ALREADY_RECORDED, TOPUP_WALLET_LIMIT_EXCEEDED, FINANCE_BANK_ACCOUNT_STATE_CONFLICT)
    // + 1 notification code (M08: NOTIFICATION_NOT_FOUND)
    // + 13 delivery codes (M07: DELIVERY_*, FEE_*, DESTINATION_NOT_CONFIRMED, ... see app-errors.ts)
    // + 12 order codes (M10: ORDER_*; the earlier ORDER_MODULE_NOT_READY placeholder is gone, so +11 net; see app-errors.ts)
    // + 14 M11 codes (REVIEW_*, COMPLAINT_*, RECONSIDERATION_*, ADJUSTMENT_HISTORY_REVIEW_REQUIRED)
    // + 2 shop logo codes (M02: INVALID_SHOP_LOGO, SHOP_LOGO_TOO_LARGE)
    // + 1 password login quota code (M01: LOGIN_RATE_LIMITED)
    // + 17 operations codes (M13: OPS_*, see app-errors.ts)
    // + 13 M12 codes (3 ADMIN_ACCESS_*, 4 REPORT_EXPORT_*, 5 RESTORE_*, BACKUP_RUN_OPEN)
    // the total is pinned so that an accidental addition or removal is still caught.
    expect(codes).toHaveLength(195);
    expect(codes).toEqual(expect.arrayContaining(['INVALID_SHOP_LOGO', 'SHOP_LOGO_TOO_LARGE', 'LOGIN_RATE_LIMITED']));
    expect(codes.filter((code) => code.startsWith('ADMIN_'))).toHaveLength(22);
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
