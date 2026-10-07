// Helpers that extract only values that are safe to log or return.
// Raw error messages, stacks and driver details can contain hosts, users, SQL or secrets, so callers
// must never log them. Codes and class names come from FIXED allow-lists, not from a pattern: a
// string that merely "looks like" a code is not proven safe, so unknown values become UNKNOWN.
import { isAppErrorCode } from './app-errors';

// Network/system codes raised by Node while talking to PostgreSQL.
const SYSTEM_CODES: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EADDRINUSE',
]);

// SQLSTATE class codes defined by PostgreSQL (Appendix A). A code is accepted only when it is five
// characters long and its two-character class is one of these.
const SQLSTATE_CLASSES: ReadonlySet<string> = new Set([
  '00', '01', '02', '03', '08', '09', '0A', '0B', '0F', '0L', '0P', '0Z', '20', '21', '22', '23',
  '24', '25', '26', '27', '28', '2B', '2D', '2F', '34', '38', '39', '3B', '3D', '3F', '40', '42',
  '44', '53', '54', '55', '57', '58', '72', 'F0', 'HV', 'P0', 'XX',
]);

const SQLSTATE_SHAPE = /^[0-9A-Z]{5}$/;

export function isSystemErrorCode(code: unknown): code is string {
  return typeof code === 'string' && SYSTEM_CODES.has(code);
}

export function isSqlState(code: unknown): code is string {
  return typeof code === 'string' && SQLSTATE_SHAPE.test(code) && SQLSTATE_CLASSES.has(code.slice(0, 2));
}

export function safeErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const { code } = error as { code?: unknown };
    if (typeof code === 'string') {
      if (isSystemErrorCode(code) || isSqlState(code) || isAppErrorCode(code)) {
        return code;
      }
    }
  }
  return 'UNKNOWN';
}

const SAFE_CLASSES: ReadonlySet<string> = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'AppError',
  'TechnicalError',
  'TransactionError',
  'CryptoError',
  'JsonValidationError',
  'DatabaseError',
  'HttpException',
  'BadRequestException',
  'UnauthorizedException',
  'ForbiddenException',
  'NotFoundException',
  'ConflictException',
  'UnprocessableEntityException',
  'PayloadTooLargeException',
  'UnsupportedMediaTypeException',
  'InternalServerErrorException',
  'ServiceUnavailableException',
]);

export function safeErrorClass(error: unknown): string {
  if (error instanceof Error) {
    const name = error.constructor.name;
    if (SAFE_CLASSES.has(name)) {
      return name;
    }
  }
  return 'UnknownError';
}
