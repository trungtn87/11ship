import { Injectable } from '@nestjs/common';

/** Production base URL of the SePay transactions API (developer.sepay.vn, sepay-api/v2). No sandbox URL is verified; tests never call it. */
export const SEPAY_TRANSACTIONS_URL = 'https://userapi.sepay.vn/v2/transactions';
export const SEPAY_REQUEST_TIMEOUT_MS = 15_000;
/** Used when a 429 carries no usable Retry-After: one cron interval. */
export const SEPAY_DEFAULT_RETRY_AFTER_SECONDS = 900;
const MAX_RETRY_AFTER_SECONDS = 3600;

export interface SepayPageRequest {
  readonly apiKey: string;
  /** The cursor: only transactions recorded after this id. Undefined on the very first run (all history). */
  readonly sinceId: string | undefined;
  readonly page: number;
  readonly perPage: number;
}

export type SepayPageResult =
  | { readonly kind: 'PAGE'; readonly rows: readonly unknown[]; readonly hasMore: boolean }
  | { readonly kind: 'RATE_LIMITED'; readonly retryAfterSeconds: number }
  | { readonly kind: 'UNAUTHORIZED' };

/** The transport seam. The real implementation calls SePay; tests inject a fake and never reach the network. */
export interface SepayTransactionsClient {
  fetchPage(request: SepayPageRequest): Promise<SepayPageResult>;
}

export const SEPAY_TRANSACTIONS_CLIENT = Symbol('SEPAY_TRANSACTIONS_CLIENT');

/**
 * Reads one page of incoming transfers: GET /v2/transactions with transfer_type=in, transaction_date_sort=asc and timestamp_format=iso8601. Only
 * the documented shape is accepted ({ data: [...], meta: { pagination: { has_more } } }); anything else is a failure, never a guess. A 429 is
 * returned as a result (the caller backs off); a 401 is returned as a result (the caller stops); other failures throw without the body.
 */
@Injectable()
export class HttpSepayTransactionsClient implements SepayTransactionsClient {
  async fetchPage(request: SepayPageRequest): Promise<SepayPageResult> {
    const url = new URL(SEPAY_TRANSACTIONS_URL);
    url.searchParams.set('per_page', String(request.perPage));
    url.searchParams.set('page', String(request.page));
    url.searchParams.set('transfer_type', 'in');
    url.searchParams.set('transaction_date_sort', 'asc');
    url.searchParams.set('timestamp_format', 'iso8601');
    if (request.sinceId !== undefined) {
      url.searchParams.set('since_id', request.sinceId);
    }
    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${request.apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(SEPAY_REQUEST_TIMEOUT_MS),
      redirect: 'error',
    });
    if (response.status === 401) {
      return { kind: 'UNAUTHORIZED' };
    }
    if (response.status === 429) {
      return { kind: 'RATE_LIMITED', retryAfterSeconds: parseRetryAfter(response.headers.get('retry-after')) };
    }
    if (response.status !== 200) {
      throw new Error(`SEPAY_HTTP_${response.status}`);
    }
    const body = (await response.json()) as unknown;
    return parsePage(body);
  }
}

/** Retry-After as seconds (the form SePay documents). Missing or unusable values fall back to one interval; the value is bounded. */
export function parseRetryAfter(value: string | null): number {
  if (value === null || !/^[0-9]{1,6}$/.test(value.trim())) {
    return SEPAY_DEFAULT_RETRY_AFTER_SECONDS;
  }
  const seconds = Number.parseInt(value.trim(), 10);
  if (seconds < 1) {
    return SEPAY_DEFAULT_RETRY_AFTER_SECONDS;
  }
  return Math.min(seconds, MAX_RETRY_AFTER_SECONDS);
}

/** Accepts only the documented envelope; throws (without echoing content) when it is not. */
export function parsePage(body: unknown): SepayPageResult {
  if (typeof body !== 'object' || body === null) {
    throw new Error('SEPAY_RESPONSE_INVALID');
  }
  const raw = body as Record<string, unknown>;
  const data = raw.data;
  const meta = raw.meta as { pagination?: { has_more?: unknown } } | undefined;
  const hasMore = meta?.pagination?.has_more;
  if (!Array.isArray(data) || typeof hasMore !== 'boolean') {
    throw new Error('SEPAY_RESPONSE_INVALID');
  }
  return { kind: 'PAGE', rows: data, hasMore };
}
