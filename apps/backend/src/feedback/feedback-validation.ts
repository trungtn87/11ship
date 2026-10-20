import { BadRequestException } from '@nestjs/common';
import { isWellFormed } from '../auth/auth-validation';
import { AppError } from '../common/app-errors';
import { sniffImageType } from '../menu/menu-validation';
import { shaped, text } from '../delivery/delivery-validation';
import { isCanonicalUuid } from '../shared/identifiers';
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_COUNT,
  COMMENT_MAX_CODEPOINTS,
  COMPLAINT_CATEGORIES,
  COMPLAINT_TEXT_MAX_CODEPOINTS,
  ComplaintCategory,
  REVIEW_PAGE_DEFAULT,
  REVIEW_PAGE_MAX,
} from './feedback-constants';

// Strict parsers of the M11 client requests. Every body is an exact object: no key may be added, so no actor, subject, shop, driver, status or version of
// another record can arrive from a client. Failures never echo the offending key or value. Pure: no I/O.

function reject(): never {
  throw new BadRequestException();
}

export function parseUuid(value: unknown): string {
  return isCanonicalUuid(value) ? value : reject();
}

function optionalText(value: unknown, max: number): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = text(value, 0, max);
  return normalized === '' ? null : normalized;
}

/** A multi-line text: line breaks are kept (one blank line at most), everything else is normalized like a single line. */
export function longText(value: unknown, min: number, max: number): string {
  if (typeof value !== 'string') {
    return reject();
  }
  const lines = value
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/gu, ' ').trim());
  const joined = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const length = [...joined].length;
  if (/[\p{Cc}\p{Cf}]/u.test(joined.replace(/\n/g, '')) || length < min || length > max || !isWellFormed(joined)) {
    return reject();
  }
  return joined;
}

function optionalLongText(value: unknown, max: number): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = longText(value, 0, max);
  return normalized === '' ? null : normalized;
}

export interface ReviewInput {
  readonly stars: number;
  readonly comment: string | null;
}

/** POST .../reviews/...: {stars 1..5, comment?}. */
export function parseReviewBody(body: unknown): ReviewInput {
  const b = shaped(body, ['stars'], ['comment']);
  if (typeof b.stars !== 'number' || !Number.isInteger(b.stars) || b.stars < 1 || b.stars > 5) {
    return reject();
  }
  return { stars: b.stars, comment: optionalLongText(b.comment, COMMENT_MAX_CODEPOINTS) };
}

export interface ReplyInput {
  readonly body: string;
  readonly expectedVersion: number | null;
}

/** PUT /v1/shop/me/reviews/:id/reply: {body, expected_version?}. The first reply carries no version; a later one names the version it replaces. */
export function parseReplyBody(body: unknown): ReplyInput {
  const b = shaped(body, ['body'], ['expected_version']);
  let expectedVersion: number | null = null;
  if (b.expected_version !== undefined) {
    if (typeof b.expected_version !== 'number' || !Number.isSafeInteger(b.expected_version) || b.expected_version < 1) {
      return reject();
    }
    expectedVersion = b.expected_version;
  }
  return { body: longText(b.body, 1, COMMENT_MAX_CODEPOINTS), expectedVersion };
}

function queryObject(query: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (typeof query !== 'object' || query === null || Array.isArray(query)) {
    return reject();
  }
  const source = query as Record<string, unknown>;
  if (!Object.keys(source).every((key) => allowed.includes(key))) {
    return reject();
  }
  return source;
}

function intParam(source: Record<string, unknown>, key: string, fallback: number, min: number, max: number): number {
  if (!Object.hasOwn(source, key)) {
    return fallback;
  }
  const raw = source[key];
  if (typeof raw !== 'string' || !/^(0|[1-9][0-9]{0,6})$/.test(raw)) {
    return reject();
  }
  const value = Number(raw);
  return value >= min && value <= max ? value : reject();
}

export interface ReviewListQuery {
  readonly stars: number | null;
  readonly limit: number;
  readonly offset: number;
}

/** GET list of ratings: ?stars=1..5&limit&offset. */
export function parseReviewListQuery(query: unknown): ReviewListQuery {
  const source = queryObject(query, ['stars', 'limit', 'offset']);
  return {
    stars: Object.hasOwn(source, 'stars') ? intParam(source, 'stars', 0, 1, 5) : null,
    limit: intParam(source, 'limit', REVIEW_PAGE_DEFAULT, 1, REVIEW_PAGE_MAX),
    offset: intParam(source, 'offset', 0, 0, 100_000),
  };
}

export interface ShipperReviewListQuery extends ReviewListQuery {
  readonly source: 'CUSTOMER' | 'SHOP' | null;
}

export function parseShipperReviewListQuery(query: unknown): ShipperReviewListQuery {
  const source = queryObject(query, ['stars', 'source', 'limit', 'offset']);
  const kind = source.source;
  if (kind !== undefined && kind !== 'CUSTOMER' && kind !== 'SHOP') {
    return reject();
  }
  const rest: Record<string, unknown> = { ...source };
  delete rest.source;
  return { ...parseReviewListQuery(rest), source: kind ?? null };
}

export function parseNoQuery(query: unknown): void {
  queryObject(query, []);
}

// ---- complaints ------------------------------------------------------------------------------------------------------------

export interface AttachmentUpload {
  readonly contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly bytes: Buffer;
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** POST /complaints/attachments {content_type, data_base64}: a picture of at most 5 MB whose real format matches what was declared. */
export function parseAttachmentUpload(body: unknown): AttachmentUpload {
  const b = shaped(body, ['content_type', 'data_base64']);
  if (typeof b.content_type !== 'string' || typeof b.data_base64 !== 'string') {
    return reject();
  }
  const data = b.data_base64;
  if (data.length === 0 || data.length > Math.ceil((ATTACHMENT_MAX_BYTES * 4) / 3) + 4 || data.length % 4 !== 0 || !BASE64.test(data)) {
    throw new AppError('COMPLAINT_ATTACHMENT_INVALID');
  }
  const bytes = Buffer.from(data, 'base64');
  const sniffed = sniffImageType(bytes);
  if (bytes.length === 0 || bytes.length > ATTACHMENT_MAX_BYTES || sniffed === null || sniffed !== b.content_type) {
    throw new AppError('COMPLAINT_ATTACHMENT_INVALID');
  }
  return { contentType: sniffed, bytes };
}

function attachmentIds(value: unknown): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.length > ATTACHMENT_MAX_COUNT) {
    throw new AppError('COMPLAINT_ATTACHMENT_LIMIT');
  }
  const ids = value.map(parseUuid);
  return new Set(ids).size === ids.length ? ids : reject();
}

export interface CreateComplaintInput {
  readonly category: ComplaintCategory;
  readonly body: string;
  readonly orderId: string | null;
  readonly deliveryId: string | null;
  readonly reviewId: string | null;
  readonly attachmentIds: readonly string[];
}

/** POST /complaints: exactly one of order_id / delivery_id / review_id names what the complaint is about. The group OTHER needs a description. */
export function parseCreateComplaintBody(body: unknown): CreateComplaintInput {
  const b = shaped(body, ['category', 'body'], ['order_id', 'delivery_id', 'review_id', 'attachment_ids']);
  if (typeof b.category !== 'string' || !(COMPLAINT_CATEGORIES as readonly string[]).includes(b.category)) {
    return reject();
  }
  const subjects = ['order_id', 'delivery_id', 'review_id'].filter((key) => b[key] !== undefined);
  if (subjects.length !== 1) {
    return reject();
  }
  const category = b.category as ComplaintCategory;
  if ((category === 'SHIPPER_REVIEW') !== (b.review_id !== undefined)) {
    return reject();
  }
  return {
    category,
    body: longText(b.body, 1, COMPLAINT_TEXT_MAX_CODEPOINTS),
    orderId: b.order_id === undefined ? null : parseUuid(b.order_id),
    deliveryId: b.delivery_id === undefined ? null : parseUuid(b.delivery_id),
    reviewId: b.review_id === undefined ? null : parseUuid(b.review_id),
    attachmentIds: attachmentIds(b.attachment_ids),
  };
}

export interface SupplementInput {
  readonly body: string | null;
  readonly attachmentIds: readonly string[];
}

/** POST /complaints/:id/supplement: some text, some pictures, or both. */
export function parseSupplementBody(body: unknown): SupplementInput {
  const b = shaped(body, [], ['body', 'attachment_ids']);
  const input = { body: optionalLongText(b.body, COMPLAINT_TEXT_MAX_CODEPOINTS), attachmentIds: attachmentIds(b.attachment_ids) };
  return input.body === null && input.attachmentIds.length === 0 ? reject() : input;
}

export interface ReconsiderInput {
  readonly reason: string;
}

export function parseReconsiderBody(body: unknown): ReconsiderInput {
  const b = shaped(body, ['reason']);
  return { reason: longText(b.reason, 1, 2000) };
}

export interface ComplaintListQuery {
  readonly scope: 'open' | 'closed';
  readonly limit: number;
  readonly offset: number;
}

export function parseComplaintListQuery(query: unknown): ComplaintListQuery {
  const source = queryObject(query, ['scope', 'limit', 'offset']);
  const scope = source.scope ?? 'open';
  if (scope !== 'open' && scope !== 'closed') {
    return reject();
  }
  return { scope, limit: intParam(source, 'limit', 30, 1, 50), offset: intParam(source, 'offset', 0, 0, 100_000) };
}

export { optionalText };
