import { HttpException } from '@nestjs/common';

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    request_id: string;
    details: Record<string, never>;
  };
}

export interface ClassifiedError {
  status: number;
  code: string;
  message: string;
}

// Messages are fixed strings per status. The message of the original exception is never used,
// because it can contain hosts, SQL, DSNs or other secrets.
const KNOWN: Readonly<Record<number, { code: string; message: string }>> = {
  400: { code: 'BAD_REQUEST', message: 'Bad request' },
  401: { code: 'UNAUTHORIZED', message: 'Unauthorized' },
  403: { code: 'FORBIDDEN', message: 'Forbidden' },
  404: { code: 'NOT_FOUND', message: 'Not found' },
  409: { code: 'CONFLICT', message: 'Conflict' },
  422: { code: 'UNPROCESSABLE_ENTITY', message: 'Unprocessable entity' },
  429: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests' },
  503: { code: 'SERVICE_UNAVAILABLE', message: 'Service unavailable' },
};

const INTERNAL: ClassifiedError = {
  status: 500,
  code: 'INTERNAL_ERROR',
  message: 'Internal server error',
};

function httpStatusOf(exception: unknown): number | undefined {
  if (exception instanceof HttpException) {
    return exception.getStatus();
  }
  // Errors raised by the HTTP layer itself (for example a malformed URL) carry a 4xx status.
  if (typeof exception === 'object' && exception !== null) {
    const { status, statusCode } = exception as { status?: unknown; statusCode?: unknown };
    for (const candidate of [status, statusCode]) {
      if (
        typeof candidate === 'number' &&
        Number.isInteger(candidate) &&
        candidate >= 400 &&
        candidate < 500
      ) {
        return candidate;
      }
    }
  }
  return undefined;
}

export function classifyException(exception: unknown): ClassifiedError {
  const status = httpStatusOf(exception);
  if (status === undefined) {
    return INTERNAL;
  }
  const known = KNOWN[status];
  if (known !== undefined) {
    return { status, code: known.code, message: known.message };
  }
  if (status >= 400 && status < 500) {
    return { status, code: 'CLIENT_ERROR', message: 'Client error' };
  }
  return INTERNAL;
}

export function buildErrorBody(classified: ClassifiedError, requestId: string): ErrorBody {
  return {
    error: {
      code: classified.code,
      message: classified.message,
      request_id: requestId,
      details: {},
    },
  };
}
