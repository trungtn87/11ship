// Helpers that extract only values that are safe to log or return.
// Raw error messages, stacks and driver details can contain hosts, users, SQL or secrets,
// so callers must never log them. These helpers expose a short allow-listed code instead.

const SAFE_CODE = /^[A-Za-z0-9_]{1,32}$/;
const SAFE_CLASS = /^[A-Za-z0-9_]{1,64}$/;

export function safeErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const { code } = error as { code?: unknown };
    if (typeof code === 'string' && SAFE_CODE.test(code)) {
      return code;
    }
  }
  return 'UNKNOWN';
}

export function safeErrorClass(error: unknown): string {
  if (error instanceof Error) {
    const name = error.constructor.name;
    if (SAFE_CLASS.test(name)) {
      return name;
    }
  }
  return 'UnknownError';
}
