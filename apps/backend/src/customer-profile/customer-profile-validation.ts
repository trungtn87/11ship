import { BadRequestException } from '@nestjs/common';
import { exactObject } from '../auth/auth-validation';
import { normalizeFullName } from '../client-auth/client-auth-validation';

// Strict request parsing of the own-profile endpoints (M01.05). Pure: no I/O. Identity is never read from the request: the
// PUT body is exactly {full_name, expected_version}, and neither a GET nor a PUT accepts a query string, so no user_id,
// driver_id or any other selector can arrive. Failures never echo the offending key or value: a plain 400 BAD_REQUEST.

export interface CustomerProfileUpdateInput {
  /** NFC, collapsed and trimmed, 1..120 code points: the normalization of the registration name (M01.03). */
  readonly fullName: string;
  /** A positive safe integer. */
  readonly expectedVersion: number;
}

function reject(): never {
  throw new BadRequestException();
}

/** PUT /v1/customer/me/profile: exact {full_name, expected_version}. */
export function parseCustomerProfileUpdateBody(body: unknown): CustomerProfileUpdateInput {
  const parsed = exactObject(body, ['full_name', 'expected_version']);
  const expectedVersion = parsed.expected_version;
  if (typeof expectedVersion !== 'number' || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    return reject();
  }
  return { fullName: normalizeFullName(parsed.full_name), expectedVersion };
}

/** No query parameter is accepted on these routes: the only caller identity is the authenticated principal. */
export function rejectQuery(query: unknown): void {
  if (query === undefined) {
    return;
  }
  if (typeof query !== 'object' || query === null || Object.keys(query).length > 0) {
    reject();
  }
}

interface HeaderBag {
  readonly headers: Record<string, string | string[] | undefined>;
}

/**
 * A GET takes neither a query nor a body. A body is recognized by its framing headers (a Content-Length other than 0, or a
 * Transfer-Encoding), so even an empty JSON object sent with a GET is refused, whatever the body parser made of it.
 */
export function rejectBodyAndQuery(request: HeaderBag, query: unknown): void {
  rejectQuery(query);
  const length = request.headers['content-length'];
  if (request.headers['transfer-encoding'] !== undefined || (length !== undefined && length !== '0')) {
    reject();
  }
}
