import { JsonObject } from '../idempotency/idempotency-executor';
import { AudienceRole, PartyRole } from './feedback-constants';
import { reconsiderationOpen, visibleToParty, visibleToSubmitter } from './feedback-rules';
import { RECONSIDERATION_WINDOW_MS } from './feedback-constants';
import { AttachmentMeta, ComplaintRow, MessageRow, ReconsiderationRow } from './complaint-repository';
import { iso } from './review-views';

// What each reader may see of a complaint. The Administration reads everything (internal notes included); the submitter reads what was written for them
// and by them; a related party reads only what was addressed to its role or shown to all parties. A phone number, an account id and an internal note
// never reach an app.

export type Viewer = { readonly kind: 'ADMIN' } | { readonly kind: 'SUBMITTER' } | { readonly kind: 'PARTY'; readonly role: AudienceRole };

export function messageVisible(viewer: Viewer, m: MessageRow): boolean {
  switch (viewer.kind) {
    case 'ADMIN':
      return true;
    case 'SUBMITTER':
      return visibleToSubmitter(m);
    case 'PARTY':
      return visibleToParty(m, viewer.role);
  }
}

/** A picture follows the line it was attached to: whoever may read the line may open the picture. */
export function attachmentVisible(viewer: Viewer, attachment: AttachmentMeta, messages: readonly MessageRow[]): boolean {
  const message = messages.find((m) => m.messageId === attachment.messageId);
  return message !== undefined && messageVisible(viewer, message);
}

const authorOf = (viewer: Viewer, m: MessageRow): string => {
  if (viewer.kind === 'ADMIN') {
    return m.authorType;
  }
  if (viewer.kind === 'SUBMITTER') {
    return m.authorType === 'SUBMITTER' ? 'YOU' : 'SUPPORT';
  }
  return m.authorType === 'PARTY' ? 'YOU' : 'SUPPORT';
};

export function messageView(viewer: Viewer, m: MessageRow, attachments: readonly AttachmentMeta[]): JsonObject {
  return {
    message_id: m.messageId,
    seq: m.seq,
    kind: m.kind,
    author: authorOf(viewer, m),
    ...(viewer.kind === 'ADMIN' ? { visibility: m.visibility, audience_role: m.audienceRole, author_user_id: m.authorUserId } : {}),
    body: m.body,
    created_at: iso(m.createdAtMs),
    attachments: attachments.filter((a) => a.messageId === m.messageId).map(attachmentView),
  };
}

export const attachmentView = (a: AttachmentMeta): JsonObject => ({ attachment_id: a.attachmentId, content_type: a.contentType, byte_size: a.byteSize });

export function reconsiderationView(r: ReconsiderationRow): JsonObject {
  return { closure_no: r.closureNo, requested_at: iso(r.requestedAtMs), reason: r.reason, status: r.status, decided_at: iso(r.decidedAtMs), decision_reason: r.decisionReason };
}

/** A line of the list ("Phản ánh của tôi"): enough to match what the detail will say. */
export function complaintListItem(c: ComplaintRow, nowMs: number, relation: 'SUBMITTER' | 'PARTY', recon: ReconsiderationRow | undefined): JsonObject {
  return {
    complaint_id: c.complaintId,
    code: c.code,
    category: c.category,
    status: c.status,
    relation,
    related_code: c.relatedCode,
    summary: relation === 'SUBMITTER' ? c.body.slice(0, 120) : null,
    created_at: iso(c.createdAtMs),
    updated_at: iso(c.updatedAtMs),
    closed_at: iso(c.closedAtMs),
    can_request_reconsideration: relation === 'SUBMITTER' && reconsiderationOpen(c.status, c.closedAtMs, nowMs) && (recon === undefined || recon.closureNo !== c.closureNo),
  };
}

export interface DetailInput {
  readonly complaint: ComplaintRow;
  readonly viewer: Viewer;
  readonly messages: readonly MessageRow[];
  readonly attachments: readonly AttachmentMeta[];
  readonly reconsiderations: readonly ReconsiderationRow[];
  readonly nowMs: number;
}

/** The complaint as the SUBMITTER or a PARTY reads it. (The Administration has its own, fuller detail.) */
export function complaintDetail(i: DetailInput): JsonObject {
  const { complaint: c, viewer } = i;
  const visibleMessages = i.messages.filter((m) => messageVisible(viewer, m));
  const visibleAttachments = i.attachments.filter((a) => attachmentVisible(viewer, a, i.messages));
  const mine = viewer.kind === 'SUBMITTER' ? ('SUBMITTER' as const) : viewer.kind === 'PARTY' ? viewer.role : null;
  const current = i.reconsiderations.find((r) => r.closureNo === c.closureNo);
  const open = c.status === 'PENDING' || c.status === 'IN_PROGRESS' || c.status === 'AWAITING_INFO';
  const canReconsider = viewer.kind === 'SUBMITTER' && reconsiderationOpen(c.status, c.closedAtMs, i.nowMs) && current === undefined;
  const roleOf: PartyRole | null = viewer.kind === 'SUBMITTER' ? c.submitterRole : null;
  return {
    complaint_id: c.complaintId,
    code: c.code,
    category: c.category,
    status: c.status,
    relation: viewer.kind === 'SUBMITTER' ? 'SUBMITTER' : 'PARTY',
    submitter_role: viewer.kind === 'SUBMITTER' ? roleOf : null,
    related: { code: c.relatedCode, order_id: viewer.kind === 'SUBMITTER' ? c.orderId : null, delivery_id: c.deliveryId, review_id: viewer.kind === 'SUBMITTER' ? c.reviewId : null },
    body: viewer.kind === 'SUBMITTER' ? c.body : null,
    conclusion: c.status === 'RESOLVED' ? c.conclusion : null,
    close_reason: viewer.kind === 'SUBMITTER' && c.status === 'CLOSED_NO_ACTION' ? c.closeReason : null,
    created_at: iso(c.createdAtMs),
    updated_at: iso(c.updatedAtMs),
    closed_at: iso(c.closedAtMs),
    version: c.version,
    awaiting_you: c.status === 'AWAITING_INFO' && c.awaitingFrom === mine,
    can_supplement: open && (viewer.kind === 'SUBMITTER' || (c.status === 'AWAITING_INFO' && c.awaitingFrom === mine)),
    can_request_reconsideration: canReconsider,
    reconsideration_expires_at: viewer.kind === 'SUBMITTER' && c.closedAtMs !== null ? iso(c.closedAtMs + RECONSIDERATION_WINDOW_MS) : null,
    reconsiderations: viewer.kind === 'SUBMITTER' ? i.reconsiderations.map(reconsiderationView) : [],
    messages: visibleMessages.map((m) => messageView(viewer, m, visibleAttachments)),
    server_now: new Date(i.nowMs).toISOString(),
  };
}
