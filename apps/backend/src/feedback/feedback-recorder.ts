import { Injectable } from '@nestjs/common';
import { AuditWriter } from '../audit/audit-writer';
import { JsonObject } from '../idempotency/idempotency-executor';
import { OutboxWriter } from '../outbox/outbox-writer';
import { TransactionContext } from '../transaction/transaction-context';
import { COMPLAINT_RESOURCE, FEEDBACK_EVENT_SCHEMA, OUTBOX_COMPLAINT_CHANGED, OUTBOX_REVIEW_CHANGED, REVIEW_RESOURCE } from './feedback-constants';

// The two records every M11 change leaves, written in the SAME transaction as the change: the audit row (who did it, why, before and after) and the
// outbox event that M08 (notifications) and later M13 (monitoring) consume after the commit. They carry identifiers, the kind, the state and the
// version only: never a comment, a complaint text, a picture, a phone or an address.

export interface AuditPart {
  readonly requestId: string;
  readonly actorType: 'USER' | 'ADMIN' | 'SYSTEM';
  readonly actorId: string | null;
  readonly action: string;
  readonly metadata?: JsonObject;
}

@Injectable()
export class FeedbackRecorder {
  constructor(
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
  ) {}

  async review(context: TransactionContext, a: AuditPart, review: { reviewId: string; kind: string; version: number; shopId: string | null; driverId: string | null; stars: number; visibility: string }): Promise<void> {
    await this.audit.append(context, {
      requestId: a.requestId,
      actorType: a.actorType,
      actorId: a.actorId,
      action: a.action,
      resourceType: REVIEW_RESOURCE,
      resourceId: review.reviewId,
      resourceVersion: review.version,
      outcome: 'SUCCESS',
      metadata: { kind: review.kind, stars: review.stars, visibility: review.visibility, ...a.metadata },
    });
    await this.outbox.append(context, {
      eventType: OUTBOX_REVIEW_CHANGED,
      eventSchemaVersion: FEEDBACK_EVENT_SCHEMA,
      resourceType: REVIEW_RESOURCE,
      resourceId: review.reviewId,
      resourceVersion: review.version,
      payload: { review_id: review.reviewId, kind: review.kind, shop_id: review.shopId, driver_id: review.driverId, visibility: review.visibility, version: review.version },
    });
  }

  /** Issue #261: the janitor removed never-attached pictures. Counts only: never a picture, an owner or a file name. */
  async orphanPicturesPurged(context: TransactionContext, requestId: string, removed: { count: number; bytes: number }): Promise<void> {
    await this.audit.append(context, {
      requestId,
      actorType: 'SYSTEM',
      actorId: null,
      action: 'feedback.orphan_pictures_purged.v1',
      resourceType: 'complaint_attachment_cleanup',
      resourceId: requestId,
      resourceVersion: 1,
      outcome: 'SUCCESS',
      metadata: { removed: removed.count, bytes: removed.bytes, ttl_hours: 24 },
    });
  }

  /** `change` is a short dotted suffix: submitted, appended, supplement, received, info_requested, concluded, closed, reopen_requested, reopened ... */
  async complaint(
    context: TransactionContext,
    a: AuditPart,
    c: { complaintId: string; code: string; version: number; status: string; shopId: string | null; driverId: string | null; submitterUserId: string; submitterRole: string; awaitingFrom: string | null },
    change: string,
  ): Promise<void> {
    await this.audit.append(context, {
      requestId: a.requestId,
      actorType: a.actorType,
      actorId: a.actorId,
      action: a.action,
      resourceType: COMPLAINT_RESOURCE,
      resourceId: c.complaintId,
      resourceVersion: c.version,
      outcome: 'SUCCESS',
      metadata: { change, status: c.status, ...a.metadata },
    });
    await this.outbox.append(context, {
      eventType: OUTBOX_COMPLAINT_CHANGED,
      eventSchemaVersion: FEEDBACK_EVENT_SCHEMA,
      resourceType: COMPLAINT_RESOURCE,
      resourceId: c.complaintId,
      resourceVersion: c.version,
      payload: {
        complaint_id: c.complaintId,
        code: c.code,
        change,
        status: c.status,
        version: c.version,
        shop_id: c.shopId,
        driver_id: c.driverId,
        submitter_user_id: c.submitterUserId,
        submitter_role: c.submitterRole,
        awaiting_from: c.awaitingFrom,
      },
    });
  }
}
