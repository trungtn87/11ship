import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { AudienceRole, ComplaintCategory, ComplaintStatus, MessageKind, MessageVisibility, PartyRole } from './feedback-constants';
import { escapeLike } from './review-repository';

// SQL of app.complaints, app.complaint_messages, app.complaint_attachments, app.complaint_reconsiderations and app.complaint_adjustments (M11 owns the
// five). Every method takes the caller's TransactionContext: none begins, commits or rolls back. Times are epoch milliseconds read from, and written
// with, the database clock.

const CLOCK = `date_trunc('milliseconds', clock_timestamp())`;
const ms = (column: string, alias: string): string => `(extract(epoch FROM ${column}) * 1000)::bigint::text AS ${alias}`;

function safe(raw: unknown): number {
  const value = typeof raw === 'string' && /^-?[0-9]{1,16}$/.test(raw) ? Number(raw) : typeof raw === 'number' ? raw : Number.NaN;
  if (!Number.isSafeInteger(value)) {
    throw new TechnicalError('internal', 'Database returned an unexpected number');
  }
  return value;
}
const safeOrNull = (raw: unknown): number | null => (raw === null || raw === undefined ? null : safe(raw));

export interface ComplaintRow {
  readonly complaintId: string;
  readonly code: string;
  readonly submitterUserId: string;
  readonly submitterRole: PartyRole;
  readonly category: ComplaintCategory;
  readonly orderId: string | null;
  readonly deliveryId: string | null;
  readonly reviewId: string | null;
  readonly shopId: string;
  readonly driverId: string | null;
  readonly relatedCode: string;
  readonly shopName: string;
  readonly driverName: string | null;
  readonly driverCode: string | null;
  readonly scopeKey: string;
  readonly status: ComplaintStatus;
  readonly awaitingFrom: 'SUBMITTER' | AudienceRole | null;
  readonly assignedTo: string | null;
  readonly receivedAtMs: number | null;
  readonly body: string;
  readonly conclusion: string | null;
  readonly concludedAtMs: number | null;
  readonly closedAtMs: number | null;
  readonly closeReason: string | null;
  readonly closureNo: number;
  readonly version: number;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

export interface NewComplaint {
  readonly complaintId: string;
  readonly code: string;
  readonly submitterUserId: string;
  readonly submitterRole: PartyRole;
  readonly category: ComplaintCategory;
  readonly orderId: string | null;
  readonly deliveryId: string | null;
  readonly reviewId: string | null;
  readonly shopId: string;
  readonly driverId: string | null;
  readonly relatedCode: string;
  readonly shopName: string;
  readonly driverName: string | null;
  readonly driverCode: string | null;
  readonly scopeKey: string;
  readonly body: string;
}

export interface MessageRow {
  readonly messageId: string;
  readonly complaintId: string;
  readonly seq: number;
  readonly kind: MessageKind;
  readonly visibility: MessageVisibility;
  readonly audienceRole: AudienceRole | null;
  readonly authorType: 'SUBMITTER' | 'PARTY' | 'ADMIN' | 'SYSTEM';
  readonly authorUserId: string | null;
  readonly body: string | null;
  readonly createdAtMs: number;
}

export interface AttachmentMeta {
  readonly attachmentId: string;
  readonly complaintId: string | null;
  readonly messageId: string | null;
  readonly uploaderUserId: string;
  readonly contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly byteSize: number;
}

export interface ReconsiderationRow {
  readonly requestId: string;
  readonly complaintId: string;
  readonly closureNo: number;
  readonly requestedBy: string;
  readonly reason: string;
  readonly requestedAtMs: number;
  readonly status: 'PENDING' | 'REOPENED' | 'REJECTED';
  readonly decidedBy: string | null;
  readonly decidedAtMs: number | null;
  readonly decisionReason: string | null;
}

export interface AdjustmentRow {
  readonly adjustmentId: string;
  readonly complaintId: string;
  readonly kind: 'DELIVERY_RESULT' | 'COMMISSION';
  readonly deliveryId: string;
  readonly assignmentId: string | null;
  readonly driverId: string | null;
  readonly originalState: string;
  readonly originalAssignmentStatus: string | null;
  readonly correctedResult: 'DELIVERED' | 'NOT_DELIVERED' | null;
  readonly direction: 'REFUND_TO_SHIPPER' | 'CHARGE_TO_SHIPPER' | null;
  readonly amountVnd: number | null;
  readonly status: 'RECORDED' | 'PENDING_FINANCE' | 'EXECUTED';
  readonly pendingReason: 'M04_UNAVAILABLE' | 'INSUFFICIENT_BALANCE' | null;
  readonly historyReviewed: boolean;
  readonly successorDeliveryIds: readonly string[];
  readonly reason: string;
  readonly createdBy: string;
  readonly createdAtMs: number;
  readonly version: number;
}

interface RawComplaint {
  complaint_id: string;
  code: string;
  submitter_user_id: string;
  submitter_role: PartyRole;
  category: ComplaintCategory;
  order_id: string | null;
  delivery_id: string | null;
  review_id: string | null;
  shop_id: string;
  driver_id: string | null;
  related_code: string;
  shop_name: string;
  driver_name: string | null;
  driver_code: string | null;
  scope_key: string;
  status: ComplaintStatus;
  awaiting_from: 'SUBMITTER' | AudienceRole | null;
  assigned_to: string | null;
  received_ms: string | null;
  body: string;
  conclusion: string | null;
  concluded_ms: string | null;
  closed_ms: string | null;
  close_reason: string | null;
  closure_no: number;
  version: string;
  created_ms: string;
  updated_ms: string;
}

const C_COLUMNS = `c.complaint_id::text AS complaint_id, c.code, c.submitter_user_id::text AS submitter_user_id, c.submitter_role, c.category, c.order_id::text AS order_id,
  c.delivery_id::text AS delivery_id, c.review_id::text AS review_id, c.shop_id::text AS shop_id, c.driver_id::text AS driver_id, c.related_code, c.shop_name, c.driver_name,
  c.driver_code, c.scope_key::text AS scope_key, c.status, c.awaiting_from, c.assigned_to::text AS assigned_to, ${ms('c.received_at', 'received_ms')}, c.body, c.conclusion,
  ${ms('c.concluded_at', 'concluded_ms')}, ${ms('c.closed_at', 'closed_ms')}, c.close_reason, c.closure_no, c.version::text AS version, ${ms('c.created_at', 'created_ms')},
  ${ms('c.updated_at', 'updated_ms')}`;

const toComplaint = (r: RawComplaint): ComplaintRow => ({
  complaintId: r.complaint_id,
  code: r.code,
  submitterUserId: r.submitter_user_id,
  submitterRole: r.submitter_role,
  category: r.category,
  orderId: r.order_id,
  deliveryId: r.delivery_id,
  reviewId: r.review_id,
  shopId: r.shop_id,
  driverId: r.driver_id,
  relatedCode: r.related_code,
  shopName: r.shop_name,
  driverName: r.driver_name,
  driverCode: r.driver_code,
  scopeKey: r.scope_key,
  status: r.status,
  awaitingFrom: r.awaiting_from,
  assignedTo: r.assigned_to,
  receivedAtMs: safeOrNull(r.received_ms),
  body: r.body,
  conclusion: r.conclusion,
  concludedAtMs: safeOrNull(r.concluded_ms),
  closedAtMs: safeOrNull(r.closed_ms),
  closeReason: r.close_reason,
  closureNo: r.closure_no,
  version: safe(r.version),
  createdAtMs: safe(r.created_ms),
  updatedAtMs: safe(r.updated_ms),
});

export interface StatusPatch {
  readonly status: ComplaintStatus;
  readonly awaitingFrom: 'SUBMITTER' | AudienceRole | null;
  /** Stamp received_at (first reception only). */
  readonly receive?: boolean;
  readonly conclusion?: string | null;
  readonly closeReason?: string | null;
  /** Entering a closed state: stamps closed_at and counts the closure. */
  readonly closing?: boolean;
  /** Leaving a closed state: clears the closure's values (they stay in the thread). */
  readonly reopening?: boolean;
}

export interface AdminComplaintFilter {
  readonly q: string;
  readonly status: ComplaintStatus | null;
  readonly category: ComplaintCategory | null;
  readonly submitterRole: PartyRole | null;
  readonly shop: string;
  readonly shipper: string;
  readonly assignee: string | 'NONE' | null;
  readonly fromMs: number | null;
  readonly toMs: number | null;
}

@Injectable()
export class ComplaintRepository {
  async nextCode(context: TransactionContext): Promise<string> {
    const result = await context.query<{ code: string }>(`SELECT app.next_complaint_code() AS code`);
    return result.rows[0]?.code ?? 'PA00000';
  }

  /** False when an open file of the same party on the same subject and group exists (the unique index answered): nothing was written. */
  async insert(context: TransactionContext, c: NewComplaint): Promise<boolean> {
    const result = await context.query(
      `INSERT INTO app.complaints (complaint_id, code, submitter_user_id, submitter_role, category, order_id, delivery_id, review_id, shop_id, driver_id, related_code, shop_name,
         driver_name, driver_code, scope_key, status, body, closure_no, version, created_at, updated_at)
       VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6::uuid, $7::uuid, $8::uuid, $9::uuid, $10::uuid, $11, $12, $13, $14, $15::uuid, 'PENDING', $16, 0, 1, ${CLOCK}, ${CLOCK})
       ON CONFLICT DO NOTHING`,
      [c.complaintId, c.code, c.submitterUserId, c.submitterRole, c.category, c.orderId, c.deliveryId, c.reviewId, c.shopId, c.driverId, c.relatedCode, c.shopName, c.driverName, c.driverCode, c.scopeKey, c.body],
    );
    return result.rowCount === 1;
  }

  async findById(context: TransactionContext, complaintId: string): Promise<ComplaintRow | undefined> {
    const result = await context.query<RawComplaint>(`SELECT ${C_COLUMNS} FROM app.complaints c WHERE c.complaint_id = $1::uuid`, [complaintId]);
    return result.rows[0] === undefined ? undefined : toComplaint(result.rows[0]);
  }

  async lockById(context: TransactionContext, complaintId: string): Promise<ComplaintRow | undefined> {
    const result = await context.query<RawComplaint>(`SELECT ${C_COLUMNS} FROM app.complaints c WHERE c.complaint_id = $1::uuid FOR UPDATE`, [complaintId]);
    return result.rows[0] === undefined ? undefined : toComplaint(result.rows[0]);
  }

  /** The open file of the same issue (locked), or undefined. */
  async lockOpenIssue(context: TransactionContext, submitterUserId: string, role: PartyRole, category: ComplaintCategory, scopeKey: string): Promise<ComplaintRow | undefined> {
    const result = await context.query<RawComplaint>(
      `SELECT ${C_COLUMNS} FROM app.complaints c
        WHERE c.submitter_user_id = $1::uuid AND c.submitter_role = $2 AND c.category = $3 AND c.scope_key = $4::uuid AND c.status IN ('PENDING', 'IN_PROGRESS', 'AWAITING_INFO')
        FOR UPDATE`,
      [submitterUserId, role, category, scopeKey],
    );
    return result.rows[0] === undefined ? undefined : toComplaint(result.rows[0]);
  }

  /** The newest complaint of this account about a rating (a Shipper's "Phản ánh đánh giá"). */
  async latestOfReviewBy(context: TransactionContext, reviewId: string, userId: string): Promise<{ complaintId: string; code: string; status: string } | undefined> {
    const result = await context.query<{ complaint_id: string; code: string; status: string }>(
      `SELECT complaint_id::text AS complaint_id, code, status FROM app.complaints WHERE review_id = $1::uuid AND submitter_user_id = $2::uuid ORDER BY created_at DESC LIMIT 1`,
      [reviewId, userId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : { complaintId: row.complaint_id, code: row.code, status: row.status };
  }

  /** False when the version moved. */
  async setStatus(context: TransactionContext, complaintId: string, expectedVersion: number, p: StatusPatch): Promise<ComplaintRow | undefined> {
    const result = await context.query<RawComplaint>(
      `UPDATE app.complaints c SET
         status = $3, awaiting_from = $4,
         received_at = CASE WHEN $5::boolean THEN COALESCE(c.received_at, ${CLOCK}) ELSE c.received_at END,
         conclusion = CASE WHEN $8::boolean THEN NULL WHEN $6::text IS NOT NULL THEN $6::text ELSE c.conclusion END,
         concluded_at = CASE WHEN $8::boolean THEN NULL WHEN $6::text IS NOT NULL THEN ${CLOCK} ELSE c.concluded_at END,
         close_reason = CASE WHEN $8::boolean THEN NULL WHEN $7::text IS NOT NULL THEN $7::text ELSE c.close_reason END,
         closed_at = CASE WHEN $9::boolean THEN ${CLOCK} WHEN $8::boolean THEN NULL ELSE c.closed_at END,
         closure_no = CASE WHEN $9::boolean THEN c.closure_no + 1 ELSE c.closure_no END,
         version = c.version + 1, updated_at = ${CLOCK}
       WHERE c.complaint_id = $1::uuid AND c.version = $2::bigint
       RETURNING ${C_COLUMNS}`,
      [complaintId, expectedVersion, p.status, p.awaitingFrom, p.receive === true, p.conclusion ?? null, p.closeReason ?? null, p.reopening === true, p.closing === true],
    );
    return result.rows[0] === undefined ? undefined : toComplaint(result.rows[0]);
  }

  async assign(context: TransactionContext, complaintId: string, expectedVersion: number, assignee: string | null): Promise<ComplaintRow | undefined> {
    const result = await context.query<RawComplaint>(
      `UPDATE app.complaints c SET assigned_to = $3::uuid, version = c.version + 1, updated_at = ${CLOCK} WHERE c.complaint_id = $1::uuid AND c.version = $2::bigint RETURNING ${C_COLUMNS}`,
      [complaintId, expectedVersion, assignee],
    );
    return result.rows[0] === undefined ? undefined : toComplaint(result.rows[0]);
  }

  // ---- thread ------------------------------------------------------------------------------------------------------------------

  /** Under the complaint row's lock: the next number is the highest + 1. */
  async appendMessage(
    context: TransactionContext,
    m: { messageId: string; complaintId: string; kind: MessageKind; visibility: MessageVisibility; audienceRole: AudienceRole | null; authorType: MessageRow['authorType']; authorUserId: string | null; body: string | null },
  ): Promise<void> {
    await context.query(
      `INSERT INTO app.complaint_messages (message_id, complaint_id, seq, kind, visibility, audience_role, author_type, author_user_id, body, created_at)
       SELECT $1::uuid, $2::uuid, COALESCE(MAX(v.seq), 0) + 1, $3, $4, $5, $6, $7::uuid, $8, ${CLOCK}
         FROM (SELECT seq FROM app.complaint_messages WHERE complaint_id = $2::uuid) AS v`,
      [m.messageId, m.complaintId, m.kind, m.visibility, m.audienceRole, m.authorType, m.authorUserId, m.body],
    );
  }

  async listMessages(context: TransactionContext, complaintId: string): Promise<MessageRow[]> {
    const result = await context.query<{ message_id: string; complaint_id: string; seq: number; kind: MessageKind; visibility: MessageVisibility; audience_role: AudienceRole | null; author_type: MessageRow['authorType']; author_user_id: string | null; body: string | null; at_ms: string }>(
      `SELECT message_id::text AS message_id, complaint_id::text AS complaint_id, seq, kind, visibility, audience_role, author_type, author_user_id::text AS author_user_id, body, ${ms('created_at', 'at_ms')}
         FROM app.complaint_messages WHERE complaint_id = $1::uuid ORDER BY seq`,
      [complaintId],
    );
    return result.rows.map((r) => ({ messageId: r.message_id, complaintId: r.complaint_id, seq: r.seq, kind: r.kind, visibility: r.visibility, audienceRole: r.audience_role, authorType: r.author_type, authorUserId: r.author_user_id, body: r.body, createdAtMs: safe(r.at_ms) }));
  }

  // ---- attachments -------------------------------------------------------------------------------------------------------------

  async countUnlinked(context: TransactionContext, userId: string): Promise<number> {
    const result = await context.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.complaint_attachments WHERE uploader_user_id = $1::uuid AND complaint_id IS NULL`, [userId]);
    return safe(result.rows[0]?.n ?? '0');
  }

  async insertAttachment(context: TransactionContext, a: { attachmentId: string; uploaderUserId: string; contentType: string; bytes: Buffer }): Promise<void> {
    await context.query(
      `INSERT INTO app.complaint_attachments (attachment_id, uploader_user_id, content_type, byte_size, data, created_at) VALUES ($1::uuid, $2::uuid, $3, $4::integer, $5::bytea, ${CLOCK})`,
      [a.attachmentId, a.uploaderUserId, a.contentType, a.bytes.length, a.bytes],
    );
  }

  /** Locks the attachments the caller uploaded and has not attached yet. Fewer rows than ids means one is somebody else's, attached already, or missing. */
  async lockUnlinkedOwned(context: TransactionContext, ids: readonly string[], uploaderUserId: string): Promise<AttachmentMeta[]> {
    if (ids.length === 0) {
      return [];
    }
    const result = await context.query<{ attachment_id: string; content_type: AttachmentMeta['contentType']; byte_size: number }>(
      `SELECT attachment_id::text AS attachment_id, content_type, byte_size FROM app.complaint_attachments
        WHERE attachment_id = ANY($1::uuid[]) AND uploader_user_id = $2::uuid AND complaint_id IS NULL ORDER BY attachment_id FOR UPDATE`,
      [ids, uploaderUserId],
    );
    return result.rows.map((r) => ({ attachmentId: r.attachment_id, complaintId: null, messageId: null, uploaderUserId, contentType: r.content_type, byteSize: r.byte_size }));
  }

  async linkAttachments(context: TransactionContext, ids: readonly string[], complaintId: string, messageId: string): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    const result = await context.query(
      `UPDATE app.complaint_attachments SET complaint_id = $2::uuid, message_id = $3::uuid, linked_at = ${CLOCK} WHERE attachment_id = ANY($1::uuid[]) AND complaint_id IS NULL`,
      [ids, complaintId, messageId],
    );
    if (result.rowCount !== ids.length) {
      throw new TechnicalError('internal', 'Attachments were not all linked');
    }
  }

  async listAttachments(context: TransactionContext, complaintId: string): Promise<AttachmentMeta[]> {
    const result = await context.query<{ attachment_id: string; message_id: string; uploader_user_id: string; content_type: AttachmentMeta['contentType']; byte_size: number }>(
      `SELECT attachment_id::text AS attachment_id, message_id::text AS message_id, uploader_user_id::text AS uploader_user_id, content_type, byte_size
         FROM app.complaint_attachments WHERE complaint_id = $1::uuid ORDER BY linked_at, attachment_id`,
      [complaintId],
    );
    return result.rows.map((r) => ({ attachmentId: r.attachment_id, complaintId, messageId: r.message_id, uploaderUserId: r.uploader_user_id, contentType: r.content_type, byteSize: r.byte_size }));
  }

  async findAttachment(context: TransactionContext, attachmentId: string): Promise<(AttachmentMeta & { readonly data: Buffer }) | undefined> {
    const result = await context.query<{ attachment_id: string; complaint_id: string | null; message_id: string | null; uploader_user_id: string; content_type: AttachmentMeta['contentType']; byte_size: number; data: Buffer }>(
      `SELECT attachment_id::text AS attachment_id, complaint_id::text AS complaint_id, message_id::text AS message_id, uploader_user_id::text AS uploader_user_id, content_type, byte_size, data
         FROM app.complaint_attachments WHERE attachment_id = $1::uuid`,
      [attachmentId],
    );
    const r = result.rows[0];
    return r === undefined ? undefined : { attachmentId: r.attachment_id, complaintId: r.complaint_id, messageId: r.message_id, uploaderUserId: r.uploader_user_id, contentType: r.content_type, byteSize: r.byte_size, data: r.data };
  }

  // ---- reconsideration ---------------------------------------------------------------------------------------------------------

  async insertReconsideration(context: TransactionContext, r: { requestId: string; complaintId: string; closureNo: number; requestedBy: string; reason: string }): Promise<boolean> {
    const result = await context.query(
      `INSERT INTO app.complaint_reconsiderations (request_id, complaint_id, closure_no, requested_by, reason, requested_at, status) VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5, ${CLOCK}, 'PENDING')
       ON CONFLICT DO NOTHING`,
      [r.requestId, r.complaintId, r.closureNo, r.requestedBy, r.reason],
    );
    return result.rowCount === 1;
  }

  async lockReconsideration(context: TransactionContext, complaintId: string, closureNo: number): Promise<ReconsiderationRow | undefined> {
    const result = await context.query<RawReconsideration>(`SELECT ${RC_COLUMNS} FROM app.complaint_reconsiderations r WHERE r.complaint_id = $1::uuid AND r.closure_no = $2 FOR UPDATE`, [complaintId, closureNo]);
    return result.rows[0] === undefined ? undefined : toReconsideration(result.rows[0]);
  }

  async listReconsiderations(context: TransactionContext, complaintId: string): Promise<ReconsiderationRow[]> {
    const result = await context.query<RawReconsideration>(`SELECT ${RC_COLUMNS} FROM app.complaint_reconsiderations r WHERE r.complaint_id = $1::uuid ORDER BY r.closure_no`, [complaintId]);
    return result.rows.map(toReconsideration);
  }

  async decideReconsideration(context: TransactionContext, requestId: string, status: 'REOPENED' | 'REJECTED', decidedBy: string, reason: string): Promise<boolean> {
    const result = await context.query(
      `UPDATE app.complaint_reconsiderations SET status = $2, decided_by = $3::uuid, decided_at = ${CLOCK}, decision_reason = $4 WHERE request_id = $1::uuid AND status = 'PENDING'`,
      [requestId, status, decidedBy, reason],
    );
    return result.rowCount === 1;
  }

  // ---- lists ---------------------------------------------------------------------------------------------------------------------

  /** The complaints a party opened ("Phản ánh của tôi"), newest first. `closed` is RESOLVED + CLOSED_NO_ACTION. */
  async listOfSubmitter(context: TransactionContext, userId: string, role: PartyRole, scope: 'open' | 'closed', limit: number, offset: number): Promise<ComplaintRow[]> {
    const result = await context.query<RawComplaint>(
      `SELECT ${C_COLUMNS} FROM app.complaints c WHERE c.submitter_user_id = $1::uuid AND c.submitter_role = $2 AND (($3 = 'open') = (c.status IN ('PENDING', 'IN_PROGRESS', 'AWAITING_INFO')))
        ORDER BY c.updated_at DESC, c.complaint_id LIMIT $4 OFFSET $5`,
      [userId, role, scope, limit, offset],
    );
    return result.rows.map(toComplaint);
  }

  async countsOfSubmitter(context: TransactionContext, userId: string, role: PartyRole): Promise<{ open: number; closed: number }> {
    const result = await context.query<{ open: string; closed: string }>(
      `SELECT count(*) FILTER (WHERE status IN ('PENDING', 'IN_PROGRESS', 'AWAITING_INFO'))::text AS open, count(*) FILTER (WHERE status IN ('RESOLVED', 'CLOSED_NO_ACTION'))::text AS closed
         FROM app.complaints WHERE submitter_user_id = $1::uuid AND submitter_role = $2`,
      [userId, role],
    );
    return { open: safe(result.rows[0]?.open ?? '0'), closed: safe(result.rows[0]?.closed ?? '0') };
  }

  /**
   * Files in which this shop / Shipper is a RELATED party and something was shown to it (a request addressed to its role, or a conclusion). A party never
   * lists a file in which nothing was disclosed to it.
   */
  async listOfParty(context: TransactionContext, role: AudienceRole, partyId: string, scope: 'open' | 'closed', limit: number, offset: number): Promise<ComplaintRow[]> {
    const result = await context.query<RawComplaint>(
      `SELECT ${C_COLUMNS} FROM app.complaints c
        WHERE ${partyWhere(role)} AND (($3 = 'open') = (c.status IN ('PENDING', 'IN_PROGRESS', 'AWAITING_INFO')))
        ORDER BY c.updated_at DESC, c.complaint_id LIMIT $4 OFFSET $5`,
      [partyId, role, scope, limit, offset],
    );
    return result.rows.map(toComplaint);
  }

  async countsOfParty(context: TransactionContext, role: AudienceRole, partyId: string): Promise<{ open: number; closed: number }> {
    const result = await context.query<{ open: string; closed: string }>(
      `SELECT count(*) FILTER (WHERE c.status IN ('PENDING', 'IN_PROGRESS', 'AWAITING_INFO'))::text AS open, count(*) FILTER (WHERE c.status IN ('RESOLVED', 'CLOSED_NO_ACTION'))::text AS closed
         FROM app.complaints c WHERE ${partyWhere(role)}`,
      [partyId, role],
    );
    return { open: safe(result.rows[0]?.open ?? '0'), closed: safe(result.rows[0]?.closed ?? '0') };
  }

  /** Is this shop / Shipper a related party of the file with something shown to it? (the read right of a non-submitter) */
  async partyMayRead(context: TransactionContext, complaintId: string, role: AudienceRole, partyId: string): Promise<boolean> {
    const result = await context.query(
      `SELECT 1 FROM app.complaints c WHERE c.complaint_id = $3::uuid AND ${partyWhere(role)}`,
      [partyId, role, complaintId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  // ---- administration ----------------------------------------------------------------------------------------------------------

  async listForAdmin(context: TransactionContext, f: AdminComplaintFilter, page: { limit: number; offset: number }): Promise<{ rows: ComplaintRow[]; total: number }> {
    const where = `($1::text = '' OR c.code ILIKE $1::text ESCAPE '!' OR c.related_code ILIKE $1::text ESCAPE '!')
        AND ($2::text IS NULL OR c.status = $2::text) AND ($3::text IS NULL OR c.category = $3::text) AND ($4::text IS NULL OR c.submitter_role = $4::text)
        AND ($5::text = '' OR c.shop_name ILIKE $5::text ESCAPE '!') AND ($6::text = '' OR c.driver_name ILIKE $6::text ESCAPE '!' OR c.driver_code ILIKE $6::text ESCAPE '!')
        AND ($7::text IS NULL OR ($7::text = 'NONE' AND c.assigned_to IS NULL) OR c.assigned_to::text = $7::text)
        AND ($8::timestamptz IS NULL OR c.created_at >= $8::timestamptz) AND ($9::timestamptz IS NULL OR c.created_at < $9::timestamptz)`;
    const like = (v: string): string => (v === '' ? '' : `%${escapeLike(v)}%`);
    const args = [like(f.q), f.status, f.category, f.submitterRole, like(f.shop), like(f.shipper), f.assignee, f.fromMs === null ? null : new Date(f.fromMs), f.toMs === null ? null : new Date(f.toMs)];
    const total = await context.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.complaints c WHERE ${where}`, args);
    const result = await context.query<RawComplaint>(`SELECT ${C_COLUMNS} FROM app.complaints c WHERE ${where} ORDER BY c.created_at DESC, c.complaint_id LIMIT $10 OFFSET $11`, [...args, page.limit, page.offset]);
    return { rows: result.rows.map(toComplaint), total: safe(total.rows[0]?.n ?? '0') };
  }

  async adminCounters(context: TransactionContext): Promise<{ pending: number; inProgress: number; awaitingInfo: number; reconsiderations: number }> {
    const result = await context.query<{ pending: string; in_progress: string; awaiting: string; recon: string }>(
      `SELECT count(*) FILTER (WHERE status = 'PENDING')::text AS pending, count(*) FILTER (WHERE status = 'IN_PROGRESS')::text AS in_progress,
              count(*) FILTER (WHERE status = 'AWAITING_INFO')::text AS awaiting,
              (SELECT count(*) FROM app.complaint_reconsiderations WHERE status = 'PENDING')::text AS recon
         FROM app.complaints`,
    );
    const r = result.rows[0];
    return { pending: safe(r?.pending ?? '0'), inProgress: safe(r?.in_progress ?? '0'), awaitingInfo: safe(r?.awaiting ?? '0'), reconsiderations: safe(r?.recon ?? '0') };
  }

  /** Which of these files have a reconsideration request waiting for the Administration's decision. */
  async pendingReconsiderationIds(context: TransactionContext, complaintIds: readonly string[]): Promise<Set<string>> {
    if (complaintIds.length === 0) {
      return new Set();
    }
    const result = await context.query<{ complaint_id: string }>(
      `SELECT complaint_id::text AS complaint_id FROM app.complaint_reconsiderations WHERE complaint_id = ANY($1::uuid[]) AND status = 'PENDING'`,
      [complaintIds],
    );
    return new Set(result.rows.map((r) => r.complaint_id));
  }

  async complaintsOfReview(context: TransactionContext, reviewId: string): Promise<{ complaintId: string; code: string; status: ComplaintStatus }[]> {
    const result = await context.query<{ complaint_id: string; code: string; status: ComplaintStatus }>(
      `SELECT complaint_id::text AS complaint_id, code, status FROM app.complaints WHERE review_id = $1::uuid ORDER BY created_at`,
      [reviewId],
    );
    return result.rows.map((r) => ({ complaintId: r.complaint_id, code: r.code, status: r.status }));
  }

  async complaintsOfDelivery(context: TransactionContext, deliveryId: string): Promise<{ complaintId: string; code: string; status: ComplaintStatus; category: ComplaintCategory }[]> {
    const result = await context.query<{ complaint_id: string; code: string; status: ComplaintStatus; category: ComplaintCategory }>(
      `SELECT complaint_id::text AS complaint_id, code, status, category FROM app.complaints WHERE delivery_id = $1::uuid ORDER BY created_at`,
      [deliveryId],
    );
    return result.rows.map((r) => ({ complaintId: r.complaint_id, code: r.code, status: r.status, category: r.category }));
  }

  // ---- adjustments -------------------------------------------------------------------------------------------------------------

  async insertAdjustment(context: TransactionContext, a: Omit<AdjustmentRow, 'createdAtMs' | 'version'>): Promise<boolean> {
    const result = await context.query(
      `INSERT INTO app.complaint_adjustments (adjustment_id, complaint_id, kind, delivery_id, assignment_id, driver_id, original_state, original_assignment_status, corrected_result, direction,
         amount_vnd, status, pending_reason, history_reviewed, successor_delivery_ids, reason, created_by, created_at, updated_at, version)
       VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5::uuid, $6::uuid, $7, $8, $9, $10, $11::bigint, $12, $13, $14, $15::uuid[], $16, $17::uuid, ${CLOCK}, ${CLOCK}, 1)
       ON CONFLICT DO NOTHING`,
      [a.adjustmentId, a.complaintId, a.kind, a.deliveryId, a.assignmentId, a.driverId, a.originalState, a.originalAssignmentStatus, a.correctedResult, a.direction, a.amountVnd, a.status, a.pendingReason, a.historyReviewed, a.successorDeliveryIds, a.reason, a.createdBy],
    );
    return result.rowCount === 1;
  }

  async listAdjustments(context: TransactionContext, complaintId: string): Promise<AdjustmentRow[]> {
    const result = await context.query<RawAdjustment>(`SELECT ${A_COLUMNS} FROM app.complaint_adjustments a WHERE a.complaint_id = $1::uuid ORDER BY a.created_at, a.adjustment_id`, [complaintId]);
    return result.rows.map(toAdjustment);
  }

  async listAdjustmentsOfDelivery(context: TransactionContext, deliveryId: string): Promise<AdjustmentRow[]> {
    const result = await context.query<RawAdjustment>(`SELECT ${A_COLUMNS} FROM app.complaint_adjustments a WHERE a.delivery_id = $1::uuid ORDER BY a.created_at, a.adjustment_id`, [deliveryId]);
    return result.rows.map(toAdjustment);
  }

  async lockAdjustment(context: TransactionContext, complaintId: string, kind: 'DELIVERY_RESULT' | 'COMMISSION'): Promise<AdjustmentRow | undefined> {
    const result = await context.query<RawAdjustment>(`SELECT ${A_COLUMNS} FROM app.complaint_adjustments a WHERE a.complaint_id = $1::uuid AND a.kind = $2 FOR UPDATE`, [complaintId, kind]);
    return result.rows[0] === undefined ? undefined : toAdjustment(result.rows[0]);
  }

  async setAdjustmentMoney(context: TransactionContext, adjustmentId: string, expectedVersion: number, status: 'PENDING_FINANCE' | 'EXECUTED', pendingReason: string | null): Promise<boolean> {
    const result = await context.query(
      `UPDATE app.complaint_adjustments SET status = $3, pending_reason = $4, version = version + 1, updated_at = ${CLOCK} WHERE adjustment_id = $1::uuid AND version = $2::bigint`,
      [adjustmentId, expectedVersion, status, pendingReason],
    );
    return result.rowCount === 1;
  }
}

/** The WHERE of "files in which this party is a related party and was shown something". $1 party id, $2 role. */
function partyWhere(role: AudienceRole): string {
  const link = role === 'SHOP' ? `c.shop_id = $1::uuid AND c.submitter_role <> 'SHOP'` : `c.driver_id = $1::uuid AND c.submitter_role <> 'SHIPPER'`;
  return `$2::text = '${role}' AND ${link}
     AND EXISTS (SELECT 1 FROM app.complaint_messages m WHERE m.complaint_id = c.complaint_id AND (m.visibility = 'PARTIES' OR (m.visibility = 'PARTY_ONLY' AND m.audience_role = '${role}')))`;
}

interface RawReconsideration {
  request_id: string;
  complaint_id: string;
  closure_no: number;
  requested_by: string;
  reason: string;
  requested_ms: string;
  status: 'PENDING' | 'REOPENED' | 'REJECTED';
  decided_by: string | null;
  decided_ms: string | null;
  decision_reason: string | null;
}
const RC_COLUMNS = `r.request_id::text AS request_id, r.complaint_id::text AS complaint_id, r.closure_no, r.requested_by::text AS requested_by, r.reason, ${ms('r.requested_at', 'requested_ms')}, r.status,
  r.decided_by::text AS decided_by, ${ms('r.decided_at', 'decided_ms')}, r.decision_reason`;
const toReconsideration = (r: RawReconsideration): ReconsiderationRow => ({
  requestId: r.request_id,
  complaintId: r.complaint_id,
  closureNo: r.closure_no,
  requestedBy: r.requested_by,
  reason: r.reason,
  requestedAtMs: safe(r.requested_ms),
  status: r.status,
  decidedBy: r.decided_by,
  decidedAtMs: safeOrNull(r.decided_ms),
  decisionReason: r.decision_reason,
});

interface RawAdjustment {
  adjustment_id: string;
  complaint_id: string;
  kind: 'DELIVERY_RESULT' | 'COMMISSION';
  delivery_id: string;
  assignment_id: string | null;
  driver_id: string | null;
  original_state: string;
  original_assignment_status: string | null;
  corrected_result: 'DELIVERED' | 'NOT_DELIVERED' | null;
  direction: 'REFUND_TO_SHIPPER' | 'CHARGE_TO_SHIPPER' | null;
  amount_vnd: string | null;
  status: 'RECORDED' | 'PENDING_FINANCE' | 'EXECUTED';
  pending_reason: 'M04_UNAVAILABLE' | 'INSUFFICIENT_BALANCE' | null;
  history_reviewed: boolean;
  successors: string[];
  reason: string;
  created_by: string;
  created_ms: string;
  version: string;
}
const A_COLUMNS = `a.adjustment_id::text AS adjustment_id, a.complaint_id::text AS complaint_id, a.kind, a.delivery_id::text AS delivery_id, a.assignment_id::text AS assignment_id,
  a.driver_id::text AS driver_id, a.original_state, a.original_assignment_status, a.corrected_result, a.direction, a.amount_vnd::text AS amount_vnd, a.status, a.pending_reason,
  a.history_reviewed, ARRAY(SELECT x::text FROM unnest(a.successor_delivery_ids) AS x) AS successors, a.reason, a.created_by::text AS created_by, ${ms('a.created_at', 'created_ms')},
  a.version::text AS version`;
const toAdjustment = (r: RawAdjustment): AdjustmentRow => ({
  adjustmentId: r.adjustment_id,
  complaintId: r.complaint_id,
  kind: r.kind,
  deliveryId: r.delivery_id,
  assignmentId: r.assignment_id,
  driverId: r.driver_id,
  originalState: r.original_state,
  originalAssignmentStatus: r.original_assignment_status,
  correctedResult: r.corrected_result,
  direction: r.direction,
  amountVnd: safeOrNull(r.amount_vnd),
  status: r.status,
  pendingReason: r.pending_reason,
  historyReviewed: r.history_reviewed,
  successorDeliveryIds: r.successors,
  reason: r.reason,
  createdBy: r.created_by,
  createdAtMs: safe(r.created_ms),
  version: safe(r.version),
});
