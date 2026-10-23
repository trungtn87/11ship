import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { ReviewKind, Visibility } from './feedback-constants';
import { summarize, Summary } from './feedback-rules';

// SQL of app.reviews, app.review_replies, app.review_reply_history and app.review_moderations (M11 owns the four). Every method takes the caller's
// TransactionContext: none of them begins, commits or rolls back. Times are read as epoch milliseconds and written with the database clock.

const CLOCK = `date_trunc('milliseconds', clock_timestamp())`;
const ms = (column: string, alias: string): string => `(extract(epoch FROM ${column}) * 1000)::bigint::text AS ${alias}`;

function safe(raw: unknown): number {
  const value = typeof raw === 'string' && /^-?[0-9]{1,16}$/.test(raw) ? Number(raw) : typeof raw === 'number' ? raw : Number.NaN;
  if (!Number.isSafeInteger(value)) {
    throw new TechnicalError('internal', 'Database returned an unexpected number');
  }
  return value;
}

export interface ReviewRow {
  readonly reviewId: string;
  readonly kind: ReviewKind;
  readonly reviewerUserId: string;
  readonly shopId: string;
  readonly driverId: string | null;
  readonly orderId: string | null;
  readonly deliveryId: string | null;
  readonly assignmentId: string | null;
  readonly stars: number;
  readonly comment: string | null;
  readonly reviewerName: string;
  readonly shopName: string;
  readonly driverName: string | null;
  readonly relatedCode: string;
  readonly visibility: Visibility;
  readonly version: number;
  readonly createdAtMs: number;
}

export interface NewReview {
  readonly reviewId: string;
  readonly kind: ReviewKind;
  readonly reviewerUserId: string;
  readonly shopId: string;
  readonly driverId: string | null;
  readonly orderId: string | null;
  readonly deliveryId: string | null;
  readonly assignmentId: string | null;
  readonly stars: number;
  readonly comment: string | null;
  readonly reviewerName: string;
  readonly shopName: string;
  readonly driverName: string | null;
  readonly relatedCode: string;
}

export interface ReplyRow {
  readonly reviewId: string;
  readonly body: string;
  readonly version: number;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

export interface ReplyHistoryRow {
  readonly version: number;
  readonly body: string;
  readonly writtenAtMs: number;
}

export interface ReviewWithReply extends ReviewRow {
  readonly reply: ReplyRow | null;
}

interface RawReview {
  review_id: string;
  kind: ReviewKind;
  reviewer_user_id: string;
  shop_id: string;
  driver_id: string | null;
  order_id: string | null;
  delivery_id: string | null;
  assignment_id: string | null;
  stars: number;
  comment: string | null;
  reviewer_name: string;
  shop_name: string;
  driver_name: string | null;
  related_code: string;
  visibility: Visibility;
  version: string;
  created_ms: string;
}

interface RawReply {
  r_body: string | null;
  r_version: string | null;
  r_created_ms: string | null;
  r_updated_ms: string | null;
}

const REVIEW_COLUMNS = `r.review_id, r.kind, r.reviewer_user_id, r.shop_id, r.driver_id, r.order_id, r.delivery_id, r.assignment_id, r.stars, r.comment, r.reviewer_name,
  r.shop_name, r.driver_name, r.related_code, r.visibility, r.version::text AS version, ${ms('r.created_at', 'created_ms')}`;

const REPLY_COLUMNS = `p.body AS r_body, p.version::text AS r_version, ${ms('p.created_at', 'r_created_ms')}, ${ms('p.updated_at', 'r_updated_ms')}`;

const map = (row: RawReview): ReviewRow => ({
  reviewId: row.review_id,
  kind: row.kind,
  reviewerUserId: row.reviewer_user_id,
  shopId: row.shop_id,
  driverId: row.driver_id,
  orderId: row.order_id,
  deliveryId: row.delivery_id,
  assignmentId: row.assignment_id,
  stars: row.stars,
  comment: row.comment,
  reviewerName: row.reviewer_name,
  shopName: row.shop_name,
  driverName: row.driver_name,
  relatedCode: row.related_code,
  visibility: row.visibility,
  version: safe(row.version),
  createdAtMs: safe(row.created_ms),
});

const mapReply = (row: RawReply, reviewId: string): ReplyRow | null =>
  row.r_body === null || row.r_version === null || row.r_created_ms === null || row.r_updated_ms === null
    ? null
    : { reviewId, body: row.r_body, version: safe(row.r_version), createdAtMs: safe(row.r_created_ms), updatedAtMs: safe(row.r_updated_ms) };

export interface AdminReviewFilter {
  readonly kind: ReviewKind | null;
  readonly stars: number | null;
  readonly visibility: Visibility | null;
  readonly q: string;
  readonly fromMs: number | null;
  readonly toMs: number | null;
  readonly shop: string;
  readonly shipper: string;
}

@Injectable()
export class ReviewRepository {
  /** False when the rating already exists (the unique index of the actor and subject answered): nothing was written. */
  async insert(context: TransactionContext, r: NewReview): Promise<boolean> {
    const result = await context.query(
      `INSERT INTO app.reviews (review_id, kind, reviewer_user_id, shop_id, driver_id, order_id, delivery_id, assignment_id, stars, comment, reviewer_name, shop_name, driver_name, related_code, visibility, version, created_at)
       VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7::uuid, $8::uuid, $9::smallint, $10, $11, $12, $13, $14, 'VISIBLE', 1, ${CLOCK})
       ON CONFLICT DO NOTHING`,
      [r.reviewId, r.kind, r.reviewerUserId, r.shopId, r.driverId, r.orderId, r.deliveryId, r.assignmentId, r.stars, r.comment, r.reviewerName, r.shopName, r.driverName, r.relatedCode],
    );
    return result.rowCount === 1;
  }

  async findShopReviewOfOrder(context: TransactionContext, orderId: string): Promise<ReviewRow | undefined> {
    const result = await context.query<RawReview>(`SELECT ${REVIEW_COLUMNS} FROM app.reviews r WHERE r.kind = 'SHOP_BY_CUSTOMER' AND r.order_id = $1::uuid`, [orderId]);
    return result.rows[0] === undefined ? undefined : map(result.rows[0]);
  }

  async findOfDelivery(context: TransactionContext, deliveryId: string, kind: 'SHIPPER_BY_CUSTOMER' | 'SHIPPER_BY_SHOP'): Promise<ReviewRow | undefined> {
    const result = await context.query<RawReview>(`SELECT ${REVIEW_COLUMNS} FROM app.reviews r WHERE r.kind = $2 AND r.delivery_id = $1::uuid`, [deliveryId, kind]);
    return result.rows[0] === undefined ? undefined : map(result.rows[0]);
  }

  async findById(context: TransactionContext, reviewId: string): Promise<ReviewRow | undefined> {
    const result = await context.query<RawReview>(`SELECT ${REVIEW_COLUMNS} FROM app.reviews r WHERE r.review_id = $1::uuid`, [reviewId]);
    return result.rows[0] === undefined ? undefined : map(result.rows[0]);
  }

  async lockById(context: TransactionContext, reviewId: string): Promise<ReviewRow | undefined> {
    const result = await context.query<RawReview>(`SELECT ${REVIEW_COLUMNS} FROM app.reviews r WHERE r.review_id = $1::uuid FOR UPDATE`, [reviewId]);
    return result.rows[0] === undefined ? undefined : map(result.rows[0]);
  }

  // ---- shop page ---------------------------------------------------------------------------------------------------------------

  /** Customer ratings of a shop that count (VISIBLE), newest first, with the shop's reply. `stars` filters one star count. */
  async listShopReviews(context: TransactionContext, shopId: string, stars: number | null, limit: number, offset: number, includeHidden = false): Promise<ReviewWithReply[]> {
    const result = await context.query<RawReview & RawReply>(
      `SELECT ${REVIEW_COLUMNS}, ${REPLY_COLUMNS}
         FROM app.reviews r LEFT JOIN app.review_replies p ON p.review_id = r.review_id
        WHERE r.shop_id = $1::uuid AND r.kind = 'SHOP_BY_CUSTOMER' AND ($2::boolean OR r.visibility = 'VISIBLE') AND ($3::int IS NULL OR r.stars = $3::int)
        ORDER BY r.created_at DESC, r.review_id DESC
        LIMIT $4 OFFSET $5`,
      [shopId, includeHidden, stars, limit, offset],
    );
    return result.rows.map((row) => ({ ...map(row), reply: mapReply(row, row.review_id) }));
  }

  async findShopReviewWithReply(context: TransactionContext, reviewId: string): Promise<ReviewWithReply | undefined> {
    const result = await context.query<RawReview & RawReply>(
      `SELECT ${REVIEW_COLUMNS}, ${REPLY_COLUMNS} FROM app.reviews r LEFT JOIN app.review_replies p ON p.review_id = r.review_id WHERE r.review_id = $1::uuid`,
      [reviewId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : { ...map(row), reply: mapReply(row, row.review_id) };
  }

  /** Counts per star of the ratings that COUNT: a hidden rating is in no total. */
  async shopSummary(context: TransactionContext, shopId: string): Promise<Summary> {
    const result = await context.query<{ stars: number; n: string }>(
      `SELECT stars, count(*)::text AS n FROM app.reviews WHERE shop_id = $1::uuid AND kind = 'SHOP_BY_CUSTOMER' AND visibility = 'VISIBLE' GROUP BY stars`,
      [shopId],
    );
    return fold(result.rows);
  }

  /** One bounded aggregate for discovery cards, with the same public visibility rule as shopSummary. */
  async shopSummaries(context: TransactionContext, shopIds: readonly string[]): Promise<Map<string, { count: number; average: number | null }>> {
    if (shopIds.length === 0) return new Map();
    const result = await context.query<{ shop_id: string; n: string; average: string }>(
      `SELECT shop_id, count(*)::text AS n, avg(stars)::text AS average FROM app.reviews
       WHERE shop_id = ANY($1::uuid[]) AND kind = 'SHOP_BY_CUSTOMER' AND visibility = 'VISIBLE' GROUP BY shop_id`, [shopIds]);
    return new Map(result.rows.map((row) => [row.shop_id, { count: safe(row.n), average: Number(row.average) }]));
  }

  /** The Shipper's score, split by who wrote it (CUSTOMER / SHOP) and combined, over the visible ratings only. */
  async shipperSummary(context: TransactionContext, driverId: string): Promise<{ readonly customer: Summary; readonly shop: Summary; readonly all: Summary }> {
    const result = await context.query<{ kind: ReviewKind; stars: number; n: string }>(
      `SELECT kind, stars, count(*)::text AS n FROM app.reviews WHERE driver_id = $1::uuid AND visibility = 'VISIBLE' GROUP BY kind, stars`,
      [driverId],
    );
    return {
      customer: fold(result.rows.filter((r) => r.kind === 'SHIPPER_BY_CUSTOMER')),
      shop: fold(result.rows.filter((r) => r.kind === 'SHIPPER_BY_SHOP')),
      all: fold(result.rows),
    };
  }

  /** The ratings about a Shipper (visible ones only), newest first. Nothing identifies the writer: no user id, name or order link leaves through the view. */
  async listShipperReviews(context: TransactionContext, driverId: string, source: 'CUSTOMER' | 'SHOP' | null, stars: number | null, limit: number, offset: number): Promise<ReviewRow[]> {
    const kind = source === null ? null : source === 'CUSTOMER' ? 'SHIPPER_BY_CUSTOMER' : 'SHIPPER_BY_SHOP';
    const result = await context.query<RawReview>(
      `SELECT ${REVIEW_COLUMNS} FROM app.reviews r
        WHERE r.driver_id = $1::uuid AND r.visibility = 'VISIBLE' AND ($2::text IS NULL OR r.kind = $2::text) AND ($3::int IS NULL OR r.stars = $3::int)
        ORDER BY r.created_at DESC, r.review_id DESC LIMIT $4 OFFSET $5`,
      [driverId, kind, stars, limit, offset],
    );
    return result.rows.map(map);
  }

  // ---- reply -------------------------------------------------------------------------------------------------------------------

  async lockReply(context: TransactionContext, reviewId: string): Promise<ReplyRow | undefined> {
    const result = await context.query<RawReply>(`SELECT ${REPLY_COLUMNS} FROM app.review_replies p WHERE p.review_id = $1::uuid FOR UPDATE`, [reviewId]);
    const row = result.rows[0];
    return row === undefined ? undefined : (mapReply(row, reviewId) ?? undefined);
  }

  async insertReply(context: TransactionContext, reviewId: string, shopId: string, body: string): Promise<void> {
    const result = await context.query(
      `INSERT INTO app.review_replies (review_id, shop_id, body, version, created_at, updated_at) VALUES ($1::uuid, $2::uuid, $3, 1, ${CLOCK}, ${CLOCK})`,
      [reviewId, shopId, body],
    );
    if (result.rowCount !== 1) {
      throw new TechnicalError('internal', 'Reply was not written');
    }
  }

  async updateReply(context: TransactionContext, reviewId: string, expectedVersion: number, body: string): Promise<boolean> {
    const result = await context.query(
      `UPDATE app.review_replies SET body = $3, version = version + 1, updated_at = ${CLOCK} WHERE review_id = $1::uuid AND version = $2::bigint`,
      [reviewId, expectedVersion, body],
    );
    return result.rowCount === 1;
  }

  async appendReplyHistory(context: TransactionContext, reviewId: string, version: number, body: string, writtenBy: string): Promise<void> {
    await context.query(
      `INSERT INTO app.review_reply_history (review_id, version, body, written_by, written_at) VALUES ($1::uuid, $2::bigint, $3, $4::uuid, ${CLOCK})`,
      [reviewId, version, body, writtenBy],
    );
  }

  async replyHistory(context: TransactionContext, reviewId: string): Promise<ReplyHistoryRow[]> {
    const result = await context.query<{ version: string; body: string; written_ms: string }>(
      `SELECT version::text AS version, body, ${ms('written_at', 'written_ms')} FROM app.review_reply_history WHERE review_id = $1::uuid ORDER BY version`,
      [reviewId],
    );
    return result.rows.map((row) => ({ version: safe(row.version), body: row.body, writtenAtMs: safe(row.written_ms) }));
  }

  // ---- moderation --------------------------------------------------------------------------------------------------------------

  /** False when the version moved (another Administrator got there first). */
  async setVisibility(context: TransactionContext, reviewId: string, expectedVersion: number, visibility: Visibility): Promise<boolean> {
    const result = await context.query(
      `UPDATE app.reviews SET visibility = $3, moderated_at = ${CLOCK}, version = version + 1 WHERE review_id = $1::uuid AND version = $2::bigint`,
      [reviewId, expectedVersion, visibility],
    );
    return result.rowCount === 1;
  }

  async appendModeration(context: TransactionContext, m: { moderationId: string; reviewId: string; action: 'HIDE' | 'RESTORE'; reasonCode: string; reasonNote: string | null; actorUserId: string }): Promise<void> {
    await context.query(
      `INSERT INTO app.review_moderations (moderation_id, review_id, action, reason_code, reason_note, actor_user_id, created_at) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid, ${CLOCK})`,
      [m.moderationId, m.reviewId, m.action, m.reasonCode, m.reasonNote, m.actorUserId],
    );
  }

  async moderations(context: TransactionContext, reviewId: string): Promise<{ action: 'HIDE' | 'RESTORE'; reasonCode: string; reasonNote: string | null; actorUserId: string; atMs: number }[]> {
    const result = await context.query<{ action: 'HIDE' | 'RESTORE'; reason_code: string; reason_note: string | null; actor_user_id: string; at_ms: string }>(
      `SELECT action, reason_code, reason_note, actor_user_id, ${ms('created_at', 'at_ms')} FROM app.review_moderations WHERE review_id = $1::uuid ORDER BY created_at, moderation_id`,
      [reviewId],
    );
    return result.rows.map((r) => ({ action: r.action, reasonCode: r.reason_code, reasonNote: r.reason_note, actorUserId: r.actor_user_id, atMs: safe(r.at_ms) }));
  }

  // ---- administration ----------------------------------------------------------------------------------------------------------

  async listForAdmin(context: TransactionContext, f: AdminReviewFilter, page: { limit: number; offset: number }): Promise<{ rows: ReviewWithReply[]; total: number }> {
    const where = `($1::text IS NULL OR r.kind = $1::text) AND ($2::int IS NULL OR r.stars = $2::int) AND ($3::text IS NULL OR r.visibility = $3::text)
        AND ($4::text = '' OR r.related_code ILIKE $4::text ESCAPE '!' OR r.review_id::text = $5::text)
        AND ($6::timestamptz IS NULL OR r.created_at >= $6::timestamptz) AND ($7::timestamptz IS NULL OR r.created_at < $7::timestamptz)
        AND ($8::text = '' OR r.shop_name ILIKE $8::text ESCAPE '!') AND ($9::text = '' OR r.driver_name ILIKE $9::text ESCAPE '!')`;
    const args = [f.kind, f.stars, f.visibility, f.q === '' ? '' : `%${escapeLike(f.q)}%`, f.q, f.fromMs === null ? null : new Date(f.fromMs), f.toMs === null ? null : new Date(f.toMs), f.shop === '' ? '' : `%${escapeLike(f.shop)}%`, f.shipper === '' ? '' : `%${escapeLike(f.shipper)}%`];
    const total = await context.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.reviews r WHERE ${where}`, args);
    const result = await context.query<RawReview & RawReply>(
      `SELECT ${REVIEW_COLUMNS}, ${REPLY_COLUMNS} FROM app.reviews r LEFT JOIN app.review_replies p ON p.review_id = r.review_id WHERE ${where}
        ORDER BY r.created_at DESC, r.review_id DESC LIMIT $10 OFFSET $11`,
      [...args, page.limit, page.offset],
    );
    return { rows: result.rows.map((row) => ({ ...map(row), reply: mapReply(row, row.review_id) })), total: safe(total.rows[0]?.n ?? '0') };
  }

  async adminCounters(context: TransactionContext): Promise<{ total: number; hidden: number; low: number }> {
    const result = await context.query<{ total: string; hidden: string; low: string }>(
      `SELECT count(*)::text AS total, count(*) FILTER (WHERE visibility = 'HIDDEN')::text AS hidden, count(*) FILTER (WHERE stars <= 2 AND visibility = 'VISIBLE')::text AS low FROM app.reviews`,
    );
    const row = result.rows[0];
    return { total: safe(row?.total ?? '0'), hidden: safe(row?.hidden ?? '0'), low: safe(row?.low ?? '0') };
  }
}

export function escapeLike(value: string): string {
  return value.replace(/[!%_]/g, (c) => `!${c}`);
}

function fold(rows: readonly { stars: number; n: string }[]): Summary {
  const counts: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  for (const row of rows) {
    counts[row.stars - 1] = (counts[row.stars - 1] ?? 0) + safe(row.n);
  }
  return summarize(counts);
}
