// Typed application errors. Every error that may reach a client has a FIXED code, HTTP status and
// message defined here. Nothing from a thrown exception (message, details, extra "code" fields) is
// ever copied into a response: classification looks at the class of the exception, not its content.

export const APP_ERROR_DEFINITIONS = {
  IDEMPOTENCY_KEY_REQUIRED: { status: 400, message: 'Idempotency-Key header is required' },
  INVALID_IDEMPOTENCY_KEY: { status: 400, message: 'Idempotency-Key is invalid' },
  IDEMPOTENCY_KEY_REUSED: {
    status: 409,
    message: 'Idempotency-Key was already used with a different request',
  },
  IDEMPOTENCY_BUSY: {
    status: 409,
    message: 'A request with this Idempotency-Key is already in progress',
  },
  IDEMPOTENCY_REPLAY_EXPIRED: {
    status: 409,
    message: 'The replay window for this Idempotency-Key has expired',
  },
  IDEMPOTENCY_KEY_UNAVAILABLE: {
    status: 503,
    message: 'Idempotency protection is temporarily unavailable',
  },
  TRANSACTION_OUTCOME_UNKNOWN: {
    status: 503,
    message: 'The outcome of the operation could not be determined',
  },
} as const satisfies Record<string, { status: number; message: string }>;

export type AppErrorCode = keyof typeof APP_ERROR_DEFINITIONS;

export const APP_ERROR_CODES: readonly AppErrorCode[] = Object.freeze(
  Object.keys(APP_ERROR_DEFINITIONS) as AppErrorCode[],
);

export function isAppErrorCode(value: unknown): value is AppErrorCode {
  return typeof value === 'string' && Object.hasOwn(APP_ERROR_DEFINITIONS, value);
}

/** An error whose public representation is fully defined by the registry. */
export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;

  constructor(code: AppErrorCode) {
    super(APP_ERROR_DEFINITIONS[code].message);
    this.name = 'AppError';
    this.code = code;
    this.status = APP_ERROR_DEFINITIONS[code].status;
  }
}

export type TechnicalErrorKind = 'unavailable' | 'internal';

/**
 * Base class for infrastructure failures (transaction, crypto, JSON validation). They carry a short
 * machine reason for logs and tests, never user data. Over HTTP they all collapse into the generic
 * 503 SERVICE_UNAVAILABLE ("unavailable") or 500 INTERNAL_ERROR ("internal") envelope.
 */
export class TechnicalError extends Error {
  readonly kind: TechnicalErrorKind;

  constructor(kind: TechnicalErrorKind, message: string) {
    super(message);
    this.name = 'TechnicalError';
    this.kind = kind;
  }
}
