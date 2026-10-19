import { JsonObject } from '../idempotency/idempotency-executor';
import { Summary } from './feedback-rules';
import { ReplyRow, ReviewRow, ReviewWithReply } from './review-repository';

// What each reader is allowed to see of a rating. Nothing here carries a phone number, an address, an account id or (for a Shipper) the identity of the writer.

export const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

export const summaryView = (s: Summary): JsonObject => ({ average: s.average, count: s.count, distribution: { ...s.distribution } });

export const replyView = (reply: ReplyRow | null): JsonObject | null => (reply === null ? null : { body: reply.body, version: reply.version, created_at: iso(reply.createdAtMs), updated_at: iso(reply.updatedAtMs) });

/** The rating its own author wrote: stars, comment and time only. */
export const ownReviewView = (r: ReviewRow): JsonObject => ({ review_id: r.reviewId, stars: r.stars, comment: r.comment, created_at: iso(r.createdAtMs) });

/** One line of the PUBLIC shop page: the display name the customer gave, the day, the stars, the comment and the shop's reply. */
export const publicReviewView = (r: ReviewWithReply): JsonObject => ({
  review_id: r.reviewId,
  reviewer_name: r.reviewerName,
  stars: r.stars,
  comment: r.comment,
  created_at: iso(r.createdAtMs),
  reply: r.reply === null ? null : { body: r.reply.body, updated_at: iso(r.reply.updatedAtMs) },
});

/** The shop owner's own page of the same ratings: adds what the shop needs to answer (the reply version). */
export const shopReviewView = (r: ReviewWithReply): JsonObject => ({ ...publicReviewView(r), reply: replyView(r.reply), order_code: r.relatedCode });

/** A rating of a Shipper, as the Shipper sees it: the source (customer or shop), never the writer. */
export const shipperReviewView = (r: ReviewRow, complaint: { complaintId: string; code: string; status: string } | undefined): JsonObject => ({
  review_id: r.reviewId,
  source: r.kind === 'SHIPPER_BY_CUSTOMER' ? 'CUSTOMER' : 'SHOP',
  stars: r.stars,
  comment: r.comment,
  created_at: iso(r.createdAtMs),
  complaint: complaint === undefined ? null : { complaint_id: complaint.complaintId, code: complaint.code, status: complaint.status },
});
