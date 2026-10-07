import { Controller, Get, HttpException, Module, NotFoundException, Param } from '@nestjs/common';
import { AppError, isAppErrorCode } from '../../../apps/backend/src/common/app-errors';
import { CryptoError } from '../../../apps/backend/src/crypto/crypto-error';
import { JsonValidationError } from '../../../apps/backend/src/shared/json/safe-json';
import {
  TransactionError,
  TransactionFailureReason,
} from '../../../apps/backend/src/transaction/transaction-error';

export const HARNESS_SECRET = 'SECRET_MARKER_HARNESS_4b7d';

// Test-only controller: a stand-in for future business endpoints. It deliberately throws every kind
// of error so the REAL Nest pipeline (request-id middleware + AllExceptionsFilter) can be inspected.
@Controller('harness')
export class ErrorHarnessController {
  @Get('app-error/:code')
  appError(@Param('code') code: string): never {
    if (!isAppErrorCode(code)) {
      throw new NotFoundException();
    }
    throw new AppError(code);
  }

  @Get('impostor/with-status')
  impostorWithStatus(): never {
    throw Object.assign(new Error(`message ${HARNESS_SECRET}`), {
      code: 'IDEMPOTENCY_BUSY',
      status: 409,
      details: { leaked: HARNESS_SECRET },
    });
  }

  @Get('impostor/code-only')
  impostorCodeOnly(): never {
    throw Object.assign(new Error(`message ${HARNESS_SECRET}`), {
      code: 'IDEMPOTENCY_KEY_REUSED',
      details: { leaked: HARNESS_SECRET },
    });
  }

  @Get('http-exception')
  httpException(): never {
    throw new HttpException(
      { code: 'IDEMPOTENCY_BUSY', message: HARNESS_SECRET, details: { leaked: HARNESS_SECRET } },
      409,
    );
  }

  @Get('sql-error')
  sqlError(): never {
    throw Object.assign(
      new Error(`duplicate key value violates unique constraint "users_phone_key" ${HARNESS_SECRET}`),
      {
        code: '23505',
        detail: `Key (phone)=(${HARNESS_SECRET}) already exists.`,
        severity: 'ERROR',
        query: `INSERT INTO users VALUES ('${HARNESS_SECRET}')`,
      },
    );
  }

  @Get('crypto-error')
  cryptoError(): never {
    throw new CryptoError('authentication_failed');
  }

  @Get('json-error')
  jsonError(): never {
    throw new JsonValidationError('secret_key');
  }

  @Get('transaction-error/:reason')
  transactionError(@Param('reason') reason: string): never {
    throw new TransactionError(reason as TransactionFailureReason, '40P01');
  }

  @Get('thrown-string')
  thrownString(): never {
    throw `postgres://user:${HARNESS_SECRET}@host/db`;
  }
}

@Module({ controllers: [ErrorHarnessController] })
export class ErrorHarnessModule {}
